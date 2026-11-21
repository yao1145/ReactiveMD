# HTML 兼容与作者能力

**中文** · [English](html-compatibility-en.md)

同一份文档可混排 Markdown、RMD 组件、表达式和基础 HTML。宿主独立控制三项能力。

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `enableCss` | `true` | 文档样式、组件行内声明及获准 HTML 片段中的样式 |
| `enableJavaScript` | `false` | 在交互挂载时执行作者脚本 |
| `enableExtendedHtml` | `false` | 允许额外的原生 HTML 片段 |

源码视图从 `LocalReactiveDocument.compileOptions` 取得授权。预编译视图通过 `LocalDocumentView.capabilityGrants` 授权，缺省为 CSS 开、JavaScript 关、扩展 HTML 关。每项能力需要编译与当前挂载同时允许。单独切换开关保留源码视图的运行时状态。

### 样式

在正文前放一个或多个成对的 `<css>` 块，按源码顺序层叠。组件实例的 `css` 属性接收 CSS 声明，应用到可见根。文档选择器止于嵌套文档根，DOM 的 CSS 继承照常生效。作者样式使用文内规则，外链样式表和样式资源请求受策略过滤。迟置样式块和无可见根的组件会收到定点诊断。已注册的 `css`、`javascript` 组件保留各自的标签，组件 schema 自行定义的 `css` 属性保留原有语义。

### 脚本

用成对的 `<javascript>` 声明代码。交互运行时恢复状态后，隔离 Worker 按源码顺序执行脚本。每个块有自己的词法作用域。通过 `await rmd.get(name)` 读取命名绑定，通过 `await rmd.set(name, value)` 写入单项，或通过 `await rmd.setMany(values)` 原子更新多项。写入沿用组件的约束和只读规则。

通过计数器的 `action-id` 命名实例。调用 `rmd.handleAction(id, "increment", callback)` 接管该实例的增加动作。计数器还提供 `decrement` 和 `reset`。用 `rmd.observeAction` 观察动作，默认处理照常运行。替换脚本、撤销授权或卸载文档时清理会话。静态 HTML、PDF 和 hydration 的静态阶段使用给定的 RMD 状态。

异步预览重新编译时，可用 `LocalDocumentView.authorScriptPaused` 暂停作者动作和绑定请求。确认脚本未变后恢复原会话。撤销计数器 `action-id` 的删除后，同一脚本会话可继续接管这个动作。

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

对齐不需要开启 CSS 或扩展 HTML，容器内的 Markdown 和绑定继续生效；嵌套元素可以设置自己的对齐。

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

## 扩展 HTML 与导出

已注册组件优先。比如 `<input bind="name">` 仍是 RMD 输入框，`details` 的正文继续支持 Markdown 和表达式。净化后的普通定义列表等结构直接进入文档，包含嵌入、作者脚本或样式的片段由沙箱承载。未获准的片段在原位置显示转义源码。

自包含嵌入可用经净化的 `srcdoc`。通过挂载参数 `allowedFrameOrigins` 开放精确的 HTTPS 来源。片段样式和脚本继续受对应开关管理，沙箱约束导航、表单和对父文档的访问。

新版交互导出记录 `sourceSemantics: "mixed-rmd-v1"`、开关和状态基线。缺少该字段的 v1/v2 导出按原语义打开，包含此前显式开启能力时的整页 HTML 路径。载荷的 v1/v2 继续区分恢复契约。

参见[集成说明](../integration/local-integration-ch.md)、[可分享导出](../integration/shareable-export-ch.md)和[安全约定](../../SECURITY-ch.md)。
