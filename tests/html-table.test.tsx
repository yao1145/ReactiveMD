import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView } from '../src/local/LocalDocumentView';
import type { LocalNode } from '../src/local/types';
import { formatLocalDiagnostic } from '../src/local/diagnostics';

const flat = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flat(n.children ?? [])]);
const elements = (n: any, tag: string): any[] => [...(n.tagName === tag ? [n] : []), ...(n.childNodes ?? []).flatMap((c: any) => elements(c, tag))];
const attrs = (n: any): Record<string, string> => Object.fromEntries((n.attrs ?? []).map((a: any) => [a.name, a.value]));

describe('HTML table compatibility', () => {
  it('keeps existing Markdown table components and detects native structure', () => {
    const source = '<table label="Legacy" page-size="2">\n| Name | Value |\n| --- | ---: |\n| A | 1 |\n</table>\n\n<table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.document.html).toBeUndefined();
    const all = flat(result.document.nodes);
    expect(all.filter(n => n.type === 'component' && n.name === 'table')).toHaveLength(1);
    expect(all.filter(n => n.type === 'htmlTable')).toHaveLength(1);
    const runtime = createLocalRuntime(result.document);
    try {
      const tree = parseFragment(renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />));
      const tables = elements(tree, 'table');
      expect(tables).toHaveLength(2);
      expect(tables.every(t => attrs(t).class.includes('local-visual-table'))).toBe(true);
      expect(elements(tables[1], 'tbody')).toHaveLength(1);
    } finally { runtime.dispose(); }
  });

  it('normalizes omitted cell/row/group ends, retains caption, spans and scoped headers', () => {
    const source = '<TABLE id="data"><CAPTION>Prices</CAPTION><colgroup><col span="2"></colgroup><thead><tr><th id="kind" rowspan="2" scope="col">Kind<th colspan="2">Price<tr><th>Low<th>High</thead><tbody><tr><td headers="kind">A<td>1<td>2</tbody><tfoot><tr><td colspan="3">End</tfoot></TABLE>';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    const runtime = createLocalRuntime(result.document);
    try {
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      const tree = parseFragment(markup);
      expect(elements(tree, 'caption')).toHaveLength(1);
      expect(elements(tree, 'thead')).toHaveLength(1);
      expect(elements(tree, 'tfoot')).toHaveLength(1);
      expect(attrs(elements(tree, 'col')[0]).span).toBe('2');
      expect(attrs(elements(tree, 'th')[0])).toMatchObject({ rowspan: '2', scope: 'col' });
      expect(attrs(elements(tree, 'td')[0]).headers).toBe(attrs(elements(tree, 'th')[0]).id);
      expect(markup).not.toContain('local-visual-search');
      expect(markup).not.toContain('local-visual-sort-button');
    } finally { runtime.dispose(); }
  });

  it('parses Markdown, math, controls and nested tables inside cells with original ranges', () => {
    const source = '<table><tr><td>**Bold** \\(x^2\\)\n\n<counter bind="n" label="Count" initial="2">\n\nValue: {{ n }}\n\n<table><tr><td>Nested</td></tr></table></td></tr></table>';
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(flat(result.document.nodes).filter(n => n.type === 'htmlTable')).toHaveLength(2);
    const control = flat(result.document.nodes).find(n => n.name === 'counter')!;
    expect(source.slice(control.range.start, control.range.end)).toContain('<counter');
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.setParameter('n', 4)).toEqual([]);
      const markup = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      const tree = parseFragment(markup);
      expect(elements(tree, 'strong')).toHaveLength(1);
      expect(markup).toContain('Value: ');
      expect(markup).toContain('>4</span>');
      expect(markup).toContain('<math');
    } finally { runtime.dispose(); }
  });

  it('does not detect HTML structures inside code examples in a Markdown table', () => {
    const result = compileLocal('<table>\n| Code | Meaning |\n| --- | --- |\n| `<tr><td>` | Example |\n</table>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(flat(result.document.nodes).some(n => n.type === 'htmlTable')).toBe(false);
  });

  it('keeps table-shaped strings and fallback regions opaque', () => {
    const legacy = compileLocal('<table>\n| Code |\n| --- |\n| {{ \'<tr><td>\' }} |\n</table>');
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(flat(legacy.document.nodes).some(n => n.type === 'htmlTable')).toBe(false);
    const native = compileLocal('<table><tr><td>{{ \'<tr><td>\' }}\n\n<unknown><tr><td>Literal</td></tr></unknown></td></tr></table>');
    expect(native.ok).toBe(true);
    if (native.ok) expect(flat(native.document.nodes).filter(n => n.type === 'htmlTableElement' && n.name === 'tr')).toHaveLength(1);
  });

  it('keeps indented code fences inside cells literal', () => {
    const result = compileLocal('<table><tr><td>\n    ```html\n    </td><tr><td>Example\n    ```\n</td></tr></table>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(flat(result.document.nodes).filter(n => n.type === 'htmlTableElement' && n.name === 'tr')).toHaveLength(1);
    expect(flat(result.document.nodes).find(n => n.type === 'code')?.value).toContain('</td><tr><td>');
  });

  it.each([
    '<table>\n| A | B |\n| --- | --- |\n| 1 | 2 |\n<tr><td>Mixed</td></tr></table>',
    '<table bind="n"><tr><td>A</td></tr></table>',
    '<table page-size="2"><tr><td>A</td></tr></table>',
    '<table><div>Outside cell</div><tr><td>A</td></tr></table>',
    '<table><tr><td colspan="-1">A</td></tr></table>',
    '<table><tr><th scope="bad">A</th></tr></table>',
    '<table><tr><td onclick="bad()">A</td></tr></table>',
    '<table><caption>A</caption><caption>B</caption><tr><td>Text</td></tr></table>',
    '<table><colgroup span="2"><col></colgroup><tr><td>Text</td></tr></table>',
    '<table><tr><td>A</td></tr>',
  ])('shows mixed, invalid or unsupported native structure as source: %s', source => {
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.every(d => d.severity === 'warning')).toBe(true);
    expect(flat(result.document.nodes).find(n => n.type === 'fallback')?.value).toBe(source);
    expect(flat(result.document.nodes).some(n => n.type === 'htmlTable')).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'local.html.fallback')).toBe(true);
    expect(formatLocalDiagnostic(result.diagnostics.find(d => d.code === 'local.html.fallback')!, 'zh')).toMatch(/[\u4e00-\u9fff]/);
    expect(result.diagnostics.every(d => d.range.start >= 0 && d.range.end <= source.length)).toBe(true);
  });

  it('leaves structural names available outside a native table context', () => {
    const result = compileLocal('<tr>Unrelated</tr>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(flat(result.document.nodes).some(n => n.type === 'htmlTableElement')).toBe(false);
  });

  it('also accepts table elements in native mode without enabling extended HTML', () => {
    const result = compileLocal('<table><tr><th scope="col">Header</th></tr><tr><td rowspan="0">Cell</td></tr></table>', { enableCss: true });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) return;
    expect(result.document.html?.enableExtendedHtml).toBe(false);
    expect(result.document.nodes[0].value).toContain('<table>');
  });

  it('enforces the existing syntax budget for native structures', () => {
    const result = compileLocal('<table>' + '<tr><td>x</td></tr>'.repeat(30) + '</table>', { limits: { maxSyntaxNodes: 20 } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code.startsWith('local.budget'))).toBe(true);
  });
});
