import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import type { LocalNode } from '../src/local/types';

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
function compiled(source: string) {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

describe('local syntax acceptance', () => {
  it('synchronizes forward references and shared bindings, then resets a hidden subtree atomically', () => {
    const doc = compiled(`人数 {{ people }}
<panel title="方案">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<if when="{{ people > 4 }}">
<number bind="people" label="另一个人数" min="1" max="20">
<counter bind="extra" label="附加" initial="3">
</if>
</panel>`);
    const runtime = createLocalRuntime(doc);
    const nodes = flatten(doc.nodes);
    const slider = nodes.find(n => n.name === 'slider')!;
    const number = nodes.find(n => n.name === 'number')!;
    const panel = nodes.find(n => n.name === 'panel')!;
    let updates = 0;
    const unsubscribe = runtime.subscribe(() => updates++);
    expect(runtime.set(slider, 5)).toEqual([]);
    expect(runtime.get(number)).toBe(5);
    runtime.reset(panel);
    expect(runtime.snapshot().state.people).toBe(2);
    expect(updates).toBe(2);
    unsubscribe();
    runtime.dispose();
  });

  it('isolates instances and local computation errors', () => {
    const doc = compiled('<number bind="n" label="分母" initial="1">\n\n{{ 1 / n }} 和 {{ n + 2 }}');
    const a = createLocalRuntime(doc), b = createLocalRuntime(doc);
    const input = flatten(doc.nodes).find(n => n.name === 'number')!;
    expect(a.set(input, 0)).toEqual([]);
    expect(() => a.evaluate('1 / n')).toThrow();
    expect(a.evaluate('n + 2')).toBe(2);
    expect(b.evaluate('1 / n')).toBe(1);
    a.dispose(); b.dispose();
  });

  it('does not activate examples inside inline code, fenced code, comments or escaped text', () => {
    const doc = compiled('`<slider bind="code" label="代码"> {{ missing }}`\n\n<!-- <input bind="comment" label="注释"> -->\n\n\\{{ missing }}\n\n```markdown\n<counter bind="fence" label="围栏">\n{{ missing }}\n```');
    expect(Object.keys(doc.initialState)).toEqual([]);
    expect(flatten(doc.nodes).some(n => n.type === 'interpolation')).toBe(false);
  });

  it('rejects legacy configuration, event attributes and undeclared references in local mode', () => {
    for (const source of ['```reactive-md\nstate:\n  n: 1\n```', '<counter label="人数" on-click="run">', '{{ absent }}']) {
      expect(compileLocal(source).ok).toBe(false);
    }
  });
});
