import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { compileLocalStreamingTracked } from '../src/local/compilation/streaming';
import { createLocalCompileSession } from '../src/local/compilation/session/incremental';
import {
  analyzeLocalSource,
  completeLocalSource,
  formatLocalSource,
  renameLocalBinding,
} from '../src/local/source/authoring';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { createLocalStateFile } from '../src/local/runtime/state';
import {
  createLocalAuthoringLookup,
  createLocalComponentCatalog,
  localComponentCatalogKey,
} from '../src/authoring';
import { createShareableHtml } from '../src/shareable';
import { prepareStandaloneDocument } from '../src/standalone/prepare';
import { renderLocalStaticDocument } from '../src/react/server';
import { LocalDocumentView } from '../src/react/rendering/document/LocalDocumentView';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent } from '../src/sdk/manifest';
import type {
  LocalCompileOptions,
  LocalCompileResult,
  LocalDocument,
  LocalHostComponentSchema,
  LocalNode,
} from '../src/local/types';

const PROTOCOL = 'reactive-md-component/v1' as const;
const CAPABILITIES = { interactive: true, static: true, ssr: true, offline: true } as const;

function rawDefinition(options: { min?: number; insertText?: string } = {}) {
  const { min = 0, insertText } = options;
  return defineLocalComponent({
    id: 'test/raw-box',
    name: 'raw-box',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'container',
    props: {},
    structure: { rule: 'raw-body', label: 'none', ...(min > 0 ? { min } : {}) },
    capabilities: CAPABILITIES,
    ...(insertText === undefined
      ? {}
      : { authoring: { title: { en: 'Raw box' }, category: 'content', insertText } }),
  });
}

function markdownDefinition() {
  return defineLocalComponent({
    id: 'test/markdown-box',
    name: 'markdown-box',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'container',
    props: {},
    structure: { rule: 'any' },
    capabilities: CAPABILITIES,
  });
}

function rawOptions(min = 0): LocalCompileOptions {
  return { config: createLocalConfig({ components: [rawDefinition({ min })] }) };
}

/** Incremental blocks rename node ids; compare everything else exactly. */
function canonical(result: LocalCompileResult): unknown {
  const ids = new Map<string, string>();
  const visit = (nodes: readonly LocalNode[] | undefined) => {
    for (const node of nodes ?? []) { ids.set(node.id, `node-${ids.size}`); visit(node.children); }
  };
  if (result.ok) visit(result.document.nodes);
  return JSON.parse(JSON.stringify(result, (_key, value) => {
    if (typeof value === 'string') return ids.get(value) ?? value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [ids.get(key) ?? key, item]));
    }
    return value;
  }));
}

function rawChild(result: LocalCompileResult): LocalNode {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('fixture did not compile');
  const stack = [...result.document.nodes];
  while (stack.length) {
    const node = stack.shift()!;
    if (node.type === 'hostComponent') {
      const child = node.children?.[0];
      expect(child?.type).toBe('rawBody');
      return child!;
    }
    if (node.children) stack.push(...node.children);
  }
  throw new Error('fixture has no raw-body component');
}

/* ------------------------------------------------------------- authoring */

describe('raw body authoring analysis', () => {
  const BODY = [
    '<number bind="n" label="N" initial="1">',
    '{{ n * 2 }} and *emphasis* and &lt;',
    '<let>nested</let>',
    'x </raw-box> stays text',
    '<!-- <raw-box> hidden -->',
    '',
  ].join('\n');
  const HEAD = '<raw-box>\n';
  const TAIL = `</raw-box>\n\n<number bind="count" label="Count" initial="2">\n\nOutside {{ count }}.\n\n<!-- outside note -->\n`;
  const SOURCE = `${HEAD}${BODY}${TAIL}`;
  const BODY_START = HEAD.length - 1;
  const BODY_END = BODY_START + BODY.length + 1;

  it('produces no tag, attribute, interpolation, binding, comment or completion token inside the body', () => {
    const analysis = analyzeLocalSource(SOURCE, rawOptions());
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.tokens.length).toBeGreaterThan(0);
    for (const token of analysis.tokens) {
      expect(token.range.start >= BODY_START && token.range.end <= BODY_END, JSON.stringify(token)).toBe(false);
    }
    const slices = analysis.tokens.map(token => SOURCE.slice(token.range.start, token.range.end));
    expect(slices).not.toContain('n');
    expect(slices).not.toContain('{{ n * 2 }}');
    expect(slices).not.toContain('let');
    expect(analysis.bindings.map(binding => binding.name)).toEqual(['count']);
    expect(analysis.bindings[0].references).toEqual([{ start: SOURCE.indexOf('{{ count }}') + 3, end: SOURCE.indexOf('{{ count }}') + 8 }]);

    const outsideComment = SOURCE.lastIndexOf('<!-- outside note -->');
    expect(analysis.tokens).toContainEqual({ kind: 'comment', range: { start: outsideComment, end: outsideComment + '<!-- outside note -->'.length } });
  });

  it('offers no completion and applies no rename or format edit inside the body', () => {
    for (const probe of ['<number', '{{ n', '<!-- <raw', '</raw-box> stays']) {
      const offset = SOURCE.indexOf(probe) + Math.min(probe.length, 4);
      expect(offset).toBeGreaterThan(BODY_START);
      expect(offset).toBeLessThan(BODY_END);
      expect(completeLocalSource(SOURCE, offset, rawOptions())).toEqual([]);
    }
    expect(completeLocalSource(SOURCE, BODY_START - 1, rawOptions()).length).toBeGreaterThan(0);

    const renamed = renameLocalBinding(SOURCE, 'count', 'total', rawOptions());
    expect(renamed.source.slice(BODY_START, BODY_END)).toBe(`
${BODY}`);
    expect(renamed.source).toContain('Outside {{ total }}.');
    expect(() => renameLocalBinding(SOURCE, 'n', 'm', rawOptions())).toThrow(/not declared/);

    const formatSource = '<raw-box  >\n<number   bind="n">\n</raw-box>';
    expect(formatLocalSource(formatSource, rawOptions())).toBe('<raw-box>\n<number   bind="n">\n</raw-box>');
  });

  it('uses plain rendered text tokens outside the body and keeps a compiled document reusable', () => {
    const compiled = compileLocal(SOURCE, rawOptions());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(analyzeLocalSource(SOURCE, rawOptions(), { document: compiled.document, diagnostics: false }))
      .toEqual({ ...analyzeLocalSource(SOURCE, rawOptions()), diagnostics: [] });
  });
});

/* --------------------------------------------------------------- catalog */

describe('raw body catalog metadata and insertion templates', () => {
  it('reports bodyKind from the manifest structure and defaults to markdown', () => {
    const optional = createLocalComponentCatalog(createLocalConfig({ components: [rawDefinition()] }), 'en')
      .find(entry => entry.name === 'raw-box');
    expect(optional?.bodyKind).toBe('raw');
    expect(optional?.form).toBe('container');
    const required = createLocalComponentCatalog(createLocalConfig({ components: [rawDefinition({ min: 1 })] }), 'en')
      .find(entry => entry.name === 'raw-box');
    expect(required?.bodyKind).toBe('raw');
    const markdown = createLocalComponentCatalog(createLocalConfig({ components: [markdownDefinition()] }), 'en')
      .find(entry => entry.name === 'markdown-box');
    expect(markdown?.bodyKind).toBe('markdown');
    const panel = createLocalComponentCatalog(createLocalConfig(), 'en').find(entry => entry.name === 'panel');
    expect(panel?.bodyKind).toBe('markdown');
  });

  it('synthesizes a raw-body template that compiles, including a required body', () => {
    const optionalConfig = createLocalConfig({ components: [rawDefinition()] });
    const optional = createLocalComponentCatalog(optionalConfig, 'en').find(entry => entry.name === 'raw-box')!;
    expect(optional.insertText).toBe('<raw-box>\n\n</raw-box>');
    const optionalCompile = compileLocal(optional.insertText, { config: optionalConfig });
    expect(optionalCompile.ok).toBe(true);
    if (optionalCompile.ok) {
      expect(rawChild(optionalCompile as LocalCompileResult).value).toBe('\n\n');
    }

    const requiredConfig = createLocalConfig({ components: [rawDefinition({ min: 1 })] });
    const required = createLocalComponentCatalog(requiredConfig, 'en').find(entry => entry.name === 'raw-box')!;
    expect(required.insertText).toBe('<raw-box>\n…\n</raw-box>');
    const requiredCompile = compileLocal(required.insertText, { config: requiredConfig });
    expect(requiredCompile.ok).toBe(true);
    expect(rawChild(requiredCompile).value).toBe('\n…\n');
  });

  it('keeps a supplied authoring.insertText unchanged', () => {
    const supplied = '<raw-box>\nPLAY {{ name }} </raw-box> is text\n</raw-box>';
    const config = createLocalConfig({ components: [rawDefinition({ insertText: supplied })] });
    const entry = createLocalComponentCatalog(config, 'en').find(item => item.name === 'raw-box')!;
    expect(entry.insertText).toBe(supplied);
    const compiled = compileLocal(entry.insertText, { config });
    expect(compiled.ok).toBe(true);
    expect(rawChild(compiled).value).toBe('\nPLAY {{ name }} </raw-box> is text\n');
  });

  it('lowers a host body raw declaration to the same tag bodyKind', () => {
    const host = { name: 'host-raw', form: 'container' as const, props: {}, body: 'raw' as const };
    const lookup = createLocalAuthoringLookup({ hostComponents: [host] }, 'en');
    expect(lookup.tag('host-raw')?.bodyKind).toBe('raw');
    expect(lookup.tag('panel')?.bodyKind).toBe('markdown');
    const definition = rawDefinition();
    expect(createLocalAuthoringLookup({ config: createLocalConfig({ components: [definition] }) }, 'en')
      .tag('raw-box')?.bodyKind).toBe('raw');
  });

  it('changes the memoized catalog key when only the body kind changes', () => {
    const raw = createLocalConfig({ components: [rawDefinition()] });
    const markdown = createLocalConfig({ components: [markdownDefinition()] });
    // Different names would change the key anyway; use the same name through a
    // definition replacement to isolate the structure rule.
    const asMarkdown = createLocalConfig({
      components: [defineLocalComponent({
        id: 'test/raw-box', name: 'raw-box', version: '1.0.0', protocol: PROTOCOL,
        form: 'container', props: {}, structure: { rule: 'any' }, capabilities: CAPABILITIES,
      })],
    });
    expect(localComponentCatalogKey({ config: raw }, 'en'))
      .not.toBe(localComponentCatalogKey({ config: asMarkdown }, 'en'));
    expect(localComponentCatalogKey({ config: markdown }, 'en')).toBe(localComponentCatalogKey({ config: markdown }, 'en'));
  });
});

/* ----------------------------------------------------------- incremental */

describe('raw body incremental compile sessions', () => {
  const document = (body: string) => `<raw-box>\n${body}\n</raw-box>\n\nFirst paragraph.\n\nSecond paragraph.`;

  it('recompiles only the raw block for a body edit and reuses both paragraphs', () => {
    const options = rawOptions();
    const session = createLocalCompileSession();
    try {
      const first = canonical(session.compile(document('alpha'), options));
      expect(session.stats.mode).toBe('full');
      expect(session.stats.totalBlocks).toBe(3);
      expect(canonical(session.compile(document('alpha'), options))).toEqual(first);
      expect(session.stats.mode).toBe('cached');

      const edited = document('beta');
      const result = session.compile(edited, options);
      expect(canonical(result)).toEqual(canonical(compileLocal(edited, options)));
      expect(session.stats).toMatchObject({ mode: 'incremental', totalBlocks: 3, compiledBlocks: 1, reusedBlocks: 2 });
      expect(rawChild(result).value).toBe('\nbeta\n');
    } finally {
      session.dispose();
    }
  });

  it('reuses the raw block for an edit outside it and keeps raw-looking text verbatim', () => {
    const options = rawOptions();
    const body = '# not a heading\n<fake bind="x">\n- not a list';
    const session = createLocalCompileSession();
    try {
      const before = document(body);
      session.compile(before, options);
      const after = before.replace('Second paragraph.', 'Second paragraph edited.');
      const result = session.compile(after, options);
      expect(canonical(result)).toEqual(canonical(compileLocal(after, options)));
      expect(session.stats).toMatchObject({ mode: 'incremental', totalBlocks: 3, compiledBlocks: 1, reusedBlocks: 2 });
      expect(rawChild(result).value).toBe(`\n${body}\n`);
    } finally {
      session.dispose();
    }
  });

  it('shifts an unchanged raw block when an earlier paragraph grows', () => {
    const options = rawOptions();
    const source = (lead: string) => `${lead}\n\n<raw-box>\nalpha\n</raw-box>\n\nTail paragraph.`;
    const session = createLocalCompileSession();
    try {
      session.compile(source('Lead.'), options);
      const after = source('Lead paragraph grows.');
      const result = session.compile(after, options);
      expect(canonical(result)).toEqual(canonical(compileLocal(after, options)));
      expect(session.stats).toMatchObject({ mode: 'incremental', totalBlocks: 3, compiledBlocks: 1, reusedBlocks: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const block = '<raw-box>\nalpha\n</raw-box>';
      const start = after.indexOf(block);
      const raw = rawChild(result);
      expect(raw.value).toBe('\nalpha\n');
      expect(raw.range).toEqual({ start: start + '<raw-box>'.length, end: start + '<raw-box>\nalpha\n'.length });
      expect(result.document.nodes.map(node => node.range.start)).toEqual([0, start, after.indexOf('Tail paragraph.')]);
    } finally {
      session.dispose();
    }
  });
});

/* ------------------------------------------------------------- streaming */

describe('raw body streaming snapshots', () => {
  const options = rawOptions();

  it('renders an unfinished body to the snapshot end and reports the pair diagnostic on final', () => {
    const open = '<raw-box>\nhello';
    const tracked = compileLocalStreamingTracked(open, options);
    expect(tracked.result.ok).toBe(true);
    if (!tracked.result.ok) return;
    expect(tracked.result.diagnostics).toEqual([]);
    expect(rawChild(tracked.result).value).toBe('\nhello');

    const final = compileLocal(open, options);
    expect(final.ok).toBe(false);
    expect(final.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.tag.unclosed', messageKey: 'local.tag.unclosed.pair', params: { name: 'raw-box' },
    }));
  });

  it('does not let streaming snapshots poison final session caches', () => {
    const session = createLocalCompileSession();
    try {
      const open = '<raw-box>\nhello';
      const streaming = session.compileShared(open, options, 'streaming');
      expect(streaming.ok).toBe(true);
      expect(rawChild(streaming).value).toBe('\nhello');
      expect(session.stats.mode).toBe('streaming');

      const closed = '<raw-box>\nhello\n</raw-box>\n\nParagraph.';
      const full = canonical(compileLocal(closed, options));
      expect(canonical(session.compile(closed, options))).toEqual(full);
      expect(session.stats.mode).toBe('full');

      const provisional = session.compileShared(closed, options, 'streaming');
      expect(provisional.ok).toBe(true);
      expect(canonical(session.compile(closed, options))).toEqual(full);
      expect(session.stats.mode).toBe('cached');
    } finally {
      session.dispose();
    }
  });
});

/* ----------------------------------------------------- rendering/security */

const HOST_RAW: LocalHostComponentSchema = { name: 'raw-box', form: 'container', props: {}, body: 'raw' };
const HOSTILE_BODY = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '&lt;',
  '{{ x }}',
  '*text*',
  'literal </raw-box> stays text',
  'literal </script> stays text',
].join('\n');
const HOSTILE_SOURCE = `<raw-box>\n${HOSTILE_BODY}\n</raw-box>`;

function hostileOptions(): LocalCompileOptions {
  return { hostComponents: [HOST_RAW] };
}

function hostileDocument(): { document: LocalDocument; markup: string } {
  const compiled = compileLocal(HOSTILE_SOURCE, hostileOptions());
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) throw new Error('hostile fixture did not compile');
  expect(rawChild(compiled).value).toBe(`
${HOSTILE_BODY}
`);
  const runtime = createLocalRuntime(compiled.document);
  try {
    const markup = renderToStaticMarkup(
      <LocalDocumentView
        document={compiled.document}
        runtime={runtime}
        hostRenderer={(_node, _data, ctx) => ctx.render()}
      />,
    );
    return { document: compiled.document, markup };
  } finally {
    runtime.dispose();
  }
}

function expectPlainText(markup: string): void {
  expect(markup).toContain('local-raw-body');
  expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(markup).toContain('&amp;lt;');
  expect(markup).toContain('{{ x }}');
  expect(markup).toContain('*text*');
  expect(markup).toContain('literal &lt;/raw-box&gt; stays text');
  expect(markup).toContain('literal &lt;/script&gt; stays text');
  expect(markup).not.toContain('<script');
  expect(markup).not.toContain('<img');
}

describe('raw body text-only rendering', () => {
  it('renders the value as escaped React text', () => {
    expectPlainText(hostileDocument().markup);
  });

  it('renders the same text in SSR markup', () => {
    const { document } = hostileDocument();
    const runtime = createLocalRuntime(document);
    try {
      const rendered = renderLocalStaticDocument({
        document,
        runtime,
        hostRenderer: (_node, _data, ctx) => ctx.render(),
      });
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      expectPlainText(rendered.markup);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps static export and standalone output free of executable markup', () => {
    const { document, markup } = hostileDocument();
    const state = createLocalStateFile(document, {});
    const staticHtml = createShareableHtml({
      title: 'Raw body',
      source: HOSTILE_SOURCE,
      state,
      staticMarkup: markup,
      css: '.md-document{}',
      mode: 'static',
    });
    expect(staticHtml).not.toContain('<script');
    expect(staticHtml).not.toContain('<img');
    expect(staticHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

    const interactive = createShareableHtml({
      title: 'Raw body',
      source: HOSTILE_SOURCE,
      state,
      staticMarkup: markup,
      css: '.md-document{}',
      mode: 'interactive',
      runtimeScript: 'globalThis.__raw = true;',
      compileOptions: hostileOptions(),
    });
    expect((interactive.match(/<\/script>/g) ?? []).length).toBe(2);
    expect(interactive).toContain('\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
    expect(interactive).toContain('\\u003c/script\\u003e stays text');
    expect(interactive).not.toContain('</script> stays text');

    const prepared = prepareStandaloneDocument(HOSTILE_SOURCE, undefined, undefined, hostileOptions());
    expect(rawChild({ ok: true, document: prepared.document } as LocalCompileResult).value).toBe(`
${HOSTILE_BODY}
`);
    const runtime = createLocalRuntime(prepared.document);
    try {
      const standaloneMarkup = renderToStaticMarkup(
        <LocalDocumentView
          document={prepared.document}
          runtime={runtime}
          hostRenderer={(_node, _data, ctx) => ctx.render()}
        />,
      );
      expectPlainText(standaloneMarkup);
    } finally {
      runtime.dispose();
    }
  });
});