import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { compileExpression, expressionValue, interpolate } from '../src/local/expression';
import { createLocalRuntime } from '../src/local/runtime';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_STRING_LENGTH,
  MAX_LOCAL_VALUE_CHARACTERS,
} from '../src/local/limits';
import type { LocalDocument, LocalNode } from '../src/local/types';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
  }
  return result.document;
}

function flatten(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function find(document: LocalDocument, name: string, index = 0): LocalNode {
  const matches = flatten(document.nodes).filter(
    (node) => node.type === 'component' && node.name === name,
  );
  if (!matches[index]) throw new Error(`找不到第 ${index} 个 <${name}>`);
  return matches[index];
}

const HALF_VALUE_BUDGET = MAX_LOCAL_VALUE_CHARACTERS / 2;

describe('expression value budgets', () => {
  it('accepts strings and arrays exactly at the individual and cumulative boundaries', () => {
    const exact = 'a'.repeat(MAX_LOCAL_STRING_LENGTH);
    expect(compileExpression('len(s)').evaluate({ s: exact })).toBe(MAX_LOCAL_STRING_LENGTH);

    const empty = Array.from({ length: MAX_LOCAL_ARRAY_LENGTH }, () => '');
    expect(compileExpression('len(items)').evaluate({ items: empty })).toBe(MAX_LOCAL_ARRAY_LENGTH);

    const half = 'a'.repeat(HALF_VALUE_BUDGET);
    expect(compileExpression('len(items)').evaluate({ items: [half, half] })).toBe(2);
  });

  it('rejects over-budget environment values before evaluation', () => {
    expect(() =>
      compileExpression('len(s)').evaluate({ s: 'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1) }),
    ).toThrow();

    const tooMany = Array.from({ length: MAX_LOCAL_ARRAY_LENGTH + 1 }, () => '');
    expect(() => compileExpression('len(items)').evaluate({ items: tooMany })).toThrow();

    expect(() =>
      compileExpression('len(items)').evaluate({
        items: ['a'.repeat(MAX_LOCAL_STRING_LENGTH + 1)],
      }),
    ).toThrow();

    const over = 'a'.repeat(HALF_VALUE_BUDGET + 1);
    expect(() => compileExpression('len(items)').evaluate({ items: [over, over] })).toThrow();
  });

  it('keeps code-point length semantics for len', () => {
    expect(compileExpression('len(s)').evaluate({ s: '😀' })).toBe(1);
  });

  it('does not let plain templates bypass the template cap', () => {
    const huge = 'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1);
    expect(() => interpolate(huge, {})).toThrow();
    expect(() => expressionValue(huge, {})).toThrow();
    expect(interpolate('plain', {})).toBe('plain');
  });
});

describe('runtime value budgets', () => {
  it('rejects over-budget initial state for strings and arrays', () => {
    const text = compile('<input bind="s" label="x">');
    text.bindings.s.initial = 'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1);
    expect(() => createLocalRuntime(text)).toThrow();

    const list = compile('<checklist bind="items" label="list">\n- [ ] one\n</checklist>');
    list.bindings.items.initial = Array.from({ length: MAX_LOCAL_ARRAY_LENGTH + 1 }, () => '');
    expect(() => createLocalRuntime(list)).toThrow();
  });

  it('rejects over-budget writes atomically', () => {
    const document = compile('<input bind="s" label="x">\n<checklist bind="items" label="list">\n- [ ] one\n</checklist>');
    const runtime = createLocalRuntime(document);
    const input = find(document, 'input');
    const checklist = find(document, 'checklist');
    const before = runtime.snapshot();

    expect(runtime.set(input, 'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1))[0]?.code).toBe(
      'local.runtime.value',
    );
    expect(runtime.snapshot()).toBe(before);
    expect(runtime.get(input)).toBe('');

    expect(
      runtime.set(
        checklist,
        Array.from({ length: MAX_LOCAL_ARRAY_LENGTH + 1 }, (_, index) => `item-${index}`),
      )[0]?.code,
    ).toBe('local.runtime.value');
    expect(runtime.snapshot()).toBe(before);
    expect(runtime.get(checklist)).toEqual([]);
    runtime.dispose();
  });

  it('rejects over-budget reset values without changing state', () => {
    const document = compile('<input bind="s" label="x">');
    const runtime = createLocalRuntime(document);
    const input = find(document, 'input');
    expect(runtime.set(input, 'ok')).toEqual([]);
    const afterWrite = runtime.snapshot();

    document.bindings.s.initial = 'a'.repeat(MAX_LOCAL_STRING_LENGTH + 1);
    expect(() => runtime.reset(input)).toThrow();
    expect(runtime.get(input)).toBe('ok');
    expect(runtime.snapshot()).toBe(afterWrite);
    runtime.dispose();
  });
});

describe('runtime control constraints', () => {
  it('rejects pathological email candidates with the shared linear validator', () => {
    const document = compile('<input bind="mail" label="邮箱" type="email">');
    const runtime = createLocalRuntime(document);
    const input = find(document, 'input');

    const diagnostics = runtime.set(input, 'a@' + '.'.repeat(32000) + '@');
    expect(diagnostics[0]?.code).toBe('local.runtime.value');
    expect(runtime.get(input)).toBe('');
    expect(runtime.set(input, 'a@b.co')).toEqual([]);
    runtime.dispose();
  });

  it('enforces every shared writer constraint, not only the supplied node', () => {
    const document = compile(
      '<input bind="s" label="strict" max-length="3">\n<input bind="s" label="relaxed">',
    );
    const runtime = createLocalRuntime(document);
    const strict = find(document, 'input', 0);
    const relaxed = find(document, 'input', 1);
    const before = runtime.snapshot();

    expect(runtime.set(relaxed, 'longvalue')[0]?.code).toBe('local.runtime.value');
    expect(runtime.snapshot()).toBe(before);
    expect(runtime.get(strict)).toBe('');

    expect(runtime.set(strict, 'abc')).toEqual([]);
    expect(runtime.get(relaxed)).toBe('abc');
    runtime.dispose();
  });

  it('applies required and email rules from every shared control', () => {
    const document = compile(
      '<input bind="s" label="strict" required="true">\n<input bind="s" label="relaxed" type="email">',
    );
    const runtime = createLocalRuntime(document);
    const relaxed = find(document, 'input', 1);

    expect(runtime.set(relaxed, '')[0]?.code).toBe('local.runtime.value');
    expect(runtime.set(relaxed, 'not-an-email')[0]?.code).toBe('local.runtime.value');
    expect(runtime.set(relaxed, 'a@b.co')).toEqual([]);
    runtime.dispose();
  });

  it('ignores forged caller-supplied binding metadata for reads and writes', () => {
    const document = compile(
      '<input bind="secret" label="secret">\n<input bind="other" label="other">',
    );
    const runtime = createLocalRuntime(document);
    const secret = find(document, 'input', 0);
    const other = find(document, 'input', 1);
    expect(runtime.set(secret, 'value')).toEqual([]);

    const forged: LocalNode = {
      ...other,
      attrs: { ...(other.attrs ?? {}), bind: 'secret' },
    };
    expect(runtime.get(forged)).toBe('');
    expect(runtime.set(forged, 'x')).toEqual([]);
    expect(runtime.get(secret)).toBe('value');
    expect(runtime.get(other)).toBe('x');
    runtime.dispose();
  });

  it('does not let a forged relaxed node loosen a shared max-length', () => {
    const document = compile(
      '<input bind="s" label="strict" max-length="3">\n<input bind="s" label="relaxed">',
    );
    const runtime = createLocalRuntime(document);
    const strict = find(document, 'input', 0);
    const relaxed = find(document, 'input', 1);
    expect(runtime.set(strict, 'abc')).toEqual([]);

    const forged: LocalNode = {
      ...relaxed,
      attrs: { ...(relaxed.attrs ?? {}), 'max-length': '100' },
    };
    expect(runtime.set(forged, 'longvalue')[0]?.code).toBe('local.runtime.value');
    expect(runtime.get(strict)).toBe('abc');
    runtime.dispose();
  });
});

describe('runtime value ownership', () => {
  it('returns isolated checklist arrays from evaluate, get and snapshots', () => {
    const document = compile(
      '<checklist bind="items" label="list">\n- [ ] one\n- [ ] two\n</checklist>',
    );
    const runtime = createLocalRuntime(document);
    const checklist = find(document, 'checklist');
    expect(runtime.set(checklist, ['item-1'])).toEqual([]);

    const evaluated = runtime.evaluate('items') as string[];
    evaluated.push('forged');
    expect(runtime.evaluate('items')).toEqual(['item-1']);

    const fetched = runtime.get(checklist) as string[];
    fetched.splice(0, fetched.length, 'forged');
    expect(runtime.get(checklist)).toEqual(['item-1']);

    const snapshot = runtime.snapshot();
    const exposed = snapshot.state.items as string[];
    try {
      exposed.push('forged');
    } catch {
      // A frozen array is also safe.
    }
    expect(snapshot.state.items).toEqual(['item-1']);
    expect(runtime.snapshot().state.items).toEqual(['item-1']);

    expect(runtime.set(checklist, ['forged'])[0]?.code).toBe('local.runtime.value');
    runtime.dispose();
  });

  it('does not alias runtime state to document initial values', () => {
    const document = compile(
      '<checklist bind="items" label="list">\n- [x] one\n- [ ] two\n</checklist>',
    );
    const runtime = createLocalRuntime(document);
    const checklist = find(document, 'checklist');
    expect(runtime.get(checklist)).toEqual(['item-1']);

    (document.bindings.items.initial as string[]).push('forged');
    expect(runtime.get(checklist)).toEqual(['item-1']);
    expect(runtime.snapshot().state.items).toEqual(['item-1']);
    runtime.dispose();
  });

  it('ignores reset requests for unregistered forged nodes', () => {
    const document = compile('<input bind="s" label="x">');
    const runtime = createLocalRuntime(document);
    const input = find(document, 'input');
    expect(runtime.set(input, 'changed')).toEqual([]);

    const forged: LocalNode = { ...input, id: 'not-registered', children: [input] };
    runtime.reset(forged);
    expect(runtime.get(input)).toBe('changed');
    runtime.dispose();
  });

  it('keeps evaluating after the runtime expression cache evicts old entries', () => {
    const document = compile('<slider bind="n" label="n" initial="1" min="0" max="1000">');
    const runtime = createLocalRuntime(document);
    for (let index = 0; index < 300; index += 1) {
      expect(runtime.evaluate(`n + ${index}`)).toBe(1 + index);
    }
    expect(runtime.evaluate('n + 299')).toBe(300);
    runtime.dispose();
  });
});
