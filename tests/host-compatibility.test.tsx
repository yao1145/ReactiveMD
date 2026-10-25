import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { compileLocal, formatLocalDiagnostic } from '../src/index';
import { LocalReactiveDocument } from '../src/react/index';

it('reports display fallback at its original formula range', () => {
  const source = '# 😀 Heading\n\nFormula $x + \\unknown{x}$.';
  const result = compileLocal(source);
  expect(result.ok).toBe(true);
  const warning = result.diagnostics.find(item => item.code === 'local.math.display');
  expect(warning?.severity).toBe('warning');
  expect(source.slice(warning!.range.start, warning!.range.end)).toBe('\\unknown');
  expect(warning?.line).toBe(3);
  expect(formatLocalDiagnostic(warning!, 'zh')).toMatch(/不受支持/);
  expect(compileLocal('$\\int_0^x t^2 dt$').diagnostics).toEqual([]);
});

it('diagnoses unsupported environments and rendering depth fallbacks', () => {
  for (const formula of ['\\begin{matrix}x\\end{matrix}', '{'.repeat(125) + 'x' + '}'.repeat(125)]) {
    const source = `$$${formula}$$`;
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'local.math.display', severity: 'warning' }));
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.range.start).toBeGreaterThanOrEqual(2);
      expect(diagnostic.range.end).toBeLessThanOrEqual(source.length - 2);
    }
  }
});

it('renders source soft breaks without confusing decoded entity newlines', () => {
  const source = 'a&#10;b\nc';
  const result = compileLocal(source, { markdownBreaks: true });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const children = result.document.nodes[0].children!;
  expect(children.map(node => [node.type, node.value, node.range])).toEqual([
    ['text', 'a\nb', { start: 0, end: 7 }],
    ['break', undefined, { start: 7, end: 8 }],
    ['text', 'c', { start: 8, end: 9 }],
  ]);
  const html = renderToStaticMarkup(createElement(LocalReactiveDocument, { source, compileOptions: { markdownBreaks: true } }));
  expect(html).toContain('<span>a\nb</span><br/><span>c</span>');
});
