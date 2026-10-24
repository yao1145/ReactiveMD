# Reactive MD

[English](README.md)

用 Markdown 写本地交互文档。放入输入控件，用 `bind` 命名参数，用 `{{ 表达式 }}` 连接文字、公式、图表和图解。文档作者无需编写 JavaScript 或 CSS。

本地模式采用 HTML 风格标签，参数和表格数据直接写在正文中，LaTeX 公式可用于函数绘图。TypeScript 核心和 React 渲染器可独立集成。当前工作区为尚未发布的 `0.4.0` 开发预览版，语法修订 `local-draft-2`。

## 从这里开始

- [新用户入门指南](docs/local-guide-ch.md)：从 Markdown 过渡到交互文档，含完整练习与错误速查。
- [本地交互语法规范](docs/local-interaction-syntax-ch.md) · [功能演示与示例](examples/local/README.md)：43 个组件名、标签、就地参数与 LaTeX 绘图。
- [本地模式集成](docs/local-integration-ch.md)：`compileLocal`、状态运行时、React 嵌入、URL 策略与样式作用域。
- [可分享文档与静态导出](docs/shareable-export-ch.md)：单文件交互 HTML、静态输出、版本化状态文件、图片资源、CLI 与独立浏览器 API。
- [主题协议](docs/theme-protocol-ch.md)：文档主题选择、自定义 CSS 与深浅模式。
- [独立接入示例](examples/integration/README.md)：可复制到仓库外运行的 Node 核心和 React 页面。
- [版本与兼容性](docs/compatibility-ch.md)：0.x 规则、迁移、诊断契约和平台范围。
- [组块协议](docs/component-protocol-ch.md) · [组块开发指南](docs/component-development-ch.md)：新增组件的声明、行为契约和兼容性验收。
- [Demo 说明](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md)。

## 写一份文档

```markdown
<panel title="费用估算">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="年度付款">
</panel>

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。
```

输入立即更新结果，面板自带“恢复默认”。独立使用的计数器只需一行 `<counter label="人数">`。

新增组块需要使用当前工作区构建；已发布的 0.3.1 仍使用 local-draft-1。见[新增组块与迁移](docs/local-components-v2-ch.md)。

## 安装

需要 Node.js 22.12 或更新版本，包提供 ESM 入口：

```sh
npm install reactive-md@0.3.1
```

`reactive-md` 入口提供本地编译器、表达式和运行时，`reactive-md/react` 提供 React 渲染器。组件样式通过 `reactive-md/styles.css` 引入。

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

`reactive-md` 核心入口不依赖 React。完整的编译与运行时 API、宿主 URL 策略、生命周期和样式覆盖见[本地模式集成](docs/local-integration-ch.md)。

0.x 次版本可能包含破坏性变更。升级前阅读[变更记录](CHANGELOG-ch.md)与[兼容规则](docs/compatibility-ch.md)，并保存原始 `.reactive.md` 源码。

## 分享文档

构建读者可以离线打开的单个 HTML 文件，或不含脚本的静态快照：

```sh
npm run build
npx reactive-md build examples/local/counter.reactive.md -o counter.html
npx reactive-md build examples/local/counter.reactive.md -o counter-static.html --mode static
```

交互文件内嵌原始源码、React 19、运行时、样式以及经过校验的本地图片。它先渲染静态首屏，因此禁用 JavaScript 时仍可阅读。使用 `--state-file doc.state.json` 导出已保存的 `reactive-md-state/v1` 基线；省略时使用作者初值，并把它作为读者的重置基线。Demo 导出对话框可以把当前预览参数保存成此类状态文件。

图片上限、CSP/安全、打印、退出码、`ReactiveMD.mount`/`mountAll` 与 `<reactive-md-doc>` 见[可分享文档与静态导出](docs/shareable-export-ch.md)。单文件静态首屏水合已在 Playwright Chromium 和本地 Edge 验证；Firefox、Safari/WebKit 与通用 SSR 水合仍未验证。

## 体验 Demo

```sh
npm ci
npm run dev
```

该命令先构建语言包，再启动独立的 `demo/` 应用，地址为 `http://127.0.0.1:5173`。`/embed.html` 展示嵌入方式。页面顶部的语言按钮可以在中文和英文之间切换，选择会保存在浏览器中。Demo 的页面、编辑器、演示服务、资产和浏览器检查均在 `demo/`，通过语言包的公开入口集成。

```text
src/           本地语法编译、表达式、运行时和 React 渲染器
examples/      可复制的本地交互示例，与 demo 应用无关
docs/          本地语法规范、集成与发布文档
tests/         语言与渲染器测试
demo/          独立的 Playground 应用
```

更多开发与测试命令见[贡献指南](CONTRIBUTING-ch.md)。

## 贡献与安全

- [贡献指南](CONTRIBUTING-ch.md)：环境、检查命令和改动要求。
- [安全策略](SECURITY-ch.md)：威胁边界、资源上限、宿主责任和漏洞报告渠道。
- [变更记录](CHANGELOG-ch.md)。
- [发布清单](docs/releasing-ch.md)：维护者的包名、notice、tarball 和人工发布流程。

## 许可证

[MIT](LICENSE)
