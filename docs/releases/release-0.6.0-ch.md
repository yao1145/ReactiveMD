# 0.6.0 发布说明

`reactive-md@0.6.0` 是同时更新 `latest` 与 `next` 的 0.x 预览版。语法修订保持 `local-draft-2`，组块协议保持 `component-protocol-2`，主题协议保持 `reactive-md-theme-1`。现有导入和文档无需迁移。

```sh
npm install reactive-md
# 或固定版本
npm install reactive-md@0.6.0
```

离线安装可下载 [npm 安装包](https://registry.npmjs.org/reactive-md/-/reactive-md-0.6.0.tgz)。

## 原生 HTML

默认渲染路径的 P0 HTML 新增原生表格。`<table>` 的正文出现 `caption`、`colgroup`、`thead`、`tbody`、`tr`、`th` 或 `td` 时按 HTML 表格渲染，支持 `colspan`、`rowspan`、`scope`、`headers` 及列组 `span`，无需开启扩展 HTML。原生表格与 Markdown 表格共用框架、标题、单元格样式和窄屏滚动；普通数字列自动右对齐。原生表格不提供搜索、排序、分页或行选择，单元格内的 Markdown、公式、插值和控件继续工作。混用 Markdown 表格行与 HTML 结构会给出诊断，并按原文显示该表格。

`div`、`p` 和 `h1` 至 `h6` 支持静态 `align` 属性，取值为 `left`、`center`、`right` 或 `justify`。链接支持显式 `target` 和 `rel`：未指定属性的 HTTP(S) 链接仍在新窗口打开，`target="_blank"` 会保留作者关系词、合并 `noopener noreferrer` 并移除 `opener`，相对链接仍在当前页面打开。

无法解析的局部原生 HTML 现在按原文显示，不再导致整篇文档失败；其余 Markdown、公式和控件继续渲染。新增 `local.html.fallback` 和 `local.html.fallbackAttribute` 警告，分别表示元素因不支持的标签或属性转为惰性源码。React 预览和 standalone 挂载在整篇 HTML 解析失败时显示完整源码，保留换行并转义标签。

## 数学排版

正文支持 `\(...\)` 行内公式和 `\[...\]` 独立公式，与美元定界符共用同一渲染器；plot 仍只接受 `$$...$$`。

排版新增 `aligned`、`align`、`align*`、`pmatrix`、`bmatrix` 和 `vmatrix` 环境，并支持 `\tag` 编号。补充 `\mathbb`、`\mathcal`、`\mathscr`、`\mathfrak`、`\textbf`、`\textit`、上下标注箭头、`\big` 系列定界符，以及 `\sec`、`\sinh`、`\pmod` 等命令。

化学式通过 mhchem 的 `\ce{...}` 编写，例如 `$\ce{H2O}$` 或 `$$\ce{2 H2 + O2 -> 2 H2O}$$`。分子下标、离子电荷、同位素、物态和反应箭头由 `mhchemparser` 转换后进入同一 MathML 渲染器；转换受长度、记号和嵌套预算限制，未支持的命令给出 `local.math.display` 诊断。

## 代码围栏

新增 `cattca`、`mermaid` 和 `vue` 高亮。Vue 单文件组件的模板、JavaScript/TypeScript、CSS/SCSS 分段高亮；Cattca 按 Markdown 正文与命令块高亮；Mermaid 围栏只高亮源码，不渲染图表。无语言标注时继续在受限语言集合中自动识别，未知语言和超过 20,000 字符的代码块保留纯文本。

## 图解与提示

node/edge 图解改用分层布局：源码顺序决定同层顺序，环路整体分组，平行边和标签位置由布局计算，连线使用平滑路径。服务端渲染和首屏仍先输出确定性的同步布局，组件挂载后再切换为最终布局。

tooltip 气泡会限制在视口内，并在滚动、缩放和内容尺寸变化时重新定位；配色跟随文档的浅色、深色和自定义主题。

## 表单与宿主 API

带 `required` 的文本、多行文本和日期控件不再设置原生 `required` 属性，改用 `aria-required` 和现有本地校验。嵌入宿主表单时，未填写的控件不会再以浏览器原生气泡阻止表单提交或 Enter 操作。

`compileLocal` 的返回值现在只包含普通对象和数组，可安全跨 React Server Components 边界传递，冻结元数据与共享引用保持不变。

编辑器 ref 句柄新增 `insertText(text)`：用文本替换当前选区，记录为一次可撤销编辑，并把光标放到插入内容之后。

## 兼容性

现有入口、导入和文档语法保持不变，为 `0.5.x` 编写的文档无需修改。原生 HTML 表格和新数学命令只增加可识别写法；此前作为普通文字显示的相关源码现在可能按 HTML 或公式渲染。新增两个随包构建的依赖：`elkjs`（EPL-2.0 OR GPL-3.0-or-later）与 `mhchemparser`（Apache-2.0），许可声明已更新到 `THIRD_PARTY_NOTICES.md`。

`latest` 从 `0.4.0` 更新到 `0.6.0`，`next` 从 `0.5.3` 更新到 `0.6.0`。版本轴与迁移规则见[变更记录](../../CHANGELOG-ch.md)和[版本与兼容性](../compatibility/compatibility-ch.md)。

## 验证与限制

发布使用完整 `npm run verify:release` 门禁，覆盖核心与 Demo 测试、类型检查、构建、第三方 notice、包入口、文档链接、仓库外真实安装包消费和浏览器交互。CI 在 Node 22.12 和 24 上运行 Node 门禁，浏览器门禁在 Chromium 上运行完整检查，并使用 Firefox 与 WebKit 运行核心工作流；本机浏览器检查使用 Microsoft Edge。Firefox 与 WebKit 的完整交互套件和导出 HTML 之外的通用 SSR 水合仍未验证。

项目仍处于 0.x 预览阶段。安全边界和宿主职责见 [SECURITY-ch.md](../../SECURITY-ch.md)。
