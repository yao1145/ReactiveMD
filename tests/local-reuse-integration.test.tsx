import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLatex, compileLocal, createLocalRuntime, type LocalNode } from '../src/local';
import { LocalDocumentView } from '../src/local/LocalDocumentView';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
const source = [
  '<const name="rate" value="{{ 12.5 }}">',
  '<computed name="total" value="{{ quantity * rate }}">',
  '<computed name="label" value="{{ formatCurrency(total) }}">',
  '<computed name="elapsed" value="{{ dateDiff(endDate, startDate) }}">',
  '<panel title="Plan">',
  '<number bind="quantity" label="Quantity" initial="2" min="0" max="10">',
  '<date bind="startDate" label="Start" initial="2026-10-24">',
  '<date bind="endDate" label="End" initial="2026-10-26">',
  '</panel>',
  '',
  'Invoice: {{ label }}; days: {{ elapsed }}.',
  '',
  '<if when="{{ total >= 25 }}">',
  'Ready to order',
  '</if>',
  '',
  '$$',
  'y = \\mathrm{total} x',
  '$$',
  '',
  '<chart kind="bar" title="Invoice chart" x="Name" y="Value">',
  '| Name | Value |',
  '| --- | --- |',
  '| Total | {{ total }} |',
  '</chart>',
  '',
  '<plot label="Invoice plot" min="0" max="2" samples="3">',
  '$$',
  'y = \\mathrm{total} x',
  '$$',
  '</plot>',
].join('\n');

describe('reused computations across document consumers', () => {
  it('shares typed values across prose, formulas, conditions, charts and plots', () => {
    const result = compileLocal(source);
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) throw new Error('Expected compilation success');
    const runtime = createLocalRuntime(structuredClone(result.document));
    try {
      expect(runtime.evaluate('label')).toBe('$25.00');
      expect(runtime.evaluate('elapsed')).toBe(2);
      const formula = compileLatex('y = \\mathrm{total} x');
      expect(formula.evaluate(2, { ...runtime.snapshot().state })).toBe(50);
      const html = () => renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      const initial = html();
      expect(initial).toContain('$25.00');
      expect(initial).toContain('Ready to order');
      expect(initial).toContain('Invoice chart');
      expect(initial).toContain('Invoice plot');
      expect(initial).not.toContain('local-fallback');
      expect(initial).not.toContain('&lt;computed');
      const quantity = flatten(result.document.nodes).find(n => n.attrs?.bind === 'quantity')!;
      expect(runtime.set(quantity, 1)).toEqual([]);
      expect(runtime.snapshot().state.total).toBe(12.5);
      expect(formula.evaluate(2, { ...runtime.snapshot().state })).toBe(25);
      expect(html()).toContain('$12.50');
      expect(html()).toMatch(/class="local-if md-if"[^>]*hidden=""/);
      runtime.reset(flatten(result.document.nodes).find(n => n.name === 'panel')!);
      expect(runtime.evaluate('total')).toBe(25);
      expect(runtime.evaluate('label')).toBe('$25.00');
    } finally { runtime.dispose(); }
  });

  it('isolates failed computations and recovers every consumer after a valid edit', () => {
    const result = compileLocal('<computed name="ratio" value="{{ 100 / count }}">\n<computed name="display" value="{{ formatNumber(ratio) }}">\n<number bind="count" label="Count" initial="0">\n\n{{ display }} and {{ count + 1 }}');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      expect(() => runtime.evaluate('display')).toThrow();
      expect(runtime.evaluate('count + 1')).toBe(1);
      expect(runtime.evaluate('true ? 7 : ratio')).toBe(7);
      expect(runtime.text('Independent: {{ count + 1 }}')).toBe('Independent: 1');
      expect(runtime.set(flatten(result.document.nodes).find(n => n.name === 'number')!, 4)).toEqual([]);
      expect(runtime.evaluate('display')).toBe('25.00');
    } finally { runtime.dispose(); }
  });

  it('keeps heading targets at source initial values when mounting an already edited runtime', () => {
    const result = compileLocal('<computed name="headingNumber" value="{{ count * 2 }}">\n<number bind="count" label="Count" initial="1">\n\n## Result {{ headingNumber }}\n\n<jump to="result-2">Jump</jump>');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      runtime.set(flatten(result.document.nodes).find(n => n.name === 'number')!, 2);
      const html = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      expect(html).toMatch(/id="[^"]*-result-2"/);
      expect(html).toMatch(/href="#[^"]*-result-2"/);
      expect(html).toContain('>4</span>');
    } finally { runtime.dispose(); }
  });
});
