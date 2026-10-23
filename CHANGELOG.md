# 变更记录

本文件记录用户可见变更。项目处于 0.x 预览阶段，版本与迁移规则见[版本与兼容性](docs/compatibility.md)。

## 未发布

- 增加 `component-protocol-1` 组块贡献协议、开发提案模板、JSON Schema 和代表性验收用例，提供 `npm run test:components`；本次协议不改变 `local-draft-1` 语法或运行时 API。
- Markdown 标题生成实例独立的锚点，文档内目录链接支持中文、格式化标题和重复标题；交互更新后锚点保持稳定。
- Playground 默认保留当前编辑会话中兼容的具名参数，支持关闭保留；临时编译错误修复后恢复试算值，重新运行、恢复示例、切换示例和导入文档时重置。
- 结构完整的未知标签保留为源码并给出警告，其他正文和交互继续工作；降级区域内的标签与插值不执行。
- 脚注引用与定义保留原文，并给出尚未支持脚注排版的诊断。

## 0.3.0（2026-10-22）

首个公开预览版，语法修订为 `local-draft-1`。安装：`npm install reactive-md@0.3.0`。集成步骤见 [README](README.md)。

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
- 旧版 directive、YAML `state`/`data`/`computed`/`actions` 和事件属性不属于 `local-draft-1`；迁移方式见[版本与兼容性](docs/compatibility.md)。
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
- 文档、值、诊断和绘图计算都有资源上限。安全边界与宿主责任见[安全策略](SECURITY.md)。
