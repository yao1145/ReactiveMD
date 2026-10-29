import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, type LocalDocument, type LocalHostComponentSchema, type LocalNode } from '../src/local';

const RATING: LocalHostComponentSchema = {
  name: 'host-rating',
  form: 'leaf',
  props: { label: { kind: 'string' } },
  binding: { kind: 'number', min: 0, max: 5, step: 1 },
};

function compile(source: string, hostComponents: readonly LocalHostComponentSchema[] = [RATING]): LocalDocument {
  const result = compileLocal(source, { hostComponents });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
  }
  return result.document;
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function host(document: LocalDocument, index = 0): LocalNode {
  const found = all(document.nodes).filter((node) => node.type === 'hostComponent')[index];
  if (!found) throw new Error('Missing host component');
  return found;
}

const SHARED = [
  '<host-rating bind="rating" label="Course rating" initial="4">',
  '<number bind="rating" label="Numeric rating" min="0" max="5" step="1">',
  '',
  'Rating: {{ rating }}',
].join('\n');

describe('host component bindings', () => {
  it.each([
    ['min-length="3"', 'a', 'local.initial.length'],
    ['max-length="2"', 'abc', 'local.initial.length'],
    ['type="email"', 'invalid', 'local.initial.email'],
  ])('validates a host initial against shared input %s', (constraint, initial, code) => {
    const result = compileLocal([
      `<input bind="value" label="Value" ${constraint}>`,
      `<host-text bind="value" initial="${initial}">`,
    ].join('\n'), { hostComponents: [{ name: 'host-text', form: 'leaf', props: {}, binding: { kind: 'string' } }] });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
  });

  it('accepts a host initial satisfying every shared text control', () => {
    const document = compile([
      '<input bind="value" label="Value" min-length="3">',
      '<textarea bind="value" label="Text" max-length="5">',
      '<host-text bind="value" initial="abcd">',
    ].join('\n'), [{ name: 'host-text', form: 'leaf', props: {}, binding: { kind: 'string' } }]);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.getParameter('value')).toBe('abcd');
      expect(runtime.setParameters(runtime.getParameters())).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps matching choice bindings and defaults valid', () => {
    const document = compile('<select bind="value" label="Choice"><option value="a">A</option><option value="b">B</option></select>\n<host-choice bind="value">', [
      { name: 'host-choice', form: 'leaf', props: {}, binding: { kind: 'string', options: ['a', 'b'], initialRule: 'first-option' } },
    ]);
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.getParameter('value')).toBe('a');
      expect(runtime.setParameters(runtime.getParameters())).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('requires host and built-in numeric owners to agree on dynamic bounds', () => {
    const result = compileLocal('<number bind="limit" label="Limit" initial="5">\n<number bind="n" label="N" max="{{ limit }}">\n<host-number bind="n">', {
      hostComponents: [{ name: 'host-number', form: 'leaf', props: {}, binding: { kind: 'number' } }],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('local.binding.constraint');
  });

  it.each([false, true])('rejects sharing an exclusive host in either order (reverse=%s)', (reverse) => {
    const tags = ['<host-one bind="n">', '<host-two bind="n">'];
    const result = compileLocal((reverse ? tags.reverse() : tags).join('\n'), {
      hostComponents: [
        { name: 'host-one', form: 'leaf', props: {}, binding: { kind: 'number', exclusive: true } },
        { name: 'host-two', form: 'leaf', props: {}, binding: { kind: 'number' } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('local.binding.exclusive');
  });

  it('preserves built-in exclusive bindings when adding a host owner', () => {
    const result = compileLocal('<timer bind="n" label="Timer" duration="60">\n<host-number bind="n">', {
      hostComponents: [{ name: 'host-number', form: 'leaf', props: {}, binding: { kind: 'number', min: 0, max: 60 } }],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('local.binding.exclusive');
  });

  it('preserves the exclusive ownership of built-in slots', () => {
    const result = compileLocal('<range-slider bind-start="n" label="Range">\n<host-number bind="n">', {
      hostComponents: [{ name: 'host-number', form: 'leaf', props: {}, binding: { kind: 'number', min: 0, max: 100 } }],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('local.binding.exclusive');
  });

  it.each(['<date bind="value" label="Date">', '<select bind="value" label="Choice"><option value="a">A</option></select>'])(
    'rejects a host text binding sharing an incompatible family: %s', (builtin) => {
      const result = compileLocal(`${builtin}\n<host-text bind="value" initial="invalid">`, {
        hostComponents: [{ name: 'host-text', form: 'leaf', props: {}, binding: { kind: 'string' } }],
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((item) => item.code)).toContain('local.binding.type');
    },
  );

  it.each([
    { kind: 'string', initialRule: 'false' },
    { kind: 'string', initialRule: 'min' },
    { kind: 'string', initialRule: 'nearest-zero' },
    { kind: 'string', initialRule: 'first-option' },
    { kind: 'string', options: ['a', 'b'], initialRule: 'empty' },
    { kind: 'string', options: ['a', 'b'], initialRule: 'false' },
  ])('rejects incompatible string initial rules: %j', (binding) => {
    const result = compileLocal('<host-text bind="value">', {
      hostComponents: [{ name: 'host-text', form: 'leaf', props: {}, binding } as LocalHostComponentSchema],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('local.options.invalid');
  });

  it('shares a scalar binding with a built-in control', () => {
    const document = compile(SHARED);
    const binding = document.bindings.rating;
    expect(binding).toMatchObject({ type: 'number', initial: 4, min: 0, max: 5, step: 1 });
    expect(binding.nodeIds).toHaveLength(2);
    const runtime = createLocalRuntime(document);
    try {
      const [rating, numeric] = [host(document), all(document.nodes).find((node) => node.name === 'number')!];
      expect(runtime.get(rating)).toBe(4);
      expect(runtime.set(rating, 5)).toEqual([]);
      expect(runtime.get(numeric)).toBe(5);
      expect(runtime.evaluate('rating * 2')).toBe(10);
      expect(runtime.getParameters()).toEqual({ rating: 5 });
      expect(runtime.set(numeric, 3)).toEqual([]);
      expect(runtime.get(rating)).toBe(3);
      expect(runtime.set(rating, 6).map((item) => item.code)).toEqual(['local.runtime.value']);
      expect(runtime.get(rating)).toBe(3);
      runtime.reset(rating);
      expect(runtime.get(rating)).toBe(4);
    } finally {
      runtime.dispose();
    }
  });

  it('rejects mismatched constraints and families', () => {
    const mismatch = compileLocal('<host-rating bind="rating">\n<number bind="rating" label="N" min="0" max="6">', {
      hostComponents: [RATING],
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.diagnostics.map((item) => item.code)).toContain('local.binding.constraint');

    const family = compileLocal('<host-rating bind="rating">\n<input bind="rating" label="I">', {
      hostComponents: [RATING],
    });
    expect(family.ok).toBe(false);
    expect(family.diagnostics.map((item) => item.code)).toContain('local.binding.type');
  });

  it('validates static initial values and duplicate initials', () => {
    const outOfRange = compileLocal('<host-rating bind="rating" initial="7">', { hostComponents: [RATING] });
    expect(outOfRange.ok).toBe(false);
    expect(outOfRange.diagnostics.map((item) => item.code)).toContain('local.initial.range');

    const duplicate = compileLocal('<host-rating bind="rating" initial="3">\n<number bind="rating" label="N" initial="2" min="0" max="5">', {
      hostComponents: [RATING],
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.diagnostics.map((item) => item.code)).toContain('local.initial.duplicate');
  });

  it('keeps host state internal without a bind attribute', () => {
    const document = compile('<host-rating label="Internal" initial="2">');
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.parameterNames()).toEqual([]);
      const rating = host(document);
      expect(runtime.set(rating, 3)).toEqual([]);
      expect(runtime.get(rating)).toBe(3);
      expect(runtime.getParameters()).toEqual({});
    } finally {
      runtime.dispose();
    }
  });

  it('supports inline and container forms with normal Markdown children', () => {
    const schema: LocalHostComponentSchema[] = [
      { name: 'host-mark', form: 'inline', props: {} },
      { name: 'host-box', form: 'container', props: {} },
    ];
    const document = compile([
      'Text <host-mark>inside</host-mark> continues.',
      '',
      '<host-box>',
      '## Nested heading',
      '',
      '<number bind="n" label="N" initial="2">',
      '</host-box>',
      '',
      '{{ n }}',
    ].join('\n'), schema);
    const marks = all(document.nodes).filter((node) => node.type === 'hostComponent');
    expect(marks.map((item) => item.name)).toEqual(['host-mark', 'host-box']);
    expect(marks[0].children?.[0]?.type).toBe('text');
    expect(marks[1].children?.some((child) => child.type === 'heading')).toBe(true);
    expect(document.bindings.n).toBeDefined();
  });

  it('reports leaf body content and keeps worker-safe plain data', () => {
    const bad = compileLocal('<host-rating>body</host-rating>', { hostComponents: [RATING] });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.map((item) => item.code)).toContain('local.host.structure');

    const document = compile(SHARED);
    expect(() => structuredClone(document)).not.toThrow();
  });

  it('validates host schema forms and bindings', () => {
    const invalid = (schema: unknown): string[] => {
      const result = compileLocal('x', { hostComponents: [schema as LocalHostComponentSchema] });
      return result.diagnostics.map((item) => item.code);
    };
    expect(invalid({ name: 'host-x', form: 'block', props: {} })).toContain('local.options.invalid');
    expect(invalid({ name: 'host-x', form: 'leaf', props: {}, binding: { kind: 'object' } })).toContain('local.options.invalid');
    expect(invalid({ name: 'host-x', form: 'leaf', props: {}, binding: { kind: 'number', min: 5, max: 1 } })).toContain('local.options.invalid');
    expect(invalid({ name: 'host-x', form: 'leaf', props: { bind: { kind: 'string' } }, binding: { kind: 'number' } })).toContain('local.options.invalid');
  });
});
