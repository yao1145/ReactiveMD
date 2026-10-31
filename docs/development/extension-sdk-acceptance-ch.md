# 扩展 SDK 交付与统一验收记录

整合日期：2026-10-30。第一至第三阶段均已实施，完整验收项目分段通过。本文合并原三份阶段验收记录；[架构规划](extension-sdk-plan-ch.md)保留设计与实施顺序，[组件迁移清单](extension-sdk-phase2-inventory-ch.md)保留逐项结果。

交付形式为包版本 `0.6.1` 上的源码 SDK 预览。现有 registry 中的 `0.6.1` 不包含这些新增入口，开发与验证使用当前源码构建的 tarball。npm 发布与 Demo 部署单独安排。

开发插件从[组件插件开发指南](component-development-ch.md)开始，完整 API 见[SDK 指南](../integration/extension-sdk-ch.md)。本文的测试数字是各阶段验收时的历史快照，三个阶段的套件相互重叠，不累加为测试总数。

## 1. 架构与最终交付

稳定内核负责语法解析、表达式、依赖调度、状态与共享约束、资源预算和源码定位。内置与用户组件共用 manifest、编译规则和 React 分发；主题作为独立资源组合。

| 公开入口 | 职责 |
| --- | --- |
| `reactive-md/sdk` | 组件 manifest、实例配置、版本、属性归一化、主题定义与组合 |
| `reactive-md/presets/default` | 46 个默认渲染和结构组件的公共契约 |
| `reactive-md/react`、`reactive-md/react/server` | React 实现装配、公开上下文、严格静态与 SSR 渲染 |
| `reactive-md/authoring` | 组件目录、说明、模板、插入、结构上下文与模板合规检查 |
| `reactive-md/export`、`reactive-md/standalone` | 导出预检、bundle seal、版本需求、资源恢复与挂载 |
| `reactive-md/build` | Node 构建适配、允许目录内的 CSS/资源收集、notices、单文件 bundle 和清单 |
| `reactive-md/testing` | 无 React/DOM 依赖的 manifest、属性与真实绑定行为测试 |
| `reactive-md/testing/react`、`reactive-md/testing/browser` | 静态、SSR、生命周期、错误隔离、hydration 和离线证据 |

`config.components` 保留用户组件，`config.registry` 包含完整集合；默认组件定义位于 `src/presets/default-components.ts`，实际视图位于 `src/components/`。`src/local/schema.ts` 是兼容投影，并保留 `computed`、`const`、`external` 三个内核语言声明。迁移清单合计 49 项，其中 46 项是组件。

## 2. 第一阶段：公开扩展 SDK

本阶段建立仓库外消费闭环，使用评分控件、Markdown 提示容器和 paper 主题验证公开接口。

| 任务 | 交付与验收 |
| --- | --- |
| P1.1 契约与兼容映射 | `reactive-md-component/v1`、配置和需求清单；公开上下文；旧宿主输入兼容 |
| P1.2 校验与不可变配置 | 名称/id 冲突、协议、依赖版本和环、默认值、预算、确定性摘要；无 React/DOM 的 NodeNext 消费 |
| P1.3 编译与 Worker | `LocalCompileOptions.config`、实际使用组件需求、增量缓存键；主线程与真实 Worker 对照、配置变更失效 |
| P1.4 React 上下文 | 归一化 props、绑定句柄、子内容、源码范围、disabled/visible/reset、错误边界与 server 入口 |
| P1.5 作者与主题接入 | 配置生成目录、模板与闭合补全；主题校验、有序组合、作用域与深浅模式保留参数 |
| P1.6 最小导出 | 能力与资源预检、宿主专用 bundle、静态及离线交互 HTML |
| P1.7 独立消费 | 真实 tarball 安装；评分与内置数字控件互相写入；1280px/390px 断网恢复、零外部请求与卸载清理 |

历史验收通过 129 个核心测试文件、1,703 项测试，以及 16 个 Demo 测试文件、254 项测试。SDK 独立消费通过 9 组检查，另有类型、构建、包入口、CLI、SSR 和随包文档检查。

此时多槽位、集合、内置完整迁移、统一编辑器菜单和通用构建工具尚未交付；它们分别在第二、三阶段完成。第一阶段样例保留于[独立 SDK 消费项目](../../examples/integration/extension-sdk/README.md)。

## 3. 第二阶段：内置与用户组件共用契约

迁移基线为 `d227fc09c503f8094883c33be87ad0a13d866213`，完成提交为 `2eadc8c`。

| 任务 | 交付与验收 |
| --- | --- |
| P2.1 `slider`、`card` | 定义经过公开校验，实际视图只使用公开 props、绑定与子内容接口 |
| P2.2 范围与坐标 | 数字命名槽位、独占规则、顺序关系、原子 `setMany`；非法更新保留全部参数和 revision |
| P2.3 集合与结构容器 | 字符串/数字集合、JSON 初值、长度预算与状态恢复；tabs、steps 等使用通用结构规则 |
| P2.4 其余组件 | 计时、图形、表格、导航和结构子项迁入组件目录，适配器提供公共内容与服务 |
| P2.5 统一注册来源 | 默认预设为权威定义；编译、Worker、作者工具、运行时元数据与 React 分发消费同一配置 |

主槽位支持标量与集合，公开数组读取返回不可变副本。数字命名槽位采用独占绑定，主槽位与命名槽位可在同一事务更新。集合上限使用字面量或静态数值属性，其他不支持的组合在注册时拒绝。

数值字面量与合法完整插值均向实现提供数字，非法显式值保留诊断。组件获得 `visible`、`disabled`、`mode` 与 `resetToken`；静态上下文拒绝状态写入。内容、表格、选项、源码与导航通过公开投影提供，组件实现无需访问内部 AST。

历史验收通过 136 个核心测试文件、1,866 项测试，以及 16 个 Demo 测试文件、254 项测试。迁移前 85 组用例保持诊断、状态和静态输出一致，46 个默认组件的外部别名通过同一语义语料。外部坐标、字符串集合、数字集合和 Markdown 容器还通过原子回滚、复制、SSR、静态与离线验收。

独立审查发现的身份冲突、静态写入信号、动态属性诊断、混合槽位、文档契约覆盖和锚点缓存问题均修正并补充回归。相关历史日志位于本地 `artifacts/sdk-phase2/`。本轮未建立同设备迁移前后的性能阈值，性能工作按独立规划验证。

## 4. 第三阶段：完整消费流程

基线为 `2eadc8c5ea5afc14c685731f8b02e10079e01310`。作者工具提交为 `8d35f6b`，构建、恢复和合规工具提交为 `da8421d`；集中验收中的组合输入修复为 `9837cd1`。

| 任务 | 交付与验收 |
| --- | --- |
| P3.1 编辑器与 Demo | 同一 manifest 目录生成菜单、搜索、帮助、插入与结构上下文；外部组件的中英文、撤销/重做和移除注册通过真实编辑器检查 |
| P3.2 构建适配 | Node 可加载宿主入口声明实现、root、allowlist、资源和 notices；收集 CSS、字体、图片，构建一个 IIFE，并生成摘要清单 |
| P3.3 版本与恢复 | SDK/组件/主题/资源需求、bundle seal 与摘要检查；缺失或不匹配在状态应用及 React 挂载前失败；旧 v1 载荷保持可用 |
| P3.4 合规与模板 | 公开 manifest、绑定、React 与浏览器测试工具；可复制组件包具有编译后的 JS、类型、主题与 CSS exports |
| P3.5 文档与发布形态 | 双语 SDK、主题和迁移说明；真实 tarball 与组件包自身的第二消费项目；全量门禁项目分段通过 |

默认预设中 34 个组件带独立插入菜单信息，结构子项继续由 schema 提供补全与约束。外部提供的插入模板在同一配置下展开占位符并校验，父级限定组件在合法容器中校验。作者信息变化更新菜单，编译语义摘要继续保持稳定。

构建入口导出 `config`、`reactConfig`、`root` 和 `allowlist`，可选导出 `resources` 与 `notices`。JavaScript 依赖按正常模块规则导入；资源收集以 root 和 allowlist 限定文件访问。缺失、远程或越界资源、符号链接逃逸、循环引用、预算和资源身份冲突产生诊断。Vite 8 为可选 peer，实际构建时才加载。

`buildLocalStandaloneBundle` 返回扁平的 `script`、`extensions`、`seal`、`configKey`、`resources`、`assets`、`css`、`notices` 和 `manifest`。清单使用 `reactive-md-build/v1`，seal 使用 `reactive-md-bundle/v1`。SDK HTML 使用 v2 载荷与 `reactive-md-restore/v1` 要求；普通导出继续默认使用 v1。状态格式保持 `reactive-md-state/v1`。

恢复校验覆盖 SDK 范围、配置与源码、实际使用组件的身份/版本/契约、能力、所选主题和资源摘要。兼容版本范围不能替代契约校验；升级改变契约时重新编译并验证保存状态。组件代码由宿主主动安装，文档声明不会触发下载或执行第三方代码。

## 5. 最终验收证据

验收环境为 Windows x64、Node 22.17.0、npm 10.9.2、Playwright 1.64.1。先运行 `npm run verify:release`，修正发现的问题后，集中补跑剩余项目与受影响的编辑器检查。全部 27 个门禁项目有通过记录，包含 19 个浏览器项目；原始失败记录与修复后日志均保留，执行方式为分段验收。

| 检查 | 记录的结果 |
| --- | --- |
| 构建与类型 | 库、Node 构建入口、编辑器、standalone、生产 Demo 与 140 个 ESM 声明文件通过 |
| 核心与 Demo | 146 个核心测试文件、1,935 项测试；17 个 Demo 文件、257 项测试通过；组合输入修复后另验 4 个相关文件、28 项测试 |
| 作者工具 | 真实公共编辑器 9 项检查通过，包括外部注册、帮助、搜索、中英文、插入、撤销/重做和移除配置 |
| 合规工具 | 46 个默认 manifest、外部别名对照、命名槽位原子回滚、集合预算与副本、重置；无 React/DOM 的 Node 与 NodeNext 消费通过 |
| 组件包 | 仓库外模板 `npm test` 通过，再打包模板并在第二个项目消费 JS、React、主题、CSS 与严格 NodeNext 类型 |
| 能力证据 | 评分控件 74 项、提示容器 62 项通过；容器一个未配置的可选服务器错误探针跳过，四类声明能力均有执行证据 |
| 离线恢复 | 1280px/390px 交互 HTML、禁用 JavaScript 的静态 HTML、CSS/SVG 与 5 项 notices，零网络请求；资源、主题、版本和缺组件四种破坏在挂载前失败 |
| 浏览器 | 编辑器、Markdown、数学、原生 HTML、媒体、Demo、新组件、导出、计算、约束、主题、渲染等价、组合场景、Firefox/WebKit、宿主表单和提示框通过 |
| 打包消费 | 隔离离线安装、核心/React/编辑器类型、SSR、CLI、standalone、CSS 和随包文档链接通过 |

Firefox 检查发现多行组合替换期间的分析重绘可能清空文档，现已把刷新延后至组合提交后，并在卸载时清理待执行任务。公共编辑器、CM6、Firefox 和 WebKit 回归通过。HTML 夹具改为按独立用例创建文档；指南锚点检查改为定位外层文档，避免匹配嵌套示例。

| 本地记录 | 用途 |
| --- | --- |
| `artifacts/sdk-phase3/verification.json` | 27 项门禁的分段汇总与源码、安装包信息 |
| `artifacts/release-verification.json` | 原始完整门禁尝试，保留当时的失败 |
| `artifacts/sdk-phase3/remainder.json`、`postfix.json` | 剩余项目与组合输入修复后的补验 |
| `artifacts/sdk-consumer/verification.json` | 独立消费目录、tarball 摘要、Worker、SSR、编辑器与离线结果 |
| `artifacts/release-package/package-verification.json` | 已验证安装包的 SHA256、npm integrity 与消费结果 |

这些目录是本地验证产物，不随文档保证存在；本文保留结果摘要，原始日志用于本地审计。

## 6. 复验与版本边界

修改 SDK 后先构建，再运行依赖产物的检查：

```powershell
npm.cmd run build:demo
npm.cmd run test:package
npm.cmd run test:docs
npm.cmd run test:packed
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm.cmd run test:sdk-consumer
```

跨系统修改或发布使用 `npm.cmd run verify:release`，浏览器渠道和缓存按[发布流程](releasing-ch.md)配置。只修改文档时检查内容、链接与 diff；历史验收数字不因此成为新一轮测试结果。

旧 `hostComponents`、`hostRenderer`、`hostData` 保持兼容输入路径；新配置与对应旧注册参数混用时拒绝冲突。迁移后重新编译文档并重建 bundle。默认组件同名覆盖、运行中修改注册表、文档内自动装载插件和第三方代码沙箱仍不在此 SDK 契约内。

后续新增组件先扩展公共契约与合规用例，再由默认组件和仓库外组件共同验证。组件、主题、SDK、语法和发布版本分别管理。

## 7. Demo 单入口接入补验（2026-10-31）

本节记录提交 `ef89377` 的验收结果。Tetris 在后续改为消费安装包，当前接入及更新流程见 [Demo 说明](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md)。

Demo 现在从 `demo/extensions.ts` 统一装配组件实现、样式、主题、样例和 notices。Tetris 直接复用包内源码与样例，编译器、Worker、预览、编辑器目录和导出使用同一配置。离线运行时由公开 `buildLocalStandaloneBundle` 构建；开发模式的中间 JSX 转换固定为生产模式，避免导出文件调用不可用的 `jsxDEV`。

本轮检查：

- `npm run build:demo`：库类型、库产物与 Demo 构建通过。
- Demo 单元测试：20 个文件、266 项通过，含真实外部组件 SSR/静态导出、缺失及冲突样式、嵌套 npm 安装和离线能力诊断。
- `npm run test:package`：公开入口和核心、React 消费边界通过。
- `npm run test:docs`：76 份文档、812 个本地链接与锚点通过。
- `node demo/scripts/verify-extensions.mjs` 及 `--dev`：Edge 生产和开发模式各 6 项通过，覆盖真实 Worker、游戏操作、编辑器目录、手机布局，以及断网打开并操作导出的交互 HTML；静态 HTML 包含组件样式且不含脚本。两轮均无页面错误和离线 HTTP 请求。
- 原有 `demo/scripts/verify-export.mjs`：内置组件的当前值、状态下载、交互离线 HTML 和静态 HTML 共 4 项通过。

本轮浏览器记录与示例文件位于 `artifacts/demo-extensions/`。这些结果属于本次 Demo 接入补验，与前面三阶段的历史发布门禁分别记录。

## 8. Tetris 安装包接入补验（2026-10-31）

Demo 改为安装 `demo/vendor/` 中的 Tetris npm tarball，并从包的公开入口读取实现、样式、样例和 notices。包使用宿主提供的 ReactiveMD、React 与 React DOM peer dependencies。`npm run update:demo-tetris` 构建组件、生成带内容摘要的安装包并更新 Demo 依赖及锁文件。

本轮 Demo 构建、根项目类型检查、21 个文件中的 267 项 Demo 测试和文档链接检查通过。新增安装边界测试确认组件来自展开后的 `node_modules` 分发包，包含声明及许可、不含 `src/components.tsx`，且 tarball 的 SHA512 与锁文件 integrity 一致。生产与开发模式各 6 项浏览器验收通过，覆盖 Worker、预览交互、编辑器目录、手机布局及静态和交互离线文件；导出的游戏可在断网时继续操作。

## 9. 易用入口与独立接入验收（2026-10-31）

新增 defineReactComponentPackage 与 createReactHost，便捷入口补齐协议、形态和样式身份默认值，底层 manifest 读取仍严格校验。公开 reactive-md/vite 统一虚拟宿主、样式、依赖预构建、React 去重及离线运行时。新增 reactive-md init component 脚手架与中英文快速开始，原长指南保留为完整契约页。renderStatic 保持已有可选语义，本轮通过示例展示 ctx.mode 与静态绑定限制。

编译结果携带 componentConfigKey，Worker 和增量补丁保留该值。编译配置错接报告 local.extension.config-mismatch；manifest 存在但 React 实现缺失时报告 local.extension.renderer-missing，严格 SSR 在执行组件前拒绝。旧文档和旧宿主路径保持兼容。

按用户要求启动全新的 Claude Code 会话重新接入 Tetris；会话只修改分配的实现和 Demo 接线，主代理审查、重建安装包并执行验收。Tetris 继续从 demo/vendor 的 npm tarball 安装，通过公共组件包和 Vite 插件接入；旧私有适配器及别名已移除。

用户要求停止测试前，已完成：核心 150 个文件、1975 项测试，Demo 21 个文件、267 项测试；库及 Demo 构建、公开包边界和真实 tarball 消费检查；Tetris 开发/生产各 6 项浏览器检查；真实安装 SDK 后运行 CLI、两种语言的相同示例、类型与 Node/SSR 合规、生产预览、静态/交互离线 HTML、开发时样式更新共 6 项消费检查。验收日志位于 artifacts/sdk-ease/ 与 artifacts/demo-extensions/。随后按用户指示停止新增测试，仅整理记录与提交。
