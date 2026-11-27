import { safeLocalTraceEvent } from './observability';
import type { LocalTraceEvent } from './observability-core';

interface Outcomes {
  succeeded: number;
  failed: number;
  cancelled: number;
  budgetRejected: number;
  successfulMs: number;
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
  componentLoads: Outcomes;
  developmentMounts: number;
  productionMounts: number;
  productionFinalMounts: number;
  productionRetained: number;
}

interface WorkerPerformance {
  workerId: number;
  attempts: number;
  busyMs: number;
  idleMs: number;
  queueMs: number;
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
  readonly components: readonly ComponentPerformance[];
}

function outcomes(): Outcomes {
  return { succeeded: 0, failed: 0, cancelled: 0, budgetRejected: 0, successfulMs: 0 };
}

function record(target: Outcomes, event: LocalTraceEvent): void {
  if (event.status === 'ok') { target.succeeded++; target.successfulMs += event.durationMs ?? 0; }
  if (event.status === 'budget-rejected') target.budgetRejected++;
  if (event.status === 'failed' || event.status === 'worker-failed' || event.status === 'timeout') target.failed++;
  if (event.status === 'cancelled' || event.status === 'superseded' || event.status === 'disposed') target.cancelled++;
}

const compileMetrics = ['parseMs', 'semanticMs', 'reuseMs', 'rebuildMs', 'compiledBlocks', 'reusedBlocks'] as const;

/** Summarize the last 512 trace records. The input stays host-owned. */
export function createLocalPerformanceReport(events: readonly LocalTraceEvent[]): LocalPerformanceReport {
  const revisions = new Map<string, RevisionPerformance>();
  const workers = new Map<number, WorkerPerformance>();
  const components = new Map<string, ComponentPerformance>();
  let from = Number.POSITIVE_INFINITY, to = 0, eventCount = 0;
  for (const raw of events.slice(-512)) {
    const event = safeLocalTraceEvent(raw);
    if (!event) continue;
    from = Math.min(from, event.timestamp);
    to = Math.max(to, event.timestamp);
    eventCount++;
    const { traceId, documentId, sourceRevision, workerId, componentName, type } = event;
    const compile = type === 'compile-end' || type === 'worker-response' || type === 'worker-cancel'
      || type === 'worker-error' || type === 'worker-timeout';
    const load = type === 'component-load-start' || type === 'component-load-end';
    if (compile || load || type === 'render-mount' || type === 'render-retained') {
      const key = JSON.stringify([traceId, documentId, sourceRevision]);
      let revision = revisions.get(key);
      if (!revision) {
        revision = { traceId, documentId, sourceRevision, compile: outcomes(), componentLoads: outcomes(),
          developmentMounts: 0, productionMounts: 0,
          productionFinalMounts: 0, productionRetained: 0 };
        revisions.set(key, revision);
      }
      if (compile) {
        record(revision.compile, event);
        if (event.status === 'ok') {
          for (const key of compileMetrics) {
            const value = event[key];
            if (value !== undefined) revision[key] = (revision[key] ?? 0) + value;
          }
        }
      }
      if (type === 'component-load-end') record(revision.componentLoads, event);
      if (componentName && type === 'render-mount') {
        if (event.environment === 'development') revision.developmentMounts++;
        if (event.environment === 'production') {
          revision.productionMounts++;
          if (event.sourcePhase === 'final') revision.productionFinalMounts++;
        }
      }
      if (componentName && type === 'render-retained' && event.environment === 'production') revision.productionRetained++;
    }
    if (workerId !== undefined) {
      let worker = workers.get(workerId);
      if (!worker) { worker = { workerId, attempts: 0, busyMs: 0, idleMs: 0, queueMs: 0 }; workers.set(workerId, worker); }
      if (type === 'worker-request') worker.attempts++;
      if (type === 'worker-response' || type === 'worker-timeout' || type === 'worker-error' || type === 'worker-warmup') {
        worker.busyMs += event.durationMs ?? 0;
        worker.queueMs += event.queueMs ?? 0;
      }
      if (type === 'worker-idle') worker.idleMs += event.durationMs ?? 0;
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
  return { schema: 'reactive-md-performance/v1', eventCount, window: eventCount ? { from, to } : null,
    revisions: [...revisions.values()], workers: [...workers.values()], components: [...components.values()] };
}
