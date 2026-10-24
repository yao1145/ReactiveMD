# 作者工具

[English](author-tools-en.md)

作者工具随尚未发布的 0.4.0 工作区提供。本地使用前先构建语言包：

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
cat document.reactive.md | reactive-md lint -
```

文本输出包含文件、行、列、严重程度和诊断代码。JSON 输出为 `{ file, ok, diagnostics }` 报告数组。诊断沿用编译器的 UTF-16 源码范围，行列从 1 开始。检查过程保留原文件。

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
} from 'reactive-md';

const analysis = analyzeLocalSource(source);
const suggestions = completeLocalSource(source, cursorOffset);
const renamed = renameLocalBinding(source, 'people', 'attendees');
const formatted = formatLocalSource(renamed.source);
```

分析结果包含按位置排序的高亮 token、绑定声明和引用范围，以及编译诊断。补全项包含 `label`、`kind`、`insertText` 和待替换的 `range`。应用编辑时，应使用生成这些范围的同一版本源码。

重命名修改生效的绑定声明、表达式引用和绘图参数，保留普通文字与展示公式。绘图参数在重命名后写为 `\mathrm{newName}`。非法名称和名称冲突会抛出错误。格式化整理已识别组件标签内的空白，保留 Markdown 排版、引号内容、公式、代码与降级区域的源码。编辑器应持续保存原始文档。

## Playground

运行 `npm run dev`，选择“显示源码”。编辑器提供高亮、补全、绑定定位、重命名、格式化、诊断跳转与实时预览。通过补全按钮或 Ctrl+Space 打开建议列表，方向键选择，Enter 插入，Escape 关闭。重命名与格式化均可撤销、重做。
