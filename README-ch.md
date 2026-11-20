# Reactive MD

**中文** · [English](README.md)

> 仓库已拆分：本仓库维护语言引擎；[编辑器](https://github.com/yao1145/ReactiveMD-Editor)与 [Demo](https://github.com/yao1145/ReactiveMD-Demo) 独立构建。引擎 0.8 使用独立 reactive-md-editor 包，见[迁移说明](docs/releases/release-0.8.0-ch.md#仓库拆分与导入迁移)。

[![npm](https://img.shields.io/npm/v/reactive-md.svg)](https://www.npmjs.com/package/reactive-md)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**在读者设备上运行的交互式 Markdown 文档。**

Reactive MD 把普通 Markdown 变成一个小型应用：命名输入、实时计算、图表、表格、图解、测验和公式驱动的曲线。作者只写标签和表达式；读者得到一份无需服务器、无需账号、无需构建的响应式文档。完成后可导出单个 HTML 文件，断网仍可使用。

- **本地优先。** 参数和状态留在浏览器中。没有后端运行时，交互也不需要网络往返。
- **Markdown 原生写法。** 输入是 HTML 风格标签，参数用 `bind` 命名，结果显示为 `{{ 表达式 }}`。作者无需编写 JavaScript 或 CSS。
- **完整的表达式语言。** 四则运算、比较、逻辑、条件表达式、数学与格式化函数、聚合、日期函数，以及宿主提供的只读值。
- **无需胶水代码的丰富输出。** 表格、五种图表、LaTeX 曲线、图解、步骤、标签页和测验共享同一组参数。
- **在关键处保持性能。** Worker 编译、块复用、行级补丁和硬性输入预算，让长文档持续保持响应。
- **可扩展。** 发布一个包含 manifest、React 实现和 CSS 的 npm 组件包；它会自动进入编辑器目录，并可参与离线导出。
- **一个文件即可分享。** 构建自包含的交互 HTML，或不含脚本的静态快照。

启用 `reactiveMd()` 后，主题和组件可通过 `theme/` 与 `plugin/` 目录接入，详见[目录接入规则](docs/integration/directory-discovery-ch.md)。

## 一览

| 方面 | 能力 |
| --- | --- |
| 写作 | `.reactive.md`，HTML 风格标签与 `{{ 表达式 }}` |
| 运行 | 本地优先状态；无需后端 |
| 视图 | 51 个内置标签、5 种图表、表格、曲线、图解、画廊、步骤与测验 |
| 集成 | TypeScript 核心、React 19 渲染器、CM6 源码编辑器、CLI |
| 扩展 | npm 组件包、主题、编辑器目录、离线包 |
| 分享 | 单文件交互 HTML、静态 HTML、版本化状态文件 |

## 一个例子看语法

```markdown
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ people * rate }}">

<panel title="工作坊报价">
<slider bind="people" label="人数" initial="4" min="1" max="12">
<toggle bind="annual" label="年度付款">
</panel>

**{{ people }} 人 × {{ rate }} 元 = {{ total }} 元。**

年度价格：**{{ formatCurrency(annual ? total * 0.8 : total, 'CNY', 2, 'zh-CN') }}**。

<if when="{{ annual }}">
<alert tone="success" title="年度付款">已应用 20% 折扣。</alert>
</if>

<chart kind="bar" title="费用与预算">
| 类别 | 费用 | 预算 |
| --- | ---: | ---: |
| 场地 | 400 | 500 |
| 餐饮 | {{ total }} | 900 |
</chart>
```

滑块和开关创建参数，`const` 与 `computed` 命名派生值。正文、条件和图表读取同一份状态，所有视图一起更新。

| 概念 | 写法 |
| --- | --- |
| 参数 | `<slider bind="people">`、`<number>`、`<input>`、`<select>`、`<date>`、`<toggle>` |
| 命名值 | `<const name="rate" value="{{ 80 }}">`、`<computed name="total" value="{{ people * rate }}">` |
| 表达式 | `{{ people * rate }}`、`{{ annual ? total * 0.8 : total }}` |
| 格式化 | `formatCurrency`、`formatPercent`、`formatNumber`、`formatScientific` |
| 数据视图 | `<table>` 与 `<chart>` 中的 Markdown 表格；`bar`、`line`、`area`、`scatter`、`donut` |
| 结构 | `<panel>`、`<card>`、`<grid>`、`<tabs>`、`<accordion>`、`<disclosure>` |
| 流程与教学 | `<if>`、`<diagram>`、`<steps>`、`<quiz>` |
| 公式 | 正文中的 LaTeX 与 `<plot>`；曲线跟随共享参数 |
| 主题 | `<theme name="paper">`、深浅模式、作用域内自定义 CSS |

表达式刻意保持小而安全：没有赋值、方法调用、属性访问、自定义函数或导入。完整函数列表见[语法规范](docs/reference/local-interaction-syntax-ch.md#51-表达式集合)。

## 性能

Reactive MD 面向长文档和连续编辑。当前测量日期为 2026-11-20，环境为 Node 22.17、Intel Core Ultra 5 125H 与 Edge 135 headless、1440×1000。机器未固定频率，以下数字是可复现的实验证据，不是性能保证。

| 工作负载 | 结果 |
| --- | --- |
| 100 万字符纯文本文档 | 首次编译 12.26 ms，稳态中位数 5.15 ms |
| 600 节文章 | 完整编译 282 ms → 增量会话 62 ms（仅编译 1 块，复用 1,799 块） |
| 500 行动态表格 | 最新对比中输入到预览 286 ms → 134 ms |
| 1,000 项动态列表连续编辑 500 次 | GC 后堆增长 0.463 MiB |
| 600 节文章经 Worker + React | 往返 193 ms |
| 1,000 个控件经 Worker + React | 往返 70 ms |
| 参数写入 / 三条曲线重采样 | 0.0004 ms / 0.28 ms |

编译器在 Worker 中运行，复用未变化的块，发布行级补丁，并为深层结构协商扁平结果格式。硬性预算会在异常输入冻结界面之前拒绝它：默认 10,000 个节点、1,000,000 个字符、100 层组件嵌套。

完整的 45 个场景矩阵、回归项、内存检查和复现命令见[性能说明](docs/development/performance-overview-ch.md)，精简数据见 `benchmarks/performance-overview-2026-11-20.json`。

## 体验 Demo

在线 Demo：[yaozi.raricy.com](https://yaozi.raricy.com/)

在 `ReactiveMD-Demo` 仓库根目录运行：

```sh
npm ci --legacy-peer-deps
npm run dev
```

命令先构建语言包，再启动独立应用，地址为 `http://127.0.0.1:5173`。`/embed.html` 展示嵌入方式。顶栏语言按钮可以在中英文之间切换，并记住选择。

建议尝试：

- 依次浏览引导示例：报价、函数、表单、数据与图表、布局、图解、清单与计时。
- 拖动滑块或修改表格单元格，观察正文、卡片和图表如何从同一组参数更新。
- 打开源码编辑器，查看高亮、补全、绑定定位和诊断。
- 从编辑器工具栏插入组件；外部组件包会带着作者信息出现在目录中。
- 打开俄罗斯方块与 2048 插件示例，分别体验定时驱动和回合制的外部组件。
- 把当前预览导出为单文件交互 HTML 或静态快照，然后在断网状态下打开。

在 ReactiveMD-Demo 仓库根目录验证集成：

```sh
npm run build
npm run test:runtime-extensions
npm run test:runtime-extensions -- --dev
```

脚本会自行启停服务，覆盖真实 Worker、两个插件示例、编辑器目录、移动端布局和离线导出，结果写入 `artifacts/demo-extensions/`。

## 用组件扩展

插件是一个 npm 包，由三部分组成：纯数据 manifest、React 实现和可选 CSS。manifest 声明标签、属性、绑定、能力和作者信息；实现读取规范化后的属性，并通过绑定句柄写回状态。

```tsx
// src/my-widget.tsx
import { defineReactComponentPackage, type LocalComponentContext } from 'reactive-md/react';
import { manifest } from './manifest.js';

export const widgetPackage = defineReactComponentPackage({
  ...manifest,
  render: (ctx: LocalComponentContext) => (
    <button onClick={() => ctx.bindings.value.set(1)}>启用</button>
  ),
  css: '.local-document .my-widget { color: var(--ink); }',
});
```

宿主只需装配一次，Vite 会加载同一份注册模块：

```ts
// extensions.ts
import { createReactHost } from 'reactive-md/react';
import { widgetPackage } from 'my-widget/react';

export const host = createReactHost({ packages: [widgetPackage] });
```

```ts
// vite.config.ts
import { reactiveMd } from 'reactive-md/vite';

export default { plugins: [reactiveMd({ extensions: './extensions.ts' })] };
```

Demo 提供两个完整的安装包案例：

| 包 | 标签 | 展示能力 | 更新流程 |
| --- | --- | --- | --- |
| `reactive-md-tetris-package` | `<tetris>` | 定时驱动游戏、键盘与按钮输入、种子方块、离线导出 | [Demo 候选包更新流程](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/candidate-package-updates-ch.md) |
| `reactive-md-game-2048-package` | `<game-2048>` | 回合制状态、确定性生成、键盘与按钮输入、静态预览 | [Demo 候选包更新流程](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/candidate-package-updates-ch.md) |

Demo 站点运行 `ReactiveMD-Demo/plugin/` 下的本地副本；`vendor/` 中提交的 tarball 是兼容性测试使用的安装包夹具。两个包的入口都通过公开的 `./react` 与 `./notices` 读取。它们的作者信息进入编辑器目录，能力证据支撑离线导出。

组件标签必须以字母开头，因此 2048 插件注册为 `<game-2048>`，而不是 `<2048>`。manifest、绑定、主题、资源、合规工具与打包流程见[组件插件开发指南](docs/development/component-development-ch.md)和[完整开发契约](docs/development/component-development-reference-ch.md)。

## 适用场景

| 场景 | Reactive MD 提供什么 |
| --- | --- |
| 交互式报告与仪表盘 | 正文、参数、表格和图表共用一份源码，相关视图保持同步 |
| 教学、教程与课件 | 公式曲线、图解、引导步骤、测验和可自检的示例 |
| 报价、规划与计算器 | 共享命名计算、校验、货币与百分比格式化 |
| 表单、清单与入职流程 | 作用域输入、必填项、清单和计时器，无需服务器 |
| 离线讲义与提案 | 单个 HTML 文件内嵌样式、图片和运行时；禁用 JavaScript 仍可阅读 |
| 应用与文档中的嵌入式小组件 | React 渲染器、独立浏览器 API 或 `<reactive-md-doc>` 元素 |
| 游戏与实验性界面 | 组件 SDK，可使用本地 React 状态、键盘输入、定时器和离线包 |
| 内部工具与活文档 | 本地优先状态，无账号、无后端，源码保持为普通 `.reactive.md` |

## 安装

Reactive MD 需要 Node.js 22.12 或更新版本，包只提供 ESM 入口：

```sh
npm install reactive-md
```

0.9.0 稳定版使用 `latest` 渠道。项目也可以固定版本。

```sh
npm install reactive-md
# 或固定版本
npm install reactive-md@0.9.0
```

升级前请阅读 [0.9.0 发布说明](docs/releases/release-0.9.0-ch.md)和[兼容性说明](docs/compatibility/compatibility-ch.md)。

### 升级到 0.8.0

`reactive-md@0.8.0` 把源码编辑器迁到独立的 `reactive-md-editor@0.1.0` 包。分别安装引擎和编辑器：

```sh
npm install reactive-md@0.8.0
npm install reactive-md-editor@0.1.0
```

替换 `reactive-md/editor` 导入前，请阅读[0.8.0 发布说明](docs/releases/release-0.8.0-ch.md)和[三仓库迁移说明](docs/releases/release-0.8.0-ch.md#仓库拆分与导入迁移)。`0.8.0` 保持语法 `local-draft-3`、`0.7.0` SDK 契约和现有状态协议，文档源码无需迁移。

`reactive-md` 入口提供本地编译器、表达式和运行时，`reactive-md/react` 提供 React 渲染器。组件样式通过 `reactive-md/styles.css` 引入。`reactive-md-editor` 提供源码编辑器，并使用独立样式 `reactive-md-editor/styles.css`。引擎 0.8 移除旧 `reactive-md/editor` 入口；已发布的 0.7 包仍保留它们。

核心入口不依赖 React：

```js
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal('<number bind="n" label="数量" initial="2">');
if (result.ok) {
  const runtime = createLocalRuntime(result.document);
  try { console.log(runtime.text('合计：{{ n * 100 }}')); }
  finally { runtime.dispose(); }
}
```

完整的编译与运行时 API、宿主 URL 策略、生命周期和样式覆盖见[本地模式集成](docs/integration/local-integration-ch.md)。

## 按任务选择入口

[公开接口参考](docs/reference/public-api-ch.md)逐个列出全部入口、导出、CLI 命令、浏览器协议与编辑器包，并注明各自的详细用途。下表按任务归纳引擎子路径。

每个子路径都是 ESM 入口，并带有自己的声明文件。按要做的事情选择；可选 peer 只出现在最后一列。

| 任务 | 入口 | 提供什么 | 刻意不包含 | React / Vite |
| --- | --- | --- | --- | --- |
| 单次编译并在内存中运行 | `reactive-md` | `compileLocal`、`createLocalCompileSession`、`createLocalRuntime`、表达式与曲线采样、状态导入导出与保留、宿主提供的 Worker 协议（`startLocalCompileWorker`、`LocalCompileScheduler`）、`createShareableHtml`、默认预设 | React、CSS、Vite、组件目录与工具栏命令、导出规划 | — |
| 在 Worker 或体积敏感包中编译 | `reactive-md/compiler` | `createCompiler` 与 `CompileResult` 契约：CommonMark、ReactiveMD 结构、表达式、绑定、预算 | React、CSS、编译 Worker 协议、会话、保留、共享/导出代码、默认预设、GFM、原生 HTML、Lezer 块规划、KaTeX 显示、曲线采样 | — |
| 单次编译保留完整语言能力 | `reactive-md/compiler/standard` | `createStandardCompiler`：在轻入口上增加 GFM、原生 HTML、Lezer 块规划、KaTeX 显示检查、曲线公式采样和默认预设 | React、CSS、编译 Worker 协议、会话、保留、共享/导出代码 | — |
| 用 React 渲染 | `reactive-md/react` | `LocalReactiveDocument`、`LocalDocumentView`、`defineReactComponentPackage`、`createReactHost`；构建把样式表提取为独立文件，不在导入时注入 | Node 构建与导出工具、编辑器 | React 19 与 `reactive-md/styles.css` |
| 在服务端渲染 | `reactive-md/react/server` | 带能力预检和诊断的 `renderLocalStaticDocument` | 客户端运行时、DOM、样式表 | React 19 + react-dom 19 |
| 渲染但不自动引入样式 | `reactive-md/react/unstyled` | 同样的组件，不带 CSS 副作用 | `styles.css` | React 19 |
| 编写交互组件 | `reactive-md/react/runtime` | `useTicker`、`useFrame`、`useSwipe`、`useKeys`、`useComponentState` | 文档渲染器、编译器 | React 19 |
| 发布组件包 | `reactive-md/sdk` | `defineLocalComponent`、`defineLocalPreset`，manifest、config、registry 与主题契约及校验 | React 实现、文档渲染、DOM | — |
| 驱动编辑器 | `reactive-md/authoring` | `analyzeLocalSource`、`completeLocalSource`、`formatLocalSource`、`renameLocalBinding`、组件目录与工具栏插入命令 | React、CSS、DOM、编译会话 | — |
| 导出前预检 | `reactive-md/export` | `createLocalExportPlan`、`createLocalShareableHtml`、恢复要求、组件状态文件、样式资源 | Vite 构建、React 渲染（标记由调用方提供）、CLI | — |
| 构建离线包 | `reactive-md/build` | `buildLocalStandaloneBundle`、预检、manifest 与封印、资源与 notice 收集 | 浏览器渲染、CLI | Vite 8（可选 peer，按需加载）、Node |
| 解析导出要内嵌的文件 | `reactive-md/export-assets` | `listExportAssets`、`resolveExportAsset`、`readExportAsset`，覆盖样式表、notice、包元数据与独立运行时 | 编译器、React、浏览器代码 | Node |
| 接入 Vite | `reactive-md/vite` | `reactiveMd()` 注册、开发期 host、`reactive-md-standalone.js` 与 `reactive-md-export.json` 产物 | 运行时 API、浏览器代码 | Vite 8、Node |
| 挂载导出的文档 | `reactive-md/standalone` | `mount`、`mountAll`、`isReactiveMDMounted`、载荷解析、挂载诊断与事件 | 编译入口、自动挂载、构建工具 | React 19 与 `reactive-md/styles.css` |
| 共享标识、随机、计时与组件状态 | `reactive-md/runtime` | 文档标识与种子、可复现随机、调度器、组件状态注册表与运行时服务 | 渲染、Web 存储、网络 | — |
| 在浏览器中保存组件状态 | `reactive-md/runtime/browser` | `createLocalBrowserStateStorage`、`flushComponentStateOnPageHide` | Node 持久化、运行时入口本身 | 浏览器存储对象 |
| 验证组件包 | `reactive-md/testing` | manifest 与行为一致性运行器、报告与对照工具 | React、DOM、浏览器 | — |
| 验证 SSR 输出 | `reactive-md/testing/react` | `runLocalReactCompliance`、`readLocalReactSpec`、错误探针、`checkLocalComplianceMarkup` | 浏览器驱动 | React 19 + react-dom 19 |
| 验证浏览器生命周期 | `reactive-md/testing/browser` | `runLocalBrowserCompliance`、驱动契约、`createPlaywrightBrowserDriver` | 对 Playwright 的依赖 | 真实浏览器上下文 |
| 安装内置组件 | `reactive-md/presets/default` | `defaultPreset`：内置标签的 manifest 数据 | 引擎运行时、React 实现 | — |
| 只安装其中一部分 | `reactive-md/presets/default/packs` | `controlsPack`、`layoutPack`、`dataPack`、`visualsPack` | 包外的组件 | — |
| 设置文档样式 | `reactive-md/styles.css` | 按已发布层叠顺序组织的组件、主题与文档层 | JavaScript | — |
| 打印文档 | `reactive-md/print.css` | 隐藏控件、显示 `.local-print-value` 的打印规则 | 屏幕布局 | 在 `styles.css` 之后引入 |
| 随包分发第三方声明 | `reactive-md/notices` | 生成的 `THIRD_PARTY_NOTICES.md` 文本 | 代码 | — |
| 直接放入预构建运行时 | `reactive-md/assets/standalone.js` | 带 `ReactiveMD.mount`、`mountAll` 和导出载荷自动挂载的 IIFE 构建 | ESM 导入、tree shaking、编译器 | 一个 script 标签与 `reactive-md/styles.css` |

`reactive-md`（根入口）是完整核心面：默认预设、增量会话、状态与保留工具、Worker 协议和共享 HTML 封装。`reactive-md/compiler` 是轻入口，不含 React、CSS、Worker、会话和默认预设。`reactive-md/compiler/standard` 在此基础上加入 GFM、原生 HTML、Lezer 块规划、KaTeX 显示检查、曲线采样和默认预设，仍然不含 React、CSS、Worker 和会话。`npm run test:compiler-entry` 每次构建都检查这条分界：遍历根、compiler 与 standard 三个依赖图，记录各自文件数和字节数；编译入口一旦触及 Worker、会话、保留、共享、导出、React、standalone 或预设模块、样式表或主题协议，检查即失败。

### 最小可用代码

**编译并在内存中运行**

```js
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal('<number bind="n" label="数量" initial="2">');
if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));

const runtime = createLocalRuntime(result.document);
try { console.log(runtime.text('合计：{{ n * 100 }}')); }
finally { runtime.dispose(); }
```

**只编译，不创建运行时**

```js
import { createCompiler } from 'reactive-md/compiler';
import { createStandardCompiler } from 'reactive-md/compiler/standard';

console.log(createCompiler().compile('# 标题\n\n普通 **Markdown**。').status);          // 'valid'
console.log(createStandardCompiler().compile('| a | b |\n| - | - |\n| 1 | 2 |').status); // 'valid'
```

**用 React 渲染**

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} />;
}
```

**在编辑器中提供作者工具**

```ts
import { analyzeLocalSource, insertLocalComponentFromOptions } from 'reactive-md/authoring';

const analysis = analyzeLocalSource(source);
const edit = insertLocalComponentFromOptions(undefined, 'chart', source, { start: 0, end: 0 });
console.log(analysis.bindings, edit.value);
```

**导出与构建**

```ts
import { buildLocalStandaloneBundle } from 'reactive-md/build';
import { createLocalExportPlan } from 'reactive-md/export';

const bundle = await buildLocalStandaloneBundle({ entry: '.reactive-md/host.mjs' });
const plan = createLocalExportPlan({ document, config, target: 'offline', bundle });
if (!plan.ok) throw new Error(plan.diagnostics.map(item => item.message).join('\n'));
```

**测试组件包**

```ts
import { LOCAL_BEHAVIOR_SPEC_PROTOCOL, runLocalBehaviorCompliance, runLocalManifestCompliance } from 'reactive-md/testing';

const manifest = runLocalManifestCompliance(widgetManifest);
const behavior = runLocalBehaviorCompliance({
  protocol: LOCAL_BEHAVIOR_SPEC_PROTOCOL,
  component: 'my-widget',
  source,
  binding: 'value',
}, config);
console.log([...manifest.cases, ...behavior.cases].filter(item => item.status === 'failed'));
```

## 在 React 中使用

React 入口需要 React 19：

```sh
npm install react@19 react-dom@19
```

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} />;
}
```

`LocalReactiveDocument` 会代为编译并管理运行时。若需要自行控制编译、生命周期或 URL 策略，可使用 `LocalDocumentView`，详见[本地模式集成](docs/integration/local-integration-ch.md)。

## 用 React 编辑源码

可复用的源码编辑器位于独立包 `reactive-md-editor`（0.8 发布中为 `0.1.0`），使用独立样式表，发布后与引擎一起安装。0.7 中它以 `reactive-md/editor` 提供。组件是受控的，需要 React 19：

```tsx
import { useState } from 'react';
import { ReactiveMarkdownEditor } from 'reactive-md-editor';
import 'reactive-md-editor/styles.css';

export function Editor() {
  const [source, setSource] = useState('# 笔记');
  return <ReactiveMarkdownEditor value={source} onChange={setSource} />;
}
```

编辑器处理高亮、格式与插入工具、补全、绑定工具、撤销重做及行号。它不编译、不渲染预览；源码由应用保存，并用 `reactive-md/react` 渲染。属性、ref 句柄、诊断、主题、语言和历史规则见 [React 源码编辑器](docs/integration/editor-ch.md)。

## 分享文档

构建读者可以离线打开的单个 HTML 文件，或不含脚本的静态快照：

```sh
npm run build
npx reactive-md build examples/local/counter.reactive.md -o counter.html
npx reactive-md build examples/local/counter.reactive.md -o counter-static.html --mode static
```

交互文件内嵌原始源码、React 19、运行时、样式以及经过校验的本地图片。它先渲染静态首屏，因此禁用 JavaScript 时仍可阅读。使用 `--state-file doc.state.json` 导出已保存的 `reactive-md-state/v1` 基线；省略时使用作者初值，并把它作为读者的重置基线。使用 `--component-state-file game.state.json` 把组件内部进度写入交互文件，`--document-id` 和 `--random-seed` 指定其身份与随机流。Demo 导出对话框可以把当前预览参数保存成此类状态文件。

图片上限、CSP/安全、打印、退出码、`ReactiveMD.mount`/`mountAll` 与 `<reactive-md-doc>` 见[可分享文档与静态导出](docs/integration/shareable-export-ch.md)。

## 仓库结构

```text
src/           本地语法编译、表达式、运行时和 React 渲染器
examples/      可复制的本地交互示例与组件包
docs/          语法规范、集成、开发和发布文档
tests/         语言与渲染器测试
ReactiveMD-Demo/  独立仓库：Playground 应用与插件集成
benchmarks/    带来源说明的精简性能数据
```

## 文档

- [文档导航](docs/README-ch.md)与[新用户入门指南](docs/guides/local-guide-ch.md)。
- [本地交互语法规范](docs/reference/local-interaction-syntax-ch.md)与[功能演示与示例](examples/local/README.md)。
- [本地模式集成](docs/integration/local-integration-ch.md)：核心与 React API、URL 策略、生命周期、样式和版本固定。
- [可分享文档与静态导出](docs/integration/shareable-export-ch.md)：CLI build/lint、状态文件、本地图片内联、打印与独立浏览器运行时。
- [React 源码编辑器](docs/integration/editor-ch.md)与[作者工具](docs/integration/author-tools-ch.md)。
- [组块协议](docs/development/component-protocol-ch.md)与[组件插件开发指南](docs/development/component-development-ch.md)。
- [扩展开发教程](docs/development/extension-tutorial-ch.md)：选择入口、编写组件包并验证。
- [版本与兼容性](docs/compatibility/compatibility-ch.md)。
- [性能说明](docs/development/performance-overview-ch.md)与[发布清单](CONTRIBUTING-ch.md#发布流程)。
- [0.9.0 发布说明](docs/releases/release-0.9.0-ch.md)和[历史发布记录](docs/releases)。

## 支持与状态

- CI 使用 Node 24 运行引擎检查和预设脚手架验证。打包消费者检查覆盖静态 SSR。构建后运行 `node scripts/verify-shareable.mjs`，可用 Chromium 验证单文件水合并测量 standalone 体积。
- 0.x 次版本可能包含破坏性变更。请保存原始 `.reactive.md` 源码，而不是运行时 AST 或内存状态。
- `0.9.0` 是 `latest` 渠道的稳定版本。安全修复可能随次版本发布。
- 扩展 SDK 契约为 `0.7.0`。组件包、主题、Vite 适配器、离线构建和合规工具均使用公开入口。

## 贡献与安全

- [贡献指南](CONTRIBUTING-ch.md)：环境、检查命令和改动要求。
- [安全策略](SECURITY-ch.md)：威胁边界、资源上限、宿主责任和漏洞报告渠道。
- [变更记录](CHANGELOG-ch.md)。
- [发布清单](CONTRIBUTING-ch.md#发布流程)：验证门禁、notice、tarball 和人工发布流程。

## 许可证

[MIT](LICENSE)
