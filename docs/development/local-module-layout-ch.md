# 本地模块目录结构

**中文** · [English](local-module-layout-en.md)

`src/local` 承载 local-draft 的解析、编译、求值、运行时、Worker 传输和 React 渲染实现。文件按职责分组。共享契约位于根目录的 `types.ts`；`src/local/index.ts` 保留在根目录，是唯一的汇总入口，定义由包根入口再导出的本地 API。

## 职责目录

实现按职责归入 10 个目录。

| 目录 | 职责 |
| --- | --- |
| `source/` | 源文本事实与作者工具：偏移与范围、节点遍历、码点长度、编辑器分析和语法迁移。 |
| `configuration/` | 编译选项与清单规范化、资源限制、诊断模板和组件 schema。 |
| `parsing/` | CommonMark 快速路径与块规划、标签与区域扫描、令牌转换、标题锚点与脚注、解析缓存和宽松 RMD 恢复。 |
| `html/` | 原生 HTML 语法、允许列表、表格、details 和恢复。 |
| `compilation/` | 语义编译、编译入口、服务接口、组件内核与取值规则、依赖索引、增量编译、语义缓存和行复用。 |
| `evaluation/` | 表达式的解析、推断与求值，可计算 LaTeX 与绘图采样，KaTeX 显示检查，计算、格式化、数据与集合函数、校验。 |
| `transport/` | Worker 调度与协议、序列化文档、完整/共享/扁平结果、源码编辑和结果补丁。 |
| `runtime/` | 响应式运行时、文档更新、状态迁移、取值检查和保留策略。 |
| `rendering/` | React 文档视图与核心、节点渲染、修订与校验投影、叶子视图（代码、表格、图片、数学、可视化）和本地样式。 |
| `theme/` | 主题协议与名称校验、颜色、本地化。 |

## 新文件放在哪里

先看模块产出什么：

1. 源文本事实和解析结构，按读取的输入放入 `source/`、`parsing/` 或 `html/`。
2. 共享数据结构放根目录的 `types.ts`。选项校验、限制、诊断文本和组件 schema 放 `configuration/`。
3. 跨修订复用放 `compilation/` 或 `parsing/`。Worker 消息、序列化和补丁放 `transport/`。文档运行状态放 `runtime/`。
4. React 文档视图和叶子视图放 `rendering/`。语言区域和主题代码放 `theme/`，其中 `theme/i18n.tsx` 使用 React。
5. 先归入已有目录。只有职责与现有目录都不同时才新建目录。

## 跨目录导入

使用精确的模块路径：

```ts
import { parseLocal } from '../parsing/parser';
import type { LocalNode } from '../types';
```

不要在目录内新增 `index.ts` 汇总文件。`evaluation/index.ts` 会把 KaTeX 带入每次表达式导入，渲染目录的宽泛汇总会把 React 带入只做编译的路径。可选能力在用到的地方直接导入：

- React 视图：`rendering/`
- Worker 调度与协议：`transport/worker`
- KaTeX 显示：`evaluation/math-display`

根 `index.ts` 是唯一的汇总入口。只有符号属于包级本地 API 时才在这里添加导出。

## 公开导出

外部导入方式不变。包提供 `package.json` 中声明的路径，例如 `reactive-md`、`reactive-md/react`、`reactive-md/compiler` 和 `reactive-md/sdk`。本地汇总入口服务包根入口，新目录不产生深层导入子路径。

本次调整按职责归组并拆分实现文件。公开导出和运行时行为保持不变，不发布新版本、不提升版本号，也不新增分层或消除循环依赖的保证。