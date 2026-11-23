import { describe, expect, it, vi } from 'vitest';
import { readLocalExportResources } from '../src/export';
import {
  compileFailureDiagnostic, compileLocal, createDiagnosticReport, formatLocalDiagnostic, LocalCompileScheduler,
  type Diagnostic, type LocalCompileOutcome, type LocalCompileWorker, type LocalCompileWorkerRequest, type LocalTraceEvent,
} from '../src';

describe('local observability', () => {
  it('emits only public diagnostic severities in reports', () => {
    const diagnostic = compileLocal('{{ missing }}').diagnostics[0];
    const diagnostics = [
      { ...diagnostic, severity: 'error' },
      { ...diagnostic, severity: 'warning' },
    ] satisfies Diagnostic[];
    // JavaScript callers can supply values outside the public TypeScript union.
    const unsupported = ['info', 'fatal'].map(severity => ({ ...diagnostic, severity })) as Diagnostic[];
    const report = createDiagnosticReport('source', { diagnostics: [...diagnostics, ...unsupported] });
    expect(report.diagnostics.map(item => item.severity)).toEqual(['error', 'warning']);
  });

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

  it('formats a worker compile failure with its bounded underlying reason in both locales', () => {
    const diagnostic = compileFailureDiagnostic(new Error('boom: the worker stack disappeared'));
    expect(diagnostic.code).toBe('local.worker.compile');
    expect(diagnostic.params?.detail).toBe('boom: the worker stack disappeared');

    const en = formatLocalDiagnostic(diagnostic, 'en');
    const zh = formatLocalDiagnostic(diagnostic, 'zh');
    expect(en).toContain('boom: the worker stack disappeared');
    expect(zh).toContain('boom: the worker stack disappeared');
    expect(en.length).toBeLessThanOrEqual(2_000);
    expect(zh.length).toBeLessThanOrEqual(2_000);
  });

  it('bounds a long worker failure reason and keeps it out of diagnostic reports', () => {
    const secret = `boom-${'private-token-'.repeat(400)}`;
    const diagnostic = compileFailureDiagnostic(new Error(secret));
    const detail = String(diagnostic.params?.detail ?? '');
    expect(detail.length).toBeLessThanOrEqual(160);
    expect(detail.startsWith('boom-private-token-')).toBe(true);

    const en = formatLocalDiagnostic(diagnostic, 'en');
    const zh = formatLocalDiagnostic(diagnostic, 'zh');
    expect(en.length).toBeLessThan(400);
    expect(zh.length).toBeLessThan(400);
    expect(en).toContain('boom-private-token-');
    expect(zh).toContain('boom-private-token-');

    const report = createDiagnosticReport('document', { diagnostics: [diagnostic] });
    expect(JSON.stringify(report)).not.toContain('private-token-');
    expect(report.diagnostics[0]).toMatchObject({
      code: 'local.worker.compile',
      messageKey: 'local.worker.compile.detail',
    });
  });

  it('keeps the generic template when the exception carries no text', () => {
    const diagnostic = compileFailureDiagnostic(new Error(''));
    expect(diagnostic.messageKey).toBe('local.worker.compile');
    expect(diagnostic.params).toBeUndefined();
    expect(formatLocalDiagnostic(diagnostic, 'en')).toBe('The background compiler could not complete this request.');
    expect(formatLocalDiagnostic(diagnostic, 'zh')).toBe('编译 Worker 无法完成此请求。');
  });

  it('keeps export cancellation events with bounded statuses in reports', () => {
    const base = { type: 'export-cancel' as const, traceId: 'trace-export-1', timestamp: 10, stage: 'download' };
    const report = createDiagnosticReport('document', {
      events: [
        { ...base, status: 'cancelled' },
        { ...base, status: 'printed' },
        { ...base, status: 'anything-else' },
        { ...base, type: 'export-unknown' as LocalTraceEvent['type'] },
      ],
    });
    expect(report.events?.map(event => event.status)).toEqual(['cancelled', 'printed', undefined]);
    expect(report.events?.every(event => event.type === 'export-cancel')).toBe(true);
  });

  it('keeps export resource failure codes in reports and still drops unknown codes and free text', () => {
    const invalid = readLocalExportResources([
      { id: 'remote.css', css: '.a { background: url(https://example.com/x.png); }' },
    ]).diagnostics;
    const conflict = readLocalExportResources([
      { id: 'same.css', css: '.a { color: red; }' },
      { id: 'same.css', css: '.a { color: blue; }' },
    ]).diagnostics;
    const unknownCode: Diagnostic = {
      code: 'local.extension.unknown-report-code',
      message: 'secret free code',
      severity: 'error',
      range: { start: 0, end: 0 },
      line: 1,
      column: 1,
    };
    const hostCode: Diagnostic = { ...unknownCode, code: 'host.free-text', message: 'secret free text' };
    const report = createDiagnosticReport('document', {
      diagnostics: [...invalid, ...conflict, unknownCode, hostCode],
    });
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'local.extension.resource-invalid',
      'local.extension.resource-conflict',
    ]);
    expect(report.diagnostics.every(diagnostic => diagnostic.phase === 'export' && diagnostic.severity === 'error')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret free');
  });

  it('reports a bounded worker startup failure once on the first fallback task', () => {
    const reason = `factory exploded: ${'private-startup-token-'.repeat(20)}`;
    const events: LocalTraceEvent[] = [];
    const results: LocalCompileOutcome[] = [];
    const scheduler = new LocalCompileScheduler({
      createWorker: () => {
        throw new Error(reason);
      },
      fallbackCompile: source => compileLocal(source),
      onResult: outcome => results.push(outcome),
      observer: { onTrace: event => events.push(event) },
    });
    try {
      scheduler.schedule('first', undefined, undefined, 'final');
      scheduler.schedule('second', undefined, undefined, 'final');
      expect(results.map(outcome => outcome.source)).toEqual(['first', 'second']);

      const startup = events.filter(event => event.type === 'worker-error');
      expect(startup).toHaveLength(1);
      const firstStart = events.find(event => event.type === 'compile-start')!;
      expect(startup[0]).toMatchObject({
        type: 'worker-error',
        code: 'local.worker.startup',
        status: 'failed',
        traceId: firstStart.traceId,
        sourceRevision: firstStart.sourceRevision,
      });
      const detail = startup[0].detail;
      expect(detail).toBeTypeOf('string');
      expect(detail!.length).toBeLessThanOrEqual(160);
      expect(detail!.startsWith('factory exploded: private-startup-token-')).toBe(true);

      const report = createDiagnosticReport('document', { events });
      expect(JSON.stringify(report)).not.toContain('private-startup-token-');
      const reported = report.events?.find(event => event.code === 'local.worker.startup');
      expect(reported).toMatchObject({ type: 'worker-error', status: 'failed', traceId: firstStart.traceId });
      expect(reported && Object.hasOwn(reported, 'detail')).toBe(false);
    } finally {
      scheduler.dispose();
    }
  });
});
