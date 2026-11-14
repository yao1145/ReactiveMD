import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { LocalDocumentView, type LocalUrlPolicy } from '../src/local/rendering/LocalDocumentView';

const elements = (node: any, tag: string): any[] => [
  ...(node.tagName === tag ? [node] : []), ...(node.childNodes ?? []).flatMap((child: any) => elements(child, tag)),
];
const attrs = (node: any) => Object.fromEntries((node?.attrs ?? []).map((attr: any) => [attr.name, attr.value]));
function render(source: string, urlPolicy?: LocalUrlPolicy, allowWarnings = false) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!allowWarnings) expect(result.diagnostics).toEqual([]);
  const runtime = createLocalRuntime(result.document);
  try {
    const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} urlPolicy={urlPolicy} />);
    return { markup, tree: parseFragment(markup) };
  } finally { runtime.dispose(); }
}

describe('P0 HTML renderer', () => {
  it.each([
    ['_self', 'nofollow', '_self', 'nofollow'],
    ['_blank', 'nofollow sponsored', '_blank', 'nofollow sponsored noopener noreferrer'],
    ['_BLANK', 'NOOPENER opener ugc', '_BLANK', 'NOOPENER ugc noreferrer'],
    ['reader', 'help', 'reader', 'help'],
    ['', '', '', ''],
  ])('preserves authored target=%s and rel=%s', (target, rel, expectedTarget, expectedRel) => {
    const source = `<a href="https://example.com" target="${target}" rel="${rel}">**Read**</a>`;
    const result = compileLocal(source);
    expect(result.diagnostics).toEqual([]);
    const {tree} = render(source);
    const link = elements(tree, 'a')[0];
    expect(attrs(link)).toMatchObject({href: 'https://example.com', target: expectedTarget, rel: expectedRel});
    expect(elements(link, 'strong')).toHaveLength(1);
  });

  it('supports rel without target and preserves default external link behavior', () => {
    const {tree} = render('<a href="/docs" rel="help next">Docs</a> [External](https://example.com)');
    const [internal, external] = elements(tree, 'a');
    expect(attrs(internal)).toMatchObject({href: '/docs', rel: 'help next'});
    expect(attrs(internal).target).toBeUndefined();
    expect(attrs(external)).toMatchObject({target: '_blank', rel: 'noopener noreferrer'});
  });

  it('secures relative blank links too and keeps URL rejection in place', () => {
    const {tree} = render('<a href="/docs" target="_blank">Docs</a>');
    expect(attrs(elements(tree, 'a')[0])).toMatchObject({target: '_blank', rel: 'noopener noreferrer'});
    const rejected = render('<a href="https://example.com" target="_self" rel="nofollow">Blocked</a>', () => false);
    expect(elements(rejected.tree, 'a')).toHaveLength(0);
    expect(attrs(elements(rejected.tree, 'span').find(n => attrs(n).class === 'md-link-rejected')).target).toBeUndefined();
  });

  it.each(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])('renders validated alignment on %s without switching the document route', tag => {
    for (const align of ['left', 'center', 'right', 'justify']) {
      const source = `<${tag} align=" ${align.toUpperCase()} ">你好 **Markdown**</${tag}>`;
      const result = compileLocal(source);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.document.html).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
      const { tree } = render(source);
      const element = elements(tree, tag).find(node => attrs(node).align === align);
      expect(element).toBeDefined();
      expect(elements(element, 'strong')).toHaveLength(1);
    }
  });

  it('keeps nested alignment and reactive content independent', () => {
    const source = '<counter bind="count" label="Count" initial="2">\n\n<div align=center>你好 {{ count }}\n\n<p align=right>Inner</p>\n</div>';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    const runtime = createLocalRuntime(result.document);
    try {
      runtime.setParameter('count', 4);
      const tree = parseFragment(renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />));
      expect(elements(tree, 'div').filter(node => attrs(node).align === 'center')).toHaveLength(1);
      expect(elements(tree, 'p').filter(node => attrs(node).align === 'right')).toHaveLength(1);
      expect(runtime.text('你好 {{ count }}')).toBe('你好 4');
    } finally { runtime.dispose(); }
  });

  it.each(['center;color:red', '{{ alignment }}', '', 'middle', 'url(javascript:alert(1))'])('keeps invalid alignment inert: %s', align => {
    const result = compileLocal(`<div align="${align}">你好</div>`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some(d => d.code === 'local.html.fallback')).toBe(true);
    const { tree } = render(`<div align="${align}">你好</div>`, undefined, true);
    expect(elements(tree, 'div').some(node => attrs(node).align !== undefined)).toBe(false);
  });
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

describe('P0 HTML attribute decoding', () => {
  it('decodes attribute values with the attribute-value grammar', () => {
    const { tree } = render('<a href="https://e.example/?a=1&copy=2&not=3&lang=zh" title="&amp;&#x26;&copy;&copy &lt;&quot;">x</a> <a href=\'https://e.example/?q="&amp;x\'>y</a>');
    const [first, second] = elements(tree, 'a');
    expect(attrs(first).href).toBe('https://e.example/?a=1&copy=2&not=3&lang=zh');
    expect(attrs(first).title).toBe('&&©© <"');
    expect(attrs(second).href).toBe('https://e.example/?q="&x');
  });

  it.each(['jav&#x61;script:alert(1)', 'javascript&colon;alert(1)', '&#x6A;avascript:alert(1)', 'java&#x09;script:alert(1)'])(
    'still rejects an unsafe URL hidden behind character references: %s', href => {
      const source = `<a href="${href}">x</a>`;
      expect(compileLocal(source).diagnostics.map(d => d.code)).toContain('local.html.fallback');
      expect(elements(render(source, undefined, true).tree, 'a')).toHaveLength(0);
    });

  it('keeps the first of duplicate attributes, as HTML does', () => {
    const { tree } = render('<a href="https://a.example/" href="https://b.example/" title="one" title="two">x</a>\n\n<p align="left" align="right">y</p>');
    expect(attrs(elements(tree, 'a')[0])).toMatchObject({ href: 'https://a.example/', title: 'one' });
    expect(elements(tree, 'p').map(node => attrs(node).align).filter(Boolean)).toEqual(['left']);
  });

  it('still rejects an unsafe duplicate attribute value', () => {
    const source = '<a href="https://a.example/" href="javascript:alert(1)">x</a>';
    expect(compileLocal(source).diagnostics.map(d => d.code)).toContain('local.html.fallback');
    expect(elements(render(source, undefined, true).tree, 'a')).toHaveLength(0);
  });
});

describe('P0 HTML raw code NUL handling', () => {
  const compiledNodes = (source: string): any[] => {
    const result = compileLocal(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const walk = (node: any): any[] => [node, ...(node.children ?? []).flatMap(walk)];
    return result.document.nodes.flatMap(walk);
  };
  const codeValues = (source: string): string[] =>
    compiledNodes(source).filter(node => node.type === 'inlineCode' || node.type === 'code').map(node => node.value);

  it.each([
    ['<code>a\0b</code>', 'a�b'],
    ['<code>a\0b&amp;</code>', 'a�b&'],
    ['<code>a&#0;b</code>', 'a�b'],
    ['<pre>a\0b</pre>', 'a�b'],
    ['<pre><code>a\0b&amp;</code></pre>', 'a�b&'],
  ])('replaces NUL with U+FFFD in %j', (source, expected) => {
    expect(codeValues(source)).toEqual([expected]);
  });

  it.each(['<span title="a\0b">x</span>', '<span title="a\0b&amp;">x</span>'])('replaces NUL with U+FFFD in attribute %j', source => {
    const title = compiledNodes(source).find(node => node.attrs?.title)?.attrs.title;
    expect(title?.startsWith('a\uFFFDb')).toBe(true);
  });
});
