# Reactive MD

用 Markdown 写本地交互文档。放入输入控件，用 `bind` 命名参数，用 `{{ 表达式 }}` 连接文字、公式、图表和图解。文档作者无需编写 JavaScript 或 CSS。

本地模式采用 HTML 风格标签，参数和表格数据直接写在正文中，LaTeX 公式可用于函数绘图。TypeScript 核心和 React 渲染器可独立集成。

## 从这里开始

- [本地交互语法规范](docs/local-interaction-syntax.md) · [12 份 Demo](examples/local/README.md)：标签、就地参数与 LaTeX 绘图。
- [本地模式集成](docs/local-integration.md)：`compileLocal`、状态运行时与 React 嵌入。
- [Demo 说明](demo/README.md)。

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

需要 Node.js 22.12 或更新版本。在仓库根目录执行：

```sh
npm install
npm run build
npm test
npm run test:package
npm run test:docs
```

`build` 只构建语言包，输出到 `dist-library/`。`reactive-md` 入口提供本地编译器、表达式和运行时，`reactive-md/react` 提供 React 渲染器。组件样式通过 `reactive-md/styles.css` 引入。包尚未发布到 npm，本地应用可使用工作区或本地文件依赖。

## 体验 Demo

```sh
npm run dev
```

该命令先构建语言包，再启动独立的 `demo/` 应用，地址为 `http://127.0.0.1:5173`。`/embed.html` 展示嵌入方式。Demo 的页面、编辑器、演示服务、资产和浏览器检查均在 `demo/`，通过语言包的公开入口集成。

```text
src/           本地语法编译、表达式、运行时和 React 渲染器
examples/      可复制的本地交互示例，与 demo 应用无关
docs/          本地语法规范与集成文档
tests/         语言与渲染器测试
demo/          独立的 Playground 应用
```

更多开发与测试命令见 [Demo README](demo/README.md)。

## 许可证

[MIT](LICENSE)
