# 0.5.0 预览版发布说明

`reactive-md@0.5.0` 是目标渠道为 `next` 的 0.x 预览版。语法修订仍为 `local-draft-2`，组块协议为 `component-protocol-1`，主题协议为 `reactive-md-theme-1`。现有 0.4.x 导入和文档无需迁移，`latest` 仍为 `0.4.0`。

```sh
npm install reactive-md@next
# 或固定预览版
npm install reactive-md@0.5.0
```

离线安装可下载 [npm 安装包](https://registry.npmjs.org/reactive-md/-/reactive-md-0.5.0.tgz)。

## 编辑器入口

`0.5.0` 新增 `reactive-md/editor`，这是从 Playground 抽出的受控 React 19 源码编辑器。它提供源码高亮、Markdown 格式化、组块插入模板、补全、绑定导航、重命名、格式化、撤销重做、行号和滚动同步。语言与主题按实例配置。

编辑器使用独立样式表 `reactive-md/editor/styles.css`，规则限定在编辑器根节点，因此可以在不加载文档渲染样式时使用。需要显示预览的宿主仍按原有方式引入 `reactive-md/styles.css`。

`ReactiveMarkdownEditor` 接收 `value` 和 `onChange`，并通过 ref 句柄提供聚焦、选区、textarea 访问、撤销和重做。可选的 `diagnostics` 和 `document` 属性增加行号标记与绑定值类型。作者工具在本地分析源码；宿主通过 `onExport` 接入工具栏导出操作，并自行连接预览与存储。完整属性表、历史规则、只读模式和服务端渲染说明见 [React 源码编辑器](../integration/editor-ch.md)。

## 文档渲染

泛型、比较式和货币现在按普通正文保留，不再被识别为组件标签或公式。支持无属性的 `<b>`、`<i>`、`<u>`、`<s>`、`<mark>` 和 `<br>` 基础格式。Markdown 脚注按正文排版，包含编号、重复引用及返回链接。

这些新增能力扩展正文解析与文档渲染。语法修订、组块协议和主题协议保持不变。

代码围栏支持 JavaScript、TypeScript、Python、JSON、Bash、HTML、CSS 等常见语言高亮。复制按钮保留原文，并显示成功或失败反馈。未知语言及超过 20,000 字符的代码块按纯文本显示。静态输出保留高亮；静态输出与打印不显示复制控件。

通过宿主 URL 策略的图片可以点击放大，也可用 Enter 或空格打开；关闭按钮、Esc 和遮罩都能关闭预览，并恢复原图焦点。带链接的图片保留链接导航，静态输出保留普通图片。用法见[作者指南](../guides/local-guide-ch.md)与[图片策略](../integration/local-integration-ch.md#图片与链接策略)。

## 兼容性

现有 `reactive-md`、`reactive-md/react` 和 `reactive-md/styles.css` 导入继续有效，渲染器入口未变。为 `0.4.x` 编写的文档无需修改。本版本新增公开入口；只渲染文档的项目可以直接升级。

编辑器需要 React 19，核心 `reactive-md` 入口仍不依赖 React。版本轴与迁移规则见[变更记录](../../CHANGELOG-ch.md)和[版本与兼容性](../compatibility/compatibility-ch.md)。

## 验证与限制

0.5.0 发布门禁覆盖核心与渲染器测试、编辑器入口、类型检查、包入口、文档链接、离线安装包消费、静态渲染和浏览器交互。CI 目标为 Node 22.12、24 与 Chromium；本地浏览器检查使用 Windows 上的 Microsoft Edge。导出 HTML 以外的通用 SSR 水合、Firefox 和 WebKit 尚未验证。

项目仍处于 0.x 预览阶段。安全边界和宿主职责见 [SECURITY-ch.md](../../SECURITY-ch.md)。
