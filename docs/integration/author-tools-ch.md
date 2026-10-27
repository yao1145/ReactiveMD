# 作者工具

[English](author-tools-en.md)

安装 `reactive-md@0.6.0` 即可使用 CLI 和不依赖 React 的 `reactive-md/authoring` 入口。从本仓库开发时，先构建语言包：

```sh
npm ci
npm run build
npm run lint -- examples/local/planning.reactive.md
```

## 命令行检查

语言包提供 `reactive-md lint`。可以传入多个文件，或用 `-` 读取标准输入：

```sh
reactive-md lint "my document.reactive.md" other.reactive.md
reactive-md lint --json --warnings-as-errors document.reactive.md
reactive-md lint --locale zh document.reactive.md
cat document.reactive.md | reactive-md lint -
```

文本输出包含文件、行、列、严重程度和诊断代码。JSON 输出为 `{ file, ok, diagnostics }` 报告数组。诊断沿用编译器的 UTF-16 源码范围，行列从 1 开始。检查过程保留原文件。

`--locale en|zh` 选择诊断消息语言，默认英文。切换语言保留诊断码、严重程度和位置。兼容契约与预算单位见[诊断与计数规则](../reference/diagnostics-counting-ch.md)。

| 退出码 | 含义 |
| --- | --- |
| 0 | 没有错误；默认允许警告 |
| 1 | 存在编译错误，或启用 `--warnings-as-errors` 后存在警告 |
| 2 | 参数错误或文件读取失败 |

## 接入编辑器

核心入口提供与 DOM 无关的函数：

```js
import {
  analyzeLocalSource, completeLocalSource,
  renameLocalBinding, formatLocalSource,
} from 'reactive-md/authoring';

const analysis = analyzeLocalSource(source, compileOptions);
const suggestions = completeLocalSource(source, cursorOffset, compileOptions);
const renamed = renameLocalBinding(source, 'people', 'attendees', compileOptions);
const formatted = formatLocalSource(renamed.source, compileOptions);
```

分析结果包含按位置排序的高亮 token、绑定声明和引用范围，以及编译诊断。补全项包含 `label`、`kind`、`insertText` 和待替换的 `range`。应用编辑时，应使用生成这些范围的同一版本源码。

重命名修改生效的绑定声明、表达式引用和绘图参数，保留普通文字与展示公式。绘图参数在重命名后写为 `\mathrm{newName}`。非法名称和名称冲突会抛出错误。格式化整理已识别组件标签内的空白，保留 Markdown 排版、引号内容、公式、代码与降级区域的源码。编辑器应持续保存原始文档。

## Playground

运行 `npm run dev`，选择“显示源码”。编辑器提供高亮、补全、绑定定位、重命名、格式化、诊断跳转与实时预览。通过补全按钮或 Ctrl+Space 打开建议列表，方向键选择，Enter 插入，Escape 关闭。重命名与格式化均可撤销、重做。

## 宿主编辑器配置

`reactive-md/authoring` 还导出 `LOCAL_COMPONENTS`、`getLocalComponent`、`getNativeComponentCatalog`、`renderNativeSnippet`、`insertTemplate` 及其类型，无需 React 或 CSS。将预览使用的 `LocalCompileOptions` 作为分析、补全、重命名和格式化的最后一个参数；省略时保持原有默认值。配置包括宿主 schema、HTML 模式、资源预算和 `markdownBreaks`。

入口与样式接入方式见 [0.5.3 发布说明](../releases/release-0.5.3-ch.md)。
