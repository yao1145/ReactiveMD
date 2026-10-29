# 长文编辑与预览渲染：分阶段测量和优化

2026-10-29。接续[持续编辑实现与验证](editing-completion-2026-10-28-ch.md)。本轮测量覆盖调度、主线程结果应用、React render/commit、浏览器样式、布局和绘制，并据此优化真实 Playground 和内置编辑器。

## 找到的开销

Demo 原先沿用调度器 150 ms 的等待。此前的编辑性能夹具设置了 20 ms，因此不能直接代表 Demo 的等待时间。

`LocalPreview` 每次收到文档时先返回加载界面，释放旧运行时，再创建运行时、挂载整个 `LocalDocumentView`。结构共享和块级 memo 因卸载失效。18 次安装包含首次加载、两次预热编辑和十五次测量编辑；旧版正文根元素被替换 17 次，优化后持续复用。

完整编辑器还有同步计算。`useAuthorAnalysis()` 在 render 中调用 `analyzeLocalSource()`，后者先解析全文，又完整编译以生成诊断。编辑器实际只使用 tokens 和绑定范围，显示的诊断来自宿主编译结果。七次样本的定位实验中，800 段场景的编辑器整体 render 累计约 356 ms，预览部分约 10 ms。“渲染慢”包含了 render 内部的重复解析和编译。

## 已应用的改动

- Demo 显式使用 20 ms 合并等待，保留在途请求合并和旧结果隔离。库调度器的公开默认值保持 150 ms。
- `LocalPreview` 保留已提交视图，在新文档提交后通过布局 Effect 迁移运行时，再同步更新视图。普通编辑不再切换到加载界面，迁移不会发生在可能被中断的 render 中。
- `PreviewStateSession` 的活动 lease 增加 `update()`，复用运行时和订阅，更新导出状态对应的源码。旧 lease、已释放 lease 和关闭状态保留时拒绝迁移，使用原来的重建路径。初始值和约束变化继续执行既有保留规则。
- 内置编辑器使用独立、有界的增量会话提供作者分析节点，减少按键路径中的重复全文解析和诊断编译。编译暂时失败时回到语法解析，以继续提供高亮和绑定辅助；清理组件时释放会话。
- `analyzeLocalSource()` 增加第三参数 `{ document, diagnostics: false }`。同源码、同配置的成功文档可用于 tokens/引用分析；源码不同会重新解析。原有两参数调用仍生成完整诊断。引用范围通过 Set 去重，避免单个绑定大量引用时的重复线性查找。
- 高亮 span 和引用位置按钮使用稳定的顺序槽位作为 key，文字插入造成的后续偏移变化不会替换整段高亮 DOM。这些 span 只显示文本，原生 textarea 继续负责输入和选择。引用位置改为每版源码创建一次 LF 行索引并二分查询，替代逐条 `slice().split()` 的二次扫描。
- 对至少 200 个顶层节点的文档，仅后续顶层段落启用 `content-visibility: auto` 和 `contain-intrinsic-block-size: auto 2lh`。前 39 个顶层位置保持正常布局。内容全部保留在 DOM；屏幕媒体以外不启用该规则。尚未显示的段落使用两行高度估计，显示后记住实测高度。

实现依据是 [React 的组件树保留规则](https://react.dev/learn/preserving-and-resetting-state)、[提交后且绘制前更新的布局 Effect](https://react.dev/reference/react/useLayoutEffect)、[按依赖缓存计算的 useMemo](https://react.dev/reference/react/useMemo)，以及 [web.dev 的离屏内容布局方案](https://web.dev/articles/content-visibility)。`auto` 的搜索、焦点和可访问性语义见 [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)。

## 测量结果

完整编辑器中的原生中部输入，十五次样本，中位数 / P95（ms）：

| 场景 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 800 个格式化、动态段落 | 705.5 / 733.1 | 182.5 / 229.6 |
| 2400 个格式化、动态段落 | 2401.9 / 2559.8 | 644.6 / 806.4 |
| 1000 行动态表格的单元编辑 | 837.1 / 891.9 | 446.3 / 483.5 |

2400 段场景的阶段中位数（ms）：

| 阶段 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 输入到调度 Effect，包括同步 render | 1277.4 | 231.2 |
| 调度 Effect 到请求派发 | 263.5 | 63.8 |
| 主线程消息接收、补丁应用与发布 | 21.3 | 15.5 |
| 编辑器 React render 累计，包含预览 | 1659.0 | 217.6 |
| 预览 React render 累计 | 41.5 | 24.0 |
| React commitRoot，含同步嵌套工作 | 386.9 | 107.1 |
| DOM mutation 阶段 | 37.1 | 21.7 |
| Layout Effects | 72.7 | 54.3 |
| 结果返回后的样式计算 | 42.53 | 8.05 |
| 结果返回后的布局 | 57.22 | 16.94 |
| 结果返回后的绘制事件 | 6.25 | 3.55 |

最终数据在 `artifacts/render-pipeline/final-results.json`。优化前取自 `final-native-editor-stages.json` 的 before 样本，最终优化后取自 `final-indexed-native-stages.json` 的 after 样本；两次运行使用相同原生输入夹具、场景和样本数，版本在不同运行中测量。每阶段均保留逐次样本与原始 trace。

减少同步分析和引用行号的二次扫描是完整编辑器中最明显的收益。定时器配置为 20 ms 后，大文档实测派发等待仍超过 20 ms，因为主线程的行高测量、布局和其他工作会推迟定时任务。大动态表格继续承担整块编译，2400 段也仍有同步计算与行号镜像测量开销；本轮没有实现全文 DOM 虚拟化或作者辅助 Worker。

## 测量方法

基线是本轮改动前已经验收的生产包和 Demo 快照，包含前几轮未提交优化，不能等同于单独的 `fb05509`。快照位于 `artifacts/render-pipeline/before-library/` 和 `before-demo/`。对照使用同一 Edge、React production profiling、真实 module Worker、Demo 的 `LocalPreview`、`PreviewStateSession` 和 `useLocalCompilation`。完整模式使用实际 `ReactiveMarkdownEditor`，包含高亮、行号镜像和作者辅助。

每个版本先安装一次文档、预热两次编辑，再测十五次。通过原生 textarea 选区和 `keyboard.insertText` 修改中部段落或表格单元，每次增加字符并更新同一块的修订标记，因此后续源码范围持续位移。起点是编辑器 `onChange` 回调标记，不包含此前的物理输入和原生事件派发时间。研究夹具配置 `maxSyntaxNodes: 100000`；完整 Playground 的功能验收使用默认预算。

`queueMs` 是输入到派发，包含 React render、Effects 和等待；`dispatchWaitMs` 从调度 Effect 到实际发送请求，用于区分 render 计算与定时等待。`receiveMs` 是主线程 Worker 消息处理函数的时间，包括补丁应用与状态发布，不包含派发事件前的原生消息反序列化。

测量构建临时包裹 React profiling 包的 `commitRoot`、`flushMutationEffects` 和 `flushLayoutEffects`，用 `finally` 记录调用时间；生产库不包含插桩。同名函数的嵌套调用按区间并集计时，不同阶段仍会重叠，不能相加。`commitRoot` 包含同步触发的 render 和运行时迁移，不能视为纯 DOM 写入时间。编辑器 Profiler 包含预览 Profiler。

CDP trace 记录 renderer 主线程的 `UpdateLayoutTree`、`Layout`、`PrePaint` 和 `Paint`。同时区分输入后的全部布局与 Worker 返回后的布局；后者仍可能包含编辑器和其他子树。原生 textarea 的换行布局属于输入开销，不能全部归因于预览。

“输入到预览”终点是确认新 DOM 内容后经过两次 `requestAnimationFrame`，表示帧机会，不能证明 GPU 已显示完成。Paint 是主线程事件时间，未测 GPU 合成完成时间。十五个样本的 P95 按最近秩取值，在本实验中等于最大样本；版本顺序和后台负载没有统计控制。首次加载只记录单次观察值。

## 验证范围

- 核心：107 个文件、1470 项测试通过，包含 LF/CRLF/UTF-16 行索引、作者分析复用、陈旧文档回退和诊断默认兼容性。
- Demo：17 个文件、260 项测试通过，包含运行时迁移、状态保留、初始值重置、旧 lease 和关闭保留的回归。
- 类型检查、库、编辑器、standalone、声明生成、Demo 构建和公开包边界检查通过。
- 生产浏览器检查正文/控件 DOM 和焦点保留、参数保持为 13、初始值变化重置、原生搜索离屏段落、打印完整布局、快速编辑最终提交及新会话重置。
- 完整 Playground 验收使用原生编辑器和 1500 个动态段落。可选 favicon 请求由测试夹具返回 204，以检查实际应用资源错误。

## 复现与原始资料

```powershell
npm run build
npm run build --workspace=@reactive-md/demo
node scripts/benchmark-render-pipeline.mjs --variants before,after --cases paragraphs800,paragraphs2400,table1000 --editor full --samples 15 --output artifacts/render-pipeline/repeated-native-stages.json
node scripts/verify-render-preview.mjs
```

对照命令需要本轮开始时的基线快照。仅验证当前版本可用 `--variants after`；`--editor minimal` 使用轻量文本框，用于区分预览与编辑器辅助的开销。

原始资料位于 `artifacts/render-pipeline/`，包含阶段 JSON、每个场景的事件和 CDP trace，以及截图。完整 Playground 报告为 `demo-verification.json`，截图为 `demo.png`。

本轮尝试通过 `claude-code-subagent` 启动只读调查，CLI 返回认证 401；该会话已停止，未改动凭据。代码、测量和验收由主代理完成。代码、测试和测量脚本按本轮优化归入独立提交；原始测量数据保留在本地忽略目录。
