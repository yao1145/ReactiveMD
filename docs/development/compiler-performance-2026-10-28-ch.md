# ReactiveMD 0.6.1 编译性能调查

测量日期：2026-10-28。检出版本：`df59896e191f6eee57cb25674ad12cd28dc180c0`。本次增加性能脚本与调查记录，编译器实现保持原样。

本报告保留优化前基线；同日后续实现与对照结果见[密集段落编译优化](dense-paragraph-optimization-2026-10-28-ch.md)。

当前编译性能主要受 Markdown 解析和临时对象分配影响。输入是否有大量段落、语法节点和组件，比字符数更能解释延迟。100 万字符是输入预算，默认 1 万节点是累计节点构造预算；两者都不能作为交互延迟或内存上限。

测量环境为 Windows x64、Intel Core Ultra 5 125H、18 个逻辑处理器、约 31.44 GiB 物理内存，Node 22.17.0。先对当前源码执行 `npm ci --ignore-scripts --no-audit --no-fund` 和 `npm run build`，类型检查与全部发布产物构建成功。机器同时承载其他开发进程，未固定电源策略、CPU 频率或核心亲和性。

## 测量口径

Node 压力基准对每个场景启动独立进程，串行运行，设置 `--max-old-space-size=1024`，每组最多 60 秒。单独记录导入后的首次编译，再预热 2 次、测量 10 次。补充边界场景预热 1 次、测量 5 次；长段落原始压力场景预热 1 次、测量 3 次。每次计时只包围公开的 `compileLocal(source, options)`，输入构造、正确性检查和结果复制位于计时外。各场景的实际次数保存在 JSON 中，小样本 P95 只作描述。

内存使用 `process.memoryUsage()` 与 `process.resourceUsage().maxRSS`，单位统一换算为 MiB。峰值是独立进程从启动至首次编译结束的操作系统 RSS 高水位，包含 Node、模块导入、输入和编译临时分配；不是编译器新增内存，也不是 JS 堆峰值。编译前完成输入字符串物化并执行 GC。保留结果、释放结果后分别执行 GC，二者的 `heapUsed` 差值用于估算结果额外保留的堆；该差值不包含仍由调用者持有的源码字符串。峰值采集早于输出遍历和 `structuredClone`。

浏览器使用本机 Edge 135.0.3179.66 的无头模式，加载生产 ESM 产物，每个输入使用独立模块 Worker，预热 2 次、测量 5 次。分别记录 Worker 内编译时间和主线程发送源码至接收到结果的往返时间。该测量包含实际消息复制与调度，不包含 React 预览、排版或绘制。

## 耗时和内存

仓库原有基准在默认 Node 堆配置下预热 3 次、测量 20 次，当前结果为：

| 场景 | 编译中位数 | P95 |
| --- | ---: | ---: |
| 632 字符费用示例 | 3.56 ms | 6.10 ms |
| 250 行响应式表格 | 37.86 ms | 48.27 ms |
| 100 节交互文章，15,550 字符 | 57.81 ms | 85.51 ms |

独立进程压力矩阵如下。该矩阵使用 1 GiB V8 老生代上限、独立进程和不同的预热/GC 策略，应与上面的默认配置基准分别解读。提高预算的行使用 250,000 节点预算。

| 场景 | 源码代码单元 | 编译中位数 | P95 | 首次进程峰值 RSS | 结果额外堆保留 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 万字符纯文本 | 100,000 | 90.40 ms | 107.22 ms | 120.6 MiB | 0.02 MiB |
| 50 万字符纯文本 | 500,000 | 511.25 ms | 583.37 ms | 244.2 MiB | 0.02 MiB |
| 100 万字符纯文本 | 1,000,000 | 1,098.69 ms | 1,187.77 ms | 289.1 MiB | 0.02 MiB |
| 100 节文章 | 15,550 | 96.86 ms | 180.97 ms | 99.4 MiB | 0.60 MiB |
| 600 节文章 | 94,050 | 897.31 ms | 995.46 ms | 149.1 MiB | 3.46 MiB |
| 2,000 节文章，提高预算 | 315,852 | 4,030.49 ms | 4,169.21 ms | 246.7 MiB | 11.74 MiB |
| 1,000 个独立滑块 | 68,779 | 166.04 ms | 186.71 ms | 110.6 MiB | 1.11 MiB |
| 5,000 个独立滑块 | 352,779 | 1,009.68 ms | 1,250.36 ms | 203.6 MiB | 4.93 MiB |
| 10,000 个独立滑块 | 707,779 | 1,755.38 ms | 1,909.49 ms | 330.0 MiB | 9.82 MiB |
| 12,000 个独立滑块，提高预算，5 次样本 | 853,779 | 1,700.11 ms | 1,747.18 ms | 379.7 MiB | 12.72 MiB |
| 1,000 个公式 | 16,000 | 199.08 ms | 280.80 ms | 116.9 MiB | 0.65 MiB |
| 1,000 行响应式表格 | 28,910 | 392.30 ms | 604.60 ms | 129.3 MiB | 2.23 MiB |
| 5,000 个串联 computed 声明 | 237,839 | 655.93 ms | 720.84 ms | 200.1 MiB | 2.30 MiB |

12,000 个滑块的补测晚于主矩阵，样本较少且主机状态不同；其耗时低于主矩阵的 10,000 个滑块，不能据此判断规模增加反而加快。结果堆保留远小于进程峰值，说明资源压力主要来自中间解析表示与临时分配。100 万字符纯文本最终只有 2 个节点，仍需完整扫描和 Markdown 解析。

Edge 模块 Worker 的中位数：

| 场景 | Worker 编译 | 源码发送至结果接收 |
| --- | ---: | ---: |
| 100 节文章 | 54.5 ms | 57.1 ms |
| 600 节文章 | 373.9 ms | 396.2 ms |
| 1,000 个滑块 | 102.9 ms | 107.2 ms |
| 5,000 个滑块 | 381.3 ms | 401.8 ms |
| 10,000 个滑块 | 801.5 ms | 852.7 ms |
| 100 万字符纯文本 | 608.8 ms | 612.1 ms |

普通大文档的 Worker 消息传输能完成；在 600 节文章和 10,000 个组件下，消息往返比编译本身增加约 22 ms、51 ms。预览渲染仍会增加主线程成本。

## 稳定性与边界

共覆盖 43 种 Node 输入/预算组合，另做浏览器 Worker、首次重负载和持续编辑复测。

| 条件 | 观测结果 |
| --- | --- |
| 1,000,001 个代码单元 | 默认预算立即拒绝，中位数 0.036 ms，诊断 `local.budget.document` |
| 默认预算下 10,001 / 12,000 个滑块 | 返回节点超限诊断，补测中位数分别为 137.71 / 162.89 ms |
| 默认预算下 2,000 节文章 | 返回节点超限诊断，主矩阵中位数 3,847.37 ms；拒绝前已承担大量解析成本 |
| 20,000 个短段落，120,000 字符 | 返回节点超限诊断，中位数 1,901.14 ms，首次峰值 374.1 MiB |
| 100,000 个短段落，600,000 字符，默认预算 | 首次编译 15.96 秒后返回节点超限诊断，首次峰值 996.3 MiB |
| 相同 100,000 段，提高预算 | 首次编译 20.32 秒后成功，输出 200,000 节点，首次峰值 1,001.1 MiB |
| 5,000 个共享状态滑块 | 成功，中位数 784.49 ms |
| 5,000 个重复显式初值滑块 | 正常拒绝，中位数 736.56 ms，诊断收敛至 4 条 |
| 100 层 panel | 成功，中位数 125.72 ms |
| 101 层 / 1,000 层 panel | 返回嵌套预算及缺失闭合标签诊断；1,000 层中位数 3,038.34 ms |
| 1,000 个未闭合 panel | 正常返回诊断，中位数 961.21 ms |

100,000 段的原始重复基准在 60 秒整组期限内没有完成，随后拆为只测首次编译的独立进程，得到了上面的 15.96 / 20.32 秒结果。这里的 60 秒是测试进程期限，不能写成一次编译持续超过 60 秒。该输入的默认节点预算没有在初次 Markdown 解析前生效，宿主不能用 10,000 节点预算推导出小内存或快速拒绝。

深层 Markdown 有独立于组件深度的失败路径。输入为 `'> '.repeat(depth) + 'text'`：

- Node 中 500 层正常编译及复制；1,000、1,500 层可编译，但 `structuredClone(result)` 抛出 `RangeError: Maximum call stack size exceeded`；2,000 和 5,000 层返回解析诊断。具体阈值受引擎、栈空间和优化状态影响。
- Edge Worker 中，500 层仅 1,004 字符，`compileLocal` 成功，随后 `postMessage` 回传对象图时栈溢出。1,000 和 2,000 层在解析阶段返回 `local.parse.document`。
- 直接使用公开的 `startLocalCompileWorker()` 重现 500 层输入，收到 `{ ok: false, message: 'Could not return the compile result: ... Maximum call stack size exceeded' }`。同一个 Worker 随后可以编译普通文本，验证了错误恢复。表现是该文档无法正常形成 Worker 预览，测试未出现 Worker 永久失去响应。

组件的 100 层限制没有统一约束 Markdown 的块引用深度。建议增加明确的 Markdown 深度预算，同时覆盖解析、普通数据发布和消息传输。

持续编辑复测保留旧结果直至下一次编译完成，每个场景编译 100 个不同版本，每 10 次执行 GC：

| 场景 | 第 20 次 GC 后堆，含预览 | 第 100 次 GC 后堆，含预览 | 首次释放结果后的堆 | 100 次后释放结果的堆 | 全程峰值 RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 节文章 | 11.306 MiB | 11.394 MiB | 10.749 MiB | 10.778 MiB | 147.1 MiB |
| 1,000 个独立滑块 | 11.803 MiB | 11.872 MiB | 10.792 MiB | 10.783 MiB | 162.7 MiB |

这两组 100 次测试未显示明显的持续保留增长。RSS 还包含 JS 活跃堆之外的运行时与原生内存，释放结果后未即时下降不能单独判为对象泄漏。该测试覆盖固定结构、不断改变编辑版本号的文档；长时运行、持续增加不同复杂表达式和多个并发文档需要另外验证。

## 热点与优化顺序

V8 CPU 采样在预热后的生产产物上分别连续编译 3 次。按采样调用栈将时间分到解析、语义处理、发布普通数据、GC 和其他工作。采样开销和堆配置与主基准不同，百分比用于识别热点，不用于换算主基准的绝对耗时。

| 输入 | 解析及 Markdown 后端 | GC | 发布普通数据 | 语义处理及依赖分析 |
| --- | ---: | ---: | ---: | ---: |
| 600 节文章 | 65.9% | 19.0% | 8.4% | 4.1% |
| 100 万字符纯文本 | 70.1% | 26.9% | 低于采样分辨率 | 2.0% |
| 5,000 个滑块 | 54.7% | 19.5% | 11.7% | 12.9% |

源码解释了这些开销：

- `src/local/parser.ts:290` 首次完整调用 Markdown 解析器，识别代码和脚注等受保护区域；`src/local/parser.ts:1581` 对替换占位符后的文本再次完整解析。组件容器体还在 `src/local/parser.ts:1050` 解析。密集文本在节点构造预算介入前已支付 Markdown 解析成本。
- `src/local/parser.ts:1531` 的 `convert()` 为生成文本的每个代码单元建立位置映射；存在缩进时还逐字符构造字符串。这些分配需要结合堆分析进一步拆分，当前 CPU 证据支持优先优化解析和分配路径。
- `src/local/compiler.ts:323` 对完整编译结果调用 `plainCompiledData()`；`src/local/compiled-data.ts:6` 递归复制对象与数组，逐属性使用 `Object.defineProperty()`，保留共享引用和冻结语义。它在大组件文档中占到约一成采样时间。优化时需要保留普通对象、原型安全和 React Server Component 兼容契约。

建议按以下顺序开展优化：

1. 在底层 Markdown 解析或更早的预检处增加可控工作量/深度预算，让密集段落与深层 Markdown 的拒绝路径具备明确上限。同步 API 的超时需要由宿主独立进程或 Worker 终止实现。
2. 减少重复 Markdown 解析与每字符位置映射的分配，先用相同测试夹具验证诊断位置、转义、代码屏蔽、HTML 与脚注的语义等价。
3. 优化普通数据发布过程，减少第二份完整对象图的构造成本，同时保留现有数据契约。
4. 在算法热点收敛后评估增量编译；当前实现每次完整解析源码，编辑合并只减少调用次数。

Playground 调度器合并连续 150 ms 内的编辑，最多保留一个正在执行的任务和一份最新待编译源码，并丢弃过期结果。`src/local/worker.ts` 当前没有为正在执行的任务设置自动截止时间；Worker 隔离可以保持主线程响应，过期任务仍会执行至结束。大量节点接收后的 React 渲染和布局需要单独测量。

## 复现与原始记录

在仓库根目录执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node scripts/benchmark-compiler-stress.mjs --output artifacts/compiler-stress.json
node scripts/benchmark-compiler-stress.mjs --case '^(article-100|controls-1000)$' --soak 100 --output artifacts/compiler-retention.json
node scripts/benchmark-compiler-stress.mjs --case '^paragraphs-100000(-raised)?$' --once --output artifacts/compiler-dense-first-call.json
node scripts/benchmark-compiler-browser.mjs --output artifacts/compiler-browser.json
```

脚本选项：`--case` 按场景 ID 的正则筛选，`--samples` 调整测量次数，`--warmups` 调整预热次数，`--timeout` 调整整组进程期限，`--once` 只测首次编译，`--soak` 连续编译带有不同编辑版本号的源码并每 10 次记录一次 GC 后内存。提高预算的场景显式使用 `limits.maxSyntaxNodes = 250000`。

本次原始记录保存在忽略目录 `artifacts/`，与本地工作区一起交付：

- Node 主矩阵（本地文件 `artifacts/compiler-stress-2026-10-28.json`）
- Node 边界补测（本地文件 `artifacts/compiler-stress-supplement-2026-10-28.json`）
- 首次密集段落编译（本地文件 `artifacts/compiler-dense-first-call-2026-10-28.json`）
- 100 次编辑版本的内存记录（本地文件 `artifacts/compiler-retention-2026-10-28.json`）
- 浏览器 Worker 测量（本地文件 `artifacts/compiler-browser-2026-10-28.json`）
- 大量组件与深层 Markdown 的浏览器补测（本地文件 `artifacts/compiler-browser-supplement-2026-10-28.json`）
- 公开 Worker 协议的复制失败与恢复（本地文件 `artifacts/compiler-browser-protocol-2026-10-28.json`）
- Node 深层 Markdown 补测（本地文件 `artifacts/compiler-depth-2026-10-28.json`）
- 默认 Node 配置的原有基准（本地文件 `artifacts/benchmark-2026-10-28.json`）
- CPU 采样脚本（本地文件 `artifacts/profile-compiler.mjs`），运行方式为 `node --expose-gc artifacts/profile-compiler.mjs article 600`，生成 `.cpuprofile` 和阶段汇总 JSON；`plain 1000000`、`controls 5000` 对应另外两组采样。

Node 主矩阵中的 `markdown-depth-1000` 最初在基准附加的 `structuredClone` 步骤退出，后续补测已将复制异常单独捕获。评估编译稳定性应采用补测中的 `outcome` 和 `cloneError`，避免将复制异常误判为编译器崩溃。

验证：`npm run build` 成功；`tests/local-security-compiler.test.ts`、`tests/local-compile-options.test.ts`、`tests/local-compile-worker.test.ts`、`tests/compiled-plain-data.test.ts` 共 80 项现有测试通过。这些测试通过与本次发现的密集文本、深层 Markdown 边界并存。
