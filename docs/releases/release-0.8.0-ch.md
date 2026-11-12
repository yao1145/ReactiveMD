# 0.8.0 发布说明（2026-11-12）

**中文** · [English](release-0.8.0-en.md)

本页记录 `reactive-md@0.8.0` 的发行内容、破坏性变更和发布检查。引擎先发布，编辑器随后发布：`reactive-md-editor@0.1.0` 是独立仓库中的独立包。

## 发布状态

| 项目 | 值 |
| --- | --- |
| 引擎包 | `reactive-md@0.8.0`（2026-11-12；latest） |
| 编辑器包 | `reactive-md-editor@0.1.0`（独立包；在引擎之后发布） |
| SDK 契约 | `0.7.0`（`LOCAL_SDK_VERSION`，保持不变） |
| 语法 | `local-draft-3`（保持不变） |
| 组块协议 | `component-protocol-3`（保持不变） |
| 主题协议 | `reactive-md-theme-1`（保持不变） |
| 状态格式 | `reactive-md-state/v1`；`reactive-md-component-state/v1` |
| 运行环境 | Node.js 22.12 或更新版本；仅 ESM |

引擎和编辑器发布后，安装：

```sh
npm install reactive-md@0.8.0
npm install reactive-md-editor@0.1.0
npm install react@19 react-dom@19
```

`reactive-md/react` 和 `reactive-md-editor` 需要 `react`、`react-dom` 19。Vite 8 是 `reactive-md` 的可选 peer，仅在使用的 `reactive-md/vite` 时需要。

## 破坏性变更

引擎包不再导出编辑器。旧入口属于已发布的 0.7 包，不会进入 0.8。

| `reactive-md` 0.8 移除的入口 | 替代入口 |
| --- | --- |
| `reactive-md/editor` | `reactive-md-editor` |
| `reactive-md/editor/codemirror` | `reactive-md-editor/codemirror` |
| `reactive-md/editor/styles.css` | `reactive-md-editor/styles.css` |
| `reactive-md/editor/codemirror/styles.css` | `reactive-md-editor/codemirror/styles.css` |

编辑器仍是受控的 React 19 组件，编辑能力保持不变：高亮、工具栏与插入命令、补全、绑定导航、重命名与格式化、撤销重做、诊断和 ref 句柄。见[编辑器指南](../integration/editor-ch.md)和[三仓库迁移说明](../integration/repository-split-ch.md)。

本次变更不附带文档语法或状态格式迁移。`local-draft-3` 仍是唯一接受的修订，SDK、组块、主题和状态协议保持原值。恢复状态时仍校验源码摘要、组件配置键和身份。

## 最小升级步骤

1. 将引擎升级到 `reactive-md@0.8.0`。
2. 如果应用渲染源码编辑器，添加 `reactive-md-editor@0.1.0`，并替换上表中的四个导入与样式表路径。源码继续保存在应用状态中，预览继续使用 `reactive-md/react`。
3. 如果应用使用 `reactive-md/vite` 的 `reactiveMd()`，保留现有 Vite 配置。目录发现不需要改导入；适配器本身需要 Vite 8。
4. 文档源码和状态文件保持原样。升级后用应用自己的文档重新运行编译与渲染检查。

## 编译入口

本次发布新增两个单次编译入口，返回普通数据，由宿主执行或渲染：

```ts
import { createCompiler } from 'reactive-md/compiler';
import { createStandardCompiler } from 'reactive-md/compiler/standard';

const minimal = createCompiler().compile('# Notes');
const standard = createStandardCompiler().compile('<number bind="n" label="数量" initial="2">\n\n{{ n * 3 }}');
```

`createCompiler` 不注册组件，保留 CommonMark、RMD 结构、表达式、绑定和预算。`createStandardCompiler` 安装默认预设和 KaTeX 展示检查。编译不创建编辑会话、Worker 或运行时，也不加载 React、主题实现或 CSS。结果使用 `status: 'valid' | 'recovered' | 'failed'`，并保留 `ok`、`document` 读取方式。最小入口的结果带有自己的组件配置键，把它交给使用默认配置的现有渲染器会报告 `local.extension.config-mismatch`；现有 React 与 SSR 宿主应使用标准入口。

两个工厂都接受 `strict`，严格模式是默认值。设置 `strict: false` 后，未闭合或错配的区域保留为原始文本，每个最终恢复产生一条稳定 warning，编译在可靠边界继续。可恢复的结构问题不会降级绑定、类型、配置、版本或预算错误。两种模式都把无空行的 `<details>` / `<summary>` 片段映射为单个 disclosure。见[单次编译入口](../integration/compiler-ch.md)和[严格模式与局部恢复](../reference/tolerance-ch.md)。

## 运行时服务与持久化

新增公开入口覆盖组件的时间、随机和进度保存：

- `reactive-md/runtime` 提供文档与组件身份、可序列化种子随机、注入式时钟与调度器、组件状态注册表及其预算。
- `reactive-md/runtime/browser` 提供基于 Web Storage 的持久化后端和 `flushComponentStateOnPageHide`。注册表接受任意 `LocalComponentStateStorage`。
- `reactive-md/react/runtime` 提供 `useTicker`、`useFrame`、`useSwipe`、`useKeys` 和 `useComponentState`。

`LocalRuntimeOptions` 和 React 文档组件接受 `documentId`、`randomSeed`、`componentState`、`componentStateStorage` 与 `componentStateWriteDelayMs`。写入延迟可合并高频保存；`state.flush()` 立即写入待处理状态，运行时销毁时也会补写。后端写入失败时最新状态保持待写，下一次保存、flush 或销毁会重试。`onComponentStateChange` 报告显式保存与清除。

组件状态使用独立的 `reactive-md-component-state/v1` sidecar，不改变 `reactive-md-state/v1`。跨编辑恢复需要显式 `state-key`；没有该属性时，只保证同一源码和同一会话内可恢复。SDK 契约版本仍为 0.7.0；扩展装配发生变化时，需要重新编译，并按实际配置重新导出。

## Vite 目录

当 `reactiveMd()` 未传入 `extensions` 模块时，适配器扫描 Vite 根目录下 `theme/` 与 `plugin/` 的直接子目录：

```text
theme/paper/theme.css
theme/paper/theme.json       # 可选
plugin/tetris/index.ts
plugin/tetris/component.css  # 可选
```

主题 CSS、本地导入和相对资源通过有界构建资源收集器解析并内联。远程引用、越界路径和预算超限会失败。使用 `reactiveMd({ extensions: './extensions.ts' })` 的手动注册仍然可用；目录选项与手动选项互斥。见[目录接入规则](../integration/directory-discovery-ch.md)。

## 默认 UI、图表、Mafs、图解与画廊

- `<gallery>` 与 `<gallery-item>` 进入默认预设和插入目录。它们混排图片、卡片与 Markdown，使用原生强制停靠，支持滚轮、键盘和拖动浏览，使用 h3 标题，并生成完整的静态输出。
- 默认图表为每个柱子提供独立的悬浮与聚焦目标，在环形图图例中显示每个可见扇区的占比，并允许图例开关系列或扇区。柱、线、点和弧的几何变化带有动画；减少动态效果偏好会跳过动画。
- 交互式 `<coordinate>` 与 `<plot>` 使用 Mafs，支持拖拽吸附点、平移缩放、点击曲线聚焦并淡化其余曲线，以及聚焦曲线上的鼠标跟随点。服务端渲染、静态导出与打印保留 SVG 输出。
- 默认主题图解在悬浮或聚焦节点时显示说明浮层，增加缩放与适应控制、关联路径高亮、整框状态配色和长标题处理。静态输出保留节点说明。
- 默认主题本轮还让函数图按轴范围适配并保持屏幕网格正方形，让 tooltip 浮层避开嵌套容器裁剪，恢复主按钮文字对比度，统一 Jump 按钮样式，并为可交互选项增加短促的选中反馈。

## 静态、SSR 与离线边界

- 交互式导出内嵌经过校验的 `reactive-md-component-state/v1` sidecar，并在首次渲染前恢复。静态导出不运行组件运行时，并拒绝 `--component-state-file`。
- Mafs 交互只存在于客户端渲染器。服务端渲染、静态导出和打印使用 SVG 坐标与曲线输出。
- 打包消费者检查覆盖静态 SSR 与声明文件。单文件导出和水合的浏览器验收由宿主应用与 Demo 负责。
- 离线 HTML 内嵌源码、运行时、样式和经过校验的本地位图。组件状态与状态文件仅在其格式和身份匹配时参与。

## 发布与验收

本次发布使用手动 `.github/workflows/publish.yml`、npm trusted publishing（OIDC）、Node 24 和 npm ^11.21。workflow 文件名保持稳定，以匹配已配置的 trusted publisher。提交或推送不会发布 npm 包。发布需要明确授权。

按以下顺序发布：

1. 发布 `reactive-md@0.8.0`；核对 registry 中的 tarball、完整性和本次选择的 dist-tags。
2. 引擎可用后发布 `reactive-md-editor@0.1.0`；编辑器的 peer 范围指向已发布的引擎。

打包前，引擎运行 `npm run check` 和 `npm run notices`。检查包括构建和类型检查、保留的回归、编译入口边界，以及把实际 tarball 安装到全新消费者中验证公开 API 和 NodeNext 声明。registry 完整性与 dist-tags 属于发布后的独立检查。

## 发布当天清单

- 对照完成的发布核对日期与状态。
- 查询 registry 中的已发布版本后，再更新 README 的安装 pin 和兼容性页的分发标签行。
- 发布编辑器前，确认其 peer 范围指向已发布的引擎。
- 记录两个包经过验证的 registry tarball 与完整性值。

另见[版本与兼容性](../compatibility/compatibility-ch.md)、[源码修订与迁移](../compatibility/source-versioning-ch.md)，以及上一个已发布版本的[0.7.0 发布说明](release-0.7.0-ch.md)。
