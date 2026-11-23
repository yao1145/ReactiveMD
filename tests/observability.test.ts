import { describe, expect, it, vi } from 'vitest';
import {
  compileLocal, createDiagnosticReport, formatLocalDiagnostic, LocalCompileScheduler,
  type Diagnostic, type LocalCompileWorker, type LocalCompileWorkerRequest, type LocalTraceEvent,
} from '../src';

describe('local observability', () => {
  it('keeps source-derived messages and attributes out of reports by default', () => {
    const source = '{{ privateBinding }}';
    const original = compileLocal(source).diagnostics[0];
    const report = createDiagnosticReport(source, { diagnostics: [{
      ...original,
      message: 'privateBinding appears in this message',
      params: { name: 'privateBinding' },
      details: { budget: 'maxCssBytes', limit: 12, actual: 16, unit: 'bytes', owner: 'C:/Users/name/private.css' },
    }] });
    expect(JSON.stringify(report)).not.toContain('privateBinding');
    expect(JSON.stringify(report)).not.toContain('C:/Users/name');
    expect(report.document.sourceBytes).toBe(source.length);
    expect(report.package.syntax).toBe('local-draft-3');
    expect(report.diagnostics[0]).toMatchObject({
      phase: 'semantic', recoverable: false,
      details: { budget: 'maxCssBytes', limit: 12, actual: 16, unit: 'bytes' },
    });
  });

  it('reports syntax budget usage through the observer without changing the result', () => {
    const options = { limits: { maxSyntaxNodes: 1 } };
    const source = '# Heading\n\nSome text';
    const result = compileLocal(source, options);
    const events: LocalTraceEvent[] = [];
    const diagnostics: Diagnostic[] = [];
    expect(compileLocal(source, { ...options, observer: {
      onDiagnostic(diagnostic) {
        diagnostics.push({ ...diagnostic, range: { ...diagnostic.range } });
        diagnostic.range.start = 123;
        throw new Error('observer failure');
      },
      onTrace: event => events.push(event),
    } })).toEqual(result);
    expect(diagnostics[0]).toMatchObject({ phase: 'resource', details: { budget: 'maxSyntaxNodes', limit: 1, actual: 2, unit: 'nodes' } });
    expect(result.diagnostics[0].details).toMatchObject({ budget: 'maxSyntaxNodes', actual: 2 });
    expect(events.map(event => event.type)).toEqual(['compile-start', 'compile-end']);
    expect(events[0].traceId).toBe(events[1].traceId);
    expect(compileLocal('text', { observer: { onTrace: event => events.push(event) } }).ok).toBe(true);
    expect(events[2].traceId).not.toBe(events[0].traceId);
  });

  it('attributes superseded responses to the original request and times out the current one', () => {
    vi.useFakeTimers();
    const requests: LocalCompileWorkerRequest[] = [];
    const worker: LocalCompileWorker = {
      postMessage: request => requests.push(request),
      terminate: vi.fn(),
      onmessage: null, onerror: null, onmessageerror: null,
    };
    const events: LocalTraceEvent[] = [];
    const diagnostics: Diagnostic[] = [];
    const onResult = vi.fn();
    const scheduler = new LocalCompileScheduler({
      createWorker: () => worker, onResult, delay: 0, timeoutMs: 20,
      observer: { onTrace: event => events.push(event), onDiagnostic: diagnostic => diagnostics.push(diagnostic) },
    });
    try {
      scheduler.schedule('old', undefined, undefined, 'final');
      const old = requests[0];
      expect(old.requestId).toBe(old.id);
      scheduler.schedule('new', undefined, undefined, 'final');
      const savedHandler = worker.onmessage;
      savedHandler?.({ data: { id: old.id, traceId: old.traceId, sourceRevision: old.sourceRevision, ok: true, result: compileLocal('old'), duration: 1 } });
      expect(onResult).not.toHaveBeenCalled();
      expect(events.find(event => event.type === 'worker-stale-response')).toMatchObject({
        traceId: old.traceId, requestId: old.id, sourceRevision: old.sourceRevision,
      });
      const current = requests[1];
      vi.advanceTimersByTime(20);
      expect(onResult).toHaveBeenCalledOnce();
      expect(onResult.mock.calls[0][0]).toMatchObject({ source: 'new', mode: 'fallback' });
      expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(['local.worker.stale-response', 'local.worker.timeout']);
      expect(formatLocalDiagnostic(diagnostics[1], 'zh')).toContain('20');
      savedHandler?.({ data: { id: current.id, traceId: current.traceId, sourceRevision: current.sourceRevision, ok: true, result: compileLocal('new'), duration: 1 } });
      expect(events.filter(event => event.type === 'worker-stale-response')).toHaveLength(2);
      expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
        'local.worker.stale-response', 'local.worker.timeout', 'local.worker.stale-response',
      ]);
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
  });

  it('reports oversized sources and bounds recent events without including source text', () => {
    const source = 'private source '.repeat(80_000);
    const events: LocalTraceEvent[] = Array.from({ length: 80 }, (_, index) => ({
      type: 'worker-request', traceId: `trace-${index}`, requestId: index, timestamp: index,
    }));
    const report = createDiagnosticReport(source, { events });
    expect(report.document.sourceBytes).toBe(source.length);
    expect(report.environment).toMatchObject({ runtime: 'node', node: process.versions.node, platform: process.platform });
    expect(report.events).toHaveLength(50);
    expect(report.events?.[0].traceId).toBe('trace-30');
    expect(JSON.stringify(report)).not.toContain('private source');
    expect(new TextEncoder().encode(JSON.stringify(report)).length).toBeLessThanOrEqual(64 * 1024);
  });

  it('stops result delivery when a diagnostic observer disposes the scheduler', () => {
    const worker: LocalCompileWorker = {
      postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null,
    };
    const onResult = vi.fn();
    let request: LocalCompileWorkerRequest;
    worker.postMessage = message => { request = message; };
    const scheduler = new LocalCompileScheduler({
      createWorker: () => worker, onResult,
      observer: { onDiagnostic: () => scheduler.dispose() },
    });
    scheduler.schedule('{{ missing }}', undefined, undefined, 'final');
    const handler = worker.onmessage;
    handler?.({ data: { id: request!.id, ok: true, result: compileLocal('{{ missing }}'), duration: 1 } });
    expect(onResult).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
