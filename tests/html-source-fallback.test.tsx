import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, LocalReactiveDocument } from '../src/local/LocalDocumentView';
import { sanitizeLocalHtmlDocument } from '../src/local/html';
import { prepareStandaloneDocument } from '../src/standalone/prepare';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
const text = (n: any): string => (n.nodeName === '#text' ? n.value : '') + (n.childNodes ?? []).map(text).join('');
const elements = (n: any, tag: string): any[] => [...(n.tagName === tag ? [n] : []), ...(n.childNodes ?? []).flatMap((c: any) => elements(c, tag))];

describe('native HTML source fallback', () => {
  it.each([
    '<table><tr><td colspan="bad">{{ missing }}</td></tr></table>',
    '<table><caption>A</caption><caption>B</caption><tr><td>A</td></tr></table>',
    '<div align="middle">**Uncompiled** {{ missing }}</div>',
    '<meta name="description" content="{{ missing }}">',
    '<article>**Uncompiled** {{ missing }}',
    '<ARTICLE>**Uncompiled** {{ missing }}</article>',
    '<DIV title="unclosed',
  ])('keeps unsupported HTML inert without disabling nearby controls: %s', fragment => {
    const source = `Before\n\n${fragment}\n\n<counter bind="count" label="Count" initial="2">\n\nAfter {{ count }}`;
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.every(d => d.severity === 'warning')).toBe(true);
    const literal = flatten(result.document.nodes).find(n => n.type === 'fallback');
    expect(literal?.value).toBe(fragment);
    expect(source.slice(literal!.range.start, literal!.range.end)).toBe(fragment);
    const runtime = createLocalRuntime(result.document);
    try {
      runtime.setParameter('count', 3);
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      const tree = parseFragment(markup);
      expect(text(tree)).toContain(fragment);
      expect(elements(tree, 'table')).toHaveLength(0);
      expect(text(tree)).toContain('After 3');
    } finally { runtime.dispose(); }
  });

  it('keeps an unclosed native fragment inside its ReactiveMD parent', () => {
    const source = '<card title="Host">\n<article>**Raw** {{ missing }}\n</card>\n\n<counter bind="n" label="Count" initial="2">';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(flatten(result.document.nodes).find(n => n.type === 'fallback')?.value).toBe('<article>**Raw** {{ missing }}\n');
    expect(result.document.bindings.n).toBeDefined();
  });

  it('falls back one invalid native element in the sandbox while retaining its siblings', () => {
    const fragment = '<div unsupported="value">  **Raw**\n{{ missing }} <script>window.bad = true</script></div>';
    const source = `<p>Before</p>${fragment}<p>After</p>`;
    const result = sanitizeLocalHtmlDocument(source, {enableCss: true, enableJavaScript: false, enableExtendedHtml: false}, 100);
    const tree = parseFragment(result.markup);
    expect(elements(tree, 'div')).toHaveLength(0);
    expect(elements(tree, 'script')).toHaveLength(0);
    expect(text(tree)).toContain(fragment);
    expect(elements(tree, 'p').map(text)).toEqual(['Before', 'After']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'local.html.attribute', severity: 'warning'}));
  });

  it('shows the full native document as text when compilation exceeds its node budget', () => {
    const source = '<p>Before</p>\n<script>window.bad = true</script>\n<p>{{ literal }}</p>';
    const options = {enableCss: true, enableJavaScript: true, limits: {maxSyntaxNodes: 1}};
    expect(compileLocal(source, options).ok).toBe(false);
    const markup = renderToStaticMarkup(<LocalReactiveDocument source={source} compileOptions={options} />);
    const tree = parseFragment(markup);
    expect(elements(tree, 'iframe')).toHaveLength(0);
    expect(elements(tree, 'script')).toHaveLength(0);
    expect(elements(tree, 'pre').map(text)).toEqual([source]);
  });

  it('returns literal markup as well as diagnostics from native sanitization failures', () => {
    const source = '\n<p>A</p>\n<p>B &amp; C</p>';
    const result = sanitizeLocalHtmlDocument(source, {enableCss: true, enableJavaScript: false, enableExtendedHtml: false}, 1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({severity: 'error', code: 'local.budget'}));
    expect(elements(parseFragment(result.markup), 'pre').map(text)).toEqual([source]);
  });

  it('keeps standalone mounts literal after a native compilation failure', () => {
    const source = '<p>Source</p>\n<script>window.bad = true</script>';
    const prepared = prepareStandaloneDocument(source, undefined, undefined,
      {enableJavaScript: true, limits: {maxSyntaxNodes: 1}});
    expect(prepared.diagnostics).toContainEqual(expect.objectContaining({code: 'local.budget', severity: 'error'}));
    const runtime = createLocalRuntime(prepared.document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={prepared.document} runtime={runtime} />);
      const tree = parseFragment(markup);
      expect(elements(tree, 'iframe')).toHaveLength(0);
      expect(elements(tree, 'script')).toHaveLength(0);
      expect(elements(tree, 'pre').map(text)).toEqual([source]);
    } finally { runtime.dispose(); }
  });

  it('retains strict component and host-option errors', () => {
    expect(compileLocal('<slider bind="n" min="bad">').ok).toBe(false);
    expect(compileLocal('<mystery>').ok).toBe(false);
    const markup = renderToStaticMarkup(<LocalReactiveDocument source="<p>Text</p>" compileOptions={{enableCss: 'bad'} as any} />);
    expect(markup).toContain('local-inactive');
    expect(elements(parseFragment(markup), 'pre')).toHaveLength(0);
  });
});
