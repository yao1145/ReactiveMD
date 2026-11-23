# 公开接口参考

**中文** · [English](public-api-en.md)

本页汇总 Reactive MD 对外部开发者开放的全部接口：包入口、命令行、浏览器协议和编辑器包。选择入口时先查这里，再看对应主题文档。

工作区包含三个包，各自独立版本、独立发布流程。

| 包 | 版本 | 职责 |
| --- | --- | --- |
| `reactive-md` | `0.9.2` | 编译器、运行时、作者服务、SDK、React 与 SSR 渲染、导出、构建适配 |
| `reactive-md-editor` | `0.2.1` | CodeMirror 6 源码编辑器、工具栏、编辑器侧导航 |
| `reactive-md-demo` | 私有 | 站点、示例与部署，不提供对外接口 |

引擎只提供 ESM 入口，Node 侧要求 Node.js 22.12 或更新版本。React 19 与 Vite 8 都是可选 peer，各自只服务一部分入口。

## 快速索引

| 入口 | 类型 | 需要 React | 仅 Node | 一句话用途 |
| --- | --- | --- | --- | --- |
| `reactive-md` | ESM | 否 | 否 | 完整核心面：单次与流式编译、增量会话、运行时、状态、Worker、可分享 HTML |
| `reactive-md/compiler` | ESM | 否 | 否 | 单次语义编译，不带默认预设 |
| `reactive-md/compiler/standard` | ESM | 否 | 否 | 单次编译，带 GFM、原生 HTML、KaTeX 与默认预设 |
| `reactive-md/react` | ESM | 是 | 否 | React 文档渲染器与组件开发接口 |
| `reactive-md/react/unstyled` | ESM | 是 | 否 | 同一渲染器，但不产生样式表副作用 |
| `reactive-md/react/minimal` | ESM | 是 | 否 | 基于 18 个组件精简预设的渲染器 |
| `reactive-md/react/server` | ESM | 是 | 是 | 严格 SSR 适配器，返回标记或诊断 |
| `reactive-md/react/runtime` | ESM | 是 | 否 | 面向组件的 React hooks：计时、帧、滑动、按键、状态 |
| `reactive-md/sdk` | ESM | 否 | 否 | 组件、预设与主题清单定义及校验 |
| `reactive-md/presets/default` | ESM | 否 | 否 | 48 个组件的默认预设（纯数据） |
| `reactive-md/presets/default/packs` | ESM | 否 | 否 | 默认预设的四个命名子集 |
| `reactive-md/presets/minimal` | ESM | 否 | 否 | 18 个组件的精简预设 |
| `reactive-md/presets/minimal/react` | ESM | 是 | 否 | 精简预设的 React 实现 |
| `reactive-md/plugins/*` | ESM | 是 | 否 | 八个可选官方组件包 |
| `reactive-md/authoring` | ESM | 否 | 否 | 分析、补全、重命名、格式化、目录、工具栏命令 |
| `reactive-md/export` | ESM | 否 | 部分 | 导出预检、可分享 HTML、bundle 封印、恢复要求 |
| `reactive-md/export-assets` | ESM | 否 | 是 | 定位导出所需的样式表、notices 与运行时 |
| `reactive-md/build` | ESM | 否 | 是 | 通过 Vite 构建离线交互 bundle |
| `reactive-md/vite` | ESM | 否 | 是 | 目录发现与虚拟模块的 Vite 插件 |
| `reactive-md/vite/client` | 类型 | — | — | 虚拟模块的声明 |
| `reactive-md/standalone` | ESM | 是 | 否 | 独立运行时的编程式挂载接口 |
| `reactive-md/standalone/host` | ESM | 是 | 否 | 绑定固定 React 配置的挂载接口 |
| `reactive-md/testing` | ESM | 否 | 否 | 清单与行为合规运行器 |
| `reactive-md/testing/react` | ESM | 是 | 是 | 静态与 SSR 合规运行器 |
| `reactive-md/testing/browser` | ESM | 否 | 否 | 浏览器生命周期合规，可选 Playwright 驱动 |
| `reactive-md/runtime` | ESM | 否 | 否 | 文档标识、种子、随机、调度、组件状态注册表、网络通道 |
| `reactive-md/runtime/browser` | ESM | 否 | 否 | `localStorage` 持久化、页面隐藏刷写、HTTP/SSE、WebSocket、WebRTC 适配 |
| `reactive-md/pdf` | ESM | 否 | 是 | 将准备好的静态 HTML 渲染为 PDF 字节 |
| `reactive-md/styles.css` | CSS | — | — | 文档、组件与主题样式 |
| `reactive-md/styles/minimal.css` | CSS | — | — | 精简预设所需样式 |
| `reactive-md/screen.css` | CSS | — | — | `styles.css` 的别名 |
| `reactive-md/print.css` | CSS | — | — | 打印布局，在 `styles.css` 之后加载 |
| `reactive-md/notices` | 文件 | — | — | 生成的第三方声明 |
| `reactive-md/assets/standalone.js` | IIFE | — | — | 预构建浏览器运行时，暴露 `ReactiveMD` |
| `reactive-md/package.json` | 文件 | — | — | 包元数据 |

## 编译与核心运行时

### `reactive-md`

完整核心面。不依赖 React，不引入样式表，不需要 DOM。

| 领域 | 导出 |
| --- | --- |
| 单次编译 | `compileLocal`、`LocalCompileResult`、`LocalCompileOptions` |
| 增量编辑 | `createLocalCompileSession`、`LocalCompileSession`、`LocalIncrementalStats` |
| 流式源码 | `LocalSourcePhase`、`LocalCompileStatus`；会话与调度器的阶段参数 |
| 运行时 | `createLocalRuntime`、`updateLocalRuntime`、`notifyLocalRuntime`、`LocalRuntime`、`LocalSnapshot` |
| 表达式与数学 | `compileExpression`、`LocalExpressionError`、`compileLatex`、`compilePlotFormula`、`plotFormulaKind`、`implicitGridSize`、`samplePlot`、`sampleImplicit`、`sampleParametric`、`samplePolar` |
| 诊断 | `formatLocalDiagnostic`、`LOCAL_DIAGNOSTIC_CODES`、`isLocalDiagnosticCode`、`localDiagnosticTemplate`、`localDiagnosticTemplateKeys` |
| 状态文件 | `createLocalStateFile`、`parseLocalState`、`resolveLocalState`、`applyLocalState`、`exportLocalState`、`importLocalState`、`serializeLocalState`、`LOCAL_STATE_FORMAT` |
| 状态保留 | `planLocalStateRetention`、`applyLocalStateRetention` |
| 源码版本 | `inspectLocalSourceVersion`、`checkLocalUpgrade`、`migrateLocalSource`、`LOCAL_SYNTAX_VERSION` |
| 作者服务（再导出） | `analyzeLocalSource`、`completeLocalSource`、`renameLocalBinding`、`formatLocalSource` |
| 后台编译 | `LocalCompileScheduler`、`startLocalCompileWorker`、`LOCAL_COMPILE_DELAY_MS`、`LOCAL_COMPILE_PREPARATION_DELAY_MS`、`compileFailureDiagnostic`、`localWorkerOptionsKey`、`LocalCompileOutcome`、`LocalCompileRequest`、`LocalCompileResponse` |
| 结果补丁 | `LOCAL_RESULT_PATCH_PROTOCOL`、`diffSourceEdit`、`applySourceEdit`、`encodeLocalResultPatch`、`applyLocalResultPatch` |
| 主题 | `LOCAL_THEME_PROTOCOL`、`DEFAULT_LOCAL_THEME`、`resolveLocalTheme`、`isLocalThemeName` |
| HTML 信封 | `createShareableHtml`、`resolveLocalStateBaseline`、`SHAREABLE_HTML_FORMAT`、`SHAREABLE_HTML_FORMAT_V2`、`serializeForScript` |
| 组件状态 | `localSourceDigest` 及 `./export/component-state` 一族 |

宿主在内存中编译、运行并持久化文档时用这个入口。`compileLocal()` 是一次性完整编译器；`createLocalCompileSession()` 在连续编辑中复用未变动的 Markdown 块；`createLocalRuntime()` 持有参数、订阅与销毁。运行时本身不写存储、Cookie 或网络。

`LocalCompileOptions.sourcePhase` 把快照标记为 `streaming` 或 `final`；会话接受 `compile(source, options?, phase?)` 和 `compileShared(source, options?, phase?)`，`LocalCompileScheduler.schedule(source, options?, hint?, phase?)` 使用同一阶段，`final` 跳过防抖。显式阶段结果增加 `status`（`partial`、`valid`、`recovered`、`failed`），流式结果还可带 `transientDiagnostics`；暂态诊断不会出现在 `diagnostics` 中。Worker 的完整请求与响应在声明了阶段时回显 `sourcePhase`（请求字段或 options 对象均可）；未声明阶段的旧客户端省略该字段。`LocalCompileOutcome.sourcePhase` 报告该阶段，修订号保持单调递增，流式结果永不建立补丁基线。一次性 `compileLocal` 与编译器入口仍只做最终编译。

### `reactive-md/compiler`

单次编译器，不安装任何组件预设。保留 CommonMark、ReactiveMD 结构、表达式、绑定、语义检查与资源预算。它不创建会话、Worker、定时器或缓存，也不加载 React、CSS、主题实现或预设。

```ts
import { createCompiler } from 'reactive-md/compiler';

const result = createCompiler().compile('# Notes\n\nPlain Markdown.');
```

精简装配未提供的语言能力会给出明确的能力诊断，而不是静默改变语义。例如 `enableCss` 报 `local.capability.html`。

### `reactive-md/compiler/standard`

结果契约相同，但装配完整语言能力：默认预设、GFM、原生 HTML 解析与修复、Lezer 块规划、KaTeX 显示预检与绘图公式语义。宿主需要一次性完整编译、又不想引入会话、Worker 或 React 时使用它。

两个工厂都在创建时校验选项并冻结快照。非法配置抛出 `CompilerConfigurationError`。结果带 `status: 'valid' | 'recovered' | 'failed'`，以及 `ok`、`document`、`diagnostics`、`program`、`recoveries` 和检查覆盖信息。

## React 渲染

### `reactive-md/react`

| 导出 | 用途 |
| --- | --- |
| `LocalReactiveDocument` | 直接接收 `source` 字符串并托管运行时，文章场景的常用入口 |
| `LocalDocumentView` | 渲染宿主已编译的 `LocalDocument` 与宿主自有的 `LocalRuntime` |
| `createReactConfig`、`createReactHost` | 把组件清单绑定到 React 实现 |
| `defineReactComponent`、`defineReactComponentPackage`、`defineReactPreset`、`defaultReactPresetPackage` | 外部组件与官方组件的打包格式 |
| `reportLocalComponentError`、`safeLocalComponentEvent`、`LocalReactExtensionMissingError`、`validateLocalReactExtensions` | 组件错误与生命周期辅助 |
| 组件上下文类型 | `LocalComponentContext`、`LocalComponentRuntime`、`LocalComponentServices`、`LocalComponentBindingHandle`、`LocalComponentContent` 及值、表格、选项、本地化类型 |
| 适配原语 | `compileExpression`、`compileLatex`、`compilePlotFormula`、`samplePlot`、`sampleImplicit`、`sampleParametric`、`samplePolar`、`layoutDiagram`、`diagramEdgePath`、`TableSurface`、`LatexView`、各类上限与格式化函数 |
| 适配工具 | `useComponentView`、`useWriter`、`useDisabled`、`useResetToken`、`useSourceAttributes`、`useValidationField`、`useValidationHint`、`formatNumber`、`snapToStep` 等 `component-utils` 成员 |

`LocalReactiveDocument` 还接受 `sourcePhase?: 'streaming' | 'final'` 和 `onTransientDiagnostics?: (diagnostics: Diagnostic[]) => void`。流式期间以静态模式渲染并暂缓副作用，`final` 恢复宿主交互模式。见[流式源码编译](../integration/local-integration-ch.md#流式源码编译)。渲染器属性见[本地模式集成](../integration/local-integration-ch.md)。两个组件都不接受 `className`、`style` 或子元素。

### `reactive-md/react/unstyled`

React 接口完全相同，但不导入 `styles.css`。宿主自行注入样式表，或在 Shadow DOM 内渲染时使用。

### `reactive-md/react/minimal`

同样两个组件与辅助函数，但基于 18 个组件的精简预设。这里的 `createReactHost()` 与 `createReactConfig()` 搭配 `reactive-md/presets/minimal` 和 `reactive-md/styles/minimal.css`。

### `reactive-md/react/server`

`renderLocalStaticDocument` 先做能力预检、校验已安装契约，再返回标记或结构化诊断。返回的标记就是静态导出与离线导出所需的 `staticMarkup`；保留 React 文本边界，独立运行时才能水合同一棵树。

### `reactive-md/react/runtime`

面向组件实现的 hooks：`useTicker`、`useFrame`、`useSwipe`（含 `classifySwipe`）、`useKeys`（含 `isEditableTarget`）、`useComponentState`。该入口不引入渲染器，也不引入编译器。

## 组件 SDK 与预设

### `reactive-md/sdk`

| 分组 | 导出 |
| --- | --- |
| 定义 | `defineLocalComponent`、`readLocalComponentManifest`、清单上限常量、协议常量 |
| 配置 | `createLocalConfig`、`readLocalConfig`、`localConfigKey`、`snapshotLocalConfig`、`localComponentConfigKey`、`validateLocalDocumentConfig` |
| 注册表 | `getLocalComponentRegistry`、`getLocalComponentDefinition`、`localComponentSchemas` |
| 预设 | `defineLocalPreset`、`readLocalPresetPackage`、`localPresetDigest` |
| 主题 | `defineLocalTheme`、`composeLocalTheme`、`collectLocalThemeCss`、`isLocalInlineCss`、`LocalStyleResource` |
| 装配 | `localAssemblyIdentity`、`localAssemblySeal`、`localConfigKeyMatches` |
| 兼容档位 | `LOCAL_COMPAT_PROFILES`、`findLocalCompatProfile`、`localCompatProfiles` |
| 属性与绑定 | `resolveLocalComponentProps`、`resolveLocalComponentProp`、`resolveLocalComponentBindingConstraints`、`localBindingAttributeNames`、`localComponentHostBinding` |
| 版本与协议 | `LOCAL_SDK_VERSION`、`LOCAL_COMPONENT_PROTOCOL`、`LOCAL_PRESET_PROTOCOL`、`LOCAL_REACT_PRESET_PROTOCOL`、`LOCAL_CONFIG_PROTOCOL`、`LOCAL_CONFIG_PROTOCOL_V2`、`LOCAL_EXTENSIONS_PROTOCOL`、`LOCAL_ASSEMBLY_PROTOCOL`、`localVersionSatisfies`、`parseLocalVersionRange` |
| 样式契约 | `LOCAL_STYLE_CONTRACT`、`LOCAL_STYLE_LAYERS`、`LOCAL_THEME_STYLE_LAYER`、`LOCAL_STYLE_LAYER_ORDER` |

清单是可序列化的纯数据。注册时校验身份、名称、协议、依赖与预算，然后复制并冻结。`readLocalConfig` 会重新校验序列化后的配置并重算语义键，因此宿主可以安全地让配置在 JSON 中往返。

### 内置预设

| 入口 | 内容 |
| --- | --- |
| `reactive-md/presets/default` | `defaultPreset`，id `reactive-md/default`，48 个组件：`input`、`textarea`、`number`、`slider`、`range-slider`、`coordinate`、`toggle`、`checkbox`、`date`、`select`、`choices`、`radio-group`、`multi-select`、`option`、`counter`、`timer`、`checklist`、`progress`、`jump`、`anchor`、`text`、`section`、`quiz`、`panel`、`card`、`grid`、`gallery`、`gallery-item`、`tabs`、`tab`、`steps`、`step`、`accordion`、`disclosure`、`if`、`alert`、`badge`、`tooltip`、`validation`、`data-table`、`column`、`table`、`chart`、`plot`、`timeline`、`diagram`、`node`、`edge` |
| `reactive-md/presets/default/packs` | `controlsPack`（19）、`layoutPack`（21）、`dataPack`（4）、`visualsPack`（5） |
| `reactive-md/presets/minimal` | `minimalPreset`，id `reactive-md/minimal`，18 个组件：`input`、`textarea`、`number`、`slider`、`toggle`、`date`、`select`、`option`、`jump`、`anchor`、`text`、`section`、`panel`、`card`、`grid`、`if`、`alert`、`badge` |
| `reactive-md/presets/minimal/react` | `minimalReactPresetPackage`：上述 18 个组件的 React 实现 |

packs 本身就是普通预设，宿主选择一个或多个，但不能与 `defaultPreset` 同时使用。`visualsPack` 依赖 `dataPack`，因为 `plot` 与 `data-table` 共用 `column` 布局组件；`layoutPack` 也声明了 `column`，所以 `layoutPack` 与 `dataPack` 不能同时安装。

### 可选插件包

每个 `reactive-md/plugins/<name>` 以默认导出提供一份 React 预设包。

| 入口 | 预设 id | 组件 | 声明的基座 |
| --- | --- | --- | --- |
| `reactive-md/plugins/forms` | `reactive-md/forms` | `range-slider`、`checkbox`、`choices`、`radio-group`、`multi-select`、`counter`、`timer`、`checklist`、`progress`、`quiz` | 依赖 `reactive-md/minimal` |
| `reactive-md/plugins/network` | `reactive-md/network` | `submit-button` | 无，可与任意基座共用 |
| `reactive-md/plugins/navigation` | `reactive-md/navigation` | `tabs`、`tab`、`steps`、`step`、`accordion`、`disclosure`、`tooltip`、`validation` | 未声明 |
| `reactive-md/plugins/data` | `reactive-md/data` | `data-table`、`column`、`table`、`timeline` | 未声明 |
| `reactive-md/plugins/chart` | `reactive-md/chart` | `chart` | 未声明 |
| `reactive-md/plugins/plot` | `reactive-md/plot` | `coordinate`、`plot` | 未声明 |
| `reactive-md/plugins/diagram` | `reactive-md/diagram` | `diagram`、`node`、`edge` | 未声明 |
| `reactive-md/plugins/gallery` | `reactive-md/gallery` | `gallery`、`gallery-item` | 未声明 |

除 `submit-button` 外，这些组件都已存在于 `defaultPreset`。把插件叠加在默认预设上会触发重复 id 注册错误。正确做法是与 `minimalPreset` 或排除重叠组件的 packs 搭配。`plugins/forms` 明确要求精简预设，缺少时直接报依赖缺失。

控制安装体积的推荐路径：从 `minimalPreset` 起步，按文档实际使用情况加 packs 与插件，再登记对应的 React 包。

## 作者工具

### `reactive-md/authoring`

不依赖 DOM，也不依赖 React，因此可以在 Worker 或服务端进程中运行。

| 分组 | 导出 |
| --- | --- |
| 源码服务 | `analyzeLocalSource`、`completeLocalSource`、`renameLocalBinding`、`formatLocalSource` |
| 目录 | `createLocalComponentCatalog`、`createLocalComponentCatalogForOptions`、`filterLocalComponentCatalog`、`localComponentCatalogGroups`、`localComponentCatalogKey`、`localComponentHelp`、`localCatalogAncestors`、`createLocalAuthoringLookup` |
| 插入 | `insertLocalComponent`、`insertLocalComponentFromOptions`、`validateLocalComponentInsertTemplates` |
| 结构定义 | `LOCAL_COMPONENTS`、`LOCAL_COMPONENT_NAMES`、`getLocalComponent`、`getPropDefault`、`localComponentNames`、`suggestComponent`、`suggestAttribute`、`closestName` 及相关 schema 类型 |
| 内置目录 | `NATIVE_COMPONENTS`、`NATIVE_COMPONENTS_ZH`、`NATIVE_COMPONENT_GROUPS`、`EXTENDED_NATIVE_COMPONENTS`、`getNativeComponentCatalog`、`renderNativeSnippet` |
| 工具栏命令 | `formatBold`、`formatItalic`、`formatStrike`、`formatInlineCode`、`formatHeading`、`formatBulletList`、`formatOrderedList`、`formatTaskList`、`formatQuote`、`indentSelection`、`outdentSelection`、`insertLink`、`insertImage`、`insertCodeBlock`、`insertTable`、`insertDivider`、`insertText`、`insertTemplate`、`readFormatState` |

传入与渲染相同的 `LocalCompileOptions`，诊断、宿主组件、资源上限与 HTML 模式才能保持一致。分析返回的范围只对生成它的那份源码有效。

## 导出与部署

### `reactive-md/export`

| 导出 | 用途 |
| --- | --- |
| `createLocalExportPlan` | 在产生任何输出之前预检目标（`static`、`ssr`、`offline`）：能力、资源、主题、bundle 封印 |
| `createLocalShareableHtml` | 使用宿主预构建 bundle 生成单文件 HTML |
| `defineLocalStandaloneBundle` | 把显式构建的脚本绑定到已安装清单并封印 |
| `createLocalBundleManifest`、`createLocalRestorationRequirements`、`validateLocalRestorationRequirements`、`localThemeContractDigest`、`localExportContentDigest` | bundle 与恢复元数据 |
| `resolveLocalComponentStateExport` | 在嵌入之前按文档校验组件状态 sidecar |
| `readLocalExportResources` | 校验并规范化宿主样式资源 |
| `prepareLocalPrintHtml`、`waitForLocalPrintImages` | 为打印准备静态 HTML |
| `validateLocalComponentContracts`、`validateLocalExtensionRequirements` | 与 CLI 共用的契约检查 |

内容摘要用于发现不一致，不是签名。

### `reactive-md/export-assets`

`listExportAssets()`、`resolveExportAsset(id)`、`readExportAsset(id)`，基于协议 `reactive-md-export-assets/v1` 的冻结清单。

| id | specifier |
| --- | --- |
| `base-css` | `reactive-md/styles.css` |
| `print-css` | `reactive-md/print.css` |
| `notices` | `reactive-md/notices` |
| `package-json` | `reactive-md/package.json` |
| `runtime` | `reactive-md/assets/standalone.js` |

请通过这个入口读取资源。tarball 结构与文件名会随版本变化，而 id 与协议保持不变。

### `reactive-md/build`

Node 适配器，只读取宿主显式指定的模块，第三方代码始终是宿主自身的依赖。

| 导出 | 用途 |
| --- | --- |
| `preflightLocalStandaloneBuild` | 在不运行 Vite 的情况下校验宿主入口、配置键、React 实现、能力与资源 |
| `buildLocalStandaloneBundle` | 产出 IIFE 脚本、封印、资源、资产、CSS 与 notices |
| `readLocalBuildHost`、`createLocalStandaloneEntrySource`、`VIRTUAL_HOST_ENTRY`、`VIRTUAL_HOST_MODULE` | 宿主入口加载与生成的入口模块 |
| `collectLocalBuildResources`、`readLocalBuildBudgets`、`readLocalStyleResourceInputs`、`DEFAULT_LOCAL_BUILD_BUDGETS` | 资源收集与预算 |
| `collectLocalBuildNotices` | notices 汇总 |
| `resolveLocalVite`、`LocalViteApi` | 可选 Vite peer 解析 |
| `LocalBuildError`、`LOCAL_BUILD_PROTOCOL` | 诊断与 `reactive-md-build/v1` |

### `reactive-md/vite` 与 `reactive-md/vite/client`

`reactiveMd(options)` 注册一个 Vite 插件。

| 选项 | 作用 |
| --- | --- |
| 无 | 目录模式：在 Vite root 下发现 `theme/*` 与 `plugin/*` |
| `themeDir`、`pluginDir` | 指定其他发现根目录 |
| `defaultPreset: false \| 'minimal'` | 从无预设或核心组件集起步 |
| `includeMinimal: true` | 额外暴露 `-minimal-host` 与 `-minimal-bundle` 虚拟模块 |
| `extensions: './extensions.ts'` | 手动模式：一个导出 `host = createReactHost(...)` 的模块 |

目录选项与手动选项互斥。`loadLocalDirectoryHost` 让宿主在插件生命周期之外拿到同一份发现结果。

`reactive-md/vite/client` 声明四个虚拟模块：`virtual:reactive-md/host`、`virtual:reactive-md/bundle`、`virtual:reactive-md-minimal-host`、`virtual:reactive-md-minimal-bundle`。host 模块导出 `host`、`config`、`reactConfig`、`resources`、`css`、`notices`、`discovery`，手动模式下还有 `extensions`。bundle 模块默认导出 `LocalStandaloneBuild` 或 `{ error, diagnostics }`。

### `reactive-md/pdf`

`renderLocalPdf(html, options)` 返回 PDF 字节。选项覆盖纸张、方向、页边距、背景打印与严格模式。CLI 按需加载该入口，只有输出 PDF 时才需要 Playwright 与 Chromium。

## 浏览器运行时

### `reactive-md/standalone`

| 导出 | 用途 |
| --- | --- |
| `mount`、`mountAll`、`isReactiveMDMounted`、`REACTIVE_MD_MOUNTED_ATTRIBUTE` | 编程式挂载与挂载状态检测 |
| `parseMountPayload` | 校验 `application/reactive-md+json` 载荷 |
| `ReactiveMDMountError` | 带类型的挂载失败 |
| `REACTIVE_MD_DIAGNOSTICS_EVENT`、`REACTIVE_MD_STATE_CHANGE_EVENT` | 元素与自动挂载发出的事件名 |

该入口不自动挂载，也不隐式注册组件，适合自建页面的宿主。

### `reactive-md/standalone/host`

同样的挂载函数，但绑定宿主 bundle 里固定的 React 配置。不带编译器面，也不自动挂载。

### 预构建运行时：`reactive-md/assets/standalone.js`

IIFE 产物，暴露全局 `ReactiveMD`，加载时对 `application/reactive-md+json` 载荷执行一次挂载，并注册 `<reactive-md-doc>` 自定义元素。

| 接口 | 成员 |
| --- | --- |
| 全局 | `ReactiveMD.mount(element, options)`、`ReactiveMD.mountAll(root)`、`ReactiveMD.isReactiveMDMounted()` |
| handle | `getState()`、`unmount()` |
| 元素属性 | `src`、`source`、`locale`、`color-scheme`、`theme` |
| 元素属性对象 | `source`、`state`、`documentId`、`randomSeed`、`componentState`、`urlPolicy`、`imageResolver`、`themes` |
| 元素事件 | `reactive-md-diagnostics`、`reactive-md-state-change` |

`src` 通过 `fetch` 读取并可取消；显式提供 `source` 则完全不触网。元素断开连接会中止请求、移除订阅与 React root，并销毁运行时。元素使用 Light DOM。`<script type="text/reactive-md">` 中的文本不会被解析。

## 运行时服务

### `reactive-md/runtime`

| 分组 | 导出 |
| --- | --- |
| 标识 | `componentStateKey`、`localSourceDigest`、`normalizeDocumentId`、`normalizeStateKey`、`resolveDocumentId`、`resolveComponentSeed`、`deriveSeed`、`fnv1a32`、`toUint32` |
| 随机 | `createRandom`、`deriveRandom`、`nextRandom`、`normalizeRandomState`、`randomBool`、`randomInt`、`shuffleRandom`、`LOCAL_RANDOM_ALGORITHM`、`LOCAL_RANDOM_VERSION` |
| 调度 | `createLocalScheduler` 与 `LocalClock`、`LocalSchedulerPorts`、`LocalTickerOptions` |
| 组件状态 | `createLocalComponentStateRegistry`、`parseLocalComponentStateDocument`、`LOCAL_COMPONENT_STATE_FORMAT`、`LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT` 及各预算常量 |
| 运行时服务 | `createLocalRuntimeServices`、`createDetachedRuntimeServices` |
| 网络契约 | `ComponentNetwork`、`NetworkChannel`、`SubmitAdapter`、`SubscribeAdapter`、`ChannelValidator`、`ChannelError`、`StreamEvent`、`DEFAULT_NETWORK_MAX_BYTES` |

`reactive-md/runtime/browser` 在纯运行时之上补浏览器能力：

| 分组 | 导出 |
| --- | --- |
| 存储 | `createLocalBrowserStateStorage`、`LOCAL_COMPONENT_STATE_STORAGE_PREFIX`、`LocalWebStorageLike` |
| 生命周期 | `flushComponentStateOnPageHide` |
| HTTP 与 SSE | `httpSubmit`、`sseStream` |
| 双工 | `webSocketChannel`、`webRtcChannel`、`jsonDuplexCodec`、`DEFAULT_DUPLEX_ACK_TIMEOUT_MS`、`DEFAULT_DUPLEX_MESSAGE_BYTES` |

存储与传输对象都是延迟解析的，因此在服务端构建中导入该入口不会触碰 `window`、`localStorage`、`fetch` 或 `EventSource`。

## 测试工具

| 入口 | 导出 | 依赖 |
| --- | --- | --- |
| `reactive-md/testing` | `runLocalManifestCompliance`、`runLocalBehaviorCompliance`、`readLocalBehaviorSpec`、`createLocalComplianceReport`、`compareLocalComplianceParity`、`describeLocalComplianceCase`、协议常量 | 无 |
| `reactive-md/testing/react` | `readLocalReactSpec`、`runLocalReactCompliance`、`checkLocalComplianceMarkup`、`REACT_COMPLIANCE_CAPABILITIES` | React 19 + react-dom 19 |
| `reactive-md/testing/browser` | `readLocalBrowserSpec`、`runLocalBrowserCompliance`、`createPlaywrightBrowserDriver` 及驱动、阶段类型 | 一个浏览器上下文 |

三套结果共用 `LocalComplianceReport` 结构。声明的能力只有在带该能力标签的用例通过后才算满足。`compareLocalComplianceParity` 按用例 id、状态与观测值比较两份结果，用于把默认契约的外部别名实现与内置实现对照。

## 样式表

| 入口 | 用途 |
| --- | --- |
| `reactive-md/styles.css` | 按发布级联顺序排列的组件、主题与文档层 |
| `reactive-md/styles/minimal.css` | 精简预设所需的子集 |
| `reactive-md/screen.css` | `styles.css` 的别名 |
| `reactive-md/print.css` | 打印规则，在 `styles.css` 之后加载 |
| `reactive-md/notices` | 生成的 `THIRD_PARTY_NOTICES.md` |

组件样式以 CSS 文件形式产出，JavaScript 入口不会自动注入。请在文档渲染处导入一次样式表。

## 命令行

`reactive-md` 是该包的二进制入口。

| 命令 | 用途 | 退出码 |
| --- | --- | --- |
| `build <doc> -o <out>` | 将单个文档编译为自包含 HTML 或 PDF，支持状态文件、内联图片与项目发现 | 0、3、4、5 |
| `lint [--json] [--warnings-as-errors] [--locale] <file... \| ->` | 编译并报告诊断，不修改文件 | 0 干净，1 有诊断，2 用法或读取错误 |
| `migrate <file \| ->` | 重写语法修订元数据，支持 `--check`、`--json`、`--accept-semantic-changes` | 0、1、2 |
| `check <package>` | 校验已安装的预设或组件包，不运行浏览器 | 0、2、3、4 |
| `init component \| preset <dir>` | 生成可运行的包脚手架 | 0、2、4 |

退出码含义：0 成功，2 用法错误，3 编译/渲染/构建失败，4 I/O 错误，5 资源或安全策略错误。

`build` 支持 `--format html|pdf`、`--mode interactive|static`、`--state-file`、`--component-state-file`、`--document-id`、`--random-seed`、`--assets inline|omit`、`--asset-root`、`--locale`、`--color-scheme`、`--title`、`--strict` 以及 `--pdf-*` 系列。

## 编辑器包

### `reactive-md-editor`

| 导出 | 用途 |
| --- | --- |
| `ReactiveMarkdownEditor`（别名 `ReactiveMarkdownCodeEditor`） | 受控的 CodeMirror 6 源码编辑器 |
| `ReactiveMarkdownEditorHandle` | `focus`、`selectRange`、`getSelection`、`getSource`、`getEditorElement`、`getVisibleRanges`、`insertText`、`undo`、`redo` |
| `MobileDocBar` | 窄屏文档栏 |
| 类型 | `EditorAuthorAnalysis`、`EditorTransaction`、`SourceChange`、`EditorEdit`、`EditorSelection`、`EditorViewMode`、`EditorComponentMode`、`EditorTheme`、`EditorLocale`、`EditorSurface` |

组件是受控组件，`value` 与 `onChange` 必填。它只渲染源码，不编译预览。属性包括 `locale`、`theme`、`preview`、`viewMode`、`height`、`readOnly`、`disabled`、`documentKey`、`diagnostics`、`document`、`toolbar`、`authoring`、`onExport`、`analysis`、`onTransaction`、`createAnalysisWorker`。

### `reactive-md-editor/codemirror`

同一组件在迁移期 specifier 下的路径，面向从 `reactive-md/editor/codemirror` 迁来的宿主。

### `reactive-md-editor/commands`

无 DOM 依赖的工具栏命令，从 `reactive-md/authoring` 再导出，并附上编辑器的编辑与选区类型。宿主只需要文本变换、不需要组件树时使用。

### 编辑器样式表

`reactive-md-editor/styles.css` 及其别名 `reactive-md-editor/codemirror/styles.css` 包含组件、CodeMirror 与移动端样式，全部作用域限定在编辑器根节点。

## 协议与版本常量

| 常量 | 值 | 作用范围 |
| --- | --- | --- |
| 包版本 | `0.9.2` | 引擎发布 |
| SDK 契约 | `0.7.0`（`LOCAL_SDK_VERSION`） | 组件、预设与配置清单 |
| 语法修订 | `local-draft-3`（`LOCAL_SYNTAX_VERSION`） | 文档源码 |
| 状态文件 | `reactive-md-state/v1`（`LOCAL_STATE_FORMAT`） | 导出的参数 |
| 组件状态 | `reactive-md-component-state/v1` | 组件状态 sidecar |
| HTML 信封 | `reactive-md-html/v1`、`reactive-md-html/v2` | 单文件导出 |
| bundle 清单 | `reactive-md-bundle/v1` | 封印的独立 bundle |
| 恢复要求 | `reactive-md-restore/v1` | 导出侧契约要求 |
| 导出资源 | `reactive-md-export-assets/v1` | 资源清单 |
| 构建清单 | `reactive-md-build/v1` | 独立构建产物 |
| 组件协议 | `reactive-md-component/v1`、`component-protocol-3` | 组件贡献 |
| 主题协议 | `reactive-md-theme-1` | 文档主题 |
| 编辑器包 | `0.2.1` | 编辑器发布，peer `reactive-md: ^0.9.2` |

每个常量独立演进：一次包发布可以引入新的 HTML 信封而不动语法修订，新的主题协议也不会改变 SDK 契约。

## 可观察性

从 `reactive-md/observability` 导入 `LocalObserver`、`LocalTraceEvent`、`createDiagnosticReport` 和 `formatLocalDiagnostic`。通过 `compileLocal(source, { observer })` 或 `new LocalCompileScheduler({ observer, createWorker, onResult })` 订阅事件。回调接收独立副本，回调异常由调用边界隔离。

```ts
import { compileLocal } from 'reactive-md';
import { createDiagnosticReport, type LocalObserver, type LocalTraceEvent } from 'reactive-md/observability';

const events: LocalTraceEvent[] = [];
const observer: LocalObserver = {
  onDiagnostic(diagnostic) { console.warn(diagnostic.code, diagnostic.phase); },
  onTrace(event) {
    events.push(event);
    if (events.length > 50) events.shift();
  },
};
const source = '# 示例';
const result = compileLocal(source, { observer });
const report = createDiagnosticReport(source, { diagnostics: result.diagnostics, events });
```

诊断新增可选的 `phase`、`messageKey`、`recoverable` 和标量 `details` 字段。现有诊断码保留原有语义。Worker、导出和资源诊断的中英文模板通过 `LOCAL_OBSERVABILITY_MESSAGES` 导出。`LocalTraceEvent` 覆盖编译、Worker 和导出阶段；`export-cancel` 类型记录中止的导出，诊断报告接受其 `cancelled` 和 `printed` 状态。Worker 请求携带 `traceId`、`sourceRevision` 和与传输 `id` 相同的 `requestId`。完整请求重试保留源码修订和 trace。调度器默认超时为 30,000 毫秒，可通过 `timeoutMs` 配置，传输失败后回退到主线程编译。

报告采用 `reactive-md-diagnostic/v1` schema，包含包与协议版本、运行环境、源码字节数和摘要、已注册诊断码、源码位置、选定预算字段及最近 50 条事件。浏览器环境包含 user agent 和平台，Node 环境包含 Node 版本和平台。宿主通过 `options.package` 提供 Editor、React 和 Vite 版本。序列化报告上限为 64 KiB，超限时依次移除最早事件和末尾诊断。报告省略源码正文、自由文本消息、诊断参数和资源 owner 路径。宿主负责复制、存储和传输。

## 下一步读什么

| 任务 | 文档 |
| --- | --- |
| 在应用中嵌入文档 | [本地模式集成](../integration/local-integration-ch.md) |
| 编写组件包 | [扩展 SDK](../integration/extension-sdk-ch.md) 与[组件协议](../development/component-protocol-ch.md) |
| 添加主题 | [主题协议](theme-protocol-ch.md) |
| 导出或托管独立 HTML | [分享与静态导出](../integration/shareable-export-ch.md) |
| 接入 Vite 项目 | [目录发现](../integration/directory-discovery-ch.md) |
| 驱动编辑器 | [React 源码编辑器](../integration/editor-ch.md) 与[作者工具](../integration/author-tools-ch.md) |
| 不引入运行时的单次编译 | [单次编译](../integration/compiler-ch.md) |
| 升级前确认兼容性 | [版本与兼容性](../compatibility/compatibility-ch.md) |
