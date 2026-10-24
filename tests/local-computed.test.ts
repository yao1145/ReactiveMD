import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, LocalExpressionError } from '../src/local';
import type { LocalDocument, LocalNode } from '../src/local';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function diagnostics(source: string) {
  return compileLocal(source).diagnostics;
}

function codes(source: string): string[] {
  return diagnostics(source).map((diagnostic) => diagnostic.code);
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function find(document: LocalDocument, name: string, index = 0): LocalNode {
  const match = all(document.nodes).filter((node) => node.type === 'component' && node.name === name)[index];
  if (!match) throw new Error(`Missing <${name}> #${index}`);
  return match;
}

describe('computed and const declarations', () => {
  it('resolves forward references across controls, constants and computed values', () => {
    const document = compile(
      [
        '<computed name="total" value="{{ quantity * rate }}">',
        '<computed name="double" value="{{ total * 2 }}">',
        '<const name="rate" value="{{ 12.5 }}">',
        '<number bind="quantity" label="Quantity" initial="2" min="0" max="10">',
      ].join('\n'),
    );
    expect(document.initialState).toEqual({ quantity: 2 });
    expect(document.bindings.quantity).toBeDefined();
    expect(document.bindings.rate).toBeUndefined();
    expect(Object.keys(document.computations ?? {}).sort()).toEqual(['double', 'rate', 'total']);
    expect(document.computations?.rate).toMatchObject({ kind: 'const', type: 'number', value: 12.5 });
    expect(document.computations?.total).toMatchObject({ kind: 'computed', type: 'number' });
    expect(document.computations?.total.dependencies).toEqual(['quantity', 'rate']);
    expect(document.computations?.double.dependencies).toEqual(['total']);
    // Declarations are metadata; no component node reaches the renderer.
    expect(all(document.nodes).some((node) => node.name === 'computed' || node.name === 'const')).toBe(false);
    expect(() => structuredClone(document)).not.toThrow();

    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.evaluate('total')).toBe(25);
      expect(runtime.evaluate('double')).toBe(50);
      expect(runtime.snapshot().state).toMatchObject({ quantity: 2, rate: 12.5, total: 25, double: 50 });
      const quantity = find(document, 'number');
      expect(runtime.set(quantity, 5)).toEqual([]);
      expect(runtime.evaluate('total')).toBe(62.5);
      expect(runtime.evaluate('double')).toBe(125);
      runtime.reset(quantity);
      expect(runtime.evaluate('total')).toBe(25);
    } finally {
      runtime.dispose();
    }
  });

  it('supports forward constant chains without controls', () => {
    const document = compile(
      [
        '<computed name="later" value="{{ earlier + 1 }}">',
        '<const name="twice" value="{{ five * 2 }}">',
        '<computed name="earlier" value="{{ 4 }}">',
        '<const name="five" value="{{ 5 }}">',
      ].join('\n'),
    );
    expect(document.computations?.five.value).toBe(5);
    expect(document.computations?.twice.value).toBe(10);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.evaluate('twice')).toBe(10);
      expect(runtime.evaluate('later')).toBe(5);
      expect(runtime.snapshot().state).toMatchObject({ five: 5, twice: 10, earlier: 4, later: 5 });
    } finally {
      runtime.dispose();
    }
  });

  it('records null, boolean and string values and types', () => {
    const document = compile(
      [
        '<computed name="nothing" value="{{ null }}">',
        '<computed name="flag" value="{{ 1 < 2 }}">',
        '<computed name="label" value="{{ \'a\' + \'b\' }}">',
      ].join('\n'),
    );
    expect(document.computations?.nothing.type).toBe('null');
    expect(document.computations?.flag.type).toBe('boolean');
    expect(document.computations?.label.type).toBe('string');
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.evaluate('nothing')).toBeNull();
      expect(runtime.evaluate('flag')).toBe(true);
      expect(runtime.evaluate('label')).toBe('ab');
      expect(runtime.snapshot().state.nothing).toBeNull();
    } finally {
      runtime.dispose();
    }
  });
});

describe('computed declaration diagnostics', () => {
  it('reports cycles, unknown references, duplicates and reserved names with positions', () => {
    const cycle = diagnostics(
      '<computed name="a" value="{{ b }}">\n<computed name="b" value="{{ c }}">\n<computed name="c" value="{{ a }}">',
    ).filter((diagnostic) => diagnostic.code === 'local.computation.cycle');
    expect(cycle.length).toBeGreaterThan(0);
    expect(cycle.every((diagnostic) => diagnostic.line > 0 && diagnostic.column > 0)).toBe(true);

    expect(codes('<computed name="a" value="{{ a }}">')).toContain('local.computation.cycle');
    expect(codes('<computed name="a" value="{{ missing }}">')).toContain('local.computation.unknown');
    expect(codes('<computed name="a" value="{{ 1 }}">\n<computed name="a" value="{{ 2 }}">')).toContain(
      'local.computation.duplicate',
    );
    expect(
      codes('<number bind="n" label="N">\n<computed name="n" value="{{ 1 }}">'),
    ).toContain('local.computation.duplicate');
    expect(
      codes('<range-slider label="R" bind-start="s" bind-end="e">\n<computed name="s" value="{{ 1 }}">'),
    ).toContain('local.computation.duplicate');
    expect(codes('<computed name="pi" value="{{ 1 }}">')).toContain('local.computation.reserved');
    expect(codes('<computed name="1bad" value="{{ 1 }}">')).toContain('local.computation.name');
    expect(codes('<computed value="{{ 1 }}">')).toContain('local.attribute.required');
    expect(codes('<computed name="a">')).toContain('local.attribute.required');
  });

  it('requires a standalone top-level line and one complete interpolation', () => {
    expect(codes('Text <computed name="result" value="{{ 1 }}">')).toContain('local.computation.placement');
    expect(
      codes('<panel>\n<computed name="result" value="{{ 1 }}">\n</panel>'),
    ).toContain('local.computation.placement');
    expect(codes('<computed name="result" value="1 + 1">')).toContain('local.computation.value');
    expect(codes('<computed name="result" value="{{ 1 }} extra">')).toContain('local.computation.value');
    expect(codes('<computed name="result" value="{{ }}">')).toContain('local.expression.empty');
    expect(codes('<computed name="result" value="{{ 1 + }}">').length).toBeGreaterThan(0);
  });
});

describe('const restrictions and static evaluation', () => {
  it('rejects direct and indirect dependencies on controls or computed values', () => {
    expect(
      codes('<const name="c" value="{{ n }}">\n<number bind="n" label="N">'),
    ).toContain('local.computation.const');
    expect(
      codes('<const name="c" value="{{ result }}">\n<computed name="result" value="{{ 1 }}">'),
    ).toContain('local.computation.const');
    const indirect = codes(
      [
        '<const name="a" value="{{ b + 1 }}">',
        '<const name="b" value="{{ c + 1 }}">',
        '<computed name="c" value="{{ 1 }}">',
      ].join('\n'),
    );
    expect(indirect.filter((code) => code === 'local.computation.const').length).toBeGreaterThanOrEqual(2);
  });

  it('turns constant domain errors into compile diagnostics but leaves computed errors to the runtime', () => {
    expect(codes('<const name="c" value="{{ 1 / 0 }}">')).toContain('local.computation.expression');
    expect(codes('<const name="c" value="{{ sqrt(-1) }}">')).toContain('local.computation.expression');
    const result = compileLocal('<computed name="r" value="{{ 1 / 0 }}">');
    expect(result.ok).toBe(true);
  });
});

describe('computed runtime behavior', () => {
  it('isolates failures, propagates the original error on read, and recovers after edits', () => {
    const document = compile(
      [
        '<computed name="ratio" value="{{ 100 / count }}">',
        '<computed name="display" value="{{ ratio + 1 }}">',
        '<number bind="count" label="Count" initial="0">',
      ].join('\n'),
    );
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.snapshot().state.count).toBe(0);
      expect(Object.hasOwn(runtime.snapshot().state, 'ratio')).toBe(false);
      expect(Object.hasOwn(runtime.snapshot().state, 'display')).toBe(false);
      expect(runtime.evaluate('count + 1')).toBe(1);
      expect(runtime.evaluate('true ? 7 : ratio')).toBe(7);
      expect(runtime.text('Independent: {{ count + 1 }}')).toBe('Independent: 1');

      let error: unknown;
      try {
        runtime.evaluate('display');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(LocalExpressionError);
      expect((error as LocalExpressionError).code).toBe('expression-divide-by-zero');

      const count = find(document, 'number');
      expect(runtime.set(count, 4)).toEqual([]);
      expect(runtime.evaluate('ratio')).toBe(25);
      expect(runtime.evaluate('display')).toBe(26);
      expect(runtime.snapshot().state).toMatchObject({ count: 4, ratio: 25, display: 26 });

      runtime.reset(count);
      expect(() => runtime.text('{{ ratio }}')).toThrow(LocalExpressionError);
      expect(Object.hasOwn(runtime.snapshot().state, 'ratio')).toBe(false);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps declarations read-only and computes constants only once', () => {
    const document = compile(
      '<const name="rate" value="{{ 12.5 }}">\n<computed name="total" value="{{ quantity * rate }}">\n<number bind="quantity" label="Quantity" initial="2">',
    );
    const runtime = createLocalRuntime(document);
    try {
      const forged: LocalNode = {
        type: 'component',
        id: document.computations!.total.nodeId,
        name: 'computed',
        range: { start: 0, end: 1 },
        attrs: { name: 'total' },
        children: [],
      };
      expect(runtime.set(forged, 99)[0]?.code).toBe('local.runtime.binding');
      expect(runtime.get(forged)).toBeNull();
      expect(document.bindings.total).toBeUndefined();
      expect(Object.hasOwn(document.initialState, 'total')).toBe(false);

      // Mutating metadata after construction must not change the cached value.
      (document.computations!.rate as { value?: unknown }).value = 999;
      const quantity = find(document, 'number');
      expect(runtime.set(quantity, 4)).toEqual([]);
      expect(runtime.evaluate('rate')).toBe(12.5);
      expect(runtime.evaluate('total')).toBe(50);
      expect(runtime.snapshot().state.rate).toBe(12.5);
    } finally {
      runtime.dispose();
    }
  });

  it('handles long forward chains without recursion or quadratic rescanning', () => {
    const length = 600;
    const declarations: string[] = [];
    for (let index = length - 1; index >= 0; index -= 1) {
      declarations.push(
        index === 0
          ? '<computed name="c0" value="{{ 1 }}">'
          : `<computed name="c${index}" value="{{ c${index - 1} + 1 }}">`,
      );
    }
    const document = compile(declarations.join('\n'));
    expect(Object.keys(document.computations ?? {})).toHaveLength(length);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.evaluate(`c${length - 1}`)).toBe(length);
      expect(runtime.snapshot().state[`c${length - 1}`]).toBe(length);
    } finally {
      runtime.dispose();
    }
  });
});

describe('computed values in consumers', () => {
  it('type-checks plot formulas and chart cells that read computed values', () => {
    const valid = compileLocal(
      [
        '<computed name="total" value="{{ q * 2 }}">',
        '<number bind="q" label="Q" initial="1">',
        '<plot label="P" min="0" max="2" samples="3">',
        '$$',
        'y = \\mathrm{total} x',
        '$$',
        '</plot>',
        '<chart title="C" x="Name" y="Value">',
        '| Name | Value |',
        '| --- | --- |',
        '| A | {{ total }} |',
        '</chart>',
      ].join('\n'),
    );
    expect(valid.diagnostics).toEqual([]);

    expect(
      codes(
        [
          '<computed name="label" value="{{ \'a\' }}">',
          '<plot label="P" min="0" max="2" samples="3">',
          '$$',
          'y = \\mathrm{label} x',
          '$$',
          '</plot>',
        ].join('\n'),
      ),
    ).toContain('local.math.binding');

    expect(
      codes(
        [
          '<computed name="label" value="{{ \'a\' }}">',
          '<chart title="C" x="Name" y="Value">',
          '| Name | Value |',
          '| --- | --- |',
          '| A | {{ label }} |',
          '</chart>',
        ].join('\n'),
      ),
    ).toContain('local.chart.numeric');
  });

  it('uses computed values when validating dynamic heading navigation', () => {
    const result = compileLocal(
      [
        '<computed name="n" value="{{ 2 }}">',
        '## Result {{ n }}',
        '',
        '<jump to="result-2">Go</jump>',
      ].join('\n'),
    );
    expect(result.diagnostics).toEqual([]);
  });
});
