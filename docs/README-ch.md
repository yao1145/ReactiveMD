# 文档导航

[English](README.md) · **中文**

文档按用途分类。每个主题都有中文版本（`-ch.md`）；英文导航见 [README.md](README.md)。

| 目录 | 内容 |
| --- | --- |
| [guides/](guides/) | 入门指南 |
| [reference/](reference/) | 语法、组件与主题参考 |
| [integration/](integration/) | 宿主集成、编辑器、作者工具与导出 |
| [compatibility/](compatibility/) | 版本兼容、迁移与源码版本标记 |
| [development/](development/) | 组件开发、协议、性能与发布流程 |
| [releases/](releases/) | 各版本发布记录 |

## 从这里开始

- **编写文档**：先读[入门指南](guides/local-guide-ch.md)，再查语法参考；可运行的示例见 [examples/local](../examples/local/README.md)。
- **接入项目**：从[本地模式集成](integration/local-integration-ch.md)开始，独立项目示例见 [examples/integration](../examples/integration/README.md)。
- **升级版本**：先查[兼容性](compatibility/compatibility-ch.md)，再读目标版本的发布记录。当前文档版本为 0.6.1；各版本记录保留当时的行为与迁移说明。

## 入门

| 主题 | 中文 |
| --- | --- |
| 新用户入门 | [中文](guides/local-guide-ch.md) |

## 参考

| 主题 | 中文 |
| --- | --- |
| 本地交互语法 | [中文](reference/local-interaction-syntax-ch.md) |
| 本地组件 | [中文](reference/local-components-v2-ch.md) |
| 计算与格式化 | [中文](reference/computations-formatting-ch.md) |
| 约束与集合 | [中文](reference/constraints-collections-ch.md) |
| 诊断与计数 | [中文](reference/diagnostics-counting-ch.md) |
| HTML 兼容 | [中文](reference/html-compatibility-ch.md) |
| 主题协议 | [中文](reference/theme-protocol-ch.md) |

## 接入

| 主题 | 中文 |
| --- | --- |
| 本地模式集成 | [中文](integration/local-integration-ch.md) |
| 扩展 SDK 预览 | [中文](integration/extension-sdk-ch.md) |
| React 源码编辑器 | [中文](integration/editor-ch.md) |
| 作者工具 | [中文](integration/author-tools-ch.md) |
| 分享与静态导出 | [中文](integration/shareable-export-ch.md) |

## 兼容与迁移

| 主题 | 中文 |
| --- | --- |
| 版本与兼容性 | [中文](compatibility/compatibility-ch.md) |
| 源码版本标记 | [中文](compatibility/source-versioning-ch.md) |

## 开发维护

| 主题 | 中文 |
| --- | --- |
| 组件插件开发 | [中文](development/component-development-ch.md) |
| 组件协议 | [中文](development/component-protocol-ch.md) |
| 性能 | [优化历史与当前复测总览](development/performance-overview-ch.md) |
| 发布流程 | [中文](development/releasing-ch.md) |

## 发布记录

| 版本 | 中文 |
| --- | --- |
| 0.6.1 | [中文](releases/release-0.6.1-ch.md) |
| 0.6.0 | [中文](releases/release-0.6.0-ch.md) |
| 0.5.3 | [中文](releases/release-0.5.3-ch.md) |
| 0.5.2 | [中文](releases/release-0.5.2-ch.md) |
| 0.5.1 | [中文](releases/release-0.5.1-ch.md) |
| 0.5.0 | [中文](releases/release-0.5.0-ch.md) |
| 0.4.1 | [中文](releases/release-0.4.1-ch.md) |
| 0.4.0 | [中文](releases/release-0.4.0-ch.md) |

## 相关资料

- 项目概览：[中文](../README-ch.md)
- 更新日志：[中文](../CHANGELOG-ch.md)
- 贡献指南：[中文](../CONTRIBUTING-ch.md)
- 一致性用例：[examples/conformance](../examples/conformance/README.md)

新增文档时放入对应目录，在本页补充中文链接，并运行 `npm run test:docs` 检查本地链接和标题锚点。
