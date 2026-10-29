# 连续上下文编辑、列表与表格优化

2026-10-28。本轮针对[块类型基线](block-type-performance-2026-10-28-ch.md)中的两处开销：修改组件后立即重建整篇缓存，以及大列表、表格进入通用 Markdown 分词器的成本。

后续的分段映射、按块降级、直接节点生成与预算前移，见[解析流水线优化](parser-pipeline-optimization-2026-10-28-ch.md)。本文保留该轮实现的测量结果。

## 搜索与实现

上游 [micromark GFM 表格 PR #17](https://github.com/micromark/micromark-extension-gfm-table/pull/17)修复了编辑列表查找导致的二次复杂度问题。本地安装的 `micromark-extension-gfm-table 2.1.2` 已包含基于 `Map` 的修复。本轮保持依赖版本，在 ReactiveMD 内增加快速扫描。

[GFM 规范](https://github.github.com/gfm/#tables-extension-)包含表格分隔行、转义管道符以及列表的容器规则。快速路径只接收能够直接确认语义的子集，其他输入继续使用原来的 remark 管线。

### 缓存延迟重建

原会话在上下文变化后执行完整编译，接着复制文档、遮蔽上下文、解析 Lezer 索引，并再次编译声明前缀。连续调整组件时，这个索引通常在下一次修改时就失效。

现在，首次建立索引后，如果修改触发完整编译，会话只保留最新成功结果。连续修改同一上下文时跳过索引重建；重新编辑独立正文块时，再为最新结果建立一次索引并编译变化块。相同源码可直接返回新的数据快照。该策略由下一次编辑的位置决定，不依赖计时器。

内部 `compileLocalTracked()` 返回编译器私有对象，公开返回时统一复制一次。索引接管私有对象，避免再复制整篇缓存。调用者修改返回值仍不会影响后续编译。错误、选项变化、`clear()` 和 `dispose()` 清除待恢复数据，会话始终只持有当前版本。

`stats.cacheBuilds` 记录本次调用尝试建立块索引的次数：连续上下文修改为 0，成功恢复时为 1。上下文修改仍执行完整语义编译，确保绑定、计算值和表格结构立即更新。

### 列表与表格快速扫描

新增 `src/local/fast-markdown.ts`，在根 Markdown 解析及容器转换时优先尝试：

- 顶层、紧凑、每项一行且标记一致的无序或有序列表。
- 带外侧管道符、各行列数一致的表格，支持空单元格及列对齐。
- 纯文本和由空格分隔、边界明确的 `**strong**` 片段；块间可包含单行普通段落。

扫描器输出带 UTF-16 偏移的内部 Markdown 节点，后续继续走原语义转换，保留节点创建顺序、ID、位置和预算检查。单元格与加粗片段的搜索限制在当前范围内，避免重复扫描后续整篇源码。

嵌套或松散列表、多行列表项、任务列表、引用、链接、转义管道符、代码、实体、插值及其他复杂行内语法交给 remark。该优化缩短了整个列表或表格块的解析时间；修改一行仍会重新解析该块，尚未加入行级缓存。

## 相同长文负载的对比

Windows x64、Intel Core Ultra 5 125H、Node 22.17.0、默认 V8 堆。修改前保存完整生产包，再构建优化版本。每个场景独立子进程串行运行，预热 3 次、测量 21 次；完整编译与会话编译交替先后顺序。目标块位于相同的 1000 个普通段落中间，版本号宽度固定。计时包含完整结果组装，排除源码生成和断言。

| 修改目标 | 会话优化前中位数 | 优化后中位数 | 优化前 / 后 P95 |
| --- | ---: | ---: | ---: |
| 100 项带加粗的列表 | 15.08 ms | 5.70 ms | 20.92 / 9.71 ms |
| 200×4 普通 Markdown 表格 | 30.78 ms | 10.82 ms | 59.86 / 15.89 ms |
| 滑块初值 | 133.20 ms | 101.20 ms | 169.24 / 133.45 ms |
| Panel 内 50 个段落 | 129.25 ms | 103.54 ms | 175.01 / 159.13 ms |
| Chart 内 20 行数据 | 127.13 ms | 101.23 ms | 158.64 / 144.20 ms |

列表与表格全部 21 次编辑均只编译目标块、复用其余 1000 块。三个组件场景仍是完整编译，全部调用的 `cacheBuilds` 为 0。机器调度和 GC 影响耗时；索引构建计数直接验证了重建是否发生。

## 大块完整编译与内存

另用独立子进程测量单块文档，预热 3 次、测量 15 次；不同规模交替版本执行顺序。表格有 4 列、包含对齐，列表每项包含加粗。以下是完整 `compileLocal()` 耗时，包含语义处理和结果复制。

| 单块规模 | 优化前中位数 | 优化后中位数 | 优化后 P95 | 进程峰值 RSS：前 / 后 |
| --- | ---: | ---: | ---: | ---: |
| 列表 100 项 | 10.06 ms | 3.20 ms | 7.61 ms | 112.28 / 78.20 MiB |
| 列表 500 项 | 46.41 ms | 18.27 ms | 24.40 ms | 196.03 / 114.17 MiB |
| 列表 1500 项 | 146.19 ms | 60.59 ms | 95.08 ms | 280.53 / 168.34 MiB |
| 表格 100×4 | 11.25 ms | 4.36 ms | 6.44 ms | 127.43 / 79.98 MiB |
| 表格 500×4 | 64.21 ms | 23.11 ms | 71.99 ms | 212.45 / 128.07 MiB |
| 表格 1000×4 | 146.47 ms | 56.78 ms | 85.44 ms | 259.68 / 181.39 MiB |

全部规模都在默认 10,000 节点预算内完成，前后完整序列化结果的 SHA-256 相同。RSS 是整个子进程的最高常驻内存，包含模块加载和多次编译，不能解释为单次解析额外分配。GC 后保留堆主要由相同的最终文档决定，没有同等幅度的下降。

补测实际 `<table>` 容器：100×4 表格完整编译中位数为 16.28 → 12.19 ms，500×4 为 110.67 → 70.67 ms，前后序列化结果也相同。组件外围的通用解析及语义处理仍有成本，收益低于纯 Markdown 单块。组件表格的峰值 RSS 未下降，100×4 为 111.21 → 111.93 MiB，500×4 为 208.88 → 218.73 MiB；此处本轮收益主要是编译时间。

## 200 次上下文修改与恢复

1000 个较短背景段落、一个滑块和一个表达式，连续修改滑块初值 200 次，每 20 次强制 GC。优化前稳态编辑中位数 82.73 ms，优化后 67.29 ms；P95 分别为 137.97 和 118.44 ms。

优化后第 20 次 GC 后堆为 13.58 MiB，第 200 次为 12.77 MiB，全部检查点为 12.67–13.58 MiB，未见随次数增长的保留堆。后 199 次上下文修改共建立 0 次索引。恢复正文编辑时只编译 1 块、复用 1000 块，建立 1 次索引。

恢复编辑耗时从原来的 16.54 ms 增至 30.07 ms。这是延迟重建的一次性成本。销毁会话后堆为 11.95 MiB，初始为 10.18 MiB；测量结束时仍保留恢复编辑的公开结果及已预热模块。

## 验证与复现

- 94 个测试文件、1332 项测试通过，类型检查和生产构建通过。
- 快速路径对比原 remark 树、CR/LF/CRLF、空单元格、对齐、60 份生成文档，以及 882 种块组合；节点 ID 和预算失败位置保持一致。
- 缓存测试覆盖连续组件修改、相同源码、公开结果篡改、计算声明、容器和表格元数据、选项、错误及释放后的恢复。
- 580 份现有和生成文档、1740 组选项的完整编译结果与早期生产包逐字段一致。
- Edge 135 真实模块 Worker 验证上下文连续修改 0 次重建、正文恢复 1 次重建，以及 500 行列表和表格的跨消息块复用；包入口检查通过。

```sh
npm run build
# 修改前需先保留当时的 dist-library，供 --module / --before 指定。
node scripts/benchmark-block-types.mjs --case 'bullet-100|table-200|control-1|panel-50|chart-20' --module artifacts/compiler-before-context-tables/reactive-md.js --output artifacts/context-tables-before.json
node scripts/benchmark-block-types.mjs --case 'bullet-100|table-200|control-1|panel-50|chart-20' --output artifacts/context-tables-after.json
node scripts/benchmark-fast-blocks.mjs --before artifacts/compiler-before-context-tables/reactive-md.js --output artifacts/context-tables-scaling.json
node scripts/verify-incremental-browser.mjs
npm test
npm run test:package
npm run test:docs
```

`benchmark-fast-blocks.mjs` 可独立运行当前版本，也可用 `--iterations`、`--warmups`、`--edits`、`--case` 和 `--output` 调整测量。前后包和原始 JSON 位于本地忽略目录 `artifacts/`：[长文优化前](../../artifacts/context-tables-before.json)、[优化后](../../artifacts/context-tables-after.json)、[规模与内存](../../artifacts/context-tables-scaling.json)、[组件表格补测](../../artifacts/context-tables-components.json)、[浏览器验证](../../artifacts/incremental-browser.json)。
