import {
  applyLocalResultPatch,
  cloneLocalCompileResult,
  diffSourceEdit,
  LOCAL_RESULT_PATCH_PROTOCOL,
  type LocalResultPatch,
  type LocalSourceEdit,
} from './compile-patch';
import {
  decodeFlatCompiledData,
  FLAT_COMPILED_DATA_PROTOCOL,
  type FlatCompiledData,
} from './flat-compiled-data';
import type { Diagnostic, LocalCompileOptions, LocalCompileResult } from '../types';
import type { AuthorAnalysis } from '../source/authoring';
import {
  createLocalCompileSession,
  type LocalCompileSession,
  type LocalIncrementalStats,
} from '../compilation/session/incremental';
import {
  analyzeResult,
  LOCAL_COMPILE_DELAY_MS,
  localWorkerOptionsKey,
  messageOf,
  now,
  safeDuration,
  snapshotCompileOptions,
} from './worker-job';
import { isPatchEdit } from './worker-handler';

export type LocalCompileProtocol = typeof LOCAL_RESULT_PATCH_PROTOCOL;

export interface LocalCompileRequest {
  /** Opt into depth-independent full results. Absent on legacy clients. */
  flatResults?: typeof FLAT_COMPILED_DATA_PROTOCOL;
  /** Return authoring data from the same compiled document. Off by default. */
  includeAuthorAnalysis?: boolean;
  id: number;
  source: string;
  /**
   * Capability flags, Markdown break handling, strict recovery mode, limits
   * and host component schemas for this compile. `hostComponents` selects the
   * host leaf tags the parser may build; `markdownBreaks` turns soft breaks
   * into `break` nodes; `strict: false` selects the complete tolerant-recovery
   * reference path.
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
  includeAuthorAnalysis?: boolean;
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
  analysisMs?: number;
  /** Time spent inside the compile call, mirroring `duration`. */
  compileMs?: number;
  /** Time spent encoding a result patch. */
  patchEncodeMs?: number;
  /** Node records in the result patch. */
  patchNodes?: number;
  /**
   * Set when a complete result was sent instead of a patch because the patch
   * was estimated to be no cheaper. This is a transport choice for the same
   * revision, never an error or a retry; the patch* estimates describe the
   * discarded patch.
   */
  patchFallback?: 'cost';
  /** Estimated serialized characters of the discarded patch payload. */
  patchBytes?: number;
  /** Estimated serialized characters of the complete result payload. */
  fullBytes?: number;
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
  analysis?: AuthorAnalysis;
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
      analysis?: AuthorAnalysis;
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
export type LocalCompileFlatResponse = Omit<Extract<LocalCompileResponse,{ok:true}>,'result'> & {flatResult:FlatCompiledData};

export type LocalCompileWorkerResponse = LocalCompileResponse | LocalCompilePatchResponse | LocalCompileFlatResponse;

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
  analysis?: AuthorAnalysis;
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
  includeAuthorAnalysis?: boolean;
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
  editHint?: LocalCompileEditHint;
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

/** Optional native-editor transaction; discarded when its baseline differs. */
export interface LocalCompileEditHint {
  baseSource: string;
  edit: LocalSourceEdit;
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

function validAnalysis(value: unknown, length: number): value is AuthorAnalysis {
  if (!value || typeof value !== 'object') return false;
  const data = value as AuthorAnalysis;
  const range = (r: any) => r && Number.isSafeInteger(r.start) && Number.isSafeInteger(r.end)
    && r.start >= 0 && r.end >= r.start && r.end <= length;
  if (!Array.isArray(data.tokens) || data.tokens.length > length + 1 || !Array.isArray(data.bindings)
    || data.bindings.length > length + 1 || !Array.isArray(data.diagnostics)) return false;
  let end = 0, count = 0;
  for (const token of data.tokens) {
    if (!token || typeof token.kind !== 'string' || !range(token.range) || token.range.start < end) return false;
    end = token.range.end;
  }
  for (const binding of data.bindings) {
    if (!binding || typeof binding.name !== 'string' || !Array.isArray(binding.declarations) || !Array.isArray(binding.references)) return false;
    count += binding.declarations.length + binding.references.length;
    if (count > length + 1 || !binding.declarations.every(range) || !binding.references.every(range)) return false;
  }
  return true;
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
  schedule(source: string, options?: LocalCompileOptions, hint?: LocalCompileEditHint): void {
    if (this.disposed) return;
    this.queued = createJob(source, options);
    if (hint && typeof hint.baseSource === 'string' && isPatchEdit(hint.edit) && hint.edit.to <= hint.baseSource.length
      && hint.baseSource.slice(0, hint.edit.from) + hint.edit.insert + hint.baseSource.slice(hint.edit.to) === source) {
      this.queued.editHint = { baseSource: hint.baseSource, edit: { ...hint.edit } };
    }
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
          edit: job.editHint?.baseSource === baseline!.source ? job.editHint.edit
            : diffSourceEdit(baseline!.source, job.source) ?? { from: 0, to: 0, insert: '' },
          targetLength: job.source.length,
          optionsKey: job.optionsKey,
        }
      : {
          id,
          source: job.source,
          ...(job.options === undefined ? {} : { options: job.options }),
          protocol: LOCAL_RESULT_PATCH_PROTOCOL,
          revision,
          flatResults: FLAT_COMPILED_DATA_PROTOCOL,
        };
    this.inFlight = { id, job, startedAt, revision };
    if (this.options.includeAuthorAnalysis) request.includeAuthorAnalysis = true;
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
      ...(this.options.includeAuthorAnalysis ? { analysis: analyzeResult(job.source, job.options, result) } : {}),
      ...(job.options === undefined ? {} : { options: job.options }),
      metrics: { queueMs: safeDuration(started - job.scheduledAt) },
    });
    this.finishRun();
  }

  private receive(wireResponse: LocalCompileWorkerResponse): void {
    if (this.disposed) return;
    const inFlight = this.inFlight;
    if (!inFlight || !wireResponse || wireResponse.id !== inFlight.id) return;
    let response:LocalCompileResponse|LocalCompilePatchResponse;
    let flatApplyMs=0;
    if(wireResponse.ok&&'flatResult'in wireResponse){
      const started=now();
      const decoded=decodeFlatCompiledData(wireResponse.flatResult);
      flatApplyMs=safeDuration(now()-started);
      response=isCompileResult(decoded)
        ?{...wireResponse,result:decoded}
        :{id:wireResponse.id,ok:false,retryFull:true,message:'Invalid flat compile result'};
    }else response=wireResponse;
    this.inFlight = null;
    const job = inFlight.job;
    const receivedAt = now();
    const roundTripMs = safeDuration(receivedAt - inFlight.startedAt);
    const queueMs = safeDuration(inFlight.startedAt - job.scheduledAt);

    let result: LocalCompileResult | null = null;
    let applyMs = flatApplyMs;
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
          ...(response.ok && this.options.includeAuthorAnalysis && validAnalysis(response.analysis, job.source.length) ? { analysis: response.analysis } : {}),
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

export { startLocalCompileWorker } from "./worker-handler";

export type { LocalCompileWorkerScope, LocalCompileWorkerControlMessage, LocalCompileWorkerControl, LocalCompileWorkerOptions } from "./worker-handler";

export { LOCAL_COMPILE_DELAY_MS, LOCAL_COMPILE_PREPARATION_DELAY_MS, messageOf, now, safeDuration, analyzeResult, snapshotCompileOptions, localWorkerOptionsKey } from "./worker-job";
