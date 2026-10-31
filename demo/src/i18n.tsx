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
  showcase: {
    intro: string;
    navigation: string;
    reference: string;
    more: string;
    footer: string;
  };
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
    themeLight: string;
    themeDark: string;
    repository: string;
  };
  guide: {
    title: string;
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
  htmlCompatibility: {
    heading: string;
    legend: string;
    css: string;
    cssHint: string;
    javascript: string;
    javascriptHint: string;
    extendedHtml: string;
    extendedHtmlHint: string;
    modeReactive: string;
    modeHtml: string;
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
  exportDialog: {
    title: string;
    description: string;
    close: string;
    formatLegend: string;
    interactive: string;
    interactiveHint: string;
    static: string;
    staticHint: string;
    stateLegend: string;
    authorInitial: string;
    authorInitialHint: string;
    currentPreview: string;
    currentPreviewHint: string;
    currentUnavailable: string;
    summaryLegend: string;
    summaryParameters: string;
    summaryImages: string;
    changed: (changed: number, total: number) => string;
    unchanged: (total: number) => string;
    noParameters: string;
    noCurrent: string;
    imageNone: string;
    output: (mode: string, state: string) => string;
    outputInteractive: string;
    outputStatic: string;
    outputInitial: string;
    outputCurrent: string;
    outputHtmlMode: (mode: string) => string;
    htmlModeNotice: string;
    htmlModeParameters: string;
    htmlModeImages: string;
    htmlModeStateNote: string;
    exportStateHtmlMode: string;
    compilePending: string;
    compileFailed: (message: string) => string;
    compileUnavailable: string;
    assetsLoading: string;
    assetsFailed: (message: string) => string;
    buildFailed: (message: string) => string;
    exportHtml: string;
    exportMarkdown: string;
    exportState: string;
    exportStateHint: string;
    exportStateUnavailable: string;
    preparing: string;
    cancel: string;
  };
  editor: {
    region: string;
    sourceLabel: string;
    stateNote: string;
    diagnosticsRegion: string;
    diagnosticsHeading: string;
    diagnosticsCompiling: string;
    diagnosticsCount: (count: number) => string;
    diagnosticsNone: string;
    diagnosticsEmptyCompiling: string;
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
  showcase: {
    intro: 'Explore what an interactive document can do. Choose a feature, try a change, then open the source.',
    navigation: 'Explore features',
    reference: 'Reference',
    more: 'Open diagnostics',
    footer: 'Try the controls in each document. Open the source to explore or change how it works.',
  },
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
    themeLight: 'Light',
    themeDark: 'Dark',
    repository: 'GitHub repository',
  },
  guide: {
    title: 'User Guide',
    back: 'Back to Playground',
    documentFile: 'docs/guides/local-guide-en.md',
  },
  workbench: {
    example: 'Example',
    keepTrialState: 'Keep trial state',
    keepTrialStateTitle:
      'Keep compatible named parameters while editing; values are revalidated when initial values or constraints change.',
    restoreExample: 'Restore example',
    runAgain: 'Run again',
  },
  htmlCompatibility: {
    heading: 'HTML compatibility',
    legend: 'Allowed capabilities',
    css: 'CSS',
    cssHint: 'Allow <style> blocks and style attributes.',
    javascript: 'JavaScript',
    javascriptHint: 'Allow <script> blocks and inline event handlers.',
    extendedHtml: 'Extended HTML',
    extendedHtmlHint: 'Allow elements and attributes beyond the safe HTML subset.',
    modeReactive: 'Current mode: ReactiveMD + safe HTML',
    modeHtml: 'Current mode: native HTML',
  },
  authorTools: {
    ariaLabel: 'Document tools',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    showSource: 'Show source',
    simpleView: 'Presentation mode',
    importDocument: 'Import',
    exportDocument: 'Export',
  },
  exportDialog: {
    title: 'Export document',
    description:
      'Download the Markdown source, or create a self-contained HTML file that readers can open offline.',
    close: 'Close export dialog',
    formatLegend: 'HTML output',
    interactive: 'Interactive HTML',
    interactiveHint:
      'One self-contained file with the embedded runtime. Readers can use the controls, and the exported values are already applied.',
    static: 'Static HTML',
    staticHint: 'A read-only snapshot without a runtime or scripts, suitable for printing and archiving.',
    stateLegend: 'Starting values',
    authorInitial: 'Author initial values',
    authorInitialHint:
      'Use the defaults declared in the document. Every open and reset starts from the same values.',
    currentPreview: 'Current preview state',
    currentPreviewHint: 'Use the values currently shown in the preview as the exported starting point.',
    currentUnavailable:
      'The current preview state is unavailable because no matching document is running.',
    summaryLegend: 'Export summary',
    summaryParameters: 'Parameters',
    summaryImages: 'Images',
    changed: (changed, total) =>
      `${changed} of ${total} public parameter${total === 1 ? '' : 's'} differ from the author initial values.`,
    unchanged: (total) =>
      `All ${total} public parameter${total === 1 ? '' : 's'} match the author initial values.`,
    noParameters: 'This document has no public parameters.',
    noCurrent: 'The current preview state cannot be compared or exported right now.',
    imageNone: 'No images: the HTML file will be completely self-contained.',
    output: (mode, state) => `Will export ${mode} using ${state}.`,
    outputInteractive: 'interactive HTML',
    outputStatic: 'static HTML',
    outputInitial: 'the author initial values',
    outputCurrent: 'the current preview state',
    outputHtmlMode: (mode) => `Will export ${mode} in native HTML mode.`,
    htmlModeNotice:
      'Native HTML mode is active. The exported document keeps this routing; Markdown, formulas, and ReactiveMD bindings are not interpreted.',
    htmlModeParameters: 'Native HTML mode: ReactiveMD parameters are not used.',
    htmlModeImages: 'Native HTML mode: image references are not inspected or inlined by the demo.',
    htmlModeStateNote: 'Starting values and state export do not apply in native HTML mode.',
    exportStateHtmlMode: 'State export is unavailable in native HTML mode.',
    compilePending: 'Waiting for the current source to finish compiling…',
    compileFailed: (message) => `HTML export is unavailable until the source compiles: ${message}`,
    compileUnavailable:
      'HTML export is unavailable because the current source has not compiled yet.',
    assetsLoading: 'Checking the generated export assets…',
    assetsFailed: (message) =>
      `The generated export assets are missing or unreadable: ${message}. Run npm run build before exporting.`,
    buildFailed: (message) => `Could not render the HTML file: ${message}`,
    exportHtml: 'Export HTML',
    exportMarkdown: 'Download Markdown',
    exportState: 'Save current state',
    exportStateHint:
      'Download the current preview parameters as a reactive-md-state/v1 file for a CLI build.',
    exportStateUnavailable: 'Open a running preview to save its current parameters.',
    preparing: 'Rendering HTML…',
    cancel: 'Cancel',
  },
  editor: {
    region: 'Source editor',
    sourceLabel: 'Reactive MD source',
    stateNote:
      'Compatible values carry across edits; rerunning, switching examples, importing or refreshing resets them.',
    diagnosticsRegion: 'Compile and runtime diagnostics',
    diagnosticsHeading: 'Diagnostics',
    diagnosticsCompiling: 'Compiling',
    diagnosticsCount: (count) => `${count}`,
    diagnosticsNone: 'None',
    diagnosticsEmptyCompiling: 'Compiling the latest source…',
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
    afterExpression: ' in prose.',
    guideBefore: 'The guide content matches ',
    guideAfter: ' in the repository.',
    trial: 'Trial values stay in this session; rerunning or refreshing resets them.',
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
  showcase: {
    intro: '按功能探索交互文档。选一个主题，动手调整，再展开源码看看写法。',
    navigation: '探索功能',
    reference: '查阅',
    more: '打开调试示例',
    footer: '直接操作文档中的控件；展开源码，可以查看或修改它的写法。',
  },
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
    themeLight: '浅色',
    themeDark: '深色',
    repository: 'GitHub 仓库',
  },
  guide: {
    title: '使用指南',
    back: '返回 Playground',
    documentFile: 'docs/guides/local-guide-ch.md',
  },
  workbench: {
    example: '示例',
    keepTrialState: '保留试算状态',
    keepTrialStateTitle: '编辑时保留兼容的命名参数；修改初值或约束后会重新校验。',
    restoreExample: '恢复示例',
    runAgain: '重新运行',
  },
  htmlCompatibility: {
    heading: 'HTML 兼容',
    legend: '允许的能力',
    css: 'CSS',
    cssHint: '允许 <style> 块和 style 属性。',
    javascript: 'JavaScript',
    javascriptHint: '允许 <script> 块和内联事件处理属性。',
    extendedHtml: '扩展 HTML',
    extendedHtmlHint: '允许安全 HTML 子集之外的元素与属性。',
    modeReactive: '当前模式：ReactiveMD + 安全 HTML',
    modeHtml: '当前模式：原生 HTML',
  },
  authorTools: {
    ariaLabel: '文档工具',
    lightTheme: '浅色主题',
    darkTheme: '深色主题',
    showSource: '显示源码',
    simpleView: '演示模式',
    importDocument: '导入',
    exportDocument: '导出',
  },
  exportDialog: {
    title: '导出文档',
    description: '下载 Markdown 源码，或生成一份读者可离线打开的自包含 HTML 文件。',
    close: '关闭导出对话框',
    formatLegend: 'HTML 输出',
    interactive: '交互式 HTML',
    interactiveHint: '单文件内嵌运行时。读者可以使用控件，打开时已经应用导出的参数值。',
    static: '静态 HTML',
    staticHint: '只读快照，不包含运行时和脚本，适合打印和归档。',
    stateLegend: '起始值',
    authorInitial: '作者初值',
    authorInitialHint: '使用文档声明的默认值。每次打开和重置都从相同的值开始。',
    currentPreview: '当前预览状态',
    currentPreviewHint: '把预览中当前显示的值作为导出起始值。',
    currentUnavailable: '当前没有正在运行且匹配的文档，无法使用预览状态。',
    summaryLegend: '导出摘要',
    summaryParameters: '参数',
    summaryImages: '图片',
    changed: (changed, total) => `${total} 个公开参数中有 ${changed} 个与作者初值不同。`,
    unchanged: (total) => `全部 ${total} 个公开参数都与作者初值相同。`,
    noParameters: '这份文档没有公开参数。',
    noCurrent: '当前预览状态暂时无法比较或导出。',
    imageNone: '没有图片：HTML 文件完全自包含。',
    output: (mode, state) => `将导出${mode}，起始值使用${state}。`,
    outputInteractive: '交互式 HTML',
    outputStatic: '静态 HTML',
    outputInitial: '作者初值',
    outputCurrent: '当前预览状态',
    outputHtmlMode: (mode) => `将以原生 HTML 模式导出${mode}。`,
    htmlModeNotice:
      '当前为原生 HTML 模式。导出文件沿用这一路由；不再解析 Markdown、公式和 ReactiveMD 绑定。',
    htmlModeParameters: '原生 HTML 模式：不使用 ReactiveMD 参数。',
    htmlModeImages: '原生 HTML 模式：演示不会检查或内联图片引用。',
    htmlModeStateNote: '原生 HTML 模式下不适用起始值和状态导出。',
    exportStateHtmlMode: '原生 HTML 模式下无法导出状态。',
    compilePending: '正在等待当前源码编译完成…',
    compileFailed: (message) => `源码编译通过前无法导出 HTML：${message}`,
    compileUnavailable: '当前源码尚未编译完成，暂时无法导出 HTML。',
    assetsLoading: '正在检查生成的导出资源…',
    assetsFailed: (message) =>
      `生成的导出资源缺失或无法读取：${message}。请先运行 npm run build 再导出。`,
    buildFailed: (message) => `无法渲染 HTML 文件：${message}`,
    exportHtml: '导出 HTML',
    exportMarkdown: '下载 Markdown',
    exportState: '保存当前状态',
    exportStateHint: '把当前预览参数下载为 reactive-md-state/v1 文件，供 CLI 构建使用。',
    exportStateUnavailable: '请先打开正在运行的预览，再保存当前参数。',
    preparing: '正在渲染 HTML…',
    cancel: '取消',
  },
  editor: {
    region: '源码编辑器',
    sourceLabel: 'Reactive MD 源码',
    stateNote: '编辑时沿用兼容参数；重新运行、切换示例、导入或刷新会重置。',
    diagnosticsRegion: '编译与运行诊断',
    diagnosticsHeading: '诊断',
    diagnosticsCompiling: '编译中',
    diagnosticsCount: (count) => `${count} 条`,
    diagnosticsNone: '无',
    diagnosticsEmptyCompiling: '正在编译最新源码…',
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
    afterExpression: ' 读取。',
    guideBefore: '指南内容与仓库 ',
    guideAfter: ' 保持一致。',
    trial: '试算仅保存在当前会话，重新运行或刷新即重置。',
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
