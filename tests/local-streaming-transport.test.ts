import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySourceEdit,
  LOCAL_RESULT_PATCH_PROTOCOL,
} from '../src/local/transport/compile-patch';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalCompileSession } from '../src/local/compilation/session/incremental';
import type { LocalCompileOptions, LocalCompileResult, LocalSourcePhase } from '../src/local/types';
import {
  FakeWorker,
  fullRequest,
  okResult,
  patchRequest,
} from './fixtures/compile-worker';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  startLocalCompileWorker,
  type LocalCompileMode,
  type LocalCompileOutcome,
  type LocalCompileRequest,
  type LocalCompileResponse,
  type LocalCompileWorker,
  type LocalCompileWorkerControl,
  type LocalCompileWorkerRequest,
  type LocalCompileWorkerResponse,
  type LocalCompileWorkerScope,
} from '../src/local/transport/worker';

function statusResult(source: string, status: 'partial' | 'valid'): LocalCompileResult {
  const base = okResult(source);
  if (!base.ok) throw new Error('fixture sources must compile');
  return status === 'partial'
    ? { ...base, status: 'partial', transientDiagnostics: [] }
    : { ...base, status };
}

/** A negotiated full response that echoes the phase like the real worker. */
function phasedResponse(
  request: LocalCompileRequest,
  result: LocalCompileResult,
  sourcePhase: LocalSourcePhase,
): LocalCompileWorkerResponse {
  return {
    id: request.id,
    ok: true,
    result,
    duration: 1,
    protocol: LOCAL_RESULT_PATCH_PROTOCOL,
    revision: request.revision ?? 1,
    sourcePhase,
  };
}

function setup(options: { delay?: number; createWorker?: () => LocalCompileWorker } = {}) {
  const worker = new FakeWorker();
  const results: LocalCompileOutcome[] = [];
  const pending: boolean[] = [];
  const modes: { mode: LocalCompileMode; detail?: string }[] = [];
  const scheduler = new LocalCompileScheduler({
    createWorker: options.createWorker ?? (() => worker),
    fallbackCompile: (source: string): LocalCompileResult => okResult(source),
    onResult: (outcome) => results.push(outcome),
    onPendingChange: (value) => pending.push(value),
    onModeChange: (mode, detail) => modes.push({ mode, detail }),
    delay: options.delay,
  });
  return { worker, results, pending, modes, scheduler };
}

describe('LocalCompileSession source phases', () => {
  it('keeps the historical result shape when no phase is requested', () => {
    const session = createLocalCompileSession();
    try {
      const result = session.compile('# Title\n\nbody **bold**');
      expect(result).toEqual(compileLocal('# Title\n\nbody **bold**'));
      expect(Object.hasOwn(result, 'status')).toBe(false);
      expect(Object.hasOwn(result, 'transientDiagnostics')).toBe(false);
      expect(session.stats.mode).not.toBe('streaming');
    } finally {
      session.dispose();
    }
  });

  it('resolves an explicit final phase to valid, recovered or failed', () => {
    const session = createLocalCompileSession();
    try {
      const valid = session.compile('# Title\n\nbody', undefined, 'final');
      expect(valid.ok).toBe(true);
      expect(valid.status).toBe('valid');
      expect(Object.hasOwn(valid, 'transientDiagnostics')).toBe(false);

      // Loose-mode recovery keeps its records and is reported as recovered.
      const looseSource = '<card>\n正文\n\n## 后续\n\n后文 **粗体**';
      const recovered = session.compile(looseSource, { strict: false }, 'final');
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) return;
      expect(recovered.status).toBe('recovered');
      expect(recovered.recoveries).toHaveLength(1);

      const failed = session.compile('hello', { limits: { maxSyntaxNodes: 1 } }, 'final');
      expect(failed.ok).toBe(false);
      expect(failed.status).toBe('failed');
    } finally {
      session.dispose();
    }
  });

  it('honors options.sourcePhase when no phase argument is given', () => {
    const session = createLocalCompileSession();
    try {
      const final = session.compileShared('hello', { sourcePhase: 'final' });
      expect(final.ok && final.status).toBe('valid');
      const streaming = session.compileShared('hello', { sourcePhase: 'streaming' });
      expect(streaming.ok && streaming.status).toBe('partial');
      expect(Object.hasOwn(streaming, 'transientDiagnostics')).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it('does not let the streaming cache skip option validation', () => {
    const session = createLocalCompileSession();
    try {
      const cached = session.compileShared('hello', undefined, 'streaming');
      expect(cached.ok).toBe(true);
      const invalid = session.compileShared(
        'hello',
        { sourcePhase: 'later' } as unknown as LocalCompileOptions,
        'streaming',
      );
      expect(invalid.ok).toBe(false);
      expect(invalid.status).toBe('failed');
      expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['local.options.invalid']);
    } finally {
      session.dispose();
    }
  });

  it('returns a streaming snapshot as partial and caches an identical snapshot', () => {
    const session = createLocalCompileSession();
    try {
      const source = 'Current total: {{ total }}';
      const first = session.compileShared(source, undefined, 'streaming');
      expect(first.ok).toBe(true);
      expect(first.status).toBe('partial');
      expect(Array.isArray(first.transientDiagnostics)).toBe(true);
      expect(session.stats.mode).toBe('streaming');
      expect(session.stats.compiledCharacters).toBe(source.length);

      const second = session.compileShared(source, undefined, 'streaming');
      expect(second).toBe(first);
      expect(session.stats.mode).toBe('streaming');
      expect(session.stats.compiledCharacters).toBe(0);

      // The public result is a plain copy, never the cached object.
      const published = session.compile(source, undefined, 'streaming');
      expect(published).not.toBe(first);
      expect(published).toEqual(first);
    } finally {
      session.dispose();
    }
  });

  it('never lets a streaming snapshot change the final incremental path', () => {
    const session = createLocalCompileSession();
    try {
      const source = 'first **paragraph**\n\nsecond\n\nlast';
      const initial = session.compile(source, undefined, 'final');
      expect(initial.ok && initial.status).toBe('valid');

      const grown = `${source} plus`;
      const streamed = session.compile(grown, undefined, 'streaming');
      expect(streamed.status).toBe('partial');

      // The final cache still holds the pre-streaming snapshot: this edit is
      // incremental, not a partial or full fallback result.
      const final = session.compile(grown, undefined, 'final');
      expect(final.status).toBe('valid');
      expect(final.ok).toBe(true);
      if (final.ok) expect(final.document.source).toBe(grown);
      expect(session.stats.mode).toBe('incremental');

      // A phase-less call after streaming still returns the historical shape.
      const legacy = session.compile(grown);
      expect(Object.hasOwn(legacy, 'status')).toBe(false);
      expect(Object.hasOwn(legacy, 'transientDiagnostics')).toBe(false);
      expect(legacy.ok).toBe(true);
      if (legacy.ok) expect(legacy.document.source).toBe(grown);
    } finally {
      session.dispose();
    }
  });
});

describe('LocalCompileScheduler source phases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a streaming snapshot after the debounce and echoes the phase', () => {
    const { worker, results, scheduler } = setup();
    try {
      scheduler.schedule('stream', undefined, undefined, 'streaming');
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS - 1);
      expect(worker.messages).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(worker.messages).toHaveLength(1);
      const request = fullRequest(worker.requests[0]);
      expect(request.sourcePhase).toBe('streaming');

      worker.receive(phasedResponse(request, statusResult('stream', 'partial'), 'streaming'));
      expect(results).toHaveLength(1);
      expect(results[0].sourcePhase).toBe('streaming');
      expect(results[0].result.status).toBe('partial');
      expect(Array.isArray(results[0].result.transientDiagnostics)).toBe(true);
    } finally {
      scheduler.dispose();
    }
  });

  it('dispatches an explicitly final snapshot without waiting for the debounce', () => {
    const { worker, results, scheduler } = setup();
    try {
      scheduler.schedule('half', undefined, undefined, 'streaming');
      scheduler.schedule('half done', undefined, undefined, 'final');
      // The queued intermediate snapshot is replaced and the final request is
      // already dispatched.
      expect(worker.messages).toHaveLength(1);
      expect(worker.messages[0].source).toBe('half done');
      expect(worker.messages[0].sourcePhase).toBe('final');

      worker.receive(phasedResponse(fullRequest(worker.requests[0]), statusResult('half done', 'valid'), 'final'));
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('half done');
      expect(results[0].sourcePhase).toBe('final');
    } finally {
      scheduler.dispose();
    }
  });

  it('reports a failed status for explicit-phase transport failures', () => {
    const { worker, results, scheduler } = setup();
    try {
      scheduler.schedule('snap', undefined, undefined, 'streaming');
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      const request = fullRequest(worker.requests[0]);
      worker.receive({ id: request.id, ok: false, message: 'worker failed' });
      expect(results).toHaveLength(1);
      expect(results[0].sourcePhase).toBe('streaming');
      expect(results[0].result.ok).toBe(false);
      expect(results[0].result.status).toBe('failed');
    } finally {
      scheduler.dispose();
    }
  });

  it('ignores a late streaming response after a final snapshot was scheduled', () => {
    const { worker, results, scheduler } = setup();
    try {
      scheduler.schedule('snap', undefined, undefined, 'streaming');
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(worker.messages).toHaveLength(1);
      const streaming = worker.messages[0];

      scheduler.schedule('snap final', undefined, undefined, 'final');
      // The final job waits for the in-flight compile only.
      expect(worker.messages).toHaveLength(1);
      expect(results).toHaveLength(0);

      worker.receive(phasedResponse(streaming, statusResult('snap', 'partial'), 'streaming'));
      expect(results).toHaveLength(0);
      expect(worker.messages).toHaveLength(2);
      expect(worker.messages[1].source).toBe('snap final');
      expect(worker.messages[1].sourcePhase).toBe('final');

      worker.receive(phasedResponse(fullRequest(worker.requests[1]), statusResult('snap final', 'valid'), 'final'));
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('snap final');
      expect(results[0].sourcePhase).toBe('final');
    } finally {
      scheduler.dispose();
    }
  });

  it('never builds a patch baseline from a streaming result', () => {
    const { worker, results, scheduler } = setup();
    try {
      scheduler.schedule('base', undefined, undefined, 'final');
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      const first = fullRequest(worker.requests[0]);
      expect(first.sourcePhase).toBe('final');
      worker.receive(phasedResponse(first, okResult('base'), 'final'));

      // A streaming snapshot is always a complete request, even though a final
      // baseline exists, and its negotiated-looking echo is ignored.
      scheduler.schedule('base plus', undefined, undefined, 'streaming');
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(worker.requests).toHaveLength(2);
      const streamed = fullRequest(worker.requests[1]);
      expect(streamed.sourcePhase).toBe('streaming');
      worker.receive(phasedResponse(streamed, statusResult('base plus', 'partial'), 'streaming'));

      // The next final must be complete: the streaming revision is not a base.
      scheduler.schedule('base plus done', undefined, undefined, 'final');
      expect(worker.requests).toHaveLength(3);
      const complete = fullRequest(worker.requests[2]);
      expect(complete.sourcePhase).toBe('final');
      expect(complete.source).toBe('base plus done');
      worker.receive(phasedResponse(complete, okResult('base plus done'), 'final'));
      // The intermediate snapshot is delivered, but it never became a base.
      expect(results.map((outcome) => outcome.source)).toEqual(['base', 'base plus', 'base plus done']);

      // final -> final is the only path that may use patch-v1.
      scheduler.schedule('base plus done!', undefined, undefined, 'final');
      expect(worker.requests).toHaveLength(4);
      const patched = patchRequest(worker.requests[3]);
      expect(patched.baseRevision).toBe(complete.revision);
      expect(applySourceEdit('base plus done', patched.edit)).toBe('base plus done!');
    } finally {
      scheduler.dispose();
    }
  });

  it('keeps the legacy wire and outcome shape for phase-less schedules', () => {
    const { worker, results, scheduler } = setup();
    try {
      scheduler.schedule('legacy source');
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS - 1);
      expect(worker.messages).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(worker.messages).toHaveLength(1);
      const request = fullRequest(worker.requests[0]);
      expect('sourcePhase' in request).toBe(false);

      worker.receive({ id: request.id, ok: true, result: okResult('legacy source'), duration: 1 });
      expect(results).toHaveLength(1);
      expect('sourcePhase' in results[0]).toBe(false);
      expect(Object.hasOwn(results[0].result, 'status')).toBe(false);
    } finally {
      scheduler.dispose();
    }
  });

  it('supports streaming and final snapshots in fallback mode', () => {
    const results: LocalCompileOutcome[] = [];
    const scheduler = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error('no workers here');
      },
      onResult: (outcome) => results.push(outcome),
    });
    try {
      scheduler.schedule('Fallback text', undefined, undefined, 'streaming');
      expect(results).toHaveLength(0);
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(results).toHaveLength(1);
      expect(results[0].mode).toBe('fallback');
      expect(results[0].sourcePhase).toBe('streaming');
      expect(results[0].result.status).toBe('partial');

      // Final work bypasses the debounce and keeps the explicit phase.
      scheduler.schedule('Fallback text', undefined, undefined, 'final');
      expect(results).toHaveLength(2);
      expect(results[1].sourcePhase).toBe('final');
      expect(results[1].result.status).toBe('valid');

      // A phase-less call keeps the debounce and the legacy result shape.
      scheduler.schedule('Fallback text');
      expect(results).toHaveLength(2);
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(results).toHaveLength(3);
      expect('sourcePhase' in results[2]).toBe(false);
      expect(Object.hasOwn(results[2].result, 'status')).toBe(false);
    } finally {
      scheduler.dispose();
    }
  });

  it('passes the declared phase to a custom fallback compile', () => {
    const results: LocalCompileOutcome[] = [];
    const fallbackCompile = vi.fn((source: string): LocalCompileResult => okResult(source));
    const scheduler = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error('no workers here');
      },
      fallbackCompile,
      onResult: (outcome) => results.push(outcome),
    });
    try {
      scheduler.schedule('custom', undefined, undefined, 'streaming');
      vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
      expect(fallbackCompile).toHaveBeenCalledWith('custom', undefined, 'streaming');
      expect(results[0].sourcePhase).toBe('streaming');
    } finally {
      scheduler.dispose();
    }
  });
});

interface FakeScope extends LocalCompileWorkerScope {
  messages: LocalCompileResponse[];
  responses: LocalCompileWorkerResponse[];
}

function createScope(): FakeScope {
  const scope: FakeScope = {
    onmessage: null,
    messages: [],
    responses: [],
    postMessage(message: LocalCompileWorkerResponse): void {
      scope.responses.push(message);
      if ('result' in message) scope.messages.push(message);
    },
  };
  return scope;
}

function requestEvent(data: unknown): MessageEvent<LocalCompileRequest> {
  return { data } as unknown as MessageEvent<LocalCompileRequest>;
}

describe('startLocalCompileWorker source phases', () => {
  it('compiles a streaming snapshot to a partial result that echoes the phase', () => {
    const scope = createScope();
    const control = startLocalCompileWorker(scope);
    try {
      scope.onmessage!(requestEvent({ id: 1, source: 'body **bold**', sourcePhase: 'streaming' }));
      expect(scope.messages).toHaveLength(1);
      const response = scope.messages[0];
      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.sourcePhase).toBe('streaming');
      expect(response.result.status).toBe('partial');
      expect(Array.isArray(response.result.transientDiagnostics)).toBe(true);
      expect(response.incremental?.mode).toBe('streaming');
    } finally {
      control.dispose();
    }
  });

  it('rejects a patch request while the current state is a streaming snapshot', () => {
    const scope = createScope();
    const control = startLocalCompileWorker(scope);
    try {
      scope.onmessage!(requestEvent({
        id: 1,
        source: 'stream',
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        revision: 1,
        sourcePhase: 'streaming',
      }));
      const full = scope.responses[0];
      expect(full.ok).toBe(true);

      scope.onmessage!(requestEvent({
        id: 2,
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        baseRevision: 1,
        revision: 2,
        edit: { from: 0, to: 0, insert: 'x' },
        targetLength: 'xstream'.length,
      }));
      const rejected = scope.responses[1];
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.retryFull).toBe(true);
        expect(rejected.code).toBe('phase-mismatch');
      }

      // A complete final request re-establishes a patchable baseline.
      scope.onmessage!(requestEvent({
        id: 3,
        source: 'stream plus',
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        revision: 3,
        sourcePhase: 'final',
      }));
      const final = scope.messages.at(-1);
      expect(final?.ok).toBe(true);
      if (!final || !final.ok) return;
      expect(final.sourcePhase).toBe('final');
      expect(final.result.status).toBe('valid');

      scope.onmessage!(requestEvent({
        id: 4,
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        baseRevision: 3,
        revision: 4,
        edit: { from: 0, to: 0, insert: '#' },
        targetLength: '#stream plus'.length,
      }));
      const patched = scope.responses.at(-1);
      expect(patched?.ok).toBe(true);
      if (!patched || !patched.ok) return;
      expect('patch' in patched).toBe(true);
      if ('patch' in patched) {
        expect(patched.sourcePhase).toBe('final');
        expect(patched.revision).toBe(4);
      }
    } finally {
      control.dispose();
    }
  });

  it('rejects an unsupported source phase without throwing or touching the session', () => {
    const scope = createScope();
    const control = startLocalCompileWorker(scope);
    try {
      expect(() => scope.onmessage!(requestEvent({ id: 1, source: 'phase', sourcePhase: 'later' })))
        .not.toThrow();
      expect(scope.messages).toHaveLength(0);
      const response = scope.responses[0];
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.message).toContain('source phase');

      // The rejected request left no state behind.
      scope.onmessage!(requestEvent({ id: 2, source: 'phase' }));
      const valid = scope.messages[0];
      expect(valid.ok).toBe(true);
      if (valid.ok) expect('sourcePhase' in valid).toBe(false);
    } finally {
      control.dispose();
    }
  });

  it('honors sourcePhase placed on compile options', () => {
    const scope = createScope();
    const control = startLocalCompileWorker(scope);
    try {
      scope.onmessage!(requestEvent({
        id: 1,
        source: 'body **bold**',
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        revision: 1,
        options: { sourcePhase: 'streaming' },
      }));
      const response = scope.messages[0];
      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.sourcePhase).toBe('streaming');
      expect(response.result.status).toBe('partial');

      // The options-declared phase moves the same state as the request field.
      scope.onmessage!(requestEvent({
        id: 2,
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        baseRevision: 1,
        revision: 2,
        edit: { from: 0, to: 0, insert: '#' },
        targetLength: '#body **bold**'.length,
      }));
      const rejected = scope.responses.at(-1);
      expect(rejected?.ok).toBe(false);
      if (rejected && !rejected.ok) expect(rejected.code).toBe('phase-mismatch');
    } finally {
      control.dispose();
    }
  });

  it('rejects an unsupported phase on compile options without touching state', () => {
    const scope = createScope();
    const control = startLocalCompileWorker(scope);
    try {
      scope.onmessage!(requestEvent({ id: 1, source: 'phase', options: { sourcePhase: 'later' } }));
      expect(scope.messages).toHaveLength(0);
      const response = scope.responses[0];
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.message).toContain('source phase');

      scope.onmessage!(requestEvent({ id: 2, source: 'phase' }));
      const valid = scope.messages[0];
      expect(valid.ok).toBe(true);
      if (valid.ok) expect('sourcePhase' in valid).toBe(false);
    } finally {
      control.dispose();
    }
  });
});

/** Wires the scheduler directly to the real worker-side handler. */
class BridgedWorker implements LocalCompileWorker {
  onmessage: ((event: MessageEvent<LocalCompileResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  private readonly scope: FakeScope;
  private readonly control: LocalCompileWorkerControl;

  constructor() {
    this.scope = createScope();
    this.control = startLocalCompileWorker(this.scope);
    this.scope.postMessage = (message) => {
      this.onmessage?.({ data: message } as unknown as MessageEvent<LocalCompileResponse>);
    };
  }

  postMessage(message: LocalCompileWorkerRequest): void {
    this.scope.onmessage!({ data: message });
  }

  terminate(): void {
    this.control.dispose();
  }
}

describe('scheduler and worker source phases end-to-end', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams with the requested phase and completes with a status-bearing final result', () => {
    const worker = new BridgedWorker();
    const results: LocalCompileOutcome[] = [];
    const scheduler = new LocalCompileScheduler({
      createWorker: () => worker,
      onResult: (outcome) => results.push(outcome),
      delay: 10,
    });
    try {
      const source = '# Title\n\nBody **text**';
      scheduler.schedule(source, undefined, undefined, 'streaming');
      vi.advanceTimersByTime(10);
      expect(results).toHaveLength(1);
      expect(results[0].sourcePhase).toBe('streaming');
      expect(results[0].result.ok).toBe(true);
      if (results[0].result.ok) {
        expect(results[0].result.status).toBe('partial');
        expect(Array.isArray(results[0].result.transientDiagnostics)).toBe(true);
      }

      scheduler.schedule(source, undefined, undefined, 'final');
      expect(results).toHaveLength(2);
      expect(results[1].sourcePhase).toBe('final');
      expect(results[1].result.ok).toBe(true);
      if (results[1].result.ok) expect(results[1].result.status).toBe('valid');

      // Legacy calls on the same worker keep the historical shape.
      scheduler.schedule(source);
      vi.advanceTimersByTime(10);
      expect(results).toHaveLength(3);
      expect('sourcePhase' in results[2]).toBe(false);
      expect(Object.hasOwn(results[2].result, 'status')).toBe(false);
    } finally {
      scheduler.dispose();
    }
  });
});