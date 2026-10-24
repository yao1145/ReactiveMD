import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/local';
import type { LocalDocument, LocalNode } from '../src/local/types';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  }
  return result.document;
}

function codes(source: string): string[] {
  return compileLocal(source).diagnostics.map((diagnostic) => diagnostic.code);
}

function all(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? [])]);
}

function find(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = all(document.nodes).filter((node) => node.type === 'component' && node.name === name);
  if (!matches[index]) throw new Error(`Missing <${name}> #${index}`);
  return matches[index];
}

function numeric(label: string, bind: string, initial: number): string {
  return `<number bind="${bind}" label="${label}" initial="${initial}" min="0" max="100">`;
}

describe('cross-field validation rules', () => {
  it('publishes serializable metadata and keeps the tag in the render tree', () => {
    const document = compile([
      numeric('Start', 'start', 5),
      numeric('End', 'end', 3),
      '<validation when="{{ end > start }}" message="End must follow start" fields="start end">',
    ].join('\n'));
    expect(document.validations).toHaveLength(1);
    const node = find(document, 'validation');
    expect(document.validations?.[0]).toMatchObject({
      nodeId: node.id,
      expression: 'end > start',
      dependencies: ['end', 'start'],
      message: 'End must follow start',
      fields: ['start', 'end'],
      range: node.range,
    });
    expect(() => structuredClone(document)).not.toThrow();
    // Unlike <computed>, a validation tag stays visible to the renderer.
    expect(all(document.nodes).some((item) => item.name === 'validation')).toBe(true);
  });

  it('omits validations metadata when no rule is declared', () => {
    const document = compile(numeric('Only', 'only', 1));
    expect(document.validations).toBeUndefined();
  });

  it('validates when shape, field names, dependencies and the declaration budget', () => {
    expect(codes(`<validation when="true" message="m" fields="n">${numeric('N', 'n', 1)}`))
      .toContain('local.validation.when');
    expect(codes(`${numeric('N', 'n', 1)}<validation when="{{ n + 1 }}" message="m" fields="n">`))
      .toContain('local.type');
    expect(codes(`${numeric('N', 'n', 1)}<validation when="{{ missing > 0 }}" message="m" fields="n">`))
      .toContain('local.binding.unknown');
    expect(codes(`${numeric('N', 'n', 1)}<validation when="{{ n > 0 }}" message="m" fields="">`))
      .toContain('local.validation.fields');
    expect(codes(`${numeric('N', 'n', 1)}<validation when="{{ n > 0 }}" message="m" fields="n n">`))
      .toContain('local.validation.fields');
    expect(codes(`${numeric('N', 'n', 1)}<validation when="{{ n > 0 }}" message="m" fields="unknown">`))
      .toContain('local.validation.fields');
    expect(codes(['<computed name="readOnly" value="{{ 1 }}">', numeric('N', 'n', 1),
      '<validation when="{{ n > 0 }}" message="m" fields="readOnly">'].join('\n')))
      .toContain('local.validation.fields');
  });

  it('rejects rules inside inline content', () => {
    const source = `${numeric('N', 'n', 1)}\n<badge>text <validation when="{{ n > 0 }}" message="m" fields="n"></badge>`;
    expect(codes(source)).toContain('local.validation.placement');
  });

  it('allows exactly 100 rules and rejects the 101st, including hidden rules', () => {
    const rule = '<validation when="{{ n > 0 }}" message="m" fields="n">';
    const document = compile([numeric('N', 'n', 0), ...Array.from({ length: 100 }, () => rule)].join('\n'));
    expect(document.validations).toHaveLength(100);
    const tooMany = codes([numeric('N', 'n', 0), ...Array.from({ length: 101 }, () => rule)].join('\n'));
    expect(tooMany).toContain('local.validation.budget');

    const hidden = codes([
      numeric('N', 'n', 0),
      '<if when="{{ n > 5 }}">',
      ...Array.from({ length: 101 }, () => rule),
      '</if>',
    ].join('\n'));
    expect(hidden).toContain('local.validation.budget');
  });

  it('returns advisory failures without blocking writes and refreshes with the revision', () => {
    const document = compile([
      numeric('Start', 'start', 5),
      numeric('End', 'end', 3),
      '<validation when="{{ end > start }}" message="End must follow start ({{ start }}-{{ end }})" fields="start end">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const end = find(document, 'number', 1);
      const start = find(document, 'number', 0);
      const failures = runtime.validate();
      expect(failures).toHaveLength(1);
      expect(failures[0].code).toBe('local.validation.failed');
      expect(failures[0].message).toBe('End must follow start (5-3)');
      expect(failures[0].range).toEqual(find(document, 'validation').range);
      expect(failures[0].severity).toBe('error');

      // Cross-field failures are advisory: the invalid value stays editable.
      expect(runtime.set(end, 6)).toEqual([]);
      expect(runtime.validate()).toEqual([]);
      // Writing an unrelated value keeps the revision cache coherent.
      expect(runtime.set(start, 1)).toEqual([]);
      expect(runtime.validate()).toEqual([]);
      expect(runtime.set(end, 0)).toEqual([]);
      expect(runtime.validate()).toHaveLength(1);
    } finally {
      runtime.dispose();
    }
  });

  it('caches by revision and returns cloned diagnostics', () => {
    const document = compile([
      numeric('N', 'n', 0),
      '<validation when="{{ n > 0 }}" message="Positive" fields="n">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const first = runtime.validate();
      const second = runtime.validate();
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(second[0]).not.toBe(first[0]);
      expect(second[0].range).not.toBe(first[0].range);
      first[0].message = 'mutated';
      first[0].range.start = 0;
      expect(runtime.validate()[0].message).toBe('Positive');
      expect(runtime.set(find(document, 'number'), 1)).toEqual([]);
      expect(runtime.validate()).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('isolates expression failures, non-boolean results and a failing message template', () => {
    const document = compile([
      '<computed name="bad" value="{{ 1 / zero }}">',
      '<computed name="maybe" value="{{ budget > 0 ? true : null }}">',
      numeric('Zero', 'zero', 0),
      numeric('Budget', 'budget', 0),
      '<validation when="{{ 1 / zero > 0 }}" message="Zero {{ bad }}" fields="zero">',
      '<validation when="{{ budget > 0 }}" message="Budget {{ bad }}" fields="budget">',
      '<validation when="{{ maybe }}" message="Maybe" fields="budget">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const failures = runtime.validate();
      expect(failures.map((diagnostic) => diagnostic.code)).toEqual([
        'local.validation.expression',
        'local.validation.failed',
        'local.validation.expression',
      ]);
      // The message reads the same failing computed value, so a safe default
      // replaces the raw template instead of leaking an error.
      expect(failures[1].message).toBe('Validation failed.');
      expect(runtime.set(find(document, 'number', 0), 2)).toEqual([]);
      const after = runtime.validate();
      expect(after.map((diagnostic) => diagnostic.code)).toEqual([
        'local.validation.failed',
        'local.validation.expression',
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it('evaluates computed values before constraints and tracks reset/setMany commits', () => {
    const document = compile([
      '<computed name="double" value="{{ base * 2 }}">',
      numeric('Base', 'base', 2),
      '<range-slider bind-start="a" bind-end="b" label="Range" initial-start="0" initial-end="10">',
      '<validation when="{{ double <= 10 }}" message="Double {{ double }} is too large" fields="base a b">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      expect(runtime.validate().map((diagnostic) => diagnostic.message)).toEqual([]);
      expect(runtime.set(find(document, 'number'), 6)).toEqual([]);
      expect(runtime.validate()[0].message).toBe('Double 12 is too large');
      const slider = find(document, 'range-slider');
      expect(runtime.setMany(slider, { start: 1, end: 9 })).toEqual([]);
      expect(runtime.validate()).toHaveLength(1);
      runtime.reset(find(document, 'number'));
      expect(runtime.validate()).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it('ignores malformed forged metadata and re-evaluates edited expressions', () => {
    const document = compile([
      numeric('N', 'n', 0),
      '<validation when="{{ n > 0 }}" message="Positive" fields="n">',
    ].join('\n'));
    document.validations?.push(null as never, { expression: 3 } as never);
    if (document.validations?.[0]) document.validations[0].expression = '1 / n > 0';
    const runtime = createLocalRuntime(document);
    try {
      const failures = runtime.validate();
      expect(failures).toHaveLength(1);
      expect(failures[0].code).toBe('local.validation.expression');
    } finally {
      runtime.dispose();
    }
  });
});
