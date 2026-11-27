import type {
  LocalCompileFlatResponse,
  LocalCompilePatchRequest,
  LocalCompilePatchResponse,
  LocalCompileRequest,
  LocalCompileResponse,
  LocalCompileWorkerMetrics,
} from './worker';
import {
  createLocalCompileSession,
  LocalCompileSession,
  type LocalIncrementalStats,
} from '../compilation/session/incremental';
import type { LocalCompileOptions, LocalCompileResult, LocalSourcePhase } from '../types';
import {
  encodeLocalResultPatchWithCost,
  LOCAL_RESULT_PATCH_PROTOCOL,
  type LocalResultPatch,
  type LocalSourceEdit,
} from './compile-patch';
import {
  analyzeResult,
  compilePhaseMetrics,
  LOCAL_COMPILE_PREPARATION_DELAY_MS,
  localWorkerOptionsKey,
  messageOf,
  now,
  safeDuration,
  snapshotCompileOptions,
} from './worker-job';
import {
  encodeFlatCompiledData,
  FLAT_COMPILED_DATA_PROTOCOL,
  needsFlatCompileResult,
} from './flat-compiled-data';

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
  /** Maximum number of isolated document baselines retained by one worker. */
  maxDocuments?: number;
}

export const DEFAULT_LOCAL_WORKER_DOCUMENTS = 8;

/** Optional session methods the main implementation may add later. */
interface LocalCompileSessionExtensions {
  compileShared?(source: string, options?: LocalCompileOptions, phase?: LocalSourcePhase, collectPerformance?: boolean): LocalCompileResult;
  prepareAsync?(
    signal?: { readonly aborted: boolean },
    yieldTask?: () => Promise<void>,
  ): Promise<boolean>;
}

interface WorkerState {
  documentId?: string;
  source: string;
  revision: number;
  options?: LocalCompileOptions;
  optionsKey: string;
  result: LocalCompileResult;
  deep: boolean;
  flatResults: boolean;
  /**
   * Phase declared by the request that produced this state, exactly as the
   * client sent it. Absent for legacy clients and therefore implicitly final;
   * a streaming state may never serve a patch request.
   */
  sourcePhase?: LocalSourcePhase;
}

function compileWithSession(
  session: LocalCompileSession,
  source: string,
  options?: LocalCompileOptions,
  sourcePhase?: LocalSourcePhase,
  collectPerformance?: boolean,
): LocalCompileResult {
  const extended = session as LocalCompileSession & LocalCompileSessionExtensions;
  return typeof extended.compileShared === 'function'
    ? extended.compileShared(source, options, sourcePhase, collectPerformance)
    : session.compile(source, options, sourcePhase);
}

/** Only the two declared values are phases; anything else is a protocol error. */
function isSourcePhase(value: unknown): value is LocalSourcePhase {
  return value === 'streaming' || value === 'final';
}

function sessionStats(session: LocalCompileSession): Readonly<LocalIncrementalStats> {
  return session.stats;
}

function postFailure(
  scope: LocalCompileWorkerScope,
  id: number,
  message: string,
  request?: Pick<LocalCompileRequest, 'traceId' | 'requestId' | 'sourceRevision' | 'documentId' | 'revision'>,
): void {
  try {
    scope.postMessage({ id, ...(request?.traceId === undefined ? {} : { traceId: request.traceId, requestId: request.requestId, sourceRevision: request.sourceRevision }),
      ...(request?.documentId === undefined ? {} : { documentId: request.documentId, revision: request.revision }), ok: false, message });
  } catch {
    /* A scope that cannot receive the failure response is already broken. */
  }
}

function postRetryableFailure(
  scope: LocalCompileWorkerScope,
  request: LocalCompilePatchRequest,
  message: string,
  code: string,
  revision: number | undefined,
): void {
  try {
    scope.postMessage({
      id: request.id,
      ...(request.traceId === undefined ? {} : { traceId: request.traceId, requestId: request.requestId, sourceRevision: request.sourceRevision }),
      ok: false,
      message,
      retryFull: true,
      code,
      ...(request.documentId === undefined
        ? (revision === undefined ? {} : { revision })
        : { documentId: request.documentId, revision: request.revision }),
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

export function isPatchEdit(value: unknown): value is LocalSourceEdit {
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
  type Context = { scope: LocalCompileWorkerScope; control: LocalCompileWorkerControl };
  const documents = new Map<string, Context>();
  const limit = options.maxDocuments ?? DEFAULT_LOCAL_WORKER_DOCUMENTS;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid worker document limit');
  let disposed = false;
  const legacy = context();

  function context(): Context {
    const inner: LocalCompileWorkerScope = { onmessage: null, postMessage: message => target.postMessage(message) };
    return { scope: inner, control: startCompileContext(inner, options) };
  }

  function cancelPreparation(): void {
    legacy.control.cancelPreparation();
    for (const document of documents.values()) document.control.cancelPreparation();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    target.onmessage = null;
    legacy.control.dispose();
    for (const document of documents.values()) document.control.dispose();
    documents.clear();
  }

  target.onmessage = event => {
    if (disposed) return;
    const request = event?.data;
    if (isControlMessage(request)) {
      if (request.control === 'dispose') dispose();
      else cancelPreparation();
      return;
    }
    if (typeof request?.documentId !== 'string') { legacy.scope.onmessage?.(event); return; }
    const { documentId, revision } = request;
    // A document-scoped full request may omit `revision`; only a present,
    // malformed value is a protocol error.
    if (documentId.length > 256
      || (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0))) {
      postFailure(target, request.id, 'Invalid worker document or revision', request);
      return;
    }
    let document = documents.get(documentId);
    if (!document) {
      if (typeof request.source !== 'string') {
        postRetryableFailure(target, request, 'The document baseline is unavailable', 'stale-base', revision);
        return;
      }
      document = context();
    }
    documents.delete(documentId);
    documents.set(documentId, document);
    if (documents.size > limit) {
      const oldest = documents.keys().next().value!;
      documents.get(oldest)?.control.dispose();
      documents.delete(oldest);
    }
    document.scope.onmessage?.(event);
  };
  return { dispose, cancelPreparation, get disposed() { return disposed; } };
}

function startCompileContext(target: LocalCompileWorkerScope, options: LocalCompileWorkerOptions): LocalCompileWorkerControl {
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

  const workerMetrics = (compileMs: number): LocalCompileWorkerMetrics => {
    return {
      compileMs,
      ...compilePhaseMetrics(sessionStats(session)),
      ...(preparationMs === undefined ? {} : { preparationMs }),
    };
  };

  const resolveRevision = (value: unknown): number => {
    const candidate = typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : null;
    if (candidate === null) return lastRevision + 1;
    return candidate > lastRevision ? candidate : lastRevision + 1;
  };

  const respondFull = (
    request: LocalCompileRequest | LocalCompilePatchRequest,
    revision: number,
    compileMs: number,
    negotiated: boolean,
    includeAnalysis = false,
    extraMetrics?: LocalCompileWorkerMetrics,
  ): boolean => {
    const { id, traceId, requestId, sourceRevision } = request;
    const state = current;
    if (state === null) return false;
    const duration = safeDuration(compileMs);
    const metrics = extraMetrics === undefined
      ? workerMetrics(duration)
      : { ...workerMetrics(duration), ...extraMetrics };
    try {
      const response: LocalCompileResponse = negotiated
        ? {
            id,
            ...(state.documentId === undefined ? {} : { documentId: state.documentId }),
            ...(traceId === undefined ? {} : { traceId, requestId, sourceRevision }),
            ok: true,
            result: state.result,
            duration,
            incremental: sessionStats(session),
            ...(state.sourcePhase === undefined ? {} : { sourcePhase: state.sourcePhase }),
            protocol: LOCAL_RESULT_PATCH_PROTOCOL,
            revision,
            metrics,
          }
        : {
            id,
            ...(state.documentId === undefined ? {} : { documentId: state.documentId, revision: request.revision, metrics }),
            ...(traceId === undefined ? {} : { traceId, requestId, sourceRevision }),
            ok: true,
            result: state.result,
            duration,
            incremental: sessionStats(session),
            ...(state.sourcePhase === undefined ? {} : { sourcePhase: state.sourcePhase }),
          };
      if (includeAnalysis && response.ok) {
        const started = now();
        response.analysis = analyzeResult(state.source, state.options, state.result);
        response.metrics = { ...response.metrics, analysisMs: safeDuration(now() - started) };
      }
      if(state.deep&&state.flatResults&&response.ok){
        const {result,...header}=response;
        const flat:LocalCompileFlatResponse={...header,flatResult:encodeFlatCompiledData(result)};
        target.postMessage(flat as unknown as LocalCompileResponse);
      }else target.postMessage(response);
      return true;
    } catch (error) {
      // The result itself may not be cloneable; report the failure instead.
      postFailure(target, id, `Could not return the compile result: ${messageOf(error)}`, request);
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
      const full = request as LocalCompileRequest;
      const snapshot = snapshotCompileOptions(full.options);
      // The phase travels either on the request or on the options object; a
      // malformed value must not poison the session state.
      const requestedPhase = full.sourcePhase !== undefined
        ? full.sourcePhase
        : (snapshot as { sourcePhase?: unknown } | undefined)?.sourcePhase;
      if (requestedPhase !== undefined && !isSourcePhase(requestedPhase)) {
      postFailure(target, full.id, 'The requested source phase is not supported: expected "streaming" or "final"', full);
        return;
      }
      const sourcePhase = requestedPhase as LocalSourcePhase | undefined;
      cancelPreparation();
      // Key the snapshot that is actually compiled and returned to analysis;
      // the scheduler keys the same copied object on its side.
      const optionsKey = localWorkerOptionsKey(snapshot);
      const negotiated = full.protocol === LOCAL_RESULT_PATCH_PROTOCOL;
      const revision = full.documentId === undefined ? resolveRevision(full.revision) : full.revision!;
      const started = now();
      try {
        if (current !== null && (current.optionsKey !== optionsKey || current.documentId !== full.documentId)) {
          // The compiler's public option key does not yet include every budget
          // field; drop a cache built under different permissions or limits.
          try {
            session.clear();
          } catch {
            /* a session without clear simply recompiles */
          }
        }
        const result = compileWithSession(session, full.source, snapshot, sourcePhase, full.collectPerformance === true);
        const compileMs = safeDuration(now() - started);
        lastRevision = revision;
        current = {
          source: full.source,
          documentId: full.documentId,
          revision,
          options: snapshot,
          optionsKey,
          result,
          deep: needsFlatCompileResult(result),
          flatResults: full.flatResults===FLAT_COMPILED_DATA_PROTOCOL,
          ...(sourcePhase === undefined ? {} : { sourcePhase }),
        };
        if (respondFull(full, revision, compileMs, negotiated, full.includeAuthorAnalysis === true)) {
          schedulePreparation();
        }
      } catch (error) {
        postFailure(target, full.id, messageOf(error), full);
      }
      return;
    }

    if (request.protocol !== LOCAL_RESULT_PATCH_PROTOCOL) return;
    cancelPreparation();
    const patchRequest = request as LocalCompilePatchRequest;
    const state = current;
    const retry = (message: string, code: string): void => {
      postRetryableFailure(target, patchRequest, message, code, state?.revision);
    };
    if (state === null) {
      retry('No complete compile is available to patch', 'stale-base');
      return;
    }
    if ((state.sourcePhase ?? 'final') !== 'final') {
      // A streaming snapshot is not a patch baseline; only a final result may
      // start or extend the edit chain.
      retry('The baseline was compiled from a streaming snapshot', 'phase-mismatch');
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
    const revision = patchRequest.documentId === undefined ? resolveRevision(patchRequest.revision) : patchRequest.revision;
    if (revision <= state.revision) {
      retry('The new revision must follow its baseline', 'stale-base');
      return;
    }
    const started = now();
    try {
      const result = compileWithSession(session, nextSource, state.options, state.sourcePhase, patchRequest.collectPerformance === true);
      const compileMs = safeDuration(now() - started);
      const baseRevision = state.revision;
      const baseResult = state.result;
      lastRevision = revision;
      current = {
        documentId: state.documentId,
        source: nextSource,
        revision,
        options: state.options,
        optionsKey: state.optionsKey,
        result,
        deep: needsFlatCompileResult(result),
        flatResults: state.flatResults,
        ...(state.sourcePhase === undefined ? {} : { sourcePhase: state.sourcePhase }),
      };
      let encoding: ReturnType<typeof encodeLocalResultPatchWithCost> = null;
      let patchEncodeMs = 0;
      if (result.ok && baseResult.ok && !current.deep && !state.deep) {
        const encodeStarted = now();
        encoding = encodeLocalResultPatchWithCost(baseResult, result);
        patchEncodeMs = safeDuration(now() - encodeStarted);
      }
      const patch: LocalResultPatch | null = encoding?.patch ?? null;
      if (patch === null) {
        // A failed/cached-exception result cannot be patched; the complete
        // result still keeps the revision chain usable.
        if (respondFull(patchRequest, revision, compileMs, true, patchRequest.includeAuthorAnalysis === true)) {
          schedulePreparation();
        }
        return;
      }
      if (encoding !== null && encoding.cost.preferFull) {
        // A wholesale rewrite can make the encoded patch as large as the
        // complete result. Send the complete result for this same revision: it
        // needs no patch decode or apply on the receiving thread, and the
        // client adopts it as the new baseline exactly like any full response.
        const cost = encoding.cost;
        const fallbackMetrics: LocalCompileWorkerMetrics = {
          patchEncodeMs,
          patchFallback: 'cost',
          patchBytes: cost.patchBytes,
          ...(cost.fullBytes === undefined ? {} : { fullBytes: cost.fullBytes }),
        };
        if (respondFull(
          patchRequest,
          revision,
          compileMs,
          true,
          patchRequest.includeAuthorAnalysis === true,
          fallbackMetrics,
        )) {
          schedulePreparation();
        }
        return;
      }
      const metrics: LocalCompileWorkerMetrics = {
        ...workerMetrics(compileMs),
        patchEncodeMs,
        patchNodes: patch.document.nodes?.length ?? 0,
        ...(preparationMs === undefined ? {} : { preparationMs }),
      };
      try {
        const response: LocalCompilePatchResponse = {
          id: patchRequest.id,
          ...(state.documentId === undefined ? {} : { documentId: state.documentId }),
          ...(patchRequest.traceId === undefined ? {} : { traceId: patchRequest.traceId, requestId: patchRequest.requestId, sourceRevision: patchRequest.sourceRevision }),
          ok: true,
          protocol: LOCAL_RESULT_PATCH_PROTOCOL,
          baseRevision,
          revision,
          patch,
          duration: compileMs,
          incremental: sessionStats(session),
          ...(state.sourcePhase === undefined ? {} : { sourcePhase: state.sourcePhase }),
          metrics,
        };
        if (patchRequest.includeAuthorAnalysis === true) {
          const started = now();
          response.analysis = analyzeResult(nextSource, state.options, result);
          metrics.analysisMs = safeDuration(now() - started);
        }
        // Patch frames only reach a client that negotiated patch-v1, so this
        // cast keeps the classic scope contract for every existing caller.
        target.postMessage(response as unknown as LocalCompileResponse);
        schedulePreparation();
      } catch (error) {
      postFailure(target, patchRequest.id, `Could not return the compile result: ${messageOf(error)}`, patchRequest);
      }
    } catch (error) {
      postFailure(target, patchRequest.id, messageOf(error), patchRequest);
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
