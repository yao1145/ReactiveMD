/**
 * Typed copy for the source editor: toolbar chrome, command placeholders and
 * native-component picker text.
 *
 * English strings are the canonical defaults. Chinese strings use the wording
 * shipped in the demo. English native-component labels, descriptions and
 * templates live in `native-components.ts`; this module carries the Chinese
 * overrides plus the group names for both languages.
 */

import type { EditorLocale } from './types';

export interface EditorCommandCopy {
  boldPlaceholder: string;
  italicPlaceholder: string;
  strikePlaceholder: string;
  inlineCodePlaceholder: string;
  linkText: string;
  imageAlt: string;
  codeBlockPlaceholder: string;
  tableHeaders: readonly [string, string, string];
  tableRows: readonly [
    readonly [string, string, string],
    readonly [string, string, string],
  ];
}

export interface EditorToolbarCopy {
  toolbarLabel: string;
  headingLabels: readonly [string, string, string, string, string, string, string];
  headingLevelLabel(heading: string): string;
  headingMenuLabel: string;
  bold: string;
  italic: string;
  listLabel: string;
  listLabelWithType(list: string): string;
  listMenuLabel: string;
  listLabels: {
    bullet: string;
    ordered: string;
    task: string;
  };
  decreaseIndent: string;
  increaseIndent: string;
  insertLink: string;
  insert: string;
  insertMenuLabel: string;
  insertItems: {
    image: string;
    table: string;
    divider: string;
    codeBlock: string;
    inlineCode: string;
    strikethrough: string;
    quote: string;
  };
  emoji: string;
  insertEmojiMenuLabel: string;
  insertEmojiLabel(emoji: string): string;
  componentsTriggerLabel: string;
  componentsLabel: string;
  componentsCompactLabel: string;
  nativeMenuLabel: string;
  nativeTitle: string;
  closeNativeLabel: string;
  searchPlaceholder: string;
  searchLabel: string;
  nativeListLabel: string;
  noMatchingComponents: string;
  inlineBadge: string;
  historyLabel: string;
  undo: string;
  redo: string;
  download: string;
  more: string;
  moreMenuLabel: string;
  linkMenuItem: string;
}

export interface NativeComponentGroupCopy {
  input: string;
  action: string;
  layout: string;
  data: string;
  hint: string;
}

export interface NativeComponentCopy {
  label: string;
  description: string;
  keywords: readonly string[];
  template: string;
}

export interface NativeComponentCatalogCopy {
  groups: NativeComponentGroupCopy;
  /** Per-component Chinese overrides keyed by the stable component id. */
  components: Readonly<Record<string, NativeComponentCopy>>;
}

export interface EditorChromeCopy {
  /** Accessible name for the textarea when the host passes no ariaLabel. */
  sourceLabel: string;
  region: string;
  previewRegion: string;
  viewLabel: string;
  count(value: string): string;
  keyboardHint: string;
  edit: string;
  split: string;
  preview: string;
}

export const EDITOR_CHROME_COPY: Record<EditorLocale, EditorChromeCopy> = {
  en: {
    sourceLabel: 'Reactive MD source',
    region: 'Source editor',
    previewRegion: 'Document preview',
    viewLabel: 'Editor view',
    count: (value) => `${value} ${value === '1' ? 'character' : 'characters'}`,
    keyboardHint: 'Press Esc, then Tab to reach the toolbar',
    edit: 'Edit',
    split: 'Split',
    preview: 'Preview',
  },
  zh: {
    sourceLabel: 'Reactive MD 源码',
    region: '源码编辑器',
    previewRegion: '文档预览',
    viewLabel: '编辑器视图',
    count: (value) => `${value} 字`,
    keyboardHint: '按 Esc 再 Tab 可到工具条',
    edit: '编辑',
    split: '并排',
    preview: '预览',
  },
};

export const EDITOR_COMMAND_COPY: Record<EditorLocale, EditorCommandCopy> = {
  en: {
    boldPlaceholder: 'bold text',
    italicPlaceholder: 'italic text',
    strikePlaceholder: 'strikethrough text',
    inlineCodePlaceholder: 'code',
    linkText: 'link text',
    imageAlt: 'example image',
    codeBlockPlaceholder: 'Write code here',
    tableHeaders: ['Column 1', 'Column 2', 'Column 3'],
    tableRows: [
      ['Example 1', 'Example 2', 'Example 3'],
      ['Example 4', 'Example 5', 'Example 6'],
    ],
  },
  zh: {
    boldPlaceholder: '粗体文字',
    italicPlaceholder: '斜体文字',
    strikePlaceholder: '删除线文字',
    inlineCodePlaceholder: '代码',
    linkText: '链接文字',
    imageAlt: '示意图',
    codeBlockPlaceholder: '在这里写代码',
    tableHeaders: ['列 1', '列 2', '列 3'],
    tableRows: [
      ['示例 1', '示例 2', '示例 3'],
      ['示例 4', '示例 5', '示例 6'],
    ],
  },
};

export const EDITOR_TOOLBAR_COPY: Record<EditorLocale, EditorToolbarCopy> = {
  en: {
    toolbarLabel: 'Document editing toolbar',
    headingLabels: ['Body', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'],
    headingLevelLabel: (heading) => `Heading level: ${heading}`,
    headingMenuLabel: 'Heading level',
    bold: 'Bold',
    italic: 'Italic',
    listLabel: 'List',
    listLabelWithType: (list) => `List: ${list}`,
    listMenuLabel: 'List',
    listLabels: {
      bullet: 'Bullet list',
      ordered: 'Numbered list',
      task: 'Task list',
    },
    decreaseIndent: 'Decrease indent',
    increaseIndent: 'Increase indent',
    insertLink: 'Insert link',
    insert: 'Insert',
    insertMenuLabel: 'Insert content',
    insertItems: {
      image: 'Image',
      table: 'Table',
      divider: 'Divider',
      codeBlock: 'Code block',
      inlineCode: 'Inline code',
      strikethrough: 'Strikethrough',
      quote: 'Quote',
    },
    emoji: 'Emoji',
    insertEmojiMenuLabel: 'Insert emoji',
    insertEmojiLabel: (emoji) => `Insert emoji ${emoji}`,
    componentsTriggerLabel: 'Insert native component',
    componentsLabel: 'Components',
    componentsCompactLabel: 'Add',
    nativeMenuLabel: 'Insert native component',
    nativeTitle: 'Insert component',
    closeNativeLabel: 'Close component panel',
    searchPlaceholder: 'Search components, descriptions or keywords',
    searchLabel: 'Search native components',
    nativeListLabel: 'Native component list',
    noMatchingComponents: 'No matching components',
    inlineBadge: 'Inline',
    historyLabel: 'History and export',
    undo: 'Undo',
    redo: 'Redo',
    download: 'Download document',
    more: 'More',
    moreMenuLabel: 'More actions',
    linkMenuItem: 'Link',
  },
  zh: {
    toolbarLabel: '文档编辑工具栏',
    headingLabels: ['正文', '标题 1', '标题 2', '标题 3', '标题 4', '标题 5', '标题 6'],
    headingLevelLabel: (heading) => `标题级别：${heading}`,
    headingMenuLabel: '标题级别',
    bold: '加粗',
    italic: '斜体',
    listLabel: '列表',
    listLabelWithType: (list) => `列表：${list}`,
    listMenuLabel: '列表',
    listLabels: {
      bullet: '无序列表',
      ordered: '有序列表',
      task: '任务列表',
    },
    decreaseIndent: '减少缩进',
    increaseIndent: '增加缩进',
    insertLink: '插入链接',
    insert: '插入',
    insertMenuLabel: '插入内容',
    insertItems: {
      image: '图片',
      table: '表格',
      divider: '分隔线',
      codeBlock: '代码块',
      inlineCode: '行内代码',
      strikethrough: '删除线',
      quote: '引用',
    },
    emoji: '表情',
    insertEmojiMenuLabel: '插入表情',
    insertEmojiLabel: (emoji) => `插入表情 ${emoji}`,
    componentsTriggerLabel: '插入原生组件',
    componentsLabel: '插入组件',
    componentsCompactLabel: '添加',
    nativeMenuLabel: '插入原生组件',
    nativeTitle: '插入组件',
    closeNativeLabel: '关闭组件面板',
    searchPlaceholder: '搜索组件、说明或关键词',
    searchLabel: '搜索原生组件',
    nativeListLabel: '原生组件列表',
    noMatchingComponents: '没有匹配的组件',
    inlineBadge: '行内',
    historyLabel: '历史与导出',
    undo: '撤销',
    redo: '重做',
    download: '下载文档',
    more: '更多',
    moreMenuLabel: '更多操作',
    linkMenuItem: '链接',
  },
};

import { EXTENDED_NATIVE_COMPONENT_COPY_ZH } from './extended-native-components';

export const NATIVE_COMPONENT_CATALOG_COPY: Record<EditorLocale, NativeComponentCatalogCopy> = {
  en: {
    groups: {
      input: 'Input controls',
      action: 'Interactive tools',
      layout: 'Content layout',
      data: 'Data visualization',
      hint: 'Feedback',
    },
    components: {},
  },
  zh: {
    groups: {
      input: '输入控件',
      action: '交互工具',
      layout: '内容组织',
      data: '数据可视化',
      hint: '提示反馈',
    },
    components: {
      ...EXTENDED_NATIVE_COMPONENT_COPY_ZH,
      slider: {
        label: '滑块',
        description: '拖动滑块在指定范围内选择一个数值。',
        keywords: ['滑块', '范围', '数值', '拖动', '滑动'],
        template:
          '<slider bind="{{bind:amount}}" label="数量" initial="10" min="0" max="100" step="1">',
      },
      number: {
        label: '数字输入',
        description: '输入精确数字，可限制范围和步长。',
        keywords: ['数字', '数值', '输入', '步长', '数量'],
        template:
          '<number bind="{{bind:quantity}}" label="数量" initial="1" min="0" max="100" step="1">',
      },
      input: {
        label: '单行文本',
        description: '输入姓名、标题等单行文本。',
        keywords: ['文本', '单行', '输入框', '名称', '输入'],
        template: '<input bind="{{bind:name}}" label="名称" placeholder="请输入名称">',
      },
      textarea: {
        label: '多行文本',
        description: '输入说明、备注等多行文字。',
        keywords: ['文本域', '多行', '说明', '备注', '详细'],
        template:
          '<textarea bind="{{bind:message}}" label="详细说明" placeholder="请输入详细说明" rows="4">',
      },
      toggle: {
        label: '开关',
        description: '在开启与关闭之间切换一个布尔选项。',
        keywords: ['开关', '布尔', '启用', '切换', '选项'],
        template: '<toggle bind="{{bind:enabled}}" label="启用选项">',
      },
      checkbox: {
        label: '复选框',
        description: '勾选或取消一个布尔选项。',
        keywords: ['复选', '勾选', '布尔', '确认', '选项'],
        template: '<checkbox bind="{{bind:confirmed}}" label="确认选项">',
      },
      date: {
        label: '日期选择',
        description: '选择一个日期，未选择时为空字符串。',
        keywords: ['日期', '日历', '时间', '选择'],
        template: '<date bind="{{bind:date}}" label="选择日期">',
      },
      choices: {
        label: '选项卡片',
        description: '从多个选项卡中选择一项。',
        keywords: ['选项', '选择', '卡片', '单选', '方案'],
        template: [
          '<choices bind="{{bind:plan}}" label="选择方案">',
          '<option value="basic">基础版</option>',
          '<option value="pro">专业版</option>',
          '</choices>',
        ].join('\n'),
      },
      counter: {
        label: '计数器',
        description: '通过加减按钮调整整数，并可一键重置。',
        keywords: ['计数', '加减', '整数', '调整', '重置'],
        template: '<counter bind="{{bind:count}}" label="计数" initial="0" min="0" max="99">',
      },
      timer: {
        label: '倒计时',
        description: '启动、暂停和重置一段专注计时。',
        keywords: ['计时', '倒计时', '专注', '秒', '暂停'],
        template: '<timer bind="{{bind:remaining}}" label="专注计时" duration="60">',
      },
      checklist: {
        label: '任务清单',
        description: '用可勾选的任务列表记录完成情况。',
        keywords: ['清单', '任务', '勾选', '待办', '完成'],
        template: [
          '<checklist bind="{{bind:done}}" label="完成清单">',
          '- [ ] 第一项任务',
          '- [ ] 第二项任务',
          '- [ ] 第三项任务',
          '</checklist>',
        ].join('\n'),
      },
      progress: {
        label: '进度条',
        description: '展示 0 到 100 之间的完成进度。',
        keywords: ['进度', '完成度', '进度条', '百分比'],
        template: '<progress label="完成进度" value="{{ 40 }}">',
      },
      panel: {
        label: '参数面板',
        description: '把一组控件包进面板，并附带恢复默认按钮。',
        keywords: ['面板', '参数', '重置', '表单', '控件'],
        template: ['<panel title="参数面板">', '{{selection:示例内容}}', '</panel>'].join('\n'),
      },
      card: {
        label: '内容卡片',
        description: '用卡片组织一段独立内容。',
        keywords: ['卡片', '容器', '内容', '区块'],
        template: ['<card title="内容卡片">', '{{selection:示例内容}}', '</card>'].join('\n'),
      },
      if: {
        label: '条件区域',
        description: '只有条件为真时才显示其中内容。',
        keywords: ['条件', '判断', '显示', '当'],
        template: ['<if when="{{ {{select:true}} }}">', '{{selection:示例内容}}', '</if>'].join('\n'),
      },
      tabs: {
        label: '标签页',
        description: '把内容分到多个可切换的标签页中。',
        keywords: ['标签页', '切换', '分组', '选项卡'],
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
      accordion: {
        label: '折叠面板',
        description: '把说明放进可展开和收起的条目。',
        keywords: ['折叠', '展开', '问答', '手风琴', '条目'],
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
      chart: {
        label: '柱状图',
        description: '把 Markdown 表格转换成柱状图。',
        keywords: ['图表', '柱状图', '表格', '数据', '对比'],
        template: [
          '<chart kind="bar" title="分类对比" y-label="数值">',
          '| 项目 | 数值 |',
          '| --- | ---: |',
          '| 项目甲 | 20 |',
          '| 项目乙 | 35 |',
          '</chart>',
        ].join('\n'),
      },
      table: {
        label: '增强表格',
        description: '带搜索、排序和分页的 Markdown 表格。',
        keywords: ['表格', '搜索', '排序', '分页', '数据'],
        template: [
          '<table label="数据表格" page-size="5">',
          '| 名称 | 分类 | 数值 |',
          '| --- | --- | ---: |',
          '| 项目甲 | 分类一 | 20 |',
          '| 项目乙 | 分类二 | 35 |',
          '</table>',
        ].join('\n'),
      },
      timeline: {
        label: '时间轴',
        description: '用表格展示任务的开始时间与时长。',
        keywords: ['时间轴', '计划', '时长', '日程', '任务'],
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
      diagram: {
        label: '交互图解',
        description: '用节点和连线展示流程，可点击查看说明。',
        keywords: ['图解', '流程', '节点', '连线', '关系图'],
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
      plot: {
        label: '函数曲线',
        description: '用 LaTeX 公式绘制一条函数曲线。',
        keywords: ['曲线', '函数', '公式', '数学', '绘图'],
        template: ['<plot min="-5" max="5" label="函数曲线">', '$$ y = x^2 $$', '</plot>'].join('\n'),
      },
      alert: {
        label: '提示框',
        description: '用不同语气突出普通、成功或警告信息。',
        keywords: ['提示', '警告', '通知', '信息', '消息'],
        template: [
          '<alert tone="info" title="提示">',
          '{{selection:示例内容}}',
          '</alert>',
        ].join('\n'),
      },
      badge: {
        label: '徽标',
        description: '在句子里显示一个简短状态标记。',
        keywords: ['徽标', '标签', '状态', '行内', '标记'],
        template: '<badge tone="success">标签</badge>',
      },
      tooltip: {
        label: '行内提示',
        description: '为句中的词语附加悬停或聚焦说明。',
        keywords: ['提示', '悬停', '说明', '行内', '气泡'],
        template: '<tooltip text="这里显示补充说明。">悬停查看</tooltip>',
      },
    },
  },
};
