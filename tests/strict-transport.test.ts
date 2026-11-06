import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalCompileSession, type LocalCompileSession } from '../src/local/session/incremental';
import {
  applyLocalResultPatch,
  encodeLocalResultPatch,
  LOCAL_RESULT_PATCH_PROTOCOL,
  type LocalResultPatch,
} from '../src/local/transport/compile-patch';
import {
  decodeFlatCompiledData,
  encodeFlatCompiledData,
  FLAT_COMPILED_DATA_PROTOCOL,
  needsFlatCompileResult,
} from '../src/local/transport/flat-compiled-data';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  localWorkerOptionsKey,
  startLocalCompileWorker,
  type LocalCompileMode,
  type LocalCompileOutcome,
  type LocalCompileRequest,
  type LocalCompileResponse,
  type LocalCompileWorkerResponse,
  type LocalCompileWorkerScope,
} from '../src/local/transport/worker';
import type { LocalCompileOptions, LocalCompileResult, LocalNode, LocalRecovery } from '../src/local/contracts/types';
import {
  FakeWorker,
  fullRequest,
  negotiatedResponse,
  okResult,
  patchRequest,
} from './fixtures/compile-worker';

// The worker analysis path must see the same options snapshot as the compile.
const analyzeLocalSource = vi.hoisted(() => vi.fn((
  _source: string,
  _options?: LocalCompileOptions,
  _context?: unknown,
) => ({
  tokens: [],
  bindings: [],
  diagnostics: [],
})));
vi.mock('../src/local/source/authoring', () => ({ analyzeLocalSource }));

const RECOVERY: LocalRecovery = {
  code: 'local.recovery.test',
  causeRange: { start: 0, end: 2 },
  affectedRange: { start: 0, end: 4 },
  action: 'html-repair',
  boundary: 'fragment',
};

/** One structural repair: the unclosed <card> is literal until the next heading. */
const RECOVERED_SOURCE = '<card>\n正文\n\n## 后续\n\n后文 **粗体**';

function expectSingleRecovery(result: LocalCompileResult): LocalRecovery {
  if (!result.ok || !result.recoveries || result.recoveries.length !== 1) {
    throw new Error('expected exactly one recovery from the recovered source');
  }
  return result.recoveries[0];
}

/** The warning the parser adds for one recovery: same code and cause range. */
function warningsFor(result: LocalCompileResult, recovery: LocalRecovery) {
  return result.diagnostics.filter((diagnostic) => diagnostic.code === recovery.code
    && diagnostic.severity === 'warning'
    && diagnostic.range.start === recovery.causeRange.start
    && diagnostic.range.end === recovery.causeRange.end);
}

function node(id: string, source: string): LocalNode {
  return {
    type: 'paragraph',
    id,
    range: { start: 0, end: source.length },
    children: [{ type: 'text', id: `${id}-text`, range: { start: 0, end: source.length }, value: source }],
  };
}

function deepNode(id: string, source: string, depth = 101): LocalNode {
  let current: LocalNode = { type: 'text', id: `${id}-leaf`, range: { start: 0, end: source.length }, value: source };
  for (let index = 0; index < depth; index += 1) {
    current = { type: 'paragraph', id: `${id}-${index}`, range: { start: 0, end: source.length }, children: [current] };
  }
  return current;
}

function failedResult(recoveries?: LocalRecovery[]): LocalCompileResult {
  return {
    ok: false,
    diagnostics: [{
      code: 'local.test.failure',
      message: 'failed',
      severity: 'error',
      range: { start: 0, end: 0 },
      line: 1,
      column: 1,
    }],
    ...(recoveries === undefined ? {} : { recoveries }),
  };
}

/* ------------------------------------------------------------------ */
/* Result patches                                                     */
/* ------------------------------------------------------------------ */

describe('result patch recoveries', () => {
  it('adds, keeps, replaces and removes recovery records without baseline residue', () => {
    const plain = okResult('alpha', undefined, [node('p', 'alpha')]);
    const recovered = okResult('alpha', [RECOVERY], [node('p', 'alpha')]);

    const added = encodeLocalResultPatch(plain, recovered)!;
    expect(added.recoveries).toEqual([RECOVERY]);
    expect(applyLocalResultPatch(plain, added)).toEqual(recovered);

    const unchanged = encodeLocalResultPatch(recovered, okResult('alpha', [RECOVERY], [node('p', 'alpha')]))!;
    expect('recoveries' in unchanged).toBe(false);
    expect(applyLocalResultPatch(recovered, unchanged)).toEqual(recovered);

    const emptied = encodeLocalResultPatch(recovered, okResult('alpha', [], [node('p', 'alpha')]))!;
    expect(emptied.recoveries).toEqual([]);
    const keptEmpty = applyLocalResultPatch(recovered, emptied)!;
    expect(keptEmpty.recoveries).toEqual([]);

    const cleared = encodeLocalResultPatch(recovered, plain)!;
    expect(cleared.recoveries).toBeNull();
    const clearedResult = applyLocalResultPatch(recovered, cleared)!;
    expect('recoveries' in clearedResult).toBe(false);
  });

  it('keeps synthetic node provenance through a patch', () => {
    const base = okResult('x', undefined, [node('p', 'x')]);
    const synthetic: LocalNode = {
      type: 'htmlDocument',
      id: 'p',
      range: { start: 0, end: 1 },
      synthetic: true,
      syntheticBoundary: { start: 0, end: 1 },
    };
    const next = okResult('x', [RECOVERY], [synthetic]);
    const patch = encodeLocalResultPatch(base, next)!;
    expect(applyLocalResultPatch(base, patch)).toEqual(next);
  });

  it('rejects a malformed recoveries field before it can reach a baseline', () => {
    const patch = {
      kind: 'result-patch',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      document: {},
      recoveries: 'not-a-list',
    } as unknown as LocalResultPatch;
    expect(applyLocalResultPatch(okResult('x'), patch)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Flat frames                                                        */
/* ------------------------------------------------------------------ */

describe('flat full frames', () => {
  it('round trips recovery records and synthetic provenance', () => {
    const result = okResult('deep', [RECOVERY], [deepNode('root', 'deep')]);
    expect(needsFlatCompileResult(result)).toBe(true);
    const decoded = decodeFlatCompiledData(structuredClone(encodeFlatCompiledData(result)));
    expect(decoded).toEqual(result);
  });
});

/* ------------------------------------------------------------------ */
/* Incremental session                                                */
/* ------------------------------------------------------------------ */

describe('loose sessions', () => {
  it('uses the complete reference compile for every loose revision', () => {
    const session = createLocalCompileSession();
    const options: LocalCompileOptions = { strict: false };
    let source = 'first\n\nsecond **bold**';
    expect(session.compile(source, options)).toEqual(compileLocal(source, options));
    expect(session.stats).toMatchObject({ mode: 'full', fallbackReason: 'recovery-reference' });

    source = 'first\n\nsecond **bold** edited';
    expect(session.compile(source, options)).toEqual(compileLocal(source, options));
    expect(session.stats.mode).toBe('full');
    session.dispose();
  });

  it('does not answer a strict/loose switch from the other strategy', () => {
    const session = createLocalCompileSession();
    const source = 'alpha\n\nbeta\n\ngamma';
    expect(session.compile(source)).toEqual(compileLocal(source));

    const loose = session.compile(source, { strict: false });
    expect(session.stats.mode).toBe('full');
    expect(loose).toEqual(compileLocal(source, { strict: false }));

    const restored = session.compile(source, { strict: true });
    expect(session.stats.mode).toBe('full');
    expect(restored).toEqual(compileLocal(source, { strict: true }));
    session.dispose();
  });

  it('does not append an empty recoveries list to strict results or patches', () => {
    const session = createLocalCompileSession();
    const result = session.compile('alpha\n\nbeta');
    const fresh = compileLocal('alpha\n\nbeta');
    expect('recoveries' in result).toBe(false);
    expect('recoveries' in fresh).toBe(false);
    const patch = encodeLocalResultPatch(fresh, result)!;
    expect('recoveries' in patch).toBe(false);
    session.dispose();
  });
});

/* ------------------------------------------------------------------ */
/* Worker frames                                                      */
/* ------------------------------------------------------------------ */

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

function requestEvent(data: unknown): MessageEvent<LocalCompileRequest> {
  return { data } as unknown as MessageEvent<LocalCompileRequest>;
}

function fakeSession(
  compile: (source: string, options?: LocalCompileOptions) => LocalCompileResult,
): LocalCompileSession {
  return {
    compile,
    compileShared: compile,
    stats: { mode: 'full', totalBlocks: 0, compiledBlocks: 0, reusedBlocks: 0, compiledCharacters: 0 },
    clear() {},
    dispose() {},
    get hasPendingPreparation() { return false; },
    prepare() { return false; },
  } as unknown as LocalCompileSession;
}

function fullResponse(scope: FakeScope, index: number): Extract<LocalCompileResponse, { ok: true }> {
  const response = scope.responses[index];
  if (!response.ok || !('result' in response)) throw new Error('expected a complete result frame');
  return response;
}

describe('worker strict transport', () => {
  it('gives the compile and authoring analysis the same options snapshot', () => {
    analyzeLocalSource.mockClear();
    const seen: (LocalCompileOptions | undefined)[] = [];
    const scope = createScope();
    startLocalCompileWorker(scope, {
      createSession: () => fakeSession((source, options) => {
        seen.push(options);
        return okResult(source);
      }),
    });

    scope.onmessage!(requestEvent({
      id: 1,
      source: 'alpha',
      options: { strict: false },
      includeAuthorAnalysis: true,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: 1,
    }));

    expect(fullResponse(scope, 0).result).toEqual(okResult('alpha'));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ strict: false });
    expect(analyzeLocalSource).toHaveBeenCalledTimes(1);
    expect(analyzeLocalSource.mock.calls[0][1]).toBe(seen[0]);
  });

  it('forwards an invalid strict value to the compiler for validation', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    scope.onmessage!(requestEvent({
      id: 1,
      source: 'alpha',
      options: { strict: 'yes' } as unknown as LocalCompileOptions,
    }));
    const response = fullResponse(scope, 0);
    expect(response.result.ok).toBe(false);
    expect(response.result.diagnostics).toEqual([
      expect.objectContaining({ messageKey: 'local.options.invalid.strict' }),
    ]);
    expect('recoveries' in response.result).toBe(false);
  });

  it('keeps recoveries in a complete frame, including a failed revision', () => {
    const scope = createScope();
    const failure = failedResult([RECOVERY]);
    startLocalCompileWorker(scope, { createSession: () => fakeSession(() => failure) });
    scope.onmessage!(requestEvent({ id: 1, source: 'broken', protocol: LOCAL_RESULT_PATCH_PROTOCOL, revision: 1 }));
    expect(fullResponse(scope, 0).result).toEqual(failure);
  });

  it('carries recovery removal through a result patch', () => {
    const baseSource = '<alert>open';
    const fixedSource = '<alert>open</alert>';
    const base = okResult(baseSource, [RECOVERY], [node('p', baseSource)]);
    const fixed = okResult(fixedSource, undefined, [node('p', fixedSource)]);
    const scope = createScope();
    startLocalCompileWorker(scope, {
      createSession: () => fakeSession((source) => source === fixedSource ? fixed : base),
    });

    scope.onmessage!(requestEvent({ id: 1, source: baseSource, protocol: LOCAL_RESULT_PATCH_PROTOCOL, revision: 1 }));
    const first = fullResponse(scope, 0).result;
    expect(first).toEqual(base);

    scope.onmessage!(requestEvent({
      id: 2,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 1,
      revision: 2,
      edit: { from: baseSource.length, to: baseSource.length, insert: '</alert>' },
      targetLength: fixedSource.length,
    }));
    const patchResponse = scope.responses[1];
    expect(patchResponse.ok && 'patch' in patchResponse).toBe(true);
    if (!patchResponse.ok || !('patch' in patchResponse)) return;
    expect(patchResponse.patch.recoveries).toBeNull();
    expect(applyLocalResultPatch(first, patchResponse.patch)).toEqual(fixed);
  });

  it('adds recovery records back when a later patch reintroduces damage', () => {
    const baseSource = 'alpha';
    const damagedSource = 'alpha<alert>';
    const base = okResult(baseSource, undefined, [node('p', baseSource)]);
    const damaged = okResult(damagedSource, [RECOVERY], [node('p', damagedSource)]);
    const scope = createScope();
    startLocalCompileWorker(scope, {
      createSession: () => fakeSession((source) => source === damagedSource ? damaged : base),
    });

    scope.onmessage!(requestEvent({ id: 1, source: baseSource, protocol: LOCAL_RESULT_PATCH_PROTOCOL, revision: 1 }));
    const first = fullResponse(scope, 0).result;
    scope.onmessage!(requestEvent({
      id: 2,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 1,
      revision: 2,
      edit: { from: baseSource.length, to: baseSource.length, insert: '<alert>' },
      targetLength: damagedSource.length,
    }));
    const patchResponse = scope.responses[1];
    expect(patchResponse.ok && 'patch' in patchResponse).toBe(true);
    if (!patchResponse.ok || !('patch' in patchResponse)) return;
    expect(patchResponse.patch.recoveries).toEqual([RECOVERY]);
    expect(applyLocalResultPatch(first, patchResponse.patch)).toEqual(damaged);
  });

  it('keeps recoveries in a flat full frame', () => {
    const source = 'deep';
    const result = okResult(source, [RECOVERY], [deepNode('root', source)]);
    const scope = createScope();
    startLocalCompileWorker(scope, { createSession: () => fakeSession(() => result) });
    scope.onmessage!(requestEvent({
      id: 1,
      source,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: 1,
      flatResults: FLAT_COMPILED_DATA_PROTOCOL,
    }));
    const response = scope.responses[0];
    expect(response.ok && 'flatResult' in response).toBe(true);
    if (!response.ok || !('flatResult' in response)) return;
    expect(decodeFlatCompiledData(structuredClone(response.flatResult))).toEqual(result);
  });
});

/* ------------------------------------------------------------------ */
/* Recovered warnings                                                 */
/* ------------------------------------------------------------------ */

describe('recovered warning transport', () => {
  const options: LocalCompileOptions = { strict: false };

  it('carries recovered warnings through the complete compile session', () => {
    const reference = compileLocal(RECOVERED_SOURCE, options);
    expect(reference.ok).toBe(true);
    const recovery = expectSingleRecovery(reference);
    const warnings = warningsFor(reference, recovery);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: recovery.code,
      severity: 'warning',
      range: recovery.causeRange,
    });
    expect(reference.diagnostics.some((item) => item.severity === 'error')).toBe(false);

    const session = createLocalCompileSession();
    try {
      expect(session.compile(RECOVERED_SOURCE, options)).toEqual(reference);
    } finally {
      session.dispose();
    }
  });

  it('returns recovered warnings unchanged in a full worker frame', () => {
    const reference = compileLocal(RECOVERED_SOURCE, options);
    expect(reference.ok).toBe(true);
    const scope = createScope();
    const control = startLocalCompileWorker(scope);
    try {
      scope.onmessage!(requestEvent({
        id: 1,
        source: RECOVERED_SOURCE,
        options: { strict: false },
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        revision: 1,
      }));
      const response = fullResponse(scope, 0);
      expect(response.result.ok).toBe(true);
      expect(response.result.diagnostics).toEqual(reference.diagnostics);
      expect(response.result.recoveries).toEqual(reference.recoveries);
    } finally {
      control.dispose();
    }
  });

  it('carries recovered warnings through a result patch', () => {
    const base = compileLocal('alpha', options);
    const next = compileLocal(RECOVERED_SOURCE, options);
    expect(base.ok).toBe(true);
    expect(next.ok).toBe(true);
    const recovery = expectSingleRecovery(next);
    expect(warningsFor(next, recovery)).toHaveLength(1);

    const patch = encodeLocalResultPatch(base, next)!;
    expect(patch.diagnostics).toEqual(next.diagnostics);
    const applied = applyLocalResultPatch(base, patch)!;
    expect(applied.ok).toBe(true);
    expect(applied.recoveries).toEqual(next.recoveries);
    expect(applied.diagnostics).toEqual(next.diagnostics);
    expect(applied).toEqual(next);
  });

  it('round trips recovered warnings in a flat frame', () => {
    const compiled = compileLocal(RECOVERED_SOURCE, options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error('expected recovered source to compile');
    expectSingleRecovery(compiled);
    const deep: LocalCompileResult = {
      ...compiled,
      document: { ...compiled.document, nodes: [deepNode('recovered-root', RECOVERED_SOURCE)] },
    };
    expect(needsFlatCompileResult(deep)).toBe(true);
    const decoded = decodeFlatCompiledData(structuredClone(encodeFlatCompiledData(deep))) as LocalCompileResult;
    expect(decoded).toEqual(deep);
    expect(decoded.diagnostics).toEqual(compiled.diagnostics);
    expect(decoded.recoveries).toEqual(compiled.recoveries);
  });

  it('keeps strict as the default and still fails the same source', () => {
    const strict = compileLocal(RECOVERED_SOURCE);
    expect(strict.ok).toBe(false);
    expect('recoveries' in strict).toBe(false);
    expect(strict.diagnostics.some((item) => item.severity === 'error')).toBe(true);

    expect(compileLocal(RECOVERED_SOURCE, options).ok).toBe(true);
  });

  it('keeps semantic errors failed in loose mode', () => {
    const failed = compileLocal('<counter bind="1bad" label="Count" initial="1">', options);
    expect(failed.ok).toBe(false);
    expect(failed.diagnostics.some((item) => item.severity === 'error')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Scheduler transport                                                */
/* ------------------------------------------------------------------ */

function setup() {
  const worker = new FakeWorker();
  const results: LocalCompileOutcome[] = [];
  const modes: { mode: LocalCompileMode; detail?: string }[] = [];
  const fallbackCompile = vi.fn((source: string, _options?: LocalCompileOptions) => okResult(source));
  const scheduler = new LocalCompileScheduler({
    createWorker: () => worker,
    fallbackCompile,
    onResult: (outcome) => results.push(outcome),
    onModeChange: (mode, detail) => modes.push({ mode, detail }),
    delay: LOCAL_COMPILE_DELAY_MS,
  });
  return { worker, results, modes, fallbackCompile, scheduler };
}

describe('scheduler strict transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('snapshots the raw strict value and keeps loose identity separate', () => {
    const { worker, scheduler } = setup();
    const options: LocalCompileOptions = { strict: false };
    scheduler.schedule('alpha', options);
    (options as { strict?: boolean }).strict = true;
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);

    expect(fullRequest(worker.requests[0]).options).toEqual({ strict: false });
    const strictIdentity = localWorkerOptionsKey({});
    expect(localWorkerOptionsKey({ strict: true })).toBe(strictIdentity);
    expect(localWorkerOptionsKey({ strict: undefined })).toBe(strictIdentity);
    expect(localWorkerOptionsKey({ strict: false })).not.toBe(strictIdentity);
    scheduler.dispose();
  });

  it('forwards an invalid strict value unchanged', () => {
    const { worker, scheduler } = setup();
    scheduler.schedule('alpha', { strict: 'yes' } as unknown as LocalCompileOptions);
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(fullRequest(worker.requests[0]).options).toEqual({ strict: 'yes' });
    scheduler.dispose();
  });

  it('switches modes with a complete frame and carries recoveries through later patches', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('base');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    const base = okResult('base', [RECOVERY], [node('p', 'base')]);
    worker.receive(negotiatedResponse(first, base));
    expect(results[0].result.recoveries).toEqual([RECOVERY]);

    scheduler.schedule('base!', { strict: false });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const second = fullRequest(worker.requests[1]);
    expect(second.options).toEqual({ strict: false });
    const fixed = okResult('base!', undefined, [node('p', 'base!')]);
    worker.receive(negotiatedResponse(second, fixed));
    expect('recoveries' in results[1].result).toBe(false);

    scheduler.schedule('base!!', { strict: false });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const third = patchRequest(worker.requests[2]);
    expect(third.optionsKey).toBe(localWorkerOptionsKey({ strict: false }));
    const repaired = okResult('base!!', [RECOVERY], [node('p', 'base!!')]);
    const patch = encodeLocalResultPatch(fixed, repaired)!;
    worker.receive({
      id: third.id,
      ok: true,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: third.baseRevision,
      revision: third.revision,
      patch,
      duration: 1,
    });
    expect(results[2].result.recoveries).toEqual([RECOVERY]);
    expect(results[2].result).toEqual(repaired);
    scheduler.dispose();
  });

  it('delivers a failed revision with its recoveries instead of the old success', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('good');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    worker.receive(negotiatedResponse(first, okResult('good', [RECOVERY], [node('p', 'good')])));

    scheduler.schedule('bad');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const second = patchRequest(worker.requests[1]);
    const failure = failedResult([RECOVERY]);
    worker.receive({
      id: second.id,
      ok: true,
      result: failure,
      duration: 1,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: second.revision,
    });
    expect(results[1].result).toEqual(failure);

    scheduler.schedule('next');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(fullRequest(worker.requests[2]).source).toBe('next');
    scheduler.dispose();
  });

  it('discards an in-flight strict result when the next job is loose', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('same');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);

    scheduler.schedule('same', { strict: false });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    worker.receive(negotiatedResponse(first, okResult('same', [RECOVERY])));

    expect(results).toHaveLength(0);
    expect(worker.requests).toHaveLength(2);
    expect(fullRequest(worker.requests[1]).options).toEqual({ strict: false });
    scheduler.dispose();
  });

  it('passes the same snapshot to a fallback compile', () => {
    const { worker, results, fallbackCompile, scheduler } = setup();
    scheduler.schedule('running', { strict: false });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    worker.fail('worker crashed');

    expect(fallbackCompile).toHaveBeenCalledWith('running', { strict: false });
    expect(results[0].options).toBe(fallbackCompile.mock.calls[0][1]);
    expect(results[0].options).toEqual({ strict: false });
    scheduler.dispose();
  });
});
