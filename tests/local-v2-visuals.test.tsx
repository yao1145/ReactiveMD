import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalVisual } from '../src/local/visuals';
import type { LocalDocument, LocalNode, LocalRuntime, LocalValue } from '../src/local/types';

let serial = 0;
const range = { start: 0, end: 0 };

function node(type: string, extra: Partial<LocalNode> = {}): LocalNode {
  return { type, id: `visual-node-${serial++}`, range, ...extra };
}

const text = (value: string): LocalNode => node('text', { value });
const cell = (...children: LocalNode[]): LocalNode => node('tableCell', { children });
const row = (...cells: LocalNode[]): LocalNode => node('tableRow', { children: cells });
const table = (...rows: LocalNode[]): LocalNode => node('table', { children: rows });
const component = (
  name: string,
  attrs: Record<string, string>,
  children: LocalNode[] = [],
): LocalNode => node('component', { name, attrs, children });

/**
 * Minimal runtime. Selection uses the normal public `get`/`set` pair; without
 * a `bind` the compiler-owned internal key `@node.id` stands in, exactly as it
 * does for every other unbound control.
 */
function createRuntime(initial: Record<string, LocalValue> = {}): LocalRuntime {
  const state: Record<string, LocalValue> = { ...initial };
  const writes: LocalValue[] = [];
  const listeners = new Set<() => void>();

  const evaluate = (expression: string): LocalValue => {
    const source = expression.trim();
    if (Object.hasOwn(state, source)) return state[source];
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(source)) return Number(source);
    throw new Error(`unknown expression: ${source}`);
  };

  const runtime = {
    document: {
      syntax: 'local',
      source: '',
      nodes: [],
      initialState: { ...initial },
      bindings: {},
    } as LocalDocument,
    snapshot: () => ({ revision: writes.length, state }),
    get: (target: LocalNode) => state[target.attrs?.bind ?? `@${target.id}`] ?? null,
    set: (target: LocalNode, value: LocalValue) => {
      writes.push(value);
      state[target.attrs?.bind ?? `@${target.id}`] = value;
      for (const listener of listeners) listener();
      return [];
    },
    setMany: (target: LocalNode, values: Record<string, LocalValue>) => {
      for (const [slot, value] of Object.entries(values)) {
        writes.push(`${slot}:${String(value)}`);
        state[`${target.attrs?.bind ?? `@${target.id}`}:${slot}`] = value;
      }
      for (const listener of listeners) listener();
      return [];
    },
    evaluate,
    text: (template: string) =>
      template.replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression: string) => {
        const value = evaluate(expression.trim());
        return value === null ? '' : Array.isArray(value) ? '' : String(value);
      }),
    reset: () => {},
    resetToken: () => 0,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {},
    writes,
  };
  return runtime as unknown as LocalRuntime;
}

function runtimeWrites(runtime: LocalRuntime): LocalValue[] {
  return (runtime as LocalRuntime & { writes: LocalValue[] }).writes;
}

function renderNodes(runtime: LocalRuntime) {
  return (nodes: LocalNode[] = []): ReactNode =>
    nodes.map((child) => {
      if (child.type === 'text' || child.type === 'inlineCode') return child.value ?? '';
      if (child.type === 'interpolation') {
        try {
          const value = runtime.evaluate((child.value ?? '').trim());
          if (value === null) return '';
          return Array.isArray(value) ? '' : String(value);
        } catch {
          return 'Cannot compute';
        }
      }
      if (child.children) return renderNodes(runtime)(child.children);
      return child.value ?? null;
    });
}

function mount(visual: LocalNode, runtime: LocalRuntime): string {
  return renderToStaticMarkup(
    <LocalVisual node={visual} runtime={runtime} render={renderNodes(runtime)} visible />,
  );
}

/** Hydration comment separators are irrelevant to the visible text assertions. */
function markup(html: string): string {
  return html.replace(/<!-- -->/g, '');
}

function count(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

function selectionTable(attrs: Record<string, string> = {}): LocalNode {
  return component('table', { label: '人员', ...attrs }, [
    table(
      row(cell(text('姓名')), cell(text('角色'))),
      row(cell(text('甲')), cell(text('设计'))),
      row(cell(text('乙')), cell(text('开发'))),
      row(cell(text('丙')), cell(text('测试'))),
    ),
  ]);
}

describe('table selection', () => {
  it('keeps the legacy table markup when no key column is configured', () => {
    const runtime = createRuntime();
    const html = mount(selectionTable({ bind: 'picked' }), runtime);

    expect(html).not.toContain('local-visual-select');
    expect(html).not.toContain('aria-pressed');
    expect(runtimeWrites(runtime)).toEqual([]);
  });

  it('adds one accessible button per row and marks the initial runtime selection', () => {
    const runtime = createRuntime({ picked: '乙' });
    const html = mount(selectionTable({ key: '姓名', bind: 'picked' }), runtime);

    expect(count(html, /local-visual-select-button/g)).toBe(3);
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
    expect(markup(html)).toMatch(/aria-pressed="true"[^>]*aria-label="Select row 乙"/);
    expect(markup(html)).toMatch(/aria-pressed="false"[^>]*aria-label="Select row 甲"/);
    // The stable source value is written as the selection, never a page or sort index.
    expect(html).not.toContain('Select row 0');
    expect(html).not.toContain('Select row 1');
    expect(runtimeWrites(runtime)).toEqual([]);
  });

  it('supports key-only internal selection without an explicit bind', () => {
    const visual = selectionTable({ key: '姓名' });
    const runtime = createRuntime({ [`@${visual.id}`]: '丙' });
    const html = mount(visual, runtime);

    expect(count(html, /local-visual-select-button/g)).toBe(3);
    expect(markup(html)).toMatch(/aria-pressed="true"[^>]*aria-label="Select row 丙"/);
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
  });

  it('does not activate selection when the key names a missing column', () => {
    const runtime = createRuntime();
    const html = mount(selectionTable({ key: '不存在', bind: 'picked' }), runtime);

    expect(html).not.toContain('local-visual-select');
    expect(html).not.toContain('aria-pressed');
  });
});

describe('chart selection', () => {
  const rows = (): LocalNode[] => [
    row(cell(text('项目')), cell(text('横轴')), cell(text('值'))),
    row(cell(text('A')), cell(text('1')), cell(text('10'))),
    row(cell(text('B')), cell(text('2')), cell(text('20'))),
    row(cell(text('C')), cell(text('3')), cell(text('30'))),
  ];

  const chart = (attrs: Record<string, string>): LocalNode =>
    component('chart', attrs, [table(...rows())]);

  it('keeps legacy mark roles when no key column is configured', () => {
    const runtime = createRuntime();
    const html = mount(
      chart({ kind: 'bar', title: '读数', x: '项目', y: '值', bind: 'picked' }),
      runtime,
    );

    expect(html).not.toContain('data-chart-selectable');
    expect(html).not.toContain('role="button"');
    expect(count(html, /role="img"/g)).toBeGreaterThan(0);
  });

  const selectableKinds: [string, Record<string, string>, string][] = [
    ['bar', { kind: 'bar', x: '项目', y: '值' }, 'local-visual-bar is-selected'],
    ['line', { kind: 'line', x: '项目', y: '值' }, 'local-visual-point is-selected'],
    ['area', { kind: 'area', x: '项目', y: '值' }, 'local-visual-point is-selected'],
    ['scatter', { kind: 'scatter', x: '横轴', y: '值' }, 'local-visual-point is-selected'],
    ['donut', { kind: 'donut', x: '项目', y: '值' }, 'local-visual-donut-slice is-selected'],
  ];

  for (const [kind, attrs, selectedClass] of selectableKinds) {
    it(`${kind} marks are keyboard/click selectable through the stable row key`, () => {
      const runtime = createRuntime({ picked: 'B' });
      const html = mount(
        chart({ ...attrs, title: `${kind} 图`, key: '项目', bind: 'picked' }),
        runtime,
      );

      expect(html).toContain('data-chart-selectable');
      expect(html).toContain('role="button"');
      // The legend buttons also expose aria-pressed, so scope the selection
      // state checks to marks that carry the selection data attribute.
      expect(count(html, /data-chart-selectable=""[^>]*aria-pressed="true"/g)).toBe(1);
      expect(count(html, /data-chart-selectable=""[^>]*aria-pressed="false"/g)).toBeGreaterThan(0);
      expect(html).toContain(selectedClass);
      // Selection is read by key, so the second row (index 1) is selected by "B"
      // rather than by its position.
      expect(markup(html)).toMatch(/aria-label="[^"]*B[^"]*: 20"/);
    });
  }

  it('renders selected donut slices by source key even when other slices are hidden', () => {
    const runtime = createRuntime({ picked: 'A' });
    const html = mount(
      chart({ kind: 'donut', title: '占比', x: '项目', y: '值', key: '项目', bind: 'picked' }),
      runtime,
    );

    expect(html).toContain('local-visual-donut-slice is-selected');
    expect(count(html, /data-chart-selectable=""[^>]*aria-pressed="true"/g)).toBe(1);
    expect(markup(html)).toMatch(/aria-pressed="true"[^>]*aria-label="A: 10"/);
  });

  it('does not activate selection when the key names a missing column', () => {
    const runtime = createRuntime();
    const html = mount(
      chart({ kind: 'line', title: '折线', x: '项目', y: '值', key: '不存在', bind: 'picked' }),
      runtime,
    );

    expect(html).not.toContain('data-chart-selectable');
    expect(html).not.toContain('role="button"');
  });
});
