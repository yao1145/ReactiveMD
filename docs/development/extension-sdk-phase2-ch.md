# 扩展 SDK 第二阶段交付与验收

状态：第二阶段已实施。日期：2026-10-30。迁移基线为 `d227fc09c503f8094883c33be87ad0a13d866213`，包版本保持 `0.6.1`，交付形式为源码 SDK 预览。

本阶段把全部 46 个渲染与结构组件迁入公开扩展契约。`computed`、`const`、`external` 继续作为内核语言声明。49 项逐项清单见[组件迁移清单](extension-sdk-phase2-inventory-ch.md)，公开用法见 [SDK 指南](../integration/extension-sdk-ch.md)。

## 规划对应关系

| 规划项 | 当前实现 | 验收依据 |
| --- | --- | --- |
| P2.1：`slider`、`card` | 默认定义经过 `defineLocalComponent`；实际视图位于组件目录，通过公开 props、绑定与子内容接口运行 | 旧文档基线、公开边界检查、仓库外绑定控件与容器 |
| P2.2：`range-slider`、`coordinate` | 数字命名槽位、独占规则、顺序关系与原子 `setMany`；非法更新保留参数和 revision | 内核与 React 专项、桌面/手机 V2、外部坐标控件离线恢复 |
| P2.3：集合与结构容器 | `multi-select`、`checklist`、`tabs`、`steps` 等采用统一规则；通用字符串/数字集合支持 JSON 初值、预算和状态恢复 | 全量外部别名对照、集合复制与回滚、必需子内容与作用域回归 |
| P2.4：其余组件 | 计时、图形、表格、导航及结构子项实际实现迁出旧单体；公共适配器提供内容、表格、数学、源码、校验和导航服务 | 完整核心回归、生产 Demo 浏览器检查、中英文 V2 与离线验收 |
| P2.5：统一注册来源 | 默认预设为权威 manifest 集合；解析、编译、作者工具、运行时元数据和 React 分发使用同一配置 | 注册校验、Worker 与补丁传输、公开导入边界和真实 tarball 消费 |

## 数据与实现边界

`src/presets/default-components.ts` 保存默认组件定义。`src/local/schema.ts` 提供由定义生成的兼容视图，以及 3 个语言声明。`config.components` 保持外部组件列表，`config.registry` 包含完整集合。配置校验统一处理名称、身份、依赖、协议和预算。

组件契约可声明 `props`、`bindings`、`structure`、`rules` 和 `slotRelations`。规则为有界 JSON，描述通用数值、文本、日期、结构、选项、图形、表格和导航语义。编译器把运行时需要的部分写入 `document.kernel`；React 函数始终留在宿主实现集合中。`document.extensions` 继续记录外部组件需求。

实际视图位于 `src/components/`，统一通过 `defineReactComponent` 和默认 React 预设装配。它们消费公开内容投影，使用公开适配器及其通用辅助函数。旧 `LocalDocumentView` 中的内置视图副本已删除。旧图形与数据表入口保留输入兼容适配，转到同一份实际实现。

React props 与公开 SDK 属性读取共用归一化实现。数字字面量和合法完整插值均得到数字；动态校验失败不会被转换为合法默认值。具有局部求值作用域的表达式属性保留表达式文本，由相应规则和组件服务处理。

## 状态与生命周期

主槽位支持标量和集合。通用 `collection` 保留数组顺序及重复值，`multi-select` 与 `checklist` 保留原有选择集合语义。数字数组验证有限数值和长度，状态文件支持其序列化与恢复。公开数组读取返回不可变副本。

命名槽位在本版支持 `number/number` 和独占绑定，覆盖现有范围与坐标组件；其他组合在注册时拒绝。主槽位可以与命名槽位共存，通过一次 `setMany` 事务提交；任一槽位或关系校验失败时不改变状态。`required` 要求源码提供绑定名，集合长度上限使用字面量或静态数值属性。

组件获得 `visible`、`disabled`、`mode` 和 `resetToken`。静态绑定句柄拒绝写入；运行时服务在静态模式下拒绝 setter，并忽略 reset。实现通过 React effect 清理局部资源。内容与源码范围以公开投影交付，组件无需使用内部 AST。

渲染能力描述支持的环境。展示容器、结构子项和有交互的控件都能支持交互文档；是否拥有可写状态由绑定声明决定。额外 React 预设只能装配配置已声明的实现，同名默认组件覆盖会被拒绝。

## 外部消费验证

独立消费样例包含原有评分控件、提示容器和主题，以及第二阶段的坐标、字符串集合、数字集合与 Markdown 容器。坐标、多选和容器契约取自公开默认预设，React 实现由消费项目自行编写。

`npm.cmd run test:sdk-consumer` 在仓库外安装真实 tarball，并检查公开 TypeScript、无 React/DOM 的核心 SDK、SSR、真实浏览器 Worker、作者工具、导出预检和断网恢复。复杂组件检查还覆盖原子回滚、集合限制与副本、面板重置、禁用/隐藏和静态输出。桌面与手机检查分别使用 1280px 和 390px。

验证结果保存在 `artifacts/sdk-consumer/verification.json`，其中包含消费目录、tarball SHA256 和实际检查项。导出的单文件 HTML 同目录保存。默认组件的生产 Demo 检查结果、核心测试及构建日志位于 `artifacts/sdk-phase2/`。

## 验证记录

验收命令和输出保存在本地 `artifacts/sdk-phase2/`。核心回归通过 136 个文件、1866 项测试；Demo 通过 16 个文件、254 项测试。迁移前的 85 组用例保持诊断、状态和静态输出一致，46 个默认组件的外部别名也通过同一语义语料。

| 检查 | 覆盖与记录 |
| --- | --- |
| `npm.cmd run typecheck`、`build:lib` | 核心、React、编辑器、独立运行时和 NodeNext 类型声明 |
| `npm.cmd test` | 完整核心回归；`final-core-tests.log` |
| Demo 测试与生产构建 | `final-demo-tests.log`、`final-demo-build.log` |
| 生产浏览器 | Chromium 核心检查、中英文 V2、桌面/手机；另有视觉、动态属性、约束、日期、计算与主题检查 |
| `test:package`、`test:packed`、`test:docs` | 包入口、真实 tarball 消费及随包文档链接 |
| `test:sdk-consumer` | 仓库外安装、纯核心类型、SSR、Worker、生命周期、1280px/390px 离线与禁用 JavaScript 静态输出；`artifacts/sdk-consumer/verification.json` |

独立审查提出的默认组件 id 冲突、静态写入成功信号、动态属性错误丢失、混合槽位不可写、文档契约覆盖和外部锚点缓存问题均已修正并补充回归。渲染与导航使用宿主已安装的定义；携带契约、版本或摘要不匹配时产生诊断，并阻止外部实现执行和严格导出。动态属性错误保留组件、属性、源码范围及失败原因，恢复后再次出错会重新报告。

本轮记录功能与消费兼容性。产物仍有现存的大 chunk 构建提示，未建立同设备迁移前后的性能阈值；性能优化继续按独立性能规划验收。

## 后续阶段

第三阶段继续处理编辑器与 Demo 的菜单统一、通用构建适配器、依赖和资源自动收集，以及面向组件包作者的合规测试工具。当前离线消费使用宿主显式构建的 bundle；文档需求声明用于匹配已安装契约。
