# 可分享文档与静态导出

本文说明 `local-draft-2` 新增的单文件 HTML 导出能力。编译与运行时接口见[本地模式集成](local-integration-ch.md)，语法见[交互语法规范](local-interaction-syntax-ch.md)，修订声明与迁移见[源码修订与迁移](source-versioning-ch.md)，升级说明见[0.4.0 发布与迁移](release-0.4.0-ch.md)。

## 两种产物

默认 ReactiveMD 文档遵循下述导出规则。原生 HTML 文档的交互导出保留 `compileOptions` 和整篇 HTML 路径，静态导出禁用作者 JavaScript；这类文档没有 ReactiveMD 参数。编译开关、隔离和暂时性分流政策见 [HTML 部分兼容](html-compatibility-ch.md)。

**交互式 HTML** 是一个自包含的 `.html` 文件。它内嵌原始源码、独立浏览器运行时、React 19、样式表和打印样式。读者通过 `file://` 打开即可交互，不需要 Node.js、React、reactive-md 包或网络连接。

首次渲染是静态内容；内嵌运行时水合完成后再增强为控件。禁用 JavaScript 时，正文、当前值、表格、公式和图表仍然可读。读者刷新后回到导出基线，后续修改不会自动保存。

**静态 HTML**（`--mode static`）只包含只读结果，不携带可执行运行时。它适合邮件附件、归档和静态站点。供交互使用的按钮、表单控件和重置操作会被移除。

两种模式都复用 React 渲染器，因此条件内容、插值、表格、公式、图表和布局都按运行时状态求值。

## CLI

包提供 `reactive-md` 命令。构建 HTML 的项目需要安装 React 19 和 React DOM；`lint` 和 `migrate` 不需要。

```sh
reactive-md build doc.reactive.md -o doc.html
reactive-md build doc.reactive.md -o doc.html --mode static
reactive-md build doc.reactive.md -o doc.html --state-file doc.state.json
reactive-md build doc.reactive.md -o doc.html --assets omit
reactive-md lint "docs/**/*.reactive.md"
reactive-md lint "docs/**/*.reactive.md" --json --strict
```

| 选项 | 含义 |
| --- | --- |
| `-o, --output <file>` | 必填输出路径；父目录必须已存在。 |
| `--mode interactive\|static` | 输出模式，默认 `interactive`。 |
| `--state-file <json>` | 使用经过校验的 `reactive-md-state/v1` 文件作为打开和重置基线。 |
| `--assets inline\|omit` | 内联已验证的本地位图（默认），或保留渲染器的替代文本降级。 |
| `--asset-root <dir>` | 额外允许相对图片路径解析的本地目录。 |
| `--locale en\|zh` | 渲染标签与校验信息语言，默认 `en`。 |
| `--color-scheme auto\|light\|dark` | 文档颜色模式，默认 `auto`。 |
| `--title <text>` | 覆盖 HTML 标题；默认取首个标题或输入文件名。 |
| `--strict` | 警告也视为失败；配合 `--assets omit` 时，存在被省略图片也失败。 |

退出码区分不同失败：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数或用法错误 |
| `3` | 文档编译、渲染、React 或包内构建产物错误 |
| `4` | 输入/输出文件错误 |
| `5` | 资源或安全策略错误 |

CLI 没有“当前预览”概念，只有 `--state-file` 可以选择非初值基线。本版本暂不提供 `format`。

## 迁移源码

`reactive-md migrate` 把单份源码的修订声明迁移到 `local-draft-2`：

```sh
reactive-md migrate old.reactive.md --from local-draft-1 -o new.reactive.md
reactive-md migrate old.reactive.md --check --json
```

默认把迁移后的源码写到标准输出。`-o` 使用独占创建，拒绝任何已存在的路径，包括输入文件本身。`--check` 从不写入。`--json` 只输出结构化报告。`--accept-semantic-changes` 允许文本控件长度语义变化并报告警告；`--locale en|zh` 选择显示语言。

迁移被阻止时退出 `1`，成功时退出 `0`。`--check` 在需要迁移或被阻止时退出 `1`，源码已是当前版本时退出 `0`。用法和 I/O 错误退出 `2`。命令不就地覆盖，也不提供批量或 `--write` 模式。检查项、保留字节和状态摘要影响见[源码修订与迁移](source-versioning-ch.md)。

## 起始参数与状态文件

默认导出作者定义的初始参数，保证构建可重复，避免把调试值或敏感输入带给接收者。

状态文件采用版本化结构：

```json
{
  "format": "reactive-md-state/v1",
  "syntax": "local-draft-2",
  "sourceDigest": "fnv1a32:0123abcd",
  "parameters": {
    "people": 7,
    "plan": "pro"
  },
  "generator": { "name": "example-host", "version": "1.0.0" }
}
```

只保存公开、可序列化的绑定值。文件通过 `sourceDigest` 标识文档，通过 `syntax` 记录语言修订。`@` 开头的内部绑定、revision、节点 ID、AST、计时器、展开状态和焦点都不会写入；内部快照键和 ID 属于实现细节，不是存储格式。

恢复时按源码摘要、语法版本、参数集合和槽位约束逐项校验。未知、缺失或非法参数会报告具体名称并拒绝整个文件，不会部分应用。`range-slider` 等双槽组件按原子写入规则校验。

选中的状态同时成为重置基线。因此打开、刷新和面板重置都会回到导出值，而不是另一个隐藏的默认值。

宿主可以不经过 CLI 生成和应用同一格式：

```ts
import { exportLocalState, importLocalState } from 'reactive-md';

const file = exportLocalState(runtime, { name: 'example-host', version: '1.0.0' });
const saved = JSON.stringify(file);

const diagnostics = importLocalState(runtime, saved);
```

`exportLocalState` 只读取公开参数。`importLocalState` 校验源码摘要、语法、参数集合和槽位约束后应用；导入失败时运行时状态不变。两者都是宿主显式调用，运行时本身仍不会保存或发送状态。只做校验、不改动运行中实例时使用 `resolveLocalState(document, input)`。

Demo 导出对话框可以把当前预览参数下载为状态文件，供后续 CLI 构建使用。较低层的 `createLocalStateFile`、`parseLocalState`、`applyLocalState` 和 `serializeLocalState` 仍可从 `reactive-md` 使用。

## 图片

### 浏览器

在 Demo 的**文档图片**面板中选择文件，或把图片粘贴到源码编辑器。通过校验的图片会在选区处插入 Markdown 引用，并加入资源清单。清单显示引用路径、格式、大小及引用状态，支持替换和移除。批量导入中有文件不合格时，源码和清单均保持原状。

支持 PNG、JPEG、GIF、WebP，检查文件内容、声明 MIME 类型和浏览器解码结果。单张上限 8 MiB，合计 24 MiB，最多 64 项，不支持 SVG。资源按当前文档和语言保存在 IndexedDB；出现存储警告时，资源仅在当前页面会话内可用。

导出弹窗会列出缺失图片，可逐项选择本地文件，也可为远程 URL 指定本地替代文件。浏览器不会自动抓取远程图片。补齐全部引用后才能导出 HTML；交互式和静态导出都会内嵌所引用的文件，未引用资源不会打包。Markdown 和状态文件下载均不包含图片文件。

这些浏览器资源操作适用于 ReactiveMD 路由，包括 P0 `<img>` 元素。原生 HTML 路由沿用独立的图片策略。

### CLI

离线导出默认使用 `--assets inline`：

- 只读取文档目录内或显式 `--asset-root` 内的相对路径。
- 拒绝绝对路径、URL scheme、协议相对地址、反斜杠、路径穿越和符号链接逃逸。
- 从不自动抓取远程图片。
- 按文件内容识别 PNG、JPEG、GIF、WebP；拒绝 SVG、伪造 MIME 和未知格式。
- 单图上限 8 MiB，总量上限 24 MiB，最多 64 个不同资源；相同内容按哈希去重。
- 保留 alt；无法内联时默认构建失败。`--assets omit` 是显式降级，保留 alt 回退。

渲染器原有的全局安全边界没有放宽：没有宿主 URL 策略时图片仍默认全部拒绝。导出器只在校验本地文件后提供 URL 策略和图片映射。

## 单文件安全与打印

HTML 外壳包含：

- CSP：禁止连接、frame、object、base 注入和表单提交，只允许内联样式/运行时和 `data:` 图片；
- 对 JSON、源码、标题和许可证文本做 HTML 与脚本上下文转义；
- 在不会执行的 `<template>` 中保留 MIT 和第三方 notices；
- 不引用 CDN、远程样式、字体或运行时。

普通外链在读者主动点击时仍可导航，但打开文档本身不会发起远程请求。该导出器不等同于不可信作者的沙箱；需要隔离时应使用 sandboxed iframe。

打印不依赖临时的状态切换。交互式页面会为当前运行时值输出打印专用节点，`Ctrl+P` 打印读者当前看到的结果。打印样式强制浅色纸张、隐藏工具栏和控件、使用打印机决定纸张边距、避免标题孤立、重复表头、换行长代码和 URL，并把图表限制在页面宽度内。静态 HTML 本身只包含只读值。

## 独立运行时 API

构建会生成 `dist-standalone/reactive-md-standalone.js`（IIFE，全局名 `ReactiveMD`）和 `reactive-md-standalone.css`。二者按普通浏览器资源加载：

```html
<link rel="stylesheet" href="reactive-md-standalone.css">
<script src="reactive-md-standalone.js"></script>
```

程序化挂载：

```js
const handle = ReactiveMD.mount(document.getElementById('doc'), {
  source: '# Hello\n\n<slider bind="n" label="Count" initial="2">\n\nValue: {{ n }}',
  locale: 'en',
  colorScheme: 'auto',
});
handle.getState(); // reactive-md-state/v1 快照
handle.unmount();
```

`ReactiveMD.mountAll(root)` 只扫描一次安全的自动挂载载荷：

```html
<div id="doc"></div>
<script type="application/reactive-md+json" data-reactive-md-auto>
{"version":1,"target":"doc","source":"# Hello","state":{"format":"reactive-md-state/v1","syntax":"local-draft-2","sourceDigest":"fnv1a32:01209266","parameters":{}},"locale":"en","colorScheme":"auto","hydrate":false}
</script>
```

目标只按 `id` 查找，不拼接选择器。source 只作为数据处理，不当作可执行 HTML。故意不解释 `<script type="text/reactive-md">` 的原始文本。

### `<reactive-md-doc>`

IIFE 会注册一个 Light DOM 自定义元素。简单选项通过属性传递，复杂选项通过 DOM property 传递。

```html
<reactive-md-doc src="./doc.reactive.md" locale="en" color-scheme="auto"></reactive-md-doc>
```

- 属性：`src`、`source`、`locale`、`color-scheme`、`theme`。
- Property：`source`、`state`、`urlPolicy`、`imageResolver`、`themes`。
- 事件：`reactive-md-diagnostics`、`reactive-md-state-change`。
- `src` 通过可取消的 `fetch` 加载；显式 source 不会产生请求。
- 断开连接时中止请求、移除订阅、卸载 React root 并释放运行时。两个相同 source 的元素拥有独立状态。

元素使用 Light DOM，以复用现有文档样式、标题锚点和打印样式。本版本不提供 Shadow DOM。

## 安全边界

- 核心与 React 入口继续保持 React external；只有 standalone IIFE 打包 React。
- 核心入口仍不加载 React。
- 状态导出与导入只使用公开绑定名和经过校验的值。
- 读者修改不会持久化到导出文件。
- Demo 会预览并导出文档资源清单中已提供的图片。引用缺失时，选择对应文件后才能导出 HTML。
- 导出格式版本为 `reactive-md-html/v1`，可从生成的 meta 标签检查。

## 产物体积基线

`npm run test:shareable` 会记录 standalone 产物体积，并在超过以下回归阈值时失败：

| 产物 | 当前基线 | 报警阈值 |
| --- | --- | --- |
| `reactive-md-standalone.js` | 约 925 kB（gzip 约 276 kB） | 1024 KiB / gzip 320 KiB |
| `reactive-md-standalone.css` | 约 81.2 kB（gzip 约 13.5 kB） | 80 KiB / gzip 20 KiB |

0.5 基线包含语法高亮器和常见语言语法，离线文件也能高亮。

数值会随压缩器和 React 补丁版本小幅变化。阈值远高于正常波动，同时能捕获 React 或渲染器被重复打包的退化。完整 HTML 还包含源码、notices 和内联图片，因此会大于这个基线。

## 当前范围

已实现：CLI 的 `build`/`lint`/`migrate`、交互与静态 HTML、状态文件、本地位图内联、打印输出、standalone 挂载 API、自动挂载和 Web Component。

本版本不包含：`format`、UMD、远程图片抓取、SVG 内联、框架插件（Vite、Astro、Docusaurus、Next.js）、Shadow DOM，以及单文件导出之外的通用 SSR 水合保证。

单文件静态首屏水合由 Playwright Chromium 和本地 Edge 检查覆盖。Firefox、Safari/WebKit 以及通用服务端水合尚未验证，不作支持声明。
