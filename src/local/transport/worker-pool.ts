import { MAX_LOCAL_DOCUMENT_LENGTH } from '../../contracts/limits';
import { createLocalCompileSession } from '../compilation/session/incremental';
import { compileTraceStatus } from '../compilation/compile-status';
import { createLocalTraceId, emitLocalTrace, type LocalObserver, type LocalTraceEvent } from '../observability-core';
import type { LocalCompileOptions, LocalSourcePhase } from '../types';
import { decodeFlatCompiledData, FLAT_COMPILED_DATA_PROTOCOL } from './flat-compiled-data';
import { applyLocalResultPatch, cloneLocalCompileResult, diffSourceEdit, LOCAL_RESULT_PATCH_PROTOCOL } from './compile-patch';
import { DEFAULT_LOCAL_WORKER_DOCUMENTS } from './worker-handler';
import { localWorkerOptionsKey, now, safeDuration, snapshotCompileOptions } from './worker-job';
import { isCompileResult } from './worker';
import type { LocalCompileOutcome, LocalCompileSchedulerOptions, LocalCompileWorker,
  LocalCompileWorkerRequest, LocalCompileWorkerResponse } from './worker';

export interface LocalCompilePoolRequest {
  readonly documentId: string;
  readonly revision: number;
  readonly source: string;
  readonly options?: LocalCompileOptions;
  readonly sourcePhase?: LocalSourcePhase;
  readonly priority?: number;
}

export interface LocalCompilePoolOutcome extends LocalCompileOutcome {
  readonly documentId: string;
  readonly revision: number;
  readonly traceId?: string;
}

export interface LocalCompilePoolCounts {
  readonly capacity: number;
  readonly queuedDocuments: number;
  readonly inFlightWorkers: number;
  readonly pendingTasks: number;
  readonly oldestPendingMs: number;
}

export interface LocalCompilePoolReadyEvent {
  readonly status: 'ready' | 'degraded' | 'disposed';
  readonly availableWorkers: number;
  readonly failedWorkers: number;
}

export interface LocalCompilePoolOptions {
  readonly workers: number | 'auto';
  readonly createWorker: (workerId: number) => LocalCompileWorker;
  readonly warmup?: boolean;
  readonly idleDisposeMs?: number;
  readonly maxIdle?: number;
  readonly timeoutMs?: number;
  readonly streamingDelayMs?: number;
  readonly maxPending?: number;
  readonly fallbackCompile?: LocalCompileSchedulerOptions['fallbackCompile'];
  readonly observer?: LocalObserver;
  readonly snapshotPolicy?: 'latest' | 'all';
  readonly onReady?: (event: LocalCompilePoolReadyEvent) => void;
  readonly onPendingChange?: (counts: LocalCompilePoolCounts) => void;
}

export type LocalCompilePoolTaskErrorKind = 'superseded' | 'cancelled' | 'disposed' | 'worker-failed'
  | 'invalid-revision' | 'invalid-request' | 'source-too-large' | 'backpressure';

export class LocalCompilePoolTaskError extends Error {
  constructor(readonly kind: LocalCompilePoolTaskErrorKind) {
    super(`Local compile task ${kind}.`);
    this.name = 'LocalCompilePoolTaskError';
  }
}

export interface LocalCompilePool {
  readonly ready: Promise<LocalCompilePoolReadyEvent>;
  schedule(request: LocalCompilePoolRequest): Promise<LocalCompilePoolOutcome>;
  cancel(documentId: string): void;
  /**
   * Forget a permanently closed document: cancel its pending tasks and clear
   * its revision chain and patch baselines. A later schedule for the same ID
   * starts a fresh revision chain.
   */
  release(documentId: string): void;
  setPriority(documentId: string, priority: number): void;
  getCounts(): LocalCompilePoolCounts;
  dispose(): void;
}

interface Task {
  readonly id: number;
  readonly request: LocalCompilePoolRequest;
  readonly queuedAt: number;
  readonly optionsKey: string;
  readonly eligibleAt: number;
  readonly traceId?: string;
  priority: number;
  readonly resolve: (outcome: LocalCompilePoolOutcome) => void;
  readonly reject: (error: LocalCompilePoolTaskError) => void;
}

interface Flight {
  readonly task?: Task;
  readonly id: number;
  readonly started: number;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly baseline?: Baseline;
}

interface Baseline {
  readonly revision: number;
  readonly optionsKey: string;
  readonly result: Extract<LocalCompileOutcome['result'], { ok: true }>;
}

interface Slot {
  readonly id: number;
  readonly baselines: Map<string, Baseline>;
  worker?: LocalCompileWorker;
  flight?: Flight;
  idle?: ReturnType<typeof setTimeout>;
  idleSince?: number;
  failed: boolean;
}

const WARMUP_DOCUMENT = '';
const AGING_MS = 100;
const MAX_PRIORITY = 10;

function basePriority(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(-MAX_PRIORITY, Math.min(MAX_PRIORITY, value!)) : 0;
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(value!, 2_147_483_647)) : fallback;
}

/** A bounded multi-document queue. Each slot runs one compile flight at a time. */
export function createLocalCompilePool(options: LocalCompilePoolOptions): LocalCompilePool {
  const capacity = options.workers === 'auto' ? Math.max(1, Math.min(4, globalThis.navigator?.hardwareConcurrency || 2)) : options.workers;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 32) throw new RangeError('Worker pool capacity must be between 1 and 32.');
  const maxPending = Math.max(1, Math.floor(finite(options.maxPending, 128)));
  const maxIdle = Math.min(capacity, Math.floor(finite(options.maxIdle, capacity)));
  const timeoutMs = Math.max(1, finite(options.timeoutMs, 10_000));
  const streamingDelayMs = finite(options.streamingDelayMs, 75);
  const idleDisposeMs = options.idleDisposeMs === undefined ? undefined : finite(options.idleDisposeMs, 0);
  const slots: Slot[] = Array.from({ length: capacity }, (_, id) => ({ id: id + 1, failed: false, baselines: new Map() }));
  const queue = new Set<Task>();
  const pending = new Set<Task>();
  const revisions = new Map<string, number>();
  let closed = false;
  let started = false;
  let starting = false;
  let queuedDrain = false;
  let wakeup: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let readyReported = false;
  let resolveReady!: (event: LocalCompilePoolReadyEvent) => void;
  const ready = new Promise<LocalCompilePoolReadyEvent>(resolve => { resolveReady = resolve; });
  let lastCounts = '';
  const readinessStartedAt = options.observer?.onTrace ? now() : undefined;

  function counts(): LocalCompilePoolCounts {
    let oldest = Number.POSITIVE_INFINITY;
    for (const task of pending) oldest = Math.min(oldest, task.queuedAt);
    return { capacity, queuedDocuments: new Set([...queue].map(task => task.request.documentId)).size,
      inFlightWorkers: slots.filter(slot => slot.flight?.task).length, pendingTasks: pending.size,
      oldestPendingMs: pending.size ? safeDuration(now() - oldest) : 0 };
  }

  function notify(): void {
    if (!options.onPendingChange) return;
    const value = counts();
    const key = [value.queuedDocuments, value.inFlightWorkers, value.pendingTasks].join(':');
    if (lastCounts === key) return;
    lastCounts = key;
    try { options.onPendingChange(value); } catch { /* Isolate host callbacks. */ }
  }

  function reportReady(): void {
    if (readyReported || (!closed && (!started || starting || slots.some(slot => slot.flight && !slot.flight.task)))) return;
    readyReported = true;
    const failedWorkers = slots.filter(slot => slot.failed).length;
    const event: LocalCompilePoolReadyEvent = { status: closed ? 'disposed' : failedWorkers ? 'degraded' : 'ready',
      availableWorkers: slots.filter(slot => slot.worker).length, failedWorkers };
    resolveReady(event);
    trace('worker-ready', undefined, undefined, event.status, readinessStartedAt === undefined ? undefined : safeDuration(now() - readinessStartedAt));
    queueMicrotask(() => { try { options.onReady?.(event); } catch { /* Isolate host callbacks. */ } });
  }

  function trace(type: LocalTraceEvent['type'], slot: Slot | undefined, task?: Task, status?: string, durationMs?: number,
    metrics?: Pick<LocalTraceEvent, 'queueMs' | 'parseMs' | 'semanticMs' | 'reuseMs' | 'rebuildMs' | 'compiledBlocks' | 'reusedBlocks'>): void {
    if (!options.observer?.onTrace) return;
    emitLocalTrace(options.observer, { type, traceId: task?.traceId ?? createLocalTraceId(), timestamp: Date.now(),
      workerId: slot?.id, documentId: task?.request.documentId, sourceRevision: task?.request.revision,
      requestId: task?.id, sourcePhase: task?.request.sourcePhase, status, durationMs, ...metrics });
  }

  function fail(task: Task, kind: LocalCompilePoolTaskErrorKind): void {
    if (!pending.delete(task)) return;
    queue.delete(task);
    task.reject(new LocalCompilePoolTaskError(kind));
    const slot = slots.find(item => item.flight?.task === task);
    if (slot || kind === 'cancelled') for (const item of slots) item.baselines.delete(task.request.documentId);
    trace('worker-cancel', slot, task, kind);
  }

  function resolve(task: Task, outcome: LocalCompileOutcome): void {
    if (!pending.delete(task)) return;
    task.resolve({ ...outcome, documentId: task.request.documentId, revision: task.request.revision,
      ...(task.traceId ? { traceId: task.traceId } : {}) });
  }

  function fallback(task: Task): void {
    if (!pending.has(task)) return;
    const { source, options: compileOptions, sourcePhase } = task.request;
    const before = now();
    trace('worker-request', undefined, task, 'fallback');
    if (!pending.has(task)) return;
    try {
      let result: LocalCompileOutcome['result'];
      if (options.fallbackCompile) result = options.fallbackCompile(source, compileOptions, sourcePhase);
      else {
        const session = createLocalCompileSession();
        try { result = session.compile(source, compileOptions, sourcePhase); }
        finally { session.dispose(); }
      }
      const duration = safeDuration(now() - before);
      if (!pending.has(task)) return;
      resolve(task, { source, result, options: compileOptions, duration, mode: 'fallback', sourcePhase,
        metrics: { queueMs: safeDuration(before - task.queuedAt) } });
      if (options.observer?.onTrace) trace('worker-response', undefined, task, compileTraceStatus(result), duration,
        { queueMs: safeDuration(before - task.queuedAt) });
    } catch { fail(task, 'worker-failed'); }
  }

  function closeWorker(slot: Slot): void {
    clearTimeout(slot.idle);
    slot.idle = undefined;
    const worker = slot.worker;
    slot.worker = undefined;
    slot.baselines.clear();
    reportIdle(slot);
    if (!worker) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    try { worker.terminate(); } catch { /* The slot already owns no worker. */ }
  }

  function finish(slot: Slot): Flight | undefined {
    const flight = slot.flight;
    if (flight) clearTimeout(flight.timeout);
    slot.flight = undefined;
    if (flight && slot.worker && options.observer?.onTrace) slot.idleSince = now();
    return flight;
  }

  function reportIdle(slot: Slot): void {
    const idleSince = slot.idleSince;
    slot.idleSince = undefined;
    if (idleSince !== undefined && options.observer?.onTrace) trace('worker-idle', slot, undefined, undefined, safeDuration(now() - idleSince));
  }

  function workerFailed(slot: Slot, type: 'worker-error' | 'worker-timeout'): void {
    const flight = finish(slot);
    slot.failed = true;
    closeWorker(slot);
    trace(type, slot, flight?.task, type === 'worker-timeout' ? 'timeout' : 'failed',
      flight && options.observer?.onTrace ? safeDuration(now() - flight.started) : undefined);
    if (flight?.task) fallback(flight.task);
    reportReady();
    requestDrain();
  }

  function receive(slot: Slot, frame: LocalCompileWorkerResponse | undefined): void {
    const flight = slot.flight;
    if (!flight || !frame) return;
    const task = flight.task;
    const request = task?.request;
    if (frame.id !== flight.id || frame.documentId !== (request?.documentId ?? WARMUP_DOCUMENT)
      || frame.revision !== (request?.revision ?? 0)) {
      trace('worker-stale-response', slot, task, 'stale');
      return;
    }
    if (task && !pending.has(task)) {
      finish(slot);
      if (options.observer?.onTrace) trace('worker-response', slot, task, 'abandoned', safeDuration(now() - flight.started));
      requestDrain();
      return;
    }
    const retryFull = () => {
      if (!task || !flight.baseline) return false;
      slot.baselines.delete(task.request.documentId);
      finish(slot);
      if (options.observer?.onTrace) trace('worker-response', slot, task, 'retry', safeDuration(now() - flight.started));
      if (!closed && pending.has(task)) dispatch(slot, task, true);
      else requestDrain();
      return true;
    };
    if (!frame.ok) {
      if (frame.retryFull && retryFull()) return;
      workerFailed(slot, 'worker-error');
      return;
    }
    let result: LocalCompileOutcome['result'];
    let applyMs: number | undefined;
    try {
      const applyStarted = options.observer?.onTrace && ('patch' in frame || 'flatResult' in frame) ? now() : undefined;
      const decoded = 'patch' in frame
        ? (flight.baseline && frame.baseRevision === flight.baseline.revision
          ? applyLocalResultPatch(flight.baseline.result, frame.patch) : null)
        : 'flatResult' in frame ? decodeFlatCompiledData(frame.flatResult) : frame.result;
      if (applyStarted !== undefined) applyMs = safeDuration(now() - applyStarted);
      if (!isCompileResult(decoded) || !Number.isFinite(frame.duration) || frame.duration < 0
        || (decoded.ok && decoded.document.source !== (request?.source ?? ''))
        || frame.sourcePhase !== (request?.sourcePhase ?? 'final')) throw new TypeError('Invalid compile result.');
      // A patch frame carries document data only; its status must describe this
      // revision's recoveries, never the baseline it was applied to.
      result = 'patch' in frame && decoded.ok
        ? { ...decoded, status: decoded.recoveries === undefined ? 'valid' : 'recovered' }
        : decoded;
    } catch {
      if (retryFull()) return;
      workerFailed(slot, 'worker-error');
      return;
    }
    finish(slot);
    const duration = safeDuration(now() - flight.started);
    if (task && request) {
      for (const item of slots) item.baselines.delete(request.documentId);
      if (result.ok && request.sourcePhase === 'final' && frame.protocol === LOCAL_RESULT_PATCH_PROTOCOL) {
        slot.baselines.set(request.documentId, { revision: request.revision, optionsKey: task.optionsKey, result: cloneLocalCompileResult(result) });
        if (slot.baselines.size > DEFAULT_LOCAL_WORKER_DOCUMENTS) slot.baselines.delete(slot.baselines.keys().next().value!);
      }
      resolve(task, { source: request.source, result, options: request.options, mode: 'worker', duration: frame.duration,
        sourcePhase: request.sourcePhase, metrics: { worker: frame.metrics, roundTripMs: duration, applyMs,
          queueMs: safeDuration(flight.started - task.queuedAt) } });
      if (options.observer?.onTrace) trace('worker-response', slot, task, compileTraceStatus(result), duration, {
        queueMs: safeDuration(flight.started - task.queuedAt), parseMs: frame.metrics?.parseMs, semanticMs: frame.metrics?.semanticMs,
        reuseMs: frame.metrics?.reuseMs, rebuildMs: frame.metrics?.rebuildMs,
        compiledBlocks: frame.metrics?.compiledBlocks, reusedBlocks: frame.metrics?.reusedBlocks,
      });
    } else trace('worker-warmup', slot, undefined, 'ok', duration);
    reportReady();
    requestDrain();
  }

  function dispatch(slot: Slot, task?: Task, forceFull = false): void {
    clearTimeout(slot.idle);
    slot.idle = undefined;
    const id = ++sequence;
    const documentId = task?.request.documentId ?? WARMUP_DOCUMENT;
    const base = task?.request.sourcePhase === 'final' && !forceFull ? slot.baselines.get(documentId) : undefined;
    const baseline = base?.optionsKey === task?.optionsKey ? base : undefined;
    const correlation = { id, documentId, revision: task?.request.revision ?? 0, protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      traceId: task?.traceId, requestId: task?.id, sourceRevision: task?.request.revision,
      ...(task?.traceId ? { collectPerformance: true } : {}) } as const;
    const request: LocalCompileWorkerRequest = baseline && task
      ? { ...correlation, baseRevision: baseline.revision, optionsKey: task.optionsKey, targetLength: task.request.source.length,
        edit: diffSourceEdit(baseline.result.document.source, task.request.source) ?? { from: 0, to: 0, insert: '' } }
      : { ...correlation, source: task?.request.source ?? '', sourcePhase: task?.request.sourcePhase ?? 'final',
        options: task?.request.options, flatResults: FLAT_COMPILED_DATA_PROTOCOL };
    slot.flight = { task, id, baseline, started: now(), timeout: setTimeout(() => workerFailed(slot, 'worker-timeout'), timeoutMs) };
    reportIdle(slot);
    if (closed || slot.flight?.id !== id) return;
    if (task) trace('worker-request', slot, task);
    if (closed || slot.flight?.id !== id) return;
    if (task && !pending.has(task)) { finish(slot); return; }
    try { slot.worker!.postMessage(request); }
    catch { if (slot.flight?.id === id) workerFailed(slot, 'worker-error'); }
  }

  function spawn(slot: Slot): void {
    const traceEnabled = options.observer?.onTrace;
    const before = traceEnabled ? now() : 0;
    try {
      const worker = options.createWorker(slot.id);
      if (closed) { worker.terminate(); return; }
      slot.worker = worker;
      if (traceEnabled) slot.idleSince = now();
      worker.onmessage = event => { if (slot.worker === worker) receive(slot, event?.data); };
      worker.onerror = worker.onmessageerror = () => { if (slot.worker === worker) workerFailed(slot, 'worker-error'); };
      trace('worker-spawn', slot, undefined, 'ok', traceEnabled ? safeDuration(now() - before) : undefined);
    } catch { workerFailed(slot, 'worker-error'); }
  }

  function requestDrain(): void {
    if (closed || queuedDrain) return;
    queuedDrain = true;
    queueMicrotask(drain);
  }

  function drain(): void {
    queuedDrain = false;
    if (closed) return;
    clearTimeout(wakeup);
    if (!started) {
      started = true;
      starting = true;
      for (const slot of slots) {
        if (closed) return;
        spawn(slot);
        if (options.warmup && slot.worker) dispatch(slot);
      }
      starting = false;
      reportReady();
    }
    let nextWakeup = Number.POSITIVE_INFINITY;
    for (const slot of slots) {
      if (closed) return;
      if (slot.flight || (slot.failed && slots.some(other => !other.failed))) continue;
      const time = now();
      let next: Task | undefined;
      let score = Number.NEGATIVE_INFINITY;
      const active = new Set(slots.flatMap(other => other.flight?.task?.request.documentId ?? []));
      const seen = new Set<string>();
      for (const task of queue) {
        const { documentId } = task.request;
        if (active.has(documentId) || seen.has(documentId)) continue;
        seen.add(documentId);
        if (task.eligibleAt > time) { nextWakeup = Math.min(nextWakeup, task.eligibleAt); continue; }
        const value = task.priority + (time - task.queuedAt) / AGING_MS;
        if (value > score) { next = task; score = value; }
      }
      if (!next) continue;
      queue.delete(next);
      if (!slot.worker && !slot.failed) spawn(slot);
      if (closed) return;
      if (slot.worker) dispatch(slot, next);
      else { fallback(next); requestDrain(); }
    }
    const idleSlots = slots.filter(slot => slot.worker && !slot.flight);
    for (const [index, slot] of idleSlots.entries()) {
      if (index >= maxIdle) closeWorker(slot);
      else if (idleDisposeMs !== undefined && slot.idle === undefined) slot.idle = setTimeout(() => closeWorker(slot), idleDisposeMs);
    }
    if (nextWakeup < Number.POSITIVE_INFINITY) wakeup = setTimeout(requestDrain, Math.ceil(Math.max(0, nextWakeup - now())));
    notify();
  }

  requestDrain();
  return {
    ready,
    schedule(input) {
      if (closed) return Promise.reject(new LocalCompilePoolTaskError('disposed'));
      const { documentId, revision } = input;
      if (typeof documentId !== 'string' || documentId.trim() === '' || documentId.length > 256 || typeof input.source !== 'string') {
        return Promise.reject(new LocalCompilePoolTaskError('invalid-request'));
      }
      // Reject an oversized source before it occupies the queue or crosses the
      // Worker boundary; the compiler would only reject it after both copies exist.
      if (input.source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
        return Promise.reject(new LocalCompilePoolTaskError('source-too-large'));
      }
      if (!Number.isSafeInteger(revision) || revision < 0 || revision <= (revisions.get(documentId) ?? -1)) {
        return Promise.reject(new LocalCompilePoolTaskError('invalid-revision'));
      }
      const compileOptions = snapshotCompileOptions(input.options);
      const sourcePhase = input.sourcePhase ?? compileOptions?.sourcePhase ?? 'final';
      if (sourcePhase !== 'final' && sourcePhase !== 'streaming') return Promise.reject(new LocalCompilePoolTaskError('invalid-request'));
      const older = options.snapshotPolicy === 'all' ? [] : [...pending].filter(task => task.request.documentId === documentId
        && (sourcePhase === 'final' || task.request.sourcePhase === 'streaming'));
      if (pending.size - older.length >= maxPending) return Promise.reject(new LocalCompilePoolTaskError('backpressure'));
      revisions.set(documentId, revision);
      const id = ++sequence;
      const queuedAt = now();
      const promise = new Promise<LocalCompilePoolOutcome>((resolve, reject) => {
        const task: Task = { id, request: { ...input, options: compileOptions, sourcePhase }, priority: basePriority(input.priority),
          queuedAt, optionsKey: localWorkerOptionsKey(compileOptions),
          eligibleAt: queuedAt + (sourcePhase === 'streaming' ? streamingDelayMs : 0),
          traceId: options.observer?.onTrace ? createLocalTraceId() : undefined, resolve, reject };
        queue.add(task);
        pending.add(task);
      });
      for (const task of older) fail(task, 'superseded');
      requestDrain();
      return promise;
    },
    cancel(documentId) {
      for (const slot of slots) slot.baselines.delete(documentId);
      for (const task of [...pending]) if (task.request.documentId === documentId) fail(task, 'cancelled');
      requestDrain();
    },
    release(documentId) {
      for (const slot of slots) slot.baselines.delete(documentId);
      for (const task of [...pending]) if (task.request.documentId === documentId) fail(task, 'cancelled');
      revisions.delete(documentId);
      requestDrain();
    },
    setPriority(documentId, priority) {
      for (const task of queue) if (task.request.documentId === documentId) task.priority = basePriority(priority);
      if (queue.size) requestDrain();
    },
    getCounts: counts,
    dispose() {
      if (closed) return;
      closed = true;
      clearTimeout(wakeup);
      for (const task of pending) fail(task, 'disposed');
      for (const slot of slots) { finish(slot); closeWorker(slot); }
      revisions.clear();
      reportReady();
      notify();
    },
  };
}
