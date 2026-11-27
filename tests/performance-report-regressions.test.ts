import { describe, expect, it } from 'vitest';
import { createLocalPerformanceReport } from '../src/local/performance-report';

const context = { traceId: 'trace-perf', documentId: 'doc-perf', sourceRevision: 7, timestamp: 1 } as const;

function zeroOutcomes() {
  return { succeeded: 0, failed: 0, cancelled: 0, budgetRejected: 0, successfulMs: 0 };
}

describe('local performance report regressions', () => {
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
      { ...context, type: 'worker-response', requestId: 11, status: 'retry', durationMs: 5 },
      { ...context, type: 'worker-error', requestId: 11, status: 'failed', durationMs: 6 },
    ]);
    expect(revisions[0].compile).toEqual({ ...zeroOutcomes(), failed: 1 });
  });

  it('aggregates mount and mounted durations per revision', () => {
    const { revisions, eventCount } = createLocalPerformanceReport([
      { ...context, type: 'render-mount', componentName: 'test-card', environment: 'production', durationMs: 3 },
      { ...context, type: 'render-unmount', componentName: 'test-card', environment: 'production', mountedMs: 7 },
    ]);
    expect(eventCount).toBe(2);
    expect(revisions[0]).toMatchObject({ mountMs: 3, mountedMs: 7, productionMounts: 1, developmentMounts: 0 });
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