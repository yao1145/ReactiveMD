# HTML 部分兼容与暂时性分流政策

此功能面向下个发行版。默认文档继续使用 Markdown、ReactiveMD 控件和表达式，并支持下表中的 P0 HTML。CSS、JavaScript 和扩展 HTML 由宿主分别开启，默认全部关闭。

## 暂时性分流政策

为了避开作者 CSS、JavaScript、扩展 HTML 与 ReactiveMD 之间的混合解析和渲染冲突，本版采用整篇分流：

| 编译选项 | 文档行为 |
| --- | --- |
| 三个开关全部关闭或省略 | 使用 ReactiveMD 解析器和现有 React 渲染器，支持 P0 HTML |
| 任意一个开关为 `true` | 整篇源码按原生 HTML 处理，在隔离的 iframe 中渲染 |

原生 HTML 路径中的 `# 标题`、`**强调**`、LaTeX 和 `{{ 表达式 }}` 保持普通文本；`<input>`、`<table>` 等按 HTML 语义处理，ReactiveMD 组件不建立绑定。关闭全部开关会重新编译回默认模式。此政策是本版的过渡方案，后续版本再评估混合兼容。

开关是宿主能力设置，源码、参数状态文件和文档标签不能自行开启它们。Demo 始终显示当前模式，刷新页面后回到三个开关全部关闭的状态。

## 开关与 API

```ts
import { compileLocal } from 'reactive-md';

// Markdown、ReactiveMD 与 P0 HTML。
const reactive = compileLocal(source);

// 整篇按原生 HTML 处理；只允许作者 CSS。
const html = compileLocal(source, {
  enableCss: true,
  enableJavaScript: false,
  enableExtendedHtml: false,
});
```

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `enableCss` | `false` | 允许作者 CSS |
| `enableJavaScript` | `false` | 允许作者脚本和事件处理代码 |
| `enableExtendedHtml` | `false` | 允许 P1 标签、嵌入、表单、SVG/MathML 和整页 HTML 功能 |

选项必须是布尔值。开启一个开关不会顺带开启其他两个。带样式的扩展元素需要同时允许扩展 HTML 和 CSS；扩展元素中的脚本需要同时允许扩展 HTML 和 JavaScript。内置组件使用的样式、交互代码、图表 SVG 和公式 MathML 不受作者能力开关影响。

现有源码长度和 `limits.maxSyntaxNodes` 预算继续生效。HTML 路径按解析遍历的节点计数，嵌套 `srcdoc` 共用累计预算。

React 快捷组件通过 `compileOptions` 接收同样的设置：

```tsx
<LocalReactiveDocument
  source={source}
  compileOptions={{ enableCss: true }}
/>
```

底层宿主把 `compileLocal` 生成的文档交给 `LocalDocumentView`。原生 HTML 文档的 `document.html` 记录三个归一化开关；参数和绑定集合为空。该字段属于运行时元数据，保存文档时保留原始源码和宿主设置。

## 默认支持的 P0 HTML

| 用途 | 标签 |
| --- | --- |
| 行内文字 | `b`、`strong`、`i`、`em`、`s`、`del`、`u`、`mark`、`sup`、`sub` |
| 换行与分隔 | `br`、`hr` |
| 段落与标题 | `p`、`h1` 至 `h6` |
| 容器 | `div`、`span` |
| 折叠内容 | `details`、`summary` |
| 引用 | `blockquote` |
| 代码 | `code`、`pre`、`pre` 内的 `code` |
| 列表 | `ul`、`ol`、`li`，含 `ol[start]` |
| 链接与图片 | `a`、`img`，沿用默认路径的 URL 策略 |
| 原生表格 | `table`、`caption`、`colgroup`、`col`、`thead`、`tbody`、`tfoot`、`tr`、`th`、`td`，按正文结构与 ReactiveMD 表格区分 |
| 其他写法 | HTML 注释、命名及数字字符引用、HTML 大小写和空元素写法 |

容器中的正文继续解析 Markdown、公式、插值和 ReactiveMD 控件；`code`、`pre` 中的内容按字面显示。`details` 复用现有折叠组件的主题和交互，支持富文本标题、嵌套和 `open`，静态模式展开正文。HTML 布尔属性按存在与否判断，因此 `open="false"` 仍表示展开；现有 ReactiveMD 组件的布尔值规则保持不变。

可运行示例见 [HTML 与 ReactiveMD](../../examples/local/html-compat.reactive.md)。

`div`、`p` 和 `h1` 至 `h6` 支持静态 `align` 属性，取值为 `left`、`center`、`right` 或 `justify`，忽略大小写和首尾空白。例如：

```html
<div align="center">你好</div>
<p align="right">右对齐的 **Markdown** 段落。</p>
```

对齐不需要开启 CSS 或扩展 HTML，容器内的 Markdown 和绑定继续生效；嵌套元素可以设置自己的对齐。原生 HTML 路径同样接受这些限定值。

通用属性按允许列表接收，支持文档标识、标题、语言、方向和可访问性属性。默认模式中的作者 `style`、事件处理属性及不支持的标签保持惰性源码或产生定位诊断。图片仍需宿主明确允许后才加载。代码与不支持区域不执行脚本。

`a` 支持静态 `target`、`rel` 属性，例如 `<a href="https://example.com" target="_self" rel="nofollow">当前页面打开</a>`。显式 `target` 覆盖默认打开方式，`rel` 支持多个空白分隔的关系词。默认混排模式中，未指定属性的 HTTP(S) 链接仍使用 `_blank` 和 `noopener noreferrer`；相对链接仍在当前页面打开。`target="_blank"` 会保留作者关系词、合并 `noopener noreferrer` 并移除冲突的 `opener`。沙箱 HTML 路径也支持这两个属性，且继续限制 `_top`、`_parent` 导航及弹窗权限。

## 两种表格写法

`<table>` 的正文是 Markdown 表格时，继续使用 ReactiveMD 表格组件，保留搜索、排序、分页和行选择。正文出现原生表格结构时，解析为 HTML 表格，无需开启扩展 HTML，也不切换整篇文档的模式：

```html
<table>
  <caption>价格表</caption>
  <tr><th scope="col">商品</th><th scope="col">价格</th></tr>
  <tr><td>苹果</td><td>5</td></tr>
  <tr><td colspan="2">**说明**：价格可随参数更新。</td></tr>
</table>
```

两种写法共用表格框架、标题、单元格样式和窄屏滚动。普通数字列使用相同的自动对齐规则；合并单元格保留其结构，单元格可用 `align` 明确设置对齐。原生表格默认不添加搜索、排序、分页或选择控件。

支持 `colspan`、`rowspan`、`scope`、`headers` 和 `col` / `colgroup` 的 `span`。`colspan` 与 `span` 为 1–1000；`rowspan` 为 0–65534，其中 0 表示延伸到当前行组末尾。单元格和标题内继续解析 Markdown、公式、插值、图片及控件；省略的行组、行和单元格结束标签按 HTML 规则补齐，原始源码位置保持不变。

同一表格混用 Markdown 表格行与 HTML 表格结构会产生诊断，并将该表格按原文显示。原生表格不接受 `bind`、`key`、`label`、`searchable`、`sortable`、`page-size` 等组件属性；标题用 `caption`，无障碍名称也可用 `aria-label`。代码示例中的结构标签不参与类型判断。

### 原文回退

成功转为惰性源码时发出 `local.html.fallback` 警告。未知 ReactiveMD 组件继续使用 `local.component.unknown`；致命编译失败仍返回 `ok: false`。宿主可以单独放行回退警告，同时保留对组件拼写错误的检查。详见[诊断契约](diagnostics-counting-ch.md#原生-html-安全回退)。

无法编译的局部原生 HTML 按原文显示，其余 Markdown、公式和控件继续工作。回退覆盖不支持的标签或属性、无效的原生表格，以及缺少完整结束标记的 HTML 片段。无法找到结束标签时，片段截至当前段落或外层 ReactiveMD 容器的结束标签。回退片段中的 Markdown、`{{ 表达式 }}`、组件和脚本均保留为文本。

原生 HTML 路径中，不支持的属性会使所在元素回退为原文；相邻元素继续渲染。整篇解析、序列化或编译预算检查失败时，React 预览和 standalone 挂载显示完整源码，保留换行并转义标签。`compileLocal` 的错误结果、资源限制和 `onDiagnostics` 诊断仍保留；配置错误及 ReactiveMD 组件语法错误继续按原规则处理。

## 扩展 HTML

`enableExtendedHtml` 管理以下作者语法：

- 定义列表：`dl`、`dt`、`dd`。
- 补充文字语义：`small`、`kbd`、`samp`、`var`、`abbr`、`q`、`cite`、`ins`。
- 图文和结构：`figure`、`figcaption`、`article`、`section`、`aside`、`header`、`footer`、`ruby`、`rt`、`rp`、`wbr`。
- 原生表单、`iframe`、`object`、`embed`、`dialog`、任意 SVG/MathML 和整页 HTML 功能。

在默认模式中，ReactiveMD `<table>` 按正文结构与原生表格区分；`<section>`、`<input>`、`<select>` 等同名组件继续采用当前语义。在原生 HTML 模式中，同名元素采用浏览器语义。

## 隔离与导出

作者 HTML 放在不带 `allow-same-origin` 的沙箱 iframe 中。源码中的整页结构、样式和脚本作用于该隔离文档。资源加载、表单提交和导航仍受 CSP 与沙箱限制；启用扩展 HTML 不代表获得全部网络能力。

本版支持内联 CSS 和 JavaScript，自动外部资源请求仍受限：外部脚本、样式表、图片、媒体及嵌入资源不会因开启开关而自动加载。扩展 HTML 允许隔离文档中的 HTTP(S) 表单提交和 `<base>` 地址解析，保留顶层导航与宿主访问限制。iframe 可用 `srcdoc` 提供内联内容；`object`、`embed` 的外部资源仍受 CSP 限制。

启用任意 JavaScript 后，脚本可以动态创建元素和样式，另两个开关主要约束作者源码。宿主隔离仍有效，但这些开关不承诺逐项阻止脚本的运行时 DOM 操作。

交互导出保留本次编译选项和文档路径。原生 HTML 的静态导出保留浏览器内建的折叠和表单行为，并禁用作者 JavaScript。这类文档没有可保存的 ReactiveMD 参数。旧导出载荷省略编译选项时采用三个开关全部关闭的默认行为。

相关规则见[集成说明](../integration/local-integration-ch.md)、[可分享导出](../integration/shareable-export-ch.md)和[安全约定](../../SECURITY-ch.md)。
