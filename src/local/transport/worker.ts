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
import type { Diagnostic, LocalCompileOptions, LocalCompileResult, LocalSourcePhase } from '../types';
import { createLocalObservabilityDiagnostic } from '../observability';
import { createLocalTraceId, emitLocalDiagnostic, emitLocalTrace, type LocalObserver, type LocalTraceEvent } from '../observability-core';
import type { AuthorAnalysis } from '../source/authoring';
import { localCodeUnitPrefix } from '../source/source-context';
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
  traceId?: string;
  /** Alias of id for trace consumers. */
  requestId?: number;
  sourceRevision?: number;
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
   * Source generation phase. Omitted keeps the legacy final compile: the
   * response then has the historical shape without `status`. `streaming`
   * returns the provisional snapshot in the result itself; the transport does
   * not alter or patch it.
   */
  sourcePhase?: LocalSourcePhase;
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
  traceId?: string;
  requestId?: number;
  sourceRevision?: number;
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
  traceId?: string;
  requestId?: number;
  sourceRevision?: number;
  analysis?: AuthorAnalysis;
  id: number;
  ok: true;
  protocol: LocalCompileProtocol;
  baseRevision: number;
  revision: number;
  patch: LocalResultPatch;
  duration: number;
  /** Phase of the result this patch extends; present when the client asked for one. */
  sourcePhase?: LocalSourcePhase;
  incremental?: Readonly<LocalIncrementalStats>;
  metrics?: LocalCompileWorkerMetrics;
}

export type LocalCompileResponse =
  | {
      id: number;
      traceId?: string;
      requestId?: number;
      sourceRevision?: number;
      ok: true;
      result: LocalCompileResult;
      duration: number;
      /** Echo of the request phase; omitted for legacy clients. */
      sourcePhase?: LocalSourcePhase;
      incremental?: Readonly<LocalIncrementalStats>;
      protocol?: LocalCompileProtocol;
      revision?: number;
      metrics?: LocalCompileWorkerMetrics;
      analysis?: AuthorAnalysis;
    }
  | {
      id: number;
      traceId?: string;
      requestId?: number;
      sourceRevision?: number;
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
  /**
   * Set for streaming snapshots and for callers that supplied a phase
   * themselves. Legacy final jobs omit it and keep the historical shape.
   */
  sourcePhase?: LocalSourcePhase;
}

export interface LocalCompileSchedulerOptions {
  observer?: LocalObserver;
  timeoutMs?: number;
  includeAuthorAnalysis?: boolean;
  createWorker(): LocalCompileWorker;
  /**
   * Defaults to compileLocal. Runs on the main thread only when the worker is
   * unavailable or failed. One- and two-argument callbacks remain supported;
   * an explicit source phase is passed as the third argument.
   */
  fallbackCompile?(source: string, options?: LocalCompileOptions, sourcePhase?: LocalSourcePhase): LocalCompileResult;
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
  sourceRevision: number;
  traceId: string;
  editHint?: LocalCompileEditHint;
  source: string;
  /** Copied at schedule time so later caller mutation cannot change permissions or host schemas. */
  options?: LocalCompileOptions;
  /** Canonical options signature used to detect options-only edits. */
  optionsKey: string;
  /** When `schedule` was called; used for queue metrics only. */
  scheduledAt: number;
  /** Effective phase; part of job identity so a stale result cannot cross phases. */
  sourcePhase: LocalSourcePhase;
  /** True when the caller supplied a phase and expects it echoed on the outcome. */
  explicitPhase: boolean;
  /** Original unsupported phase, preserved so scheduling fails like a direct compile. */
  invalidPhase?: unknown;
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
  traceId: string;
  sourceRevision: number;
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

function createJob(
  source: string,
  options: LocalCompileOptions | undefined,
  sourcePhase?: LocalSourcePhase,
): Omit<CompileJob, 'traceId' | 'sourceRevision'> {
  const snapshot = snapshotCompileOptions(options);
  // An unspecified phase keeps the legacy final request byte-for-byte; a
  // declared one travels as its own field and is echoed on the outcome.
  const declared: unknown = sourcePhase !== undefined ? sourcePhase : declaredOptionPhase(options);
  const validPhase = declared === 'streaming' || declared === 'final' ? declared : undefined;
  const invalidPhase = declared !== undefined && validPhase === undefined ? declared : undefined;
  // Key the snapshot that is actually sent: a bounded oversized host array
  // must produce the same signature on both sides of the worker boundary.
  return {
    source,
    options: snapshot,
    optionsKey: localWorkerOptionsKey(snapshot),
    scheduledAt: now(),
    sourcePhase: validPhase === 'streaming' ? 'streaming' : 'final',
    explicitPhase: declared !== undefined,
    ...(invalidPhase === undefined ? {} : { invalidPhase }),
  };
}

/** Read `options.sourcePhase` without letting a hostile getter break scheduling. */
function declaredOptionPhase(options: LocalCompileOptions | undefined): unknown {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined;
    return (options as { sourcePhase?: unknown }).sourcePhase;
  } catch {
    return undefined;
  }
}

function sameJob(left: CompileJob, right: CompileJob): boolean {
  return left.source === right.source
    && left.optionsKey === right.optionsKey
    && left.sourcePhase === right.sourcePhase
    && left.explicitPhase === right.explicitPhase
    && left.invalidPhase === right.invalidPhase;
}

/** Phase fields an outcome carries; legacy final jobs stay without them. */
function phaseFields(job: CompileJob): { sourcePhase?: LocalSourcePhase } {
  return job.sourcePhase === 'streaming' || job.explicitPhase ? { sourcePhase: job.sourcePhase } : {};
}

/** A transport failure still reports a phase-aware status for explicit jobs. */
function failureResult(job: CompileJob, diagnostic: Diagnostic): LocalCompileResult {
  return job.explicitPhase
    ? { ok: false, diagnostics: [diagnostic], status: 'failed' }
    : { ok: false, diagnostics: [diagnostic] };
}

/** Same diagnostic shape a direct session compile returns for a bad phase. */
function invalidSourcePhaseResult(): LocalCompileResult {
  return {
    ok: false,
    status: 'failed',
    diagnostics: [{
      code: 'local.options.invalid',
      message: 'Compile option sourcePhase must be "streaming" or "final".',
      severity: 'error',
      range: { start: 0, end: 0 },
      line: 1,
      column: 1,
      messageKey: 'local.options.invalid.source-phase',
      phase: 'host',
      recoverable: false,
    }],
  };
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

/** Bounded free text from an exception; it is never copied into a report. */
const MAX_COMPILE_FAILURE_DETAIL = 160;

function compileFailureDetail(error: unknown): string {
  const text = messageOf(error).trim();
  if (text.length === 0) return '';
  return text.length > MAX_COMPILE_FAILURE_DETAIL
    ? `${localCodeUnitPrefix(text, MAX_COMPILE_FAILURE_DETAIL - 1)}…`
    : text;
}

export function compileFailureDiagnostic(error: unknown): Diagnostic {
  const detail = compileFailureDetail(error);
  return {
    code: 'local.worker.compile',
    // The generic key stays when the exception carries no text; a bounded
    // detail goes through local.worker.compile.detail instead of a raw message.
    messageKey: detail ? 'local.worker.compile.detail' : 'local.worker.compile',
    ...(detail ? { params: { detail } } : {}),
    phase: 'worker',
    recoverable: false,
    message: detail ? `Compilation failed: ${detail}` : 'Compilation failed',
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
  private nextSourceRevision = 1;
  /**
   * Source revision of the newest scheduled job. Observer callbacks may
   * schedule another source; a run whose revision is not current must not
   * deliver results, diagnostics or terminal traces.
   */
  private currentSourceRevision = 0;
  private pending = false;
  private fallbackSession: LocalCompileSession | null = null;
  private disposed = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly requestContexts = new Map<number, { traceId: string; sourceRevision: number }>();
  private readonly obsoleteRequestIds = new Set<number>();
  private readonly reportedStaleRequestIds = new Set<number>();
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
   *
   * `sourcePhase` is optional. Streaming snapshots keep the debounce; a
   * snapshot that explicitly declares `final` is dispatched immediately so it
   * can replace a queued intermediate one and settle as soon as any in-flight
   * compile returns. Calls that declare no phase keep the historical debounce
   * and wire shape.
   */
  schedule(
    source: string,
    options?: LocalCompileOptions,
    hint?: LocalCompileEditHint,
    sourcePhase?: LocalSourcePhase,
  ): void {
    if (this.disposed) return;
    const job = { ...createJob(source, options, sourcePhase), sourceRevision: this.nextSourceRevision++, traceId: createLocalTraceId() };
    this.currentSourceRevision = job.sourceRevision;
    if (this.inFlight && !sameJob(this.inFlight.job, job)) this.obsoleteRequestIds.add(this.inFlight.id);
    this.queued = job;
    if (hint && typeof hint.baseSource === 'string' && isPatchEdit(hint.edit) && hint.edit.to <= hint.baseSource.length
      && hint.baseSource.slice(0, hint.edit.from) + hint.edit.insert + hint.baseSource.slice(hint.edit.to) === source) {
      this.queued.editHint = { baseSource: hint.baseSource, edit: { ...hint.edit } };
    }
    this.clearTimer();
    if (job.sourcePhase === 'streaming') {
      // An intermediate snapshot invalidates the patch chain: no final job may
      // extend a baseline that a streaming compile has moved past.
      this.baseline = null;
    }
    this.setPending(true);
    if (job.sourcePhase === 'streaming' || !job.explicitPhase) {
      // Intermediate snapshots, and the historical calls that never declared a
      // phase, keep the existing debounce window.
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, this.delay);
    } else {
      // An explicitly final snapshot never waits for the debounce; it may wait
      // for an in-flight compile, whose result is then dropped because job
      // identity differs by phase.
      this.drain();
    }
  }

  /** Stop the timer and terminate the worker. No callbacks fire afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.inFlight) {
      this.traceWorker(this.inFlight, 'worker-cancel', { status: 'disposed' });
      this.obsoleteRequestIds.add(this.inFlight.id);
    }
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
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
    // An unsupported phase fails at the scheduler boundary for both transports,
    // matching `session.compile` and never compiling the snapshot as final.
    if (job.invalidPhase !== undefined) {
      this.deliver(job, {
        source: job.source,
        result: invalidSourcePhaseResult(),
        duration: 0,
        mode: this.worker === null ? 'fallback' : 'worker',
        ...(job.options === undefined ? {} : { options: job.options }),
        metrics: { queueMs: safeDuration(now() - job.scheduledAt) },
      });
      this.finishRun();
      return;
    }
    const worker = this.worker;
    if (!worker) {
      this.compileFallback(job);
      return;
    }
    // Streaming snapshots are never sent as edits: they must produce their own
    // complete result and must not extend the final patch chain.
    if (job.sourcePhase === 'streaming') this.baseline = null;
    const id = this.nextId++;
    const revision = this.nextRevision++;
    const { traceId, sourceRevision } = job;
    const startedAt = now();
    const baseline = this.baseline;
    const usePatch = job.sourcePhase === 'final'
      && this.patchState === 'enabled'
      && baseline !== null
      && baseline.optionsKey === job.optionsKey;
    const request: LocalCompileWorkerRequest = usePatch
      ? {
          traceId,
          requestId: id,
          sourceRevision,
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
          traceId,
          requestId: id,
          sourceRevision,
          id,
          source: job.source,
          ...(job.options === undefined ? {} : { options: job.options }),
          protocol: LOCAL_RESULT_PATCH_PROTOCOL,
          revision,
          flatResults: FLAT_COMPILED_DATA_PROTOCOL,
          // Legacy final jobs keep the historical wire shape; a declared phase
          // (including an explicit `final`) is sent and echoed.
          ...(job.sourcePhase === 'streaming' || job.explicitPhase ? { sourcePhase: job.sourcePhase } : {}),
        };
    const flight = { id, job, startedAt, revision, traceId, sourceRevision };
    this.inFlight = flight;
    const configuredTimeout = this.options.timeoutMs;
    const timeoutMs = typeof configuredTimeout === 'number' && Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(2_147_483_647, Math.ceil(configuredTimeout)) : 30_000;
    this.requestContexts.set(id, { traceId, sourceRevision });
    while (this.requestContexts.size > 128) {
      const oldest = this.requestContexts.keys().next().value;
      if (oldest === undefined) break;
      this.requestContexts.delete(oldest);
      this.obsoleteRequestIds.delete(oldest);
      this.reportedStaleRequestIds.delete(oldest);
    }
    this.timeout = setTimeout(() => {
      if (this.inFlight?.id !== id) return;
      const diagnostic = { ...createLocalObservabilityDiagnostic('local.worker.timeout', { timeoutMs, requestId: id, sourceRevision }), phase: 'worker' as const };
      this.obsoleteRequestIds.add(id);
      this.handleWorkerFailure(diagnostic.message, diagnostic);
    }, timeoutMs);
    this.traceWorker(flight, 'worker-request');
    if (this.disposed || this.inFlight !== flight) return;
    if (this.options.includeAuthorAnalysis) request.includeAuthorAnalysis = true;
    try {
      worker.postMessage(request);
    } catch (error) {
      this.obsoleteRequestIds.add(id);
      this.handleWorkerFailure(`Could not send the source to the compile worker: ${messageOf(error)}`);
    }
  }

  private compileFallback(job: CompileJob): void {
    if (this.disposed) return;
    // A streaming job is answered by a complete compile; it never extends a
    // patch chain, so the next final request has to be complete as well.
    if (job.sourcePhase === 'streaming') this.baseline = null;
    const started = now();
    const { traceId, sourceRevision } = job;
    if (!this.isCurrentJob(job)) {
      this.finishRun();
      return;
    }
    emitLocalTrace(this.options.observer, { type: 'compile-start', traceId, sourceRevision, timestamp: Date.now(), status: 'fallback' });
    // An observer may have scheduled a newer source while handling the start
    // trace. That source supersedes this run before any compile happens.
    if (!this.isCurrentJob(job)) {
      this.finishRun();
      return;
    }
    let result: LocalCompileResult;
    try {
      const fallbackCompile = this.options.fallbackCompile ?? ((
        source: string,
        options?: LocalCompileOptions,
        sourcePhase?: LocalSourcePhase,
      ) => {
        this.fallbackSession ??= createLocalCompileSession();
        return this.fallbackSession.compile(source, options, sourcePhase);
      });
      // Keep the historical call shape for legacy jobs. A declared phase is
      // passed as the third argument; one- and two-argument callbacks ignore it.
      result = job.explicitPhase
        ? fallbackCompile(job.source, job.options, job.sourcePhase)
        : job.options === undefined
          ? fallbackCompile(job.source)
          : fallbackCompile(job.source, job.options);
    } catch (error) {
      result = failureResult(job, compileFailureDiagnostic(error));
    }
    const duration = safeDuration(now() - started);
    // A newer source that arrived during the compile owns the next result;
    // this run is no longer allowed to report a terminal trace or outcome.
    if (!this.isCurrentJob(job)) {
      this.finishRun();
      return;
    }
    emitLocalTrace(this.options.observer, { type: 'compile-end', traceId, sourceRevision, timestamp: Date.now(), durationMs: duration, status: result.ok ? 'ok' : 'failed' });
    if (!this.isCurrentJob(job)) {
      this.finishRun();
      return;
    }
    this.deliver(job, {
      source: job.source,
      result,
      duration,
      mode: 'fallback',
      ...(this.options.includeAuthorAnalysis ? { analysis: analyzeResult(job.source, job.options, result) } : {}),
      ...(job.options === undefined ? {} : { options: job.options }),
      ...phaseFields(job),
      metrics: { queueMs: safeDuration(started - job.scheduledAt) },
    });
    this.finishRun();
  }

  /**
   * The newest scheduled source revision identifies the current generation.
   * Observer callbacks run between delivery steps and may schedule a newer
   * source, which retires the running one.
   */
  private isCurrentJob(job: CompileJob): boolean {
    return !this.disposed && job.sourceRevision === this.currentSourceRevision;
  }

  private receive(wireResponse: LocalCompileWorkerResponse): void {
    if (this.disposed) return;
    const inFlight = this.inFlight;
    if (!wireResponse) return;
    if (inFlight && wireResponse.id === inFlight.id
      && ((wireResponse.requestId !== undefined && wireResponse.requestId !== inFlight.id)
        || (wireResponse.traceId !== undefined && wireResponse.traceId !== inFlight.traceId)
        || (wireResponse.sourceRevision !== undefined && wireResponse.sourceRevision !== inFlight.sourceRevision))) {
      this.reportStale(inFlight.id, inFlight.traceId, inFlight.sourceRevision, this.queued?.sourceRevision);
      this.handleWorkerFailure('The compile worker returned a response with a mismatched request context.');
      return;
    }
    if (!inFlight || wireResponse.id !== inFlight.id) {
      if (Number.isSafeInteger(wireResponse.id) && wireResponse.id > 0 && this.obsoleteRequestIds.has(wireResponse.id)) {
        const context = this.requestContexts.get(wireResponse.id);
        if (context) this.reportStale(wireResponse.id, context.traceId, context.sourceRevision, this.queued?.sourceRevision);
      }
      return;
    }
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
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
          // A streaming snapshot never becomes a patch baseline and never
          // changes the negotiated transport state, whatever it echoes.
          const streaming = job.sourcePhase === 'streaming' || full.sourcePhase === 'streaming';
          if (streaming) {
            this.baseline = null;
          } else if (
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
    if (failure !== null) {
      this.traceWorker(inFlight, 'worker-error', { durationMs: roundTripMs, status: 'failed', code: 'local.worker.compile' });
    } else {
      this.traceWorker(inFlight, 'worker-response', { durationMs: roundTripMs, status: result ? (result.ok ? 'ok' : 'failed') : failure ? 'failed' : 'retry' });
    }
    if (this.disposed) return;
    if (superseded) {
      this.obsoleteRequestIds.add(inFlight.id);
      this.reportStale(inFlight.id, inFlight.traceId, inFlight.sourceRevision, queued.sourceRevision);
    }
    if (queued !== null && !superseded && this.queued === queued) {
      // The queued edit compiles to the same source and options, so this
      // result still counts, and this job remains the current generation.
      this.queued = null;
      this.clearTimer();
      this.currentSourceRevision = job.sourceRevision;
    }

    if (result !== null) {
      if (!superseded) {
        this.deliver(job, {
          source: job.source,
          result,
          duration: safeDuration(response.ok ? response.duration : 0),
          mode,
          ...(response.ok && this.options.includeAuthorAnalysis && validAnalysis(response.analysis, job.source.length) ? { analysis: response.analysis } : {}),
          ...(job.options === undefined ? {} : { options: job.options }),
          ...phaseFields(job),
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
        this.deliver(job, {
          source: job.source,
          result: failureResult(job, compileFailureDiagnostic(failure)),
          duration: 0,
          mode,
          ...(job.options === undefined ? {} : { options: job.options }),
          ...phaseFields(job),
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
      this.deliver(job, {
        source: job.source,
        result: failureResult(job, compileFailureDiagnostic('The compile worker could not apply an incremental result patch')),
        duration: 0,
        mode,
        ...(job.options === undefined ? {} : { options: job.options }),
        ...phaseFields(job),
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
    // Only a final job may join the patch chain; a streaming job answers with
    // complete results and never adopts (or creates) a baseline.
    if (job.sourcePhase !== 'final') return null;
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
    // Patch frames carry document data only. An explicit final consumer expects
    // the status a complete final compile would have returned; a legacy job
    // must not inherit the baseline's phase status.
    let result: LocalCompileResult;
    if (job.sourcePhase === 'final' && job.explicitPhase) {
      result = applied.recoveries === undefined
        ? { ...applied, status: 'valid' }
        : { ...applied, status: 'recovered' };
    } else if (applied.ok && applied.status !== undefined) {
      const legacy = { ...applied } as LocalCompileResult & { status?: unknown };
      delete legacy.status;
      result = legacy;
    } else {
      result = applied;
    }
    this.baseline = {
      source: job.source,
      optionsKey: job.optionsKey,
      revision: response.revision,
      result,
    };
    return result;
  }

  /** Re-dispatch the same job with a complete source, at most once per job. */
  private recoverWithFullResult(job: CompileJob): boolean {
    if (this.worker === null || (job.recovery ?? 0) >= 1) return false;
    const queued = this.queued;
    if (queued !== null && !sameJob(queued, job)) return false;
    if (queued !== null) {
      this.queued = null;
      this.clearTimer();
      // The retried request answers the same waiting edit; it stays current.
      this.currentSourceRevision = job.sourceRevision;
    }
    this.resetProtocol();
    this.compile({ ...job, recovery: (job.recovery ?? 0) + 1 });
    return true;
  }

  private handleWorkerFailure(detail: string, diagnostic: Diagnostic = { ...createLocalObservabilityDiagnostic('local.worker.error'), recoverable: true }): void {
    if (this.disposed) return;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    this.resetProtocol();
    const inFlight = this.inFlight;
    this.inFlight = null;
    if (inFlight) this.obsoleteRequestIds.add(inFlight.id);
    this.degrade(detail);
    if (this.disposed) return;
    if (inFlight) this.traceWorker(inFlight, diagnostic.code === 'local.worker.timeout' ? 'worker-timeout' : 'worker-error', { code: diagnostic.code, durationMs: safeDuration(now() - inFlight.startedAt) });
    if (this.disposed) return;
    emitLocalDiagnostic(this.options.observer, diagnostic);
    if (this.disposed) return;
    if (inFlight && (this.queued === null || sameJob(this.queued, inFlight.job))) {
      if (this.queued !== null) {
        // The waiting edit compiles to the same source and options; the failed
        // request remains the current generation for its fallback run.
        this.queued = null;
        this.clearTimer();
        this.currentSourceRevision = inFlight.job.sourceRevision;
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

  private deliver(job: CompileJob, outcome: LocalCompileOutcome): void {
    if (!this.isCurrentJob(job)) return;
    // Only the scheduler's patch baseline is retained. Everything else is
    // already independent (a worker message or a fresh fallback compile).
    // `shareResults` is an explicit opt-in to the internal read-only graph.
    const retained = this.baseline !== null && this.baseline.result === outcome.result;
    const result = this.options.shareResults === true || !retained
      ? outcome.result
      : cloneLocalCompileResult(outcome.result);
    for (const diagnostic of [...result.diagnostics, ...(result.transientDiagnostics ?? [])]) {
      // Every observer callback may schedule a newer source; revalidate the
      // generation so an older run never delivers after it.
      if (!this.isCurrentJob(job)) return;
      emitLocalDiagnostic(this.options.observer, diagnostic);
    }
    if (!this.isCurrentJob(job)) return;
    this.options.onResult({ ...outcome, result });
  }

  private traceWorker(
    flight: InFlightJob, type: LocalTraceEvent['type'], details: Pick<LocalTraceEvent, 'durationMs' | 'status' | 'code'> = {},
  ): void {
    emitLocalTrace(this.options.observer, { type, traceId: flight.traceId, requestId: flight.id, sourceRevision: flight.sourceRevision, timestamp: Date.now(), ...details });
  }

  private reportStale(requestId: number, traceId: string, sourceRevision: number, currentRevision?: number): void {
    if (this.disposed || this.reportedStaleRequestIds.has(requestId)) return;
    this.reportedStaleRequestIds.add(requestId);
    const code = 'local.worker.stale-response';
    const diagnostic = { ...createLocalObservabilityDiagnostic(code, {
      requestId, sourceRevision, ...(currentRevision === undefined ? {} : { currentRevision }),
    }), phase: 'worker' as const };
    emitLocalTrace(this.options.observer, { type: 'worker-stale-response', traceId, requestId, sourceRevision, timestamp: Date.now(), code });
    if (this.disposed) return;
    emitLocalDiagnostic(this.options.observer, diagnostic);
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
