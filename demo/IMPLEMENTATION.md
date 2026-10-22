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
