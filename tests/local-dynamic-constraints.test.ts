import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, type LocalDocument, type LocalNode } from '../src/local';

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

function node(document: LocalDocument, name: string, index = 0): LocalNode {
  const found = all(document.nodes).filter((item) => item.name === name)[index];
  if (!found) throw new Error(`Missing <${name}> at ${index}`);
  return found;
}

const ROOMS = [
  '<number bind="rooms" label="Rooms" initial="2" min="1" max="5">',
  '<number bind="guests" label="Guests" initial="6" min="1" max="{{ rooms * 4 }}">',
].join('\n');

describe('dynamic input constraints', () => {
  it('records dynamic bounds without freezing them into the binding', () => {
    const document = compile(ROOMS);
    const guests = document.bindings.guests;
    expect(guests.min).toBe(1);
    expect(guests.max).toBeUndefined();
    expect(document.dynamicConstraints?.[node(document, 'number', 1).id]).toMatchObject({
      max: { source: 'rooms * 4' },
    });
    expect(document.dependencies?.[node(document, 'number', 1).id]).toContain('rooms');
  });

  it('keeps an existing value when a dependency narrows the range', () => {
    const document = compile(ROOMS);
    const runtime = createLocalRuntime(document);
    try {
      const [rooms, guests] = [node(document, 'number'), node(document, 'number', 1)];
      expect(runtime.set(rooms, 1)).toEqual([]);
      expect(runtime.get(guests)).toBe(6);
      const rejected = runtime.set(guests, 6);
      expect(rejected.map((item) => item.code)).toEqual(['local.runtime.value']);
      expect(runtime.get(guests)).toBe(6);
      expect(runtime.set(guests, 4)).toEqual([]);
      expect(runtime.get(guests)).toBe(4);
      // The reader may also restore the dependency instead.
      expect(runtime.set(rooms, 2)).toEqual([]);
      expect(runtime.get(guests)).toBe(4);
    } finally {
      runtime.dispose();
    }
  });

  it('validates new writes against prospective values in one atomic batch', () => {
    const document = compile(ROOMS);
    const runtime = createLocalRuntime(document);
    try {
      const rejected = runtime.setParameters({ rooms: 1, guests: 6 });
      expect(rejected.map((item) => item.code)).toEqual(['local.runtime.value']);
      expect(runtime.getParameters()).toMatchObject({ rooms: 2, guests: 6 });
      expect(runtime.setParameters({ rooms: 1, guests: 4 })).toEqual([]);
      expect(runtime.getParameters()).toMatchObject({ rooms: 1, guests: 4 });
    } finally {
      runtime.dispose();
    }
  });

  it('applies dynamic date bounds and required', () => {
    const document = compile([
      '<toggle bind="business" label="Business" initial="true">',
      '<date bind="departure" label="Departure" initial="2026-11-10">',
      '<date bind="return" label="Return" initial="2026-11-12" min="{{ departure }}" required="{{ business }}">',
      '<input bind="company" label="Company" required="{{ business }}">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const [business, departure, back, company] = [
        node(document, 'toggle'), node(document, 'date'), node(document, 'date', 1), node(document, 'input'),
      ];
      expect(runtime.set(back, '2026-11-01').map((item) => item.code)).toEqual(['local.runtime.value']);
      expect(runtime.get(back)).toBe('2026-11-12');
      expect(runtime.set(back, '2026-11-11')).toEqual([]);
      expect(runtime.set(company, '').map((item) => item.code)).toEqual(['local.runtime.value']);
      expect(runtime.set(business, false)).toEqual([]);
      expect(runtime.set(company, '')).toEqual([]);
      expect(runtime.set(departure, '2026-11-20')).toEqual([]);
      expect(runtime.get(back)).toBe('2026-11-11');
    } finally {
      runtime.dispose();
    }
  });

  it('reports invalid dynamic bounds and failing expressions atomically', () => {
    const document = compile([
      '<number bind="low" label="Low" initial="1">',
      '<number bind="value" label="Value" initial="3" min="{{ low + 4 }}" max="{{ low + 1 }}">',
      '<number bind="fragile" label="Fragile" initial="1" max="{{ 10 / divisor }}">',
      '<number bind="divisor" label="Divisor" initial="0">',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const [value, fragile] = [node(document, 'number', 1), node(document, 'number', 2)];
      expect(runtime.set(value, 3).map((item) => item.code)).toEqual(['local.runtime.value']);
      expect(runtime.get(value)).toBe(3);
      const before = runtime.snapshot().revision;
      expect(runtime.set(fragile, 2).map((item) => item.code)).toEqual(['local.runtime.value']);
      expect(runtime.snapshot().revision).toBe(before);
      expect(runtime.get(fragile)).toBe(1);
    } finally {
      runtime.dispose();
    }
  });

  it('requires shared controls to declare the same dynamic expression', () => {
    const result = compileLocal([
      '<number bind="n" label="A" min="{{ floor }}" max="10">',
      '<number bind="n" label="B" min="0" max="10">',
      '<number bind="floor" label="Floor" initial="1">',
    ].join('\n'));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('local.binding.constraint');

    const dates = compileLocal([
      '<date bind="start" label="Start">',
      '<date bind="end" label="A" min="{{ start }}">',
      '<date bind="end" label="B">',
    ].join('\n'));
    expect(dates.ok).toBe(false);
    expect(dates.diagnostics.map((item) => item.code)).toContain('local.binding.constraint');
  });

  it('rejects dynamic attributes with the wrong expression type', () => {
    const result = compileLocal([
      '<number bind="n" label="N" max="{{ \'five\' }}">',
      '<date bind="d" label="D" min="{{ 5 }}">',
      '<input bind="t" label="T" required="{{ 1 }}">',
      '<toggle bind="flag" label="F">',
    ].join('\n'));
    expect(result.ok).toBe(false);
    const codes = result.diagnostics.map((item) => item.code);
    expect(codes.filter((code) => code === 'local.type')).toHaveLength(3);
  });

  it('does not modify reset values that are invalid under current constraints', () => {
    const document = compile([
      '<panel title="Plan">',
      '<number bind="rooms" label="Rooms" initial="2" min="1" max="5">',
      '<number bind="guests" label="Guests" initial="6" min="1" max="{{ rooms * 4 }}">',
      '</panel>',
    ].join('\n'));
    const runtime = createLocalRuntime(document);
    try {
      const panel = node(document, 'panel');
      runtime.setParameter('guests', 3);
      expect(runtime.getParameter('guests')).toBe(3);
      runtime.reset(panel);
      expect(runtime.getParameter('guests')).toBe(6);
      expect(runtime.getParameter('rooms')).toBe(2);
    } finally {
      runtime.dispose();
    }
  });
});
