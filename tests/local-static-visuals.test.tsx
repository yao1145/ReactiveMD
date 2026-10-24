import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalVisual } from '../src/local/visuals';
import type { LocalDocument, LocalNode, LocalRuntime } from '../src/local/types';
import type { LocalRenderContext, LocalRenderMode } from '../src/local/render-types';

function compile(source: string): { document: LocalDocument; runtime: LocalRuntime } {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  }
  return { document: result.document, runtime: createLocalRuntime(result.document) };
}

function findVisual(nodes: LocalNode[], name: string): LocalNode {
  for (const node of nodes) {
    if (node.type === 'component' && node.name === name) return node;
    if (node.children) {
      try {
        return findVisual(node.children, name);
      } catch {
        // Keep looking in sibling nodes.
      }
    }
  }
  throw new Error(`Missing visual component <${name}>`);
}

/** Small recursive renderer so the tests do not depend on LocalDocumentView. */
function childRenderer(runtime: LocalRuntime) {
  const renderNodes = (nodes: LocalNode[] = []): ReactNode =>
    nodes.map((child) => {
      if (
        child.type === 'text' ||
        child.type === 'inlineCode' ||
        child.type === 'code' ||
        child.type === 'inlineMath' ||
        child.type === 'math'
      ) {
        return child.value ?? '';
      }
      if (child.type === 'interpolation') {
        try {
          const value = runtime.evaluate((child.value ?? '').trim());
          return value === null ? '' : Array.isArray(value) ? '' : String(value);
        } catch {
          return 'Cannot compute';
        }
      }
      if (child.children && child.children.length > 0) {
        return <span key={child.id}>{renderNodes(child.children)}</span>;
      }
      return child.value ?? null;
    });
  return renderNodes;
}

function context(runtime: LocalRuntime, mode: LocalRenderMode): LocalRenderContext {
  return { runtime, mode, visible: true, render: childRenderer(runtime) };
}

function mount(source: string, name: string, mode: LocalRenderMode): string {
  const { runtime } = compile(source);
  try {
    const node = findVisual(runtime.document.nodes, name);
    return renderToStaticMarkup(<LocalVisual node={node} {...context(runtime, mode)} />);
  } finally {
    runtime.dispose();
  }
}

/** Strip hydration separators so visible text assertions stay simple. */
function visible(html: string): string {
  return html.replace(/<!-- -->/g, '');
}

const TABLE_SOURCE = `<table label="人员" key="姓名" initial="乙" bind="picked" page-size="3" searchable="true" sortable="true">
| 姓名 | 角色 | 分数 |
| --- | --- | ---: |
| 甲 | 设计 | 10 |
| 乙 | 开发 | 20 |
| 丙 | 测试 | 30 |
| 丁 | 产品 | 40 |
| 戊 | 运营 | 50 |
| 己 | 财务 | 60 |
| 庚 | 法务 | 70 |
</table>`;

const CHART_SOURCE = `<chart kind="bar" title="费用对比" key="项目" initial="B" bind="picked" x="项目" y="实际,预算">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| A | 120 | 150 |
| B | 230 | 200 |
| C | 180 | 220 |
</chart>`;

const TIMELINE_SOURCE = `<timeline title="计划" unit="min">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| 后段 | 30 | 10 | 后段说明 |
| 前段 | 0 | 20 | 前段说明 |
</timeline>`;

const DIAGRAM_SOURCE = `<diagram label="状态流">
<node id="input" label="输入">
读者改变参数。
</node>

<node id="compute" label="计算">
重新计算公式与结果。
</node>

<node id="view" label="显示">
更新正文与图表。
</node>

<edge from="input" to="compute" label="状态变化">
<edge from="compute" to="view" label="更新结果">
</diagram>`;

describe('static table', () => {
  it('renders every row without search, sort, selection or pagination controls', () => {
    const html = mount(TABLE_SOURCE, 'table', 'static');
    const text = visible(html);

    for (const name of ['甲', '乙', '丙', '丁', '戊', '己', '庚']) {
      expect(text).toContain(name);
    }
    // Numeric alignment and table semantics survive.
    expect(html).toContain('class="local-visual-table local-static-table"');
    expect(html).toContain('<caption class="local-visual-sr-only">人员</caption>');
    expect(html).toMatch(/<th scope="col" class="is-numeric">分数<\/th>/);
    expect(html).toMatch(/<td class="is-numeric">70<\/td>/);
    // The bound selection is visible without a row control.
    expect(html).toContain('class="is-selected local-static-selected"');

    expect(html).not.toContain('<input');
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain('local-visual-search');
    expect(html).not.toContain('local-visual-sort-button');
    expect(html).not.toContain('local-visual-select-button');
    expect(html).not.toContain('local-visual-pagination');
    expect(html).not.toContain('aria-sort');
    expect(html).not.toContain('aria-pressed');
  });

  it('keeps empty tables readable', () => {
    const source = `<table label="空表" searchable="true" sortable="true">
| 名称 | 数量 |
| --- | ---: |
</table>`;
    const html = mount(source, 'table', 'static');

    expect(visible(html)).toContain('No rows to display');
    expect(html).not.toContain('local-visual-pagination');
  });
});

describe('static chart', () => {
  it('renders a readable SVG with plain-text legend labels and no mark controls', () => {
    const html = mount(CHART_SOURCE, 'chart', 'static');
    const text = visible(html);

    expect(html).toContain('<svg');
    expect(html).toContain('费用对比');
    expect(text).toContain('实际');
    expect(text).toContain('预算');
    expect(html).toContain('local-static-legend-item');
    expect(html).toContain('local-visual-bar is-selected');

    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('data-chart-selectable');
    expect(html).not.toContain('data-chart-mark');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('Focus or point at a mark');
    expect(html).not.toContain('local-visual-readout');
  });
});

describe('static timeline and diagram', () => {
  it('renders timeline notes inline without focus or hover instructions', () => {
    const html = mount(TIMELINE_SOURCE, 'timeline', 'static');
    const text = visible(html);

    expect(text).toContain('前段说明');
    expect(text).toContain('后段说明');
    expect(html).toContain('local-static-timeline-item');
    expect(html).toContain('<ol class="local-visual-timeline-list">');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('Focus or point at an item');
  });

  it('renders every diagram node description and keeps edges with no node controls', () => {
    const html = mount(DIAGRAM_SOURCE, 'diagram', 'static');
    const text = visible(html);

    expect(text).toContain('读者改变参数。');
    expect(text).toContain('重新计算公式与结果。');
    expect(text).toContain('更新正文与图表。');
    expect(html).toContain('local-static-diagram-nodes');
    expect(html).toMatch(/<dt>输入<\/dt>/);
    expect(html).toMatch(/<dt>计算<\/dt>/);
    expect(html).toMatch(/<dt>显示<\/dt>/);
    // Edges and the accessible node/edge list remain.
    expect(text).toContain('状态变化');
    expect(text).toContain('更新结果');
    expect(text).toContain('输入 → 计算 (状态变化)');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('data-diagram-node');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('Click a node');
    expect(html).not.toContain('press Tab');
  });
});

describe('interactive visuals', () => {
  it('keeps table search, sort, selection and pagination controls', () => {
    const html = mount(TABLE_SOURCE, 'table', 'interactive');

    expect(html).toContain('Search 人员');
    expect(html).toContain('local-visual-search');
    expect(html).toContain('local-visual-sort-button');
    expect(html).toContain('local-visual-select-button');
    expect(html).toContain('local-visual-pagination');
    expect(visible(html)).toContain('Page 1 of 3 · 7 rows');
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('keeps the interactive chart legend button and mark affordances', () => {
    const html = mount(CHART_SOURCE, 'chart', 'interactive');

    expect(html).toContain('<button');
    expect(html).toContain('local-visual-legend-item');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-chart-selectable');
    expect(html).toContain('data-chart-mark');
    expect(html).toContain('Focus or point at a mark');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('local-static-legend-item');
  });
});
