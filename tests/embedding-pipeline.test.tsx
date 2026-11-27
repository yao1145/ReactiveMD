import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { compileLocal, createLocalRuntime, createLocalRuntimePool, localCompileOptionsKey } from '../src/local';
import { walkLocalNodes } from '../src/local/source/source-context';
import { startLocalCompileWorker, type LocalCompileWorkerRequest, type LocalCompileWorker } from '../src/local/transport/worker';
import { createLocalCompilePool } from '../src/local/transport/worker-pool';
import { createDiagnosticReport, createLocalPerformanceReport, type LocalTraceEvent } from '../src/observability';
import { createDeferredReactConfig, defineReactComponent, LocalDocumentView } from '../src/react';
import { LocalComponentLoader } from '../src/react/component-loader';
import { renderLocalStaticMarkup } from '../src/react/server';
import { createReactHost, deriveLocalReactPreset } from '../src/react/packed';
import layoutPack from '../src/components/packs/layout';
import dataPack from '../src/components/packs/data';
import visualsPack from '../src/components/packs/visuals';
import { createLocalConfig, defineLocalComponent, deriveLocalPreset, LOCAL_COMPONENT_PROTOCOL } from '../src/sdk';
import type { LocalCompileOptions } from '../src/local/types';

function compile(source: string, options?: LocalCompileOptions) {
  const result = compileLocal(source, options);
  if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
  return result.document;
}

describe('embedding and static rendering', () => {
  it('prunes a component whose attribute fails semantic validation and rebuilds its bindings', () => {
    const result = compileLocal('<input bind="broken" label="{{ missing }}" />\n\nAfter', {
      embedding: { onUnsupported: 'fallback' },
    });
    expect(result).toMatchObject({ ok: true, diagnostics: [expect.objectContaining({ code: 'local.embedding.attribute' })],
      document: { bindings: {}, requiresRuntime: false } });
    expect(compileLocal('Before {{ unfinished\n\nAfter', { embedding: { expressions: 'literal' } })).toMatchObject({ ok: true });
    const conditional = compile('<if when="true">\n\nStatic branch\n\n</if>', {
      embedding: { expressions: 'literal', allowInteractive: false, onUnsupported: 'fallback' },
    });
    expect(conditional.requiresRuntime).toBe(false);
    expect(renderLocalStaticMarkup({ document: conditional })).toMatchObject({ ok: true, markup: expect.stringContaining('class="local-if md-if"') });
  });

  it('renders opted-in static external slots through the host or an inert placeholder', () => {
    const document = compile('<external slot="notice" />\n\nAfter', {
      embedding: { allowExternalSlots: true, expressions: 'literal' },
    });
    expect(document).toMatchObject({ requiresRuntime: false, bindings: {} });
    expect(renderLocalStaticMarkup({ document })).toMatchObject({ ok: true, markup: expect.stringContaining('data-rmd-external-slot="notice"') });
    expect(renderLocalStaticMarkup({ document, renderExternalSlot: slot => <b>{slot.name}</b> }))
      .toMatchObject({ ok: true, markup: expect.stringContaining('<b>notice</b>') });
    const resolver = vi.fn(() => () => <b>Deferred</b>);
    expect(renderLocalStaticMarkup({ document, resolveExternalSlot: resolver }))
      .toMatchObject({ ok: true, markup: expect.stringContaining('data-rmd-component-load="loading"') });
    expect(resolver).not.toHaveBeenCalled();
  });
  it('publishes literal source and locatable fallback nodes with no runtime dependencies', () => {
    const source = '# Hello {{ missing + }}\n\n![x][ref]\n\n[ref]: https://example.com/a.png\n\n<slider bind="n"/>\n\n<unmounted />\n\nSafe **text**';
    const options = { embedding: { expressions: 'literal', onUnsupported: 'fallback', allowImages: false, allowInteractive: false } } as const;
    const result = compileLocal(source, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { document } = result;
    expect(document.requiresRuntime).toBe(false);
    expect(document.bindings).toEqual({});
    const fallback = [...walkLocalNodes(document.nodes)].filter(node => node.type === 'fallback');
    expect(fallback.map(node => node.fallback?.code)).toEqual(['local.embedding.image', 'local.embedding.interactive', 'local.component.unknown']);
    for (const node of fallback) expect(source.slice(node.fallback?.range.start, node.fallback?.range.end)).toBe(node.value);
    const markup = renderLocalStaticMarkup({ document });
    expect(markup).toMatchObject({ ok: true, markup: expect.stringContaining('{{ missing + }}') });
    if (markup.ok) {
      expect(markup.markup).toContain('&lt;unmounted /&gt;');
      expect(markup.markup).toContain('<strong>');
      expect(markup.markup).not.toContain('<img');
    }
    expect(compileLocal(source, { embedding: { ...options.embedding, onUnsupported: 'error' } }).ok).toBe(false);
    expect(localCompileOptionsKey({ embedding: { expressions: 'evaluate' } })).toBe(localCompileOptionsKey());
    expect(localCompileOptionsKey(options)).not.toBe(localCompileOptionsKey());
    const badAttribute = compileLocal('<slider min="bad" label="Range"/>\n\nAfter', { embedding: { onUnsupported: 'fallback' } });
    expect(badAttribute).toMatchObject({ ok: true, diagnostics: [expect.objectContaining({ code: 'local.embedding.attribute' })],
      document: { requiresRuntime: false, bindings: {} } });
  });

  it('checks runtime capability and keeps compatible string attributes literal', () => {
    const dynamic = compile('<slider bind="n" label="Value"/>\n\n{{ n }}');
    expect(dynamic.requiresRuntime).toBe(true);
    expect(renderLocalStaticMarkup({ document: dynamic })).toMatchObject({ ok: false });
    expect(renderLocalStaticMarkup({ document: { ...compile('text'), requiresRuntime: undefined } })).toMatchObject({ ok: false });
    const conditional = compile('<if when="true">Visible</if>\n\n<if when="false">Hidden text</if>', { embedding: { expressions: 'literal' } });
    const rendered = renderLocalStaticMarkup({ document: conditional });
    expect(rendered).toMatchObject({ ok: true, markup: expect.stringContaining('Visible') });
    if (rendered.ok) expect(rendered.markup).not.toContain('Hidden text');
    const source = '<alert title="{{ unknown }}">Body</alert>';
    const literal = compile(source, { embedding: { expressions: 'literal' } });
    const runtime = createLocalRuntime(literal);
    try { expect(renderToString(<LocalDocumentView document={literal} runtime={runtime} />)).toContain('{{ unknown }}'); }
    finally { runtime.dispose(); }
  });

  it('reuses compatible active and idle runtimes until the last lease releases', () => {
    const pool = createLocalRuntimePool();
    const compiled = compile('A document');
    const first = pool.acquire(compiled, { documentId: 'a' });
    const other = pool.acquire(compiled, { documentId: 'b' });
    first.release();
    const again = pool.acquire(compiled, { documentId: 'a' });
    expect(again.runtime).toBe(first.runtime);
    expect(other.runtime).not.toBe(first.runtime);
    const dispose = vi.spyOn(again.runtime, 'dispose');
    pool.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(() => pool.acquire(compiled)).toThrow('disposed');
    first.release();
    again.release();
    other.release();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

function workerSlot(maxDocuments?: number) {
  const jobs: LocalCompileWorkerRequest[] = [];
  const scope = { onmessage: null, postMessage: (data: unknown) => worker.onmessage?.({ data }) };
  const worker: LocalCompileWorker = {
    postMessage: request => jobs.push(request),
    onmessage: null, onerror: null, onmessageerror: null,
    terminate: () => control.dispose(),
  };
  const control = startLocalCompileWorker(scope, { maxDocuments });
  const answer = () => (scope.onmessage as ((event: { data: unknown }) => void) | null)?.({ data: jobs.shift() });
  return { worker, jobs, answer };
}

describe('multi-document worker scheduling', () => {
  it('patches interleaved documents and rebuilds an evicted baseline from full source', async () => {
    for (const capacity of [1, 2]) {
      const slot = workerSlot(capacity);
      const traces: LocalTraceEvent[] = [];
      const pool = createLocalCompilePool({ workers: 1, createWorker: () => slot.worker, observer: { onTrace: event => traces.push(event) } });
      try {
        const submit = async (documentId: string, revision: number, source: string) => {
          const outcome = pool.schedule({ documentId, revision, source });
          await Promise.resolve();
          const request = slot.jobs[0];
          slot.answer();
          return { request, outcome };
        };
        await (await submit('a', 0, 'A0')).outcome;
        await (await submit('b', 0, 'B0')).outcome;
        const { request, outcome } = await submit('a', 1, 'A1');
        expect(request).toMatchObject({ protocol: 'patch-v1', documentId: 'a', baseRevision: 0 });
        if (capacity === 1) {
          expect(slot.jobs[0]).toMatchObject({ documentId: 'a', revision: 1, source: 'A1' });
          slot.answer();
        }
        expect(await outcome).toMatchObject({ mode: 'worker', documentId: 'a', revision: 1, result: { document: { source: 'A1' } } });
        expect(traces.find(event => event.type === 'worker-response' && event.status === 'ok')).toMatchObject({
          parseMs: expect.any(Number), semanticMs: expect.any(Number), compiledBlocks: expect.any(Number),
        });
      } finally { pool.dispose(); }
    }
  });

  it('delivers a queued final revision before a newer streaming snapshot', async () => {
    const slot = workerSlot();
    const pool = createLocalCompilePool({ workers: 1, createWorker: () => slot.worker, streamingDelayMs: 0 });
    try {
      const final = pool.schedule({ documentId: 'a', revision: 1, source: 'Final' }).catch(error => error);
      const streaming = pool.schedule({ documentId: 'a', revision: 2, source: 'Streaming', sourcePhase: 'streaming' });
      await Promise.resolve();
      expect(slot.jobs[0]).toMatchObject({ revision: 1 });
      slot.answer();
      expect(await final).toMatchObject({ revision: 1, result: { ok: true } });
      expect(slot.jobs[0]).toMatchObject({ revision: 2 });
      slot.answer();
      expect(await streaming).toMatchObject({ revision: 2, result: { ok: true } });
    } finally { pool.dispose(); }
  });

  it('ages bounded priorities and ignores priority updates for inactive documents', async () => {
    let time = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => time);
    const slot = workerSlot();
    const pool = createLocalCompilePool({ workers: 1, createWorker: () => slot.worker });
    try {
      const active = pool.schedule({ documentId: 'active', revision: 0, source: 'In flight' });
      await Promise.resolve();
      const waiting = pool.schedule({ documentId: 'waiting', revision: 0, source: 'Waiting', priority: -Number.MAX_VALUE });
      time = 2_100;
      pool.setPriority('future', Number.MAX_VALUE);
      const future = pool.schedule({ documentId: 'future', revision: 0, source: 'Future' });
      const newer = pool.schedule({ documentId: 'newer', revision: 0, source: 'Newer', priority: Number.MAX_VALUE });
      slot.answer();
      await active;
      await Promise.resolve();
      expect(slot.jobs[0]?.documentId).toBe('waiting');
      slot.answer();
      await waiting;
      await Promise.resolve();
      expect(slot.jobs[0]?.documentId).toBe('newer');
      slot.answer();
      await newer;
      await Promise.resolve();
      expect(slot.jobs[0]?.documentId).toBe('future');
      slot.answer();
      await future;
    } finally { pool.dispose(); clock.mockRestore(); }
  });

  it('isolates stale replies and compile inputs, then drops superseded revisions', async () => {
    const workers = [workerSlot(), workerSlot()];
    const traces: LocalTraceEvent[] = [];
    const pool = createLocalCompilePool({ workers: 2, createWorker: id => workers[id - 1].worker,
      observer: { onTrace: event => traces.push(event) } });
    try {
      await pool.ready;
      const a1 = pool.schedule({ documentId: 'a', revision: 1, source: 'A1' }).catch(error => error);
      const b1 = pool.schedule({ documentId: 'b', revision: 1, source: 'B1' });
      await Promise.resolve();
      const a2 = pool.schedule({ documentId: 'a', revision: 2, source: '{{ literal }}', options: { embedding: { expressions: 'literal' } } });
      expect(await a1).toMatchObject({ kind: 'superseded' });
      workers[1].worker.onmessage?.({ data: { ...workers[1].jobs[0], documentId: 'a' } });
      workers[1].answer();
      expect(await b1).toMatchObject({ documentId: 'b', revision: 1, source: 'B1', mode: 'worker' });
      workers[0].answer();
      await Promise.resolve();
      const latest = workers.find(slot => slot.jobs.length)!;
      expect(latest.jobs[0]).toMatchObject({ documentId: 'a', revision: 2, source: '{{ literal }}' });
      latest.answer();
      const result = await a2;
      expect(result).toMatchObject({ documentId: 'a', revision: 2, mode: 'worker', result: { ok: true, document: { requiresRuntime: false } } });
      expect(traces).toContainEqual(expect.objectContaining({ type: 'worker-stale-response', documentId: 'b', workerId: 2 }));
      expect(pool.getCounts().pendingTasks).toBe(0);
    } finally { pool.dispose(); }
  });

  it('settles failed or cancelled work without contaminating other documents', async () => {
    const slot = workerSlot();
    const pool = createLocalCompilePool({ workers: 1, createWorker: () => slot.worker, snapshotPolicy: 'all', maxPending: 2 });
    try {
      await pool.ready;
      const a = pool.schedule({ documentId: 'a', revision: 0, source: 'abandoned' }).catch(error => error);
      const b = pool.schedule({ documentId: 'b', revision: 0, source: 'fallback text' });
      await expect(pool.schedule({ documentId: 'b', revision: 1, source: 'over limit' })).rejects.toMatchObject({ kind: 'backpressure' });
      pool.cancel('a');
      expect(await a).toMatchObject({ kind: 'cancelled' });
      slot.worker.onerror?.({});
      expect(await b).toMatchObject({ documentId: 'b', source: 'fallback text', mode: 'fallback' });
    } finally { pool.dispose(); }
  });
});

const definition = defineLocalComponent({ protocol: LOCAL_COMPONENT_PROTOCOL, id: 'embed/test-card', name: 'test-card',
  version: '1.0.0', form: 'leaf', props: {}, capabilities: { interactive: false, static: true, ssr: true, offline: true } });
const component = defineReactComponent(definition, { render: () => <b>Loaded card</b> });

describe('component loading and preset packs', () => {
  it('composes shared pack components once and links scoped CSS to the derived manifests', () => {
    const host = createReactHost({ presets: [layoutPack, dataPack, visualsPack] });
    expect(host.config.registry.filter(item => item.name === 'column')).toHaveLength(1);
    const onlyTable = deriveLocalReactPreset(dataPack, { include: ['data-table', 'column'] });
    const tableHost = createReactHost({ presets: [onlyTable] });
    expect(tableHost.config.registry.map(item => item.name)).toEqual(onlyTable.components.map(item => item.definition.name));
    expect(tableHost.css).toContain('.local-visual-table');
    expect(tableHost.css).not.toMatch(/\.local-visual-(?:chart|plot|diagram)/);
    expect(tableHost.resources.map(item => item.id)).toEqual([...new Set(onlyTable.preset.components.flatMap(item => item.styles ?? []))]);
  });

  it('keeps unsuccessful work and development mounts out of production totals', () => {
    const context = { traceId: 'trace-a', documentId: 'doc-a', sourceRevision: 5, timestamp: 1 };
    const report = createLocalPerformanceReport([
      { ...context, type: 'worker-request', workerId: 1 },
      { ...context, type: 'worker-response', workerId: 1, status: 'ok', durationMs: 9, queueMs: 2, reuseMs: 1, reusedBlocks: 3 },
      { ...context, type: 'worker-idle', workerId: 1, durationMs: 8 },
      { ...context, type: 'worker-response', status: 'budget-rejected', durationMs: 10 },
      { ...context, type: 'worker-cancel', status: 'superseded' },
      { ...context, type: 'render-mount', environment: 'development', sourcePhase: 'final', componentName: 'test-card' },
      { ...context, type: 'render-retained', environment: 'production', sourcePhase: 'final', componentName: 'test-card' },
    ]);
    expect(report.revisions[0]).toMatchObject({ compile: { succeeded: 1, budgetRejected: 1, cancelled: 1, successfulMs: 9 },
      reuseMs: 1, reusedBlocks: 3, developmentMounts: 1, productionFinalMounts: 0, productionRetained: 1 });
    expect(report.revisions[0].parseMs).toBeUndefined();
    expect(report.workers[0]).toMatchObject({ attempts: 1, busyMs: 9, idleMs: 8, queueMs: 2 });
  });
  it('deduplicates requests, retries failure and aborts after the last subscriber leaves', async () => {
    const traces: LocalTraceEvent[] = [];
    const trace = { traceId: 'embedding-trace', documentId: 'demo', sourceRevision: 3, observer: { onTrace: (event: LocalTraceEvent) => traces.push(event) } };
    let finish!: (value: typeof component | null) => void;
    const resolver = vi.fn(({ signal: _signal }: { signal: AbortSignal }) => new Promise<typeof component | null>(resolve => { finish = resolve; }));
    const loader = new LocalComponentLoader(resolver);
    const first = loader.subscribe(definition, vi.fn(), trace);
    const listener = vi.fn();
    const second = loader.subscribe(definition, listener, trace);
    await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(1);
    first();
    await Promise.resolve();
    expect(resolver.mock.calls[0][0].signal.aborted).toBe(false);
    finish(null);
    await vi.waitFor(() => expect(loader.snapshot(definition).status).toBe('failed'));
    loader.retry(definition, trace);
    await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(2);
    second();
    await Promise.resolve();
    expect(resolver.mock.calls[1][0].signal.aborted).toBe(true);
    finish(component);
    expect(createDiagnosticReport('', { events: traces }).events).toContainEqual(expect.objectContaining({
      type: 'component-load-end', documentId: 'demo', sourceRevision: 3, status: 'failed', subscribers: 2,
    }));
  });

  it('keeps resolver calls out of SSR and composes compatible React packs', () => {
    const config = createLocalConfig({ components: [definition] });
    const resolver = vi.fn(() => component);
    const reactConfig = createDeferredReactConfig(config, { components: [], resolver });
    const document = compile('Before\n\n<test-card />\n\nAfter', { config });
    const runtime = createLocalRuntime(document);
    try {
      const html = renderToString(<LocalDocumentView document={document} runtime={runtime} reactConfig={reactConfig} />);
      expect(html).toContain('data-rmd-component-load="loading"');
      expect(html).toContain('After');
      expect(resolver).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
    const host = createReactHost({ presets: [dataPack, visualsPack] });
    expect(host.config.registry.map(item => item.name)).toEqual(expect.arrayContaining(['table', 'chart']));
    expect(host.resources.filter(item => item.id === 'reactive-md/visual-base.css')).toHaveLength(1);
    expect(deriveLocalPreset(layoutPack.preset, { include: ['alert', 'text'] }).components.map(item => item.name)).toEqual(['text', 'alert']);
    expect(() => deriveLocalPreset(layoutPack.preset, { include: ['alert', 'alert'] })).toThrow();
  });
});
