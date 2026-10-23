/**
 * Catalog of `local-draft-1` native components offered by the editor toolbar.
 *
 * Templates stay as close to the documented authoring syntax as possible:
 * - `{{bind:base}}` is resolved by `renderNativeSnippet` to a fresh bind name.
 * - `{{selection}}`, `{{selection:fallback}}`, `{{caret}}` and `{{select:value}}`
 *   are intentionally left for the toolbar's `insertTemplate` handler.
 * - Leaf components never receive a closing tag; container bodies use blank
 *   lines so inserted Markdown keeps a natural block layout.
 */

export type NativeComponentGroupId = 'input' | 'action' | 'layout' | 'data' | 'hint';

export interface NativeComponentGroup {
  id: NativeComponentGroupId;
  label: string;
}

export interface NativeComponentDefinition {
  id: string;
  label: string;
  description: string;
  group: NativeComponentGroupId;
  keywords: string[];
  inline?: boolean;
  template: string;
}

export const NATIVE_COMPONENT_GROUPS: readonly NativeComponentGroup[] = [
  { id: 'input', label: '输入控件' },
  { id: 'action', label: '交互工具' },
  { id: 'layout', label: '内容组织' },
  { id: 'data', label: '数据可视化' },
  { id: 'hint', label: '提示反馈' },
];

export const NATIVE_COMPONENTS: readonly NativeComponentDefinition[] = [
  /* Input ------------------------------------------------------------- */
  {
    id: 'slider',
    label: '滑块',
    description: '拖动滑块在指定范围内选择一个数值。',
    group: 'input',
    keywords: ['slider', '滑块', '范围', '数值', '拖动', 'range'],
    template: '<slider bind="{{bind:amount}}" label="数量" initial="10" min="0" max="100" step="1">',
  },
  {
    id: 'number',
    label: '数字输入',
    description: '输入精确数字，可限制范围和步长。',
    group: 'input',
    keywords: ['number', '数字', '数值', '输入', '步长'],
    template: '<number bind="{{bind:quantity}}" label="数量" initial="1" min="0" max="100" step="1">',
  },
  {
    id: 'input',
    label: '单行文本',
    description: '输入姓名、标题等单行文本。',
    group: 'input',
    keywords: ['input', '文本', '单行', '输入框', 'text'],
    template: '<input bind="{{bind:name}}" label="名称" placeholder="请输入名称">',
  },
  {
    id: 'textarea',
    label: '多行文本',
    description: '输入说明、备注等多行文字。',
    group: 'input',
    keywords: ['textarea', '文本域', '多行', '说明', '备注'],
    template:
      '<textarea bind="{{bind:message}}" label="详细说明" placeholder="请输入详细说明" rows="4">',
  },
  {
    id: 'toggle',
    label: '开关',
    description: '在开启与关闭之间切换一个布尔选项。',
    group: 'input',
    keywords: ['toggle', '开关', '布尔', '启用', '切换'],
    template: '<toggle bind="{{bind:enabled}}" label="启用选项">',
  },
  {
    id: 'checkbox',
    label: '复选框',
    description: '勾选或取消一个布尔选项。',
    group: 'input',
    keywords: ['checkbox', '复选', '勾选', '布尔', '确认'],
    template: '<checkbox bind="{{bind:confirmed}}" label="确认选项">',
  },
  {
    id: 'date',
    label: '日期选择',
    description: '选择一个日期，未选择时为空字符串。',
    group: 'input',
    keywords: ['date', '日期', '日历', '时间'],
    template: '<date bind="{{bind:date}}" label="选择日期">',
  },
  {
    id: 'choices',
    label: '选项卡片',
    description: '从多个选项卡中选择一项。',
    group: 'input',
    keywords: ['choices', '选项', '选择', '卡片', '单选'],
    template: [
      '<choices bind="{{bind:plan}}" label="选择方案">',
      '<option value="basic">基础版</option>',
      '<option value="pro">专业版</option>',
      '</choices>',
    ].join('\n'),
  },

  /* Action ------------------------------------------------------------ */
  {
    id: 'counter',
    label: '计数器',
    description: '通过加减按钮调整整数，并可一键重置。',
    group: 'action',
    keywords: ['counter', '计数', '加减', '整数', '调整'],
    template: '<counter bind="{{bind:count}}" label="计数" initial="0" min="0" max="99">',
  },
  {
    id: 'timer',
    label: '倒计时',
    description: '启动、暂停和重置一段专注计时。',
    group: 'action',
    keywords: ['timer', '计时', '倒计时', '专注', '秒'],
    template: '<timer bind="{{bind:remaining}}" label="专注计时" duration="60">',
  },
  {
    id: 'checklist',
    label: '任务清单',
    description: '用可勾选的任务列表记录完成情况。',
    group: 'action',
    keywords: ['checklist', '清单', '任务', '勾选', '待办'],
    template: [
      '<checklist bind="{{bind:done}}" label="完成清单">',
      '- [ ] 第一项任务',
      '- [ ] 第二项任务',
      '- [ ] 第三项任务',
      '</checklist>',
    ].join('\n'),
  },
  {
    id: 'progress',
    label: '进度条',
    description: '展示 0 到 100 之间的完成进度。',
    group: 'action',
    keywords: ['progress', '进度', '完成度', '进度条'],
    template: '<progress label="完成进度" value="{{ 40 }}">',
  },

  /* Layout ------------------------------------------------------------ */
  {
    id: 'panel',
    label: '参数面板',
    description: '把一组控件包进面板，并附带恢复默认按钮。',
    group: 'layout',
    keywords: ['panel', '面板', '参数', '重置', '表单'],
    template: ['<panel title="参数面板">', '{{selection:示例内容}}', '</panel>'].join('\n'),
  },
  {
    id: 'card',
    label: '内容卡片',
    description: '用卡片组织一段独立内容。',
    group: 'layout',
    keywords: ['card', '卡片', '容器', '内容'],
    template: ['<card title="内容卡片">', '{{selection:示例内容}}', '</card>'].join('\n'),
  },
  {
    id: 'if',
    label: '条件区域',
    description: '只有条件为真时才显示其中内容。',
    group: 'layout',
    keywords: ['if', '条件', '判断', '显示', 'when'],
    template: ['<if when="{{ {{select:true}} }}">', '{{selection:示例内容}}', '</if>'].join('\n'),
  },
  {
    id: 'tabs',
    label: '标签页',
    description: '把内容分到多个可切换的标签页中。',
    group: 'layout',
    keywords: ['tabs', '标签页', '切换', '分组'],
    template: [
      '<tabs label="内容标签页">',
      '<tab label="标签一">',
      '{{selection:示例内容}}',
      '</tab>',
      '',
      '<tab label="标签二">',
      '第二个标签页的内容。',
      '</tab>',
      '</tabs>',
    ].join('\n'),
  },
  {
    id: 'accordion',
    label: '折叠面板',
    description: '把说明放进可展开和收起的条目。',
    group: 'layout',
    keywords: ['accordion', '折叠', '展开', '问答', 'disclosure'],
    template: [
      '<accordion label="常见问题">',
      '<disclosure label="问题一">',
      '{{selection:示例内容}}',
      '</disclosure>',
      '',
      '<disclosure label="问题二">',
      '第二个条目的说明。',
      '</disclosure>',
      '</accordion>',
    ].join('\n'),
  },

  /* Data -------------------------------------------------------------- */
  {
    id: 'chart',
    label: '柱状图',
    description: '把 Markdown 表格转换成柱状图。',
    group: 'data',
    keywords: ['chart', '图表', '柱状图', 'bar', '表格'],
    template: [
      '<chart kind="bar" title="分类对比" y-label="数值">',
      '| 项目 | 数值 |',
      '| --- | ---: |',
      '| 项目甲 | 20 |',
      '| 项目乙 | 35 |',
      '</chart>',
    ].join('\n'),
  },
  {
    id: 'table',
    label: '增强表格',
    description: '带搜索、排序和分页的 Markdown 表格。',
    group: 'data',
    keywords: ['table', '表格', '搜索', '排序', '分页'],
    template: [
      '<table label="数据表格" page-size="5">',
      '| 名称 | 分类 | 数值 |',
      '| --- | --- | ---: |',
      '| 项目甲 | 分类一 | 20 |',
      '| 项目乙 | 分类二 | 35 |',
      '</table>',
    ].join('\n'),
  },
  {
    id: 'timeline',
    label: '时间轴',
    description: '用表格展示任务的开始时间与时长。',
    group: 'data',
    keywords: ['timeline', '时间轴', '计划', '时长', '日程'],
    template: [
      '<timeline title="任务时间轴">',
      '| 事项 | 开始 | 时长 | 说明 |',
      '| --- | ---: | ---: | --- |',
      '| 准备 | 0 | 10 | 列出所需材料 |',
      '| 执行 | 10 | 20 | 完成主要内容 |',
      '| 检查 | 30 | 5 | 复核结果 |',
      '</timeline>',
    ].join('\n'),
  },
  {
    id: 'diagram',
    label: '交互图解',
    description: '用节点和连线展示流程，可点击查看说明。',
    group: 'data',
    keywords: ['diagram', '图解', '流程', '节点', '连线', 'node', 'edge'],
    template: [
      '<diagram label="流程示意">',
      '<node id="start" label="开始">',
      '流程起点。',
      '</node>',
      '',
      '<node id="process" label="处理">',
      '执行主要步骤。',
      '</node>',
      '',
      '<node id="end" label="结束">',
      '查看结果。',
      '</node>',
      '',
      '<edge from="start" to="process" label="进入">',
      '<edge from="process" to="end" label="完成">',
      '</diagram>',
    ].join('\n'),
  },
  {
    id: 'plot',
    label: '函数曲线',
    description: '用 LaTeX 公式绘制一条函数曲线。',
    group: 'data',
    keywords: ['plot', '曲线', '函数', '公式', 'latex', 'math'],
    template: ['<plot min="-5" max="5" label="函数曲线">', '$$ y = x^2 $$', '</plot>'].join('\n'),
  },

  /* Hint -------------------------------------------------------------- */
  {
    id: 'alert',
    label: '提示框',
    description: '用不同语气突出普通、成功或警告信息。',
    group: 'hint',
    keywords: ['alert', '提示', '警告', '通知', '信息'],
    template: [
      '<alert tone="info" title="提示">',
      '{{selection:示例内容}}',
      '</alert>',
    ].join('\n'),
  },
  {
    id: 'badge',
    label: '徽标',
    description: '在句子里显示一个简短状态标记。',
    group: 'hint',
    keywords: ['badge', '徽标', '标签', '状态', '行内'],
    inline: true,
    template: '<badge tone="success">标签</badge>',
  },
  {
    id: 'tooltip',
    label: '行内提示',
    description: '为句中的词语附加悬停或聚焦说明。',
    group: 'hint',
    keywords: ['tooltip', '提示', '悬停', '说明', '行内'],
    inline: true,
    template: '<tooltip text="这里显示补充说明。">悬停查看</tooltip>',
  },
];

const BIND_TOKEN = /\{\{bind:([^{}]+)\}\}/g;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

function collectIdentifiers(source: string): Set<string> {
  return new Set(source.match(IDENTIFIER) ?? []);
}

function normalizeBindBase(rawBase: string): string {
  const cleaned = rawBase.trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!cleaned) return 'value';
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function uniqueBindName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/**
 * Render one toolbar template for insertion into `source`.
 *
 * Only `{{bind:base}}` is resolved here. Selection, caret and selectable tokens
 * stay intact for the toolbar's `insertTemplate` step. `selectedText` is kept
 * for future use; it never replaces the tokens here.
 */
export function renderNativeSnippet(
  component: NativeComponentDefinition,
  source: string,
  selectedText?: string,
): string {
  void selectedText;
  const used = collectIdentifiers(source);
  const rendered = new Map<string, string>();

  return component.template.replace(BIND_TOKEN, (_token: string, rawBase: string) => {
    const key = rawBase.trim();
    const existing = rendered.get(key);
    if (existing) return existing;

    const name = uniqueBindName(normalizeBindBase(key), used);
    used.add(name);
    rendered.set(key, name);
    return name;
  });
}
