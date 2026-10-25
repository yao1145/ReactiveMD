import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, type LocalUrlPolicy } from '../src/local/LocalDocumentView';

const elements = (node: any, tag: string): any[] => [
  ...(node.tagName === tag ? [node] : []), ...(node.childNodes ?? []).flatMap((child: any) => elements(child, tag)),
];
const attrs = (node: any) => Object.fromEntries((node?.attrs ?? []).map((attr: any) => [attr.name, attr.value]));
function render(source: string, urlPolicy?: LocalUrlPolicy) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics).toEqual([]);
  const runtime = createLocalRuntime(result.document);
  try {
    const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} urlPolicy={urlPolicy} />);
    return { markup, tree: parseFragment(markup) };
  } finally { runtime.dispose(); }
}

describe('P0 HTML renderer', () => {
  it('reuses headings, lists, quotes and safe scoped attributes', () => {
    const source = '<div id="section" lang="zh"><h1>Title</h1><h2>Subtitle</h2><p><strong title="&alpha; &amp;">Bold</strong> <em>Emphasis</em><del>Deleted</del><u>Underlined</u><mark>Marked</mark><br><sup>2</sup><sub>n</sub></p><hr><blockquote>Quote</blockquote><ol start="3"><li>First</li><li>Second</li></ol><ul><li>Item</li></ul></div>\n\n<a href="#section">Jump</a>';
    const { tree } = render(source);
    expect(elements(tree, 'h1')).toHaveLength(1);
    expect(elements(tree, 'h2')).toHaveLength(1);
    expect(elements(tree, 'li')).toHaveLength(3);
    expect(attrs(elements(tree, 'ol')[0]).start).toBe('3');
    expect(attrs(elements(tree, 'strong')[0]).title).toBe('α &');
    const section = elements(tree, 'div').find(node => attrs(node).lang === 'zh');
    expect(attrs(section).id).not.toBe('section');
    expect(attrs(elements(tree, 'a')[0]).href).toBe(`#${attrs(section).id}`);
  });

  it('keeps code literal and preserves pre attributes', () => {
    const { markup, tree } = render('<pre id="code" title="Example"><code>&lt;script&gt;bad()&lt;/script&gt; {{ unknown }}</code></pre>\n\n<code>&alpha; &#xD800; &lt;b&gt;</code>');
    expect(elements(tree, 'script')).toHaveLength(0);
    expect(attrs(elements(tree, 'pre')[0]).title).toBe('Example');
    expect(attrs(elements(tree, 'pre')[0]).id).toContain('-code');
    expect(markup).toContain('{{ unknown }}');
    expect(markup).toContain('α � &lt;b&gt;');
  });

  it('uses the existing image URL policy and retains allowed dimensions and attributes', () => {
    const source = '<img src="https://images.example.test/a.png" alt="Image" width="120" height="80" title="Caption" id="image">';
    expect(elements(render(source).tree, 'img')).toHaveLength(0);
    const { tree } = render(source, (_url, kind) => kind === 'image');
    const image = attrs(elements(tree, 'img')[0]);
    expect(image).toMatchObject({ width: '120', height: '80', alt: 'Image', title: 'Caption' });
    expect(image.id).toContain('-image');
    expect(image.referrerpolicy).toBe('no-referrer');
  });
});
