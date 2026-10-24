import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileExpression, compileLocal, createLocalRuntime, type LocalNode } from '../src/local';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);

describe('predictable formatting and date interoperability', () => {
  it('protects reused arrays and updates them after selection changes', () => {
    const result = compileLocal('<computed name="selectedCopy" value="{{ selected }}">\n<multi-select bind="selected" label="Select">\n<option value="a">A</option>\n<option value="b">B</option>\n</multi-select>');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      const returned = runtime.evaluate('selectedCopy') as string[];
      returned.push('a');
      expect(runtime.evaluate('selectedCopy')).toEqual([]);
      expect(Object.isFrozen(runtime.snapshot().state.selectedCopy)).toBe(true);
      runtime.set(flatten(result.document.nodes).find(n => n.name === 'multi-select')!, ['b']);
      expect(runtime.evaluate('selectedCopy')).toEqual(['b']);
    } finally { runtime.dispose(); }
  });

  it('refreshes calculations atomically for slot edits and preserves them on a rejected edit', () => {
    const result = compileLocal('<computed name="width" value="{{ hi - lo }}">\n<range-slider label="Range" bind-start="lo" bind-end="hi" initial-start="10" initial-end="20">');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    const node = flatten(result.document.nodes).find(n => n.name === 'range-slider')!;
    try {
      const observed: unknown[] = [];
      runtime.subscribe(() => observed.push(runtime.evaluate('width')));
      expect(runtime.setMany(node, { start: 30, end: 50 })).toEqual([]);
      expect(observed).toEqual([20]);
      const snapshot = runtime.snapshot();
      expect(runtime.setMany(node, { start: 60, end: 50 })).not.toEqual([]);
      expect(runtime.snapshot()).toBe(snapshot);
      expect(runtime.evaluate('width')).toBe(20);
      runtime.reset(node);
      expect(observed).toEqual([20, 10]);
    } finally { runtime.dispose(); }
  });

  it('bounds cycle diagnostics for large dependency rings', () => {
    const size = 600;
    const source = Array.from({ length: size }, (_, i) => `<computed name="c${i}" value="{{ c${(i + 1) % size} }}">`).join('\n');
    const result = compileLocal(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'local.computation.cycle')).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(100);
    expect(result.diagnostics.every(d => d.message.length <= 2000)).toBe(true);
  });

  it('does not show a negative sign when rounding produces zero', () => {
    expect(compileExpression('formatNumber(-0.001, 2)').evaluate({})).toBe('0.00');
    expect(compileExpression('formatPercent(-0.00001)').evaluate({})).toBe('0%');
    expect(compileExpression('formatCurrency(-0.001)').evaluate({})).toBe('$0.00');
  });

  it('allows replacements whose actual result fits the budget', () => {
    const text = 'a'.repeat(100_000);
    expect(compileExpression("replace(text, 'b', 'bb')").evaluate({ text })).toBe(text);
    const oneMatch = 'b' + 'a'.repeat(99_998);
    expect(compileExpression("replace(text, 'b', 'bb')").evaluate({ text: oneMatch })).toHaveLength(100_000);
    expect(() => compileExpression("replace(text, 'a', 'aa')").evaluate({ text })).toThrow();
  });

  it('uses the same early-year calendar rules for date controls and functions', () => {
    const result = compileLocal('<date bind="early" label="Early" initial="0001-01-01">\n\n{{ dateDiff(early, "0001-01-01") }}');
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.evaluate('dateDiff(early, "0001-01-01")')).toBe(0);
      expect(runtime.set(flatten(result.document.nodes).find(n => n.name === 'date')!, '0099-12-31')).toEqual([]);
      expect(runtime.evaluate('dateCompare(early, "0100-01-01")')).toBe(-1);
      expect(runtime.set(flatten(result.document.nodes).find(n => n.name === 'date')!, '0000-12-31')).not.toEqual([]);
      expect(() => runtime.evaluate('dateDiff(early, "0000-12-31")')).toThrow();
    } finally { runtime.dispose(); }
  });

  for (const file of ['invoice.reactive.md', 'invoice-zh.reactive.md']) {
    it(`runs the documented recipe ${file}`, () => {
      const source = readFileSync(new URL(`../examples/local/recipes/${file}`, import.meta.url), 'utf8');
      const result = compileLocal(source);
      expect(result.diagnostics).toEqual([]);
      if (!result.ok) throw new Error('Expected recipe compilation success');
      const runtime = createLocalRuntime(result.document);
      try {
        expect(runtime.evaluate('total')).toBe(25);
        expect(runtime.evaluate('days')).toBe(2);
        expect(runtime.set(flatten(result.document.nodes).find(n => n.attrs?.bind === 'endDate')!, '')).toEqual([]);
        expect(runtime.evaluate('days')).toBeNull();
      } finally { runtime.dispose(); }
    });
  }
});
