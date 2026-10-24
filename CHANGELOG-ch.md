# 变更记录

本文件记录用户可见变更。项目处于 0.x 预览阶段，版本与迁移规则见[版本与兼容性](docs/compatibility-ch.md)。

## 0.4.0 开发预览（未发布，local-draft-2）

当前工作区是尚未发布的开发预览，从 `0.3.1` / `local-draft-1` 升级。完整升级清单见[0.4.0 开发预览与迁移](docs/release-0.4.0-ch.md)。

### 新增

- 新增源码高亮、补全、绑定导航、重命名和格式化 API，以及对应的 Playground 作者工具。
- 新增按依赖更新的渲染优化，浏览器等价检查覆盖参数更新、重置、可视化选择和语言切换。
- 新增 `npm run verify:release` 与对应 CI 分片，覆盖组合文档和仓库外的真实 tarball 消费；保留经过验证的安装包、SHA256 与 npm integrity 记录。
- 新增跨字段 `<validation>` 规则、关联的可访问提示及 `runtime.validate()`；`alert` 和 `badge` 支持按条件选择现有 `tone` 枚举。
- 新增同类型字符串/数字数组字面量、数组索引、`sum`、`average`、`minOf`、`maxOf`，以及带稳定行键和数量预算的 `<data-table>`/`<column>`。见[条件、校验与本地集合](docs/constraints-collections-ch.md)。`LocalValueKind` 增加 `number-array`，新增聚合函数名成为保留字。

- 新增不可见、只读的 `<computed>` 与 `<const>` 声明，支持依赖排序、类型推断、循环检测和各运行时独立的计算缓存。正文、条件、公式与图表可共享中间结果。
- 新增数字、百分比、科学计数法与货币格式化，常用字符串函数及 UTC 日期比较、日期差。默认值、舍入、空值和地区规则见[复用计算与格式化数值](docs/computations-formatting-ch.md)。新函数名成为保留字；使用本开发版本前需重命名同名旧绑定。

- 新增可选的 `<!-- reactive-md: local-draft-2 -->` 源码修订指令。显式旧修订、未知、格式错误、重复或位置错误的声明会以 `local.version.*` 诊断拒绝，不创建运行时；无指令源码保持当前修订行为。早于该指令的读者会忽略它。见[源码修订与迁移](docs/source-versioning-ch.md)。
- 新增 `inspectLocalSourceVersion`、`checkLocalUpgrade`、`migrateLocalSource`，以及带 `--from`、`--check`、`--json`、`-o/--output`、`--accept-semantic-changes` 和 `--locale` 的 `reactive-md migrate`。迁移只改指令，保留正文原始字节、BOM 和 CRLF，幂等；阻止保留绑定、新增可识别标签、编译错误和文本长度语义变化，且从不改写状态文件。

- 增加统一的中英文诊断模板，同一 minor 系列内保持现有诊断码含义稳定。Playground、React 渲染器与 `lint --locale en|zh` 按语言显示诊断，保留机器字段。
- 文本控件长度约束改为按 Unicode 码点计数，与字符串 `len()` 一致；源码定位和资源预算继续使用 UTF-16。原先因 emoji 占用两个代码单元而被拒绝的值，现在可满足对应码点上限。详见[诊断与计数规则](docs/diagnostics-counting-ch.md)。

- 增加文档开头的 `<theme name="…">` 声明、宿主主题登记和 `reactive-md-theme-1` 主题协议。两个 React 组件支持独立深浅模式和系统偏好；现有外观保留为 `default`。见[主题协议](docs/theme-protocol-ch.md)。
- 新增可分享单文件 HTML 导出：`reactive-md build`/`lint` CLI、交互与静态模式、静态首屏水合、可打印的当前值、版本化 `reactive-md-state/v1` 状态文件、经过校验的本地位图内联、standalone `ReactiveMD.mount`/`mountAll` IIFE 和 `<reactive-md-doc>`。见[可分享文档与静态导出](docs/shareable-export-ch.md)。
- 新增宿主状态 API：`LocalRuntime` 可按名称访问公开参数（`parameterNames`、`getParameter`、`getParameters`、`setParameter`、`setParameters`），并提供 `exportLocalState`/`importLocalState` 读写 `reactive-md-state/v1` 状态文件。写入先统一校验再一次性提交，失败时不改变状态。
- 新增源码变更时的参数保留工具：`planLocalStateRetention` 和 `applyLocalStateRetention` 仅保留类型与初始定义未变、绑定可安全保留的公开参数；匿名 `@` 绑定、计时器和位置清单会被丢弃，被拒绝的值会记录原因。
- 新增可选的后台编译适配器：`LocalCompileScheduler` 提供 150 ms 防抖、一个进行中任务加最新源码、永久回退到主线程 `compileLocal`，并新增 `startLocalCompileWorker`；回退失败使用 `local.worker.compile` 诊断码。

### local-draft-2 组块

- 新增文档跳转与锚点、正文颜色、多选、区间与二维坐标输入、练习题及分步阅读。
- 清单勾选后划线，新增组件主色及表格/图表稳定标识的共享选择。
- runtime.get/set 支持可选槽位，新增原子 setMany；新增槽位绑定为独占。
- 新增双语功能馆及编辑器插入模板。见[迁移说明](docs/local-components-v2-ch.md)。本版本尚未发布。

- Playground 新增中英文切换，界面、示例、指南和内置控件文案会同步切换，选择保存在浏览器中。
- `LocalDocumentView` 和 `LocalReactiveDocument` 支持 `locale: 'en' | 'zh'`（默认 `'en'`），用于内置 UI 文案。显示用编译与运行时诊断通过中英文共享目录本地化，回调仍收到带稳定机器字段的结构化诊断。
- `timeline` 同时接受英文列 `Task`、`Start`、`Duration`（可选 `Notes`）和中文列 `事项`、`开始`、`时长`（可选 `说明`）。

## 0.3.1（2026-10-23）

兼容更新，继续采用 `local-draft-1` 语法，无需迁移现有文档。

- Playground 新增 Markdown 编辑工具栏和 25 个原生组件插入模板，支持格式状态、撤销/重做、搜索、键盘导航及手机紧凑布局。
- 大文档采用后台编译、输入合并和延迟存储；支持通过 `limits.maxSyntaxNodes` 配置语法节点预算。
- 统一文档主题、组块标题与正文层级，改进图解长标签换行、连线说明和回退样式。
- 增加 `component-protocol-1` 组块贡献协议、开发提案模板、JSON Schema 和代表性验收用例，提供 `npm run test:components`；本次协议不改变 `local-draft-1` 语法或运行时 API。
- Markdown 标题生成实例独立的锚点，文档内目录链接支持中文、格式化标题和重复标题；交互更新后锚点保持稳定。
- Playground 默认保留当前编辑会话中兼容的具名参数，支持关闭保留；临时编译错误修复后恢复试算值，重新运行、恢复示例、切换示例和导入文档时重置。
- 结构完整的未知标签保留为源码并给出警告，其他正文和交互继续工作；降级区域内的标签与插值不执行。
- 脚注引用与定义保留原文，并给出尚未支持脚注排版的诊断。

## 0.3.0（2026-10-22）

首个公开预览版，语法修订为 `local-draft-1`。安装：`npm install reactive-md@0.3.0`。集成步骤见 [README](README-ch.md)。

### 新增

- `local-draft-1` 本地交互语法：Markdown 正文、33 个组件名、`bind` 参数和 `{{ 表达式 }}` 插值。
- 参数控件、面板重置、条件内容、标签页、折叠、提示、清单、进度和计时器。
- 增强表格、五类统计图、LaTeX 函数曲线、时间轴和交互图解。
- 核心入口 `reactive-md`：`compileLocal`、`createLocalRuntime`、`compileExpression`、`compileLatex`、`samplePlot` 和 `LOCAL_SYNTAX_VERSION`。
- React 入口 `reactive-md/react`：`LocalReactiveDocument`、`LocalDocumentView`，支持宿主 URL 策略。
- 全局样式入口 `reactive-md/styles.css`，包含浅色与 `data-theme="dark"` 主题变量。
- 中文新用户指南、完整语法规范、集成说明、版本与兼容性说明，以及 12 份本地示例（其中 1 份是故意报错的诊断示例）。
- 文档、示例、打包入口、浏览器交互和资源上限的检查；仓库外离线安装、纯核心与 React 的严格类型检查、静态 SSR 验证。
- 可复制的独立 Node/React 接入示例、机器可读的语言验收数据、性能基准和第三方许可证清单。
- Node 22.12/24 与 Chromium 的 CI 检查通过；私密漏洞报告已启用。

### 兼容性

- 首次预览，没有已发布的 npm 版本可供升级。
- 旧版 directive、YAML `state`/`data`/`computed`/`actions` 和事件属性不属于 `local-draft-1`；迁移方式见[版本与兼容性](docs/compatibility-ch.md)。
- 持久化原始 `.reactive.md` 源码，不持久化 `LocalDocument`、节点 ID 或运行时状态。
- 诊断的 `line`、`column` 和 `range` 可用于程序定位；`code` 在 0.x 中不承诺跨版本稳定；`message` 是显示文本，不保证稳定。

### 已知限制

- 只提供 ESM；React 入口要求 React 19；核心入口不依赖 React。
- Node.js 22.12+ 是开发和 Node 端消费的最低版本。
- Microsoft Edge（Chromium 内核）已完成本地浏览器验证；Firefox、Safari/WebKit 和 SSR 水合未验证。
- 不提供状态持久化、插件系统、任意 HTML、网络服务、Vue 支持、React 18 支持或 CommonJS 入口。

### 安全

- 表达式和 LaTeX 使用封闭求值器，不执行脚本或任意 HTML。
- 图片默认不加载；链接和图片先经过协议检查，宿主可用 `urlPolicy` 收紧或放行。
- 文档、值、诊断和绘图计算都有资源上限。安全边界与宿主责任见[安全策略](SECURITY-ch.md)。
