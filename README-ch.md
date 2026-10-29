# Reactive MD

[English](README.md)

用 Markdown 写本地交互文档。放入输入控件，用 `bind` 命名参数，用 `{{ 表达式 }}` 连接文字、公式、图表和图解。文档作者无需编写 JavaScript 或 CSS。

本地模式采用 HTML 风格标签，参数和表格数据直接写在正文中，LaTeX 公式可用于函数绘图。TypeScript 核心和 React 渲染器可独立集成。`0.6.1` 同时提供于 `latest` 与 `next` 渠道，公式展示改用 KaTeX，并随包提供数学字体，支持离线 HTML。语法修订继续为 `local-draft-2`，组块协议为 `component-protocol-2`。

## 从这里开始

- [文档导航](docs/README-ch.md)：按入门、参考、集成、兼容、开发维护与发布记录查阅。
- [新用户入门指南](docs/guides/local-guide-ch.md)：从 Markdown 过渡到交互文档，含完整练习与错误速查。
- [本地交互语法规范](docs/reference/local-interaction-syntax-ch.md) · [功能演示与示例](examples/local/README.md)：49 个标签名、标签、就地参数与 LaTeX 绘图。
- [本地模式集成](docs/integration/local-integration-ch.md)：`compileLocal`、状态运行时、React 嵌入、URL 策略与样式作用域。
- [HTML 部分兼容](docs/reference/html-compatibility-ch.md)：P0 HTML 与下个发行版针对作者 CSS、JavaScript 和扩展 HTML 的暂时性分流政策。
- [可分享文档与静态导出](docs/integration/shareable-export-ch.md)：单文件交互 HTML、静态输出、版本化状态文件、图片资源、CLI 与独立浏览器 API。
- [主题协议](docs/reference/theme-protocol-ch.md)：文档主题选择、自定义 CSS 与深浅模式。
- [作者工具](docs/integration/author-tools-ch.md)：源码高亮、补全、绑定定位、重命名、格式化与命令行检查。
- [React 源码编辑器](docs/integration/editor-ch.md)：受控编辑器、属性、ref 句柄、诊断、语言、主题与历史。
- [独立接入示例](examples/integration/README.md)：可复制到仓库外运行的 Node 核心和 React 页面。
- [版本与兼容性](docs/compatibility/compatibility-ch.md)：0.x 规则、迁移、诊断契约和平台范围。
- [组块协议](docs/development/component-protocol-ch.md) · [组块开发指南](docs/development/component-development-ch.md)：新增组件的声明、行为契约和兼容性验收。
- [0.6.1 发布说明](docs/releases/release-0.6.1-ch.md)：KaTeX 公式排版、内嵌字体与离线公式。
- [0.5.3 发布说明](docs/releases/release-0.5.3-ch.md)：宿主集成补丁与作者工具。
- [0.5.1 发布说明](docs/releases/release-0.5.1-ch.md)：编辑器视图与主题，以及 HTML 兼容。
- [0.5.0 发布说明](docs/releases/release-0.5.0-ch.md)：编辑器入口与文档渲染修复。
- [0.4.1 发布说明](docs/releases/release-0.4.1-ch.md)：界面与交互修复，兼容 0.4.0。
- [0.4.0 发布与迁移](docs/releases/release-0.4.0-ch.md)：本 minor 系列包含的能力，以及从 `0.3.1` / `local-draft-1` 升级的方法。

## 写一份文档

```markdown
<panel title="费用估算">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="年度付款">
</panel>

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。
```

输入立即更新结果，面板自带“恢复默认”。独立使用的计数器只需一行 `<counter label="人数">`。

`0.4.0` 新增 `local-draft-2`、命名计算、校验、集合、主题和离线 HTML 导出；旧版 `0.3.1` 使用 `local-draft-1`。见[0.4.0 发布与迁移](docs/releases/release-0.4.0-ch.md)。

## 安装

需要 Node.js 22.12 或更新版本，包提供 ESM 入口：

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

`reactive-md` 入口提供本地编译器、表达式和运行时，`reactive-md/react` 提供 React 渲染器。组件样式通过 `reactive-md/styles.css` 引入。`reactive-md/editor` 提供源码编辑器，并使用独立样式 `reactive-md/editor/styles.css`。现有渲染器和样式导入在 0.6.1 中保持不变。

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

`reactive-md` 核心入口不依赖 React。完整的编译与运行时 API、宿主 URL 策略、生命周期和样式覆盖见[本地模式集成](docs/integration/local-integration-ch.md)。

## 用 React 编辑源码

0.5.x 预览版在 `reactive-md/editor` 提供可复用的源码编辑器，样式位于 `reactive-md/editor/styles.css`。组件是受控的，需要 React 19：

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

0.x 次版本可能包含破坏性变更。升级前阅读[变更记录](CHANGELOG-ch.md)与[兼容规则](docs/compatibility/compatibility-ch.md)，并保存原始 `.reactive.md` 源码。

## 分享文档

构建读者可以离线打开的单个 HTML 文件，或不含脚本的静态快照：

```sh
npm run build
npx reactive-md build examples/local/counter.reactive.md -o counter.html
npx reactive-md build examples/local/counter.reactive.md -o counter-static.html --mode static
```

交互文件内嵌原始源码、React 19、运行时、样式以及经过校验的本地图片。它先渲染静态首屏，因此禁用 JavaScript 时仍可阅读。使用 `--state-file doc.state.json` 导出已保存的 `reactive-md-state/v1` 基线；省略时使用作者初值，并把它作为读者的重置基线。Demo 导出对话框可以把当前预览参数保存成此类状态文件。

图片上限、CSP/安全、打印、退出码、`ReactiveMD.mount`/`mountAll` 与 `<reactive-md-doc>` 见[可分享文档与静态导出](docs/integration/shareable-export-ch.md)。CI 在 Chromium 上运行完整浏览器门禁，并使用 Firefox 与 WebKit 运行核心工作流；本机浏览器检查使用 Microsoft Edge。Firefox 与 WebKit 的完整交互套件和通用 SSR 水合仍未验证。

## 体验 Demo

```sh
npm ci
npm run dev
```

该命令先构建语言包，再启动独立的 `demo/` 应用，地址为 `http://127.0.0.1:5173`。`/embed.html` 展示嵌入方式。页面顶部的语言按钮可以在中文和英文之间切换，选择会保存在浏览器中。Demo 的页面、编辑器、演示服务、资产和浏览器检查均在 `demo/`，通过语言包的公开入口集成。

## 仓库结构

```text
src/           本地语法编译、表达式、运行时和 React 渲染器
examples/      可复制的本地交互示例，与 demo 应用无关
docs/          本地语法规范、集成与发布文档
tests/         语言与渲染器测试
demo/          独立的 Playground 应用
```

## 文档

- [新用户入门指南](docs/guides/local-guide-ch.md)与[本地交互语法规范](docs/reference/local-interaction-syntax-ch.md)。
- [本地模式集成](docs/integration/local-integration-ch.md)：核心与 React API、URL 策略、生命周期、样式和版本固定。
- [可分享文档与静态导出](docs/integration/shareable-export-ch.md)：CLI build/lint、状态文件、本地图片内联、打印与独立浏览器运行时。
- [功能演示与示例](examples/local/README.md)与[独立接入示例](examples/integration/README.md)。
- [React 源码编辑器](docs/integration/editor-ch.md)：编辑 `.reactive.md` 源码的受控组件，使用独立样式表。
- [版本与兼容性](docs/compatibility/compatibility-ch.md)、[0.6.1 发布说明](docs/releases/release-0.6.1-ch.md)与[0.5.1 发布说明](docs/releases/release-0.5.1-ch.md)。
- [0.4.0 发布与迁移](docs/releases/release-0.4.0-ch.md)。
- [组块协议](docs/development/component-protocol-ch.md)与[组块开发指南](docs/development/component-development-ch.md)。
- [性能说明](docs/development/performance-overview-ch.md)与[发布清单](docs/development/releasing-ch.md)。

更多开发与测试命令见[贡献指南](CONTRIBUTING-ch.md)。

## 贡献与安全

- [贡献指南](CONTRIBUTING-ch.md)：环境、检查命令和改动要求。
- [安全策略](SECURITY-ch.md)：威胁边界、资源上限、宿主责任和漏洞报告渠道。
- [变更记录](CHANGELOG-ch.md)。
- [发布清单](docs/development/releasing-ch.md)：验证门禁、notice、tarball 和人工发布流程。

## 许可证

[MIT](LICENSE)
