import { expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalVisual } from '../src/local/visuals';
import type { LocalDocument, LocalNode, LocalRuntime, LocalValue } from '../src/local/types';

let serial = 0;
const range = { start: 0, end: 0 };

function node(type: string, extra: Partial<LocalNode> = {}): LocalNode {
  return { type, id: `node-${serial++}`, range, ...extra };
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
const paragraph = (...children: LocalNode[]): LocalNode => node('paragraph', { children });

function createRuntime(initial: Record<string, LocalValue> = {}): LocalRuntime {
  const state: Record<string, LocalValue> = { ...initial };
  const listeners = new Set<() => void>();
  let revision = 0;

  const evaluate = (expression: string): LocalValue => {
    const source = expression.trim();
    if (Object.hasOwn(state, source)) return state[source];
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(source)) return Number(source);
    const product = /^([A-Za-z_][A-Za-z0-9_]*)\s*\*\s*(-?\d+(?:\.\d+)?)$/.exec(source);
    if (product && typeof state[product[1]] === 'number') {
      return (state[product[1]] as number) * Number(product[2]);
    }
    throw new Error(`unknown expression: ${source}`);
  };

  const runtime: LocalRuntime = {
    document: {
      syntax: 'local',
      source: '',
      nodes: [],
      initialState: { ...initial },
      bindings: {},
    } as LocalDocument,
    snapshot: () => ({ revision, state }),
    get: (target) => state[target.attrs?.bind ?? `@${target.id}`] ?? null,
    set: (target, value) => {
      state[target.attrs?.bind ?? `@${target.id}`] = value;
      revision += 1;
      for (const listener of listeners) listener();
      return [];
    },
    evaluate,
    text: (template) =>
      template.replace(/\{\{([\s\S]*?)\}\}/g, (_match, expression: string) => {
        const value = evaluate(expression);
        return value === null ? '' : Array.isArray(value) ? '' : String(value);
      }),
    reset: () => {},
    resetToken: () => 0,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {},
  };
  return runtime;
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
          return '无法计算';
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

it('renders a searchable, sortable table with page-size pagination', () => {
  const runtime = createRuntime();
  const names = ['slider', 'toggle', 'choices', 'chart', 'plot', 'diagram', 'checklist', 'timer'];
  const rows = names.map((name, index) =>
    row(cell(text(name)), cell(text('分类')), cell(text(String((index + 1) * 10)))),
  );
  const visual = component('table', { label: '组件目录', 'page-size': '4' }, [
    table(row(cell(text('名称')), cell(text('分类')), cell(text('价格'))), ...rows),
  ]);

  const html = mount(visual, runtime);
  expect(html).toContain('搜索组件目录');
  expect(markup(html)).toContain('第 1 / 2 页 · 共 8 行');
  expect(html).toContain('slider');
  expect(html).toContain('chart');
  expect(html).not.toContain('checklist');
  expect(html).toContain('aria-sort="none"');
  expect(html).not.toContain('查看数据表'); // the enhanced table is the whole visual, not a fallback
});

it('renders bar charts with series legend and keyboard marks', () => {
  const runtime = createRuntime();
  const visual = component('chart', { kind: 'bar', title: '费用与预算' }, [
    table(
      row(cell(text('项目')), cell(text('实际')), cell(text('预算'))),
      row(cell(text('内容')), cell(text('120')), cell(text('150'))),
      row(cell(text('视觉')), cell(text('230')), cell(text('200'))),
    ),
  ]);

  const html = mount(visual, runtime);
  expect(html).toContain('<svg');
  expect(html).toContain('费用与预算');
  expect(html).toContain('实际');
  expect(html).toContain('预算');
  expect(html).toContain('聚焦或指向图形');
  expect(html).toContain('data-chart-mark');
  expect(html).not.toContain('查看数据表');
});

it('shows the donut empty state when every value is zero', () => {
  const runtime = createRuntime();
  const visual = component('chart', { kind: 'donut', title: '占比' }, [
    table(
      row(cell(text('项目')), cell(text('数值'))),
      row(cell(text('甲')), cell(text('0'))),
      row(cell(text('乙')), cell(text('0'))),
    ),
  ]);

  expect(mount(visual, runtime)).toContain('暂无占比');
});

it('sorts timeline items by start time and shows the configured unit', () => {
  const runtime = createRuntime();
  const visual = component('timeline', { title: '计划', unit: 'min' }, [
    table(
      row(
        cell(text('事项')),
        cell(text('开始')),
        cell(text('时长')),
        cell(text('说明')),
      ),
      row(cell(text('后段')), cell(text('30')), cell(text('10')), cell(text('后段说明'))),
      row(cell(text('前段')), cell(text('0')), cell(text('20')), cell(text('前段说明'))),
    ),
  ]);

  const html = mount(visual, runtime);
  expect(markup(html).indexOf('前段')).toBeLessThan(markup(html).indexOf('后段'));
  expect(markup(html)).toContain('开始 0 min');
  expect(markup(html)).toContain('结束 20 min');
  expect(html).toContain('聚焦或指向事项查看说明。');
});

it('reads diagram selection from the runtime and shows the selected node detail', () => {
  const runtime = createRuntime({ selected: 'compute' });
  const visual = component('diagram', { bind: 'selected', label: '状态流' }, [
    component('node', { id: 'input', label: '输入' }, [paragraph(text('读者改变参数。'))]),
    component('node', { id: 'compute', label: '计算' }, [paragraph(text('重新计算公式与结果。'))]),
    component('node', { id: 'view', label: '显示' }, [paragraph(text('更新正文与图表。'))]),
    component('edge', { from: 'input', to: 'compute', label: '状态变化' }),
    component('edge', { from: 'compute', to: 'view', label: '更新结果' }),
  ]);

  const html = mount(visual, runtime);
  expect(html).toContain('<svg');
  expect(html).toContain('重新计算公式与结果。');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('状态变化');
  expect(html).toContain('data-diagram-node');
});

it('reserves layer spacing for edge labels and paints labels above node cards', () => {
  const runtime = createRuntime();
  const visual = component('diagram', { label: '流程' }, [
    component('node', { id: 'a', label: '输入' }),
    component('node', { id: 'b', label: '计算' }),
    component('node', { id: 'c', label: '显示' }),
    component('edge', { from: 'a', to: 'b', label: '参数变化' }),
    component('edge', { from: 'b', to: 'c', label: '更新结果' }),
  ]);

  const html = mount(visual, runtime);
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(html);
  expect(viewBox).not.toBeNull();
  expect(Number(viewBox![1])).toBeGreaterThan(520);
  expect(html).toContain('local-visual-edge-label');
  expect(html).toContain('参数变化');
  expect(html).not.toContain('local-visual-edge-label-plate');
  expect(html.indexOf('local-visual-edge-label-group')).toBeGreaterThan(
    html.lastIndexOf('data-diagram-node'),
  );
  expect(html).not.toContain('查看节点与连线');
  expect(html).toContain('aria-describedby="local-diagram-description-');
  expect(html).toContain('local-visual-sr-only');
  expect(html).toContain('输入 → 计算（参数变化）');
  expect(html).toContain('计算 → 显示（更新结果）');
});

it('wraps long diagram edge labels and keeps their full description accessible', () => {
  const runtime = createRuntime();
  const longLabel = '这是一段非常非常长的连线标签文字';
  const visual = component('diagram', { label: '长标签' }, [
    component('node', { id: 'a', label: '输入' }),
    component('node', { id: 'b', label: '计算' }),
    component('edge', { from: 'a', to: 'b', label: longLabel }),
  ]);

  const html = mount(visual, runtime);
  expect(html).toContain('local-visual-sr-only');
  expect(html).toContain(longLabel);
  expect(html.match(/<tspan/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
});

it('renders plots with a lightweight curve legend and no endpoint readout', () => {
  const runtime = createRuntime();
  const visual = component('plot', { min: '0', max: '2', samples: '20' }, [
    node('math', { value: 'y = x^2' }),
  ]);

  const html = mount(visual, runtime);
  expect(html).toContain('<svg');
  expect(html).toContain('local-visual-plot-legend');
  expect(html).toContain('local-visual-plot-formula');
  expect(html).toContain('<math');
  expect(html).toContain('y = x^2');
  expect(html).not.toContain('终点 x = ');
  expect(html).not.toContain('local-visual-endpoint');
  expect(html).not.toContain('查看数据表');
});
