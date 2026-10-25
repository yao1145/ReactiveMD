# 0.5.1 预览版发布说明

`reactive-md@0.5.1` 是面向 `next` 渠道的 0.x 预览版。语法仍为 `local-draft-2`，组块协议为 `component-protocol-1`，主题协议为 `reactive-md-theme-1`。现有 0.5.x 导入和文档无需迁移。`latest` 仍为 `0.4.0`。

```sh
npm install reactive-md@next
# 或固定预览版
npm install reactive-md@0.5.1
```

离线安装可下载 [npm 安装包](https://registry.npmjs.org/reactive-md/-/reactive-md-0.5.1.tgz)。

## 编辑器视图与主题

`ReactiveMarkdownEditor` 在编辑区下方新增底栏，显示 Unicode 字数和键盘提示，并提供编辑、并排和预览三种视图。传入 `preview` 后，宿主内容会渲染在编辑器框架内；`viewMode` 和 `onViewModeChange` 用于受控切换，`defaultViewMode` 设置非受控实例的初始视图。切换视图会保留源码选区、撤销记录和预览组件的状态。

容器宽度不超过 600px 时只提供编辑和预览。仅编辑源码的实例保留字数和键盘提示。在源码中先按 Esc 再按 Tab 可把焦点移到工具栏。

编辑区、行号、语法高亮、工具栏和菜单跟随实例主题。浅色模式使用白色编辑区，深色模式保留深蓝底色，`auto` 跟随系统设置。宿主页面主题与编辑器主题相互独立。

完整属性表和视图行为见 [React 源码编辑器](editor-ch.md)。

## HTML 兼容

默认渲染器新增 P0 HTML 子集，包括富文本折叠、容器、标题、代码、列表、链接和图片。宿主可额外开启作者 CSS、JavaScript 和扩展 HTML；三个选项默认全部关闭。任意开启一个，整篇文档分流到隔离的原生 HTML 路径，该路径停止解析 Markdown 和 ReactiveMD。

这项分流是下一版本前的暂时策略。静态导出禁用作者 JavaScript。支持的子集、选项和冲突规则见 [HTML 部分兼容](html-compatibility-ch.md)。

## 兼容性

现有 `reactive-md`、`reactive-md/react`、`reactive-md/editor` 和 `reactive-md/styles.css` 导入保持不变。为 `0.4.x` 和 `0.5.0` 编写的文档无需修改。语法修订、组块协议和主题协议版本不变。

编辑器需要 React 19；核心 `reactive-md` 入口仍不依赖 React。版本轴说明见[变更记录](../CHANGELOG-ch.md)和[版本与兼容性](compatibility-ch.md)。

## 验证与限制

0.5.1 发布门禁覆盖核心与渲染器测试、编辑器入口及其视图、类型检查、包入口、文档链接、离线安装包消费、静态渲染和浏览器交互。CI 使用 Node 22.12 和 24 搭配 Chromium；本机浏览器检查使用 Microsoft Edge。导出 HTML 之外的通用 SSR 水合、Firefox 和 WebKit 尚未验证。

项目仍处于 0.x 预览阶段。安全边界和宿主责任见 [SECURITY-ch.md](../SECURITY-ch.md)。
