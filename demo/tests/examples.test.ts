import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import { EXAMPLES, DEFAULT_EXAMPLE_ID } from '../src/examples';

function exampleSource(id: string) {
  const example = EXAMPLES.find((item) => item.id === id);
  if (!example) throw new Error(`Missing example ${id}`);
  return example.source;
}

function flatten<T extends { children?: T[] }>(nodes: T[]): T[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

describe('playground local documents consumed through the public package', () => {
  it('ships twelve unique local examples with a valid default', () => {
    expect(EXAMPLES).toHaveLength(12);
    expect(new Set(EXAMPLES.map((example) => example.id)).size).toBe(12);
    expect(EXAMPLES.some((example) => example.id === DEFAULT_EXAMPLE_ID)).toBe(true);
    for (const example of EXAMPLES) {
      expect(example.source.trim().length).toBeGreaterThan(0);
      expect(example.source).not.toContain('```reactive-md');
      expect(example.source).not.toContain(':::');
    }
  });

  for (const example of EXAMPLES) {
    it(`${example.id}: ${example.id === 'diagnostics' ? 'reports intentional errors' : 'compiles and starts'}`, () => {
      const result = compileLocal(example.source);
      if (example.id === 'diagnostics') {
        expect(result.ok).toBe(false);
        expect(result.diagnostics.length).toBeGreaterThanOrEqual(8);
        expect(result.diagnostics.every((item) => item.line > 0 && item.column > 0)).toBe(true);
        return;
      }
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const runtime = createLocalRuntime(result.document);
      const snapshot = runtime.snapshot();
      expect(snapshot.revision).toBe(0);
      expect(snapshot.state).toBeTypeOf('object');
      runtime.dispose();
    });
  }

  it('runs the pricing panel through its public bindings', () => {
    const result = compileLocal(exampleSource('pricing'));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const runtime = createLocalRuntime(result.document);
    const nodes = flatten(result.document.nodes);
    const seats = nodes.find((node) => node.attrs?.bind === 'seats');
    const annual = nodes.find((node) => node.attrs?.bind === 'annual');
    expect(seats?.name).toBe('slider');
    expect(annual?.name).toBe('toggle');
    expect(runtime.get(seats!)).toBe(2);
    expect(runtime.get(annual!)).toBe(false);
    expect(runtime.set(seats!, 5)).toEqual([]);
    expect(runtime.set(annual!, true)).toEqual([]);
    expect(runtime.evaluate('seats * (annual ? 80 : 100)')).toBe(400);
    expect(runtime.text('Monthly total: {{ seats * (annual ? 80 : 100) }} USD.'))
      .toBe('Monthly total: 400 USD.');
    runtime.dispose();
  });

  it('runs checklist, counter and text bindings independently', () => {
    const checklist = compileLocal(exampleSource('checklist'));
    if (!checklist.ok) throw new Error(JSON.stringify(checklist.diagnostics));
    const checklistRuntime = createLocalRuntime(checklist.document);
    const done = flatten(checklist.document.nodes).find((node) => node.attrs?.bind === 'done');
    expect(checklistRuntime.get(done!)).toEqual(['item-1']);
    expect(checklistRuntime.set(done!, ['item-1', 'item-2', 'item-3'])).toEqual([]);
    expect(checklistRuntime.evaluate('len(done)')).toBe(3);
    checklistRuntime.dispose();

    const counter = compileLocal(exampleSource('counter'));
    if (!counter.ok) throw new Error(JSON.stringify(counter.diagnostics));
    const counterRuntime = createLocalRuntime(counter.document);
    const count = flatten(counter.document.nodes).find((node) => node.attrs?.bind === 'count');
    expect(counterRuntime.get(count!)).toBe(0);
    counterRuntime.set(count!, 3);
    expect(counterRuntime.text('The prose can read it too: **{{ count }}**.'))
      .toBe('The prose can read it too: **3**.');
    counterRuntime.dispose();
  });
});
