# React 源码编辑器

`reactive-md/editor` 是用于 Reactive MD 源码的受控 React 19 编辑器，由 Playground 编辑器抽出。它提供源码高亮、格式与插入工具栏、补全、绑定导航、重命名与格式化、撤销重做、行号及滚动同步。源码文本由宿主保存，预览、持久化和导出也由宿主负责。

编辑器有独立样式表 `reactive-md/editor/styles.css`，与 `reactive-md/styles.css` 分开。只编辑源码的页面不会加载文档渲染样式。

编辑器属于 `0.5.0` 预览版，目标渠道为 `next`；`latest` 仍为 `0.4.0`。现有 `reactive-md`、`reactive-md/react` 和 `reactive-md/styles.css` 导入保持不变。

## 安装

```sh
npm install reactive-md@next
npm install react@19 react-dom@19
```

需要固定预览版时使用 `npm install reactive-md@0.5.0`。包只提供 ESM，工具和服务端渲染需要 Node.js 22.12 或更新版本。

## 最小受控编辑器

```tsx
import { useState } from 'react';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import 'reactive-md/editor/styles.css';

const initialSource = `# 费用估算

<slider bind="people" label="人数" initial="2" min="1" max="20">

每月费用：**{{ people * 100 }} 元**。`;

export function SourceEditor() {
  const [source, setSource] = useState(initialSource);

  return (
    <ReactiveMarkdownEditor
      value={source}
      onChange={setSource}
      ariaLabel="文档源码"
    />
  );
}
```

`value` 和 `onChange` 为必需属性。组件渲染一个 textarea，并维护自己的撤销历史；源码文本保存在宿主状态中。内置文案默认为英文。

## 入口

| 入口 | 内容 | 依赖 |
| --- | --- | --- |
| `reactive-md/editor` | `ReactiveMarkdownEditor` 及其类型 | React 19 |
| `reactive-md/editor/styles.css` | 编辑器样式，作用域限定在编辑器根节点 | 由宿主显式引入 |

样式表在应用或渲染编辑器的组件模块中引入一次即可。支持 CSS 导入的构建工具或框架可以把它放在编辑器模块旁边。

## ref 句柄

```tsx
import { useRef, useState } from 'react';
import {
  ReactiveMarkdownEditor,
  type ReactiveMarkdownEditorHandle,
} from 'reactive-md/editor';

export function SourceEditor() {
  const [source, setSource] = useState('');
  const editor = useRef<ReactiveMarkdownEditorHandle>(null);

  return (
    <>
      <button type="button" onClick={() => editor.current?.focus()}>聚焦</button>
      <button type="button" onClick={() => editor.current?.undo()}>撤销</button>
      <button type="button" onClick={() => editor.current?.selectRange({ start: 0, end: 5 })}>
        选中标题
      </button>
      <ReactiveMarkdownEditor ref={editor} value={source} onChange={setSource} />
    </>
  );
}
```

| 方法 | 行为 |
| --- | --- |
| `focus(selection?)` | 聚焦 textarea，可同时应用选区。 |
| `selectRange(range)` | 选中一段源码。区间与编译诊断一样使用 UTF-16 半开区间偏移。 |
| `getSelection()` | 返回当前选区。 |
| `getTextarea()` | 返回底层 textarea；挂载前为 `null`。 |
| `undo()` / `redo()` | 在该实例的历史中前后移动，并通过 `onChange` 发出结果值。到达历史两端或 `readOnly`、`disabled` 时不执行操作。 |

入口同时导出 `ReactiveMarkdownEditorProps`、`ReactiveMarkdownEditorHandle`、`EditorLocale`、`EditorTheme` 和 `EditorSelection` 类型。

## 属性

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string` | 必需 | 受控源码文本。 |
| `onChange` | `(value: string) => void` | 必需 | 接收输入、工具栏命令及撤销重做后的新源码。 |
| `locale` | `'en' \| 'zh'` | `'en'` | 该实例的内置文案语言，不改变源码内容。 |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | 在编辑器根节点设置 `data-editor-theme`。`auto` 跟随系统偏好。 |
| `id` | `string` | 自动生成 | textarea 的 id。实例用它关联内部标签和行号栏。 |
| `className` | `string` | 无 | 加到 `.reactive-md-editor` 根节点。 |
| `style` | `CSSProperties` | 无 | 根节点的内联样式。 |
| `height` | `number \| string` | `560` | 数字按像素计算，字符串可使用任意 CSS 长度。 |
| `minHeight` | `number \| string` | `280` | 最小高度，单位规则与 `height` 相同。 |
| `placeholder` | `string` | 无 | 源码为空时的占位提示。 |
| `ariaLabel` | `string` | 本地化标签 | textarea 的可访问名称。 |
| `readOnly` | `boolean` | `false` | 文本仍可选中和复制，但不能修改。 |
| `disabled` | `boolean` | `false` | 阻止聚焦和编辑。 |
| `documentKey` | `string \| number` | 无 | 切换到独立源码文档时修改该值。变化会重置撤销历史与选区。 |
| `diagnostics` | `readonly Diagnostic[]` | 无 | 在行号栏标记诊断所在行，不阻止输入，也不代替宿主校验。 |
| `document` | `LocalDocument \| null` | `null` | 已编译文档，用于作者工具显示绑定值类型。编辑器不会编译它。 |
| `toolbar` | `boolean` | `true` | 显示格式与插入工具栏，包括导出操作。 |
| `authoring` | `boolean` | `true` | 启用补全、绑定导航、重命名和格式化工具。 |
| `onExport` | `() => void` | 无 | 工具栏导出操作调用该回调，用于打开宿主导出对话框或自行写文件。 |
| `textareaRef` | `RefObject<HTMLTextAreaElement \| null>` | 无 | 接收底层 textarea，供宿主的高级用法读取。 |

## 受控值与历史

每次编辑都会以新源码调用 `onChange`，包括输入、工具栏格式化、插入模板、重命名、格式化及撤销重做。把该值回传给 `value`。编辑器把自己发出的修改视为当前会话的一部分，常规受控值回传会保留撤销步骤。

外部修改 `value` 会更新显示的文本。宿主用另一份独立文档替换文本时，在同一次渲染中修改 `documentKey`。键变化会清空撤销重做、重置选区并采用新值。

```tsx
const [documentKey, setDocumentKey] = useState('estimate');
const [source, setSource] = useState(loadSource('estimate'));

function openDocument(key: string, text: string) {
  setDocumentKey(key);
  setSource(text);
}

<ReactiveMarkdownEditor
  value={source}
  onChange={setSource}
  documentKey={documentKey}
/>
```

撤销历史属于当前挂载实例，不保存、不跨实例共享，也不从整个 `value` 属性推导。切换文档时修改 `documentKey`，不要在每次输入时重新挂载组件。

## 语言与主题

每个实例使用自己的语言和主题。编辑器不修改文档的 `data-theme` 属性，不写入浏览器存储，也不读取 Playground 的语言设置。

```tsx
<ReactiveMarkdownEditor
  value={source}
  onChange={setSource}
  locale="zh"
  theme="dark"
/>
```

`theme="auto"` 跟随系统颜色偏好，并响应偏好变化。同一页面的两个编辑器可以使用不同设置。主题通过 `.reactive-md-editor` 根节点上的本地 `data-editor-theme` 属性设置。

## 只读与禁用

`readOnly` 保留源码显示、聚焦和选择，输入、工具栏、补全、重命名、格式化以及 ref 的 `undo`、`redo` 都不能改变值。

`disabled` 同时阻止聚焦和指针交互。两种模式均会禁用工具栏导出操作，不会自行改变值或历史。宿主不允许编辑源码时使用它们，例如展示只读预览期间。

宿主从外部替换 `value` 或改变 `documentKey` 时，编辑器重置历史、选区和滚动位置；回传 `onChange` 收到的值会保留这些状态。未提供 `onExport` 时隐藏导出按钮。

## 诊断与已编译文档

可选的作者工具会在本地分析源码并检查语法。预览文档的编译由宿主管理；需要行标记或绑定值类型时，可把该结果传入：

```tsx
import { compileLocal } from 'reactive-md';

const result = compileLocal(source);

<ReactiveMarkdownEditor
  value={source}
  onChange={setSource}
  diagnostics={result.diagnostics}
  document={result.ok ? result.document : null}
/>
```

`diagnostics` 在行号栏标记报告所在行。未完成的源码仍可继续输入，编译错误不会锁住 textarea。`document` 为作者检查面板提供绑定值类型。两个属性都可省略；只编辑 Markdown 时无需传入。

## 尺寸与布局

编辑器填满容器宽度。`height` 默认 `560px`，`minHeight` 默认 `280px`；数字按像素处理，字符串可以使用 `vh`、`rem` 等 CSS 长度。行号栏随行数变化，软换行时行号和高亮仍与滚动位置同步。

在宿主布局中使用 `className` 或 `style` 控制外边距和位置。内部元素类名属于实现细节。

## 工具栏与作者工具

`toolbar={false}` 移除格式与插入工具栏，包括导出操作。`authoring={false}` 保留 textarea 和工具栏，但停用语法高亮、补全、绑定导航、重命名和格式化。两者默认启用。

工具栏处理 Markdown 格式，插入列表、表格、链接、图片和内置组块模板，并提供撤销重做。格式化命令基于当前选区，通过 `onChange` 返回新源码。

## 宿主职责

编辑器负责编辑源码，其余由宿主处理：

- 预览：编译 `value`，用 `reactive-md/react` 或自己的运行时渲染。
- 持久化：保存源码。编辑器不自动保存、不写入本地存储，也不把源码发送到任何地方。
- 导出：通过 `onExport` 把工具栏操作接到 HTML 导出、下载对话框或文件服务。编辑器不生成可分享的 HTML 文件。

编译调度和防抖同样属于宿主。见[本地模式集成](local-integration-ch.md)与[可分享文档与静态导出](shareable-export-ch.md)。包含编辑器、预览和文档切换的完整示例见 [react-editor.tsx](../examples/integration/react-editor.tsx)。

## 服务端渲染

编辑器入口没有顶层 `window` 或 `document` 访问。用 `react-dom/server` 导入并渲染初始 textarea 是安全的。聚焦、选区、补全、布局测量和工具栏菜单在浏览器挂载后运行，交互检查和浏览器测试需要客户端环境。

## 样式与作用域

`reactive-md/editor/styles.css` 包含编辑器自己的 token 和规则，所有选择器限定在 `.reactive-md-editor` 及其后代，不会改写宿主的按钮、输入框或页面正文。主题由上面的实例属性提供。

同一页面还渲染文档预览时，再引入 `reactive-md/styles.css`。两份样式表彼此独立，加载顺序不限。

## 兼容性

`0.5.0` 新增编辑器入口，`local-draft-2`、`component-protocol-1` 和 `reactive-md-theme-1` 保持不变。只渲染文档的项目升级时无需修改导入或源码。编辑器是新增入口，没有旧 API 需要迁移。见[0.5.0 发布说明](release-0.5.0-ch.md)与[版本与兼容性](compatibility-ch.md)。
