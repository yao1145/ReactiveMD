# 扩展 SDK 第三阶段交付与验收

状态：实现与整合中，集中验收待完成。基线：`2eadc8c5ea5afc14c685731f8b02e10079e01310`。包版本保持 `0.6.1`，新增入口随之后的 npm 版本发布。

本阶段完成第三方组件从注册、编辑、测试到离线分享的消费路径。[架构规划](extension-sdk-plan-ch.md)中的 P3.1 至 P3.5 为验收范围。公开用法见 [SDK 指南](../integration/extension-sdk-ch.md)，可复制项目见[组件包模板](../../examples/component-package/README-ch.md)。

| 规划项 | 实现方向 | 验收要求 |
| --- | --- | --- |
| P3.1 | 编辑器与 Demo 消费同一组件目录；默认预设保存作者信息 | 外部控件和容器进入菜单、搜索、帮助、插入与闭合；编辑结果可编译并支持撤销/重做 |
| P3.2 | `reactive-md/build` 提供 Node 构建适配；实现与资源由宿主显式声明 | 包外项目生成单文件 bundle，收集 CSS、字体、图片和 notices，拒绝缺失或越界资源 |
| P3.3 | 导出与恢复携带版本、组件、主题和资源要求 | 不匹配在状态应用及 React 挂载之前失败；旧载荷保持可用 |
| P3.4 | `reactive-md/testing` 及 React、浏览器子入口；独立组件包模板 | 内置与用户组件执行同一套合规工具；缺少能力证据时不能报告完整通过 |
| P3.5 | 双语消费、主题与迁移说明；真实安装包和完整发布门禁 | 安装包外部消费、桌面/手机离线恢复以及完整门禁产生实际记录 |

## 公开入口

第三阶段新增入口，均以源码构建的 tarball 提供：

| 入口 | 作用 |
| --- | --- |
| `reactive-md/build` | Node 构建适配、预检、资源与声明收集、bundle 清单。 |
| `reactive-md/testing` | 无 React/DOM 依赖的 manifest 与绑定行为合规。 |
| `reactive-md/testing/react` | 静态渲染、严格 SSR 与服务器错误探针。 |
| `reactive-md/testing/browser` | 可移植浏览器生命周期与离线检查，附 Playwright 适配器。 |

既有入口继续承担其余公开面：`reactive-md/sdk` 定义组件与主题，`reactive-md/react` 装配实现，`reactive-md/authoring` 提供目录与插入，`reactive-md/export` 生成计划、bundle seal 与恢复要求，`reactive-md/standalone` 负责挂载。`package.json` 的 `exports` 同时提供 JavaScript 与类型声明。

源码位置：`src/build/`、`src/testing/`、`src/export/`、`src/authoring/`。构建配置为 `vite.build.config.ts`，独立于浏览器、核心和作者工具依赖图。

## 作者目录与编辑器

组件目录从同一份 manifest 集合派生。`createLocalComponentCatalog(config, locale)` 返回分组、标题、说明、属性提示和插入模板；`insertLocalComponent` 分配绑定名并应用选区与光标模板；`validateLocalComponentInsertTemplates` 编译实际插入结果，报告与配置不匹配的模板。默认预设的 46 个组件契约中，34 个带有独立插入菜单信息；子项继续由 schema 提供补全和结构约束。外部组件使用同一读取路径。

编辑器与 Demo 通过公开目录消费这些数据。菜单、搜索、帮助、插入与成对标签闭合不再单独维护组件清单。撤销与重做仍由编辑器的源码替换路径负责，插入操作返回普通编辑结果。

## 构建与运行边界

浏览器使用宿主预先构建的 bundle。Node 适配器读取宿主明确指定的模块，模块导出组件配置和 React 实现；第三方代码仍是宿主安装的依赖。文档中的名称或 URL 不会触发代码下载。

宿主入口是 Node 可加载的 ESM，导出 `config`、`reactConfig`、`root` 和 `allowlist`，可选导出 `resources`（或 `styles`）与 `notices`。资源收集以 `root` 为根目录，allowlist 与入口都必须位于其中；JavaScript 依赖仍由正常模块解析和构建流程导入。

`preflightLocalStandaloneBuild` 在执行构建前校验配置摘要、React 实现与 manifest 是否一致、`static`/`interactive`/`offline` 能力和每条 CSS 引用。`buildLocalStandaloneBundle` 复用预检，返回扁平结果：`script`、`extensions`、`seal`、`configKey`、`resources`、`assets`、`css`、`notices` 与 `manifest`。`LocalBuildError` 携带完整诊断。

构建清单协议为 `reactive-md-build/v1`，记录 SDK 版本、配置摘要、IIFE 格式、脚本摘要与字节数、资源来源与摘要、内联资源、组件需求、全部已安装主题及声明条目。清单同时用于归档核验和导出 seal 的一致性检查。

CSS 引用的本地资源在允许目录内解析和内联；资源按身份与内容摘要去重，组件默认样式先于主题。缺失文件、远程引用、目录越界、符号链接逃逸、循环引用、预算超限和身份冲突产生结构化诊断。预算覆盖值逐项校验，非法值回退默认值。

Vite 8 是可选 peer，只在真正构建时动态加载。测试或非标准宿主可注入 `{ build }` facade。构建输出必须是一个无 asset 的 chunk；脚本中出现 `import.meta`、动态 import、Worker、service worker、网络请求或远程模块时拒绝产出。

## 导出、主题与恢复

SDK 导出使用 v2 HTML 载荷，记录 `reactive-md-restore/v1` 要求；普通导出保持原有 v1 默认行为。`reactive-md-state/v1` 的用途不变。

`defineLocalStandaloneBundle` 把宿主脚本与已安装配置绑定，seal 协议为 `reactive-md-bundle/v1`，记录 SDK 版本、配置摘要、脚本摘要和每个主题的契约摘要。`createLocalExportPlan` 在生成输出或序列化状态前检查目标能力、组件身份与版本、语义摘要、主题选择和样式资源；离线目标还要求 bundle 脚本、seal 一致、组件覆盖和所选主题与 seal 中的主题一致。

`createLocalRestorationRequirements` 记录 SDK 范围、配置摘要、源码摘要、目标、实际使用的组件及版本范围与契约摘要、主题和资源摘要。`validateLocalRestorationRequirements` 在应用状态及挂载 React 之前检查协议、SDK 范围、配置、源码、组件、能力、主题与资源。缺失或不匹配直接阻止恢复。版本范围允许升级时，变化的契约仍要求重新编译并校验状态。

宿主已安装的组件定义决定执行语义。资源从载荷传递时重新检查内联 CSS 和预算；样式随实例挂载和卸载。bundle 的同步内容校验用于发现构建错配；构建清单同时提供 SHA-256，便于归档与外部核验。

## 合规工具

纯核心工具验证 manifest、属性和真实内核绑定行为；React 子入口验证静态与 SSR；浏览器工具验证挂载、编辑、隐藏、禁用、重置、错误隔离、清理、hydration 和离线请求。报告逐项区分通过、失败、跳过与不支持。

能力证据只来自带该能力标签的通过用例。没有实际执行证据时，声明的能力保持缺失，汇总报告的 `complete` 为假。`compareLocalComplianceParity` 按用例 id、状态和观测值比较两份结果，用于核对默认契约与外部别名。

浏览器场景通过 driver 接口执行，默认覆盖 `mount`、`edit`、`hide-show`、`disabled`、`reset`、`descendant-error` 和 `unmount`；离线证据另要求 hydration、断网上下文、无 http(s)/ws 请求和未预期错误。`createPlaywrightBrowserDriver` 适配已有 context，不引入硬依赖。

## 组件包模板

模板位于 `examples/component-package/`，通过公开入口定义组件、主题、资源和声明。验收时复制到仓库外，安装真实 tarball，执行模板的构建与测试；实现不依赖仓库源码别名。

模板的 `npm test` 执行完整流程：构建 Node 入口与类型声明，生成实际的单文件离线 HTML，运行评分控件和单独的 note 生命周期，再汇总合规报告。浏览器检查以 `file:` 打开离线页面，并断言无网络请求。`npm run test:node` 明确跳过浏览器证据并写出 `complete:false`。

模板提供编译后的 JavaScript 与 `.d.ts`，通过 `exports` 映射提供 `.`、`./react`、`./theme` 与 `./styles.css`。模板保持 `private`；重命名、选择许可证并移除 `private` 属于明确发布前的步骤，模板本身不执行发布。

## 迁移

旧 `hostComponents`、`hostRenderer` 和 `hostData` 保留。它们与新配置同时传入时被拒绝。旧声明在输入层转换为统一 schema，旧 renderer 保留原有属性行为。迁移到 `defineLocalComponent` 与 `defineReactComponent` 后，文档需要重新编译，独立 bundle 需要重建，因为配置摘要、seal 和恢复要求都会变化。

## 验证记录

集中验收后填写实际命令、结果、包摘要、消费目录和浏览器覆盖。过程记录位于本地 `artifacts/sdk-phase3/`。在协调者补齐证据之前，本页不记录完整通过结论。

| 检查项 | 待记录内容 |
| --- | --- |
| 构建与类型 | `build:lib`、`typecheck` 的实际输出与包摘要。 |
| 核心合规 | manifest、绑定、回滚、重置与集合副本用例。 |
| SSR 与导出 | 严格 server 渲染、bundle seal、恢复预检。 |
| 浏览器 | 桌面与手机宽度、离线、hydration、生命周期与错误隔离。 |
| 外部消费 | 仓库外安装 tarball、模板 `npm test`、公开 JS 与类型入口。 |
