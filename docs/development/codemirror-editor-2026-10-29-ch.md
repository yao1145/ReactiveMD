# CM6 可选编辑器实施与验证

前两轮优化已提交为 `658a3b6`（解析与编译复用）和 `047b547`（编辑与预览渲染）。本轮实现、默认切换和高亮修复按用户要求一起提交；不推送。

## 实现

- 独立 `reactive-md/editor/codemirror` 入口与样式，Demo 默认按需加载 CM6，通过 `?editor=textarea` 选择旧编辑器。旧包入口继续兼容，公共类型不依赖外部 CM6 包。
- `EditorSurface` 统一读取源码、选区及订阅，工具栏与作者面板兼容两种编辑表面。每次挂载创建一个 EditorView，CM6 管理行 DOM、软换行、搜索、选择与原生历史。
- 原始 UTF-16 源码与 CM6 的 LF 文本通过换行坐标索引映射，保留未修改的混合换行、BOM 与 emoji。原生输入采用首个换行样式。常规历史使用 CM6 的文本变化，只有会丢失非标准换行的撤销保留额外源码信息。
- 受控回传确认保留历史；文档切换和外部替换重置历史及滚动位置。待确认队列保存最多 120 次逆向编辑，不按键保存整篇源码。事务回调提供原始范围，调度器接受经过验证的单次替换提示；不同基线继续差分和恢复。
- Worker 可选择 `includeAuthorAnalysis`，从同一次成功编译的文档生成 tokens/绑定。主线程不重复语义编译；过期源码、选项不一致及损坏范围不会用于装饰。临时语义错误在 Worker 内按相同预算恢复语法，预算或选项失败返回空分析。分析耗时单独记录。
- 装饰按可见范围生成；绑定与引用每页显示 50 项。预览沿用保留 DOM 的屏幕离屏布局，视图切换不卸载预览。

设计依据：[CM6 文档模型与视口](https://codemirror.net/docs/guide/)、[事务与历史 API](https://codemirror.net/docs/ref/)、[可见范围装饰](https://codemirror.net/examples/decoration/)。接入代码见 [中文指南](../integration/codemirror-ch.md) 与 [English guide](../integration/codemirror-en.md)。

## 生产 Edge 对照

本节为原型阶段的性能对照。默认切换和配色修复后重新验证了正确性、构建及包边界，未重跑性能矩阵。

两种入口来自同一工作区生产包，采用相同编译器、1440×1000 视口、660 px 编辑框、软换行、动态绑定、工具栏和作者面板。每组 18 次原生键入，前 3 次预热，计入 15 次。比较的是虚拟化、Worker 作者分析与列表分页的组合效果。

输入到下一帧机会中位数 / P95（ms），并非完成绘制时间：

| 场景 | textarea | CM6 | 源码 DOM：textarea → CM6 |
| --- | ---: | ---: | ---: |
| 800 段，101,529 字符 | 93.7 / 132.5 | 15.0 / 18.4 | 4,015 → 294 |
| 2400 段，306,129 字符 | 301.7 / 379.3 | 24.0 / 37.8 | 12,015 → 294 |
| 1000 行动态表格，17,949 字符 | 223.8 / 478.8 | 16.5 / 20.0 | 3,021 → 228 |

800 与 2400 段均只挂载约 47 个源码行元素；文档增大没有使源码 DOM 按全文增长。表格场景挂载 71 行。字体、字号和行高使用相同编辑器变量。15 次测量覆盖的主线程 Layout 累计分别为 391.7 → 196.4、1030.4 → 305.3、463.1 → 320.7 ms，包含预览更新。2400 段 CM6 场景仍有超过 50 ms 的任务。P95 样本量较小，适合定位回退；这些数字不代表所有文档或设备。

## 稳定性与边界

生产浏览器覆盖原生输入、延迟受控回传、工具栏单步撤销、混合换行及仅换行样式变化的撤销、文档重置、只读替换、禁用、组合输入事件、引用分页与定位、单 Worker 共享分析、私有 Worker、StrictMode 清理、超长软换行单行、搜索、中文界面、深色和窄屏。默认 CM6 Demo 的原生编辑和图片粘贴通过。预览验证输入值保持为 13、锚点和正文 DOM 保留、打印媒体下正文仍存在。

默认切换时修复了缓存高亮的语法缺失：编译器会从渲染树移除 `const`、`computed` 等声明，并转换 HTML 节点。分析现在通过已有元数据范围恢复声明，通过活动节点恢复 HTML 标签及属性，仍屏蔽代码、注释和 fallback。Lezer 词法颜色使用旧编辑器的 CSS 变量，嵌套字符串读取外层表达式颜色。浅色、深色及自动主题均检查最深层文本的实际颜色；截图在本地 `artifacts/cm6/highlight-light.png`、`highlight-dark.png`、`highlight-auto.png`。

连续输入曾暴露作者面板在源码变化后重复设置已关闭补全状态的问题。移除无效更新后，2000 次连续输入无 React 更新深度错误，最终源码逐字匹配。最终全场景运行的 GC 后主线程堆：第 50 次 14.340 MiB，第 2000 次 15.864 MiB；源码 DOM 均为 74 个。卸载编辑器后为 14.505 MiB、源码 DOM 为 0；宿主仍保留编译状态。这组结果未测 Worker 堆，测试探针数组在 GC 前清空。另一次独立 2000 次输入测量为 12.991 → 14.244 MiB。

自动组合事件不能代替物理中文输入法验收；移动端键盘与辅助技术也需目标设备检查。当前 `value/onChange` 仍交付完整字符串，坐标索引仍随每版源码重建。超长单行、分析全量传输与预览巨型表格仍有后续优化空间。预览真正卸载式虚拟化需要独立解决跨块选择、浏览器查找、打印、锚点与交互状态恢复，本轮沿用 DOM 保留策略。

## 检查与复现

- 库 110 个测试文件、1492 项测试通过；Demo 17 个文件、260 项测试通过。
- 完整生产构建、声明生成、Demo 构建、包检查通过。旧 textarea 的 16 项浏览器检查通过。
- 离线打包消费者验证 CM6 的 NodeNext 类型和 SSR，保留零常规依赖包边界。历史开发报告中的本地原始数据和脚本改为文本路径，避免包内链接指向未打包文件。
- 依赖 textarea DOM API 的旧 Demo 脚本通过显式 URL 保留旧入口，默认 CM6 的生产检查加入发布验证。
- Claude Code 会话 `a63bec78` 在启动后返回认证 401，已停止；主代理接管实现和测试，未改变认证配置。

```sh
npm run build
npm test
npm run test --workspace=@reactive-md/demo
npm run build --workspace=@reactive-md/demo
npm run test:package
npm run test:packed
npm run test:editor-browser
npm run test:codemirror-browser
node scripts/verify-codemirror-browser.mjs --demo --memory --edits=2000
node scripts/verify-codemirror-browser.mjs --skip-performance --memory --edits=2000
```

Windows 沙箱可将本次命令的 `NPM_CONFIG_CACHE` 指向工作区 `artifacts/cm6/npm-cache` 后运行离线打包检查。原始结果保存在本地 `artifacts/cm6/browser-results.json`、`memory-results.json`、`browser.png`。产物不随 npm 包发布。
