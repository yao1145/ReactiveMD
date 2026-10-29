import { createLocalCompileSession, type LocalCompileSession, type LocalIncrementalStats } from './incremental';
import {
  applyLocalResultPatch,
  cloneLocalCompileResult,
  diffSourceEdit,
  encodeLocalResultPatch,
  LOCAL_RESULT_PATCH_PROTOCOL,
  type LocalResultPatch,
  type LocalSourceEdit,
} from './compile-patch';
import { MAX_LOCAL_HOST_COMPONENTS, MAX_LOCAL_HOST_ENUM_VALUES } from './limits';
import { LOCAL_HTML_FLAGS, localCompileOptionsKey } from './options';
import type { Diagnostic, LocalCompileOptions, LocalCompileResult } from './types';

/** Editors are coalesced for this long before a compile is dispatched. */
export const LOCAL_COMPILE_DELAY_MS = 150;

/**
 * Idle delay after a successful result before the worker asks the session to
 * prepare the next revision. A new request cancels the pending preparation.
 */
export const LOCAL_COMPILE_PREPARATION_DELAY_MS = 200;

/** Extra limits this transport snapshots before another module adds them. */
const LIMIT_KEYS = ['maxSyntaxNodes', 'maxParseWork', 'maxMarkdownDepth'] as const;

export type LocalCompileProtocol = typeof LOCAL_RESULT_PATCH_PROTOCOL;

export interface LocalCompileRequest {
  id: number;
  source: string;
  /**
   * Capability flags, Markdown break handling, limits and host component
   * schemas for this compile. `hostComponents` selects the host leaf tags the
   * parser may build; `markdownBreaks` turns soft breaks into `break` nodes.
   */
  options?: LocalCompileOptions;
  /**
   * Advertised by a client that understands `patch-v1`. A worker echoes its
   * support on the full response, after which both sides may exchange edits
   * and result patches. Older peers simply omit the field.
   */
  protocol?: LocalCompileProtocol;
  /** Client-assigned revision of this source. Echoed by a `patch-v1` worker. */
  revision?: number;
}

/** An incremental request; only sent once a `patch-v1` worker was confirmed. */
export interface LocalCompilePatchRequest {
  id: number;
  protocol: LocalCompileProtocol;
  /** Revision of the complete source this edit applies to. */
  baseRevision: number;
  /** Revision of the resulting source. */
  revision: number;
  /** UTF-16 replacement, not a byte or code-point offset. */
  edit: LocalSourceEdit;
  /** Cheap guard that the edit produced the source the scheduler intended. */
  targetLength?: number;
  /** Options signature of the baseline; a mismatch asks for a full compile. */
  optionsKey?: string;
}

export type LocalCompileWorkerRequest = LocalCompileRequest | LocalCompilePatchRequest;

export interface LocalCompileWorkerMetrics {
  /** Time spent inside the compile call, mirroring `duration`. */
  compileMs?: number;
  /** Time spent encoding a result patch. */
  patchEncodeMs?: number;
  /** Node records in the result patch. */
  patchNodes?: number;
  /** Time of the most recent idle preparation, when one completed. */
  preparationMs?: number;
}

export interface LocalCompileMetrics {
  /** Schedule to dispatch, including the debounce window. */
  queueMs?: number;
  /** Dispatch to receive, including worker compile and transport. */
  roundTripMs?: number;
  /** Result patch decode/apply on the receiving thread. */
  applyMs?: number;
  /** Worker-reported stages; never a DOM input latency measurement. */
  worker?: LocalCompileWorkerMetrics;
}

export interface LocalCompilePatchResponse {
  id: number;
  ok: true;
  protocol: LocalCompileProtocol;
  baseRevision: number;
  revision: number;
  patch: LocalResultPatch;
  duration: number;
  incremental?: Readonly<LocalIncrementalStats>;
  metrics?: LocalCompileWorkerMetrics;
}

export type LocalCompileResponse =
  | {
      id: number;
      ok: true;
      result: LocalCompileResult;
      duration: number;
      incremental?: Readonly<LocalIncrementalStats>;
      protocol?: LocalCompileProtocol;
      revision?: number;
      metrics?: LocalCompileWorkerMetrics;
    }
  | {
      id: number;
      ok: false;
      message: string;
      /** The request cannot be served incrementally; resend the full source. */
      retryFull?: boolean;
      code?: string;
      /** Worker's current revision, for diagnostics and recovery. */
      revision?: number;
    };

/**
 * Everything the worker may post. `LocalCompileResponse` stays the classic
 * complete/failure union so existing scopes and test doubles keep their exact
 * full-result typing; patch frames are layered on top rather than embedded in
 * the full result shape.
 */
export type LocalCompileWorkerResponse = LocalCompileResponse | LocalCompilePatchResponse;

/**
 * The small surface the scheduler needs from a Worker. Events stay untyped so
 * the core declarations compile without the DOM library.
 */
export interface LocalCompileWorker {
  postMessage(message: LocalCompileWorkerRequest): void;
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
  /** Stage timings; absent on peers that do not report metrics. */
  metrics?: LocalCompileMetrics;
  /** Source revision when the worker negotiated `patch-v1`. */
  revision?: number;
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
  /**
   * Opt into the internal read-only result graph. Off by default, where every
   * `onResult` receives an independent deep copy and may mutate it freely.
   */
  shareResults?: boolean;
}

interface CompileJob {
  source: string;
  /** Copied at schedule time so later caller mutation cannot change permissions or host schemas. */
  options?: LocalCompileOptions;
  /** Canonical options signature used to detect options-only edits. */
  optionsKey: string;
  /** When `schedule` was called; used for queue metrics only. */
  scheduledAt: number;
  /** Full-result recovery attempts for this job (bounded to one). */
  recovery?: number;
}

interface InFlightJob {
  id: number;
  job: CompileJob;
  startedAt: number;
  revision: number;
}

interface CompileBaseline {
  source: string;
  optionsKey: string;
  revision: number;
  result: LocalCompileResult;
}

type PatchState = 'unknown' | 'enabled' | 'disabled' | 'legacy';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
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
 * in-flight compile. `maxParseWork` and `maxMarkdownDepth` are copied even
 * before their declarations land, so a queued job keeps its own budget.
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
      if (limits && typeof limits === 'object' && !Array.isArray(limits)) {
        const limitCopy: Record<string, unknown> = {};
        for (const key of LIMIT_KEYS) {
          if (Object.hasOwn(limits, key)) limitCopy[key] = (limits as Record<string, unknown>)[key];
        }
        copy.limits = limitCopy;
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

function limitsKeyPart(options: LocalCompileOptions | undefined): string {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return '';
    const limits = (options as unknown as Record<string, unknown>).limits;
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return '';
    const part = (key: string): string => {
      const record = limits as Record<string, unknown>;
      if (!Object.hasOwn(record, key) || record[key] === undefined) return '-';
      const value = record[key];
      return `${typeof value}:${String(value)}`;
    };
    return `:${part('maxParseWork')}:${part('maxMarkdownDepth')}`;
  } catch {
    return ':unreadable';
  }
}

function baseOptionsKey(options: LocalCompileOptions | undefined): string {
  const key = localCompileOptionsKey(options);
  if (key !== 'invalid') return key;
  // Different invalid payloads must still invalidate an in-flight result.
  try {
    return `invalid:${JSON.stringify(options)}`;
  } catch {
    return 'invalid';
  }
}

/**
 * Canonical job/transport signature. Extends the compiler's public key with
 * the newer per-compile budgets once they exist, without modifying options.ts.
 */
export function localWorkerOptionsKey(options: LocalCompileOptions | undefined): string {
  return `${baseOptionsKey(options)}${limitsKeyPart(options)}`;
}

function createJob(source: string, options: LocalCompileOptions | undefined): CompileJob {
  const snapshot = snapshotCompileOptions(options);
  // Key the snapshot that is actually sent: a bounded oversized host array
  // must produce the same signature on both sides of the worker boundary.
  return {
    source,
    options: snapshot,
    optionsKey: localWorkerOptionsKey(snapshot),
    scheduledAt: now(),
  };
}

function sameJob(left: CompileJob, right: CompileJob): boolean {
  return left.source === right.source && left.optionsKey === right.optionsKey;
}

function isCompileResult(value: unknown): value is LocalCompileResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as { ok?: unknown; diagnostics?: unknown; document?: unknown };
  if (typeof result.ok !== 'boolean' || !Array.isArray(result.diagnostics)) return false;
  if (result.ok && (!result.document || typeof result.document !== 'object')) return false;
  return true;
}

function isPatchResponse(response: LocalCompileWorkerResponse): response is LocalCompilePatchResponse {
  return response.ok && 'patch' in response && response.patch !== undefined;
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
 *
 * Once a worker advertises `patch-v1`, subsequent dispatches send a UTF-16
 * edit against the last accepted revision and receive a result patch. Failed
 * applies are recovered once with a complete request; legacy workers keep
 * receiving complete sources forever.
 */
export class LocalCompileScheduler {
  private readonly options: LocalCompileSchedulerOptions;
  private readonly delay: number;
  private worker: LocalCompileWorker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queued: CompileJob | null = null;
  private inFlight: InFlightJob | null = null;
  private nextId = 1;
  private nextRevision = 1;
  private pending = false;
  private fallbackSession: LocalCompileSession | null = null;
  private disposed = false;
  private baseline: CompileBaseline | null = null;
  private patchState: PatchState = 'unknown';

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
    this.resetProtocol();
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
    const revision = this.nextRevision++;
    const startedAt = now();
    const baseline = this.baseline;
    const usePatch = this.patchState === 'enabled'
      && baseline !== null
      && baseline.optionsKey === job.optionsKey;
    const request: LocalCompileWorkerRequest = usePatch
      ? {
          id,
          protocol: LOCAL_RESULT_PATCH_PROTOCOL,
          baseRevision: baseline!.revision,
          revision,
          edit: diffSourceEdit(baseline!.source, job.source) ?? { from: 0, to: 0, insert: '' },
          targetLength: job.source.length,
          optionsKey: job.optionsKey,
        }
      : {
          id,
          source: job.source,
          ...(job.options === undefined ? {} : { options: job.options }),
          protocol: LOCAL_RESULT_PATCH_PROTOCOL,
          revision,
        };
    this.inFlight = { id, job, startedAt, revision };
    try {
      worker.postMessage(request);
    } catch (error) {
      this.inFlight = null;
      const detail = `Could not send the source to the compile worker: ${messageOf(error)}`;
      const queued = this.queued;
      if (queued !== null && !sameJob(queued, job)) {
        // A newer source or permission set owns the next result; do not deliver
        // this superseded job after it.
        this.resetProtocol();
        this.degrade(detail);
        this.finishRun();
        return;
      }
      if (queued !== null) {
        this.queued = null;
        this.clearTimer();
      }
      this.resetProtocol();
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
      metrics: { queueMs: safeDuration(started - job.scheduledAt) },
    });
    this.finishRun();
  }

  private receive(response: LocalCompileWorkerResponse): void {
    if (this.disposed) return;
    const inFlight = this.inFlight;
    if (!inFlight || !response || response.id !== inFlight.id) return;
    this.inFlight = null;
    const job = inFlight.job;
    const receivedAt = now();
    const roundTripMs = safeDuration(receivedAt - inFlight.startedAt);
    const queueMs = safeDuration(inFlight.startedAt - job.scheduledAt);

    let result: LocalCompileResult | null = null;
    let applyMs = 0;
    let failure: string | null = null;
    const mode: LocalCompileMode = 'worker';
    let revision: number | undefined;

    if (response.ok) {
      if (isPatchResponse(response)) {
        const patchStarted = now();
        const applied = this.applyResponsePatch(job, response);
        applyMs = safeDuration(now() - patchStarted);
        if (applied !== null) {
          result = applied;
          revision = response.revision;
        }
      } else {
        const full = response as Extract<LocalCompileResponse, { ok: true }>;
        if (!isCompileResult(full.result)) {
          failure = 'The compile worker returned an invalid result';
        } else {
          result = full.result;
          revision = typeof full.revision === 'number' ? full.revision : undefined;
          if (
            full.protocol === LOCAL_RESULT_PATCH_PROTOCOL
            && typeof full.revision === 'number'
            && Number.isSafeInteger(full.revision)
          ) {
            this.patchState = 'enabled';
            this.baseline = full.result.ok
              ? {
                  source: job.source,
                  optionsKey: job.optionsKey,
                  revision: full.revision,
                  result: full.result,
                }
              : null;
          } else {
            // A worker that does not echo the protocol stays on complete results.
            this.patchState = 'legacy';
            this.baseline = null;
          }
        }
      }
    } else if (response.retryFull !== true) {
      failure = response.message;
    }

    const queued = this.queued;
    const superseded = queued !== null && !sameJob(queued, job);
    if (queued !== null && !superseded) {
      // The queued edit compiles to the same source and options, so this
      // result still counts.
      this.queued = null;
      this.clearTimer();
    }

    if (result !== null) {
      if (!superseded) {
        this.deliver({
          source: job.source,
          result,
          duration: safeDuration(response.ok ? response.duration : 0),
          mode,
          ...(job.options === undefined ? {} : { options: job.options }),
          metrics: {
            queueMs,
            roundTripMs,
            ...(applyMs > 0 ? { applyMs } : {}),
            ...(response.ok && response.metrics ? { worker: response.metrics } : {}),
          },
          ...(revision === undefined ? {} : { revision }),
        });
      }
      this.finishRun();
      return;
    }

    if (failure !== null) {
      if (!superseded) {
        this.deliver({
          source: job.source,
          result: { ok: false, diagnostics: [compileFailureDiagnostic(failure)] },
          duration: 0,
          mode,
          ...(job.options === undefined ? {} : { options: job.options }),
          metrics: { queueMs, roundTripMs },
        });
      }
      this.finishRun();
      return;
    }

    if (!superseded && this.recoverWithFullResult(job)) return;
    if (!superseded) {
      // One bounded retry was already spent: never loop on protocol errors.
      this.patchState = 'disabled';
      this.baseline = null;
      this.deliver({
        source: job.source,
        result: {
          ok: false,
          diagnostics: [compileFailureDiagnostic('The compile worker could not apply an incremental result patch')],
        },
        duration: 0,
        mode,
        ...(job.options === undefined ? {} : { options: job.options }),
        metrics: { queueMs, roundTripMs, ...(applyMs > 0 ? { applyMs } : {}) },
      });
    } else {
      // A newer job is waiting; it will be dispatched from a clean full state.
      this.resetProtocol();
    }
    this.finishRun();
  }

  /**
   * Apply a patch response against the last accepted baseline. Returns null
   * for any mismatch so the caller can resend a complete source once.
   */
  private applyResponsePatch(job: CompileJob, response: LocalCompilePatchResponse): LocalCompileResult | null {
    const baseline = this.baseline;
    if (
      baseline === null
      || baseline.optionsKey !== job.optionsKey
      || !Number.isSafeInteger(response.revision)
      || response.revision <= baseline.revision
      || response.baseRevision !== baseline.revision
      || response.protocol !== LOCAL_RESULT_PATCH_PROTOCOL
    ) {
      return null;
    }
    const applied = applyLocalResultPatch(baseline.result, response.patch);
    if (applied === null) return null;
    // The applied source must be exactly the queued source; anything else is
    // a misaligned edit and must not enter the revision chain.
    if (!applied.ok || applied.document.source !== job.source) return null;
    this.baseline = {
      source: job.source,
      optionsKey: job.optionsKey,
      revision: response.revision,
      result: applied,
    };
    return applied;
  }

  /** Re-dispatch the same job with a complete source, at most once per job. */
  private recoverWithFullResult(job: CompileJob): boolean {
    if (this.worker === null || (job.recovery ?? 0) >= 1) return false;
    const queued = this.queued;
    if (queued !== null && !sameJob(queued, job)) return false;
    if (queued !== null) {
      this.queued = null;
      this.clearTimer();
    }
    this.resetProtocol();
    this.compile({ ...job, recovery: (job.recovery ?? 0) + 1 });
    return true;
  }

  private handleWorkerFailure(detail: string): void {
    if (this.disposed) return;
    this.resetProtocol();
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

  private resetProtocol(): void {
    this.baseline = null;
    this.patchState = 'unknown';
  }

  private finishRun(): void {
    if (this.disposed) return;
    this.drain();
    if (this.disposed) return;
    this.setPending(this.timer !== null || this.inFlight !== null || this.queued !== null);
  }

  private deliver(outcome: LocalCompileOutcome): void {
    if (this.disposed) return;
    // Only the scheduler's patch baseline is retained. Everything else is
    // already independent (a worker message or a fresh fallback compile).
    // `shareResults` is an explicit opt-in to the internal read-only graph.
    const retained = this.baseline !== null && this.baseline.result === outcome.result;
    const result = this.options.shareResults === true || !retained
      ? outcome.result
      : cloneLocalCompileResult(outcome.result);
    this.options.onResult({ ...outcome, result });
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
  /** Classic full/failure shape; patch frames are delivered to patch-v1 clients. */
  postMessage(message: LocalCompileResponse): void;
}

export interface LocalCompileWorkerControlMessage {
  readonly control: 'dispose' | 'cancel-preparation';
}

export interface LocalCompileWorkerControl {
  dispose(): void;
  cancelPreparation(): void;
  readonly disposed: boolean;
}

export interface LocalCompileWorkerOptions {
  /** Test seam; production uses `createLocalCompileSession`. */
  createSession?(): LocalCompileSession;
  /** Idle delay before session preparation; defaults to `LOCAL_COMPILE_PREPARATION_DELAY_MS`. */
  preparationDelay?: number;
}

/** Optional session methods the main implementation may add later. */
interface LocalCompileSessionExtensions {
  compileShared?(source: string, options?: LocalCompileOptions): LocalCompileResult;
  prepareAsync?(
    signal?: { readonly aborted: boolean },
    yieldTask?: () => Promise<void>,
  ): Promise<boolean>;
}

interface WorkerState {
  source: string;
  revision: number;
  options?: LocalCompileOptions;
  optionsKey: string;
  result: LocalCompileResult;
}

function compileWithSession(
  session: LocalCompileSession,
  source: string,
  options?: LocalCompileOptions,
): LocalCompileResult {
  const extended = session as LocalCompileSession & LocalCompileSessionExtensions;
  return typeof extended.compileShared === 'function'
    ? extended.compileShared(source, options)
    : session.compile(source, options);
}

function sessionStats(session: LocalCompileSession): Readonly<LocalIncrementalStats> {
  return session.stats;
}

function postFailure(scope: LocalCompileWorkerScope, id: number, message: string): void {
  try {
    scope.postMessage({ id, ok: false, message });
  } catch {
    /* A scope that cannot receive the failure response is already broken. */
  }
}

function postRetryableFailure(
  scope: LocalCompileWorkerScope,
  id: number,
  message: string,
  code: string,
  revision: number | undefined,
): void {
  try {
    scope.postMessage({
      id,
      ok: false,
      message,
      retryFull: true,
      code,
      ...(revision === undefined ? {} : { revision }),
    });
  } catch {
    /* A scope that cannot receive the failure response is already broken. */
  }
}

function isControlMessage(value: unknown): value is LocalCompileWorkerControlMessage {
  return !!value && typeof value === 'object' && (
    (value as { control?: unknown }).control === 'dispose'
    || (value as { control?: unknown }).control === 'cancel-preparation'
  );
}

function isPatchEdit(value: unknown): value is LocalSourceEdit {
  if (!value || typeof value !== 'object') return false;
  const edit = value as { from?: unknown; to?: unknown; insert?: unknown };
  return typeof edit.from === 'number' && Number.isSafeInteger(edit.from)
    && typeof edit.to === 'number' && Number.isSafeInteger(edit.to)
    && edit.from >= 0 && edit.to >= edit.from
    && typeof edit.insert === 'string';
}

/**
 * Install the worker-side compile handler on a DedicatedWorkerGlobalScope-like
 * object. Returns a cleanup handle (ignored by existing callers) and accepts
 * `{control: 'dispose' | 'cancel-preparation'}` messages for transports that
 * prefer lifecycle messages over the handle.
 */
export function startLocalCompileWorker(
  scope?: LocalCompileWorkerScope,
  options: LocalCompileWorkerOptions = {},
): LocalCompileWorkerControl {
  const target = scope === undefined ? (globalThis as unknown as LocalCompileWorkerScope) : scope;
  if (!target || typeof target.postMessage !== 'function') {
    throw new TypeError('startLocalCompileWorker requires a worker scope with postMessage');
  }
  const session = options.createSession ? options.createSession() : createLocalCompileSession();
  const extensions = session as LocalCompileSession & LocalCompileSessionExtensions;
  const requestedDelay = options.preparationDelay;
  const preparationDelay = typeof requestedDelay === 'number' && Number.isFinite(requestedDelay)
    ? Math.max(0, requestedDelay)
    : LOCAL_COMPILE_PREPARATION_DELAY_MS;
  const canPrepareAsync = typeof extensions.prepareAsync === 'function';

  let current: WorkerState | null = null;
  let lastRevision = 0;
  let disposed = false;
  let preparationTimer: ReturnType<typeof setTimeout> | null = null;
  let preparationSignal: { aborted: boolean } | null = null;
  let preparationToken = 0;
  let preparationMs: number | undefined;

  const cancelPreparation = (): void => {
    preparationToken += 1;
    if (preparationSignal !== null) {
      preparationSignal.aborted = true;
      preparationSignal = null;
    }
    if (preparationTimer !== null) {
      clearTimeout(preparationTimer);
      preparationTimer = null;
    }
  };

  const yieldTask = (): Promise<void> => new Promise<void>((resolve) => {
    if (typeof setTimeout === 'function') setTimeout(resolve, 0);
    else resolve();
  });

  const runPreparation = async (token: number): Promise<void> => {
    if (disposed || token !== preparationToken) return;
    const prepare = extensions.prepareAsync;
    if (typeof prepare !== 'function') return;
    const signal = { aborted: false };
    preparationSignal = signal;
    const started = now();
    let prepared = false;
    try {
      prepared = await prepare.call(extensions, signal, yieldTask);
    } catch {
      // Preparation is opportunistic; a compile error must not become a
      // worker failure, and the next edit simply compiles normally.
    } finally {
      if (preparationSignal === signal) preparationSignal = null;
      if (prepared && !signal.aborted && !disposed && token === preparationToken) {
        preparationMs = safeDuration(now() - started);
      }
    }
  };

  const schedulePreparation = (): void => {
    if (disposed || !canPrepareAsync) return;
    cancelPreparation();
    const token = preparationToken;
    preparationTimer = setTimeout(() => {
      preparationTimer = null;
      void runPreparation(token);
    }, preparationDelay);
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    cancelPreparation();
    try {
      session.dispose();
    } catch {
      /* a disposed session is already unusable */
    }
    target.onmessage = null;
  };

  const workerMetrics = (compileMs: number): LocalCompileWorkerMetrics => ({
    compileMs,
    ...(preparationMs === undefined ? {} : { preparationMs }),
  });

  const resolveRevision = (value: unknown): number => {
    const candidate = typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : null;
    if (candidate === null) return lastRevision + 1;
    return candidate > lastRevision ? candidate : lastRevision + 1;
  };

  const respondFull = (
    id: number,
    revision: number,
    compileMs: number,
    negotiated: boolean,
  ): boolean => {
    const state = current;
    if (state === null) return false;
    const duration = safeDuration(compileMs);
    try {
      const response: LocalCompileResponse = negotiated
        ? {
            id,
            ok: true,
            result: state.result,
            duration,
            incremental: sessionStats(session),
            protocol: LOCAL_RESULT_PATCH_PROTOCOL,
            revision,
            metrics: workerMetrics(duration),
          }
        : {
            id,
            ok: true,
            result: state.result,
            duration,
            incremental: sessionStats(session),
          };
      target.postMessage(response);
      return true;
    } catch (error) {
      // The result itself may not be cloneable; report the failure instead.
      postFailure(target, id, `Could not return the compile result: ${messageOf(error)}`);
      return false;
    }
  };

  target.onmessage = (event) => {
    const request = event?.data;
    if (isControlMessage(request)) {
      if (request.control === 'dispose') cleanup();
      else cancelPreparation();
      return;
    }
    if (!request || typeof request.id !== 'number') return;

    // A complete source always resets the incremental chain.
    if (typeof request.source === 'string') {
      cancelPreparation();
      const full = request as LocalCompileRequest;
      const snapshot = snapshotCompileOptions(full.options);
      const optionsKey = localWorkerOptionsKey(full.options);
      const negotiated = full.protocol === LOCAL_RESULT_PATCH_PROTOCOL;
      const revision = resolveRevision(full.revision);
      const started = now();
      try {
        if (current !== null && current.optionsKey !== optionsKey) {
          // The compiler's public option key does not yet include every budget
          // field; drop a cache built under different permissions or limits.
          try {
            session.clear();
          } catch {
            /* a session without clear simply recompiles */
          }
        }
        const result = compileWithSession(session, full.source, snapshot);
        const compileMs = safeDuration(now() - started);
        lastRevision = revision;
        current = {
          source: full.source,
          revision,
          options: snapshot,
          optionsKey,
          result,
        };
        if (respondFull(full.id, revision, compileMs, negotiated)) {
          schedulePreparation();
        }
      } catch (error) {
        postFailure(target, full.id, messageOf(error));
      }
      return;
    }

    if (request.protocol !== LOCAL_RESULT_PATCH_PROTOCOL) return;
    cancelPreparation();
    const patchRequest = request as LocalCompilePatchRequest;
    const state = current;
    const retry = (message: string, code: string): void => {
      postRetryableFailure(target, patchRequest.id, message, code, state?.revision);
    };
    if (state === null) {
      retry('No complete compile is available to patch', 'stale-base');
      return;
    }
    if (
      typeof patchRequest.baseRevision !== 'number'
      || patchRequest.baseRevision !== state.revision
    ) {
      retry('The requested base revision is not current', 'stale-base');
      return;
    }
    if (patchRequest.optionsKey !== undefined && patchRequest.optionsKey !== state.optionsKey) {
      retry('The options signature changed since the baseline', 'options-mismatch');
      return;
    }
    if (!isPatchEdit(patchRequest.edit)) {
      retry('The source edit is invalid', 'invalid-edit');
      return;
    }
    const edit = patchRequest.edit;
    if (edit.to > state.source.length) {
      retry('The source edit does not fit the baseline', 'invalid-edit');
      return;
    }
    const nextSource = state.source.slice(0, edit.from) + edit.insert + state.source.slice(edit.to);
    if (
      typeof patchRequest.targetLength === 'number'
      && nextSource.length !== patchRequest.targetLength
    ) {
      retry('The source edit produced an unexpected length', 'invalid-edit');
      return;
    }
    const revision = resolveRevision(patchRequest.revision);
    const started = now();
    try {
      const result = compileWithSession(session, nextSource, state.options);
      const compileMs = safeDuration(now() - started);
      const baseRevision = state.revision;
      const baseResult = state.result;
      lastRevision = revision;
      current = {
        source: nextSource,
        revision,
        options: state.options,
        optionsKey: state.optionsKey,
        result,
      };
      let patch: LocalResultPatch | null = null;
      let patchEncodeMs = 0;
      if (result.ok && baseResult.ok) {
        const encodeStarted = now();
        patch = encodeLocalResultPatch(baseResult, result);
        patchEncodeMs = safeDuration(now() - encodeStarted);
      }
      if (patch === null) {
        // A failed/cached-exception result cannot be patched; the complete
        // result still keeps the revision chain usable.
        if (respondFull(patchRequest.id, revision, compileMs, true)) {
          schedulePreparation();
        }
        return;
      }
      const metrics: LocalCompileWorkerMetrics = {
        compileMs,
        patchEncodeMs,
        patchNodes: patch.document.nodes?.length ?? 0,
        ...(preparationMs === undefined ? {} : { preparationMs }),
      };
      try {
        const response: LocalCompilePatchResponse = {
          id: patchRequest.id,
          ok: true,
          protocol: LOCAL_RESULT_PATCH_PROTOCOL,
          baseRevision,
          revision,
          patch,
          duration: compileMs,
          incremental: sessionStats(session),
          metrics,
        };
        // Patch frames only reach a client that negotiated patch-v1, so this
        // cast keeps the classic scope contract for every existing caller.
        target.postMessage(response as unknown as LocalCompileResponse);
        schedulePreparation();
      } catch (error) {
        postFailure(target, patchRequest.id, `Could not return the compile result: ${messageOf(error)}`);
      }
    } catch (error) {
      postFailure(target, patchRequest.id, messageOf(error));
    }
  };

  return {
    dispose: cleanup,
    cancelPreparation,
    get disposed(): boolean {
      return disposed;
    },
  };
}
