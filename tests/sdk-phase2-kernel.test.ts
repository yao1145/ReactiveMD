import { describe, expect, it } from 'vitest';
import {
  compileLocal,
  createLocalRuntime,
  type LocalNode,
} from '../src/local';
import {
  createLocalConfig,
  defineLocalComponent,
  type LocalComponentDefinition,
} from '../src/sdk';
import {
  isKernelDate,
  kernelAttributeIssues,
  kernelDefaultInitial,
  kernelSchemaFor,
  type KernelComponentSchema,
  type KernelRule,
} from '../src/local/component-kernel';

const CAPABILITIES = { interactive: true, static: true, ssr: true, offline: true };

function manifest(input: Record<string, unknown>): LocalComponentDefinition {
  return defineLocalComponent({
    id: `example/${String(input.name)}`,
    version: '1.0.0',
    protocol: 'reactive-md-component/v1',
    capabilities: CAPABILITIES,
    ...input,
  } as unknown as LocalComponentDefinition);
}

function config(...components: LocalComponentDefinition[]) {
  return createLocalConfig({ components });
}

/** Collect component nodes by tag name. */
function nodes(document: { nodes: LocalNode[] }, name: string): LocalNode[] {
  const found: LocalNode[] = [];
  const walk = (items: LocalNode[]) => {
    for (const node of items) {
      if (node.type !== 'text' && node.name === name) found.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(document.nodes);
  return found;
}

describe('kernel attribute rule primitives', () => {
  it('applies numeric-range to any manifest, not just built-in tags', () => {
    const schema: KernelComponentSchema = {
      name: 'gauge',
      form: 'leaf',
      props: {
        min: { kind: 'number' },
        max: { kind: 'number' },
        step: { kind: 'number', default: 1 },
      },
      rules: [{ kind: 'numeric-range', min: 'min', max: 'max', step: 'step' }],
    };
    const issues = kernelAttributeIssues(
      schema,
      {
        min: { raw: '5', value: 5, dynamic: false, offset: 10 },
        max: { raw: '1', value: 1, dynamic: false, offset: 20 },
      },
      { start: 0, end: 30 },
    );
    expect(issues.map((issue) => issue.code)).toContain('local.constraint');
    expect(issues[0].key).toBe('local.constraint.number-min-max');
  });

  it('applies text-length and date-bounds ordering without tag names', () => {
    const text: KernelComponentSchema = {
      name: 'field',
      form: 'leaf',
      props: { 'min-length': { kind: 'number', default: 3 }, 'max-length': { kind: 'number' } },
      rules: [{ kind: 'text-length', min: 'min-length', max: 'max-length' }],
    };
    expect(kernelAttributeIssues(text, {
      'max-length': { raw: '2', value: 2, dynamic: false, offset: 4 },
    }, { start: 0, end: 9 })[0]?.key).toBe('local.constraint.length-order');

    const date: KernelComponentSchema = {
      name: 'day',
      form: 'leaf',
      props: { min: { kind: 'string', dynamic: true }, max: { kind: 'string', dynamic: true } },
      rules: [{ kind: 'date-bounds', min: 'min', max: 'max' }],
    };
    expect(kernelAttributeIssues(date, {
      min: { raw: '2024-05-02', value: '2024-05-02', dynamic: false, offset: 1 },
      max: { raw: '2024-05-01', value: '2024-05-01', dynamic: false, offset: 2 },
    }, { start: 0, end: 9 })[0]?.key).toBe('local.constraint.date-order');
  });

  it('derives defaults from initial rules and constraints', () => {
    expect(kernelDefaultInitial('min', { min: 4, max: 9, step: 1 }, [])).toEqual({ value: 4 });
    expect(kernelDefaultInitial('nearest-zero', { min: -3, max: 3, step: 1 }, [])).toEqual({ value: 0 });
    expect(kernelDefaultInitial('max-step', { min: 0, max: 10, step: 2 }, [])).toEqual({ value: 10 });
    expect(kernelDefaultInitial('duration', { min: 0, max: 45, step: 1 }, [])).toEqual({ value: 45 });
    expect(kernelDefaultInitial('first-option', undefined, ['a', 'b'])).toEqual({ value: 'a' });
  });

  it('treats only real calendar dates as valid', () => {
    expect(isKernelDate('')).toBe(true);
    expect(isKernelDate('2024-02-29')).toBe(true);
    expect(isKernelDate('2023-02-29')).toBe(false);
    expect(isKernelDate('2024-13-01')).toBe(false);
  });
});

describe('external components use the same compiler primitives', () => {
  it('rejects a numeric range through the public numeric-range rule', () => {
    const gauge = manifest({
      name: 'gauge',
      form: 'leaf',
      props: {
        label: { kind: 'string' },
        min: { kind: 'number' },
        max: { kind: 'number' },
      },
      bindings: {
        value: {
          kind: 'number', family: 'number', bind: 'bind', initial: 'initial',
          initialRule: 'min',
          constraints: { min: { prop: 'min' }, max: { prop: 'max' }, step: { literal: 1 } },
        },
      },
      structure: { rule: 'none' },
      rules: [{ kind: 'numeric-range', min: 'min', max: 'max', step: 'step' }],
    });
    const result = compileLocal('<gauge bind="g" label="G" min="5" max="1">', { config: config(gauge) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === 'local.constraint')).toBe(true);
  });

  it('projects options and default initials through structure and options-body', () => {
    const picker = manifest({
      name: 'picker',
      form: 'container',
      props: { label: { kind: 'string' } },
      bindings: {
        value: { kind: 'string', family: 'choice', bind: 'bind', initial: 'initial', initialRule: 'first-option' },
      },
      structure: { rule: 'options', child: 'option', valueAttribute: 'value' },
      rules: [{ kind: 'options-body', child: 'option', valueAttribute: 'value', unique: true, max: 8 }],
    });
    const missing = compileLocal('<picker bind="p" label="P"></picker>', { config: config(picker) });
    expect(missing.ok).toBe(false);

    const valid = compileLocal('<picker bind="p" label="P"><option value="a">A</option><option value="b">B</option></picker>', {
      config: config(picker),
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const runtime = createLocalRuntime(valid.document);
    try {
      expect(runtime.getParameter('p')).toBe('a');
      expect(runtime.setParameter('p', 'b')).toEqual([]);
      expect(runtime.setParameter('p', 'missing').length).toBeGreaterThan(0);
    } finally {
      runtime.dispose();
    }
  });

  it('supports atomic multi-slot writes and ordered slot relations', () => {
    const range = manifest({
      name: 'range',
      form: 'leaf',
      props: {
        label: { kind: 'string' },
        min: { kind: 'number', default: 0 },
        max: { kind: 'number', default: 100 },
        step: { kind: 'number', default: 1 },
      },
      bindings: {
        start: {
          kind: 'number', family: 'number', bind: 'bind-start', initial: 'initial-start',
          initialRule: 'min', exclusive: true,
          constraints: { min: { prop: 'min' }, max: { prop: 'max' }, step: { prop: 'step' } },
        },
        end: {
          kind: 'number', family: 'number', bind: 'bind-end', initial: 'initial-end',
          initialRule: 'max-step', exclusive: true,
          constraints: { min: { prop: 'min' }, max: { prop: 'max' }, step: { prop: 'step' } },
        },
      },
      slotRelations: [{ lower: 'start', upper: 'end' }],
      structure: { rule: 'none' },
      rules: [{ kind: 'numeric-range', min: 'min', max: 'max', step: 'step' }],
    });
    const crossing = compileLocal('<range label="R" initial-start="80" initial-end="20">', { config: config(range) });
    expect(crossing.ok).toBe(false);

    const valid = compileLocal('<range label="R">', { config: config(range) });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const node = nodes(valid.document, 'range')[0];
    const runtime = createLocalRuntime(valid.document);
    try {
      expect(runtime.get(node, 'start')).toBe(0);
      expect(runtime.get(node, 'end')).toBe(100);
      expect(runtime.setMany(node, { start: 90, end: 10 }).length).toBeGreaterThan(0);
      expect(runtime.get(node, 'start')).toBe(0);
      expect(runtime.setMany(node, { start: 10, end: 90 })).toEqual([]);
      expect(runtime.get(node, 'start')).toBe(10);
      expect(runtime.get(node, 'end')).toBe(90);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps custom bind attribute names working across runtime and retention', () => {
    const reading = manifest({
      name: 'reading',
      form: 'leaf',
      props: { label: { kind: 'string' } },
      bindings: {
        value: {
          kind: 'number', family: 'number', bind: 'bind-value', initial: 'initial-value',
          initialRule: 'nearest-zero',
          constraints: { min: { literal: 0 }, max: { literal: 10 }, step: { literal: 1 } },
        },
      },
      structure: { rule: 'none' },
      rules: [{ kind: 'numeric-range', min: 'min', max: 'max' }],
    });
    const result = compileLocal('<reading label="Read" bind-value="score" initial-value="3">', { config: config(reading) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = nodes(result.document, 'reading')[0];
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.get(node)).toBe(3);
      expect(runtime.setParameter('score', 7)).toEqual([]);
      expect(runtime.get(node)).toBe(7);
    } finally {
      runtime.dispose();
    }
    const kernel = (result.document as unknown as {
      kernel?: { bindingAttributes?: Record<string, { bind: string; initial: string }> };
    }).kernel;
    expect(kernel?.bindingAttributes?.score).toEqual({ bind: 'bind-value', initial: 'initial-value' });
  });

  it('validates date-like values from compiled runtime rules', () => {
    const day = manifest({
      name: 'day',
      form: 'leaf',
      props: {
        label: { kind: 'string' },
        min: { kind: 'string' },
        max: { kind: 'string' },
        required: { kind: 'boolean', default: false },
      },
      bindings: {
        value: { kind: 'string', family: 'date', bind: 'bind', initial: 'initial', initialRule: 'empty' },
      },
      structure: { rule: 'none' },
      rules: [{ kind: 'value-date', min: 'min', max: 'max', required: 'required' }],
    });
    const result = compileLocal('<day bind="d" label="D" min="2024-01-01" max="2024-12-31">', { config: config(day) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.setParameter('d', '2024-02-30').length).toBeGreaterThan(0);
      expect(runtime.setParameter('d', '2024-02-29')).toEqual([]);
      expect(runtime.setParameter('d', '2023-12-31').length).toBeGreaterThan(0);
    } finally {
      runtime.dispose();
    }
  });

  it('applies data-table and action-free structural primitives to clones', () => {
    const grid = manifest({
      name: 'tile-grid',
      form: 'container',
      props: { label: { kind: 'string' } },
      structure: { rule: 'components', children: ['tile'], min: 1 },
      rules: [{ kind: 'only-children', children: ['tile'], min: 1 }],
    });
    const tile = manifest({
      name: 'tile',
      form: 'container',
      props: { label: { kind: 'string' } },
      structure: { rule: 'any', parents: ['tile-grid'] },
    });
    const missing = compileLocal('<tile-grid label="G"></tile-grid>', { config: config(grid, tile) });
    expect(missing.ok).toBe(false);
    const wrong = compileLocal('<tile-grid label="G"><card title="C">x</card></tile-grid>', { config: config(grid, tile) });
    expect(wrong.ok).toBe(false);
    const valid = compileLocal('<tile-grid label="G"><tile label="T">x</tile></tile-grid>', { config: config(grid, tile) });
    expect(valid.ok).toBe(true);
  });
});

describe('collection family', () => {
  function collectionComponent(kind: 'array' | 'number-array', name: string) {
    return manifest({
      name,
      form: 'leaf',
      props: { label: { kind: 'string' }, 'max-items': { kind: 'number', integer: true, min: 0 } },
      bindings: {
        value: {
          kind, family: 'collection', bind: 'bind', initial: 'initial',
          initialRule: 'empty-array', exclusive: true,
          ...(kind === 'array' ? {} : {}),
          maxItems: { prop: 'max-items' },
        },
      },
      structure: { rule: 'none' },
    });
  }

  it('round-trips a string collection with JSON initial and defensive copies', () => {
    const basket = collectionComponent('array', 'basket');
    const result = compileLocal('<basket label="B" bind="items" initial=\'["a","b"]\'>', { config: config(basket) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = nodes(result.document, 'basket')[0];
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.getParameter('items')).toEqual(['a', 'b']);
      const input = ['b', 'a'];
      expect(runtime.setParameter('items', input)).toEqual([]);
      input.push('c');
      expect(runtime.getParameter('items')).toEqual(['b', 'a']);
      const read = runtime.getParameter('items') as string[];
      read.push('d');
      expect(runtime.getParameter('items')).toEqual(['b', 'a']);
      expect(runtime.setParameter('items', ['a', 1] as never).length).toBeGreaterThan(0);
      runtime.reset(node);
      expect(runtime.getParameter('items')).toEqual(['a', 'b']);
    } finally {
      runtime.dispose();
    }
  });

  it('accepts finite number[] and rejects invalid members and budgets', () => {
    const points = collectionComponent('number-array', 'points');
    const result = compileLocal('<points label="P" bind="p" initial="[1,2.5]">', { config: config(points) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.getParameter('p')).toEqual([1, 2.5]);
      expect(runtime.setParameter('p', [3, 4.5])).toEqual([]);
      expect(runtime.setParameter('p', [1, Number.NaN] as never).length).toBeGreaterThan(0);
      expect(runtime.setParameter('p', [1, Number.POSITIVE_INFINITY] as never).length).toBeGreaterThan(0);
      const oversized = Array.from({ length: 10_001 }, (_, index) => index);
      expect(runtime.setParameter('p', oversized).length).toBeGreaterThan(0);
    } finally {
      runtime.dispose();
    }
  });

  it('enforces maxItems for collections', () => {
    const basket = collectionComponent('array', 'basket');
    const result = compileLocal('<basket label="B" bind="items" max-items="1">', { config: config(basket) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runtime = createLocalRuntime(result.document);
    try {
      expect(runtime.setParameter('items', ['a', 'b']).length).toBeGreaterThan(0);
      expect(runtime.setParameter('items', ['a'])).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('accepts a JSON initial literal and rejects a malformed one', () => {
    const points = collectionComponent('number-array', 'points');
    const ok = compileLocal('<points label="P" bind="p" initial="[1,2]">', { config: config(points) });
    expect(ok.ok).toBe(true);
    const bad = compileLocal('<points label="P" bind="p" initial="1,2">', { config: config(points) });
    expect(bad.ok).toBe(false);
  });
});

describe('external structural aliases', () => {
  it('lets an external multi-select alias accept standard option children', () => {
    const picker = manifest({
      name: 'basket-picker',
      form: 'container',
      props: { label: { kind: 'string' } },
      bindings: {
        value: {
          kind: 'array', family: 'multi-select', bind: 'bind', initial: 'initial',
          initialRule: 'empty-array', exclusive: true,
        },
      },
      structure: {
        rule: 'options', child: 'option', children: ['option'], min: 1,
        valueAttribute: 'value', forbidSeparator: ',',
      },
      rules: [{ kind: 'options-body', child: 'option', valueAttribute: 'value', unique: true, forbidSeparator: ',' }],
    });
    const valid = compileLocal(
      '<basket-picker label="B" bind="b"><option value="a">A</option><option value="b">B</option></basket-picker>',
      { config: config(picker) },
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const runtime = createLocalRuntime(valid.document);
    try {
      expect(runtime.setParameter('b', ['b'])).toEqual([]);
      expect(runtime.setParameter('b', ['a', 'b'])).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
});

describe('kernel schema conversion', () => {
  it('synthesizes implicit binding attributes for the compiler', () => {
    const schema = kernelSchemaFor(
      {
        name: 'probe',
        form: 'leaf',
        props: { label: { kind: 'string' } },
        bindings: {
          value: {
            kind: 'number', family: 'number', bind: 'bind-x', initial: 'initial-x',
            initialRule: 'min', constraints: { min: { literal: 0 } },
          },
        },
      },
      {
        rules: [{ kind: 'value-required', required: 'required' } satisfies KernelRule],
        structure: { rule: 'none' },
      },
    );
    expect(schema.props['bind-x']?.kind).toBe('string');
    expect(schema.props['initial-x']?.kind).toBe('number');
    expect(schema.props.disabled?.kind).toBe('boolean');
    expect(schema.rules?.[0]?.kind).toBe('value-required');
  });
});
