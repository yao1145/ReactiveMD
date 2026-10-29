# 持续编辑优化实现与验证结果

2026-10-28 实现，2026-10-29 完成补充验证。接续[解析流水线优化](parser-pipeline-optimization-2026-10-28-ch.md)。本轮通过三个 Claude Code CLI 子代理分别实现解析缓存、Worker 协议和运行时/预览复用，由主代理整合、审查并运行验证。

## 实现结果

| 讨论方向 | 当前实现 |
| --- | --- |
| 组件内部解析复用 | `LocalParseSession` 缓存只读通用 Markdown AST、快速块计划和行内计划，重新生成最终节点以保留位置和预算语义。缓存有条目数与源码键长度上限。 |
| 依赖语义缓存 | 会话缓存表达式、实际依赖类型签名、成功的属性校验、绑定组、公式和数学显示检查。选项变化清空缓存，错误诊断重新生成。 |
| 表格、列表局部复用 | 简单快速块复用表格单元文本和列表项的行内计划；整块计划可直接命中。复杂块仍使用通用解析。 |
| 共享扫描事实 | `SourceContext` 提供行索引和源码事实；块结构、代码范围与通用树中的定义/数学字面量收集结果可复用。超深候选由结构树确认，避免把代码和注释中的标记误判为容器深度。 |
| 内部结果共享 | `compileShared()` 保留未变化对象，发布块缓存重定位结果；公开 `compile()` 继续返回独立快照。共享结果按只读契约使用。 |
| Worker 双向补丁 | 协商 `patch-v1` 后传送源码编辑和结果补丁，验证版本及基线；不匹配时重试完整结果，兼容旧 Worker。默认调度器仍提供独立结果，内部预览可选择共享。 |
| 运行时及预览复用 | `updateLocalRuntime()` 沿用保留规则迁移状态，复用订阅及运行时对象；预览使用稳定节点及依赖投影。初始值、类型、名称或约束变化按规则重置。 |
| 空闲索引恢复 | `prepareAsync()` 分阶段让出执行权；新编辑、选项变化、取消或释放使旧任务失效。Worker 延迟启动准备任务。 |
| 前置资源预算 | 增加 `maxParseWork` 与 `maxMarkdownDepth`，默认分别为 20,000,000 和 1000；缓存命中也收取相同工作量，超限返回 `local.budget`。 |
| 分阶段观测 | 会话记录编译阶段和复用计数；Worker/调度器记录编译、补丁编码、应用、排队与往返时间。已编写生产构建浏览器测量夹具。 |

全局语义遍历仍用于保证定义、引用和绑定的一致性。分场景对照显示部分上下文、正文及简单行编辑获益，但复杂动态行和巨型单块补丁仍有明显限制，不能给出统一的整体提速比例。

解析工作预算按扫描及提交解析的字符量累计，配合源码长度、最终节点数和容器深度约束。它不逐一统计 remark 内部临时对象，也不提供硬实时中断。缓存的长度预算是估算值，实际保留堆内存见下文持续编辑测量。

## 已取得的验证证据

- 最终全套单元测试：106 个文件、1461 项通过，包含解析缓存、预算、共享数据、补丁、异步准备、运行时迁移、视图更新和预算往返测试。
- 完整构建通过：类型检查、库、编辑器、standalone 和声明生成。
- 与本轮修改前生产包对照：1694 份文档、四种选项，共 6776 组编译结果一致。
- 文档检查：790 个本地链接及导航锚点通过。该结果早于本报告新增。
- 包检查发现新增缓存声明间接依赖 `katex/contrib/mhchem`。已将数学显示问题的数据类型移入无渲染依赖的类型模块；最终重建和包检查均通过，公开导入、语言夹具、核心类型边界及 React 入口边界正常。

## 浏览器、协议与配置验收

- 真实 Edge 生产 Worker 完成双向补丁：最终复验 15 个请求中 14 个结果补丁，运行时只创建一次；正文、面板和表格编辑保留参数，作者初始值变化重置参数。
- 旧 Worker 始终使用完整请求/响应；乱序旧响应被忽略；失效基线和损坏补丁均恢复为一次完整请求，没有重试循环。选项切换发送完整源码及新选项，取消空闲准备后下一次响应不含准备耗时。
- 公开 `LocalReactiveDocument` 在可暂停的 React transition 中经历中断后，旧提交仍显示原参数，最终提交显示新文档且参数保持为 13。控制台和页面错误均为空。
- `maxParseWork=123456`、`maxMarkdownDepth=17` 经 shareable JSON 到 standalone `parseMountPayload`/`prepareStandaloneDocument` 往返保持；非法零值和非整数仍被拒绝。相关 3 个测试文件共 31 项通过。
- 测量夹具最初漏用正式构建中的 `decode-named-character-reference` Worker 别名，导致 DOM 版依赖进入 Worker 并触发主线程降级。对齐别名后完成上述验收；该问题位于测试夹具，不在发布库。

## 内存与稳定性

隔离进程使用生产包和显式 GC。长编辑保留旧预览直到替代结果产生；峰值 RSS 包含模块加载和整个子进程，GC 后堆不等于累计分配。

| 用例 | 结果 | GC 后保留堆 | 释放后堆 | 峰值 RSS |
| --- | --- | ---: | ---: | ---: |
| 500 次连续编辑 | 第 50–500 次堆增长 0.165 MiB，解析缓存稳定为 672 项 | 21.767 MiB | 15.258 MiB | 156.520 MiB |
| 260 次全量缓存淘汰 | 解析缓存封顶 672 项，语义缓存 4 项 | 20.135 MiB | 15.144 MiB | 152.613 MiB |
| 120 次快速准备/取消 | 取消均返回失效，无未处理异常 | 18.931 MiB | 13.160 MiB | 114.355 MiB |
| 100 万字符及超限文本 | 正常编译；1,000,001 字符返回 `local.budget` | 12.154 MiB | 12.142 MiB | 56.516 MiB |
| 5000 个组件 | 提高语法节点预算后正常编译 | 29.462 MiB | 13.166 MiB | 219.617 MiB |
| 1000/1001 层 Markdown 容器 | 1000 层接受，1001 层返回 `local.budget` | — | 11.317 MiB | 73.090 MiB |

释放后的堆没有假定回到模块加载前基线；这里只报告同一进程显式 GC 后的实际值。

## 持续编辑性能对照

Windows x64、Intel Core Ultra 5 125H、Edge 135。基线为保存的 `fb05509` 生产包，当前版本使用最终生产包；两者进入同一文本框、真实 module Worker 和 React profiling 预览。每组预热 3 次、测量 15 次，版本顺序按场景交替。下表均为“修改前 → 修改后”，时间为中位数/P95，响应体积为中位 JSON UTF-8 估算。

| 场景 | Worker ms | 输入到预览帧机会 ms | 请求字节 | 响应字节 |
| --- | ---: | ---: | ---: | ---: |
| 连续修改组件上下文 | 80/132 → 60/82 | 141.7/196.6 → 111.2/133.5 | 14,555 → 147 | 272,674 → 1,415 |
| 修改组件正文 | 29/53 → 11/27 | 87.6/131.6 → 64.5/85.5 | 8,938 → 150 | 121,288 → 1,361 |
| 800 个密集段落 | 9/16 → 25/45 | 104.2/135.8 → 103.5/132.9 | 57,579 → 153 | 899,397 → 12,930 |
| 1000 项简单列表 | 171/228 → 95/130 | 298.7/355.3 → 239.2/278.0 | 54,010 → 153 | 926,389 → 1,057,284 |
| 500 行简单表格 | 88/202 → 49/65 | 162.2/273.8 → 133.6/153.0 | 20,310 → 151 | 512,432 → 599,738 |

上下文和正文的 Worker、预览及传输均有改善。密集段落的 Worker 中位数从 9 ms 增至 25 ms，但预览中位数基本持平、P95 略降。简单列表和表格的编译与预览改善，结果补丁却比旧完整响应更大；这两个巨大单块的 `reusedItems`/`reusedRows` 均为 0，共享节点仅 5，不能把它们归为小补丁场景。

每行含动态插值时出现更明显的回退：1000 项列表的 Worker 中位/P95 为 223/250 → 287/373 ms，预览为 394.3/407.5 → 503.5/598.0 ms；500 行表格的 Worker 为 86/115 → 115/184 ms，预览为 155.1/188.6 → 206.5/354.8 ms。动态行同样没有行内复用命中，补丁接近或大于完整结果。后续优化应优先处理巨大单块节点身份/补丁编码和动态行路径。

P95 只有 15 个样本，仅用于描述本次运行。输入到预览是提交后的两次 `requestAnimationFrame` 帧机会，不证明绘制完成；JSON 长度不等于结构化克隆真实字节数。React 渲染、排队、往返、补丁应用及逐次样本见原始报告。

## 复现与证据

```sh
npm run build
npm run test:package
npm test
node scripts/benchmark-editing-pipeline.mjs
node scripts/benchmark-editing-comparison.mjs
EDITING_CASES=list,table EDITING_COMPARISON_REPORT=artifacts/editing-completion/comparison-large-blocks-fast.json node scripts/benchmark-editing-comparison.mjs
EDITING_DYNAMIC_ROWS=1 EDITING_CASES=list,table EDITING_COMPARISON_REPORT=artifacts/editing-completion/comparison-large-blocks.json node scripts/benchmark-editing-comparison.mjs
node scripts/benchmark-editing-memory.mjs
```

原始报告位于本地忽略目录：浏览器主链路（本地文件 `artifacts/editing-completion/browser.json`）、协议与并发（本地文件 `artifacts/editing-completion/recovery.json`）、性能对照（本地文件 `artifacts/editing-completion/comparison.json`）、简单行复测（本地文件 `artifacts/editing-completion/comparison-large-blocks-fast.json`）、动态插值行复测（本地文件 `artifacts/editing-completion/comparison-large-blocks.json`）、内存与释放（本地文件 `artifacts/editing-completion/memory.json`）。浏览器截图保存在 `artifacts/editing-completion/browser.png`。

## 工作区状态

三个本轮 Claude 子代理已完成交接并结束。代码、测试和测量脚本按本轮优化归入独立提交；原始测量数据保留在本地忽略目录。
