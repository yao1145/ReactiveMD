# 本地模块目录结构

[English](local-module-layout-en.md)

当前目录与入口见 [源码地图](../../src/local/README.md)。

## 文件归属

- 源码偏移和编辑器工具归 `source/`。CommonMark 和 RMD 扫描归 `parsing/`，原生 HTML 语法、清理和恢复归 `html/`。
- 组件 schema、归一化、共享规则、资源限制和诊断归 `configuration/`。解析、编译和 SDK 共用这里的组件模型。
- 单次编译归 `compilation/`，跨修订复用归 `compilation/session/`。会话管理缓存，并向编译器提供服务。Worker 消息、序列化和补丁归 `transport/`，文档运行状态和更新归 `runtime/`。
- 表达式解析、推断和内建函数归 `evaluation/expression/`。LaTeX、采样和 KaTeX 显示归 `evaluation/math/`。最小编译器使用 LaTeX 跟踪公式依赖，standard 装配额外启用显示和绘图检查。
- React 文档视图、投影和文档样式归 `rendering/document/`。代码、图片和表格的视图与辅助函数按功能放置。图解布局归 `src/components/diagram/`。文档主题解析和 CSS 级联层契约归 `src/themes/`，React 语言环境归 `src/react/localization.tsx`。

## 契约与导入

文档、节点、诊断和值等跨阶段契约放在 `src/local/types.ts`。解析状态、编译服务、会话统计和视图属性留在各自模块。

直接从实现模块导入。可选能力由用到它的装配入口或功能引入。包根入口通过 `src/local/index.ts` 汇总本地 API，消费者入口由 [package.json](../../package.json) 声明。
