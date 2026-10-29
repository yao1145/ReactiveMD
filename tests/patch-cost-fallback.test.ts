import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLocalResultPatch,
  diffSourceEdit,
  LOCAL_RESULT_PATCH_PROTOCOL,
} from '../src/local/compile-patch';
import type { LocalCompileSession, LocalIncrementalStats } from '../src/local/incremental';
import type { LocalCompileResult, LocalDocument, LocalNode } from '../src/local/types';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  startLocalCompileWorker,
  type LocalCompileOutcome,
  type LocalCompileWorker,
  type LocalCompileWorkerControl,
  type LocalCompileWorkerRequest,
  type LocalCompileWorkerResponse,
  type LocalCompileWorkerScope,
} from '../src/local/worker';

const STATS: Readonly<LocalIncrementalStats> = {
  mode: 'incremental',
  totalBlocks: 0,
  compiledBlocks: 0,
  reusedBlocks: 0,
  compiledCharacters: 0,
};

type OkResult = Extract<LocalCompileResult, { ok: true }>;

interface DocumentFixture {
  texts: string[];
  source: string;
  nodes: LocalNode[];
}

/** A block-per-paragraph document whose node ids are namespaced by `prefix`. */
function makeDocument(prefix: string, count: number): DocumentFixture {
  const texts = Array.from(
    { length: count },
    (_, index) => `${prefix} paragraph ${index} with a deliberately long value`,
  );
  const nodes: LocalNode[] = [];
  let offset = 0;
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index];
    const end = offset + text.length;
    nodes.push({
      type: 'paragraph',
      id: `${prefix}-${index}`,
      range: { start: offset, end },
      children: [{ type: 'text', id: `${prefix}-${index}-text`, range: { start: offset, end }, value: text }],
    });
    offset = end + 2;
  }
  return { texts, source: texts.join('\n\n'), nodes };
}

function makeResult(source: string, nodes: LocalNode[]): OkResult {
  return {
    ok: true,
    document: {
      syntax: 'local',
      source,
      nodes,
      initialState: {},
      bindings: {},
    } as LocalDocument,
    diagnostics: [],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Returns scripted results and records every compiled source. */
class ScriptedSession {
  readonly stats: Readonly<LocalIncrementalStats> = STATS;
  readonly compiled: string[] = [];
  private readonly results = new Map<string, LocalCompileResult>();

  script(source: string, result: LocalCompileResult): void {
    this.results.set(source, result);
  }

  compile(source: string): LocalCompileResult {
    this.compiled.push(source);
    const result = this.results.get(source);
    if (result === undefined) throw new Error(`unexpected source: ${source.slice(0, 24)}`);
    return result;
  }

  dispose(): void {}
}

interface FakeScope extends LocalCompileWorkerScope {
  responses: LocalCompileWorkerResponse[];
}

function createScope(): FakeScope {
  const scope: FakeScope = {
    onmessage: null,
    responses: [],
    postMessage(message: LocalCompileWorkerResponse): void {
      scope.responses.push(message);
    },
  };
  return scope;
}

function requestEvent(data: unknown): MessageEvent<LocalCompileWorkerRequest> {
  return { data } as unknown as MessageEvent<LocalCompileWorkerRequest>;
}

function setup() {
  const scope = createScope();
  const session = new ScriptedSession();
  const control: LocalCompileWorkerControl = startLocalCompileWorker(scope, {
    createSession: () => session as unknown as LocalCompileSession,
  });
  return { scope, session, control };
}

describe('worker result patch cost fallback', () => {
  it('sends the complete result for a wholesale rewrite without reporting an error', () => {
    const { scope, session, control } = setup();
    const base = makeDocument('alpha', 60);
    const huge = makeDocument('omega', 60);
    // Frozen scripted results prove the transport never mutates them.
    session.script(base.source, deepFreeze(makeResult(base.source, base.nodes)));
    session.script(huge.source, deepFreeze(makeResult(huge.source, huge.nodes)));

    scope.onmessage!(requestEvent({
      id: 1,
      source: base.source,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: 1,
    }));
    const first = scope.responses[0];
    expect(first.ok).toBe(true);
    if (!first.ok || !('result' in first)) throw new Error('expected the handshake result');

    scope.onmessage!(requestEvent({
      id: 2,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 1,
      revision: 2,
      edit: { from: 0, to: base.source.length, insert: huge.source },
      targetLength: huge.source.length,
    }));

    const second = scope.responses[1];
    expect(second.ok).toBe(true);
    if (!second.ok || !('result' in second)) throw new Error('expected a complete fallback result');
    // A cost fallback is a successful transport choice, never a retry request.
    expect('patch' in second).toBe(false);
    expect('retryFull' in second).toBe(false);
    expect(second.protocol).toBe(LOCAL_RESULT_PATCH_PROTOCOL);
    expect(second.revision).toBe(2);
    expect(second.metrics?.patchFallback).toBe('cost');
    expect(second.metrics?.patchBytes).toBeGreaterThan(0);
    expect(second.metrics?.patchBytes).toBeGreaterThanOrEqual(second.metrics?.fullBytes ?? 0);
    expect(second.result.ok).toBe(true);
    if (second.result.ok) expect(second.result.document.source).toBe(huge.source);
    expect(session.compiled).toEqual([base.source, huge.source]);
    control.dispose();
  });

  it('keeps a small patch and continues from the fallback revision', () => {
    const { scope, session, control } = setup();
    const base = makeDocument('alpha', 60);
    const huge = makeDocument('omega', 60);
    session.script(base.source, deepFreeze(makeResult(base.source, base.nodes)));
    session.script(huge.source, deepFreeze(makeResult(huge.source, huge.nodes)));

    // One small edit after the rewrite: same length, so ranges stay valid.
    const edited = makeDocument('omega', 60);
    const index = 10;
    const original = edited.texts[index];
    const replacement = `OMEGA${original.slice(5)}`;
    expect(replacement.length).toBe(original.length);
    edited.texts[index] = replacement;
    const editedNode = edited.nodes[index].children![0];
    editedNode.value = replacement;
    const editedSource = edited.texts.join('\n\n');
    session.script(editedSource, deepFreeze(makeResult(editedSource, edited.nodes)));

    scope.onmessage!(requestEvent({
      id: 1,
      source: base.source,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: 1,
    }));
    scope.onmessage!(requestEvent({
      id: 2,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 1,
      revision: 2,
      edit: { from: 0, to: base.source.length, insert: huge.source },
      targetLength: huge.source.length,
    }));
    const fallback = scope.responses[1];
    expect(fallback.ok).toBe(true);
    if (!fallback.ok || !('result' in fallback)) throw new Error('expected the fallback result');

    const edit = diffSourceEdit(huge.source, editedSource);
    expect(edit).not.toBeNull();
    scope.onmessage!(requestEvent({
      id: 3,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 2,
      revision: 3,
      edit: edit!,
      targetLength: editedSource.length,
    }));

    const third = scope.responses[2];
    expect(third.ok).toBe(true);
    if (!third.ok || !('patch' in third)) throw new Error('expected a result patch after the fallback');
    expect(third.baseRevision).toBe(2);
    expect(third.revision).toBe(3);
    expect(third.metrics?.patchFallback).toBeUndefined();
    const applied = applyLocalResultPatch(fallback.result, third.patch);
    expect(applied).not.toBeNull();
    expect(applied!.ok).toBe(true);
    if (applied!.ok) expect(applied!.document.source).toBe(editedSource);
    expect(session.compiled).toEqual([base.source, huge.source, editedSource]);
    control.dispose();
  });
});

/** Wires the scheduler directly to the real worker-side handler. */
class BridgedWorker implements LocalCompileWorker {
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessageerror: ((event: any) => void) | null = null;
  private readonly scope: FakeScope;
  private readonly control: LocalCompileWorkerControl;

  constructor(session: ScriptedSession) {
    this.scope = createScope();
    this.control = startLocalCompileWorker(this.scope, {
      createSession: () => session as unknown as LocalCompileSession,
    });
    this.scope.postMessage = (message) => {
      this.onmessage?.({ data: message });
    };
  }

  postMessage(message: LocalCompileWorkerRequest): void {
    this.scope.onmessage!({ data: message });
  }

  terminate(): void {
    this.control.dispose();
  }
}

describe('scheduler after a cost fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adopts the complete result as the next baseline and keeps delivered results isolated', () => {
    const base = makeDocument('alpha', 60);
    const huge = makeDocument('omega', 60);
    const edited = makeDocument('omega', 60);
    const index = 10;
    edited.texts[index] = `OMEGA${edited.texts[index].slice(5)}`;
    edited.nodes[index].children![0].value = edited.texts[index];
    const editedSource = edited.texts.join('\n\n');

    const session = new ScriptedSession();
    session.script(base.source, deepFreeze(makeResult(base.source, base.nodes)));
    session.script(huge.source, deepFreeze(makeResult(huge.source, huge.nodes)));
    session.script(editedSource, deepFreeze(makeResult(editedSource, edited.nodes)));

    const worker = new BridgedWorker(session);
    const results: LocalCompileOutcome[] = [];
    const scheduler = new LocalCompileScheduler({
      createWorker: () => worker,
      onResult: (outcome) => results.push(outcome),
      delay: LOCAL_COMPILE_DELAY_MS,
    });

    try {
      scheduler.schedule(base.source);
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(results).toHaveLength(1);

      scheduler.schedule(huge.source);
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(results).toHaveLength(2);
      expect(results[1].source).toBe(huge.source);
      expect(results[1].metrics?.worker?.patchFallback).toBe('cost');

      // The scheduler delivers an independent graph by default; mutating it
      // must not reach the baseline the next patch is encoded against.
      const delivered = results[1].result;
      if (delivered.ok) delivered.document.nodes[0].children![0].value = 'tampered';

      scheduler.schedule(editedSource);
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(results).toHaveLength(3);
      expect(results[2].source).toBe(editedSource);
      expect(results[2].result.ok).toBe(true);
      if (results[2].result.ok) {
        expect(results[2].result.document.source).toBe(editedSource);
        const firstText = results[2].result.document.nodes[0].children?.[0] as LocalNode;
        expect(firstText.value).toBe(huge.texts[0]);
      }
      expect(session.compiled).toEqual([base.source, huge.source, editedSource]);
    } finally {
      scheduler.dispose();
    }
  });
});
