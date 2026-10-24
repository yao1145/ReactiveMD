# 0.4.0 开发预览与迁移

状态：尚未发布的开发预览。包版本 `0.4.0`，语法修订 `local-draft-2`，组块协议 `component-protocol-1`，主题协议 `reactive-md-theme-1`。

本文汇总这一开发版包含的能力、对现有文档和宿主的变化，以及从 `0.3.1` / `local-draft-1` 升级的步骤。具体规则仍以链接的参考页为准；本页是升级清单。显式修订声明和迁移工具见[源码修订与迁移](source-versioning-ch.md)。

## 适合哪些项目

- 需要命名计算、格式化、校验、集合、新输入类型、主题或离线 HTML 导出的作者。
- 可以把宿主更新到 `local-draft-2`，并愿意补充 `LocalValueKind` 穷举、运行时适配器和状态处理的宿主。
- 固定使用 `0.3.1`、只需要 `local-draft-1` 的项目可以继续留在旧版本。当前构建只接受一个语法修订，不提供独立的 `local-draft-1` 模式；使用受支持旧写法的无指令源码按 `local-draft-2` 规则读取，显式 `local-draft-1` 声明必须先迁移。

## 本预览包含的能力

| 范围 | 内容 |
| --- | --- |
| 语法 | 十个 `local-draft-2` 组块：`jump`、`anchor`、`text`、`section`、`multi-select`、`range-slider`、`coordinate`、`quiz`、`steps`、`step` |
| 源码修订 | 可选的 `local-draft-2` 指令、版本查看与升级检查、单份源码的元数据迁移 |
| 计算 | 顶层 `<const>` 与 `<computed>` 声明，支持依赖排序、类型推断、循环检测和运行时独立缓存 |
| 表达式 | 字符串与数字数组字面量、索引、`sum`/`average`/`minOf`/`maxOf`、数字/百分比/科学计数法/货币格式化、文本函数及 UTC 日期比较与日期差 |
| 校验与数据 | 提示型 `<validation>` 规则、`runtime.validate()`、`alert`/`badge` 动态 `tone`、带稳定行键的 `<data-table>`/`<column>` |
| 外观 | `<theme name="…">`、宿主主题登记、文档深浅模式、组块主色和清单完成样式 |
| 诊断 | 中英文共享诊断目录，渲染器、Playground 与 CLI 按语言显示，机器字段保持稳定 |
| 宿主状态 | 按名称读写公开参数、`exportLocalState`/`importLocalState`、参数保留工具和可选的 Worker 编译 |
| 导出 | `reactive-md build`/`lint`、交互与静态单文件 HTML、版本化状态文件、经校验的本地位图内联、standalone `ReactiveMD.mount`/`mountAll` 和 `<reactive-md-doc>` |
| 作者工具 | 高亮、补全、绑定定位、重命名、格式化及 `lint --locale en|zh` |
| 渲染 | 依赖感知的渲染，避免重算未受影响的文档子树 |

可运行示例见[示例索引](../examples/local/README.md)，包括六个双语功能场景、账单示例和工作坊示例。全部可接受的标签名见[语法规范](local-interaction-syntax-ch.md#12-组件速查与语法裁剪)。

## 从 0.3.1 / local-draft-1 升级

无指令源码中，`local-draft-1` 已支持的写法继续有效；下面这些变化仍需要检查源码和宿主。

### 新增保留标识符

新增表达式函数名不能再用作控件绑定名。升级前请重命名以下同名旧绑定并同步修改引用：

`sum`、`average`、`minOf`、`maxOf`、`formatNumber`、`formatPercent`、`formatScientific`、`formatCurrency`、`trim`、`lower`、`upper`、`startsWith`、`endsWith`、`replace`、`slice`、`dateCompare`、`dateDiff`。

它们与原有保留名共同生效：数学与集合函数（`abs`、`sqrt`、`floor`、`ceil`、`round`、`min`、`max`、`pow`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`exp`、`log`、`len`、`contains`、`clamp`）、常量 `pi` 与 `e`、绘图名 `x` 与 `y`、字面量 `true`、`false`、`null`，以及 `__proto__`、`prototype`、`constructor`。详见[复用计算与格式化数值](computations-formatting-ch.md#兼容性)。

### 新增可识别标签名

当前构建会把以下名称解释为标签：`jump`、`anchor`、`text`、`section`、`multi-select`、`range-slider`、`coordinate`、`quiz`、`steps`、`step`、`computed`、`const`、`validation`、`data-table`、`column`。

如果旧文档把这些名称当作普通正文，或作为“未知标签按原文显示”的示例，现在会被解析为组块或声明。请把这类示例放进行内代码、代码围栏，或转义标签，并核对新增保留名与下列行为变化。

开头的 `<theme name="…">` 是文档元数据，不是组块；它同样只允许在正文前声明一次。

### 修订声明与迁移

源码可以在前导区声明 `<!-- reactive-md: local-draft-2 -->`。无指令源码保持当前修订的行为。显式 `local-draft-1` 或未知修订会以 `local.version.*` 诊断拒绝，不创建运行时；声明旧修订不会选择旧解析器。

`reactive-md migrate` 或纯核心 `migrateLocalSource` 把单份源码迁移到 `local-draft-2`。迁移只替换或补上元数据注释，保留正文原始字节、BOM 和 CRLF。写出结果前会阻止新增保留绑定、新增可识别标签、当前编译错误和文本控件长度语义变化；不重命名标识符，也不激活原先按原文显示的标签。清单完成样式属于兼容例外，不阻止迁移。迁移会改变源码摘要，之后应重新导出状态文件。在这一声明之前构建的读者（包括 `0.3.1`）会把它当作普通注释，不执行检查，因此应先迁移旧文档。

### 行为变化

- 清单中已勾选的条目现在加删除线并变淡，包括初始 `[x]` 条目。
- `alert` 与 `badge` 可以在现有枚举内使用动态 `tone` 表达式。
- 提供 `key`（稳定标识列）时，`table` 和 `chart` 可通过 `bind` 公开选择状态；没有 `key` 的旧表格仍只在渲染器内部保存选择。
- 文本控件的 `min-length` 与 `max-length` 按 Unicode 码点计数，与字符串 `len()` 一致。原先因 emoji 占两个 UTF-16 代码单元而失败的值现在可能通过；源码位置和资源预算仍按 UTF-16 计算。
- `document.bindings` 与 `document.initialState` 仍只描述可写控件；`runtime.snapshot().state` 还会包含成功求值的命名计算结果，宿主不能假设快照里只有控件。
- `LocalValueKind` 增加 `number-array`，`LocalValue` 增加 `number[]`；可写的清单与多选控件仍产生字符串数组。
- 自定义运行时适配器需要补充 `validate()`；多槽控件使用 `get(node, slot?)`、`set(node, value, slot?)` 和 `setMany(node, values)`。
- 状态文件携带 `syntax: "local-draft-2"` 和源码摘要。语法修订、摘要或公开参数集合不一致时会拒绝整个文件。
- 显示用诊断通过共享目录本地化；回调仍收到结构化诊断。`message` 是显示文本，不是 API。

## 升级清单

1. 固定 `0.4.0`，保存原始 `.reactive.md` 源码，并记录 `LOCAL_SYNTAX_VERSION`。
2. 对每份源码运行 `reactive-md migrate <file> --check` 或 `migrateLocalSource`。无版本声明的历史文档要加 `--from local-draft-1`；写出结果前处理全部阻止项。
3. 在代码区域之外搜索 15 个新增可识别标签名，按需要转义或放进代码。
4. 搜索 `bind`、`bind-start`、`bind-end`、`bind-x`、`bind-y` 的值，确认没有 17 个新增保留标识符；如有则重命名绑定和引用。核心入口的 `renameLocalBinding` 和编辑器重命名会同时更新声明、表达式引用与绘图参数。
5. 重新编译全部文档，处理新增的位置或结构诊断，尤其是顶层 `computed`/`const`、`validation`、`data-table`/`column`、`steps`/`step` 和 `quiz`。
6. 更新宿主对 `number-array`、`validate()`、槽位 API 和包含计算值的快照的处理。
7. 重新检查状态导入导出、参数保留和宿主内的 HTML 导出。迁移会改变源码摘要，应重新导出状态文件。
8. 检查可见变化：清单完成样式、表格/图表选择和主题 CSS。
9. 运行[发布验证入口](../CONTRIBUTING-ch.md)，并用自己的文档和浏览器检查复验。

## 验证范围

开发版面向 Node.js 22.12 与 Node 24，CI 使用 Playwright Chromium，本地使用 Microsoft Edge。`npm run verify:release` 是完整发布门禁：覆盖核心与 Demo 测试、类型、包与文档检查、仓库外真实 tarball 消费，以及计算、集合、作者工具、状态恢复、HTML 导出的浏览器检查和渲染等价检查。单项命令仍列在[贡献指南](../CONTRIBUTING-ch.md)。

静态 SSR 由 packed 检查覆盖。单文件导出的静态首屏水合已在 Playwright Chromium 和本地 Edge 验证。该路径之外的通用 SSR 水合、Firefox 与 Safari/WebKit 尚未验证，不作支持声明。

版本规则与诊断契约见[版本与兼容性](compatibility-ch.md)，修订指令与迁移工具见[源码修订与迁移](source-versioning-ch.md)，HTML 与状态格式见[可分享文档与静态导出](shareable-export-ch.md)，组块新增见[local-draft-2 扩展说明](local-components-v2-ch.md)。
