import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
} from 'reactive-md';
import type {
  LocalCompileMode,
  LocalCompileOutcome,
  LocalCompileRequest,
  LocalCompileResponse,
  LocalCompileResult,
  LocalCompileWorker,
} from 'reactive-md';

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

class FakeWorker implements LocalCompileWorker {
  onmessage: ((event: MessageEvent<LocalCompileResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  readonly messages: LocalCompileRequest[] = [];
  terminated = false;

  postMessage(message: LocalCompileRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  receive(response: LocalCompileResponse): void {
    this.onmessage?.({ data: response } as unknown as MessageEvent<LocalCompileResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as unknown as ErrorEvent);
  }
}

function setup(options: { delay?: number; createWorker?: () => LocalCompileWorker } = {}) {
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
  });
  return { worker, results, pending, modes, createWorker, fallbackCompile, scheduler };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LocalCompileScheduler', () => {
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
});
