# Reactive MD

[English](README.md)

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

## 一览

| 方面 | 能力 |
| --- | --- |
| 写作 | `.reactive.md`，HTML 风格标签与 `{{ 表达式 }}` |
| 运行 | 本地优先状态；无需后端 |
| 视图 | 49 个内置标签、5 种图表、表格、曲线、图解、步骤与测验 |
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

Reactive MD 面向长文档和连续编辑。当前测量日期为 2026-10-29，环境为 Node 22.17、Intel Core Ultra 5 125H 与 Edge 135 headless、1440×1000。机器未固定频率，以下数字是可复现的实验证据，不是性能保证。

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

完整的 45 个场景矩阵、回归项、内存检查和复现命令见[性能说明](docs/development/performance-overview-ch.md)，精简数据见 `benchmarks/performance-overview-2026-10-29.json`。

## 体验 Demo

在线 Demo：[yaozi.raricy.com](https://yaozi.raricy.com/)

在仓库根目录运行：

```sh
npm ci
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

在仓库根目录验证集成：

```sh
npm run build:demo
node demo/scripts/verify-extensions.mjs
node demo/scripts/verify-extensions.mjs --dev
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

| 包 | 标签 | 展示能力 | 更新命令 |
| --- | --- | --- | --- |
| `reactive-md-tetris-package` | `<tetris>` | 定时驱动游戏、键盘与按钮输入、种子方块、离线导出 | `npm run update:demo-tetris` |
| `reactive-md-game-2048-package` | `<game-2048>` | 回合制状态、确定性生成、键盘与按钮输入、静态预览 | `npm run update:demo-2048` |

两者都以 npm tarball 的形式放在 `demo/vendor/`，作为 Demo 依赖安装，并通过公开的 `./react` 与 `./notices` 入口读取。它们的作者信息进入编辑器目录，能力证据支撑离线导出。

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

`latest` 与 `next` 当前都指向 `0.6.1`：

```sh
npm install reactive-md
# 或固定版本
npm install reactive-md@0.6.1
```

本版本说明见[0.6.1 发布说明](docs/releases/release-0.6.1-ch.md)；从 `0.3.1` / `local-draft-1` 升级前请阅读[迁移说明](docs/releases/release-0.4.0-ch.md)。

`reactive-md` 入口提供本地编译器、表达式和运行时，`reactive-md/react` 提供 React 渲染器。组件样式通过 `reactive-md/styles.css` 引入。`reactive-md/editor` 提供源码编辑器，并使用独立样式 `reactive-md/editor/styles.css`。

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

可复用的源码编辑器位于 `reactive-md/editor`，使用独立样式表。组件是受控的，需要 React 19：

```tsx
import { useState } from 'react';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import 'reactive-md/editor/styles.css';

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

交互文件内嵌原始源码、React 19、运行时、样式以及经过校验的本地图片。它先渲染静态首屏，因此禁用 JavaScript 时仍可阅读。使用 `--state-file doc.state.json` 导出已保存的 `reactive-md-state/v1` 基线；省略时使用作者初值，并把它作为读者的重置基线。Demo 导出对话框可以把当前预览参数保存成此类状态文件。

图片上限、CSP/安全、打印、退出码、`ReactiveMD.mount`/`mountAll` 与 `<reactive-md-doc>` 见[可分享文档与静态导出](docs/integration/shareable-export-ch.md)。

## 仓库结构

```text
src/           本地语法编译、表达式、运行时和 React 渲染器
examples/      可复制的本地交互示例与组件包
docs/          语法规范、集成、开发和发布文档
tests/         语言与渲染器测试
demo/          独立的 Playground 应用与插件集成
benchmarks/    带来源说明的精简性能数据
```

## 文档

- [文档导航](docs/README-ch.md)与[新用户入门指南](docs/guides/local-guide-ch.md)。
- [本地交互语法规范](docs/reference/local-interaction-syntax-ch.md)与[功能演示与示例](examples/local/README.md)。
- [本地模式集成](docs/integration/local-integration-ch.md)：核心与 React API、URL 策略、生命周期、样式和版本固定。
- [可分享文档与静态导出](docs/integration/shareable-export-ch.md)：CLI build/lint、状态文件、本地图片内联、打印与独立浏览器运行时。
- [React 源码编辑器](docs/integration/editor-ch.md)与[作者工具](docs/integration/author-tools-ch.md)。
- [组块协议](docs/development/component-protocol-ch.md)与[组件插件开发指南](docs/development/component-development-ch.md)。
- [版本与兼容性](docs/compatibility/compatibility-ch.md)。
- [性能说明](docs/development/performance-overview-ch.md)与[发布清单](docs/development/releasing-ch.md)。
- [0.6.1 发布说明](docs/releases/release-0.6.1-ch.md)以及 [docs/releases](docs/releases) 中的历史记录。

## 支持与状态

- CI 使用 Node 22.12 与 Node 24，以 Playwright Chromium 运行完整浏览器门禁，并使用 Firefox/WebKit 运行核心工作流；本机浏览器检查使用 Microsoft Edge。打包检查覆盖静态 SSR，`npm run test:shareable` 覆盖单文件导出的静态首屏水合。该路径之外的通用 SSR 水合，以及 Firefox/WebKit 的完整交互套件仍未验证。
- 0.x 次版本可能包含破坏性变更。请保存原始 `.reactive.md` 源码，而不是运行时 AST 或内存状态。
- `latest` 与 `next` 当前都是 `0.6.1`。安全修复可能随次版本发布。
- 扩展 SDK 目前为源码预览：registry 中的 `0.6.1` 尚不包含组件包 API。请使用当前源码构建的 tarball。

## 贡献与安全

- [贡献指南](CONTRIBUTING-ch.md)：环境、检查命令和改动要求。
- [安全策略](SECURITY-ch.md)：威胁边界、资源上限、宿主责任和漏洞报告渠道。
- [变更记录](CHANGELOG-ch.md)。
- [发布清单](docs/development/releasing-ch.md)：验证门禁、notice、tarball 和人工发布流程。

## 许可证

[MIT](LICENSE)
