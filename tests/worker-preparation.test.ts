import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalCompileSession, LocalIncrementalStats } from '../src/local/incremental';
import type { LocalCompileResult } from '../src/local/types';
import {
  startLocalCompileWorker,
  type LocalCompileRequest,
  type LocalCompileWorkerControl,
  type LocalCompileWorkerResponse,
  type LocalCompileWorkerScope,
} from '../src/local/worker';

function okResult(source: string): LocalCompileResult {
  return {
    ok: true,
    document: { syntax: 'local', source, nodes: [], initialState: {}, bindings: {} },
    diagnostics: [],
  };
}

interface PreparationCall {
  signal: { readonly aborted: boolean };
  yieldTask?: () => Promise<void>;
  resolve(value: boolean): void;
}

class FakeSession {
  readonly stats: Readonly<LocalIncrementalStats> = {
    mode: 'full',
    totalBlocks: 0,
    compiledBlocks: 0,
    reusedBlocks: 0,
    compiledCharacters: 0,
  };
  readonly compiled: string[] = [];
  readonly preparations: PreparationCall[] = [];
  disposed = false;

  compile(source: string): LocalCompileResult {
    this.compiled.push(source);
    return okResult(source);
  }

  prepareAsync(
    signal: { readonly aborted: boolean } = { aborted: false },
    yieldTask?: () => Promise<void>,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.preparations.push({ signal, yieldTask, resolve });
    });
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface FakeScope extends LocalCompileWorkerScope {
  messages: LocalCompileWorkerResponse[];
}

function createScope(): FakeScope {
  const scope: FakeScope = {
    onmessage: null,
    messages: [],
    postMessage(message: LocalCompileWorkerResponse): void {
      scope.messages.push(message);
    },
  };
  return scope;
}

function requestEvent(data: unknown): MessageEvent<LocalCompileRequest> {
  return { data } as unknown as MessageEvent<LocalCompileRequest>;
}

function setup(delay = 30) {
  const scope = createScope();
  const session = new FakeSession();
  const control: LocalCompileWorkerControl = startLocalCompileWorker(scope, {
    createSession: () => session as unknown as LocalCompileSession,
    preparationDelay: delay,
  });
  return { scope, session, control };
}

describe('worker idle preparation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a short idle delay before calling prepareAsync', () => {
    const { scope, session, control } = setup(30);
    scope.onmessage!(requestEvent({ id: 1, source: 'first' }));
    expect(scope.messages).toHaveLength(1);
    expect(session.preparations).toHaveLength(0);

    vi.advanceTimersByTime(29);
    expect(session.preparations).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(session.preparations).toHaveLength(1);
    expect(session.preparations[0].signal.aborted).toBe(false);
    expect(session.preparations[0].yieldTask).toBeTypeOf('function');
    control.dispose();
  });

  it('aborts a running preparation when a new edit arrives', () => {
    const { scope, session, control } = setup();
    scope.onmessage!(requestEvent({ id: 1, source: 'first' }));
    vi.advanceTimersByTime(30);
    expect(session.preparations).toHaveLength(1);
    const firstSignal = session.preparations[0].signal;

    scope.onmessage!(requestEvent({ id: 2, source: 'first edit' }));
    expect(firstSignal.aborted).toBe(true);
    expect(session.compiled).toEqual(['first', 'first edit']);

    vi.advanceTimersByTime(30);
    expect(session.preparations).toHaveLength(2);
    expect(session.preparations[1].signal.aborted).toBe(false);
    control.dispose();
  });

  it('aborts preparation and stops the timer on option changes', () => {
    const { scope, session, control } = setup();
    scope.onmessage!(requestEvent({ id: 1, source: 'first' }));
    vi.advanceTimersByTime(30);
    const signal = session.preparations[0].signal;

    scope.onmessage!(requestEvent({
      id: 2,
      source: 'first',
      options: { markdownBreaks: true },
    }));
    expect(signal.aborted).toBe(true);
    control.dispose();
  });

  it('cancels a scheduled preparation without compiling again', () => {
    const { scope, session, control } = setup();
    scope.onmessage!(requestEvent({ id: 1, source: 'first' }));
    vi.advanceTimersByTime(10);
    control.cancelPreparation();
    vi.advanceTimersByTime(100);
    expect(session.preparations).toHaveLength(0);
    expect(session.compiled).toEqual(['first']);
    control.dispose();
  });

  it('cleans up from a dispose control message and aborts active work', () => {
    const { scope, session, control } = setup();
    const handler = scope.onmessage!;
    handler(requestEvent({ id: 1, source: 'first' }));
    vi.advanceTimersByTime(30);
    expect(session.preparations).toHaveLength(1);
    const signal = session.preparations[0].signal;

    handler(requestEvent({ control: 'dispose' }));
    expect(signal.aborted).toBe(true);
    expect(session.disposed).toBe(true);
    expect(control.disposed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(session.preparations).toHaveLength(1);
  });

  it('ignores a preparation that resolves after cancellation', async () => {
    const { scope, session, control } = setup();
    scope.onmessage!(requestEvent({ id: 1, source: 'first' }));
    vi.advanceTimersByTime(30);
    expect(session.preparations).toHaveLength(1);

    control.cancelPreparation();
    session.preparations[0].resolve(true);
    await Promise.resolve();
    expect(session.preparations[0].signal.aborted).toBe(true);
    control.dispose();
  });
});
