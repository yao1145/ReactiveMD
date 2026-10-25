import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import { completeLocalSource, formatLocalSource, renameLocalBinding } from '../src/local/authoring';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

function render(source: string) {
  const result = compileLocal(source);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error('Compilation failed');
  const runtime = createLocalRuntime(result.document);
  try {
    return { result, html: renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />) };
  } finally {
    runtime.dispose();
  }
}

describe('ordinary Markdown compatibility', () => {
  it.each(['Array<T>', 'Array<T extends U>', 'Map<string, number>', '比较 x<y 成立', '价格 $5、$10', '价格 $5 and $10', '售价 $5'])('preserves prose: %s', source => {
    const { result } = render(source);
    expect(result.diagnostics).toEqual([]);
    expect(flatten(result.document.nodes).some(node => node.type === 'inlineMath' || node.type === 'component')).toBe(false);
    expect(flatten(result.document.nodes).filter(node => node.type === 'text').map(node => node.value).join('')).toBe(source);
  });

  it('renders the requested HTML formatting and break alongside Markdown', () => {
    const { html } = render('<b>粗体 <i>斜体</i></b> <u>下划线</u> <s>删除线</s> <mark>高亮</mark><br>第二行');
    expect(html).toMatch(/<(?:b|strong)>/);
    expect(html).toMatch(/<(?:i|em)>/);
    expect(html).toContain('<u>');
    expect(html).toMatch(/<(?:s|del)>/);
    expect(html).toContain('<mark>');
    expect(html).toContain('<br/>');
    expect(html).not.toContain('local-fallback');
  });

  it('keeps valid numeric math and existing hard/soft line-break semantics', () => {
    const { result } = render('$5$ 与 $x^2$\n软换行  \n硬换行');
    const nodes = flatten(result.document.nodes);
    expect(nodes.filter(node => node.type === 'inlineMath').map(node => node.value)).toEqual(['5', 'x^2']);
    expect(nodes.filter(node => node.type === 'break')).toHaveLength(1);
  });

  it('does not consume a later formula while looking for a currency delimiter', () => {
    const { result } = render('价格 $5、$10，函数 $x^2$，常数 $5$。');
    const nodes = flatten(result.document.nodes);
    expect(nodes.filter(node => node.type === 'inlineMath').map(node => node.value)).toEqual(['x^2', '5']);
    expect(nodes.filter(node => node.type === 'text').map(node => node.value).join('')).toContain('价格 $5、$10，函数 ');
  });

  it('keeps authoring operations out of literal controls and interpolations in footnotes', () => {
    const source = '<number bind="count" label="Count">\n\n{{ count }}[^n]\n\n[^n]: <number  bind="count" label="Literal"> {{ count }}';
    expect(formatLocalSource(source)).toBe(source);
    expect(renameLocalBinding(source, 'count', 'total').source).toContain('[^n]: <number  bind="count" label="Literal"> {{ count }}');
    const incomplete = '正文[^n]\n\n[^n]: <sli';
    expect(completeLocalSource(incomplete, incomplete.length)).toEqual([]);
  });

  it('renders repeated footnotes with rich definitions and working return links', () => {
    const { html, result } = render('第一处[^n]，第二处[^n]。\n\n[^n]: **加粗**与<i>斜体</i>。\n\n    第二段。\n\n    - 列表项');
    expect(result.diagnostics).toEqual([]);
    expect(html).toContain('<sup');
    expect(html).toContain('<ol');
    expect(html).toContain('<strong>');
    expect(html).toMatch(/<(?:i|em)>/);
    expect(html).toContain('第二段');
    expect(html).toContain('<ul');
    expect(html).not.toContain('[^n]');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const fragments = [...html.matchAll(/\bhref="#([^"]+)"/g)].map(match => match[1]);
    expect(fragments.length).toBeGreaterThanOrEqual(4);
    for (const fragment of fragments) expect(ids).toContain(fragment);
  });

  it.each([
    '正文[^a\\]b]\n\n[^a\\]b]: 转义标签',
    '正文[^Straße]\n\n[^STRASSE]: Unicode 标签',
  ])('resolves GFM footnote identifiers: %s', source => {
    const { result, html } = render(source);
    expect(result.diagnostics).toEqual([]);
    expect(flatten(result.document.nodes).filter(node => node.type === 'footnoteReference')).toHaveLength(1);
    expect(html).toContain('role="doc-endnotes"');
  });

  it('preserves continuation paragraphs inside blockquoted footnote definitions', () => {
    const { result } = render('> 正文[^n]\n>\n> [^n]: 第一段\n>\n>     第二段');
    const definition = flatten(result.document.nodes).find(node => node.type === 'footnoteDefinition')!;
    expect(definition.children?.map(node => node.type)).toEqual(['paragraph', 'paragraph']);
    expect(flatten(definition.children ?? []).filter(node => node.type === 'text').map(node => node.value)).toEqual(['第一段', '第二段']);
  });
});
