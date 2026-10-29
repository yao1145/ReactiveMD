import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLocalResultPatch,
  applySourceEdit,
  diffSourceEdit,
  encodeLocalResultPatch,
  LOCAL_RESULT_PATCH_PROTOCOL,
} from '../src/local/compile-patch';
import type { LocalCompileResult, LocalNode,LocalCompileOptions } from '../src/local/types';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  startLocalCompileWorker,
  type LocalCompileMode,
  type LocalCompileOutcome,
  type LocalCompilePatchRequest,
  type LocalCompilePatchResponse,
  type LocalCompileRequest,
  type LocalCompileResponse,
  type LocalCompileWorker,
  type LocalCompileWorkerControl,
  type LocalCompileWorkerRequest,
  type LocalCompileWorkerResponse,
  type LocalCompileWorkerScope,
} from '../src/local/worker';

function okResult(source: string): LocalCompileResult {
  return {
    ok: true,
    document: {
      syntax: 'local',
      source,
      nodes: [],
      initialState: {},
      bindings: {},
    },
    diagnostics: [],
  };
}

function nodeResult(source: string, value: string): LocalCompileResult {
  const text: LocalNode = {
    type: 'text',
    id: 'p-text',
    range: { start: 0, end: source.length },
    value,
  };
  return {
    ok: true,
    document: {
      syntax: 'local',
      source,
      nodes: [{ type: 'paragraph', id: 'p', range: { start: 0, end: source.length }, children: [text] }],
      initialState: {},
      bindings: {},
    },
    diagnostics: [],
  };
}

class FakeWorker implements LocalCompileWorker {
  onmessage: ((event: MessageEvent<LocalCompileResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  /** Every post, including incremental requests without a source. */
  readonly requests: LocalCompileWorkerRequest[] = [];
  /** Complete-source requests, for backwards-compatible assertions. */
  readonly messages: LocalCompileRequest[] = [];
  terminated = false;

  postMessage(message: LocalCompileWorkerRequest): void {
    this.requests.push(message);
    if ('source' in message && typeof message.source === 'string') {
      this.messages.push(message);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  receive(response: LocalCompileWorkerResponse): void {
    this.onmessage?.({ data: response } as unknown as MessageEvent<LocalCompileResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as unknown as ErrorEvent);
  }
}

function setup(options: { delay?: number; createWorker?: () => LocalCompileWorker; shareResults?: boolean } = {}) {
  const worker = new FakeWorker();
  const results: LocalCompileOutcome[] = [];
  const pending: boolean[] = [];
  const modes: { mode: LocalCompileMode; detail?: string }[] = [];
  const createWorker = vi.fn(options.createWorker ?? (() => worker));
  const fallbackCompile = vi.fn((source: string): LocalCompileResult => okResult(source));
  const scheduler = new LocalCompileScheduler({
    createWorker,
    fallbackCompile,
    onResult: (outcome) => results.push(outcome),
    onPendingChange: (value) => pending.push(value),
    onModeChange: (mode, detail) => modes.push({ mode, detail }),
    delay: options.delay,
    ...(options.shareResults === undefined ? {} : { shareResults: options.shareResults }),
  });
  return { worker, results, pending, modes, createWorker, fallbackCompile, scheduler };
}

describe('LocalCompileScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid edits into one compile after the debounce window', () => {
    const { worker, scheduler } = setup();
    scheduler.schedule('one');
    vi.advanceTimersByTime(100);
    scheduler.schedule('two');
    vi.advanceTimersByTime(100);
    scheduler.schedule('three');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS - 1);
    expect(worker.messages).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0].source).toBe('three');
  });

  it('keeps one in-flight job and one pending job, discarding superseded results', () => {
    const { worker, results, pending, scheduler } = setup();
    scheduler.schedule('first');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.messages).toHaveLength(1);
    const first = worker.messages[0];

    scheduler.schedule('second');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.messages).toHaveLength(1);

    worker.receive({ id: first.id, ok: true, result: okResult('first'), duration: 2 });
    expect(results).toHaveLength(0);
    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1].source).toBe('second');

    const second = worker.messages[1];
    worker.receive({ id: second.id, ok: true, result: okResult('second'), duration: 3 });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('second');
    expect(results[0].mode).toBe('worker');
    expect(results[0].duration).toBe(3);
    expect(pending.at(-1)).toBe(false);
  });

  it('does not compile the same source twice when it is retyped while in flight', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('same');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const request = worker.messages[0];

    scheduler.schedule('same');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    worker.receive({ id: request.id, ok: true, result: okResult('same'), duration: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('same');
    expect(worker.messages).toHaveLength(1);
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS * 2);
    expect(worker.messages).toHaveLength(1);
  });

  it('turns a worker compile exception into a diagnostic for that source', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('broken');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const request = worker.messages[0];

    worker.receive({ id: request.id, ok: false, message: 'boom' });
    expect(results).toHaveLength(1);
    const outcome = results[0];
    expect(outcome.source).toBe('broken');
    expect(outcome.result.ok).toBe(false);
    if (outcome.result.ok) return;
    expect(outcome.result.diagnostics[0].code).toBe('local.worker.compile');
    expect(outcome.result.diagnostics[0].message).toContain('boom');
  });

  it('falls back to debounced main-thread compilation after a worker error without restarting it', () => {
    const { worker, results, modes, createWorker, fallbackCompile, scheduler } = setup();
    scheduler.schedule('running');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.messages).toHaveLength(1);

    worker.fail('worker crashed');
    expect(worker.terminated).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(modes.at(-1)?.mode).toBe('fallback');
    expect(modes.at(-1)?.detail ?? '').toContain('worker crashed');
    expect(fallbackCompile).toHaveBeenCalledWith('running');
    expect(results).toHaveLength(1);
    expect(results[0].mode).toBe('fallback');
    expect(results[0].source).toBe('running');

    scheduler.schedule('later');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS - 1);
    expect(fallbackCompile).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fallbackCompile).toHaveBeenLastCalledWith('later');
    expect(worker.messages).toHaveLength(1);
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS * 4);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('uses the coalesced fallback when workers are unavailable', () => {
    const results: LocalCompileOutcome[] = [];
    const modes: { mode: LocalCompileMode; detail?: string }[] = [];
    const fallbackCompile = vi.fn((source: string): LocalCompileResult => okResult(source));
    const scheduler = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error('no workers here');
      },
      fallbackCompile,
      onResult: (outcome) => results.push(outcome),
      onModeChange: (mode, detail) => modes.push({ mode, detail }),
    });
    expect(modes.at(-1)?.mode).toBe('fallback');
    expect(modes.at(-1)?.detail ?? '').toContain('no workers here');

    scheduler.schedule('fallback source');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS - 1);
    expect(fallbackCompile).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fallbackCompile).toHaveBeenCalledWith('fallback source');
    expect(results).toHaveLength(1);
    expect(results[0].mode).toBe('fallback');
  });

  it('defaults fallbackCompile to compileLocal', () => {
    const results: LocalCompileOutcome[] = [];
    const scheduler = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error('unavailable');
      },
      onResult: (outcome) => results.push(outcome),
    });

    scheduler.schedule('# Main thread fallback');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(results).toHaveLength(1);
    const outcome = results[0];
    expect(outcome.mode).toBe('fallback');
    expect(outcome.source).toBe('# Main thread fallback');
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.document.source).toBe('# Main thread fallback');
  });

  it('never compiles or delivers a superseded job when a worker fails during typing', () => {
    const { worker, results, fallbackCompile, scheduler } = setup();
    scheduler.schedule('old source');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    scheduler.schedule('latest source');
    worker.fail('worker crashed');
    expect(fallbackCompile).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(fallbackCompile).toHaveBeenCalledExactlyOnceWith('latest source');
    expect(results.map(result => result.source)).toEqual(['latest source']);
  });

  it('recovers message delivery failure using only the newest ready source', () => {
    const { worker, results, fallbackCompile, scheduler } = setup();
    scheduler.schedule('old source');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    scheduler.schedule('latest source');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    worker.onmessageerror?.({} as Event);
    expect(worker.terminated).toBe(true);
    expect(fallbackCompile).toHaveBeenCalledExactlyOnceWith('latest source');
    expect(results.map(result => result.source)).toEqual(['latest source']);
  });

  it('recovers a synchronous postMessage failure without duplicate compilation', () => {
    const { worker, results, fallbackCompile, scheduler } = setup();
    worker.postMessage = () => { throw new Error('cannot send'); };
    scheduler.schedule('latest source');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.terminated).toBe(true);
    expect(fallbackCompile).toHaveBeenCalledExactlyOnceWith('latest source');
    expect(results.map(result => result.source)).toEqual(['latest source']);
  });

  it('terminates the worker and ignores late results after dispose', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('disposed');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const request = worker.messages[0];

    scheduler.dispose();
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();

    worker.receive({ id: request.id, ok: true, result: okResult('disposed'), duration: 1 });
    scheduler.schedule('after dispose');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS * 2);
    expect(results).toHaveLength(0);
    expect(worker.messages).toHaveLength(1);
  });

  it('reports a fallback compile exception as a diagnostic', () => {
    const results: LocalCompileOutcome[] = [];
    const failing = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error('unavailable');
      },
      fallbackCompile: () => {
        throw new Error('fallback boom');
      },
      onResult: (outcome) => results.push(outcome),
    });
    failing.schedule('throwing source');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const outcome = results.at(-1)!;
    expect(outcome.source).toBe('throwing source');
    expect(outcome.result.ok).toBe(false);
    if (outcome.result.ok) return;
    expect(outcome.result.diagnostics[0].code).toBe('local.worker.compile');
    expect(outcome.result.diagnostics[0].message).toContain('fallback boom');
  });

  it('snapshots markdownBreaks and recompiles an options-only edit', () => {
    const { worker, results, scheduler } = setup();
    const options: { markdownBreaks: boolean } = { markdownBreaks: true };
    scheduler.schedule('a\nb', options);
    // Mutating the caller's object after schedule must not change the job.
    options.markdownBreaks = false;
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0].options).toEqual({ markdownBreaks: true });

    const first = worker.messages[0];
    scheduler.schedule('a\nb', { markdownBreaks: false });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.messages).toHaveLength(1);

    worker.receive({ id: first.id, ok: true, result: okResult('a\nb'), duration: 1 });
    expect(results).toHaveLength(0);
    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1].options).toEqual({ markdownBreaks: false });

    worker.receive({ id: worker.messages[1].id, ok: true, result: okResult('a\nb'), duration: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].options).toEqual({ markdownBreaks: false });
  });
});

function fullRequest(request: LocalCompileWorkerRequest): LocalCompileRequest {
  if (!('source' in request)) throw new Error('expected a complete-source request');
  return request;
}

function patchRequest(request: LocalCompileWorkerRequest): LocalCompilePatchRequest {
  if (!('edit' in request)) throw new Error('expected an incremental request');
  return request;
}

function negotiatedResponse(request: LocalCompileRequest, result: LocalCompileResult): LocalCompileResponse {
  return {
    id: request.id,
    ok: true,
    result,
    duration: 1,
    protocol: LOCAL_RESULT_PATCH_PROTOCOL,
    revision: request.revision ?? 1,
  };
}

function resultPatchResponse(
  request: LocalCompilePatchRequest,
  base: LocalCompileResult,
  next: LocalCompileResult,
): LocalCompilePatchResponse {
  const patch = encodeLocalResultPatch(base, next);
  if (patch === null) throw new Error('the test results cannot be patched');
  return {
    id: request.id,
    ok: true,
    protocol: LOCAL_RESULT_PATCH_PROTOCOL,
    baseRevision: request.baseRevision,
    revision: request.revision,
    patch,
    duration: 1,
  };
}

describe('LocalCompileScheduler patch-v1 transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('negotiates on the first complete compile then exchanges source edits and result patches', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('first');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);

    expect(worker.requests).toHaveLength(1);
    const first = fullRequest(worker.requests[0]);
    expect(first.protocol).toBe(LOCAL_RESULT_PATCH_PROTOCOL);
    expect(first.source).toBe('first');
    const firstResult = okResult('first');
    worker.receive(negotiatedResponse(first, firstResult));
    expect(results).toHaveLength(1);
    expect(results[0].revision).toBe(first.revision);

    scheduler.schedule('first plus');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.requests).toHaveLength(2);
    const second = patchRequest(worker.requests[1]);
    expect(second.protocol).toBe(LOCAL_RESULT_PATCH_PROTOCOL);
    expect(second.baseRevision).toBe(first.revision);
    expect(second.revision).toBeGreaterThan(second.baseRevision);
    expect(second.optionsKey).toBeDefined();
    expect(applySourceEdit('first', second.edit)).toBe('first plus');

    const nextResult = okResult('first plus');
    worker.receive(resultPatchResponse(second, firstResult, nextResult));
    expect(results.map((outcome) => outcome.source)).toEqual(['first', 'first plus']);
    expect(results[1].result).toEqual(nextResult);
    expect(results[1].revision).toBe(second.revision);
  });

  it('keeps using complete sources for a legacy worker response', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('one');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    worker.receive({ id: first.id, ok: true, result: okResult('one'), duration: 1 });

    scheduler.schedule('two');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const second = fullRequest(worker.requests[1]);
    expect(second.source).toBe('two');
    worker.receive({ id: second.id, ok: true, result: okResult('two'), duration: 1 });
    expect(results.map((outcome) => outcome.source)).toEqual(['one', 'two']);
    expect(worker.requests).toHaveLength(2);
  });

  it('recompiles fully when only the options changed', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('same', { markdownBreaks: false });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    worker.receive(negotiatedResponse(first, okResult('same')));

    scheduler.schedule('same', { markdownBreaks: true });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.requests).toHaveLength(2);
    const second = fullRequest(worker.requests[1]);
    expect(second.source).toBe('same');
    expect(second.options).toEqual({ markdownBreaks: true });
    worker.receive(negotiatedResponse(second, okResult('same')));
    expect(results).toHaveLength(2);
    expect(results[1].options).toEqual({ markdownBreaks: true });
  });

  it('snapshots newer parse budgets and treats their change as a permission edit', () => {
    const { worker, results, scheduler } = setup();
    const options = {
      limits: { maxSyntaxNodes: 1_000, maxParseWork: 10, maxMarkdownDepth: 3 },
    } as unknown as LocalCompileOptions;
    scheduler.schedule('budget', options);
    (options.limits as unknown as { maxParseWork: number }).maxParseWork = 99;
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    expect(first.options?.limits).toEqual({
      maxSyntaxNodes: 1_000,
      maxParseWork: 10,
      maxMarkdownDepth: 3,
    });
    worker.receive(negotiatedResponse(first, okResult('budget')));

    scheduler.schedule('budget', {
      limits: { maxSyntaxNodes: 1_000, maxParseWork: 20, maxMarkdownDepth: 3 },
    } as unknown as LocalCompileOptions);
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.requests).toHaveLength(2);
    const second = fullRequest(worker.requests[1]);
    expect(second.source).toBe('budget');
    expect(second.options?.limits).toEqual({
      maxSyntaxNodes: 1_000,
      maxParseWork: 20,
      maxMarkdownDepth: 3,
    });
    worker.receive(negotiatedResponse(second, okResult('budget')));
    expect(results).toHaveLength(2);
  });

  it('recovers with the complete source when the worker rejects the base revision', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('base');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    worker.receive(negotiatedResponse(first, okResult('base')));

    scheduler.schedule('base edit');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const second = patchRequest(worker.requests[1]);
    worker.receive({
      id: second.id,
      ok: false,
      message: 'The requested base revision is not current',
      retryFull: true,
      code: 'stale-base',
    });

    expect(worker.requests).toHaveLength(3);
    const retry = fullRequest(worker.requests[2]);
    expect(retry.source).toBe('base edit');
    worker.receive(negotiatedResponse(retry, okResult('base edit')));
    expect(results.map((outcome) => outcome.source)).toEqual(['base', 'base edit']);
  });

  it('recovers once from an unappliable patch without looping', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('base');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    worker.receive(negotiatedResponse(first, okResult('base')));

    scheduler.schedule('base edit');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const second = patchRequest(worker.requests[1]);
    worker.receive({
      id: second.id,
      ok: true,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: second.baseRevision,
      revision: second.revision,
      duration: 1,
      patch: {
        kind: 'result-patch',
        protocol: LOCAL_RESULT_PATCH_PROTOCOL,
        document: { roots: ['missing-node'] },
      },
    });

    expect(worker.requests).toHaveLength(3);
    const retry = fullRequest(worker.requests[2]);
    expect(retry.source).toBe('base edit');
    worker.receive(negotiatedResponse(retry, okResult('base edit')));
    expect(results.map((outcome) => outcome.source)).toEqual(['base', 'base edit']);
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS * 4);
    expect(worker.requests).toHaveLength(3);
  });

  it('adopts a superseded complete result as the baseline for the queued edit', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('old');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);

    scheduler.schedule('latest');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(worker.requests).toHaveLength(1);

    worker.receive(negotiatedResponse(first, okResult('old')));
    expect(results).toHaveLength(0);
    expect(worker.requests).toHaveLength(2);
    const queued = patchRequest(worker.requests[1]);
    expect(queued.baseRevision).toBe(first.revision);
    expect(applySourceEdit('old', queued.edit)).toBe('latest');
    worker.receive(resultPatchResponse(queued, okResult('old'), okResult('latest')));
    expect(results.map((outcome) => outcome.source)).toEqual(['latest']);
  });

  it('delivers an independent graph by default and a shared graph on request', () => {
    const shared = setup({ shareResults: true });
    shared.scheduler.schedule('shared');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const sharedRequest = fullRequest(shared.worker.requests[0]);
    const sharedResult = nodeResult('shared', 'shared');
    shared.worker.receive(negotiatedResponse(sharedRequest, sharedResult));
    expect(shared.results[0].result).toBe(sharedResult);
    shared.scheduler.dispose();

    const isolated = setup();
    isolated.scheduler.schedule('first');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(isolated.worker.requests[0]);
    const baseResult = nodeResult('first', 'first');
    isolated.worker.receive(negotiatedResponse(first, baseResult));
    const delivered = isolated.results[0].result;
    expect(delivered).not.toBe(baseResult);
    expect(delivered.ok && delivered.document.nodes[0]).not.toBe(
      baseResult.ok ? baseResult.document.nodes[0] : undefined,
    );

    // Mutating the public result must not reach the scheduler's baseline.
    if (delivered.ok) {
      const paragraph = delivered.document.nodes[0];
      if (paragraph.children) paragraph.children[0].value = 'tampered';
    }
    expect(baseResult.ok && baseResult.document.nodes[0].children?.[0].value).toBe('first');

    isolated.scheduler.schedule('edited');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const second = patchRequest(isolated.worker.requests[1]);
    const nextResult = nodeResult('edited', 'edited');
    isolated.worker.receive(resultPatchResponse(second, baseResult, nextResult));
    expect(isolated.results[1].result).toEqual(nextResult);
    expect(isolated.results[1].result.ok && isolated.results[1].result.document.nodes[0].children?.[0].value)
      .toBe('edited');
  });

  it('ignores a patch response whose id no longer matches the in-flight request', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('first');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    const first = fullRequest(worker.requests[0]);
    worker.receive({
      id: first.id + 100,
      ok: true,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 0,
      revision: 1,
      patch: { kind: 'result-patch', protocol: LOCAL_RESULT_PATCH_PROTOCOL, document: {} },
      duration: 1,
    });
    expect(results).toHaveLength(0);
    worker.receive(negotiatedResponse(first, okResult('first')));
    expect(results).toHaveLength(1);
    expect(scheduler).toBeDefined();
  });
});

interface FakeScope extends LocalCompileWorkerScope {
  /** Classic full/failure responses, used by the legacy assertions. */
  messages: LocalCompileResponse[];
  /** Every response, including incremental patch frames. */
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

describe('startLocalCompileWorker', () => {
  it('keeps an incremental session across messages and invalidates changed options', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    const source = 'first **paragraph**\n\nsecond\n\nlast';
    scope.onmessage!(requestEvent({id: 1, source}));
    scope.onmessage!(requestEvent({id: 2, source: source + ' edit'}));
    const response = scope.messages[1];
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.incremental).toMatchObject({mode: 'incremental', compiledBlocks: 1, reusedBlocks: 2});
    scope.onmessage!(requestEvent({id: 3, source: source + ' edit', options: {markdownBreaks: true}}));
    const changed = scope.messages[2];
    if (changed.ok) expect(changed.incremental?.mode).toBe('full');
  });

  it('compiles a valid request and posts an ok response', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    expect(scope.onmessage).toBeTypeOf('function');

    scope.onmessage!(requestEvent({ id: 7, source: '# Worker compile' }));
    expect(scope.messages).toHaveLength(1);
    const response = scope.messages[0];
    expect(response.id).toBe(7);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.ok).toBe(true);
    if (!response.result.ok) return;
    expect(response.result.document.source).toBe('# Worker compile');
    expect(response.duration).toBeTypeOf('number');
    expect(Number.isFinite(response.duration)).toBe(true);
    expect(response.duration).toBeGreaterThanOrEqual(0);
  });

  it('compiles markdownBreaks in the worker and returns cloneable plain nodes', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);

    scope.onmessage!(requestEvent({ id: 21, source: 'a\nb', options: { markdownBreaks: true } }));
    expect(scope.messages).toHaveLength(1);
    const response = scope.messages[0];
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.ok).toBe(true);
    if (!response.result.ok) return;
    const paragraph = response.result.document.nodes[0];
    expect(paragraph.children?.map((node) => node.type)).toEqual(['text', 'break', 'text']);
    expect(paragraph.children?.map((node) => node.value)).toEqual(['a', undefined, 'b']);
    expect(structuredClone(response)).toEqual(response);
  });

  it('ignores malformed requests', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    const handler = scope.onmessage!;

    for (const data of [
      null,
      undefined,
      {},
      { id: 'one', source: 'x' },
      { id: 1, source: 42 },
      { source: 'x' },
      { id: 1 },
    ]) {
      handler(requestEvent(data));
    }
    expect(scope.messages).toHaveLength(0);
  });

  it('posts a failure response when the success response cannot be sent', () => {
    const scope = createScope();
    const failed: LocalCompileResponse[] = [];
    scope.postMessage = (message) => {
      if (message.ok) throw new Error('result is not cloneable');
      failed.push(message);
    };
    startLocalCompileWorker(scope);

    expect(() => scope.onmessage!(requestEvent({ id: 9, source: '# Worker compile' }))).not.toThrow();
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe(9);
    expect(failed[0].ok).toBe(false);
    if (failed[0].ok) return;
    expect(failed[0].message).toContain('result is not cloneable');
  });

  it('does not throw out of the handler when no response can be posted', () => {
    const scope = createScope();
    scope.postMessage = () => {
      throw new Error('scope is gone');
    };
    startLocalCompileWorker(scope);

    expect(() => scope.onmessage!(requestEvent({ id: 1, source: '# Worker compile' }))).not.toThrow();
  });

  it('rejects a scope without postMessage', () => {
    expect(() => startLocalCompileWorker(null as unknown as LocalCompileWorkerScope)).toThrow(TypeError);
    expect(() => startLocalCompileWorker({} as LocalCompileWorkerScope)).toThrow(TypeError);
    expect(() => startLocalCompileWorker()).toThrow(TypeError);
  });
});

describe('startLocalCompileWorker patch-v1', () => {
  it('negotiates, applies a UTF-16 edit, and returns a patch tied to both revisions', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);

    scope.onmessage!(requestEvent({
      id: 1,
      source: 'first',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: 1,
    }));
    const first = scope.responses[0];
    expect(first.ok).toBe(true);
    if (!first.ok || !('result' in first)) return;
    expect(first.protocol).toBe(LOCAL_RESULT_PATCH_PROTOCOL);
    expect(first.revision).toBe(1);

    const nextSource = 'first plus';
    const edit = diffSourceEdit('first', nextSource);
    expect(edit).not.toBeNull();
    scope.onmessage!(requestEvent({
      id: 2,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 1,
      revision: 2,
      edit: edit!,
      targetLength: nextSource.length,
    }));
    const second = scope.responses[1];
    expect(second.ok).toBe(true);
    if (!second.ok || !('patch' in second)) return;
    expect(second.baseRevision).toBe(1);
    expect(second.revision).toBe(2);
    const applied = applyLocalResultPatch(first.result, second.patch);
    expect(applied).not.toBeNull();
    expect(applied!.ok).toBe(true);
    if (applied!.ok) expect(applied!.document.source).toBe(nextSource);
  });

  it('keeps the classic response shape for a legacy client', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);

    scope.onmessage!(requestEvent({ id: 1, source: 'legacy' }));
    const legacy = scope.responses[0];
    expect(legacy.ok).toBe(true);
    if (!legacy.ok || !('result' in legacy)) return;
    expect('protocol' in legacy).toBe(false);
    expect('revision' in legacy).toBe(false);

    scope.onmessage!(requestEvent({
      id: 2,
      source: 'negotiated',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: 2,
    }));
    const negotiated = scope.responses[1];
    expect(negotiated.ok).toBe(true);
    if (!negotiated.ok || !('result' in negotiated)) return;
    expect(negotiated.protocol).toBe(LOCAL_RESULT_PATCH_PROTOCOL);
    expect(negotiated.revision).toBe(2);
  });

  it('asks for a complete source when a patch base, length, or permission signature is stale', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    scope.onmessage!(requestEvent({
      id: 1,
      source: 'base',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      revision: 5,
    }));
    expect(scope.responses[0].ok).toBe(true);

    const noop = { from: 0, to: 0, insert: '' };
    scope.onmessage!(requestEvent({
      id: 2,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 4,
      revision: 6,
      edit: noop,
      targetLength: 4,
    }));
    const stale = scope.responses[1];
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.retryFull).toBe(true);
      expect(stale.code).toBe('stale-base');
    }

    scope.onmessage!(requestEvent({
      id: 3,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 5,
      revision: 6,
      edit: noop,
      targetLength: 9,
    }));
    const wrongLength = scope.responses[2];
    expect(wrongLength.ok).toBe(false);
    if (!wrongLength.ok) expect(wrongLength.code).toBe('invalid-edit');

    scope.onmessage!(requestEvent({
      id: 4,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 5,
      revision: 6,
      edit: { from: 0, to: 30, insert: 'x' },
      targetLength: 5,
    }));
    const wrongBase = scope.responses[3];
    expect(wrongBase.ok).toBe(false);
    if (!wrongBase.ok) expect(wrongBase.code).toBe('invalid-edit');

    scope.onmessage!(requestEvent({
      id: 5,
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      baseRevision: 5,
      revision: 6,
      edit: noop,
      targetLength: 4,
      optionsKey: 'not-the-baseline-key',
    }));
    const wrongOptions = scope.responses[4];
    expect(wrongOptions.ok).toBe(false);
    if (!wrongOptions.ok) expect(wrongOptions.code).toBe('options-mismatch');
  });

  it('supports a dispose control message and an explicit cleanup handle', () => {
    const scope = createScope();
    const control = startLocalCompileWorker(scope);
    expect(control.disposed).toBe(false);
    const handler = scope.onmessage!;
    handler(requestEvent({ control: 'dispose' }));
    expect(control.disposed).toBe(true);
    expect(scope.onmessage).toBeNull();

    const other = createScope();
    const second = startLocalCompileWorker(other);
    second.dispose();
    expect(second.disposed).toBe(true);
    expect(other.onmessage).toBeNull();
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

describe('scheduler and worker end-to-end patch-v1', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handshakes once, then compiles later edits through a source edit and result patch', () => {
    const worker = new BridgedWorker();
    const results: LocalCompileOutcome[] = [];
    const scheduler = new LocalCompileScheduler({
      createWorker: () => worker,
      onResult: (outcome) => results.push(outcome),
      delay: 10,
    });
    try {
      scheduler.schedule('hello **world**');
      vi.advanceTimersByTime(10);
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('hello **world**');
      expect(results[0].result.ok).toBe(true);

      scheduler.schedule('hello **world** again');
      vi.advanceTimersByTime(10);
      expect(results).toHaveLength(2);
      expect(results[1].source).toBe('hello **world** again');
      expect(results[1].result.ok).toBe(true);
      if (results[1].result.ok) {
        expect(results[1].result.document.source).toBe('hello **world** again');
      }
    } finally {
      scheduler.dispose();
    }
  });
});
