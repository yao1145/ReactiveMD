import { safeLocalTraceEvent } from './observability';
import type { LocalTraceEvent } from './observability-core';

interface Outcomes {
  succeeded: number;
  failed: number;
  cancelled: number;
  budgetRejected: number;
  successfulMs: number;
}

interface RenderTimings {
  mountMs?: number;
  mountedMs?: number;
  unmountMs?: number;
}

interface RevisionPerformance {
  traceId: string;
  documentId?: string;
  sourceRevision?: number;
  compile: Outcomes;
  parseMs?: number;
  semanticMs?: number;
  reuseMs?: number;
  rebuildMs?: number;
  compiledBlocks?: number;
  reusedBlocks?: number;
  mountMs?: number;
  mountedMs?: number;
  unmountMs?: number;
  documentRender?: RenderTimings;
  componentRender?: RenderTimings;
  componentLoads: Outcomes;
  developmentMounts: number;
  productionMounts: number;
  productionFinalMounts: number;
  productionRetained: number;
}

interface PoolPerformance {
  workerPoolId: string;
  readyMs?: number;
  status?: string;
}

interface WorkerPerformance {
  workerId: number;
  workerPoolId?: string;
  attempts: number;
  busyMs: number;
  idleMs: number;
  queueMs: number;
  spawnMs?: number;
  warmupMs?: number;
}

interface ComponentPerformance extends Outcomes {
  name: string;
  requests: number;
  peakSubscribers: number;
}

export interface LocalPerformanceReport {
  readonly schema: 'reactive-md-performance/v1';
  readonly eventCount: number;
  readonly window: { readonly from: number; readonly to: number } | null;
  readonly revisions: readonly RevisionPerformance[];
  readonly workers: readonly WorkerPerformance[];
  readonly pools: readonly PoolPerformance[];
  readonly components: readonly ComponentPerformance[];
}

function outcomes(): Outcomes {
  return { succeeded: 0, failed: 0, cancelled: 0, budgetRejected: 0, successfulMs: 0 };
}

type OutcomeKind = 'succeeded' | 'failed' | 'cancelled' | 'budgetRejected';

function outcomeKind(status: LocalTraceEvent['status']): OutcomeKind | undefined {
  if (status === 'ok') return 'succeeded';
  if (status === 'budget-rejected') return 'budgetRejected';
  if (status === 'failed' || status === 'worker-failed' || status === 'timeout') return 'failed';
  if (status === 'cancelled' || status === 'superseded' || status === 'disposed' || status === 'abandoned') return 'cancelled';
  return undefined;
}

function apply(target: Outcomes, kind: OutcomeKind, durationMs: number): void {
  if (kind === 'succeeded') { target.succeeded++; target.successfulMs += durationMs; return; }
  if (kind === 'failed') target.failed++;
  else if (kind === 'cancelled') target.cancelled++;
  else target.budgetRejected++;
}

function unapply(target: Outcomes, kind: OutcomeKind, durationMs: number): void {
  if (kind === 'succeeded') { target.succeeded--; target.successfulMs -= durationMs; return; }
  if (kind === 'failed') target.failed--;
  else if (kind === 'cancelled') target.cancelled--;
  else target.budgetRejected--;
}

/** Legacy per-event counting for events without a requestId; abandoned and retry stay unrecorded. */
function record(target: Outcomes, event: LocalTraceEvent): void {
  if (event.status === 'abandoned') return;
  const kind = outcomeKind(event.status);
  if (kind) apply(target, kind, event.durationMs ?? 0);
}

const compileMetrics = ['parseMs', 'semanticMs', 'reuseMs', 'rebuildMs', 'compiledBlocks', 'reusedBlocks'] as const;

function recordCompileMetrics(revision: RevisionPerformance, event: LocalTraceEvent) {
  for (const key of compileMetrics) {
    const value = event[key];
    if (value !== undefined) revision[key] = (revision[key] ?? 0) + value;
  }
}

function recordRender(target: RenderTimings, event: LocalTraceEvent) {
  if (event.type === 'render-mount' && event.durationMs !== undefined) target.mountMs = (target.mountMs ?? 0) + event.durationMs;
  if (event.type === 'render-unmount' && event.mountedMs !== undefined) target.mountedMs = (target.mountedMs ?? 0) + event.mountedMs;
  if (event.type === 'render-unmount' && event.unmountMs !== undefined) target.unmountMs = (target.unmountMs ?? 0) + event.unmountMs;
}

/** Summarize the last 512 trace records. The input stays host-owned. */
export function createLocalPerformanceReport(events: readonly LocalTraceEvent[]): LocalPerformanceReport {
  const revisions = new Map<string, RevisionPerformance>();
  const workers = new Map<string, WorkerPerformance>();
  const pools = new Map<string, PoolPerformance>();
  const components = new Map<string, ComponentPerformance>();
  const terminalByRequest = new Map<string, { revision: RevisionPerformance; event: LocalTraceEvent; kind: OutcomeKind }>();
  let from = Number.POSITIVE_INFINITY, to = 0, eventCount = 0;
  for (const raw of events.slice(-512)) {
    const event = safeLocalTraceEvent(raw);
    if (!event) continue;
    from = Math.min(from, event.timestamp);
    to = Math.max(to, event.timestamp);
    eventCount++;
    const { traceId, documentId, sourceRevision, workerId, workerPoolId, componentName, type } = event;
    const compile = type === 'compile-end' || type === 'worker-response' || type === 'worker-cancel'
      || ((type === 'worker-error' || type === 'worker-timeout') && (workerPoolId === undefined || event.requestId !== undefined));
    const load = type === 'component-load-start' || type === 'component-load-end';
    if (compile || load || type === 'component-load-wait-end' || type === 'render-mount' || type === 'render-unmount' || type === 'render-retained') {
      const key = JSON.stringify([traceId, documentId, sourceRevision]);
      let revision = revisions.get(key);
      if (!revision) {
        revision = { traceId, documentId, sourceRevision, compile: outcomes(), componentLoads: outcomes(),
          developmentMounts: 0, productionMounts: 0,
          productionFinalMounts: 0, productionRetained: 0 };
        revisions.set(key, revision);
      }
      if (compile) {
        if (event.requestId === undefined) {
          record(revision.compile, event);
          if (event.status === 'ok') recordCompileMetrics(revision, event);
        } else {
          const kind = outcomeKind(event.status);
          if (kind) {
            const requestKey = `${key}\u0000${event.requestId}`;
            const previous = terminalByRequest.get(requestKey);
            if (previous) unapply(previous.revision.compile, previous.kind, previous.event.durationMs ?? 0);
            terminalByRequest.set(requestKey, { revision, kind, event });
            apply(revision.compile, kind, event.durationMs ?? 0);
          }
        }
      }
      if (type === 'render-mount' || type === 'render-unmount') {
        recordRender(revision, event);
        recordRender(componentName ? (revision.componentRender ??= {}) : (revision.documentRender ??= {}), event);
      }
      if (type === 'component-load-wait-end' || (type === 'component-load-end' && event.loadId === undefined)) record(revision.componentLoads, event);
      if (componentName && type === 'render-mount') {
        if (event.environment === 'development') revision.developmentMounts++;
        if (event.environment === 'production') {
          revision.productionMounts++;
          if (event.sourcePhase === 'final') revision.productionFinalMounts++;
        }
      }
      if (componentName && type === 'render-retained' && event.environment === 'production') revision.productionRetained++;
    }
    if (type === 'worker-ready' && workerPoolId !== undefined) {
      pools.set(workerPoolId, { workerPoolId, readyMs: event.durationMs, status: event.status });
    }
    if (workerId !== undefined) {
      const key = JSON.stringify([workerPoolId, workerId]);
      let worker = workers.get(key);
      if (!worker) {
        worker = { workerId, ...(workerPoolId === undefined ? {} : { workerPoolId }), attempts: 0, busyMs: 0, idleMs: 0, queueMs: 0 };
        workers.set(key, worker);
      }
      if (type === 'worker-request') worker.attempts++;
      if (type === 'worker-response' || type === 'worker-timeout' || type === 'worker-error' || type === 'worker-warmup') {
        worker.busyMs += event.durationMs ?? 0;
        worker.queueMs += event.queueMs ?? 0;
      }
      if (type === 'worker-idle') worker.idleMs += event.durationMs ?? 0;
      if (type === 'worker-spawn' && event.durationMs !== undefined) worker.spawnMs = (worker.spawnMs ?? 0) + event.durationMs;
      if (type === 'worker-warmup' && event.durationMs !== undefined) worker.warmupMs = (worker.warmupMs ?? 0) + event.durationMs;
    }
    if (load && componentName) {
      let component = components.get(componentName);
      if (!component) {
        component = { name: componentName, requests: 0, peakSubscribers: 0, ...outcomes() };
        components.set(componentName, component);
      }
      if (type === 'component-load-start') component.requests++;
      else {
        record(component, event);
        component.peakSubscribers = Math.max(component.peakSubscribers, event.subscribers ?? 0);
      }
    }
  }
  for (const { revision, event, kind } of terminalByRequest.values()) {
    if (kind === 'succeeded') recordCompileMetrics(revision, event);
  }
  return { schema: 'reactive-md-performance/v1', eventCount, window: eventCount ? { from, to } : null,
    revisions: [...revisions.values()], workers: [...workers.values()], pools: [...pools.values()], components: [...components.values()] };
}
