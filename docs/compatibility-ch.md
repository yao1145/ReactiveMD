# 版本与兼容性

Reactive MD 目前是 0.x 预览版。本页说明包版本、语法版本、可持久化的内容、诊断契约和当前平台范围。显式修订声明、迁移 API 与 `reactive-md migrate` 见[源码修订与迁移](source-versioning-ch.md)，公开 API 与样式接入见[本地模式集成](local-integration-ch.md)，当前预览见[0.5.0 发布说明](release-0.5.0-ch.md)，该 minor 系列见[0.4.0 发布与迁移](release-0.4.0-ch.md)。

## 版本对应

| 项目 | 当前值 | 说明 |
| --- | --- | --- |
| 包版本 | `0.5.1` | 0.x 预览版；0.5.1 面向 `next`，`latest` 仍为 `0.4.0` |
| 分发标签 | `latest` → `0.4.0`；`next` → `0.5.1`（预览目标） | 默认安装使用 `latest` |
| 语法版本 | `local-draft-2` | `LOCAL_SYNTAX_VERSION`；当前构建只接受这一修订 |
| 源码修订指令 | 可选 `<!-- reactive-md: local-draft-2 -->` | 文档前导区中的一行；无指令源码继续按当前修订解析 |
| 组块协议 | `component-protocol-2` | 贡献与验收契约，见[组块协议](component-protocol-ch.md)；不是运行时版本选择参数 |
| 核心入口 | `reactive-md` | 编译、表达式与运行时，不加载 React |
| React 入口 | `reactive-md/react` | `LocalReactiveDocument`、`LocalDocumentView` |
| 编辑器入口 | `reactive-md/editor` | `ReactiveMarkdownEditor` 及其类型；需要 React 19 |
| 渲染器样式入口 | `reactive-md/styles.css` | 文档与组块样式，由宿主显式引入 |
| 编辑器样式入口 | `reactive-md/editor/styles.css` | 独立编辑器样式，作用域限定在编辑器根节点 |

一个包版本只对应一个语法修订。升级包之前，记录应用使用的 `LOCAL_SYNTAX_VERSION`。如果文档源码来自另一个语法修订，保留旧包版本渲染，或按下面的迁移说明改写。`compileLocal(source, options?)` 不提供语法版本参数；宿主可以通过 `options.limits.maxSyntaxNodes` 调整单次编译的语法节点预算，见[本地模式集成](local-integration-ch.md)。

## 显式源码修订

源码可以在前导区用一行 `<!-- reactive-md: local-draft-2 -->` 声明修订。无指令源码按当前修订读取，不新增警告。显式 `local-draft-1` 或未知修订会以 `local.version.*` 诊断拒绝，不创建运行时；声明旧修订不会选择旧解析器。格式错误、重复和位置错误的指令同样被拒绝。

在这一指令出现之前构建的读者（包括 `0.3.1`）会把它当作普通注释，不执行这项检查。依赖检查前请先迁移旧文档。`inspectLocalSourceVersion`、`checkLocalUpgrade` 和 `migrateLocalSource` 在编译器之外读取声明，`reactive-md migrate` 对单份源码执行元数据迁移。见[源码修订与迁移](source-versioning-ch.md)。

## 0.x 的兼容规则

- 次版本（`0.3` 到 `0.4`）可能包含破坏性变更；补丁版本只做兼容修复和安全修复。
- 0.x 阶段不承诺固定弃用周期。每项破坏性变更都会写入 [变更记录](../CHANGELOG-ch.md)，说明旧写法、新写法和迁移步骤。
- 1.0 之前，把每次升级都当成可能需要修改文档源码或宿主代码。
- 应用应固定包版本，保留原始 `.reactive.md` 源码，并在升级后用自己的文档和示例重新运行编译与渲染检查。

## 核心语义兼容范围

同一语法修订内，兼容的包更新保留已接受源码的含义：

- 控件的公开值类型、初值规则、同名绑定约束和校验规则保持一致。隐藏控件仍会初始化，再次显示不会自动重置其值。
- 表达式保持严格操作数类型、运算符优先级、短路求值和有限数值规则。局部计算失败不替换有效输入，也不阻止无关内容更新。
- 非法参数写入保留上一次有效状态；多值写入原子提交。面板重置自己的控件与组件状态，依赖这些值的内容同步更新。
- 正文、公式和可视化读取相同的参数值；代码与惰性降级区域保持原文。源码位置仍从 1 开始，按 UTF-16 单元和半开区间定位。
- 渲染内容、控件标签和交互行为属于语义输出；生成的节点/DOM ID、内部 `@` 键、AST 布局、缓存、像素排版和诊断措辞不属于稳定的源码契约。

从 `local-draft-1` 升级到 `local-draft-2` 时，这一承诺适用于通过升级检查的共同语言子集。新增保留名和新激活标签需要人工修改源码；文本长度计数是必须显式接受的兼容例外，清单完成样式属于视觉例外。超出这些已记录例外的语义变化需要新的语法修订与迁移说明。

[历史语料](../examples/conformance/history/v0.3.1/provenance.json) 保留实际 `v0.3.1` 源码、来源提交和 SHA256。回归测试检查原一致性预期、公开值、非法写入拒绝、初始化、重置和迁移渲染；比较中明确排除内部 ID。

## 破坏性变更与迁移

`0.5.0` 新增 `reactive-md/editor` 入口及其独立样式表；`0.5.1` 新增编辑器视图、主题配色和 HTML 兼容。`local-draft-2`、`component-protocol-1` 和 `reactive-md-theme-1` 保持不变。现有 `reactive-md`、`reactive-md/react` 和 `reactive-md/styles.css` 导入继续有效，为 0.4.x 编写的文档无需迁移。编辑器需要 React 19；历史与渲染边界见[编辑器指南](editor-ch.md)。

`0.4.0` 新增[条件、校验与本地集合](constraints-collections-ch.md)：`LocalRuntime.validate()`、可序列化的 `LocalValidation` 规则、数字数组及生成表格。自行实现运行时适配器的宿主需补充 `validate()`，值类型穷举需加入 `number-array`；与 `sum`、`average`、`minOf`、`maxOf` 同名的旧绑定应重命名。

`0.4.0` 新增[命名计算与格式化函数](computations-formatting-ch.md)。`computed`/`const` 使用现有本地标签形式；新函数名成为保留字，使用本版本前需重命名冲突的输入绑定并同步修改引用。`document.bindings` 和 `initialState` 继续只包含可写控件，快照同时提供成功求值的计算结果。

`0.4.0` 建立 `local-draft-2`。使用受支持 `local-draft-1` 写法的无指令源码继续有效；显式 `local-draft-1` 声明在迁移前会被拒绝。构建新增识别 15 个标签名：十个 `local-draft-2` 组块，以及 `computed`、`const`、`validation`、`data-table`、`column`。以前作为未知标签或普通文字显示的内容现在会解析为组块或声明；字面示例应移入行内代码或代码围栏。开头的 `<theme>` 声明是文档元数据，不计入组块。完整的重命名与升级清单见[0.4.0 发布与迁移](release-0.4.0-ch.md)。

作者可见的语法变化会建立新的语法修订，例如本次的 `local-draft-2`，并提升次版本、更新 `LOCAL_SYNTAX_VERSION`。核心或 React API 的变化也会记录在变更记录中。项目不自动改写文档正文。`reactive-md migrate` 迁移单份源码的元数据声明，并阻止正文级冲突；升级后由作者或宿主按记录完成其余源码修改。

旧版配置语法不属于 `local-draft-2`。常见替换如下：

| 旧写法 | `local-draft-2` 中的做法 |
| --- | --- |
| `:::card`、`:::row` 等 directive | `<card>`、`<grid>` 等标签 |
| YAML `state:` 声明参数 | 控件上的 `bind` 与 `initial` |
| YAML `computed:` | 正文中的 `{{ 表达式 }}` |
| `actions:`、按钮动作、`on-*` 事件 | 没有等价入口；使用组件自带的交互和面板重置 |
| `data:` 或外部接口数据 | 直接写在正文的 Markdown 表格；参数由控件声明 |
| 持久化运行状态 | 宿主保存原始源码；公开参数还可以导出为经过校验的 `reactive-md-state/v1` 文件。该文件绑定源码摘要、语法修订和完整公开参数集合，不是文档格式。 |

## 持久化什么

持久化原始 `.reactive.md` 源码。`reactive-md-state/v1` 文件可以为同一源码和语法修订保存公开参数值；摘要、修订或参数集合不一致时会拒绝整个文件。迁移会改变源码摘要，迁移后应重新导出状态文件；迁移不会改写状态文件。不要持久化 `LocalDocument`、`LocalNode`、`node.id`、`initialState`、`LocalSnapshot` 或内部 `@` 运行时键：它们属于当前运行时对象，跨版本不保证结构，也不保证字段含义。`node.id` 在源码变化后会重新生成。诊断中的行号、列号和偏移量用于定位当前源码，不是稳定的持久化标识。

## 诊断契约

`Diagnostic` 包含 `code`、`message`、`severity`、`range`、`line` 和 `column`。

- `line` 和 `column` 从 1 开始；列和 `range` 均按原始源码的 UTF-16 代码单元计数，范围为半开区间。
- `line`、`column` 和 `range` 可以用于程序定位和编辑器跳转。
- `code` 是字符串标识，例如 `local.type`、`expression-type`、`latex-plot-range`。同一 0.x minor 系列内，现有诊断码的含义保持稳定；可以新增码，删除、改名或改变含义须在新 minor 版本中说明迁移。
- `message` 是默认英文显示文本，使用 `formatLocalDiagnostic(diagnostic, 'zh')` 可取得中文。文案可以改进；不要解析 message 或按完整文本做业务判断。语言切换保留机器字段。
- `severity` 为 `warning` 或 `error`。结构完整的未知标签保留源码并给出降级警告，编译仍可成功；脚注正常排版。编译错误会让 `result.ok` 为 `false` 并停用预览。运行时局部错误只影响对应内容。

完整规则和资源单位见[诊断与计数规则](diagnostics-counting-ch.md)。

## 平台与运行环境

| 环境 | 当前状态 |
| --- | --- |
| Node.js 22.12+ | 开发和 Node 端消费的最低版本；CI 目标为 22.12 与 24 |
| ESM | 唯一模块格式；不提供 CommonJS 入口 |
| React 19 | `reactive-md/react` 和 `reactive-md/editor` 的要求；核心入口不依赖 React |
| Microsoft Edge（Chromium 内核） | 本地浏览器验证使用 Edge |
| Playwright Chromium | Linux CI 浏览器目标 |
| Firefox、Safari/WebKit | 未验证，不作支持声明 |
| 可分享状态格式 | `reactive-md-state/v1`：公开参数、语法版本与源码摘要；见[可分享文档](shareable-export-ch.md) |
| 单文件 HTML 格式 | `reactive-md-html/v1`：交互或静态导出；仅交互模式内嵌独立运行时 |
| SSR | `react-dom/server` 静态渲染由 packed 检查覆盖。编辑器入口没有顶层 DOM 访问，可在服务端导入和渲染；编辑交互在客户端运行。单文件导出的静态首屏水合已在 Playwright Chromium/Edge 验证；通用 SSR 水合未验证，使用前需自行检查 |

Node 端消费指在 Node 中导入 `reactive-md`、调用 `compileLocal` 和 `createLocalRuntime`，不需要 DOM。React 渲染要求浏览器环境或宿主自行处理服务端输出。

语言范围见[语法规范](local-interaction-syntax-ch.md)，安全边界与宿主责任见[安全策略](../SECURITY-ch.md)。


新增组块、颜色、槽位状态与迁移规则见[local-draft-2 扩展说明](local-components-v2-ch.md)，升级清单见[0.4.0 发布与迁移](release-0.4.0-ch.md)。0.5.1 预览版面向 `next`，`latest` 仍为 `0.4.0`。
