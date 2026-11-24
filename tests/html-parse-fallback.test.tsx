import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { compileLocal } from '../src/local/compilation/compiler';
import { sanitizeLocalHtmlDocument } from '../src/local/html/html';
import { LocalDocumentView } from '../src/react/rendering/document/LocalDocumentView';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { prepareStandaloneDocument } from '../src/standalone/prepare';

// parse5 normally repairs malformed HTML. Inject actual parser/serializer
// failures to exercise the error boundary rather than its repair behavior.
vi.mock('parse5', async importOriginal => {
  const actual = await importOriginal<typeof import('parse5')>();
  return {...actual,
    parseFragment: (source: any, options: any) => {
      if (typeof source === 'string' && source.startsWith('<table data-force-table-failure')) throw new Error('Table parser failed');
      return actual.parseFragment(source, options);
    },
    parse: (source: string, options: any) => {
      if (source.startsWith('<!-- force-parse-failure -->')) throw new Error('Parser failed');
      return actual.parse(source, options);
    },
    serializeOuter: (node: any, options: any) => {
      if (node.attrs?.some((attr: any) => attr.name === 'data-force-serialization-failure')) throw new Error('Serializer failed');
      return actual.serializeOuter(node, options);
    },
  };
});

const elements = (n: any, tag: string): any[] => [...(n.tagName === tag ? [n] : []), ...(n.childNodes ?? []).flatMap((c: any) => elements(c, tag))];
const text = (n: any): string => (n.nodeName === '#text' ? n.value : '') + (n.childNodes ?? []).map(text).join('');

describe('native HTML engine failure fallback', () => {
  it('isolates an engine failure in a native table from surrounding Markdown', () => {
    const fragment = '<table data-force-table-failure><tr><td>{{ missing }}</td></tr></table>';
    const result = compileLocal(`# Before\n\n${fragment}\n\n# After`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'local.html.fallback', severity: 'warning'}));
    const runtime = createLocalRuntime(result.document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      const tree = parseFragment(markup);
      expect(elements(tree, 'h1').map(text)).toEqual(['Before', 'After']);
      expect(text(tree)).toContain(fragment);
      expect(elements(tree, 'table')).toHaveLength(0);
    } finally { runtime.dispose(); }
  });

  it.each([
    '<!-- force-parse-failure -->\n<script>window.bad = true</script>',
    '<p data-force-serialization-failure>Text &amp; source</p>',
  ])('returns inert full source after an engine failure: %s', source => {
    const policy = {enableCss: true, enableJavaScript: true, enableExtendedHtml: false};
    const result = sanitizeLocalHtmlDocument(source, policy, 100);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'local.parse', severity: 'error'}));
    expect(elements(parseFragment(result.markup), 'pre').map(text)).toEqual([source]);
    expect(elements(parseFragment(result.markup), 'script')).toHaveLength(0);
    const { document } = prepareStandaloneDocument(source, undefined, undefined, policy, undefined, true);
    const runtime = createLocalRuntime(document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime} />);
      expect(elements(parseFragment(markup), 'pre').map(text)).toEqual([source]);
      expect(elements(parseFragment(markup), 'iframe')).toHaveLength(0);
    } finally { runtime.dispose(); }
  });

  it('also falls back when an already compiled document fails render-time sanitization', () => {
    const compiled = prepareStandaloneDocument('<p>Valid</p>', undefined, undefined, {enableCss: true}, undefined, true);
    const source = '<!-- force-parse-failure -->\n<p>Source</p>';
    const document = {...compiled.document, source};
    const runtime = createLocalRuntime(document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={document} runtime={runtime} />);
      expect(elements(parseFragment(markup), 'pre').map(text)).toEqual([source]);
    } finally { runtime.dispose(); }
  });

  it.each([
    '<!-- force-parse-failure --><p>Nested</p>',
    '<p data-force-serialization-failure>Nested</p>',
  ])('reports safe srcdoc engine fallback without failing its host: %s', nested => {
    const encoded = nested.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const source = `<iframe srcdoc="${encoded}"></iframe>`;
    const result = prepareStandaloneDocument(source, undefined, undefined, {enableExtendedHtml: true}, undefined, true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'local.html.fallback', severity: 'warning'}));
    const frame = elements(parseFragment(result.document.nodes[0].value!), 'iframe')[0];
    const srcdoc = frame.attrs.find((attr: any) => attr.name === 'srcdoc').value;
    expect(elements(parseFragment(srcdoc), 'pre').map(text)).toEqual([nested]);
  });
});
