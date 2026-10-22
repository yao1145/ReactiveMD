# Reactive MD

[English](README.en.md)

用 Markdown 写本地交互文档。放入输入控件，用 `bind` 命名参数，用 `{{ 表达式 }}` 连接文字、公式、图表和图解。文档作者无需编写 JavaScript 或 CSS。

本地模式采用 HTML 风格标签，参数和表格数据直接写在正文中，LaTeX 公式可用于函数绘图。TypeScript 核心和 React 渲染器可独立集成。当前为 `0.3.0` 预览版，语法修订 `local-draft-1`，尚未发布到 npm。

## 从这里开始

- [新用户入门指南](docs/local-guide.md)：从 Markdown 过渡到交互文档，含完整练习与错误速查。
- [本地交互语法规范](docs/local-interaction-syntax.md) · [12 份 Demo](examples/local/README.md)：33 个组件名、标签、就地参数与 LaTeX 绘图。
- [本地模式集成](docs/local-integration.md)：`compileLocal`、状态运行时、React 嵌入、URL 策略与样式作用域。
- [独立接入示例](examples/integration/README.md)：可复制到仓库外运行的 Node 核心和 React 页面。
- [版本与兼容性](docs/compatibility.md)：0.x 规则、迁移、诊断契约和平台范围。
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

## 安装与构建

需要 Node.js 22.12 或更新版本。包只提供 ESM 入口。在仓库根目录执行：

```sh
npm install
npm run build
npm test
npm run test:package
npm run test:docs
```

`build` 只构建语言包，输出到 `dist-library/`。`reactive-md` 入口提供本地编译器、表达式和运行时，`reactive-md/react` 提供 React 渲染器。组件样式通过 `reactive-md/styles.css` 引入。

### 从本地 tarball 安装

首次发布前，从本仓库打包安装：

```sh
npm pack
```

`npm pack` 会通过 `prepack` 构建 `dist-library/` 并生成第三方 notice。在宿主项目中安装输出文件，文件名由包名和版本决定，当前为 `reactive-md-0.3.0.tgz`：

```sh
npm install /path/to/reactive-md-0.3.0.tgz
```

React 入口需要 React 19：

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} />;
}
```

`reactive-md` 核心入口不依赖 React。完整的编译与运行时 API、宿主 URL 策略、生命周期和样式覆盖见[本地模式集成](docs/local-integration.md)。

0.x 次版本可能包含破坏性变更。升级前阅读[变更记录](CHANGELOG.md)与[兼容规则](docs/compatibility.md)，并保存原始 `.reactive.md` 源码。

## 体验 Demo

```sh
npm run dev
```

该命令先构建语言包，再启动独立的 `demo/` 应用，地址为 `http://127.0.0.1:5173`。`/embed.html` 展示嵌入方式。Demo 的页面、编辑器、演示服务、资产和浏览器检查均在 `demo/`，通过语言包的公开入口集成。

```text
src/           本地语法编译、表达式、运行时和 React 渲染器
examples/      可复制的本地交互示例，与 demo 应用无关
docs/          本地语法规范、集成与发布文档
tests/         语言与渲染器测试
demo/          独立的 Playground 应用
```

更多开发与测试命令见[贡献指南](CONTRIBUTING.md)。

## 贡献与安全

- [贡献指南](CONTRIBUTING.md)：环境、检查命令和改动要求。
- [安全策略](SECURITY.md)：威胁边界、资源上限、宿主责任和漏洞报告渠道。
- [变更记录](CHANGELOG.md)。
- [发布清单](docs/releasing.md)：维护者的包名、notice、tarball 和人工发布流程。

## 许可证

[MIT](LICENSE)
