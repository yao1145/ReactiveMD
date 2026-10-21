import { describe, expect, it } from 'vitest';
import { compile, createRuntime, getComponentManifest, registerComponent } from '../src/core';
import type { Json, RuntimeOptions } from '../src/core';

const source = (config: string, body = '') => '```reactive-md\nversion: "0.2"\n' + config + '\n```\n\n' + body;
function document(text: string) {
  const result = compile(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}
function runtime(text: string, options?: RuntimeOptions) { return createRuntime(document(text), options); }
function invalid(text: string) { expect(compile(text).ok).toBe(false); }

describe('JSON state and collection actions', () => {
  const todos = source('data:\n  next: {id: c, title: C}\nstate:\n  tasks: [{id: a, title: A}, {id: b, title: B}]\nactions:\n  add:\n    - append: tasks\n      value: "=data.next"\n  remove:\n    - remove: tasks\n      at: "=index"\n  update:\n    - update: tasks\n      at: "=index"\n      value: "=event.value"');
  it('supports immutable JSON collection writes with scoped action parameters', () => {
    const rt = runtime(todos);
    const before = rt.snapshot();
    expect(rt.dispatch('add').ok).toBe(true);
    expect(rt.snapshot().state.tasks).toHaveLength(3);
    expect(before.state.tasks).toHaveLength(2);
    expect(rt.dispatch('remove', { index: 1 }).ok).toBe(true);
    expect((rt.snapshot().state.tasks as Json[]).map(v => (v as Record<string, Json>).id)).toEqual(['a', 'c']);
    expect(rt.dispatch('update', { index: 0, event: { value: { id: 'a', title: 'Updated' } } }).ok).toBe(true);
    expect((rt.snapshot().state.tasks as Json[])[0]).toEqual({ id: 'a', title: 'Updated' });
  });
  it('rolls back an invalid array index', () => {
    const rt = runtime(todos);
    const before = rt.snapshot();
    expect(rt.dispatch('remove', { index: 99 }).ok).toBe(false);
    expect(rt.snapshot()).toBe(before);
  });
  it('permits JSON in an initially empty array and protects nested snapshots', () => {
    const rt = runtime(source('state:\n  items: []\nactions:\n  add:\n    - append: items\n      value: {id: a, title: A}'));
    expect(rt.dispatch('add').ok).toBe(true);
    const items = rt.snapshot().state.items as Record<string, Json>[];
    try { items[0].title = 'Corrupted'; } catch { /* deep freeze */ }
    expect((rt.snapshot().state.items as Record<string, Json>[])[0].title).toBe('A');
  });
  it('keeps each locals inside their lexical scope', () => {
    const body = ':::each{items="=data.rows" as="row" key="id"}\n:value{value="=row.title"}\n:::';
    expect(compile(source('data:\n  rows: [{id: a, title: A}]', body)).ok).toBe(true);
    invalid(source('data:\n  rows: [{id: a, title: A}]', body + '\n\n:value{value="=row.title"}'));
    invalid(source('computed:\n  leaked: "=item.title"'));
    invalid(source('data:\n  rows: []', ':::each{items="=data.rows"}\n内容\n:::'));
  });
});

describe('expressions and manifest', () => {
  it('evaluates pure math and bounded collection helpers', () => {
    const rt = runtime(source('data:\n  rows: [{id: a, amount: 2}, {id: b, amount: 5}]\nstate:\n  x: 2'));
    const evaluate = (expression: string) => rt.evaluate({ kind: 'expression', expression });
    expect(evaluate('pow(x, 3) + sqrt(16)')).toBe(12);
    expect(evaluate('sum(range(1, 5))')).toBe(10);
    expect(evaluate('avg(pluck(data.rows, "amount"))')).toBe(3.5);
    expect(evaluate('at(pluck(data.rows, "amount"), 1)')).toBe(5);
    expect(evaluate('len(where(data.rows, "id", "b"))')).toBe(1);
    expect(evaluate('random(42, 0)')).toBe(evaluate('random(42, 0)'));
    expect(() => evaluate('range(0, 1000000)')).toThrow();
  });
  it('exposes every component needed by the feature plan, with no map or game', () => {
    const names = getComponentManifest().map(item => item.name);
    for (const name of ['grid', 'tabs', 'tab', 'form', 'submit', 'checklist', 'table', 'each', 'chart', 'plot', 'diagram', 'timeline', 'timer']) expect(names).toContain(name);
    expect(names).not.toContain('map');
    expect(names).not.toContain('game');
  });
  it('keeps compiled custom schema usable after the host unregisters it', () => {
    const unregister = registerComponent({ name: 'host-note', form: 'container', label: 'none', children: 'any', props: { value: { type: 'string', dynamic: true, required: true } } });
    const compiled = document(source('state:\n  name: A\nactions:\n  change:\n    - set: name\n      value: B', ':::host-note{value="=name"}\n内容\n:::'));
    unregister();
    const rt = createRuntime(compiled);
    expect(rt.dispatch('change').ok).toBe(true);
    invalid(source('', ':::host-note{value="A"}\n内容\n:::'));
  });
  it('validates plot formulas using a local x and root state', () => {
    expect(compile(source('state:\n  rate: 2', '::plot{formula="rate * sin(x)" label="波形"}')).ok).toBe(true);
    invalid(source('', '::plot{formula="window.alert(x)" label="错误"}'));
  });
  it('rejects invalid form and tab structure while allowing empty required fields', () => {
    expect(compile(source('state:\n  name: ""\nactions:\n  submit:\n    - set: name\n      value: A', ':::form{on-submit="submit"}\n::input{bind="name" label="姓名" required="true"}\n::submit[提交]\n:::')).ok).toBe(true);
    invalid(source('', ':::tab{value="a" label="A"}\n内容\n:::'));
  });
});

describe('host capabilities and resources', () => {
  const host = source('state:\n  query: first\nactions:\n  search:\n    - call: catalog.search\n      input:\n        query: "=query"', '::input{bind="query" label="查询"}');
  it('publishes pending/success and discards a stale response even if the service ignores cancellation', async () => {
    const requests: { signal: AbortSignal; resolve: (value: Json) => void; input: Json }[] = [];
    const doc = document(host);
    const rt = createRuntime(doc, { capabilities: { 'catalog.search': (input, { signal }) => new Promise<Json>(resolve => requests.push({ input, signal, resolve })) } });
    expect(rt.snapshot().resources.search.status).toBe('idle');
    const first = rt.dispatchAsync('search');
    expect(rt.snapshot().resources.search.status).toBe('pending');
    const binding = doc.bindings.find(b => b.state === 'query')!;
    rt.writeBinding(binding.componentId, 'second');
    const second = rt.dispatchAsync('search');
    expect(requests[0].signal.aborted).toBe(true);
    requests[1].resolve(['new']);
    await second;
    expect(rt.snapshot().resources.search.data).toEqual(['new']);
    requests[0].resolve(['old']);
    await first;
    expect(rt.snapshot().resources.search.data).toEqual(['new']);
    expect(rt.snapshot().resources.search.status).toBe('success');
  });
  it('reports host failures and missing capabilities without changing local state', async () => {
    const rt = runtime(host, { capabilities: { 'catalog.search': async () => { throw new Error('Service failed'); } } });
    expect((await rt.dispatchAsync('search')).ok).toBe(false);
    expect(rt.snapshot().resources.search.status).toBe('error');
    expect(rt.snapshot().state.query).toBe('first');
    expect((await runtime(host).dispatchAsync('search')).ok).toBe(false);
  });
  it('cancels a pending request and prevents its eventual commit', async () => {
    let finish!: (value: Json) => void;
    const rt = runtime(host, { capabilities: { 'catalog.search': () => new Promise<Json>(resolve => { finish = resolve; }) } });
    const pending = rt.dispatchAsync('search');
    rt.cancel('search');
    expect(rt.snapshot().resources.search.status).toBe('idle');
    finish(['late']);
    await pending;
    expect(rt.snapshot().resources.search.status).toBe('idle');
  });
  it('validates restored state before exposing a runtime', () => {
    const doc = document(source('state:\n  n: 1', '::slider{bind="n" label="N" min="0" max="5"}'));
    expect(createRuntime(doc, { initialState: { n: 4 } }).snapshot().state.n).toBe(4);
    expect(() => createRuntime(doc, { initialState: { n: 99 } })).toThrow();
  });
});

describe('full language examples', () => {
  const fixtures = import.meta.glob<string>('../examples/*.reactive.md', { eager: true, query: '?raw', import: 'default' });
  for (const [name, text] of Object.entries(fixtures)) {
    it(name + ' compiles', () => document(text));
  }
});
