# 组件组合与静态 PDF 导出计划

**状态：** 主线实现
**范围：** ReactiveMD 核心仓库
**目标：** 允许宿主选择完整或精简的默认组件集合，并将文档编译结果导出为静态 PDF。

## 目标与约束

- 保留当前完整默认预设和默认 React 宿主行为，现有消费者升级后无需改配置。
- 精简模式内置 18 个组件。宿主通过 `plugin/` 自动发现并挂载其余官方组件和第三方组件。
- 编译器语义、React 实现和样式使用同一份组件清单，组合不匹配时在启动或导出前给出诊断。
- 新增 PDF 静态导出：内容来自同一编译与渲染管线，输出无脚本、无交互的 PDF。
- PDF 浏览器/排版引擎作为可选能力安装；普通编译与 HTML 导出不因此增加运行时依赖。
- 保留文档语法、组件协议、状态协议和完整预设的组件清单。精简 React 入口独立于完整预设的渲染入口。

## 当前基础

核心默认清单包含 48 个组件。`src/presets/packs.ts` 已提供 controls、layout、data、visuals 四个语义 pack，其中 visuals 依赖 data。`LocalReactPresetPackage` 已将语义 preset 与 React 实现按 manifest 身份配对。`createReactHost` 支持默认、显式 preset 和空 preset。

当前默认 React 预设集中导入完整组件实现表；语义 pack 尚无对等的默认 React pack 入口。因此，选择组件需要同时解决语义注册、React 实现和样式资源三个层面的配套。

HTML 导出已有 `static` 模式、资源检查、打印样式和可复用的静态渲染结果。CLI 当前只写 HTML，`--format` 尚未实现。

## 方案

### 组件预设

支持三种选择方式：

| 选择 | 行为 |
| --- | --- |
| 完整组合 | 使用现有完整默认预设，作为兼容默认值。 |
| 精简组合 | Vite 使用 `reactiveMd({ defaultPreset: 'minimal' })`，初始化下列 18 个标签并扫描项目目录。 |
| 自定义组合 | 使用 `plugin/` 装配官方包和第三方包。高级宿主可直接向 `createReactHost` 传入预设包和组件包。 |

语义入口 `reactive-md/presets/minimal` 和 React 入口 `reactive-md/presets/minimal/react` 使用同一清单。宿主装配时校验组件标签、实现和预设依赖。缺少依赖时报告包名，由宿主挂载对应包。

精简组合只改变安装的组件能力。编译器仍负责解析文档、计算表达式、实施预算与安全检查；未选组件出现时应返回稳定诊断，并保留原始文本，不能静默丢弃内容。共享语义和组件协议保持不变。

#### 精简预设清单

| 能力 | 组件标签 | 用途 |
| --- | --- | --- |
| 输入（8 个） | `input`、`textarea`、`number`、`slider`、`toggle`、`date`、`select`、`option` | 单行文本与邮箱、多行文本、精确数值、滑动调参、布尔开关、日期和下拉单选。`option` 随 `select` 一起注册。 |
| 输出（4 个） | `text`、`if`、`alert`、`badge` | 行内彩色文字、按条件显示结果、块级提示和行内状态标签。 |
| 排版（4 个） | `panel`、`card`、`grid`、`section` | 参数分组与重置、内容卡片、响应式多列布局和块级文字着色。`grid` 和 `card` 成对注册。 |
| 文档导航（2 个） | `jump`、`anchor` | 跳转到标题或显式锚点。 |

Markdown 标题、段落、列表、图片和表格，以及 `{{ expression }}`、`const`、`computed`、`external`，作为基础语法独立于这 18 个标签。正文和结果组件可通过插值展示当前状态下的计算结果。

#### 官方插件

在项目的 `plugin/<名称>/index.ts` 转出官方包。Vite 和 CLI 使用同一套目录发现与宿主装配代码。

```ts
// plugin/navigation/index.ts
export { default } from 'reactive-md/plugins/navigation';
```

| 包入口后缀 | 组件 |
| --- | --- |
| `forms` | `range-slider`、`checkbox`、`choices`、`radio-group`、`multi-select`、`progress`、`timer`、`quiz`、`counter`、`checklist` |
| `navigation` | `tabs`、`tab`、`steps`、`step`、`accordion`、`disclosure`、`tooltip`、`validation` |
| `data` | `data-table`、`table`、`column`、`timeline` |
| `chart` | `chart` |
| `plot` | `coordinate`、`plot` |
| `diagram` | `diagram`、`node`、`edge` |
| `gallery` | `gallery`、`gallery-item` |

`forms` 依赖精简预设中的 `option`。浏览器安装精简组合时使用 `reactive-md/react/minimal` 与 `reactive-md/styles/minimal.css`。官方插件的附加样式随包注册。

### 静态 PDF

安装 Playwright 和 Chromium 后可直接构建 PDF。使用 `--project-root` 可装配同一项目的精简预设、`plugin/` 和 `theme/`。

```sh
npm install playwright
npx playwright install chromium
reactive-md build doc.reactive.md -o doc.pdf --format pdf --project-root .
```

PDF 复用静态 HTML 生成流程。`reactive-md/pdf` 的 `renderLocalPdf(html, options)` 接受静态 HTML 并返回 PDF 字节。CLI 在请求 PDF 时动态加载该入口。调用方安装 Playwright 和 Chromium，缺少引擎时 CLI 提供安装指引。

静态 PDF 的内容规则：

- 显示编译时选定状态下的值；输入控件显示值或只读呈现，交互按钮与事件行为不输出。
- 复用静态 React 渲染、默认主题、组件资源、KaTeX 字体、图片内联与打印 CSS。
- 使用 print media 生成分页；至少支持纸张尺寸、纵向/横向、页边距和打印背景设置。
- CLI 使用 `--pdf-paper`、`--pdf-landscape`、`--pdf-margin` 和 `--pdf-background on|off` 设置排版。
- 等待字体和图片完成布局后再打印；资源缺失遵循现有严格/宽松策略，并将诊断返回给 CLI。
- PDF adapter 拒绝未通过静态能力检查的扩展组件；不执行文档脚本，不访问远程资源。

先实现 Node CLI 与可选 Playwright adapter。浏览器内直接生成可下载 PDF 作为后续独立能力评估，不与首版共用不稳定的浏览器打印对话框行为。

## 实施阶段

### 阶段 1：清单与接口

- 盘点默认组件、依赖关系、对应 React 实现和样式资源。
- 将「精简预设清单」的 18 个标签用于语义和 React 预设，核对 `select`/`option` 与 `grid`/`card` 的结构依赖。
- 验证完整、精简和目录挂载三种组件装配方式。
- 记录当前完整预设的包体积基线和静态 HTML 导出行为。

**验收**

API 能表达三种组合。现有 `createLocalConfig` 和 `createReactHost` 均可使用包含 18 个标签的精简组合。默认配置通过现有快照检查。

### 阶段 2：组件组合

- 用七个官方插件包覆盖其余 30 个标签。
- 复用目录发现给 Vite 与 CLI 装配同一份宿主配置。
- 增加未知名称、缺失实现、依赖补全、重复组合、缺省完整组合和未选组件诊断的测试。
- 用[预算计算示例](../../examples/local/minimal-budget.reactive.md)验证浏览器渲染、SSR 和静态 HTML 输出。示例在 `panel` 中配置方案、数量和预算，通过 `grid` 和 `card` 并列展示结果，超预算时由 `if` 显示 `alert`。

**验收**

完整组合通过现有行为检查。精简预设的注册结果与 18 标签清单一致，编译、React 与导出使用同一 manifest 集合。文档引用未注册的组件时给出稳定诊断并保留源文本。静态 HTML 显示所选状态的输入值、计算结果和提示。

### 阶段 3：PDF adapter 与 CLI

- 提供 `reactive-md/pdf` 的静态 HTML 打印 API 和可选引擎错误提示。
- 增加 `--format pdf` 与 PDF 排版选项，复用现有 compile、state、asset 和 capability 校验。
- 通过内存页面生成 PDF，完成打印后将文件原子写入目标路径。
- 保持 HTML 格式为默认值，现有命令参数和退出码继续有效。

**验收**

未安装可选引擎时普通 HTML build 正常，PDF 请求返回明确错误。PDF 请求成功时输出有效、可打开且符合静态 PDF 内容规则的文件。预算计算示例的 PDF 和静态 HTML 在同一导出状态下呈现相同的输入值、计算结果和提示。

### 阶段 4：消费端、文档与发布

- 增加完整/精简/自定义组件示例和 PDF CLI 示例。
- 更新中英文导出文档、CLI help、包导出表和兼容说明。
- 在全新 consumer 中分别安装完整依赖和 PDF 可选依赖，验证 ESM、类型、CLI 与 PDF 输出。
- 更新 Demo 的候选核心 tarball 后运行其构建、运行时扩展和导出检查。
- 比较完整与精简组合的 JS/CSS 体积，报告精简实际带来的变化。

**验收：** `npm run check`、preset scaffold 检查、PDF 端到端测试及 Demo 消费测试通过；默认完整组合无回归；发布包不要求所有用户安装 PDF 引擎。

## 主要风险与处理

- **组件能力不一致：** 通过统一工厂从 manifest 清单生成语义和 React 配对，并在配置阶段验证。
- **精简组合没有减小包体：** 将“功能可选”和“包体按需摇树”分别验收。若共享实现模块使精简入口仍引入重量级依赖，记录体积后再决定后续是否需要源码模块调整。
- **打印与浏览器差异：** 固定 Chromium 版本跑端到端 PDF 检查；用代表性文档覆盖长表格、代码块、公式、图表、图片、分页标题和暗色主题。
- **PDF 引擎扩大依赖：** 使用可选入口和显式安装检测；普通编译、React 渲染及 HTML 导出不加载 PDF adapter。
- **浏览器与文档资源安全：** 只渲染经过现有编译和资源检查的静态产物；禁用脚本和远程请求；输出文件先写临时文件，成功后再原子替换目标文件。

## 后续评估

浏览器端直接生成可下载的 PDF。

## 本地验收记录

下表记录精简预设包含 16 个标签时的体积基线。样例使用各自的 React 与 CSS 入口，统计未压缩的生产产物，不含源映射。

| 产物 | 精简组合 | 完整组合 |
| --- | ---: | ---: |
| 浏览器 JS | 1,520,245 B | 3,397,477 B |
| 浏览器 CSS | 547,399 B | 624,981 B |
| 离线运行时 JS | 1,953,069 B | 3,827,721 B |

预算示例用状态文件恢复参数，静态 HTML 与横向 PDF 显示相同的超预算金额。目录挂载的选项卡通过离线 Chromium 验证。独立消费者通过候选 tarball 公开入口检查，并验证缺少 Playwright 时的安装提示。

隔离的 Demo 副本安装了带内容摘要和 lockfile 完整性记录的候选包。生产构建、Worker 编译、组件目录、游戏交互和离线 HTML 导出通过检查。
