import { createLocalCompileSession, type LocalCompileSession, type LocalIncrementalStats } from './incremental';
import { MAX_LOCAL_HOST_COMPONENTS, MAX_LOCAL_HOST_ENUM_VALUES } from './limits';
import { LOCAL_HTML_FLAGS, localCompileOptionsKey } from './options';
import type { Diagnostic, LocalCompileOptions, LocalCompileResult } from './types';

/** Editors are coalesced for this long before a compile is dispatched. */
export const LOCAL_COMPILE_DELAY_MS = 150;

export interface LocalCompileRequest {
  id: number;
  source: string;
  /**
   * Capability flags, Markdown break handling, limits and host component
   * schemas for this compile. `hostComponents` selects the host leaf tags the
   * parser may build; `markdownBreaks` turns soft breaks into `break` nodes.
   */
  options?: LocalCompileOptions;
}

export type LocalCompileResponse =
  | { id: number; ok: true; result: LocalCompileResult; duration: number; incremental?: Readonly<LocalIncrementalStats> }
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
  /** Snapshot of the options this result was compiled with, when supplied. */
  options?: LocalCompileOptions;
}

export interface LocalCompileSchedulerOptions {
  createWorker(): LocalCompileWorker;
  /**
   * Defaults to compileLocal. Runs on the main thread only when the worker is
   * unavailable or failed. One-argument callbacks remain supported.
   */
  fallbackCompile?(source: string, options?: LocalCompileOptions): LocalCompileResult;
  onResult(outcome: LocalCompileOutcome): void;
  onPendingChange?(pending: boolean): void;
  onModeChange?(mode: LocalCompileMode, detail?: string): void;
  delay?: number;
}

interface CompileJob {
  source: string;
  /** Copied at schedule time so later caller mutation cannot change permissions or host schemas. */
  options?: LocalCompileOptions;
  /** Canonical options signature used to detect options-only edits. */
  optionsKey: string;
}

/**
 * Clone host component schemas so a caller mutating its option object after
 * `schedule` cannot change an in-flight compile. Obviously invalid shapes pass
 * through unchanged for `readLocalCompileOptions` to report.
 */
function snapshotHostComponents(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  // The compiler rejects oversized arrays. Check before map() and replace the
  // array with a bounded marker so the worker message never clones it.
  if (value.length > MAX_LOCAL_HOST_COMPONENTS) return new Array<unknown>(MAX_LOCAL_HOST_COMPONENTS + 1);
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const source = entry as Record<string, unknown>;
    const clone: Record<string, unknown> = { ...source };
    const props = source.props;
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      clone.props = props;
      return clone;
    }
    const propsCopy: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(props as Record<string, unknown>)) {
      if (!prop || typeof prop !== 'object' || Array.isArray(prop)) {
        propsCopy[name] = prop;
        continue;
      }
      const propSource = prop as Record<string, unknown>;
      const propCopy: Record<string, unknown> = { ...propSource };
      if (Array.isArray(propSource.enum) && propSource.enum.length <= MAX_LOCAL_HOST_ENUM_VALUES) {
        propCopy.enum = [...propSource.enum];
      }
      propsCopy[name] = propCopy;
    }
    clone.props = propsCopy;
    return clone;
  });
}

/**
 * Copy the option values that affect routing, budgets and host components.
 * Invalid values are preserved so the compiler can report them; known keys are
 * snapshotted so a caller mutating its object after `schedule` cannot widen an
 * in-flight compile.
 */
function snapshotCompileOptions(options: LocalCompileOptions | undefined): LocalCompileOptions | undefined {
  if (options === undefined) return undefined;
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) return options;
    const source = options as unknown as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const flag of LOCAL_HTML_FLAGS) {
      if (Object.hasOwn(source, flag)) copy[flag] = source[flag];
    }
    if (Object.hasOwn(source, 'markdownBreaks')) {
      copy.markdownBreaks = source.markdownBreaks;
    }
    if (Object.hasOwn(source, 'limits')) {
      const limits = source.limits;
      if (limits && typeof limits === 'object' && !Array.isArray(limits) && Object.hasOwn(limits, 'maxSyntaxNodes')) {
        copy.limits = { maxSyntaxNodes: (limits as Record<string, unknown>).maxSyntaxNodes };
      } else {
        copy.limits = limits;
      }
    }
    if (Object.hasOwn(source, 'hostComponents')) {
      copy.hostComponents = snapshotHostComponents(source.hostComponents);
    }
    return copy as unknown as LocalCompileOptions;
  } catch {
    // A hostile getter is reported by the compiler itself; keep the original.
    return options;
  }
}

function optionsKeyOf(options: LocalCompileOptions | undefined): string {
  const key = localCompileOptionsKey(options);
  if (key !== 'invalid') return key;
  // Different invalid payloads must still invalidate an in-flight result.
  try {
    return `invalid:${JSON.stringify(options)}`;
  } catch {
    return 'invalid';
  }
}

function createJob(source: string, options: LocalCompileOptions | undefined): CompileJob {
  const snapshot = snapshotCompileOptions(options);
  // Key the original options at schedule time: the snapshot intentionally
  // bounds oversized host arrays, while the key must still distinguish them.
  return { source, options: snapshot, optionsKey: optionsKeyOf(options) };
}

function sameJob(left: CompileJob, right: CompileJob): boolean {
  return left.source === right.source && left.optionsKey === right.optionsKey;
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
  private queued: CompileJob | null = null;
  private inFlight: { id: number; job: CompileJob } | null = null;
  private nextId = 1;
  private pending = false;
  private fallbackSession: LocalCompileSession | null = null;
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

  /**
   * Queue the newest source and its compile options; the previous timer, if
   * any, is replaced. Options are copied so a later mutation cannot change the
   * permissions of an in-flight compile. An options-only edit still supersedes
   * an older result for the same source.
   */
  schedule(source: string, options?: LocalCompileOptions): void {
    if (this.disposed) return;
    this.queued = createJob(source, options);
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
    this.queued = null;
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
    this.fallbackSession?.dispose();
    this.fallbackSession = null;
  }

  private drain(): void {
    if (this.disposed || this.timer !== null || this.inFlight !== null) return;
    const job = this.queued;
    if (job === null) {
      this.setPending(false);
      return;
    }
    this.queued = null;
    this.compile(job);
  }

  private compile(job: CompileJob): void {
    const worker = this.worker;
    if (!worker) {
      this.compileFallback(job);
      return;
    }
    const id = this.nextId++;
    this.inFlight = { id, job };
    try {
      worker.postMessage({
        id,
        source: job.source,
        ...(job.options === undefined ? {} : { options: job.options }),
      });
    } catch (error) {
      this.inFlight = null;
      const detail = `Could not send the source to the compile worker: ${messageOf(error)}`;
      const queued = this.queued;
      if (queued !== null && !sameJob(queued, job)) {
        // A newer source or permission set owns the next result; do not deliver
        // this superseded job after it.
        this.degrade(detail);
        this.finishRun();
        return;
      }
      if (queued !== null) {
        this.queued = null;
        this.clearTimer();
      }
      this.degrade(detail);
      this.compileFallback(job);
    }
  }

  private compileFallback(job: CompileJob): void {
    if (this.disposed) return;
    const started = now();
    let result: LocalCompileResult;
    try {
      const fallbackCompile = this.options.fallbackCompile ?? ((source: string, options?: LocalCompileOptions) => {
        this.fallbackSession ??= createLocalCompileSession();
        return this.fallbackSession.compile(source, options);
      });
      // Keep the historical one-argument call shape when no options were given.
      result = job.options === undefined
        ? fallbackCompile(job.source)
        : fallbackCompile(job.source, job.options);
    } catch (error) {
      result = { ok: false, diagnostics: [compileFailureDiagnostic(error)] };
    }
    this.deliver({
      source: job.source,
      result,
      duration: safeDuration(now() - started),
      mode: 'fallback',
      ...(job.options === undefined ? {} : { options: job.options }),
    });
    this.finishRun();
  }

  private receive(response: LocalCompileResponse): void {
    if (this.disposed) return;
    const inFlight = this.inFlight;
    if (!inFlight || !response || response.id !== inFlight.id) return;
    this.inFlight = null;
    const job = inFlight.job;

    const queued = this.queued;
    if (queued !== null && !sameJob(queued, job)) {
      // A newer source or permission set is waiting; drop this result instead
      // of flashing backwards.
    } else {
      if (queued !== null) {
        // The queued edit compiles to the same source and options, so this
        // result still counts.
        this.queued = null;
        this.clearTimer();
      }
      if (response.ok) {
        this.deliver({
          source: job.source,
          result: response.result,
          duration: safeDuration(response.duration),
          mode: 'worker',
          ...(job.options === undefined ? {} : { options: job.options }),
        });
      } else {
        this.deliver({
          source: job.source,
          result: { ok: false, diagnostics: [compileFailureDiagnostic(response.message)] },
          duration: 0,
          mode: 'worker',
          ...(job.options === undefined ? {} : { options: job.options }),
        });
      }
    }
    this.finishRun();
  }

  private handleWorkerFailure(detail: string): void {
    if (this.disposed) return;
    this.degrade(detail);
    const inFlight = this.inFlight;
    this.inFlight = null;
    if (inFlight && (this.queued === null || sameJob(this.queued, inFlight.job))) {
      if (this.queued !== null) {
        this.queued = null;
        this.clearTimer();
      }
      this.compileFallback(inFlight.job);
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
    this.setPending(this.timer !== null || this.inFlight !== null || this.queued !== null);
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
  const session = createLocalCompileSession();
  target.onmessage = (event) => {
    const request = event?.data;
    if (!request || typeof request.id !== 'number' || typeof request.source !== 'string') return;

    const started = now();
    try {
      const result = request.options === undefined
        ? session.compile(request.source)
        : session.compile(request.source, request.options);
      const duration = safeDuration(now() - started);
      try {
        target.postMessage({ id: request.id, ok: true, result, duration, incremental: session.stats });
      } catch (error) {
        // The result itself may not be cloneable; report the failure instead.
        postFailure(target, request.id, `Could not return the compile result: ${messageOf(error)}`);
      }
    } catch (error) {
      postFailure(target, request.id, messageOf(error));
    }
  };
}
