# 块级增量解析与编译

2026-10-28，ReactiveMD 新增 `createLocalCompileSession()`。持续编辑同一文档时，会话保留未变化块的编译产物，重新解析并编译受影响的 Markdown 块。内置 Worker、默认主线程降级编译和 `LocalReactiveDocument` 已接入。`compileLocal()` 继续提供无会话的完整编译。

## 实现与搜索依据

[Lezer Markdown 的说明](https://github.com/lezer-parser/markdown)介绍了增量语法树片段复用，同时明确指出其单遍解析不验证链接引用。实现采用 Lezer 的增量语法边界，并继续由 ReactiveMD 原编译器决定语义；引用定义等需要全局解析的输入走完整路径。[TreeFragment 实现](https://github.com/lezer-parser/common/blob/main/src/parse.ts)提供 `addTree`、`applyChanges` 和带偏移的片段，供编辑后的解析复用。

新增依赖为 `@lezer/markdown` 1.8.1、`@lezer/common` 1.5.4，均打包进生产产物。它们及依赖的许可文本已加入第三方声明。

会话流程：

1. 首次调用执行完整编译，捕获内部累计节点构造数，从成功且无诊断的结果提取块缓存。组件、声明、版本与主题形成不变的上下文；Markdown 部分建立 Lezer 语法树。缓存使用私有数据副本。
2. 下一次编辑比较旧、新源码，计算变化区间，并用 `TreeFragment.applyChanges()` 调整旧树片段。上下文按原 UTF-16 长度遮蔽后参与边界解析；恢复块前缩进及行尾空格，保证代码块和段落解释一致。
3. 依据新块的范围、原位置映射和源码匹配复用未修改块。变化块在相同的声明前缀下调用原编译器，重新检查表达式类型等语义。这个小编译包含声明前缀的处理，并计入 `compiledCharacters`。
4. 累加缓存块与变化块的语法节点成本，继续检查整篇预算。返回完整的普通数据快照，更新节点、声明与验证规则的源码位置。保留块可以沿用节点 ID，变化块使用不冲突的新 ID。

缓存只保留当前版本。每个公开结果都有独立的节点对象和元数据，调用者修改旧结果不会污染下一次编译。`clear()` 释放可复用状态；`dispose()` 释放状态并结束会话。Worker 生命周期结束或 React 组件卸载时释放相应会话。

## 适用范围与失效

| 编辑或输入 | 处理方式 |
| --- | --- |
| 普通、带格式、列表、标题、表格、代码等独立顶层 Markdown 块的小范围编辑 | 复用其他块，只编译受影响块 |
| 不变参数/声明下的表达式段落编辑 | 用相同声明前缀编译变化块，复用其他块 |
| 组件或容器保持不变，编辑外部段落 | 复用组件上下文及其他 Markdown 块 |
| 修改声明、组件或容器内部内容 | 完整编译并重建上下文 |
| 改变选项、权限、宿主 schema 或节点预算 | 清除旧复用状态，完整编译 |
| 引用定义、脚注、导航锚点、原生 HTML、BOM | 完整编译 |
| 改变代码定界符或转义，边界可能跨块传播 | 保守完整编译 |
| 出现诊断、预算无法在缓存路径确认或边界不一致 | 返回完整编译的结果和诊断 |

单块文档没有可复用的邻接块，使用完整编译。整篇源码比较、范围重定位、结果快照组装及 Worker 传输仍随文档大小增长。当前接口传递完整源码和完整结果，尚未采用编辑补丁或结果补丁传输；预览渲染也保持原流程。

会话结果内部的 ID 和元数据引用保持一致，但 ID 编号可以与独立完整编译不同。差分测试将 ID 按结构规范化后比较其余结果，同时单独验证未修改块 ID 稳定。

## 持续编辑性能

环境：Windows x64、Intel Core Ultra 5 125H、Node 22.17.0，默认 V8 堆配置。每份文档建立一个会话，在末尾块连续追加不同版本号；预热 3 次后测量 15 组完整/增量编译，交替执行顺序。计时包含完整快照组装，正确性及复用数量断言位于计时外。机器同时运行其他开发进程，原始样本记录了 GC 和调度波动。

| 场景 | 源码代码单元 | 完整编译中位数 | 增量中位数 | 本轮重编译 / 复用块数 |
| --- | ---: | ---: | ---: | ---: |
| 5,000 普通段落 | 29,998 | 60.20 ms | 15.99 ms | 1 / 4,999 |
| 1,000 格式段落 | 56,998 | 233.66 ms | 18.48 ms | 1 / 999 |
| 600 节交互文章 | 94,049 | 1,030.09 ms | 30.65 ms | 1 / 1,799 |
| 2,000 节交互文章，50,000 节点预算 | 315,851 | 3,589.53 ms | 53.12 ms | 1 / 5,999 |

600 节文章最后一轮只向原语义编译器提交 139 个代码单元，包含声明前缀。首次建立会话需额外构建语法索引及缓存：上述四组首次调用分别为 202.4、283.6、1,405.1、5,381.3 ms。因此，会话面向重复编辑，首次调用不承诺快于无会话编译。

Edge 135.0.3179.66 的真实模块 Worker 复测同一份 600 节文章，连续 10 次编辑均只重编译 1 块、复用 1,799 块。去掉前 3 次观测后，Worker 编译中位数为 10 ms，包含发送源码和接收完整结果的往返中位数为 27.3 ms。改变 `markdownBreaks` 后恢复完整编译。该检查不包含 React 预览、布局和绘制。

## 内存与验证

5,000 段文档连续编辑 200 次，每 20 次执行 GC，保留当前结果时的堆在第 20 与第 200 次均为 21.47 MiB。释放公开结果后，会话保留堆为 19.56 MiB；销毁会话后为 10.90 MiB，初始基线为 9.89 MiB。这次测试未见随编辑次数持续增长的保留堆；运行时预热及原有模块缓存仍有常驻成本。

最终验证：

- 93 个测试文件、1,287 项测试通过；生产构建与类型检查通过。
- 增量测试包含 256 种块语法转换、560 次确定性编辑序列、累计预算、源码范围、声明与匿名绑定、表格结构、选项失效、旧结果修改隔离及销毁。
- 无会话编译器与优化前生产产物的 580 份文档、1,740 组选项结果逐字段一致。
- 真实浏览器 Worker 的跨消息复用、选项失效和完整结果传输通过。
- 包入口、核心类型与 React 边界检查通过。

## API 和复现

```ts
import { createLocalCompileSession } from 'reactive-md';

const session = createLocalCompileSession();
session.compile('First **paragraph**.\n\nSecond paragraph.');
const result = session.compile('First **paragraph**.\n\nEdited second paragraph.');
console.log(session.stats);
session.dispose();
```

宿主应为每份正在编辑的文档保留一个会话。[集成说明](../integration/local-integration-ch.md#持续编辑的增量编译)包含生命周期和快照语义。

```sh
npm run build
node scripts/benchmark-incremental.mjs
node scripts/verify-incremental-browser.mjs
node --expose-gc scripts/benchmark-incremental-retention.mjs
npm test -- tests/local-incremental.test.ts tests/local-compile-worker.test.ts
```

原始数据：[Node 持续编辑](../../artifacts/benchmark-incremental.json)、[浏览器 Worker](../../artifacts/incremental-browser.json)、[200 次编辑内存](../../artifacts/incremental-retention.json)。它们保存在忽略目录 `artifacts/`，随本地工作区交付。
