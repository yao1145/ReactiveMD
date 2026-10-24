import { compileLocal } from './compiler';
import type { Diagnostic, LocalCompileResult } from './types';

/** Editors are coalesced for this long before a compile is dispatched. */
export const LOCAL_COMPILE_DELAY_MS = 150;

export interface LocalCompileRequest {
  id: number;
  source: string;
}

export type LocalCompileResponse =
  | { id: number; ok: true; result: LocalCompileResult; duration: number }
  | { id: number; ok: false; message: string };

/**
 * The small surface the scheduler needs from a Worker. Events stay untyped so
 * the core declarations compile without the DOM library.
 */
export interface LocalCompileWorker {
  postMessage(message: LocalCompileRequest): void;
  terminate(): void;
  onmessage: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onmessageerror: ((event: any) => void) | null;
}

export type LocalCompileMode = 'worker' | 'fallback';

export interface LocalCompileOutcome {
  source: string;
  result: LocalCompileResult;
  duration: number;
  mode: LocalCompileMode;
}

export interface LocalCompileSchedulerOptions {
  createWorker(): LocalCompileWorker;
  /** Defaults to compileLocal. Runs on the main thread only when the worker is unavailable or failed. */
  fallbackCompile?(source: string): LocalCompileResult;
  onResult(outcome: LocalCompileOutcome): void;
  onPendingChange?(pending: boolean): void;
  onModeChange?(mode: LocalCompileMode, detail?: string): void;
  delay?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function compileFailureDiagnostic(error: unknown): Diagnostic {
  return {
    code: 'local.worker.compile',
    message: `Compilation failed: ${messageOf(error)}`,
    severity: 'error',
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

/**
 * Debounces edits, keeps at most one compile in flight plus the latest source
 * waiting, and drops results that a newer edit has already superseded.
 */
export class LocalCompileScheduler {
  private readonly options: LocalCompileSchedulerOptions;
  private readonly delay: number;
  private worker: LocalCompileWorker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queuedSource: string | null = null;
  private inFlight: { id: number; source: string } | null = null;
  private nextId = 1;
  private pending = false;
  private disposed = false;

  constructor(options: LocalCompileSchedulerOptions) {
    this.options = options;
    const delay = options.delay;
    this.delay = typeof delay === 'number' && Number.isFinite(delay)
      ? Math.max(0, delay)
      : LOCAL_COMPILE_DELAY_MS;
    try {
      const worker = options.createWorker();
      worker.onmessage = (event) => this.receive(event.data);
      worker.onerror = (event) => {
        const detail = event && typeof (event as { message?: unknown }).message === 'string'
          ? String((event as { message: string }).message)
          : '';
        this.handleWorkerFailure(detail || 'The compile worker encountered an error');
      };
      worker.onmessageerror = () => this.handleWorkerFailure('The compile worker could not deliver the compile result');
      this.worker = worker;
    } catch (error) {
      this.worker = null;
      options.onModeChange?.('fallback', `Could not start the compile worker: ${messageOf(error)}`);
    }
  }

  /** Queue the newest source; the previous timer, if any, is replaced. */
  schedule(source: string): void {
    if (this.disposed) return;
    this.queuedSource = source;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, this.delay);
    this.setPending(true);
  }

  /** Stop the timer and terminate the worker. No callbacks fire afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.queuedSource = null;
    this.inFlight = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try {
        worker.terminate();
      } catch {
        /* terminating an already-gone worker is harmless */
      }
    }
    this.pending = false;
  }

  private drain(): void {
    if (this.disposed || this.timer !== null || this.inFlight !== null) return;
    const source = this.queuedSource;
    if (source === null) {
      this.setPending(false);
      return;
    }
    this.queuedSource = null;
    this.compile(source);
  }

  private compile(source: string): void {
    const worker = this.worker;
    if (!worker) {
      this.compileFallback(source);
      return;
    }
    const id = this.nextId++;
    this.inFlight = { id, source };
    try {
      worker.postMessage({ id, source });
    } catch (error) {
      this.inFlight = null;
      this.handleWorkerFailure(`Could not send the source to the compile worker: ${messageOf(error)}`);
      this.compileFallback(source);
    }
  }

  private compileFallback(source: string): void {
    if (this.disposed) return;
    const started = now();
    let result: LocalCompileResult;
    try {
      const fallbackCompile = this.options.fallbackCompile ?? compileLocal;
      result = fallbackCompile(source);
    } catch (error) {
      result = { ok: false, diagnostics: [compileFailureDiagnostic(error)] };
    }
    this.deliver({
      source,
      result,
      duration: safeDuration(now() - started),
      mode: 'fallback',
    });
    this.finishRun();
  }

  private receive(response: LocalCompileResponse): void {
    if (this.disposed) return;
    const job = this.inFlight;
    if (!job || !response || response.id !== job.id) return;
    this.inFlight = null;

    const queued = this.queuedSource;
    if (queued !== null && queued !== job.source) {
      // A newer source is waiting; drop this result instead of flashing backwards.
    } else {
      if (queued === job.source) {
        // The queued edit compiles to the same source, so this result still counts.
        this.queuedSource = null;
        this.clearTimer();
      }
      if (response.ok) {
        this.deliver({
          source: job.source,
          result: response.result,
          duration: safeDuration(response.duration),
          mode: 'worker',
        });
      } else {
        this.deliver({
          source: job.source,
          result: { ok: false, diagnostics: [compileFailureDiagnostic(response.message)] },
          duration: 0,
          mode: 'worker',
        });
      }
    }
    this.finishRun();
  }

  private handleWorkerFailure(detail: string): void {
    if (this.disposed) return;
    this.degrade(detail);
    const job = this.inFlight;
    this.inFlight = null;
    if (job && (this.queuedSource === null || this.queuedSource === job.source)) {
      if (this.queuedSource === job.source) {
        this.queuedSource = null;
        this.clearTimer();
      }
      this.compileFallback(job.source);
    }
    this.finishRun();
  }

  /** Permanently switch to the fallback; a crashed worker is never restarted. */
  private degrade(detail: string): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    try {
      worker.terminate();
    } catch {
      /* terminating an already-gone worker is harmless */
    }
    this.options.onModeChange?.('fallback', detail);
  }

  private finishRun(): void {
    if (this.disposed) return;
    this.drain();
    if (this.disposed) return;
    this.setPending(this.timer !== null || this.inFlight !== null || this.queuedSource !== null);
  }

  private deliver(outcome: LocalCompileOutcome): void {
    if (this.disposed) return;
    this.options.onResult(outcome);
  }

  private setPending(pending: boolean): void {
    if (this.pending === pending) return;
    this.pending = pending;
    this.options.onPendingChange?.(pending);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export interface LocalCompileWorkerScope {
  onmessage: ((event: any) => void) | null;
  postMessage(message: LocalCompileResponse): void;
}

function postFailure(scope: LocalCompileWorkerScope, id: number, message: string): void {
  try {
    scope.postMessage({ id, ok: false, message });
  } catch {
    /* A scope that cannot receive the failure response is already broken. */
  }
}

/** Install the worker-side compile handler on a DedicatedWorkerGlobalScope-like object. */
export function startLocalCompileWorker(scope?: LocalCompileWorkerScope): void {
  const target = scope === undefined ? (globalThis as unknown as LocalCompileWorkerScope) : scope;
  if (!target || typeof target.postMessage !== 'function') {
    throw new TypeError('startLocalCompileWorker requires a worker scope with postMessage');
  }
  target.onmessage = (event) => {
    const request = event?.data;
    if (!request || typeof request.id !== 'number' || typeof request.source !== 'string') return;

    const started = now();
    try {
      const result = compileLocal(request.source);
      const duration = safeDuration(now() - started);
      try {
        target.postMessage({ id: request.id, ok: true, result, duration });
      } catch (error) {
        // The result itself may not be cloneable; report the failure instead.
        postFailure(target, request.id, `Could not return the compile result: ${messageOf(error)}`);
      }
    } catch (error) {
      postFailure(target, request.id, messageOf(error));
    }
  };
}
