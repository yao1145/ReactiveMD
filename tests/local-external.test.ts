import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, exportLocalState, type LocalDocument, type LocalNode } from '../src/local';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
  }
  return result.document;
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function nodeNamed(document: LocalDocument, name: string): LocalNode {
  const found = all(document.nodes).find((node) => node.name === name);
  if (!found) throw new Error(`Missing <${name}>`);
  return found;
}

const PRICE_SOURCE = [
  '<external name="exchangeRate" type="number">',
  '<computed name="priceCny" value="{{ priceUsd * exchangeRate }}">',
  '<number bind="priceUsd" label="USD" initial="129" min="0" max="1000">',
  '',
  'Price: {{ priceCny }} CNY',
  '',
  'USD: {{ priceUsd }}',
].join('\n');

describe('external read-only data', () => {
  it('compiles declarations and evaluates computations against host values', () => {
    const document = compile(PRICE_SOURCE);
    expect(document.externals).toMatchObject({ exchangeRate: { name: 'exchangeRate', type: 'number' } });
    expect(Object.keys(document.bindings)).toEqual(['priceUsd']);
    expect(all(document.nodes).some((node) => node.name === 'external')).toBe(false);

    const runtime = createLocalRuntime(document, { externalValues: { exchangeRate: 7.2 } });
    try {
      expect(runtime.evaluate('priceCny')).toBeCloseTo(928.8, 10);
      expect(runtime.text('Price: {{ priceCny }} CNY')).toMatch(/Price: 928\.8/);
      expect(runtime.getParameters()).toEqual({ priceUsd: 129 });
      expect(runtime.getExternalValues()).toEqual({ exchangeRate: 7.2 });
      expect(runtime.snapshot().state.priceUsd).toBe(129);
      expect(runtime.snapshot().state.exchangeRate).toBe(7.2);
      expect(runtime.snapshot().state.priceCny).toBeCloseTo(928.8, 10);
      const file = exportLocalState(runtime);
      expect(file.parameters).toEqual({ priceUsd: 129 });
      expect(file.syntax).toBe('local-draft-3');
    } finally {
      runtime.dispose();
    }
  });

  it('updates externals atomically without touching reader parameters', () => {
    const document = compile(PRICE_SOURCE);
    const runtime = createLocalRuntime(document, { externalValues: { exchangeRate: 7.2 } });
    try {
      const before = runtime.snapshot().revision;
      expect(runtime.setExternalValues({ exchangeRate: 7.3 })).toEqual([]);
      expect(runtime.snapshot().revision).toBe(before + 1);
      expect(runtime.evaluate('priceCny')).toBeCloseTo(941.7, 10);
      expect(runtime.getParameters()).toEqual({ priceUsd: 129 });

      const current = runtime.snapshot().revision;
      expect(runtime.setExternalValues({ exchangeRate: 7.3 })).toEqual([]);
      expect(runtime.snapshot().revision).toBe(current);

      expect(runtime.setExternalValues({ exchangeRate: '7.4' as unknown as number })[0]?.code)
        .toBe('local.runtime.external');
      expect(runtime.snapshot().revision).toBe(current);
      expect(runtime.getExternalValues()).toEqual({ exchangeRate: 7.3 });

      expect(runtime.setExternalValues({ unknown: 1 })[0]?.code).toBe('local.runtime.external');
      expect(runtime.snapshot().revision).toBe(current);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps missing values local and recovers when data arrives', () => {
    const document = compile(PRICE_SOURCE);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.evaluate('priceUsd')).toBe(129);
      expect(() => runtime.evaluate('priceCny')).toThrow();
      expect(runtime.snapshot().state).not.toHaveProperty('priceCny');
      expect(runtime.getExternal('exchangeRate')).toBeUndefined();

      expect(runtime.setExternalValues({ exchangeRate: 7.2 })).toEqual([]);
      expect(runtime.evaluate('priceCny')).toBeCloseTo(928.8, 10);
    } finally {
      runtime.dispose();
    }
  });

  it('rejects writes to external names through the parameter API', () => {
    const document = compile(PRICE_SOURCE);
    const runtime = createLocalRuntime(document, { externalValues: { exchangeRate: 7.2 } });
    try {
      expect(runtime.parameterNames()).toEqual(['priceUsd']);
      expect(runtime.getParameter('exchangeRate')).toBeUndefined();
      expect(runtime.setParameter('exchangeRate', 8)[0]?.code).toBe('local.runtime.parameter');
    } finally {
      runtime.dispose();
    }
  });

  it('defensively copies array externals', () => {
    const document = compile([
      '<external name="inventory" type="number-array">',
      '<computed name="total" value="{{ sum(inventory) }}">',
      '{{ total }}',
    ].join('\n'));
    const values = { inventory: [1, 2, 3] };
    const runtime = createLocalRuntime(document, { externalValues: values });
    try {
      values.inventory.push(99);
      expect(runtime.getExternalValues().inventory).toEqual([1, 2, 3]);
      const read = runtime.getExternal('inventory') as number[];
      read.push(99);
      expect(runtime.getExternalValues().inventory).toEqual([1, 2, 3]);
      expect(runtime.evaluate('total')).toBe(6);
      expect(runtime.setExternalValues({ inventory: [4, 5] })).toEqual([]);
      expect(runtime.evaluate('total')).toBe(9);
    } finally {
      runtime.dispose();
    }
  });

  it('reports declaration errors', () => {
    const codes = (source: string): string[] => {
      const result = compileLocal(source);
      return [...new Set(result.diagnostics.map((item) => item.code))].sort();
    };
    expect(codes('<external name="rate" type="number">\n<number bind="rate" label="R">'))
      .toContain('local.external.duplicate');
    expect(codes('<external name="rate" type="number">\n<external name="rate" type="number">'))
      .toContain('local.external.duplicate');
    expect(codes('<external name="rate" type="text">')).toContain('local.external.type');
    expect(codes('<external name="pi" type="number">')).toContain('local.external.reserved');
    expect(codes('<external name="1bad" type="number">')).toContain('local.external.name');
    expect(codes('<panel><external name="rate" type="number"></panel>')).toContain('local.external.placement');
    expect(codes('<external name="rate" type="number">\n<computed name="rate" value="{{ 1 }}">'))
      .toContain('local.computation.duplicate');
    expect(codes('<external name="rate" type="number">\n<const name="fixed" value="{{ rate }}">'))
      .toContain('local.computation.const');
  });

  it('treats externals as read-only declarations for state files', () => {
    const document = compile(PRICE_SOURCE);
    expect(document.bindings).not.toHaveProperty('exchangeRate');
    expect(document.initialState).not.toHaveProperty('exchangeRate');
    expect(nodeNamed(document, 'number').attrs?.bind).toBe('priceUsd');
  });
});
