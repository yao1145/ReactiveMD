# 0.7.0 发布说明

`reactive-md@0.7.0` 同时更新 `latest` 与 `next`，是首个随包发布公开扩展 SDK、`local-draft-3` 语法修订和 CM6 单一编辑器入口的版本，并包含一轮大规模的编译与渲染性能优化。现有导入继续可用；显式声明旧修订的文档，以及使用已删除编辑器字段的宿主，需要按下文迁移。

```sh
npm install reactive-md
# 或固定版本
npm install reactive-md@0.7.0
```

离线安装可使用 [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.7.0.tgz)。

## 语法：local-draft-3

本版本只接受 `local-draft-3`。没有修订指令的源码继续按当前修订读取；显式声明 `local-draft-1` 或 `local-draft-2` 会得到 `local.version.*` 诊断，声明旧修订不会选择旧解析器。

- 新增 `<external name="..." type="...">` 只读声明。正文、条件、图表和计算可以读取宿主通过 `LocalReactiveDocument` 的 `externalValues` 或 `runtime.setExternalValues()` 提供的值。缺失值只让读取它的表达式失败，不会被转换为 `0`、`false` 或空字符串。
- `number`、`slider`、`date`、`input` 和 `textarea` 支持动态 `min`、`max` 与 `required`。约束在写入值和显示控件时检查；范围收窄时保留已存值并显示约束错误，不会静默截断。
- 共享绑定必须声明相同的静态范围和步长；边界为动态时，表达式也必须相同。日期边界和 `required` 遵循同一规则。
- 可选修订指令仍为一行：`<!-- reactive-md: local-draft-3 -->`。`inspectLocalSourceVersion`、`checkLocalUpgrade` 和 `migrateLocalSource` 在编译器外提供同样的检查，`reactive-md migrate` 负责单份源码的元数据迁移并阻止正文级冲突。
- 从 `local-draft-2` 迁移时，新激活的 `<external>` 标签会被阻止。迁移前先把字面示例放进代码块；迁移器不改写正文。

## 扩展 SDK

`0.7.0` 正式发布此前只能从源码 tarball 使用的 SDK 入口：

| 入口 | 用途 |
| --- | --- |
| `reactive-md/sdk` | manifest、配置、主题与版本契约 |
| `reactive-md/vite` | Vite 适配器、虚拟宿主、样式加载与依赖去重 |
| `reactive-md/react` | 渲染器，以及 `defineReactComponent`、`createReactConfig`、`createReactHost` |
| `reactive-md/build` | 资源收集与独立包构建 |
| `reactive-md/testing`、`/testing/react`、`/testing/browser` | manifest、行为、SSR 与浏览器合规工具 |
| `reactive-md/authoring` | 不含 React 与 CSS 的 schema、目录和编辑器工具 |
| `reactive-md/export` | 可分享 HTML 与状态恢复 |
| `reactive-md/react/server` | 严格静态渲染 |
| `reactive-md/standalone` | 浏览器挂载 API |

`defineLocalComponent`、`defineReactComponentPackage`、`createLocalConfig`、`createReactConfig`、`createReactHost`、`defineLocalTheme` 与 `composeLocalTheme` 组成作者路径。Vite 适配器读取一份注册模块，统一配置样式、依赖去重和离线运行时。组件包可以声明样式、作者信息、依赖、能力与资源；编辑器目录、预览和离线导出共用同一份注册。

`component-protocol-3` 新增宿主 inline/container 形态与标量绑定。默认预设的 46 个组件与外部组件使用同一个公开校验器和契约。版本范围写 `^0.7.0`，依赖项使用 `{ id, version }`。

旧版 `hostComponents`、`hostRenderer` 和 `hostData` 仍可用于迁移。旧注册不能与新配置混用；请按 [SDK 迁移指南](../integration/extension-sdk-ch.md) 迁移后再重建离线包。

## 编辑器与作者工具

`reactive-md/editor` 现在只使用 CodeMirror 6；`reactive-md/editor/codemirror` 保留为同一组件、样式和运行时的别名。textarea 编辑器及其 `textareaRef`、`getTextarea` 已移除。使用 ref 的 `getSource()`、`getSelection()`、`selectRange()` 和 `getEditorElement()` 访问源码与 DOM。文档中的 `<textarea>` 表单组件继续受支持。

作者菜单改为从组件 manifest 派生，外部组件包会带着标题、分类、说明和插入模板进入编辑器目录。本轮还新增预览到源码的定位，并修复输入法提交、换行与选区保留，以及面板滚动同步。

## 性能

本版本包含 2026-10-29 测量的增量编译与编辑优化：

- 块级会话只编译变化的块，其余块复用。
- 大列表和表格复用行计划与未修改行的节点身份；移位后的 UTF-16 范围保持准确。
- Worker 在补丁成本高于刷新时直接返回同一修订的完整成功结果，保留协商后的修订链，并为深层结构协商扁平结果格式。
- 深层容器改用迭代遍历并提前终止预算；超过 100 层的组件和超过 1,000 层的 Markdown 会在重活开始前被拒绝。
- 600 节文章从完整编译 282 ms 降到增量会话 62 ms，仅编译 1 块、复用 1,799 块。
- 500 行动态表格从输入到预览 286 ms 降到 134 ms。
- 1,000 项动态列表连续编辑 500 次后，GC 后堆增长约 0.463 MiB。
- 100 万字符纯文本文档首次编译 12.26 ms，稳态中位数 5.15 ms。

完整的场景矩阵、回归项、内存检查、预算和复现命令见[性能总览](../development/performance-overview-ch.md)。

## Demo 与示例包

Demo 改为从 `demo/vendor/` 安装 Tetris 与 2048 的 npm tarball，通过公开入口读取实现与 notices，并在生产与开发模式下验证两个包。由于组件名必须以字母开头，2048 使用 `<game-2048>` 标签。仓库同时提供组件包模板、独立接入示例和更新后的插件开发指南。

## 兼容性

- 包版本：`0.7.0`；`latest` 与 `next` 都指向此版本。
- 语法修订：`local-draft-3`；组块协议 `component-protocol-3`；主题协议 `reactive-md-theme-1` 保持不变。
- 显式声明 `local-draft-1` 或 `local-draft-2` 的文档会被拒绝。使用 `reactive-md migrate` 迁移，或继续用旧包版本渲染。
- 新激活的 `<external>` 标签和动态约束可能改变原本按字面显示的源码。请把字面示例移入行内代码或代码围栏。
- `LOCAL_SDK_VERSION` 改变配置键。携带旧 `componentConfigKey` 的文档会报告 `local.extension.config-mismatch`，需要用已安装的配置重新编译。
- 编辑器 textarea ref 字段已移除，请改用上述编辑器 ref API。
- 持久化原始 `.reactive.md` 源码，不要持久化运行时 AST 或内存状态。迁移会改变源码摘要，迁移后应重新导出 `reactive-md-state/v1` 文件。

## 验证与限制

本版本使用完整的 `npm run verify:release` 门禁：核心与 Demo 测试、类型检查、构建、第三方 notices、包入口、文档链接、仓库外真实 tarball 消费及浏览器交互。CI 在 Node 22.12 与 24 上运行 Node 门禁；浏览器门禁在 Chromium 上运行完整套件，并在 Firefox/WebKit 上运行核心工作流。本机浏览器检查使用 Microsoft Edge。Firefox 与 WebKit 的完整交互套件，以及导出 HTML 之外的通用 SSR 水合仍未验证。

项目仍处于 0.x 预览阶段。安全边界与宿主责任见 [SECURITY.md](../../SECURITY.md)。
