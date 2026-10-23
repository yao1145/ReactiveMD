# 版本与兼容性

Reactive MD 目前是 0.x 预览版。本页说明包版本、语法版本、可持久化的内容、诊断契约和当前平台范围。公开 API 与样式接入见[本地模式集成](local-integration-ch.md)。

## 版本对应

| 项目 | 当前值 | 说明 |
| --- | --- | --- |
| 包版本 | `0.3.1` | 安装 `reactive-md@0.3.1` |
| 语法版本 | `local-draft-1` | `LOCAL_SYNTAX_VERSION`；当前构建只接受这一修订 |
| 组块协议 | `component-protocol-1` | 贡献与验收契约，见[组块协议](component-protocol-ch.md)；不是运行时版本选择参数 |
| 核心入口 | `reactive-md` | 编译、表达式与运行时，不加载 React |
| React 入口 | `reactive-md/react` | `LocalReactiveDocument`、`LocalDocumentView` |
| 样式入口 | `reactive-md/styles.css` | 一份全局样式表，由宿主显式引入 |

一个包版本只对应一个语法修订。升级包之前，记录应用使用的 `LOCAL_SYNTAX_VERSION`。如果文档源码来自另一个语法修订，保留旧包版本渲染，或按下面的迁移说明改写。`compileLocal(source, options?)` 不提供语法版本参数；宿主可以通过 `options.limits.maxSyntaxNodes` 调整单次编译的语法节点预算，见[本地模式集成](local-integration-ch.md)。

## 0.x 的兼容规则

- 次版本（`0.3` 到 `0.4`）可能包含破坏性变更；补丁版本只做兼容修复和安全修复。
- 0.x 阶段不承诺固定弃用周期。每项破坏性变更都会写入 [变更记录](../CHANGELOG-ch.md)，说明旧写法、新写法和迁移步骤。
- 1.0 之前，把每次升级都当成可能需要修改文档源码或宿主代码。
- 应用应固定包版本，保留原始 `.reactive.md` 源码，并在升级后用自己的文档和示例重新运行编译与渲染检查。

## 破坏性变更与迁移

作者可见的语法变化会建立新的语法修订，例如 `local-draft-2`，并提升次版本、更新 `LOCAL_SYNTAX_VERSION`。核心或 React API 的变化也会记录在变更记录中。项目不自动改写源码；升级后由作者或宿主按记录迁移。

旧版配置语法不属于 `local-draft-1`。常见替换如下：

| 旧写法 | `local-draft-1` 中的做法 |
| --- | --- |
| `:::card`、`:::row` 等 directive | `<card>`、`<grid>` 等标签 |
| YAML `state:` 声明参数 | 控件上的 `bind` 与 `initial` |
| YAML `computed:` | 正文中的 `{{ 表达式 }}` |
| `actions:`、按钮动作、`on-*` 事件 | 没有等价入口；使用组件自带的交互和面板重置 |
| `data:` 或外部接口数据 | 直接写在正文的 Markdown 表格；参数由控件声明 |
| 持久化运行状态 | 由宿主保存原始源码；文档运行时状态只在当前实例内存中 |

## 持久化什么

持久化原始 `.reactive.md` 源码。不要持久化 `LocalDocument`、`LocalNode`、`node.id`、`initialState`、`LocalSnapshot` 或运行时的参数状态：它们属于当前运行时对象，跨版本不保证结构，也不保证字段含义。`node.id` 在源码变化后会重新生成。诊断中的行号、列号和偏移量用于定位当前源码，不是稳定的持久化标识。

## 诊断契约

`Diagnostic` 包含 `code`、`message`、`severity`、`range`、`line` 和 `column`。

- `line` 和 `column` 从 1 开始；`range.start` 和 `range.end` 是当前源码字符串中的索引。
- `line`、`column` 和 `range` 可以用于程序定位和编辑器跳转。
- `code` 是字符串标识，例如 `local.type`、`expression-type`、`latex-plot-range`。在一个固定的包版本内可以按它做粗分类；0.x 不承诺跨版本稳定，次版本可能调整 code。
- `message` 是中文显示文本，可能随时改写。不要解析 message，也不要按完整文本做业务判断。
- `severity` 为 `warning` 或 `error`。结构完整的未知标签和脚注保留源码并给出降级警告，编译仍可成功；编译错误会让 `result.ok` 为 `false` 并停用预览。运行时局部错误只影响对应内容。

## 平台与运行环境

| 环境 | 当前状态 |
| --- | --- |
| Node.js 22.12+ | 开发和 Node 端消费的最低版本；22.12 与 24 均通过 CI |
| ESM | 唯一模块格式；不提供 CommonJS 入口 |
| React 19 | `reactive-md/react` 的要求；核心入口不依赖 React |
| Microsoft Edge（Chromium 内核） | 已完成本地浏览器验证 |
| Playwright Chromium | Linux CI 浏览器检查通过 |
| Firefox、Safari/WebKit | 未验证，不作支持声明 |
| SSR | `react-dom/server` 静态渲染由发布前的 packed 检查覆盖；水合未验证，使用前需自行检查 |

Node 端消费指在 Node 中导入 `reactive-md`、调用 `compileLocal` 和 `createLocalRuntime`，不需要 DOM。React 渲染要求浏览器环境或宿主自行处理服务端输出。

语言范围见[语法规范](local-interaction-syntax-ch.md)，安全边界与宿主责任见[安全策略](../SECURITY-ch.md)。
