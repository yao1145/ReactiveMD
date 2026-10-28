# 密集段落编译优化与复测

2026-10-28，在 ReactiveMD 0.6.1、基线提交 `df59896e191f6eee57cb25674ad12cd28dc180c0` 上完成普通段落解析优化。默认预算下，60 万字符、10 万短段落的首次超限返回从 16.34 秒降到 29.9 ms，进程峰值 RSS 从 1,003.8 MiB 降到 69.4 MiB。提高节点预算后，相同文档的成功编译从 19.92 秒降到 2.30 秒，峰值从 1,082.8 MiB 降到 296.1 MiB。

## 实现

新增 `src/local/plain-paragraphs.ts`，直接处理能够完整确认为普通文本的段落：

- 先扫描整个输入，识别可能改变 Markdown 或 ReactiveMD 语义的字符与行前缀。格式、代码、链接、实体、组件、插值、数学、缩进、行末空格换行等输入交给原有解析流程。检查完整输入可以保留后置引用定义等全局语义。
- 对确认的普通文本按行识别段落，直接调用现有节点工厂构造文本、可选的软换行和段落节点。避免 Markdown 事件流、mdast 中间树、占位文本和每字符位置映射。
- 节点工厂在构造过程中执行原有预算。默认 10,000 节点用尽后即可返回诊断，无需先构造整篇文档的 Markdown 事件流。诊断代码、位置、节点 ID 顺序和预算数值保持原契约。
- 保留 LF、CRLF、单独 CR、Unicode UTF-16 范围、段落末尾空格范围，以及 `markdownBreaks` 的节点构造顺序。只含尾随空格的长行采用线性扫描。

`src/local/parser.ts` 还复用没有占位符替换或去缩进的根 Markdown 树。第一遍解析已经得到该源码的完整 mdast，转换时直接读取，并用恒等位置映射加 BOM 偏移，省去第二遍解析和偏移数组。这一优化也覆盖包含加粗、强调等语法的普通 Markdown。含组件或其他源码替换的文档继续使用已有的占位转换路径。

这两项优化不新增公开 API，不提高默认预算，也不引入新依赖。

## 对照结果

保存优化前的完整生产产物至 `artifacts/compiler-before/`，再构建优化后产物。两边使用同一基准脚本、输入、Node 22.17.0 和独立进程，设置 `--max-old-space-size=1024`，串行测量导入之后的首次 `compileLocal` 调用。机器为 Windows x64、Intel Core Ultra 5 125H、约 31.44 GiB 物理内存。源码生成、GC 快照和结果检查均在编译计时之外。

| 输入 | 预算 / 结果 | 优化前首次编译 | 优化后首次编译 | 峰值 RSS：前 → 后 |
| --- | --- | ---: | ---: | ---: |
| 5,000 个普通短段落，30,000 字符 | 默认，成功 | 517.4 ms | 87.0 ms | 149.1 → 80.1 MiB |
| 100,000 个普通短段落，600,000 字符 | 默认，返回节点超限 | 16,339.7 ms | 29.9 ms | 1,003.8 → 69.4 MiB |
| 相同 100,000 段 | 250,000 节点，成功 | 19,918.7 ms | 2,297.8 ms | 1,082.8 → 296.1 MiB |
| 5,000 个含加粗、强调的段落，285,000 字符 | 默认，返回节点超限 | 973.4 ms | 568.6 ms | 202.9 → 168.1 MiB |
| 相同 5,000 个格式段落 | 250,000 节点，成功 | 1,206.6 ms | 846.9 ms | 201.7 → 193.9 MiB |
| 100 万字符普通文本 | 默认，成功 | 934.8 ms | 30.1 ms | 315.8 → 62.3 MiB |

RSS 是整个独立进程从启动至首次编译结束的高水位，包含 Node 和模块，不能作为编译器新增分配量。首次调用包含 JIT 成本，适合比较首次处理大输入的表现。

另做默认 Node 堆配置下的预热对照：每种输入两次预热，六组 A/B 成对调用，交替执行顺序；在第二个进程中反转模块导入顺序，再取两轮成对耗时比中位数的几何平均。5,000 个普通段落耗时比为 0.162，约加速 6.2 倍；5,000 个格式段落提高预算后为 0.643，约加速 1.56 倍。100 万字符普通文本比值为 0.00674，此场景最终只有两个节点，完整编译主要剩下线性扫描。

600 节交互文章和 1,000 个滑块同时作为回归观察输入。单次结果与成对结果波动较大，当前证据支持把收益归于普通文本直接路径和无替换 Markdown 的树复用；没有将组件文档计入加速结论。

## 语义和稳定性验证

测试先对普通段落解析器与 remark 的节点、ID、值和范围做对照，再集成到公开编译器。测试覆盖换行方式、Unicode、软换行、末尾空格、预算边界、代码、实体、链接、格式和 ReactiveMD 语法回退，并含确定性生成的普通文本。

生产产物差分验证使用仓库中的本地示例以及确定性生成的混合语法文档，共 580 份文档。每份检查默认选项、`markdownBreaks: true` 和 12 节点预算，合计 1,740 组结果；与保存的优化前产物逐字段一致，包括完整节点树、依赖信息、源码位置和诊断。

最终源码的 92 个测试文件、1,270 项测试全部通过，生产构建和类型检查成功。Edge 模块 Worker 复测中，5,000 个普通段落的编译中位数为 38.4 ms，源码发送至结果接收为 53.1 ms；100 万字符普通文本分别为 7.3 ms 和 11.3 ms。每个浏览器场景预热 2 次、测量 5 次，均成功返回结果，未计入 React 预览、布局与绘制。公开 Worker 在深层 Markdown 传输错误后的恢复检查也通过；本次优化没有处理该深度边界。

成功处理 10 万段仍需创建 20 万个输出节点；提高节点预算后，普通数据发布和输出对象图仍有明显成本。普通文本直接路径也采用保守识别，遇到语法后整篇转入通用解析。这些输入后续可以研究块级复用或更细的工作量预算，并继续用引用、脚注、代码屏蔽和源码范围差分检查语义。

## 搜索与实现依据

[micromark 的实现说明](https://github.com/micromark/micromark#overview) 介绍了字符预处理、token 事件、子内容解析和后处理流程，并说明流式接口仍需缓冲事件。因此，这次在应用层减少重复工作，并让确认的普通文本直接生成本地节点。

[上游 subtokenize 性能 PR](https://github.com/micromark/micromark/pull/234) 展示了用 Map 减少稀疏整数属性查找及中间对象的思路，以及交替 A/B、反转导入顺序、输出特征对照的验证方法。本次借鉴其验证方法，未复制该 PR 的实现，也未修改依赖包。它报告的约 3% 收益来自其自身测试集，不能代替这里的大段落实测。

## 复现

在构建优化版本前保存旧产物，然后在仓库根目录执行：

```sh
npm run build
node scripts/benchmark-compiler-stress.mjs --module artifacts/compiler-before/reactive-md.js --case '^(paragraphs-(5000|100000)(-raised)?|formatted-paragraphs-5000(-raised)?|plain-1000000)$' --once --output artifacts/dense-before.json
node scripts/benchmark-compiler-stress.mjs --case '^(paragraphs-(5000|100000)(-raised)?|formatted-paragraphs-5000(-raised)?|plain-1000000)$' --once --output artifacts/dense-after.json
```

基准支持 `--module` 指向保存的生产入口。格式段落夹具为每段 `A **bold** paragraph with _emphasis_ and ordinary text.`，普通段落为 `word`，均使用两个 LF 分隔。超长普通文本与原调查使用相同夹具。

本地原始结果：

- [独立进程优化前](../../artifacts/compiler-dense-optimization-before.json)、[优化后](../../artifacts/compiler-dense-optimization-after.json)
- [预热 A/B，旧模块先导入](../../artifacts/compiler-dense-paired-before-first.json)、[新模块先导入](../../artifacts/compiler-dense-paired-after-first.json)
- [预热对照脚本](../../artifacts/benchmark-dense-paired.mjs)
- [完整结果差分](../../artifacts/compiler-equivalence.json)、[差分脚本](../../artifacts/verify-compiler-equivalence.mjs)
- [浏览器 Worker 复测](../../artifacts/compiler-browser-dense-after.json)

这些原始记录保存在忽略目录 `artifacts/`，随本地工作区交付。初始调查及测量范围见[编译性能调查](compiler-performance-2026-10-28-ch.md)。
