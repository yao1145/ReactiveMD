# 本地模块目录结构

**中文** · [English](local-module-layout-en.md)

`src/local` 承载 local-draft 的解析、编译、求值、运行时、Worker 传输和 React 渲染实现。文件按职责分组。`src/local/index.ts` 保留在根目录，是唯一的汇总入口，定义由包根入口再导出的本地 API。

## 职责目录

本次调整把 75 个实现与资源文件归入 14 个目录。

| 目录 | 职责 |
| --- | --- |
| `contracts/` | 共享数据类型：文档、节点、诊断、编译与运行时类型，语法版本和语言区域。 |
| `source/` | 源文本事实与作者工具：行、围栏和缩进扫描，节点遍历，码点长度，源码版本检查与迁移，编辑器分析。 |
| `configuration/` | 编译选项校验与标识、默认预设装配、限制、诊断模板和组件 schema。 |
| `parsing/` | 解析器内核与门面、解析工作量预算、宽松 RMD 恢复。 |
| `markdown/` | Markdown 快速路径与转换：块规划、普通段落、标题锚点和脚注。 |
| `html/` | HTML 解析、允许列表、表格、details 和恢复。 |
| `compilation/` | 单次语义编译、编译入口、服务接口、组件内核和依赖索引。 |
| `evaluation/` | 表达式语言、可计算 LaTeX 与绘图采样、KaTeX 显示检查、计算、日期、格式化、集合与数据函数、校验。 |
| `session/` | 跨修订复用：语义缓存、解析缓存、增量块会话和行复用。 |
| `transport/` | Worker 协议与消息结构、完整/共享/扁平结果、源码编辑和结果补丁。 |
| `runtime/` | 响应式运行时、状态导入导出、保留策略。 |
| `rendering/` | React 文档视图、渲染契约、旧版适配器、视图修订投影和视图样式。 |
| `widgets/` | 叶子 React 视图：代码高亮、数据表格、图片、数学、表格表面、图表和可视化。 |
| `theme/` | 主题协议与名称校验、颜色、本地化。 |

## 新文件放在哪里

先看模块产出什么：

1. 源文本事实和解析结构，按读取的输入放入 `source/`、`parsing/`、`markdown/` 或 `html/`。
2. 共享数据结构放 `contracts/`。选项校验、限制、诊断文本和组件 schema 放 `configuration/`。
3. 跨修订复用放 `session/`。Worker 消息、序列化和补丁放 `transport/`。文档运行状态放 `runtime/`。
4. React 文档视图和叶子视图放 `rendering/` 或 `widgets/`。语言区域和主题代码放 `theme/`，其中 `theme/i18n.tsx` 使用 React。
5. 先归入已有目录。只有职责与现有目录都不同时才新建目录。

## 跨目录导入

使用精确的模块路径：

```ts
import { parseLocal } from '../parsing/parser';
import type { LocalNode } from '../contracts/types';
```

不要在目录内新增 `index.ts` 汇总文件。`evaluation/index.ts` 会把 KaTeX 带入每次表达式导入，渲染目录的宽泛汇总会把 React 带入只做编译的路径。可选能力在用到的地方直接导入：

- React 视图：`rendering/` 和 `widgets/`
- Worker 调度与协议：`transport/worker`
- KaTeX 显示：`evaluation/math-display`

根 `index.ts` 是唯一的汇总入口。只有符号属于包级本地 API 时才在这里添加导出。

## 公开导出

外部导入方式不变。包提供 `package.json` 中声明的路径，例如 `reactive-md`、`reactive-md/react`、`reactive-md/compiler` 和 `reactive-md/sdk`。本地汇总入口服务包根入口，新目录不产生深层导入子路径。

本次只调整文件路径。公开导出和运行时行为保持不变，不发布新版本、不提升版本号，也不新增分层或消除循环依赖的保证。
