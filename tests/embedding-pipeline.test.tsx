import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { compileLocal, createLocalRuntime, createLocalRuntimePool, localCompileOptionsKey } from '../src/local';
import { walkLocalNodes } from '../src/local/source/source-context';
import { startLocalCompileWorker, type LocalCompileRequest, type LocalCompileWorker } from '../src/local/transport/worker';
import { createLocalCompilePool } from '../src/local/transport/worker-pool';
import { createDiagnosticReport, type LocalTraceEvent } from '../src/observability';
import { createDeferredReactConfig, defineReactComponent, LocalDocumentView } from '../src/react';
import { LocalComponentLoader } from '../src/react/component-loader';
import { renderLocalStaticMarkup } from '../src/react/server';
import { createReactHost } from '../src/react/packed';
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

function workerSlot() {
  const jobs: LocalCompileRequest[] = [];
  const scope = { onmessage: null, postMessage: (data: unknown) => worker.onmessage?.({ data }) };
  const worker: LocalCompileWorker = {
    postMessage: request => jobs.push(request as LocalCompileRequest),
    onmessage: null, onerror: null, onmessageerror: null,
    terminate: () => control.dispose(),
  };
  const control = startLocalCompileWorker(scope);
  const answer = () => (scope.onmessage as ((event: { data: unknown }) => void) | null)?.({ data: jobs.shift() });
  return { worker, jobs, answer };
}

describe('multi-document worker scheduling', () => {
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
    expect(host.resources.filter(item => item.id === 'reactive-md/visuals.css')).toHaveLength(1);
    expect(deriveLocalPreset(layoutPack.preset, { include: ['alert', 'text'] }).components.map(item => item.name)).toEqual(['text', 'alert']);
    expect(() => deriveLocalPreset(layoutPack.preset, { include: ['alert', 'alert'] })).toThrow();
  });
});
