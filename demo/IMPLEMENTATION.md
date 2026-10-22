# 实现与验证记录

## 本地交互模式（2026-10-22）

Playground 已切换到 `local-draft-1`，直接加载 `examples/local/` 中的 12 份文档。11 份正常示例可运行，诊断示例故意报错并停用交互。作者语法见 [本地交互规范](../docs/local-interaction-syntax.md)，公开入口见 [集成说明](../docs/local-integration.md)。

| 模块 | 实现 |
| --- | --- |
| 标签与 Markdown | `src/local/parser.ts`：代码和数学区域隔离、嵌套容器、属性、表格转义与原始源码位置 |
| 表达式 | `src/local/expression.ts`：严格类型、短路求值、内置函数、插值与执行预算 |
| 编译和状态 | `src/local/schema.ts`、`compiler.ts`、`runtime.ts`：33 个组件、前向与共享绑定、初值约束、局部错误、原子重置 |
| LaTeX | `src/local/math.ts`、`math-view.tsx`：实函数解析、分段函数、总执行预算、断点细分、原生 MathML 排版 |
| React | `src/local/LocalDocumentView.tsx`：输入草稿、中文组合输入、隐藏状态、计时暂停、错误恢复与多实例 DOM ID |
| 可视化 | `src/local/visuals.tsx`：表格、五类统计图、函数曲线、时间轴、自动布局图解与键盘读数 |

主代理通过 `claude-code-subagent` 并行委派 7 个实现任务，分别负责解析、表达式、数学、编译运行时、基础组件、可视化和 Playground 集成。主代理审查实际代码，修正整合问题，并执行全部测试与浏览器检查。任务和会话记录保留在忽略目录 `.tasks/local-syntax/`。

本轮实际通过：

- `npm test`：16 个测试文件，201 项测试。
- `npm run build:demo`：核心类型检查、语言包和 Playground 构建。
- `npm run test:demo`：15 项公开包和示例测试。
- `npm run test:package`：核心无 React 运行时依赖、公开入口、全部示例及应用样式边界。
- `npm run test:docs`：文档链接与导航锚点。
- `demo/scripts/verify-local-browser.mjs`：Edge 下 38 项检查，包括 12 份示例、输入草稿、中文组合输入、隐藏清单、条件计算错误恢复、计时暂停、表格排序分页、375px 布局，以及 StrictMode 双实例的独立状态和唯一 DOM ID。运行时异常与意外外部请求均为 0。

浏览器报告在 `demo/artifacts/local-browser-results.json`，截图以 `local-` 开头。检查时用 `DEMO_URL` 指向本轮启动的本地测试服务。构建保留了一条大分块体积提示，未做按需拆包。

## 云服务器部署（2026-10-22）

本地模式已替换 [线上 Demo](https://yaozi.raricy.com/)。服务器通过 `ssh rocky2-ts` 访问，站点目录为 `/opt/reactive-md`，`site` 软链接指向 `releases/20261022-1400-local-draft-1`。旧版 `releases/20261021-235541` 保留，可用原子软链接切换回滚。此次沿用原有 Caddy、证书与容器配置。

上传包、入口及全部新资产的 SHA256 校验通过。服务器 IPv6 HTTPS 返回新版本；通过临时 SSH 隧道，以真实域名和正常证书校验运行的 38 项线上浏览器检查全部通过。当前客户端公网直连超时，因此该检查不代表当前网络的公网直连已恢复。报告保存在本地 `demo/artifacts/deployed-browser-results.json`，发布记录在 `.tasks/deploy/`。

## v0.2 历史说明

以下保留旧版 directive/YAML 模式的实现记录。该模式通过 `compile`、`createRuntime`、`DocumentSession` 和 `ReactiveDocument` 使用；当前 Playground 通过带 `Local` 的公开 API 选择新语法。

Reactive MD v0.2 已实现声明式交互文档、44 个内置组件、作者 Playground 和 React 嵌入库。实现范围见 [Intelligent UI 能力矩阵](../docs/intelligent-ui-plan.md)，小游戏和地图按用户要求排除。

## 模块

| 部分 | 入口 | 实现 |
| --- | --- | --- |
| 语言编译 | `src/core/compiler.ts` | remark/GFM/directive/frontmatter；受限 YAML、组件 schema、词法作用域、源码位置诊断 |
| 表达式 | `src/core/expression.ts` | 受限 AST、类型检查、数学和集合函数、执行预算 |
| 组件契约 | `src/core/schema.ts` | 44 个内置 schema、清单导出、自定义组件注册与编译时快照 |
| 状态与动作 | `src/core/runtime.ts` | JSON 状态、计算依赖、原子事务、集合操作、约束校验、订阅、异步调用与取消 |
| 基础渲染 | `src/ui/viewer.tsx`、`components.tsx` | Markdown、输入草稿、中文组合输入、错误边界和宿主渲染器 |
| 布局与表单 | `src/ui/advanced.tsx` | 栅格、页签、折叠、表单、清单、表格、列表作用域、计时 |
| 视觉组件 | `src/ui/visuals.tsx` | 五类 SVG 图表、公式采样曲线、交互节点图与时间线 |
| 文档会话 | `src/session/index.ts` | 文档 ID 隔离、存储校验、增量接收、完整结构提交、生命周期清理 |
| 作者工具 | `demo/src/App.tsx`、`demo/src/author-tools.tsx` | 编辑、导入导出、格式化、状态检查、组件清单、流式播放、主题与简洁视图 |
| 公共库 | `src/index.ts`、`src/react/index.ts`、`src/react/ReactiveDocument.tsx` | TypeScript API、React 嵌入、自定义组件和宿主 capability |

首轮三个 Claude Code 子任务分别实现核心、布局表单和视觉组件；主代理负责共享接口、文档会话、整体整合、实际文件审查和验证。任务记录在根目录的本地 `.tasks/`。本轮目录拆分后，demo 自己管理页面、应用依赖与测试，根 `npm test` 不加载 demo 源码；`npm run test:demo` 独立验证 12 个 demo 条目。

## 交互行为

Playground 修改源码后自动重新编译并初始化状态；普通控件直接更新运行时。示例之间保存各自源码和状态，刷新时按文档 ID 恢复，恢复值需要通过当前文档约束。重新运行、恢复示例及重置按钮提供显式初始化入口。

流式会话逐次编译前缀，成功后提交；结构未闭合时保留上次提交的内容，最终错误给出诊断。每次提交创建新运行时，保存兼容状态并取消旧运行时的请求。它提供渐进呈现与最终校验，不提供跨提交的原位 AST 补丁。

外部效果通过宿主 capability 执行。示例提供可取消的异步本地目录查询，输入 `error` 可测试失败与重试。运行时维护 pending/success/error 状态，同一动作采用最新请求，销毁时中止请求。真实 API、模型服务和权限策略由宿主实现。

表达式使用独立解释器，原始 HTML 和动态文本按文本处理；链接和图片过滤脚本协议。文档不能嵌入任意脚本或 CSS，宿主自定义组件属于受信任的应用代码。

## 验证记录

2026-10-21 的最终检查：

- `npm test`：7 个测试文件、105 项语言、渲染器与指南样例测试通过，覆盖状态事务、集合作用域、异步竞态与取消、持久化、流式分片、格式化和自定义组件注销后的已编译文档。指南的 10 份完整交互文档逐一编译、初始化并渲染，储蓄曲线还核对了期末值与零利率分支。
- demo 独立测试：12 项示例条目检查通过，包含故意写错的诊断示例。
- `npm run build`：TypeScript 与独立语言包构建通过；`npm run build:demo` 生成 `demo/dist/` 中的 Playground 和嵌入页面。
- `npm run build:lib`：ESM 库、CSS、类型声明和 44 项组件 JSON 清单生成成功。
- 库产物在 Node.js 中直接导入并完成文档编译、集合动作与格式化后再编译。
- `npm run test:browser`：14 项原有浏览器回归通过。
- `npm run test:intelligent`：26 项扩展检查通过，覆盖所有新增能力、375px 布局、键盘操作、状态恢复、流式播放和 React StrictMode 嵌入。

浏览器验证使用本机 Edge。报告为 `demo/artifacts/browser-results.json` 和 `demo/artifacts/intelligent-results.json`，截图保存在同一目录。执行浏览器脚本前需启动本地服务器，也可用 `DEMO_URL` 指向生产预览地址。

语言包具有独立的核心与 React 入口，核心入口没有 React 或浏览器 DOM 依赖；可复用样式不包含编辑器、工具栏和观察面板。`npm run test:package` 检查这些边界。应用构建会提示较大的共享脚本分块，两种构建均复用成熟 Markdown 解析器。
