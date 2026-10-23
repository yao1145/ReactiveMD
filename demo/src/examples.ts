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

/** All playground documents use the explicit local-draft-2 syntax. */
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
    hint: 'Shape a wave, compare curves and explore savings growth.',
    hintZh: '调整波形、比较曲线，再探索储蓄增长。',
    source: functionsSource, sourceZh: functionsZhSource,
  },
  {
    id: 'forms', section: 'feature',
    title: 'Forms & bindings', titleZh: '表单与联动',
    hint: 'Build a workshop plan and watch its summary update.',
    hintZh: '填写活动配置，观察方案摘要与费用同步更新。',
    source: formsSource, sourceZh: formsZhSource,
  },
  {
    id: 'statistics', section: 'feature',
    title: 'Data & charts', titleZh: '数据与统计图表',
    hint: 'Read one budget through totals, tables and charts.',
    hintZh: '用合计、明细表和图表观察同一份预算。',
    source: statisticsSource, sourceZh: statisticsZhSource,
  },
  {
    id: 'layout', section: 'feature',
    title: 'Content & layout', titleZh: '内容与布局',
    hint: 'Compare cards, switch reading roles and open the details.',
    hintZh: '比较卡片、切换阅读角色，再展开补充细节。',
    source: layoutSource, sourceZh: layoutZhSource,
  },
  {
    id: 'flow', section: 'feature',
    title: 'Diagrams & flow', titleZh: '图解与流程',
    hint: 'Follow a value from input through computation to display.',
    hintZh: '跟随一个数值，从输入走到计算和显示。',
    source: flowSource, sourceZh: flowZhSource,
  },
  {
    id: 'tasks', section: 'feature',
    title: 'Checklists & timing', titleZh: '清单与计时',
    hint: 'Prepare a workshop, track progress and time a focus session.',
    hintZh: '准备活动、跟踪进度，并为专注环节计时。',
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
