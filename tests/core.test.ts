import { describe, expect, it } from 'vitest';
import { compile, createRuntime } from '../src/core';
import type { CompiledDocument, DocumentNode } from '../src/core/types';
import counter from '../examples/counter.reactive.md?raw';
import pricing from '../examples/pricing.reactive.md?raw';

function source(config: string, body = '') {
  return '```reactive-md\nversion: "0.1"\n' + config + '\n```\n\n' + body;
}
function valid(input: string): CompiledDocument {
  const result = compile(input);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}
function runtime(input: string) { return createRuntime(valid(input)); }
function flatten(nodes: DocumentNode[]): DocumentNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}
function binding(doc: CompiledDocument, name: string) {
  const node = flatten(doc.nodes).find(node => node.binding === name);
  if (!node) throw new Error('Missing binding: ' + name);
  return node.id;
}
function invalid(input: string) {
  const result = compile(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected invalid document');
  expect(result.diagnostics.length).toBeGreaterThan(0);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.line).toBeGreaterThan(0);
    expect(diagnostic.column).toBeGreaterThan(0);
    expect(diagnostic.range.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic.range.end).toBeLessThanOrEqual(input.length);
  }
}

describe('design examples', () => {
  it('increments three times, resets, and isolates document instances', () => {
    const a = runtime(counter);
    const b = runtime(counter);
    for (let i = 0; i < 3; i++) expect(a.dispatch('increment').ok).toBe(true);
    expect(a.snapshot().state.count).toBe(3);
    expect(b.snapshot().state.count).toBe(0);
    expect(a.dispatch('reset').ok).toBe(true);
    expect(a.snapshot().state.count).toBe(0);
  });
  it('reacts to annual billing and five seats, then restores defaults', () => {
    const doc = valid(pricing);
    const rt = createRuntime(doc);
    expect(rt.snapshot().computed.total).toBe(200);
    expect(rt.writeBinding(binding(doc, 'annual'), true).ok).toBe(true);
    expect(rt.snapshot().computed.total).toBe(160);
    expect(rt.writeBinding(binding(doc, 'seats'), 5).ok).toBe(true);
    expect(rt.snapshot().computed.total).toBe(400);
    expect(rt.evaluate({ kind: 'expression', expression: 'seats >= 5' })).toBe(true);
    expect(rt.dispatch('restore').ok).toBe(true);
    expect(rt.snapshot().computed.total).toBe(200);
    expect(rt.snapshot().state).toEqual({ seats: 2, annual: false });
  });
});

describe('transaction semantics', () => {
  const swap = source('state:\n  a: 1\n  b: 2\ncomputed:\n  total: "=a + b"\nactions:\n  swap:\n    - set: a\n      value: "=b"\n    - set: b\n      value: "=a"');
  it('evaluates every action value against one old snapshot and notifies once', () => {
    const rt = runtime(swap);
    const observations: unknown[] = [];
    rt.subscribe(['*'], () => observations.push(rt.snapshot()));
    expect(rt.dispatch('swap').ok).toBe(true);
    expect(rt.snapshot().state).toEqual({ a: 2, b: 1 });
    expect(rt.snapshot().computed.total).toBe(3);
    expect(observations).toHaveLength(1);
    expect(rt.snapshot().revision).toBe(1);
  });
  it('rolls back every write when a dependent computation fails', () => {
    const rt = runtime(source('state:\n  count: 1\n  denominator: 1\ncomputed:\n  quotient: "=count / denominator"\nactions:\n  fail:\n    - set: count\n      value: 99\n    - set: denominator\n      value: 0'));
    const before = rt.snapshot();
    expect(rt.dispatch('fail').ok).toBe(false);
    expect(rt.snapshot()).toBe(before);
    expect(rt.snapshot().computed.quotient).toBe(1);
  });
  it('keeps snapshot identity and revision on an unchanged update', () => {
    const rt = runtime(counter);
    const before = rt.snapshot();
    rt.dispatch('reset');
    expect(rt.snapshot()).toBe(before);
  });
  it('does not notify unrelated subscribers, and unregisters subscriptions', () => {
    const rt = runtime(source('state:\n  a: 0\n  b: 0\nactions:\n  inc:\n    - set: a\n      value: "=a + 1"'));
    let calls = 0;
    let unrelated = 0;
    const off = rt.subscribe(['a'], () => calls++);
    rt.subscribe(['b'], () => unrelated++);
    rt.dispatch('inc');
    off();
    rt.dispatch('inc');
    expect(calls).toBe(1);
    expect(unrelated).toBe(0);
  });
  it('does not expose mutable snapshot state', () => {
    const rt = runtime(counter);
    try { (rt.snapshot().state as Record<string, unknown>).count = 77; } catch { /* frozen is valid */ }
    expect(rt.snapshot().state.count).toBe(0);
  });
  it('rejects unknown actions and operations after disposal', () => {
    const rt = runtime(counter);
    expect(rt.dispatch('missing').ok).toBe(false);
    rt.dispose();
    expect(() => rt.dispatch('increment')).toThrow(/disposed/);
  });
});

describe('binding constraints', () => {
  it('rejects out-of-range and wrong-type writes without modifying state', () => {
    const doc = valid(pricing);
    const rt = createRuntime(doc);
    const id = binding(doc, 'seats');
    for (const value of [0, 21, 1.5, '5']) {
      expect(rt.writeBinding(id, value).ok).toBe(false);
      expect(rt.snapshot().state.seats).toBe(2);
    }
    expect(rt.writeBinding('missing', 1).ok).toBe(false);
  });
  it('accepts decimal steps within floating point tolerance', () => {
    const doc = valid(source('state:\n  x: 0.1', '::number{bind="x" label="X" min="0.1" max="1" step="0.1"}'));
    const rt = createRuntime(doc);
    expect(rt.writeBinding(binding(doc, 'x'), 0.3).ok).toBe(true);
  });
  it('applies constraints of hidden bound controls to action writes', () => {
    const rt = runtime(source('state:\n  x: 1\nactions:\n  invalid:\n    - set: x\n      value: 12', ':::if{when="=false"}\n::number{bind="x" label="X" min="0" max="10"}\n:::'));
    expect(rt.dispatch('invalid').ok).toBe(false);
    expect(rt.snapshot().state.x).toBe(1);
  });
  it('validates select values', () => {
    const doc = valid(source('state:\n  plan: basic', ':::select{bind="plan" label="方案"}\n::option[基础]{value="basic"}\n::option[专业]{value="pro"}\n:::'));
    const rt = createRuntime(doc);
    expect(rt.writeBinding(binding(doc, 'plan'), 'pro').ok).toBe(true);
    expect(rt.writeBinding(binding(doc, 'plan'), 'other').ok).toBe(false);
    expect(rt.snapshot().state.plan).toBe('pro');
  });
});

describe('expressions and compile diagnostics', () => {
  it('uses precedence, ternaries, safe functions and code-point lengths', () => {
    const rt = runtime(source('state:\n  x: 2\ncomputed:\n  arithmetic: "=1 + x * 3"\n  condition: "=x > 1 && true ? max(7, 9) : 0"\n  length: \'=len("😀a")\'\n  included: \'=contains("Reactive MD", "MD")\''));
    expect(rt.snapshot().computed).toMatchObject({ arithmetic: 7, condition: 9, length: 2, included: true });
  });
  it('short-circuits conditional and logical branches', () => {
    const rt = runtime(source('state:\n  x: 0\ncomputed:\n  safe: "=x == 0 ? 4 : 1 / x"\n  logic: "=false && (1 / x > 0)"'));
    expect(rt.snapshot().computed.safe).toBe(4);
    expect(rt.snapshot().computed.logic).toBe(false);
  });
  it.each([
    ['cycle', 'state:\n  x: 1\ncomputed:\n  a: "=b + 1"\n  b: "=a + 1"', ''],
    ['unknown dependency even in inactive branch', 'computed:\n  a: "=true ? 1 : typo"', ''],
    ['unknown state', 'state:\n  x: 1', '::slider{bind="missing" label="X" min="0" max="3"}'],
    ['unknown component', '', '::mystery[未知]'],
    ['unknown attribute', 'state:\n  x: 0\nactions:\n  reset:\n    - reset: [x]', '::button[重置]{on-click="reset" mystery="x"}'],
    ['wrong binding type', 'state:\n  x: true', '::input{bind="x" label="X"}'],
    ['bad initial constraint', 'state:\n  x: 99', '::slider{bind="x" label="X" min="0" max="10"}'],
    ['unknown action', '', '::button[按钮]{on-click="missing"}'],
    ['duplicate state key', 'state:\n  x: 1\n  x: 2', ''],
    ['non-finite state', 'state:\n  x: .nan', ''],
    ['unknown config', 'states: {x: 1}', ''],
    ['readonly computed target', 'computed:\n  x: "=1"\nactions:\n  bad:\n    - set: x\n      value: 2', ''],
    ['duplicate action target', 'state:\n  x: 1\nactions:\n  bad:\n    - set: x\n      value: 2\n    - reset: [x]', ''],
    ['prototype path', 'computed:\n  x: "=data.constructor"', ''],
    ['global function', 'computed:\n  x: "=alert(1)"', ''],
    ['assignment', 'state:\n  x: 1\ncomputed:\n  y: "=x = 2"', ''],
    ['custom YAML tag', 'data:\n  x: !javascript evil', ''],
    ['YAML alias', 'data:\n  x: &anchor [1]\n  y: *anchor', ''],
    ['implicit string coercion', 'computed:\n  x: \'=1 + "2"\'', ''],
    ['duplicate component id', '', ':::card{id="same"}\nA\n:::\n\n:::card{id="same"}\nB\n:::'],
    ['option outside select', '', '::option[A]{value="a"}'],
  ])('rejects %s with a source diagnostic', (_label, config, body) => invalid(source(config, body)));
  it('rejects unsupported language versions', () => invalid(source('').replace('version: "0.1"', 'version: "9.0"')));
  it('rejects duplicate root configuration blocks', () => invalid(counter + '\n' + counter));
  it('rejects unclosed interactive structures', () => {
    invalid('```reactive-md\nversion: "0.1"\nstate: {x: 1}');
    invalid(source('', ':::card[未闭合]\n内容'));
  });
  it('rejects over-budget input before evaluating it', () => invalid(source('computed:\n  x: "=' + '('.repeat(500) + '1' + ')'.repeat(500) + '"')));
});

describe('ordinary Markdown and directive boundaries', () => {
  it('preserves code, lists, blockquotes and GFM tables without activating fenced directives', () => {
    const doc = valid('# 普通 Markdown\n\n- **列表**\n\n> 引用\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```markdown\n::button[代码示例]{on-click="missing"}\n```');
    const nodes = flatten(doc.nodes);
    for (const type of ['heading', 'list', 'blockquote', 'table', 'code']) expect(nodes.some(n => n.type === type)).toBe(true);
    expect(nodes.some(n => n.type === 'component')).toBe(false);
  });
  it('parses a literal equals escape without evaluating it', () => {
    const doc = valid(source('state:\n  name: demo', '::input{bind="name" label="==名称"}'));
    const node = flatten(doc.nodes).find(node => node.name === 'input')!;
    expect(createRuntime(doc).evaluate(node.props!.label)).toBe('=名称');
  });
});
