# 0.5.3 预览版

使用 `npm install reactive-md@0.5.3` 或 `npm install reactive-md@next` 安装。语法修订保持 `local-draft-2`，组块协议保持 `component-protocol-2`，主题协议保持 `reactive-md-theme-1`。`latest` 渠道仍为 `0.4.0`。

## 宿主集成

- 在 `LocalCompileOptions` 中设置 `markdownBreaks: true`，把 Markdown 软换行显示为换行。配置贯通编译、React 预览、worker 与缓存键，源码 UTF-16 偏移保持不变；默认值为 `false`。
- 用 `reactive-md/react/unstyled` 加载无样式依赖的 React 渲染器。按需引入 `reactive-md/screen.css`（也可用原有 `reactive-md/styles.css`），打印时再引入 `reactive-md/print.css`。屏幕样式不再设置全局 `@page`；独立 HTML 保留自身的打印样式。
- 从 `reactive-md` 导入 `localCompileOptionsKey`，从任一 React 入口导入 `LocalRenderContext` 类型。

## 作者工具

新增 `reactive-md/authoring` 纯函数入口，提供 schema、组件目录、模板辅助函数、插入命令和类型，无需加载 React 或 CSS，可供 CM6 等宿主编辑器使用。

`analyzeLocalSource(source, options)`、`completeLocalSource(source, offset, options)`、`renameLocalBinding(source, oldName, newName, options)` 和 `formatLocalSource(source, options)` 接受可选 `LocalCompileOptions`。传入与预览相同的配置，即可统一宿主组件、原生 HTML 分流和资源预算的判断。

## 数学诊断

不支持的显示命令、环境及渲染预算降级会产生带源码范围的警告。降级时仍以转义文本保留公式内容；显示支持与计算支持分别判断。

## 兼容性

已有入口继续可用。需要文档打印布局的宿主须显式导入可选打印样式，无需迁移文档语法或协议。

参见[更新日志](../CHANGELOG-ch.md)、[作者工具](author-tools-ch.md)和[集成指南](local-integration-ch.md)。