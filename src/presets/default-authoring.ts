import type { LocalComponentAuthoring, LocalComponentText } from '../sdk/types';

/**
 * Authoring metadata for the default preset.
 *
 * This is the single home for default component titles, descriptions,
 * categories, keywords and insertion templates. The default manifests in
 * `default-components.ts` carry the canonical English forms, while the editor
 * catalog reads this module directly so localized templates and search
 * keywords do not need a second hand-maintained catalog.
 *
 * Everything here is bounded JSON data: no functions, React or DOM access.
 */

export type DefaultAuthoringGroupId = 'input' | 'action' | 'layout' | 'data' | 'hint';
export type DefaultAuthoringLocale = 'en' | 'zh';

export interface DefaultAuthoringGroup {
  readonly id: DefaultAuthoringGroupId;
  readonly title: LocalComponentText;
}

/** One default component's localized authoring data. */
export interface DefaultComponentAuthoring {
  readonly title: LocalComponentText;
  readonly description: LocalComponentText;
  readonly category: DefaultAuthoringGroupId;
  /** Locale-keyed insertion templates; `<default>` is not used. */
  readonly insertText: LocalComponentText;
  readonly keywords: Readonly<Record<DefaultAuthoringLocale, readonly string[]>>;
  /** Inline components are inserted without block padding. */
  readonly inline?: boolean;
  /** Part of the legacy extended catalog retained for compatibility. */
  readonly extended?: boolean;
}

export const DEFAULT_AUTHORING_GROUPS: readonly DefaultAuthoringGroup[] = Object.freeze([
  { id: 'input', title: { en: 'Input controls', zh: '输入控件' } },
  { id: 'action', title: { en: 'Interactive tools', zh: '交互工具' } },
  { id: 'layout', title: { en: 'Content layout', zh: '内容组织' } },
  { id: 'data', title: { en: 'Data visualization', zh: '数据可视化' } },
  { id: 'hint', title: { en: 'Feedback', zh: '提示反馈' } },
] as const satisfies readonly DefaultAuthoringGroup[]);

const GROUP_IDS = new Set<string>(DEFAULT_AUTHORING_GROUPS.map((group) => group.id));

/**
 * Default catalog order: the legacy extended entries first, then the original
 * core entries. Object key order is the source of this order.
 */
const AUTHORING_DATA = {
    jump: {
      title: { en: 'Jump and anchor', zh: '跳转与锚点' },
      description: {
        en: 'Link to a named position in this document.',
        zh: '跳到当前文档中的指定位置。',
      },
      category: 'action',
      keywords: { en: ['jump', 'anchor', 'navigation'], zh: ['跳转', '锚点', '导航'] },
      insertText: {
        en: '<jump to="{{bind:destination}}" appearance="button" color="#2563eb">View results</jump>\n\n<anchor id="{{bind:destination}}">\n\n{{selection:Results appear here.}}',
        zh: '<jump to="{{bind:destination}}" appearance="button" color="#2563eb">查看结果</jump>\n\n<anchor id="{{bind:destination}}">\n\n{{selection:结果显示在这里。}}',
      },
      extended: true,
    },
    anchor: {
      title: { en: 'Anchor', zh: '锚点' },
      description: {
        en: 'Name a destination for document links.',
        zh: '为文档内的跳转指定目标位置。',
      },
      category: 'layout',
      keywords: { en: ['anchor', 'target', 'destination'], zh: ['锚点', '目标', '位置'] },
      insertText: {
        en: '<anchor id="{{bind:destination}}">',
        zh: '<anchor id="{{bind:destination}}">',
      },
      extended: true,
    },
    text: {
      title: { en: 'Colored text', zh: '文字颜色' },
      description: {
        en: 'Give selected words a foreground color.',
        zh: '为选中的局部文字指定颜色。',
      },
      category: 'hint',
      keywords: { en: ['text', 'color', 'foreground'], zh: ['文字', '颜色', '前景'] },
      inline: true,
      insertText: {
        en: '<text color="#a2273a">{{selection:Important reminder}}</text>',
        zh: '<text color="#a2273a">{{selection:重要提醒}}</text>',
      },
      extended: true,
    },
    section: {
      title: { en: 'Colored section', zh: '正文颜色' },
      description: {
        en: 'Apply a shared text color to several paragraphs.',
        zh: '为一段或多段正文指定统一颜色。',
      },
      category: 'layout',
      keywords: { en: ['section', 'color', 'paragraph'], zh: ['正文', '段落', '颜色'] },
      insertText: {
        en: '<section color="#45536f">\n\n{{selection:Your paragraphs go here.}}\n\n</section>',
        zh: '<section color="#45536f">\n\n{{selection:在这里填写正文。}}\n\n</section>',
      },
      extended: true,
    },
    'multi-select': {
      title: { en: 'Multiple selection', zh: '多选' },
      description: {
        en: 'Choose up to two items and read their values.',
        zh: '最多选择两个选项，公开选项值数组。',
      },
      category: 'input',
      keywords: { en: ['multiple', 'select', 'subjects', 'checkbox'], zh: ['多选', '选项', '主题'] },
      insertText: {
        en: '<multi-select bind="{{bind:subjects}}" label="Subjects" max-selected="2">\n<option value="math">Math</option>\n<option value="physics">Physics</option>\n<option value="chemistry">Chemistry</option>\n</multi-select>',
        zh: '<multi-select bind="{{bind:subjects}}" label="主题" max-selected="2">\n<option value="math">数学</option>\n<option value="physics">物理</option>\n<option value="chemistry">化学</option>\n</multi-select>',
      },
      extended: true,
    },
    'range-slider': {
      title: { en: 'Interval slider', zh: '区间滑块' },
      description: {
        en: 'Choose the lower and upper bounds of an interval.',
        zh: '同时选择区间的起点和终点。',
      },
      category: 'input',
      keywords: { en: ['range', 'interval', 'slider', 'bounds'], zh: ['区间', '滑块', '上下限'] },
      insertText: {
        en: '<range-slider label="Interval" bind-start="{{bind:low}}" bind-end="{{bind:high}}" initial-start="20" initial-end="80" min="0" max="100" step="1">',
        zh: '<range-slider label="观察区间" bind-start="{{bind:low}}" bind-end="{{bind:high}}" initial-start="20" initial-end="80" min="0" max="100" step="1">',
      },
      extended: true,
    },
    coordinate: {
      title: { en: 'Coordinate point', zh: '二维坐标' },
      description: {
        en: 'Drag a point or change its two coordinates.',
        zh: '拖动坐标点，或直接修改两个坐标。',
      },
      category: 'input',
      keywords: { en: ['coordinate', 'point', 'drag', 'geometry'], zh: ['坐标', '拖动', '几何'] },
      insertText: {
        en: '<coordinate label="Point" bind-x="{{bind:px}}" bind-y="{{bind:py}}" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5">',
        zh: '<coordinate label="坐标点" bind-x="{{bind:px}}" bind-y="{{bind:py}}" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5">',
      },
      extended: true,
    },
    quiz: {
      title: { en: 'Practice question', zh: '练习题' },
      description: {
        en: 'Check an answer and read a short explanation.',
        zh: '检查答案并阅读简短解析。',
      },
      category: 'action',
      keywords: { en: ['quiz', 'practice', 'answer', 'learn'], zh: ['练习', '题目', '答案'] },
      insertText: {
        en: '<quiz type="choice" label="What is 2 + 3?" answer="b" explanation="The sum is 5.">\n<option value="a">4</option>\n<option value="b">5</option>\n</quiz>',
        zh: '<quiz type="choice" label="2 + 3 等于多少？" answer="b" explanation="相加得到 5。">\n<option value="a">4</option>\n<option value="b">5</option>\n</quiz>',
      },
      extended: true,
    },
    steps: {
      title: { en: 'Guided steps', zh: '分步阅读' },
      description: {
        en: 'Read instructions one step at a time.',
        zh: '按顺序阅读说明，内置上一步和下一步。',
      },
      category: 'layout',
      keywords: { en: ['steps', 'guide', 'previous', 'next'], zh: ['步骤', '引导', '下一步'] },
      insertText: {
        en: '<steps label="Learning path" bind="{{bind:lesson}}">\n<step label="Observe">\nChange a parameter.\n</step>\n<step label="Practice">\nCheck an answer.\n</step>\n</steps>',
        zh: '<steps label="学习路线" bind="{{bind:lesson}}">\n<step label="观察">\n调整参数。\n</step>\n<step label="练习">\n检查答案。\n</step>\n</steps>',
      },
      extended: true,
    },
    slider: {
      title: { en: 'Slider', zh: '滑块' },
      description: {
        en: 'Drag the slider to choose a number within a range.',
        zh: '拖动滑块在指定范围内选择一个数值。',
      },
      category: 'input',
      keywords: { en: ['slider', 'range', 'number', 'drag', 'value'], zh: ['滑块', '范围', '数值', '拖动', '滑动'] },
      insertText: {
        en: '<slider bind="{{bind:amount}}" label="Amount" initial="10" min="0" max="100" step="1">',
        zh: '<slider bind="{{bind:amount}}" label="数量" initial="10" min="0" max="100" step="1">',
      },
    },
    number: {
      title: { en: 'Number input', zh: '数字输入' },
      description: {
        en: 'Enter an exact number with an optional range and step.',
        zh: '输入精确数字，可限制范围和步长。',
      },
      category: 'input',
      keywords: { en: ['number', 'numeric', 'input', 'step', 'quantity'], zh: ['数字', '数值', '输入', '步长', '数量'] },
      insertText: {
        en: '<number bind="{{bind:quantity}}" label="Quantity" initial="1" min="0" max="100" step="1">',
        zh: '<number bind="{{bind:quantity}}" label="数量" initial="1" min="0" max="100" step="1">',
      },
    },
    input: {
      title: { en: 'Single-line text', zh: '单行文本' },
      description: {
        en: 'Enter a name, title or other single-line text.',
        zh: '输入姓名、标题等单行文本。',
      },
      category: 'input',
      keywords: { en: ['input', 'text', 'single-line', 'field', 'name'], zh: ['文本', '单行', '输入框', '名称', '输入'] },
      insertText: {
        en: '<input bind="{{bind:name}}" label="Name" placeholder="Enter a name">',
        zh: '<input bind="{{bind:name}}" label="名称" placeholder="请输入名称">',
      },
    },
    textarea: {
      title: { en: 'Multi-line text', zh: '多行文本' },
      description: {
        en: 'Enter notes, descriptions or other multi-line text.',
        zh: '输入说明、备注等多行文字。',
      },
      category: 'input',
      keywords: { en: ['textarea', 'text area', 'multi-line', 'notes', 'description'], zh: ['文本域', '多行', '说明', '备注', '详细'] },
      insertText: {
        en: '<textarea bind="{{bind:message}}" label="Details" placeholder="Enter details" rows="4">',
        zh: '<textarea bind="{{bind:message}}" label="详细说明" placeholder="请输入详细说明" rows="4">',
      },
    },
    toggle: {
      title: { en: 'Toggle', zh: '开关' },
      description: {
        en: 'Switch a boolean option on or off.',
        zh: '在开启与关闭之间切换一个布尔选项。',
      },
      category: 'input',
      keywords: { en: ['toggle', 'switch', 'boolean', 'enable', 'on'], zh: ['开关', '布尔', '启用', '切换', '选项'] },
      insertText: {
        en: '<toggle bind="{{bind:enabled}}" label="Enable option">',
        zh: '<toggle bind="{{bind:enabled}}" label="启用选项">',
      },
    },
    checkbox: {
      title: { en: 'Checkbox', zh: '复选框' },
      description: {
        en: 'Check or uncheck a boolean option.',
        zh: '勾选或取消一个布尔选项。',
      },
      category: 'input',
      keywords: { en: ['checkbox', 'check', 'boolean', 'confirm', 'option'], zh: ['复选', '勾选', '布尔', '确认', '选项'] },
      insertText: {
        en: '<checkbox bind="{{bind:confirmed}}" label="Confirm option">',
        zh: '<checkbox bind="{{bind:confirmed}}" label="确认选项">',
      },
    },
    date: {
      title: { en: 'Date picker', zh: '日期选择' },
      description: {
        en: 'Pick a date; the value stays empty until one is chosen.',
        zh: '选择一个日期，未选择时为空字符串。',
      },
      category: 'input',
      keywords: { en: ['date', 'calendar', 'picker', 'day'], zh: ['日期', '日历', '时间', '选择'] },
      insertText: {
        en: '<date bind="{{bind:date}}" label="Pick a date">',
        zh: '<date bind="{{bind:date}}" label="选择日期">',
      },
    },
    choices: {
      title: { en: 'Choice cards', zh: '选项卡片' },
      description: {
        en: 'Pick one option from a set of cards.',
        zh: '从多个选项卡中选择一项。',
      },
      category: 'input',
      keywords: { en: ['choices', 'options', 'cards', 'select', 'radio'], zh: ['选项', '选择', '卡片', '单选', '方案'] },
      insertText: {
        en: '<choices bind="{{bind:plan}}" label="Choose a plan">\n<option value="basic">Basic</option>\n<option value="pro">Pro</option>\n</choices>',
        zh: '<choices bind="{{bind:plan}}" label="选择方案">\n<option value="basic">基础版</option>\n<option value="pro">专业版</option>\n</choices>',
      },
    },
    counter: {
      title: { en: 'Counter', zh: '计数器' },
      description: {
        en: 'Adjust an integer with plus and minus buttons, then reset it in one click.',
        zh: '通过加减按钮调整整数，并可一键重置。',
      },
      category: 'action',
      keywords: { en: ['counter', 'count', 'plus', 'minus', 'integer'], zh: ['计数', '加减', '整数', '调整', '重置'] },
      insertText: {
        en: '<counter bind="{{bind:count}}" label="Count" initial="0" min="0" max="99">',
        zh: '<counter bind="{{bind:count}}" label="计数" initial="0" min="0" max="99">',
      },
    },
    timer: {
      title: { en: 'Countdown timer', zh: '倒计时' },
      description: {
        en: 'Start, pause and reset a focus timer.',
        zh: '启动、暂停和重置一段专注计时。',
      },
      category: 'action',
      keywords: { en: ['timer', 'countdown', 'focus', 'seconds', 'pause'], zh: ['计时', '倒计时', '专注', '秒', '暂停'] },
      insertText: {
        en: '<timer bind="{{bind:remaining}}" label="Focus timer" duration="60">',
        zh: '<timer bind="{{bind:remaining}}" label="专注计时" duration="60">',
      },
    },
    checklist: {
      title: { en: 'Checklist', zh: '任务清单' },
      description: {
        en: 'Track completion with a checkable task list.',
        zh: '用可勾选的任务列表记录完成情况。',
      },
      category: 'action',
      keywords: { en: ['checklist', 'tasks', 'todo', 'check', 'done'], zh: ['清单', '任务', '勾选', '待办', '完成'] },
      insertText: {
        en: '<checklist bind="{{bind:done}}" label="Task checklist">\n- [ ] First task\n- [ ] Second task\n- [ ] Third task\n</checklist>',
        zh: '<checklist bind="{{bind:done}}" label="完成清单">\n- [ ] 第一项任务\n- [ ] 第二项任务\n- [ ] 第三项任务\n</checklist>',
      },
    },
    progress: {
      title: { en: 'Progress bar', zh: '进度条' },
      description: {
        en: 'Show completion from 0 to 100.',
        zh: '展示 0 到 100 之间的完成进度。',
      },
      category: 'action',
      keywords: { en: ['progress', 'completion', 'bar', 'percent'], zh: ['进度', '完成度', '进度条', '百分比'] },
      insertText: {
        en: '<progress label="Progress" value="{{ 40 }}">',
        zh: '<progress label="完成进度" value="{{ 40 }}">',
      },
    },
    panel: {
      title: { en: 'Parameter panel', zh: '参数面板' },
      description: {
        en: 'Group controls in a panel with a restore-defaults button.',
        zh: '把一组控件包进面板，并附带恢复默认按钮。',
      },
      category: 'layout',
      keywords: { en: ['panel', 'parameters', 'reset', 'form', 'group'], zh: ['面板', '参数', '重置', '表单', '控件'] },
      insertText: {
        en: '<panel title="Parameters">\n{{selection:Sample content}}\n</panel>',
        zh: '<panel title="参数面板">\n{{selection:示例内容}}\n</panel>',
      },
    },
    card: {
      title: { en: 'Content card', zh: '内容卡片' },
      description: {
        en: 'Organize a self-contained piece of content in a card.',
        zh: '用卡片组织一段独立内容。',
      },
      category: 'layout',
      keywords: { en: ['card', 'container', 'content', 'section'], zh: ['卡片', '容器', '内容', '区块'] },
      insertText: {
        en: '<card title="Content card">\n{{selection:Sample content}}\n</card>',
        zh: '<card title="内容卡片">\n{{selection:示例内容}}\n</card>',
      },
    },
    if: {
      title: { en: 'Conditional section', zh: '条件区域' },
      description: {
        en: 'Show the contents only when a condition is true.',
        zh: '只有条件为真时才显示其中内容。',
      },
      category: 'layout',
      keywords: { en: ['if', 'condition', 'when', 'show', 'visible'], zh: ['条件', '判断', '显示', '当'] },
      insertText: {
        en: '<if when="{{ {{select:true}} }}">\n{{selection:Sample content}}\n</if>',
        zh: '<if when="{{ {{select:true}} }}">\n{{selection:示例内容}}\n</if>',
      },
    },
    tabs: {
      title: { en: 'Tabs', zh: '标签页' },
      description: {
        en: 'Split content across switchable tabs.',
        zh: '把内容分到多个可切换的标签页中。',
      },
      category: 'layout',
      keywords: { en: ['tabs', 'switch', 'sections', 'groups'], zh: ['标签页', '切换', '分组', '选项卡'] },
      insertText: {
        en: '<tabs label="Content tabs">\n<tab label="Tab one">\n{{selection:Sample content}}\n</tab>\n\n<tab label="Tab two">\nContent for the second tab.\n</tab>\n</tabs>',
        zh: '<tabs label="内容标签页">\n<tab label="标签一">\n{{selection:示例内容}}\n</tab>\n\n<tab label="标签二">\n第二个标签页的内容。\n</tab>\n</tabs>',
      },
    },
    accordion: {
      title: { en: 'Accordion', zh: '折叠面板' },
      description: {
        en: 'Put notes into items that expand and collapse.',
        zh: '把说明放进可展开和收起的条目。',
      },
      category: 'layout',
      keywords: { en: ['accordion', 'collapse', 'expand', 'faq', 'disclosure'], zh: ['折叠', '展开', '问答', '手风琴', '条目'] },
      insertText: {
        en: '<accordion label="FAQ">\n<disclosure label="Question one">\n{{selection:Sample content}}\n</disclosure>\n\n<disclosure label="Question two">\nDetails for the second item.\n</disclosure>\n</accordion>',
        zh: '<accordion label="常见问题">\n<disclosure label="问题一">\n{{selection:示例内容}}\n</disclosure>\n\n<disclosure label="问题二">\n第二个条目的说明。\n</disclosure>\n</accordion>',
      },
    },
    chart: {
      title: { en: 'Bar chart', zh: '柱状图' },
      description: {
        en: 'Turn a Markdown table into a bar chart.',
        zh: '把 Markdown 表格转换成柱状图。',
      },
      category: 'data',
      keywords: { en: ['chart', 'bar', 'graph', 'table', 'data'], zh: ['图表', '柱状图', '表格', '数据', '对比'] },
      insertText: {
        en: '<chart kind="bar" title="Category comparison" y-label="Value">\n| Item | Value |\n| --- | ---: |\n| Item A | 20 |\n| Item B | 35 |\n</chart>',
        zh: '<chart kind="bar" title="分类对比" y-label="数值">\n| 项目 | 数值 |\n| --- | ---: |\n| 项目甲 | 20 |\n| 项目乙 | 35 |\n</chart>',
      },
    },
    table: {
      title: { en: 'Enhanced table', zh: '增强表格' },
      description: {
        en: 'A Markdown table with search, sorting and paging.',
        zh: '带搜索、排序和分页的 Markdown 表格。',
      },
      category: 'data',
      keywords: { en: ['table', 'search', 'sort', 'paging', 'data'], zh: ['表格', '搜索', '排序', '分页', '数据'] },
      insertText: {
        en: '<table label="Data table" page-size="5">\n| Name | Category | Value |\n| --- | --- | ---: |\n| Item A | Category one | 20 |\n| Item B | Category two | 35 |\n</table>',
        zh: '<table label="数据表格" page-size="5">\n| 名称 | 分类 | 数值 |\n| --- | --- | ---: |\n| 项目甲 | 分类一 | 20 |\n| 项目乙 | 分类二 | 35 |\n</table>',
      },
    },
    timeline: {
      title: { en: 'Timeline', zh: '时间轴' },
      description: {
        en: 'Show task start times and durations in a table.',
        zh: '用表格展示任务的开始时间与时长。',
      },
      category: 'data',
      keywords: { en: ['timeline', 'schedule', 'plan', 'duration', 'gantt'], zh: ['时间轴', '计划', '时长', '日程', '任务'] },
      insertText: {
        en: '<timeline title="Task timeline">\n| Task | Start | Duration | Notes |\n| --- | ---: | ---: | --- |\n| Prepare | 0 | 10 | List the materials |\n| Execute | 10 | 20 | Complete the main work |\n| Review | 30 | 5 | Check the results |\n</timeline>',
        zh: '<timeline title="任务时间轴">\n| 事项 | 开始 | 时长 | 说明 |\n| --- | ---: | ---: | --- |\n| 准备 | 0 | 10 | 列出所需材料 |\n| 执行 | 10 | 20 | 完成主要内容 |\n| 检查 | 30 | 5 | 复核结果 |\n</timeline>',
      },
    },
    diagram: {
      title: { en: 'Interactive diagram', zh: '交互图解' },
      description: {
        en: 'Show a flow with nodes and edges; click a node to read its notes.',
        zh: '用节点和连线展示流程，可点击查看说明。',
      },
      category: 'data',
      keywords: { en: ['diagram', 'flow', 'node', 'edge', 'graph'], zh: ['图解', '流程', '节点', '连线', '关系图'] },
      insertText: {
        en: '<diagram label="Flow overview">\n<node id="start" label="Start">\nWhere the flow begins.\n</node>\n\n<node id="process" label="Process">\nPerform the main step.\n</node>\n\n<node id="end" label="End">\nReview the result.\n</node>\n\n<edge from="start" to="process" label="Proceed">\n<edge from="process" to="end" label="Complete">\n</diagram>',
        zh: '<diagram label="流程示意">\n<node id="start" label="开始">\n流程起点。\n</node>\n\n<node id="process" label="处理">\n执行主要步骤。\n</node>\n\n<node id="end" label="结束">\n查看结果。\n</node>\n\n<edge from="start" to="process" label="进入">\n<edge from="process" to="end" label="完成">\n</diagram>',
      },
    },
    plot: {
      title: { en: 'Function plot', zh: '函数曲线' },
      description: {
        en: 'Plot a function curve from a LaTeX formula.',
        zh: '用 LaTeX 公式绘制一条函数曲线。',
      },
      category: 'data',
      keywords: { en: ['plot', 'curve', 'function', 'formula', 'latex', 'math'], zh: ['曲线', '函数', '公式', '数学', '绘图'] },
      insertText: {
        en: '<plot min="-5" max="5" label="Function plot">\n$$ y = x^2 $$\n</plot>',
        zh: '<plot min="-5" max="5" label="函数曲线">\n$$ y = x^2 $$\n</plot>',
      },
    },
    alert: {
      title: { en: 'Alert', zh: '提示框' },
      description: {
        en: 'Highlight info, success or warning messages with different tones.',
        zh: '用不同语气突出普通、成功或警告信息。',
      },
      category: 'hint',
      keywords: { en: ['alert', 'notice', 'warning', 'info', 'message'], zh: ['提示', '警告', '通知', '信息', '消息'] },
      insertText: {
        en: '<alert tone="info" title="Notice">\n{{selection:Sample content}}\n</alert>',
        zh: '<alert tone="info" title="提示">\n{{selection:示例内容}}\n</alert>',
      },
    },
    badge: {
      title: { en: 'Badge', zh: '徽标' },
      description: {
        en: 'Show a short status marker inside a sentence.',
        zh: '在句子里显示一个简短状态标记。',
      },
      category: 'hint',
      keywords: { en: ['badge', 'label', 'status', 'inline', 'tag'], zh: ['徽标', '标签', '状态', '行内', '标记'] },
      inline: true,
      insertText: {
        en: '<badge tone="success">Badge</badge>',
        zh: '<badge tone="success">标签</badge>',
      },
    },
    tooltip: {
      title: { en: 'Tooltip', zh: '行内提示' },
      description: {
        en: 'Attach a hover or focus note to a word in a sentence.',
        zh: '为句中的词语附加悬停或聚焦说明。',
      },
      category: 'hint',
      keywords: { en: ['tooltip', 'hint', 'hover', 'focus', 'inline'], zh: ['提示', '悬停', '说明', '行内', '气泡'] },
      inline: true,
      insertText: {
        en: '<tooltip text="Extra details appear here.">Hover to view</tooltip>',
        zh: '<tooltip text="这里显示补充说明。">悬停查看</tooltip>',
      },
    },
} as const satisfies Readonly<Record<string, DefaultComponentAuthoring>>;

export const DEFAULT_COMPONENT_AUTHORING: Readonly<Record<string, DefaultComponentAuthoring>> =
  Object.freeze(AUTHORING_DATA);

/** Catalog order derived from the data record's insertion order. */
export const DEFAULT_AUTHORING_ORDER: readonly string[] = Object.freeze(
  Object.keys(DEFAULT_COMPONENT_AUTHORING),
);

export function defaultComponentAuthoring(name: string): DefaultComponentAuthoring | undefined {
  return Object.hasOwn(DEFAULT_COMPONENT_AUTHORING, name)
    ? DEFAULT_COMPONENT_AUTHORING[name]
    : undefined;
}

/**
 * Explicit fallback order for authoring copy: requested locale, then English,
 * then Chinese, then the first declared value.
 */
export function pickDefaultAuthoringText(
  value: LocalComponentText | undefined,
  locale: string,
  fallback = '',
): string {
  if (value === undefined) return fallback;
  for (const key of [locale, 'en', 'zh']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  for (const candidate of Object.values(value)) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  return fallback;
}

export function defaultAuthoringGroupLabel(category: string, locale: string): string {
  const group = DEFAULT_AUTHORING_GROUPS.find((item) => item.id === category);
  return group ? pickDefaultAuthoringText(group.title, locale, group.id) : category;
}

/** Search terms from both languages, deduplicated case-insensitively. */
export function defaultAuthoringKeywords(name: string): readonly string[] | undefined {
  const data = defaultComponentAuthoring(name);
  if (!data) return undefined;
  const merged: string[] = [];
  for (const keyword of [...data.keywords.en, ...data.keywords.zh]) {
    const normalized = keyword.toLowerCase();
    if (!merged.some((existing) => existing.toLowerCase() === normalized)) merged.push(keyword);
  }
  return Object.freeze(merged);
}

/**
 * Canonical manifest authoring metadata: English titles and templates are the
 * portable form carried by `defaultPreset.components`. Localized templates stay
 * in this module and are consumed by the editor catalog directly.
 */
export function defaultManifestAuthoring(name: string): LocalComponentAuthoring | undefined {
  const data = defaultComponentAuthoring(name);
  if (!data) return undefined;
  const insertText = data.insertText.en;
  if (typeof insertText !== 'string' || insertText.trim() === '') return undefined;
  return {
    title: data.title,
    description: data.description,
    category: GROUP_IDS.has(data.category) ? data.category : undefined,
    insertText,
  } as LocalComponentAuthoring;
}
