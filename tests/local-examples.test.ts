import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime } from '../src/local';
import type { LocalDocument, LocalNode, LocalValue } from '../src/local';

const sources = import.meta.glob<string>('../examples/local/*.reactive.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const documents = Object.fromEntries(
  Object.entries(sources).map(([path, source]) => [
    path.split('/').at(-1)!.replace('.reactive.md', ''),
    source,
  ]),
) as Record<string, string>;

const normalIds = [
  'comparison', 'parameters', 'checklist', 'charts', 'diagram', 'catalog',
  'planning', 'components', 'pricing', 'counter', 'gallery', 'html-compat',
];

const flatten = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

function compiled(id: string): LocalDocument {
  const result = compileLocal(documents[id]);
  if (!result.ok) throw new Error(`${id}: ${JSON.stringify(result.diagnostics)}`);
  return result.document;
}

function node(document: LocalDocument, bind: string): LocalNode {
  const found = flatten(document.nodes).find((item) => item.attrs?.bind === bind);
  if (!found) throw new Error(`Missing binding ${bind}`);
  return found;
}

const expectedInitialState: Record<string, Record<string, LocalValue>> = {
  comparison: { annual: false },
  parameters: {
    name: '', role: 'personal', appointment: '2026-10-22', message: '', showNotes: false,
  },
  checklist: { done: ['item-1'] },
  charts: { P: 10000, m: 500, r: 5, t: 20, people: 2 },
  diagram: { selected: 'input', a: 1, f: 1 },
  planning: { total: 240, people: 3, tip: 10 },
  components: { preference: 'concise' },
  pricing: { seats: 2, annual: false },
  counter: { count: 0 },
  'html-compat': { count: 2 },
  gallery: {
    name: 'Alex', quantity: 3, plan: 'pro', annual: false, express: true, budgetLevel: 50,
  },
};

describe('local-draft-3 examples', () => {
  it('contains twelve runnable examples and one intentional diagnostic document', () => {
    expect(Object.keys(documents)).toHaveLength(13);
    expect(normalIds.every((id) => documents[id])).toBe(true);
    expect(documents.diagnostics).toBeTruthy();
  });

  for (const id of normalIds) {
    it(`${id}: compiles, initializes bindings and starts a runtime`, () => {
      const document = compiled(id);
      expect(document.syntax).toBe('local');
      expect(document.initialState).toBeTypeOf('object');

      const expected = expectedInitialState[id] ?? {};
      for (const [name, value] of Object.entries(expected)) {
        expect(document.bindings[name], id + ' binding ' + name).toBeTruthy();
        expect(document.initialState[name], id + ' initial ' + name).toEqual(value);
      }

      const runtime = createLocalRuntime(document);
      expect(runtime.snapshot().state).toMatchObject(expected);
      expect(runtime.snapshot().revision).toBe(0);
      runtime.dispose();
    });
  }

  it('updates expressions and resets a panel atomically', () => {
    const document = compiled('pricing');
    const runtime = createLocalRuntime(document);
    const seats = node(document, 'seats');
    const annual = node(document, 'annual');
    const panel = flatten(document.nodes).find((item) => item.name === 'panel')!;

    expect(runtime.get(seats)).toBe(2);
    expect(runtime.get(annual)).toBe(false);
    expect(runtime.set(seats, 5)).toEqual([]);
    expect(runtime.set(annual, true)).toEqual([]);
    expect(runtime.evaluate('seats * (annual ? 80 : 100)')).toBe(400);
    expect(runtime.text('Monthly total: {{ seats * (annual ? 80 : 100) }} USD.'))
      .toBe('Monthly total: 400 USD.');

    runtime.reset(panel);
    expect(runtime.snapshot().state).toMatchObject({ seats: 2, annual: false });
    runtime.dispose();
  });

  it('updates checklist arrays and reads their length', () => {
    const document = compiled('checklist');
    const runtime = createLocalRuntime(document);
    const done = node(document, 'done');
    expect(runtime.get(done)).toEqual(['item-1']);
    expect(runtime.set(done, ['item-1', 'item-2', 'item-3'])).toEqual([]);
    expect(runtime.evaluate('len(done)')).toBe(3);
    runtime.dispose();
  });

  it('keeps gallery calculations and diagram selection reactive', () => {
    const gallery = compiled('gallery');
    const galleryRuntime = createLocalRuntime(gallery);
    expect(galleryRuntime.evaluate("round(quantity * 80 * (plan == 'pro' ? 1 : 0.8) * (annual ? 0.8 : 1))"))
      .toBe(240);
    expect(galleryRuntime.set(node(gallery, 'quantity'), 5)).toEqual([]);
    expect(galleryRuntime.set(node(gallery, 'annual'), true)).toEqual([]);
    expect(galleryRuntime.evaluate("round(quantity * 80 * (plan == 'pro' ? 1 : 0.8) * (annual ? 0.8 : 1))"))
      .toBe(320);
    galleryRuntime.dispose();

    const diagram = compiled('diagram');
    const diagramRuntime = createLocalRuntime(diagram);
    expect(diagramRuntime.set(node(diagram, 'selected'), 'compute')).toEqual([]);
    expect(diagramRuntime.text('Current step: {{ selected }}.')).toBe('Current step: compute.');
    diagramRuntime.dispose();
  });

  it('isolates runtimes created from the same document', () => {
    const document = compiled('pricing');
    const first = createLocalRuntime(document);
    const second = createLocalRuntime(document);
    first.set(node(document, 'seats'), 8);
    expect(first.snapshot().state.seats).toBe(8);
    expect(second.snapshot().state.seats).toBe(2);
    first.dispose();
    second.dispose();
  });

  it('rejects the diagnostic document with positioned errors for every listed class', () => {
    const result = compileLocal(documents.diagnostics);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(8);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.line).toBeGreaterThan(0);
      expect(diagnostic.column).toBeGreaterThan(0);
      expect(diagnostic.range.start).toBeGreaterThanOrEqual(0);
      expect(diagnostic.range.end).toBeLessThanOrEqual(documents.diagnostics.length);
      expect(diagnostic.range.end).toBeGreaterThanOrEqual(diagnostic.range.start);
    }
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(new Set(codes)).toEqual(new Set([
      'local.initial.duplicate',
      'local.binding.unknown',
      'local.initial.range',
      'local.type',
      'local.component.unknown',
      'local.attribute.unknown',
      'local.diagram.edge',
      'local.math',
      'local.chart.numeric',
    ]));
    const text = result.diagnostics.map((diagnostic) => diagnostic.message).join('\n');
    expect(text).toMatch(/undeclared parameter seat\b/);
    expect(text).toMatch(/seats/);
    expect(text).toMatch(/ratio/);
    expect(text).toMatch(/slidr/i);
    expect(text).toMatch(/on-click/);
    expect(text).toMatch(/missing/);
    expect(text).toMatch(/\\int/);
    expect(text).toMatch(/20 USD/);
  });
});
