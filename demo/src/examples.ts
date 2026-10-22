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

export interface PlaygroundExample {
  id: string;
  title: string;
  hint: string;
  source: string;
}

/** All playground documents use the explicit local-draft-1 syntax. */
export const EXAMPLES: PlaygroundExample[] = [
  { id: 'comparison', title: '并排比较与布局', hint: '网格、标签页与折叠内容', source: comparisonSource },
  { id: 'parameters', title: '表单与参数面板', hint: '实时参数、文本联动与条件清单', source: parametersSource },
  { id: 'checklist', title: '清单与数据表格', hint: '清单、进度、搜索、排序和分页', source: checklistSource },
  { id: 'charts', title: '图表与储蓄曲线', hint: '表格图表、环形占比与 LaTeX 绘图', source: chartsSource },
  { id: 'diagram', title: '交互图解', hint: '节点选择与参数曲线', source: diagramSource },
  { id: 'catalog', title: '本地组件目录', hint: '本地搜索、排序与分页', source: catalogSource },
  { id: 'planning', title: '计划、计时和分账', hint: '时间轴、计时器和实时分账', source: planningSource },
  { id: 'components', title: '内容与辅助组件', hint: '提示、选项、折叠和内容组织', source: componentsSource },
  { id: 'pricing', title: '方案计算器', hint: '人数、年度折扣与实时合计', source: pricingSource },
  { id: 'counter', title: '计数器', hint: '最小本地状态示例', source: counterSource },
  { id: 'gallery', title: '常用组件画廊', hint: '输入、独立组件和原样代码', source: gallerySource },
  { id: 'diagnostics', title: '诊断示例', hint: '故意写错的源码', source: diagnosticsSource },
];

export const DEFAULT_EXAMPLE_ID = 'pricing';
