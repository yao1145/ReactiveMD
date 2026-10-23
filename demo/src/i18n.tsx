import { createContext, useContext, type ReactNode } from 'react';

export type Language = 'en' | 'zh';

/** The demo opens in English unless the visitor has chosen Chinese before. */
export const DEFAULT_LANGUAGE: Language = 'en';

/** Persisted choice shared by the Playground and the embed page. */
export const LANGUAGE_STORAGE_KEY = 'reactive-md:language';

/**
 * Every piece of demo chrome lives here so the UI has one typed source of
 * truth for both languages. Values that depend on a number are functions;
 * everything else is a plain string.
 */
export interface DemoCopy {
  /** Value written to `document.documentElement.lang`. */
  htmlLang: 'en' | 'zh-CN';
  documentTitle: string;
  languageToggle: {
    /** Visible short label: the language the button switches to. */
    label: string;
    /** Language tag for the visible label. */
    labelLang: 'en' | 'zh-CN';
    /** Accessible name describing the action. */
    ariaLabel: string;
  };
  masthead: {
    eyebrow: string;
    introBefore: string;
    introBetween: string;
    expression: string;
    introAfter: string;
    viewSwitcher: string;
    playground: string;
    guide: string;
  };
  guide: {
    eyebrow: string;
    title: string;
    intro: string;
    lightTheme: string;
    darkTheme: string;
    back: string;
    /** Repository documentation file this view renders. */
    documentFile: string;
  };
  workbench: {
    example: string;
    keepTrialState: string;
    keepTrialStateTitle: string;
    restoreExample: string;
    runAgain: string;
  };
  authorTools: {
    ariaLabel: string;
    lightTheme: string;
    darkTheme: string;
    showSource: string;
    simpleView: string;
    importDocument: string;
    exportDocument: string;
  };
  editor: {
    region: string;
    heading: string;
    subtitle: string;
    sourceLabel: string;
    note: string;
    stateNote: string;
    diagnosticsRegion: string;
    diagnosticsHeading: string;
    diagnosticsCompiling: string;
    diagnosticsCount: (count: number) => string;
    diagnosticsNone: string;
    diagnosticsEmptyCompiling: string;
    diagnosticsEmpty: string;
    locate: string;
    warning: string;
    error: string;
    position: (line: number, column: number) => string;
  };
  preview: {
    region: string;
    heading: string;
    subtitle: string;
    startErrorTitle: string;
    preparing: string;
    disabledTitle: string;
    disabledBody: string;
    veilTitle: string;
    veilBody: string;
  };
  status: {
    compileFailed: string;
    compiled: (diagnostics: number, duration: number, fallback: boolean) => string;
    compiling: string;
    compilingMainThread: string;
    waiting: string;
    unexpectedError: (message: string) => string;
  };
  footer: {
    bindBefore: string;
    bindBetween: string;
    expression: string;
    afterExpression: string;
    guideBefore: string;
    guideAfter: string;
    trial: string;
  };
  embed: {
    documentTitle: string;
    heading: string;
    intro: string;
    instanceA: string;
    instanceB: string;
    remount: string;
    back: string;
  };
}

const ENGLISH: DemoCopy = {
  htmlLang: 'en',
  documentTitle: 'Reactive MD · Interactive Document Lab',
  languageToggle: {
    label: '中',
    labelLang: 'zh-CN',
    ariaLabel: 'Switch to Chinese',
  },
  masthead: {
    eyebrow: 'Local interactive document lab',
    introBefore: 'Place input controls in Markdown, name parameters with ',
    introBetween: ', then read them with ',
    expression: '{{ expressions }}',
    introAfter:
      '. Adjust an input and prose, tables, charts and curves update instantly.',
    viewSwitcher: 'View switcher',
    playground: 'Playground',
    guide: 'User Guide',
  },
  guide: {
    eyebrow: 'Documentation',
    title: 'User Guide',
    intro:
      'For readers who already write Markdown: start with your first interactive document, then add conditions, charts and function curves step by step.',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    back: 'Back to Playground',
    documentFile: 'docs/local-guide-en.md',
  },
  workbench: {
    example: 'Example',
    keepTrialState: 'Keep trial state',
    keepTrialStateTitle:
      'Keep compatible named parameters while editing; values are revalidated when initial values or constraints change.',
    restoreExample: 'Restore example',
    runAgain: 'Run again',
  },
  authorTools: {
    ariaLabel: 'Document tools',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    showSource: 'Show source',
    simpleView: 'Simple view',
    importDocument: 'Import document',
    exportDocument: 'Export document',
  },
  editor: {
    region: 'Source editor',
    heading: 'Source',
    subtitle: 'Markdown, local tags and expressions',
    sourceLabel: 'Reactive MD source',
    note: 'Edits are briefly coalesced, then compiled with the local syntax.',
    stateNote:
      'With retention on, editing prose, tags and formulas keeps compatible named parameters; values reset to initial when initial values change or constraints no longer hold. Checklists and timers reset after every compile. With retention off, the next compile starts from initial values; running again, switching or restoring examples, importing, and refreshing clear the trial state.',
    diagnosticsRegion: 'Compile and runtime diagnostics',
    diagnosticsHeading: 'Diagnostics',
    diagnosticsCompiling: 'Compiling',
    diagnosticsCount: (count) => `${count}`,
    diagnosticsNone: 'None',
    diagnosticsEmptyCompiling: 'Compiling the latest source…',
    diagnosticsEmpty: 'The current source has no compile or runtime diagnostics.',
    locate: 'Locate in editor',
    warning: 'Warning',
    error: 'Error',
    position: (line, column) => `Line ${line} · Column ${column}`,
  },
  preview: {
    region: 'Live preview',
    heading: 'Preview',
    subtitle: 'A local document you can interact with directly',
    startErrorTitle: 'Could not start document',
    preparing: 'Preparing interactive document…',
    disabledTitle: 'Preview disabled',
    disabledBody:
      'Fix the errors marked on the left; the preview returns automatically once compilation succeeds.',
    veilTitle: 'Compiling the latest source',
    veilBody: 'The preview keeps the last successful result until the new one is ready.',
  },
  status: {
    compileFailed: 'Compile failed',
    compiled: (diagnostics, duration, fallback) => {
      const base = diagnostics
        ? `Compiled · ${diagnostics} diagnostic${diagnostics === 1 ? '' : 's'}`
        : `Compiled · ${duration} ms`;
      return fallback ? `${base} · main thread` : base;
    },
    compiling: 'Compiling…',
    compilingMainThread: 'Compiling… · main thread',
    waiting: 'Waiting to compile',
    unexpectedError: (message) => `Unexpected document error: ${message}`,
  },
  footer: {
    bindBefore: 'Name parameters with ',
    bindBetween: ' and read them in prose with ',
    expression: '{{ }}',
    afterExpression:
      '; charts use Markdown tables and function curves use LaTeX — no config blocks, events or service calls required.',
    guideBefore: 'The guide content matches ',
    guideAfter: ' in the repository.',
    trial:
      "Trial values live only in this editing session; the browser saves each example's source, and refreshing or running again returns to initial values.",
  },
  embed: {
    documentTitle: 'Reactive MD embed example',
    heading: 'Embed interactive local documents in your app',
    intro:
      'Both document instances share the same source but manage their own in-memory state. Remounting starts from initial values, and refreshing the page does not keep interaction results.',
    instanceA: 'Instance A',
    instanceB: 'Instance B',
    remount: 'Remount',
    back: 'Back to Playground',
  },
};

const CHINESE: DemoCopy = {
  htmlLang: 'zh-CN',
  documentTitle: 'Reactive MD · 交互文档实验室',
  languageToggle: {
    label: 'EN',
    labelLang: 'en',
    ariaLabel: '切换到英文',
  },
  masthead: {
    eyebrow: '本地交互文档实验室',
    introBefore: '在 Markdown 中放置输入控件，用 ',
    introBetween: ' 命名参数，再用 ',
    expression: '{{ 表达式 }}',
    introAfter: ' 读取它们。调整输入，正文、表格、图表和曲线立即更新。',
    viewSwitcher: '页面切换',
    playground: 'Playground',
    guide: '使用指南',
  },
  guide: {
    eyebrow: '阅读文档',
    title: '使用指南',
    intro: '面向会写 Markdown 的读者：从第一份交互文档开始，逐步加入条件、图表与函数曲线。',
    lightTheme: '浅色主题',
    darkTheme: '深色主题',
    back: '返回 Playground',
    documentFile: 'docs/local-guide-ch.md',
  },
  workbench: {
    example: '示例',
    keepTrialState: '保留试算状态',
    keepTrialStateTitle: '编辑时保留兼容的命名参数；修改初值或约束后会重新校验。',
    restoreExample: '恢复示例',
    runAgain: '重新运行',
  },
  authorTools: {
    ariaLabel: '文档工具',
    lightTheme: '浅色主题',
    darkTheme: '深色主题',
    showSource: '显示源码',
    simpleView: '简洁视图',
    importDocument: '导入文档',
    exportDocument: '导出文档',
  },
  editor: {
    region: '源码编辑器',
    heading: '源码',
    subtitle: 'Markdown、本地标签与表达式',
    sourceLabel: 'Reactive MD 源码',
    note: '编辑会短暂合并后再按本地语法编译。',
    stateNote:
      '开启保留后，编辑正文、标签和公式会沿用兼容的命名参数；修改初值或不再满足约束时恢复初值。清单和计时器每次编译后重置。关闭保留后，下次编译使用初值；重新运行、切换或恢复示例、导入和刷新会清空试算。',
    diagnosticsRegion: '编译与运行诊断',
    diagnosticsHeading: '诊断',
    diagnosticsCompiling: '编译中',
    diagnosticsCount: (count) => `${count} 条`,
    diagnosticsNone: '无',
    diagnosticsEmptyCompiling: '正在编译最新源码…',
    diagnosticsEmpty: '当前源码没有编译或运行诊断。',
    locate: '在编辑器中定位',
    warning: '警告',
    error: '错误',
    position: (line, column) => `第 ${line} 行 · 第 ${column} 列`,
  },
  preview: {
    region: '实时预览',
    heading: '预览',
    subtitle: '可以直接操作的本地文档',
    startErrorTitle: '无法启动文档',
    preparing: '正在准备交互文档…',
    disabledTitle: '预览已停用',
    disabledBody: '请修正左侧标记的错误，编译成功后预览会自动恢复。',
    veilTitle: '正在编译最新源码',
    veilBody: '预览暂时保留上一次成功的结果，完成后会自动替换。',
  },
  status: {
    compileFailed: '编译失败',
    compiled: (diagnostics, duration, fallback) => {
      const base = diagnostics
        ? `已编译 · ${diagnostics} 条诊断`
        : `已编译 · ${duration} ms`;
      return fallback ? `${base} · 主线程` : base;
    },
    compiling: '编译中…',
    compilingMainThread: '编译中… · 主线程',
    waiting: '等待编译',
    unexpectedError: (message) => `文档出现未预期错误：${message}`,
  },
  footer: {
    bindBefore: '参数用 ',
    bindBetween: ' 命名，正文用 ',
    expression: '{{ }}',
    afterExpression:
      ' 读取；图表使用 Markdown 表格，函数曲线使用 LaTeX，不需要配置块、事件或服务调用。',
    guideBefore: '指南内容与仓库 ',
    guideAfter: ' 保持一致。',
    trial:
      '试算只保存在本次编辑会话；浏览器保存各示例的源码，刷新或重新运行会回到初值。',
  },
  embed: {
    documentTitle: 'Reactive MD 嵌入示例',
    heading: '本地交互文档可以嵌入你的应用',
    intro:
      '两个文档实例使用同一份源码，但各自管理内存状态。重新挂载会从初值开始，刷新页面也不会保留交互结果。',
    instanceA: '实例 A',
    instanceB: '实例 B',
    remount: '重新挂载',
    back: '返回 Playground',
  },
};

export const COPY: Record<Language, DemoCopy> = {
  en: ENGLISH,
  zh: CHINESE,
};

export function copyFor(language: Language): DemoCopy {
  return COPY[language];
}

const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

export function LanguageProvider({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

/** Copy for the language currently provided by `LanguageProvider`. */
export function useCopy(): DemoCopy {
  return COPY[useLanguage()];
}

export function pick<T>(language: Language, en: T, zh: T): T {
  return language === 'zh' ? zh : en;
}
