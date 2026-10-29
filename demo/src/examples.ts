import type { Language } from './i18n';
import functionsSource from '../../examples/local/showcase/functions.reactive.md?raw';
import formsSource from '../../examples/local/showcase/forms.reactive.md?raw';
import statisticsSource from '../../examples/local/showcase/statistics.reactive.md?raw';
import layoutSource from '../../examples/local/showcase/layout.reactive.md?raw';
import flowSource from '../../examples/local/showcase/flow.reactive.md?raw';
import tasksSource from '../../examples/local/showcase/tasks.reactive.md?raw';
import pricingSource from '../../examples/local/pricing.reactive.md?raw';
import diagnosticsSource from '../../examples/local/diagnostics.reactive.md?raw';
import functionsZhSource from '../../examples/local/showcase/zh/functions.reactive.md?raw';
import formsZhSource from '../../examples/local/showcase/zh/forms.reactive.md?raw';
import statisticsZhSource from '../../examples/local/showcase/zh/statistics.reactive.md?raw';
import layoutZhSource from '../../examples/local/showcase/zh/layout.reactive.md?raw';
import flowZhSource from '../../examples/local/showcase/zh/flow.reactive.md?raw';
import tasksZhSource from '../../examples/local/showcase/zh/tasks.reactive.md?raw';
import pricingZhSource from '../../examples/local/zh/pricing.reactive.md?raw';
import diagnosticsZhSource from '../../examples/local/zh/diagnostics.reactive.md?raw';

/** One standalone document, its navigation section and both translations. */
export interface PlaygroundExample {
  id: string;
  section: 'quickstart' | 'feature' | 'reference' | 'debug';
  title: string;
  hint: string;
  source: string;
  titleZh: string;
  hintZh: string;
  sourceZh: string;
}

/** The subset of an example that follows the active demo language. */
export interface LocalizedExample {
  id: string;
  section: PlaygroundExample['section'];
  title: string;
  hint: string;
  source: string;
}

/** All playground documents use the explicit local-draft-3 syntax. */
export const EXAMPLES: PlaygroundExample[] = [
  {
    id: 'pricing',
    section: 'quickstart',
    title: 'Quick start',
    hint: 'Change the headcount, then compare annual billing.',
    source: pricingSource,
    titleZh: '快速体验',
    hintZh: '调整人数，再切换年度付费，看看合计如何变化。',
    sourceZh: pricingZhSource,
  },
  {
    id: 'functions', section: 'feature',
    title: 'Functions & formulas', titleZh: '函数与公式',
    hint: 'Shape a wave and read savings growth through shared calculations.',
    hintZh: '调整波形，用共享计算读取储蓄增长与格式化结果。',
    source: functionsSource, sourceZh: functionsZhSource,
  },
  {
    id: 'forms', section: 'feature',
    title: 'Forms & bindings', titleZh: '表单与联动',
    hint: 'Plan a workshop, check dates and spending, and prepare selected subjects.',
    hintZh: '规划活动，校验日期与费用，并为所选主题生成准备清单。',
    source: formsSource, sourceZh: formsZhSource,
  },
  {
    id: 'statistics', section: 'feature',
    title: 'Data & charts', titleZh: '数据与统计图表',
    hint: 'Read one expense collection through aggregates, tables and charts.',
    hintZh: '用集合汇总、明细表和图表观察同一份预算。',
    source: statisticsSource, sourceZh: statisticsZhSource,
  },
  {
    id: 'layout', section: 'feature',
    title: 'Content & layout', titleZh: '内容与布局',
    hint: 'Choose a reading date and role, compare cards and open the details.',
    hintZh: '选择阅读日期与角色，比较卡片，再展开补充细节。',
    source: layoutSource, sourceZh: layoutZhSource,
  },
  {
    id: 'flow', section: 'feature',
    title: 'Diagrams & flow', titleZh: '图解与流程',
    hint: 'Follow an input into one named calculation shared by every explanation.',
    hintZh: '跟随输入，观察节点与正文如何共享同一个命名计算。',
    source: flowSource, sourceZh: flowZhSource,
  },
  {
    id: 'tasks', section: 'feature',
    title: 'Checklists & timing', titleZh: '清单与计时',
    hint: 'Check off preparation, build a reflection table and time a focus session.',
    hintZh: '勾选准备事项，生成回顾表，并为专注环节计时。',
    source: tasksSource, sourceZh: tasksZhSource,
  },
  {
    id: 'diagnostics',
    section: 'debug',
    title: 'Errors & debugging',
    hint: 'Intentionally broken source',
    source: diagnosticsSource,
    titleZh: '错误与调试',
    hintZh: '故意写错的源码',
    sourceZh: diagnosticsZhSource,
  },
];

export const DEFAULT_EXAMPLE_ID = 'pricing';

/** Keep old tour bookmarks useful after integrating their components. */
export function resolveExampleId(id: string | null | undefined): string | undefined {
  const resolved = id === 'explore' ? 'functions' : id === 'gallery' ? 'forms' : id;
  return EXAMPLES.some(example => example.id === resolved) ? resolved! : undefined;
}

/** Resolve an example's title, hint and source for the active language. */
export function localizedExample(example: PlaygroundExample, language: Language): LocalizedExample {
  return language === 'zh'
    ? { id: example.id, section: example.section, title: example.titleZh, hint: example.hintZh, source: example.sourceZh }
    : { id: example.id, section: example.section, title: example.title, hint: example.hint, source: example.source };
}

/** Every example resolved for the active language, in catalog order. */
export function localizedExamples(language: Language): LocalizedExample[] {
  return EXAMPLES.map((example) => localizedExample(example, language));
}

/** Shorthand for the active-language source of one example. */
export function exampleSource(example: PlaygroundExample, language: Language): string {
  return localizedExample(example, language).source;
}
