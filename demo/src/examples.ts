import type { Language } from './i18n';
import comparisonSource from '../../examples/local/comparison.reactive.md?raw';
import parametersSource from '../../examples/local/parameters.reactive.md?raw';
import checklistSource from '../../examples/local/checklist.reactive.md?raw';
import chartsSource from '../../examples/local/charts.reactive.md?raw';
import diagramSource from '../../examples/local/diagram.reactive.md?raw';
import catalogSource from '../../examples/local/catalog.reactive.md?raw';
import planningSource from '../../examples/local/planning.reactive.md?raw';
import componentsSource from '../../examples/local/components.reactive.md?raw';
import pricingSource from '../../examples/local/pricing.reactive.md?raw';
import counterSource from '../../examples/local/counter.reactive.md?raw';
import gallerySource from '../../examples/local/gallery.reactive.md?raw';
import diagnosticsSource from '../../examples/local/diagnostics.reactive.md?raw';
import comparisonZhSource from '../../examples/local/zh/comparison.reactive.md?raw';
import parametersZhSource from '../../examples/local/zh/parameters.reactive.md?raw';
import checklistZhSource from '../../examples/local/zh/checklist.reactive.md?raw';
import chartsZhSource from '../../examples/local/zh/charts.reactive.md?raw';
import diagramZhSource from '../../examples/local/zh/diagram.reactive.md?raw';
import catalogZhSource from '../../examples/local/zh/catalog.reactive.md?raw';
import planningZhSource from '../../examples/local/zh/planning.reactive.md?raw';
import componentsZhSource from '../../examples/local/zh/components.reactive.md?raw';
import pricingZhSource from '../../examples/local/zh/pricing.reactive.md?raw';
import counterZhSource from '../../examples/local/zh/counter.reactive.md?raw';
import galleryZhSource from '../../examples/local/zh/gallery.reactive.md?raw';
import diagnosticsZhSource from '../../examples/local/zh/diagnostics.reactive.md?raw';

/**
 * One playground document in both languages. `title`, `hint` and `source`
 * stay English so existing consumers and tests keep working unchanged.
 */
export interface PlaygroundExample {
  id: string;
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
  title: string;
  hint: string;
  source: string;
}

/** All playground documents use the explicit local-draft-1 syntax. */
export const EXAMPLES: PlaygroundExample[] = [
  {
    id: 'comparison',
    title: 'Side-by-side comparison and layout',
    hint: 'Grids, tabs and collapsible content',
    source: comparisonSource,
    titleZh: '并排比较与布局',
    hintZh: '网格、标签页与折叠内容',
    sourceZh: comparisonZhSource,
  },
  {
    id: 'parameters',
    title: 'Forms and parameter panels',
    hint: 'Live parameters, text binding and conditional checklists',
    source: parametersSource,
    titleZh: '表单与参数面板',
    hintZh: '实时参数、文本联动与条件清单',
    sourceZh: parametersZhSource,
  },
  {
    id: 'checklist',
    title: 'Checklists and data tables',
    hint: 'Lists, progress, search, sorting and paging',
    source: checklistSource,
    titleZh: '清单与数据表格',
    hintZh: '清单、进度、搜索、排序和分页',
    sourceZh: checklistZhSource,
  },
  {
    id: 'charts',
    title: 'Charts and savings curves',
    hint: 'Table charts, donut shares and LaTeX plots',
    source: chartsSource,
    titleZh: '图表与储蓄曲线',
    hintZh: '表格图表、环形占比与 LaTeX 绘图',
    sourceZh: chartsZhSource,
  },
  {
    id: 'diagram',
    title: 'Interactive diagrams',
    hint: 'Node selection and parameter curves',
    source: diagramSource,
    titleZh: '交互图解',
    hintZh: '节点选择与参数曲线',
    sourceZh: diagramZhSource,
  },
  {
    id: 'catalog',
    title: 'Local component catalog',
    hint: 'Local search, sorting and paging',
    source: catalogSource,
    titleZh: '本地组件目录',
    hintZh: '本地搜索、排序与分页',
    sourceZh: catalogZhSource,
  },
  {
    id: 'planning',
    title: 'Planning, timing and bill splitting',
    hint: 'Timelines, timers and live bill splitting',
    source: planningSource,
    titleZh: '计划、计时和分账',
    hintZh: '时间轴、计时器和实时分账',
    sourceZh: planningZhSource,
  },
  {
    id: 'components',
    title: 'Content and helper components',
    hint: 'Tooltips, choices, disclosures and content structure',
    source: componentsSource,
    titleZh: '内容与辅助组件',
    hintZh: '提示、选项、折叠和内容组织',
    sourceZh: componentsZhSource,
  },
  {
    id: 'pricing',
    title: 'Plan calculator',
    hint: 'Headcount, annual discount and live totals',
    source: pricingSource,
    titleZh: '方案计算器',
    hintZh: '人数、年度折扣与实时合计',
    sourceZh: pricingZhSource,
  },
  {
    id: 'counter',
    title: 'Counter',
    hint: 'Smallest local state example',
    source: counterSource,
    titleZh: '计数器',
    hintZh: '最小本地状态示例',
    sourceZh: counterZhSource,
  },
  {
    id: 'gallery',
    title: 'Common component gallery',
    hint: 'Inputs, standalone components and code as-is',
    source: gallerySource,
    titleZh: '常用组件画廊',
    hintZh: '输入、独立组件和原样代码',
    sourceZh: galleryZhSource,
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics example',
    hint: 'Intentionally broken source',
    source: diagnosticsSource,
    titleZh: '诊断示例',
    hintZh: '故意写错的源码',
    sourceZh: diagnosticsZhSource,
  },
];

export const DEFAULT_EXAMPLE_ID = 'pricing';

/** Resolve an example's title, hint and source for the active language. */
export function localizedExample(example: PlaygroundExample, language: Language): LocalizedExample {
  return language === 'zh'
    ? { id: example.id, title: example.titleZh, hint: example.hintZh, source: example.sourceZh }
    : { id: example.id, title: example.title, hint: example.hint, source: example.source };
}

/** Every example resolved for the active language, in catalog order. */
export function localizedExamples(language: Language): LocalizedExample[] {
  return EXAMPLES.map((example) => localizedExample(example, language));
}

/** Shorthand for the active-language source of one example. */
export function exampleSource(example: PlaygroundExample, language: Language): string {
  return localizedExample(example, language).source;
}
