/**
 * Typed copy for the source editor: toolbar chrome and command placeholders.
 *
 * English strings are the canonical defaults. Chinese strings use the wording
 * shipped in the demo. Default component labels, descriptions, groups and
 * templates are authoring data owned by `src/presets/default-authoring.ts`.
 */

import type { EditorLocale } from './command-types';

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
