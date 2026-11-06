import type { Language } from './i18n';
import { extensions as installedExtensions } from 'virtual:reactive-md/host';
import functionsSource from '../content/examples/local/showcase/functions.reactive.md?raw';
import formsSource from '../content/examples/local/showcase/forms.reactive.md?raw';
import statisticsSource from '../content/examples/local/showcase/statistics.reactive.md?raw';
import layoutSource from '../content/examples/local/showcase/layout.reactive.md?raw';
import flowSource from '../content/examples/local/showcase/flow.reactive.md?raw';
import tasksSource from '../content/examples/local/showcase/tasks.reactive.md?raw';
import pricingSource from '../content/examples/local/pricing.reactive.md?raw';
import diagnosticsSource from '../content/examples/local/diagnostics.reactive.md?raw';
import functionsZhSource from '../content/examples/local/showcase/zh/functions.reactive.md?raw';
import formsZhSource from '../content/examples/local/showcase/zh/forms.reactive.md?raw';
import statisticsZhSource from '../content/examples/local/showcase/zh/statistics.reactive.md?raw';
import layoutZhSource from '../content/examples/local/showcase/zh/layout.reactive.md?raw';
import flowZhSource from '../content/examples/local/showcase/zh/flow.reactive.md?raw';
import tasksZhSource from '../content/examples/local/showcase/zh/tasks.reactive.md?raw';
import pricingZhSource from '../content/examples/local/zh/pricing.reactive.md?raw';
import diagnosticsZhSource from '../content/examples/local/zh/diagnostics.reactive.md?raw';
import classroomSource from '../content/examples/local/scenarios/classroom.reactive.md?raw';
import classroomZhSource from '../content/examples/local/scenarios/classroom-zh.reactive.md?raw';
import proposalSource from '../content/examples/local/scenarios/proposal.reactive.md?raw';
import proposalZhSource from '../content/examples/local/scenarios/proposal-zh.reactive.md?raw';
import surveySource from '../content/examples/local/scenarios/survey.reactive.md?raw';
import surveyZhSource from '../content/examples/local/scenarios/survey-zh.reactive.md?raw';
import blogSource from '../content/examples/local/scenarios/blog.reactive.md?raw';
import blogZhSource from '../content/examples/local/scenarios/blog-zh.reactive.md?raw';
import featuresSource from '../content/examples/local/showcase/features.reactive.md?raw';
import featuresZhSource from '../content/examples/local/showcase/zh/features.reactive.md?raw';

/** One standalone document, its navigation section and both translations. */
export interface PlaygroundExample {
  id: string;
  section: 'scenario' | 'legacy' | 'feature' | 'reference' | 'debug';
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
const extensionExamples = (installedExtensions.examples ?? []) as readonly PlaygroundExample[];
export const EXAMPLES: PlaygroundExample[] = [
  {
    id: 'classroom', section: 'scenario',
    title: 'Classroom', titleZh: '课堂教学',
    hint: 'Build a square wave from sine waves, derive its Fourier coefficients and inspect convergence.',
    hintZh: '用正弦波拼出方波，推导傅里叶系数，观察部分和与跳跃附近的振荡。',
    source: classroomSource, sourceZh: classroomZhSource,
  },
  {
    id: 'proposal', section: 'scenario',
    title: 'Proposal', titleZh: '方案展示',
    hint: 'Discuss a four-week trial with a shopping list, a live budget and a delivery schedule.',
    hintZh: '带着采购清单、可调整预算和实施时间表，讨论一项四周试用方案。',
    source: proposalSource, sourceZh: proposalZhSource,
  },
  {
    id: 'survey', section: 'scenario',
    title: 'Survey', titleZh: '活动调研',
    hint: 'Choose a time and topics, then prepare a personal summary for the organiser.',
    hintZh: '填写时间、兴趣与材料偏好，生成一份可发给组织者的个人摘要。',
    source: surveySource, sourceZh: surveyZhSource,
  },
  {
    id: 'blog', section: 'scenario',
    title: 'Blog', titleZh: '博客长文',
    hint: 'Reread Zhu Ziqing with a personal reflection, switch reading notes and leave a thought of your own.',
    hintZh: '重读《背影》，在文学短评和生活随记之间，留一句自己的阅读旁注。',
    source: blogSource, sourceZh: blogZhSource,
  },
  {
    id: 'features', section: 'feature',
    title: 'Feature demo', titleZh: '功能演示',
    hint: 'Six former tours in one continuous document, with independent controls and shared navigation.',
    hintZh: '原来的六篇示例合成一篇连续文档，各节控件独立，通过大纲导航。',
    source: featuresSource, sourceZh: featuresZhSource,
  },
  {
    id: 'pricing',
    section: 'legacy',
    title: 'Quick start',
    hint: 'Change the headcount, then compare annual billing.',
    source: pricingSource,
    titleZh: '快速体验',
    hintZh: '调整人数，再切换年度付费，看看合计如何变化。',
    sourceZh: pricingZhSource,
  },
  {
    id: 'functions', section: 'legacy',
    title: 'Functions & formulas', titleZh: '函数与公式',
    hint: 'Shape a wave and read savings growth through shared calculations.',
    hintZh: '调整波形，用共享计算读取储蓄增长与格式化结果。',
    source: functionsSource, sourceZh: functionsZhSource,
  },
  {
    id: 'forms', section: 'legacy',
    title: 'Forms & bindings', titleZh: '表单与联动',
    hint: 'Plan a workshop, check dates and spending, and prepare selected subjects.',
    hintZh: '规划活动，校验日期与费用，并为所选主题生成准备清单。',
    source: formsSource, sourceZh: formsZhSource,
  },
  {
    id: 'statistics', section: 'legacy',
    title: 'Data & charts', titleZh: '数据与统计图表',
    hint: 'Read one expense collection through aggregates, tables and charts.',
    hintZh: '用集合汇总、明细表和图表观察同一份预算。',
    source: statisticsSource, sourceZh: statisticsZhSource,
  },
  {
    id: 'layout', section: 'legacy',
    title: 'Content & layout', titleZh: '内容与布局',
    hint: 'Choose a reading date and role, compare cards and open the details.',
    hintZh: '选择阅读日期与角色，比较卡片，再展开补充细节。',
    source: layoutSource, sourceZh: layoutZhSource,
  },
  {
    id: 'flow', section: 'legacy',
    title: 'Diagrams & flow', titleZh: '图解与流程',
    hint: 'Follow an input into one named calculation shared by every explanation.',
    hintZh: '跟随输入，观察节点与正文如何共享同一个命名计算。',
    source: flowSource, sourceZh: flowZhSource,
  },
  {
    id: 'tasks', section: 'legacy',
    title: 'Checklists & timing', titleZh: '清单与计时',
    hint: 'Check off preparation, build a reflection table and time a focus session.',
    hintZh: '勾选准备事项，生成回顾表，并为专注环节计时。',
    source: tasksSource, sourceZh: tasksZhSource,
  },
  {
    id: 'diagnostics',
    section: 'debug',
    title: 'Diagnostics',
    hint: 'Intentionally broken source',
    source: diagnosticsSource,
    titleZh: '调试示例',
    hintZh: '故意写错的源码',
    sourceZh: diagnosticsZhSource,
  },
  ...extensionExamples,
];

if (new Set(EXAMPLES.map(example => example.id)).size !== EXAMPLES.length) {
  throw new Error('Demo extensions conflict with a built-in example ID.');
}

export const DEFAULT_EXAMPLE_ID = 'classroom';

/** Historical source IDs stay available for drafts and links, outside the menu. */
export function isFeatureExample(example: Pick<PlaygroundExample, 'section'>): boolean {
  return example.section === 'legacy' || example.section === 'feature';
}

/** Keep old tour bookmarks useful after integrating their components. */
export function resolveExampleId(id: string | null | undefined): string | undefined {
  const resolved = id === 'tetris' || id === 'game-2048' ? 'games' : id === 'explore' ? 'functions' : id === 'gallery' ? 'forms' : id;
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
