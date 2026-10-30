# 扩展 SDK 第一阶段交付与验收

日期：2026-10-30。源码包版本：`0.6.1`。本次交付为源码中的 SDK 预览，发包与部署分别安排。

第一阶段完成了从组件声明、实例配置、编译和 Worker，到 React 预览、作者工具、主题及最小离线分享的消费链路。内置组件继续由默认预设提供，完整迁移按第二阶段推进。

## 交付对应

| 规划任务 | 已交付内容 | 验收证据 |
| --- | --- | --- |
| P1.1 契约与兼容映射 | `reactive-md-component/v1`、配置和需求清单协议；公开上下文；旧宿主接口保持行为 | [SDK 指南](../integration/extension-sdk-ch.md)、manifest 与 React 契约测试 |
| P1.2 校验和不可变配置 | 名称/id 冲突、协议、依赖及内核版本范围、依赖环、默认值、资源与总量预算、确定性语义摘要 | manifest/config 测试；无 React、无 DOM 类型的独立 NodeNext 消费 |
| P1.3 编译和 Worker | `LocalCompileOptions.config`；配置下沉到现有解析底座；实际使用组件的需求清单；增量缓存键与配置快照 | 主线程/Worker 单元测试及真实浏览器 Worker 对比、配置变更重编译 |
| P1.4 React 上下文 | 按组件分发、归一化 props、绑定句柄、子内容、源码范围、disabled/visible/reset、错误边界与 server 入口 | 评分与内置数字控件互相写入；非法值拒绝；隐藏、重置、卸载、SSR 失败诊断和 hydration 验证 |
| P1.5 作者与主题接入 | 配置生成的目录、说明、模板插入、闭合补全及模板合规检查；独立主题与有序组合 | 插入/重命名回归；主题校验、作用域与组合测试；浏览器深浅模式切换保持参数 |
| P1.6 最小导出 | 编译配置与需求清单保留；能力及资源预检；宿主专用 standalone bundle；静态与离线交互 HTML | 断网新上下文在 1280px/390px 恢复，检查绑定、起始参数、重置、主题及零外部请求 |
| P1.7 独立消费 | [评分、提示容器、paper 主题样例](../../examples/integration/extension-sdk/README.md)；真实 tarball 安装与验证脚本 | 系统临时目录消费，全部 ReactiveMD 导入来自公开 exports，无源码 alias 或依赖 junction |

## 集中检查

- 核心套件：129 个文件、1703 项测试通过。
- Demo：16 个文件、254 项测试通过。
- 类型检查、库/编辑器/standalone 构建与 ESM 声明生成通过。
- 公开包边界与真实 tarball 的核心、React、编辑器、CLI、SSR 和文档链接检查通过。
- SDK 独立消费通过 9 组检查，包含纯 SDK NodeNext 类型、React 消费类型、实际插入模板、SSR、真实 Worker、无 JavaScript 静态文档、桌面/手机离线交互、错误隔离与卸载清理。

可复跑命令：

```powershell
npm.cmd run typecheck
npm.cmd run build:lib
npm.cmd test
npm.cmd run test --workspace=@reactive-md/demo
npm.cmd run test:package
npm.cmd run test:packed
npm.cmd run test:docs
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm.cmd run test:sdk-consumer
```

构建完成后再运行依赖发布产物的测试，避免 CLI 测试读到重建时被清空的目录。浏览器渠道按本机安装情况选择；npm 缓存有权限限制时使用任务目录中的缓存。

SDK 消费结果保存在 `artifacts/sdk-consumer/verification.json`，记录临时消费目录、安装包 SHA256 和实际检查项。同目录保留 `interactive.html`、`static.html` 及两种宽度截图。完整包消费结果和验证安装包位于 `artifacts/release-package/`。

## 阶段边界

公开入口包括 `/sdk`、`/presets/default`、`/react`、`/react/server`、`/authoring`、`/export` 和 `/standalone`。本阶段向默认组件集合添加扩展，默认预设保持启用；组件集合创建后冻结。旧宿主注册参数与新配置同时传入会报冲突。

标量与带 options 的 choice 绑定已接入；动态 min/max 使用内核约束，并检查作为边界的属性自身 schema。step 保持静态。多槽位、集合和复杂结构子项由第二阶段扩展。

作者工具提供配置生成的目录与插入 API，宿主可直接消费。仓库编辑器和 Demo 的完整菜单统一属于第三阶段。离线分享使用宿主显式构建的 bundle；通用打包适配和依赖资源自动发现也在第三阶段完成。

主题包本阶段支持有作用域的内联 CSS 和 data 资源；全局命名的字体声明与关键帧动画暂不进入主题契约。组件默认样式与主题增强分开提供，导出按资源 id 校验并收集。

后续以 `slider`、`card` 迁入公开协议检验接口完整性，再确认稳定 SDK 承诺。完整顺序见[架构规划](extension-sdk-plan-ch.md)。
