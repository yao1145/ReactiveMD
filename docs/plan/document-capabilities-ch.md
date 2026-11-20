# ReactiveMD 文档能力开关设计与并行实施计划

## 交付契约

同一份源文档始终由 RMD 解析。Markdown、已注册的组件、表达式、绑定和组件状态走现有编译与运行链路。三个开关分别授予文档 CSS、作者 JavaScript 和扩展 HTML 片段能力。

| 公共选项 | 缺省 | 开启时生效的内容 | 关闭时的表现 |
| --- | --- | --- | --- |
| `enableCss` | `true` | 文首 `<css>`、可见组件根的 `css="…"`、已获准 HTML 片段中的作者样式 | 定点提示并跳过作者样式。主题、控件和绑定照常工作。 |
| `enableJavaScript` | `false` | 交互视图中的 `<javascript>`，以及扩展片段中经独立净化和隔离的作者脚本 | 脚本声明处给出提示。RMD 负责全部默认动作。 |
| `enableExtendedHtml` | `false` | 已识别且通过安全策略的扩展 HTML 子树 | 只转义对应片段并给出诊断。前后内容继续解析。 |

宿主和 Playground 持有开关。源文档声明内容，授权随当前挂载会话生效。首版先交付绑定读写，再在同一功能分支增加有稳定标识的动作接管。静态 HTML、SSR 初始快照和 PDF 使用调用方提供的 RMD 状态基线。作者脚本只在进入交互视图并完成状态恢复后执行。

### 当前耦合与迁移顺序

1. 编译器以 `htmlActive` 把整篇源码交给 HTML 净化器，生成单个 `htmlDocument` 节点和空绑定。渲染器按 `document.html` 选择整页 iframe，编译失败分支也受它控制。先切断分流，保留当时的三项默认值，验证显式打开任一项仍能编译并操作绑定。 [编译入口](../../src/local/compilation/compiler-core.ts) · [文档视图](../../src/local/rendering/document/LocalDocumentViewCore.tsx) · [源文档视图](../../src/local/rendering/document/LocalReactiveDocumentCore.tsx) · [旧契约测试](../../tests/html-mode-contract.test.tsx)
2. 同一阶段移除其他 `htmlActive` 消费端的语言分流。组件目录持续可用，补全、格式化和重命名继续识别 RMD。增量编译由实际节点与元数据的更新能力决定。静态、交互和 standalone 使用统一的编译结果及 RMD 状态。 [组件目录](../../src/authoring/catalog.ts) · [源码工具](../../src/local/source/authoring.ts) · [增量编译](../../src/local/compilation/session/incremental.ts) · [导出](../../src/shareable.ts) · [standalone 准备](../../src/standalone/prepare.ts)
3. 接入三项能力并验证新旧数据路径。引擎与 Demo 在集成候选中切换 CSS 缺省值，同时保留显式 `false`。重新执行八组合、默认值和关停回归，再包装最终候选。 [选项归一化](../../src/local/configuration/options-core.ts) · [可移植选项](../../src/local/configuration/portable-options.ts)

## 编译、传输与兼容

### 解析与诊断

- 以 RMD 词法边界识别 `<css>…</css>`、`<javascript>…</javascript>`。识别顺序尊重代码围栏、行内代码、转义与现有特殊区域。有效块体按源码切片，保留原始换行、`>`、花括号及字符偏移。使用对应结束标签定界。编辑中的未闭合声明在开标签定位，回退到明确的恢复边界。该块保持惰性，恢复边界后的健康节点继续编译。引号、缩进和 CRLF 都写入解析回归用例。
- 保留 `<!-- reactive-md: local-draft-3 -->` 修订指令与 `<theme>` 的现有文首规则。文档级 CSS 与这些元数据共享前导区，空行和现有可忽略注释可穿插。计算首个正文节点时跳过合法元数据。`<javascript>` 可位于顶层正文之间，其声明本身属于正文区，放在它后面的 CSS 按迟置诊断处理。嵌套 CSS 或脚本声明给出放置提示。
- 在组件通用逻辑识别 `css`，按声明文本处理。组件注册表或组件渲染契约提供可见根能力的信息。`computed`、`const` 等无根实例在属性范围报告提示。动作阶段同样保留 `action-id` 的属性值范围。
- RMD 已注册标签优先，其次为现有基础 HTML 混排，随后识别扩展 HTML 子树。按 HTML 的配对、空元素和原文元素规则确定子树范围。配对完毕立即恢复 RMD。缺失边界时优先继续保留可确定的兄弟节点，诊断包含回退范围。仍由现有的源码长度、节点数、深度和解析工作量限制约束。
- 能力关闭、位置错误或策略过滤用局部诊断，健康节点仍产出成功文档。真正的 RMD 语法错误沿用现有 strict 与容错约定。诊断至少包含稳定代码、原始范围和双语消息。关闭开关的普通 Markdown 无需提示。运行时错误定位到对应脚本块或动作注册处，绑定校验可附带原绑定位置。

[区域解析器](../../src/local/parsing/parser-region.ts) · [组件标签扫描](../../src/local/parsing/parser-tags.ts) · [诊断消息](../../src/local/configuration/diagnostic-messages.ts)

### 首个实现提交要定下的共享结构

以下名称供分工共用。共享契约负责人在首个实现提交中发布字段、节点判别和最小夹具，后续修改由其集中合并。

| 所在位置 | 建议结构与职责 |
| --- | --- |
| `LocalCompileOptions` | 沿用原有三个字段名。归一化后的开关参与编译、Worker 和编辑器缓存键。缺省与同值显式选项等价，`false` 与缺省开启的 CSS 得到不同键。 |
| `LocalDocument.capabilities?` | 普通数据，承载生效策略、按源码排列的 CSS/JS 块及原文范围、按节点 ID 索引的组件声明和公开动作目标。无相应声明的旧对象照常载入。 |
| 扩展 HTML 节点 | 建议 `extendedHtml`，由 `range`、原始源码片段和可序列化的净化数据组成。关闭开关或片段不获准时复用现有 `fallback` 节点。宿主的来源授权由视图评估。 |
| 组件渲染与动作接点 | 组件声明可见根和受支持的动作名。根元素样式、动作登记与派发分别进入已有渲染上下文和绑定运行时。文档脚本会话留在交互适配层。 |
| 旧 `LocalDocument.html` | 专用于读取带旧 `htmlDocument` 节点的既有成果。适配器校验旧节点结构并按当前宿主授权隔离渲染。脚本缺省关闭，静态分支剥离脚本。新编译只写混合文档结构。 |

- 编译器仅产生可克隆数据。Document view 持有运行态资源与 DOM，编译 Worker 只编译和分析。保持 `reactive-md/compiler` 的现有隔离边界，标准装配按现有能力注册方式提供 HTML 净化。基础编译器缺少片段服务时，诊断只影响相关片段。
- 盘点 `compiled-data`、`flat-compiled-data`、`shared-data`、`compile-patch` 和 Worker 选项快照。保证全量结果、共享数据解码、增量补丁与同源全量编译等价。首阶段对暂未支持补丁的声明或片段编辑请求全量编译。普通文档和已能安全更新的区域继续用增量路径。区分线协议兼容性与语法版本，按现有协议规则处理旧消费者。
- 编译选项发生变化时，Worker 回包按源码和归一化选项键核对。文档实例、脚本版本和宿主权限用于渲染端的生命周期检查。脚本存活与普通编译回包及 React 重绘分别管理。

[编译契约](../../src/local/types.ts) · [编译服务](../../src/local/compilation/compiler-services.ts) · [传输目录](../../src/local/transport) · [编译器边界测试](../../tests/compiler-entry.test.ts)

## CSS

### 文档样式与作用域

文首可有多个 `<css>` 块。按源码顺序构造一个作者样式层。正文开始后的 `<css>` 在其声明范围提示移到文首，仅跳过该块。语法分析使用 CSS 解析器，保留原始源码用于诊断和编辑器定位。处理无效规则时按样式表语法恢复，已接受的规则继续应用。

每次挂载分配可安全序列化的作用域标识。以文档根为上界、嵌套文档根为下界生成 `@scope` 规则。SSR 与 hydration 共用该标识，并覆盖同页多个独立 React 根、嵌套挂载和同一源码的两个实例。浏览器验收以实际命中元素及计算样式为准。CSS 首个技术验证同时确认目标浏览器及 PDF 渲染器对作用域的支持，兼容处理保持同样的边界。

主题默认样式先进入层叠，文档规则随后参与层叠，组件 CSS 进入实例根的行内声明。选择器优先级、源码顺序和 `!important` 仍由 CSS 层叠决定。媒体与支持查询内部的选择器继续受文档范围约束。会向页面注册名称的规则须完成实例命名空间转换才能启用。首版对尚未支持的全局规则给出局部提示。

首版使用文内规则与声明。`@import`、外链样式表以及作者样式中的外部资源加载由策略过滤。过滤以解析后的 CSS 结构为准，并覆盖字符串形式资源、转义、嵌套函数以及自定义属性转接。基础主题资源继续使用宿主的既有注入路径。样式标签、CSS 文本和 HTML 属性进入 SSR 或导出前按各自上下文安全序列化。

### 组件根

- 共用组件渲染契约携带已解析的行内声明。内置组件将其应用到自己的可见根，静态和交互使用各自对应的根。组件的原有行内样式与作者声明用同一合并规则。`color` 等继承属性自然传给子节点。避免新增布局包装层，兼顾列表、表格、焦点和可访问性结构。
- CSS 负责人先跑通滑块的 SSR、hydration 和交互样式切换。用原生 CSS 声明语义检查自定义属性、带优先级的属性和重复声明。交互更新可通过 CSSOM 保留优先级，SSR 必须产生等价的行内声明。开启后关闭时清除作者声明并恢复控件本身的样式，检查实例沿用原绑定与焦点。
- 接口稳定后扩展至内置可见组件。可选组件和宿主组件通过同一根接点加入，缺少可见根接点时在源码属性处提示。评审分别检查首批组件的可见根、只读节点和扩展组件的兼容路径。

[组件渲染契约](../../src/react/component-api.tsx) · [节点渲染](../../src/local/rendering/document/render-nodes.tsx) · [数字滑块](../../src/components/controls/numeric-sliders.tsx)

## JavaScript

### 第一阶段绑定读写

脚本块按源码顺序初始化，每块有自己的词法作用域。已恢复的 RMD 绑定值通过显式文档 API 提供。

```html
<javascript>
const people = 10
await rmd.set("people", people)
</javascript>
```

| 脚本 API 草案 | 宿主行为 |
| --- | --- |
| `await rmd.get(name)` | 查询当前文档声明的命名绑定，返回普通数据的副本。名字缺失或未授予时返回明确的错误。 |
| `await rmd.set(name, value)` | 通过现有命名参数写入路径做类型、动态范围、只读和关联字段校验。一次有效写入走一次状态提交，控件与表达式读到同一个新快照。 |
| `await rmd.setMany(values)` | 多字段同时校验后提交。任何字段不通过时保留上一个快照。 |

读取范围包含公开的命名控件绑定以及具名 `computed`、`const` 的计算结果。后两者通过受限的已有计算快照读取。运行时逐项校验写权限，禁止写入只读值、元数据、内部绑定和宿主注入数据。控件读写复用 `getParameter` / `setParameter` / `setParameters` 对应的运行时逻辑。无效写入以结构化错误返回，宿主用原诊断模板。声明 `const people` 只在脚本词法作用域变化。脚本成功写值后，读者仍可拖动原滑块。

[命名参数与校验](../../src/local/runtime/runtime.ts) · [值校验](../../src/local/runtime/runtime-values.ts)

### 隔离、顺序与清理

- 首选在专用 Worker 中运行受限 JS 解释器。解释器仅提供标准语言能力与窄文档 API，宿主代码在 Worker 与文档端按操作类型验证请求。作为实现门槛，先用浏览器和离线导出证明 CSP、打包、初始化顺序、计算上限和可取消性。脚本不可访问宿主 DOM、网络凭据、存储或其他挂载。编译 Worker 和解释器 Worker 独立。宿主 CSP 不能运行脚本适配器时，记录源范围诊断，RMD 视图继续可用。
- 初始化顺序为创建运行时、提交源文档和外部输入、完成状态恢复、进入交互视图、启动脚本会话、串行处理块。后一块看到前一块已提交的值。块异常保留已提交的合法值，报告源范围后继续下一块。普通渲染、主题切换、用户拖动和不改变脚本的正文编辑复用会话。
- 会话绑定到文档实例和脚本版本。替换脚本、失去授权、卸载或切换文档时，先撤销旧会话的写入和动作资格，再终止资源。用版本检查拒绝迟到的读写和注册。切换过程保留已经通过校验的 RMD 状态。用 React Strict Mode、静态首屏 hydration、快速切换和过期消息验证每代只执行一次有效初始化。
- 规定有界输入、资源和执行预算。静态渲染、PDF、导出 HTML 的预渲染，以及 SSR 均不创建脚本会话。允许执行的交互导出在恢复初始或捕获状态之后遵循同一初始化规则。

### 第二阶段按动作接管

首个可接管组件采用计数器。组件声明 `increment`、`decrement`、`reset` 动作，作者通过静态唯一的 `action-id` 指向实例。

```html
<counter action-id="people-counter" bind="people" initial="2">

<javascript>
await rmd.handleAction("people-counter", "increment", async () => {
  const people = await rmd.get("people")
  await rmd.set("people", people + 2)
})
</javascript>
```

- `handleAction` 仅在当前交互会话登记。目标由 `action-id` 与组件声明的动作组成。重复或未知实例在源码处诊断，未知动作和第二个同目标处理器返回注册错误。初始化块成功后提交其动作登记，清理时按会话统一撤销。
- 计数器沿用现有可用性、只读和禁用判断，在原始事件入口集中派发。在派发瞬间有有效接管者时，当前动作只调用该处理器一次。其他动作及其他实例按原 RMD 实现。接管处理器报错时记录诊断，当前动作结束。后续派发依据届时的注册状态。观察事件采用独立的通知通道，返回值和异常都不参与动作选择。
- 编辑导致实例删除、动作契约变化或 ID 重复时，撤销相应登记。连续事件保持每次触发与处理器一一对应，按派发顺序处理同一实例的事件。首个接管验收用两个计数器、多个动作、观察回调和会话撤销，校验单次执行及绑定更新。

[计数器视图](../../src/components/controls/controls.tsx) · [视图上下文](../../src/local/rendering/document/view-render-context.tsx)

## Extended HTML

1. 保持 `<details>`、`<summary>` 等基础 HTML 的混排。即使三个开关都开启，`<input bind="name">` 仍按已注册的 RMD 标签处理。额外允许的 HTML 子树由同一个标签分类表决定。在该子树内按 HTML 解释文本和标签，边界后的 Markdown、组件和插值恢复原语义。
2. 识别语法与授予嵌入权限分开。编译器在开放时生成片段节点，保留原始范围并进行结构净化。普通扩展元素使用许可表渲染，整段包含主动内容时使用受限片段容器。隔离容器仅覆盖对应 HTML 片段。禁用时呈现源码并可跳转。启用时拦截的属性、URL 或子元素按位置报告，合规子集和文档其余内容继续渲染。
3. 首版 iframe 示例用净化的 `srcdoc` 或 `about:blank`。`data:` 内容按内联 HTML 重新解析和净化，`blob:` 仅接受宿主登记的资源。宿主可用精确 HTTPS 来源许可配置远程嵌入，缺省许可表为空。内层远程 iframe 受片段容器的 `frame-src` 和 sandbox 约束。用实际浏览器验证跳转及重定向后的来源约束。当前挂载无法施加约束时显示可定位的占位。远程来源许可属于挂载配置，单文件导出脱离原宿主时使用缺省策略。
4. 重用现有 HTML 净化器的 URL、脚本、样式和嵌套预算规则，分别传入三项策略。片段样式受 CSS 授权，片段脚本只在交互视图和独立沙箱运行。片段脚本的作用点是所属片段，RMD API 由文档级 `<javascript>` 获得。静态和 PDF 的片段保持惰性，远程嵌入在 PDF 使用占位。旧的顶层 `<style>` / `<script>` 或完整 HTML 外壳给出迁移文档，作者分别采用 `<css>`、`<javascript>` 和扩展片段。

[HTML 净化器与 CSP](../../src/local/html/html.ts) · [基础 HTML 契约测试](../../tests/html-mode-contract.test.tsx) · [净化回归](../../tests/html-sanitizer-regressions.test.ts)

## Editor、Demo 和导出

| 入口 | 实施与验收 |
| --- | --- |
| 引擎 authoring | 注册 CSS、JavaScript 声明及组件属性的插入和上下文补全。给草稿禁用提示保留跳转范围。在声明体、扩展 HTML 子树和代码示例里保护原文。组件目录、Markdown 插入和已有绑定工具在八种组合继续工作。 |
| ReactiveMD-Editor | 在 `src/authoring/source-authoring.tsx`、`src/components/native-component-picker.tsx`、`src/codemirror/ReactiveMarkdownCodeEditor.tsx` 和分析 Worker 验证公共引擎入口。补全和诊断使用引擎结果，保留源坐标、撤销和光标位置。覆盖独立分析 Worker 与 Demo 提供的共享分析两路。 |
| ReactiveMD-Demo | `src/settings/html-options.ts` 保留显式三项 `false`，缺省才使用 CSS 开、其余关。`App.tsx` 的载入、示例切换和重置继续按当前文档管理授权。同步设置页、开发者工具、导出对话框及双语文案，清理整篇 HTML 模式的标签和条件。初始值与当前值导出选项继续按文档状态提供。 |
| Demo 预览 | `src/compilation/use-local-compilation.ts`、`preview-state.ts` 与 `src/preview/local-preview.tsx` 共同验证快速编辑、过期 Worker 回包和切换授权。关停须同步撤销旧会话，即使新编译结果尚未返回。脚本源码发生变化并等待编译时，旧预览可继续展示 RMD 快照，旧脚本暂停接收动作与写入。确认脚本未变的正文编辑继续沿用会话。以现有状态持有者恢复可写绑定，反复切换后滑块值保持。 |
| 交互 HTML | `shareable.ts`、`standalone/prepare.ts` 与挂载入口使用混合文档、可移植选项和状态基线。之后启动获准脚本。新导出显式携带三项归一化开关，CSS 关闭可往返保存。检查旧导出包自带运行时的读取效果，当前运行时读到旧载荷且缺少开关字段时按旧缺省解释。宿主嵌入配置和本地授权对象留在原挂载环境。 |
| 静态 HTML、SSR、PDF | `src/export/render-markup.ts`、`src/shareable.ts` 和 `src/pdf.ts` 从指定状态生成内容，保留适用的样式和绑定导出值。导出边界复核片段及 CSP，即使交互编译开启了 JS，静态产物也只含惰性片段。SSR hydration 后才允许交互脚本初始化。 |

同一个编译选项键负责跨入口一致性。实际运行许可还由当前挂载会话校验。旧导出中的缺省值兼容只属于载荷解码，公开编译 API 的缺省 CSS 仍为开启。

## 并行分工与合并顺序

主协调者维护集成分支和本表。每个代理用所属仓库的独立分支或 worktree。先登记负责的目录和测试文件，再开始编辑。共享文件由指定负责人合入接线。需要改接口的代理提交可应用的小补丁或类型提议，并附调用点与测试结果。

| 工作包 | 写入范围 | 开始条件与交付 |
| --- | --- | --- |
| A 编译和共享契约 | 引擎 `src/local/parsing`、`compilation`、`configuration`、`transport`、`types.ts`，公共编译 entry 与 authoring | 先交付去分流、声明范围、节点和选项契约、Worker 字段、混合文档夹具。此阶段保留旧的开关缺省值。完成后 B、C、D、E 可基于同一接口并行。 |
| B CSS 与组件样式根 | 引擎 CSS 实现目录、组件渲染根与组件样式用例 | 独立完成作用域、资源过滤、主题层叠、实例行内声明和 SSR 样式，提交共享渲染接线需求。CSS 默认值由 A 在集成阶段改。 |
| C JS 运行时 | 引擎 `src/local/runtime`、脚本会话及其测试 | 先完成隔离和绑定 API，再实现动作登记与计数器派发。共享组件文件仅提交所需接线，由集成负责人和 B 合并。 |
| D 扩展片段 | 引擎 `src/local/html`、片段渲染适配器与净化测试 | 完成分类表、净化、宿主来源策略和片段渲染。向 A 提供标签分类和片段数据约定，向 E 提供静态惰性检查入口。 |
| E React 与导出集成 | 引擎 `LocalDocumentViewCore`、`LocalReactiveDocumentCore`、共享渲染上下文、`shareable`、`standalone`、`export`、`pdf` 及其集成测试 | 与 A 对齐旧数据读取，先对接混合 RMD 路径及状态，再集中接入 B/C/D 的渲染和生命周期挂钩。同步引擎中英公共 API、语法与 HTML 兼容文档。 |
| F Editor | ReactiveMD-Editor 的编辑分析、菜单、诊断和测试 | A 后先编写夹具和验证路径，取得稳定引擎候选后跑真实 Worker。由 F 独自更新 Editor 的依赖路径、peer 兼容范围、锁文件和说明。 |
| G Demo | ReactiveMD-Demo 的设置、预览、导出界面、示例和浏览器脚本 | A 后完成显式 `false`、交互设置和测试编写，取得两份配套候选后完成端到端验证。由 G 独自更新 Demo 的 vendor、依赖和锁文件。 |

A 持有共享编译类型和诊断注册表，E 持有共享 React 视图与 `component-api.tsx`。E 汇入 C 对计数器事件入口的变更和 B 对计数器可见根的变更。每个工作包独立维护自己的测试，八组合和唯一验收夹具由 A 维护，E 与 G 对照相同源码及预期。各代理交付基准提交、更新后的接口、提交哈希、实测命令与待合并项。

候选包交接按引擎、Editor、Demo 顺序进行。B、C、D、E 合入并通过引擎验证后，A 切换 CSS 缺省值并重跑矩阵。引擎候选通过 `npm pack` 生成，Editor 使用同一引擎 tarball 重建 Worker，再向 Demo 交付 Editor 候选。各包在 `vendor/` 使用带内容哈希的文件名，安装生成 lockfile integrity。Demo 验收用的引擎字节必须与 Editor 构建 Worker 时使用的一致。每个交接记录仓库提交、包版本、SHA256、锁文件 integrity 和验证结果。使用各仓库现有候选包流程和公共包入口。

若候选集成失败，先定位引擎字节、Worker 或宿主策略差异。消费者按完整候选组恢复依赖路径及锁文件，再从对应工作包修复并重打内容寻址包。分支回退以对应提交为单位。最终交付范围包含本地提交与候选验证，npm 发布和生产部署另行办理。

## 验收

### 统一混合文档

用下列源码运行编译器契约、编辑器、预览 Worker、交互导出、静态 HTML 和 PDF。用合法且无需网络的 iframe 内容，保证失败可归因到具体开关。

```html
<css>
h2 { color: #24549a; }
</css>

## 人数

<slider bind="people" label="人数" initial="2" min="1" max="20"
        css="max-width: 24rem; margin-block: 1rem">

当前人数：{{ people }}

<iframe title="嵌入样例" srcdoc="<p>嵌入样例</p>"></iframe>

<javascript>
await rmd.set("people", 10)
</javascript>
```

表中数值是交互初始化结束后、首个读者操作之前的值。每一行随后将滑块调到 12，检查控件、运行时与 `{{ people }}` 同步，且普通重绘后仍保持 12。

| CSS | JS | Extended HTML | 标题与滑块样式 | `people` | iframe 位置 |
| --- | --- | --- | --- | --- | --- |
| 关 | 关 | 关 | 主题 | 2 | 转义源码 |
| 关 | 关 | 开 | 主题 | 2 | 沙箱片段 |
| 关 | 开 | 关 | 主题 | 10 | 转义源码 |
| 关 | 开 | 开 | 主题 | 10 | 沙箱片段 |
| 开 | 关 | 关 | 作者样式 | 2 | 转义源码 |
| 开 | 关 | 开 | 作者样式 | 2 | 沙箱片段 |
| 开 | 开 | 关 | 作者样式 | 10 | 转义源码 |
| 开 | 开 | 开 | 作者样式 | 10 | 沙箱片段 |

另测省略选项时等价于「开、关、关」，以及显式三项关闭在 Worker 和重开导出文件后仍全关。导出验证分别用初始状态和已捕获状态做基线。开启 JS 的交互导出应先恢复基线再写入 10，随后拖动有效。用另一个只读取基线的脚本确认恢复与初始化的先后顺序。静态 HTML 和 PDF 显示指定基线，禁用脚本，样式按 CSS 开关处理。

### 针对性回归与运行命令

- 引擎编译与传输覆盖 `<details>` 内 Markdown / 绑定、RMD 同名标签优先、围栏代码、多 CSS 块、迟置 CSS、无根组件样式、畸形片段和原文范围。比较同步、Worker 全量和补丁结果，验证手写旧编译文档及最小和标准入口。执行 `npm test -- tests/html-mode-contract.test.tsx tests/local-authoring.test.ts tests/local-compile-worker.test.ts tests/compiled-plain-data.test.ts`，再运行 `npm run check`。
- 引擎浏览器覆盖同页双文档、嵌套作用域、主题层叠、样式关闭、脚本初始化次数、写入失败原子性、单动作接管、清理、远程来源拒绝和 HTML 片段策略。运行实际计算样式和交互用例。针对导出运行 `npm test -- tests/shareable-html.test.ts tests/standalone.test.ts tests/pdf.test.ts` 和 `npm run test:pdf`，并检查独立浏览器打开交互导出。
- Editor 在八种组合从同一文档补全 RMD 组件和 `people`，检查声明原文、诊断范围、选项切换和共享分析。运行 `npm run check`，再用 Demo 的 `npm run test:editor` 和 `npm run test:interactions` 验证宿主集成。
- Demo 运行 `npm test` 和 `npm run build`，再运行 `npm run test:preview:slider`、`npm run test:export` 与 `npm run test:runtime-extensions`。用浏览器矩阵记录开关状态、实际计算样式、预览值、嵌入位置和导出重开结果。另记录预览文档切换时 JS 授权和旧会话的清理结果。

合并前由协调者用同一组候选重跑混合文档矩阵、动作接管用例和静态基线用例。提交验证记录时附仓库提交、候选完整性及浏览器或 PDF 渲染器版本。
