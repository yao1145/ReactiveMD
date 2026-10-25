import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalCompileOptions, LocalCompileResult } from '../src/local/types';
import {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  startLocalCompileWorker,
  type LocalCompileOutcome,
  type LocalCompileRequest,
  type LocalCompileResponse,
  type LocalCompileWorker,
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

function setup() {
  const worker = new FakeWorker();
  const results: LocalCompileOutcome[] = [];
  const fallbackCompile = vi.fn((source: string, _options?: LocalCompileOptions) => okResult(source));
  const scheduler = new LocalCompileScheduler({
    createWorker: () => worker,
    fallbackCompile,
    onResult: (outcome) => results.push(outcome),
    delay: 20,
  });
  return { worker, results, fallbackCompile, scheduler };
}

describe('compile option propagation through the scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards options to the worker and records them on the outcome', () => {
    const { worker, results, scheduler } = setup();
    const options: LocalCompileOptions = { enableCss: true, limits: { maxSyntaxNodes: 50 } };
    scheduler.schedule('<p>native</p>', options);
    vi.advanceTimersByTime(20);

    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0].options).toEqual({ enableCss: true, limits: { maxSyntaxNodes: 50 } });

    worker.receive({
      id: worker.messages[0].id,
      ok: true,
      result: okResult('<p>native</p>'),
      duration: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].options).toEqual({ enableCss: true, limits: { maxSyntaxNodes: 50 } });
  });

  it('snapshots options so a later caller mutation cannot change the in-flight compile', () => {
    const { worker, results, scheduler } = setup();
    const options: { enableCss: boolean; enableJavaScript?: boolean } = { enableCss: true };
    scheduler.schedule('<p>native</p>', options);

    // Mutating the caller's object after schedule must not widen permissions.
    options.enableCss = false;
    options.enableJavaScript = true;

    vi.advanceTimersByTime(20);
    expect(worker.messages[0].options).toEqual({ enableCss: true });

    worker.receive({
      id: worker.messages[0].id,
      ok: true,
      result: okResult('<p>native</p>'),
      duration: 1,
    });
    expect(results[0].options).toEqual({ enableCss: true });
  });

  it('discards a result when only the options changed for the same source', () => {
    const { worker, results, scheduler } = setup();
    scheduler.schedule('same source', { enableCss: true });
    vi.advanceTimersByTime(20);
    const first = worker.messages[0];

    scheduler.schedule('same source', { enableJavaScript: true });
    vi.advanceTimersByTime(20);

    worker.receive({ id: first.id, ok: true, result: okResult('same source'), duration: 1 });
    expect(results).toHaveLength(0);
    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[1].options).toEqual({ enableJavaScript: true });

    worker.receive({
      id: worker.messages[1].id,
      ok: true,
      result: okResult('same source'),
      duration: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].options).toEqual({ enableJavaScript: true });
  });

  it('replays the in-flight options when the worker has to fall back', () => {
    const { worker, results, fallbackCompile, scheduler } = setup();
    scheduler.schedule('<p>native</p>', { enableExtendedHtml: true });
    vi.advanceTimersByTime(20);

    worker.fail('worker crashed');
    expect(fallbackCompile).toHaveBeenCalledWith('<p>native</p>', { enableExtendedHtml: true });
    expect(results).toHaveLength(1);
    expect(results[0].mode).toBe('fallback');
    expect(results[0].options).toEqual({ enableExtendedHtml: true });
  });

  it('keeps the historical one-argument fallback call for default schedules', () => {
    const results: LocalCompileOutcome[] = [];
    const fallbackCompile = vi.fn((source: string, _options?: LocalCompileOptions) => okResult(source));
    const scheduler = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error('no workers here');
      },
      fallbackCompile,
      onResult: (outcome) => results.push(outcome),
    });

    scheduler.schedule('# default route');
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(fallbackCompile).toHaveBeenCalledWith('# default route');
    expect(results[0].options).toBeUndefined();
  });

  it('forwards options through the fallback route', () => {
    const results: LocalCompileOutcome[] = [];
    const fallbackCompile = vi.fn((source: string, _options?: LocalCompileOptions) => okResult(source));
    const scheduler = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error('no workers here');
      },
      fallbackCompile,
      onResult: (outcome) => results.push(outcome),
    });

    scheduler.schedule('<style>p{color:red}</style><p>x</p>', { enableCss: true });
    vi.advanceTimersByTime(LOCAL_COMPILE_DELAY_MS);
    expect(fallbackCompile).toHaveBeenCalledWith('<style>p{color:red}</style><p>x</p>', { enableCss: true });
    expect(results[0].options).toEqual({ enableCss: true });
  });
});

interface FakeScope extends LocalCompileWorkerScope {
  messages: LocalCompileResponse[];
}

function createScope(): FakeScope {
  const scope: FakeScope = {
    onmessage: null,
    messages: [],
    postMessage(message: LocalCompileResponse): void {
      scope.messages.push(message);
    },
  };
  return scope;
}

function requestEvent(data: unknown): MessageEvent<LocalCompileRequest> {
  return { data } as unknown as MessageEvent<LocalCompileRequest>;
}

describe('worker-side compile options', () => {
  it('compiles the request with the granted native HTML flags', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    scope.onmessage!(requestEvent({
      id: 3,
      source: '<p>Native HTML</p>',
      options: { enableExtendedHtml: true },
    }));

    expect(scope.messages).toHaveLength(1);
    const response = scope.messages[0];
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.ok).toBe(true);
    if (!response.result.ok) return;
    expect(response.result.document.html).toEqual({
      enableCss: false,
      enableJavaScript: false,
      enableExtendedHtml: true,
    });
    expect(response.result.document.bindings).toEqual({});
  });

  it('reports invalid options instead of compiling them permissively', () => {
    const scope = createScope();
    startLocalCompileWorker(scope);
    scope.onmessage!(requestEvent({
      id: 4,
      source: '<p>Native HTML</p>',
      options: { enableCss: 'yes' },
    }));

    const response = scope.messages[0];
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.ok).toBe(false);
    if (response.result.ok) return;
    expect(response.result.diagnostics[0].code).toBe('local.options.invalid');
  });
});
