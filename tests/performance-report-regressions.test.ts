import { describe, expect, it, vi } from 'vitest';
import { createLocalPerformanceReport } from '../src/local/performance-report';
import type { LocalTraceEvent } from '../src/local/observability-core';
import { createLocalCompilePool } from '../src/local/transport/worker-pool';
import { SharedComponentLoader } from '../src/react/component-loader';

const context = { traceId: 'trace-perf', documentId: 'doc-perf', sourceRevision: 7, timestamp: 1 } as const;

function zeroOutcomes() {
  return { succeeded: 0, failed: 0, cancelled: 0, budgetRejected: 0, successfulMs: 0 };
}

describe('local performance report regressions', () => {
  it('counts one resolver call and attributes the wait to each subscribed revision', async () => {
    const events: LocalTraceEvent[] = [];
    const observer = { onTrace: (event: LocalTraceEvent) => events.push(event) };
    let resolve!: (value: string) => void;
    let calls = 0;
    const loader = new SharedComponentLoader(() => {
      calls++;
      return new Promise<string>(done => { resolve = done; });
    }, (definition: { name: string }) => definition.name, (_, value) => value);
    const definition = { name: 'test-card' };
    const a = { observer, traceId: 'trace-a', documentId: 'a', sourceRevision: 1 };
    const b = { observer, traceId: 'trace-b', documentId: 'b', sourceRevision: 2 };
    const removeA = loader.subscribe(definition, () => {}, a);
    const removeB = loader.subscribe(definition, () => {}, b);
    const ready = new Promise<void>(done => loader.subscribe(definition, done, b));
    await Promise.resolve();
    removeA();
    resolve('ready');
    await ready;
    removeB();
    expect(calls).toBe(1);
    const report = createLocalPerformanceReport(events);
    expect(report.components).toMatchObject([{ name: 'test-card', requests: 1, succeeded: 1, peakSubscribers: 3 }]);
    expect(report.revisions.find(item => item.documentId === 'a')?.componentLoads).toMatchObject({ cancelled: 1 });
    expect(report.revisions.find(item => item.documentId === 'b')?.componentLoads).toMatchObject({ succeeded: 1 });
  });

  it('records phase timings in a default Worker fallback and distinguishes worker pools', async () => {
    const events: LocalTraceEvent[] = [];
    const observer = { onTrace: (event: LocalTraceEvent) => events.push(event) };
    const newPool = () => createLocalCompilePool({ workers: 1, observer, createWorker: () => { throw new Error('unavailable'); } });
    const first = newPool();
    const second = newPool();
    try {
      await first.schedule({ documentId: 'a', revision: 1, source: 'First' });
      await second.schedule({ documentId: 'b', revision: 1, source: 'Second', sourcePhase: 'streaming' });
      const report = createLocalPerformanceReport(events);
      expect(report.revisions).toHaveLength(2);
      expect(report.revisions).toEqual(expect.arrayContaining(['a', 'b'].map(documentId => expect.objectContaining({
        documentId, parseMs: expect.any(Number), semanticMs: expect.any(Number),
      }))));
      expect(report.pools).toMatchObject(Array.from({ length: 2 }, () => ({ readyMs: expect.any(Number), status: 'degraded' })));
      expect(report.workers).toMatchObject(Array.from({ length: 2 }, () => ({ workerId: 1, spawnMs: expect.any(Number) })));
      const pools = new Set(events.map(event => event.workerPoolId));
      expect(pools.size).toBe(2);
      expect(pools.has(undefined)).toBe(false);
    } finally { first.dispose(); second.dispose(); }
  });

  it('loads a component without reading the observation clock when tracing is off', async () => {
    const loader = new SharedComponentLoader(() => 'ready', (definition: { name: string }) => definition.name, (_, value) => value);
    const readClock = vi.spyOn(performance, 'now');
    const definition = { name: 'test-card' };
    try {
      await new Promise<void>(resolve => loader.subscribe(definition, resolve));
      expect(loader.snapshot(definition)).toEqual({ status: 'ready', component: 'ready' });
      expect(readClock).not.toHaveBeenCalled();
    } finally { readClock.mockRestore(); }
  });
  it('counts a timeout followed by a successful fallback as one success', () => {
    const { revisions } = createLocalPerformanceReport([
      { ...context, type: 'worker-timeout', requestId: 7, status: 'timeout', durationMs: 4, workerId: 1 },
      { ...context, type: 'worker-response', requestId: 7, status: 'ok', durationMs: 9, queueMs: 2, workerId: 2 },
    ]);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].compile).toEqual({ succeeded: 1, failed: 0, cancelled: 0, budgetRejected: 0, successfulMs: 9 });
  });

  it('counts a timeout followed by a fallback compile-end as one success', () => {
    const { revisions } = createLocalPerformanceReport([
      { ...context, type: 'worker-timeout', requestId: 12, status: 'timeout', durationMs: 4 },
      { ...context, type: 'compile-end', requestId: 12, status: 'ok', durationMs: 8 },
    ]);
    expect(revisions[0].compile).toEqual({ ...zeroOutcomes(), succeeded: 1, successfulMs: 8 });
  });

  it('counts an abandoned requestId response as cancelled', () => {
    const { revisions } = createLocalPerformanceReport([
      { ...context, type: 'worker-response', requestId: 8, status: 'abandoned', durationMs: 5 },
    ]);
    expect(revisions[0].compile).toEqual({ ...zeroOutcomes(), cancelled: 1 });
  });

  it('does not count a retry response that carries a requestId', () => {
    const { revisions } = createLocalPerformanceReport([
      { ...context, type: 'worker-response', requestId: 9, status: 'retry', durationMs: 5 },
    ]);
    expect(revisions[0].compile).toEqual(zeroOutcomes());
  });

  it('keeps only the last non-retry outcome for a requestId', () => {
    const { revisions } = createLocalPerformanceReport([
      { ...context, type: 'worker-timeout', requestId: 11, status: 'timeout', durationMs: 4 },
      { ...context, type: 'worker-response', requestId: 11, status: 'ok', durationMs: 4, parseMs: 1 },
      { ...context, type: 'worker-response', requestId: 11, status: 'retry', durationMs: 5 },
      { ...context, type: 'worker-error', requestId: 11, status: 'failed', durationMs: 6 },
    ]);
    expect(revisions[0].compile).toEqual({ ...zeroOutcomes(), failed: 1 });
    expect(revisions[0].parseMs).toBeUndefined();
  });

  it('aggregates mount and mounted durations per revision', () => {
    const { revisions, eventCount } = createLocalPerformanceReport([
      { ...context, type: 'render-mount', componentName: 'test-card', environment: 'production', durationMs: 3 },
      { ...context, type: 'render-unmount', componentName: 'test-card', environment: 'production', mountedMs: 7, unmountMs: 2 },
    ]);
    expect(eventCount).toBe(2);
    expect(revisions[0]).toMatchObject({ mountMs: 3, mountedMs: 7, unmountMs: 2, productionMounts: 1, developmentMounts: 0 });
    expect(revisions[0].componentRender).toEqual({ mountMs: 3, mountedMs: 7, unmountMs: 2 });
  });

  it('still counts events without a requestId per event', () => {
    const { revisions } = createLocalPerformanceReport([
      { ...context, type: 'compile-end', status: 'ok', durationMs: 4, parseMs: 1 },
      { ...context, type: 'worker-response', status: 'budget-rejected', durationMs: 10 },
      { ...context, type: 'worker-cancel', status: 'superseded' },
      { ...context, type: 'worker-response', status: 'failed', durationMs: 3 },
      { ...context, type: 'worker-timeout', status: 'timeout', durationMs: 1 },
    ]);
    expect(revisions[0].compile).toEqual({
      succeeded: 1, failed: 2, cancelled: 1, budgetRejected: 1, successfulMs: 4,
    });
    expect(revisions[0].parseMs).toBe(1);
  });
});
