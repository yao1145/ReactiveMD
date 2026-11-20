# ReactiveMD 0.9.0

[English](release-0.9.0-en.md) · **中文**

从 npm 安装 `reactive-md@0.9.0`。

```sh
npm install reactive-md@0.9.0
```

## 主要更新

### 主题层叠与控件

默认主题现以语义 token 和 CSS 层定义文档结构及组件样式基线。宿主和扩展可以在共享 token 的同时覆盖主题层。标题比例覆盖 h1 至 h6，默认控件与表格样式也已和文档排版统一。详见[主题协议](../reference/theme-protocol-ch.md)和[主题集成指南](../integration/local-integration-ch.md)。

### 18 个组件的精简预设

`reactive-md/presets/minimal` 与 `reactive-md/react/minimal` 提供输入、基础布局、条件内容、提示、徽标、导航和文本组件，不加载完整默认组件集。图表、网络或其他官方包可通过扩展 SDK 显式添加。精简预设由 minimal-budget 示例和脚手架检查覆盖。

### 静态 PDF 导出

CLI 新增 `--format pdf`，Node 宿主可从 `reactive-md/pdf` 调用 `renderLocalPdf`。PDF 使用 Chromium 渲染静态 HTML，并支持纸张、横向、页边距和打印背景设置。导出环境需要安装 Playwright 及其 Chromium 浏览器。

### 具名宿主网络通道

宿主可以通过运行时向文档开放命名提交与订阅通道。文档使用通道名，宿主管理端点、凭据、校验、传输、取消和幂等键。适配器包括 HTTP 提交、SSE、WebSocket 和 WebRTC。通道限制 JSON 负载大小，也可将订阅数据映射到外部变量。参阅[宿主网络指南](../integration/network-host-ch.md)和[网络问卷示例](../../examples/network-survey/README.md)。

### 绘图公式与扩展入门

`<plot>` 支持 `r = f(θ)` 等极坐标方程，并允许为显式、参数和极坐标曲线配置采样点数。采样遵守整篇文档的计算预算。扩展作者教程现覆盖组件创建、预览、SSR、离线导出和包检查。`reactive-md/export-assets` 入口为构建工具提供 HTML 导出文件的稳定清单。

### 其他更新

- 提示框新增 `error` 色调和 `role="alert"`。静态属性和动态色调表达式都支持 `error`。
- 修复解析器屏蔽、表格管道符、HTML 属性解码、状态恢复校验、动态约束和增量会话边界。
- 诊断、状态采样、图表标签与 CLI 输出截断时，不会留下落单的 UTF-16 高代理项。
- 已按当前源码布局重新测量性能总览。

## 兼容性

本次包发布不改变语法、SDK、主题、组件或状态协议版本。`local-draft-3`、`component-protocol-3`、`reactive-md-theme-1`、`reactive-md-state/v1` 和 `0.7.0` SDK 契约继续有效。升级引擎包无需迁移已有文档源码和状态文件。

引擎、编辑器与 Demo 分别发布。通过 `reactive-md-editor` 安装编辑器。
