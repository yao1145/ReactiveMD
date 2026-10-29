# 文档导航 · Documentation

文档按用途分类，每个主题都有中文（`-ch.md`）和英文（`-en.md`）版本。
Documents are grouped by purpose, with Chinese and English versions of each topic.

| 目录 / Directory | 内容 / Contents |
| --- | --- |
| [guides/](guides/) | 入门指南 / Getting started |
| [reference/](reference/) | 语法、组件与主题参考 / Syntax, components and themes |
| [integration/](integration/) | 宿主集成、编辑器、作者工具与导出 / Integration, editor, author tools and export |
| [compatibility/](compatibility/) | 版本兼容、迁移与源码版本标记 / Compatibility, migration and source versioning |
| [development/](development/) | 组件开发、协议、性能与发布流程 / Development, protocols, performance and publishing |
| [releases/](releases/) | 各版本发布记录 / Release notes |

## 从这里开始 · Start here

- **编写文档 / Authors**：先读[入门指南](guides/local-guide-ch.md)（[English](guides/local-guide-en.md)），再查语法参考；可运行的示例见 [examples/local](../examples/local/README.md)。
- **接入项目 / Integrators**：从[本地模式集成](integration/local-integration-ch.md)（[English](integration/local-integration-en.md)）开始，独立项目示例见 [examples/integration](../examples/integration/README.md)。
- **升级版本 / Upgrading**：先查[兼容性](compatibility/compatibility-ch.md)（[English](compatibility/compatibility-en.md)），再读目标版本的发布记录。当前文档版本为 0.6.0；各版本记录保留当时的行为与迁移说明。

## 入门 · Guides

| 主题 / Topic | 中文 | English |
| --- | --- | --- |
| 新用户入门 / Beginner guide | [中文](guides/local-guide-ch.md) | [English](guides/local-guide-en.md) |

## 参考 · Reference

| 主题 / Topic | 中文 | English |
| --- | --- | --- |
| 本地交互语法 / Local interaction syntax | [中文](reference/local-interaction-syntax-ch.md) | [English](reference/local-interaction-syntax-en.md) |
| 本地组件 / Local components v2 | [中文](reference/local-components-v2-ch.md) | [English](reference/local-components-v2-en.md) |
| 计算与格式化 / Computations and formatting | [中文](reference/computations-formatting-ch.md) | [English](reference/computations-formatting-en.md) |
| 约束与集合 / Constraints and collections | [中文](reference/constraints-collections-ch.md) | [English](reference/constraints-collections-en.md) |
| 诊断与计数 / Diagnostics and counting | [中文](reference/diagnostics-counting-ch.md) | [English](reference/diagnostics-counting-en.md) |
| HTML 兼容 / HTML compatibility | [中文](reference/html-compatibility-ch.md) | [English](reference/html-compatibility-en.md) |
| 主题协议 / Theme protocol | [中文](reference/theme-protocol-ch.md) | [English](reference/theme-protocol-en.md) |

## 接入 · Integration

| 主题 / Topic | 中文 | English |
| --- | --- | --- |
| 本地模式集成 / Local mode integration | [中文](integration/local-integration-ch.md) | [English](integration/local-integration-en.md) |
| React 源码编辑器 / React source editor | [中文](integration/editor-ch.md) | [English](integration/editor-en.md) |
| 作者工具 / Author tools | [中文](integration/author-tools-ch.md) | [English](integration/author-tools-en.md) |
| 分享与静态导出 / Sharing and static export | [中文](integration/shareable-export-ch.md) | [English](integration/shareable-export-en.md) |

## 兼容与迁移 · Compatibility and migration

| 主题 / Topic | 中文 | English |
| --- | --- | --- |
| 版本与兼容性 / Versions and compatibility | [中文](compatibility/compatibility-ch.md) | [English](compatibility/compatibility-en.md) |
| 源码版本标记 / Source versioning | [中文](compatibility/source-versioning-ch.md) | [English](compatibility/source-versioning-en.md) |

## 开发维护 · Development

| 主题 / Topic | 中文 | English |
| --- | --- | --- |
| 组件开发 / Component development | [中文](development/component-development-ch.md) | [English](development/component-development-en.md) |
| 组件协议 / Component protocol | [中文](development/component-protocol-ch.md) | [English](development/component-protocol-en.md) |
| 性能 / Performance | [优化历史与当前复测总览](development/performance-overview-ch.md) | Single Chinese report |
| 发布流程 / Publishing | [中文](development/releasing-ch.md) | [English](development/releasing-en.md) |

## 发布记录 · Releases

| 版本 / Version | 中文 | English |
| --- | --- | --- |
| 0.6.0 | [中文](releases/release-0.6.0-ch.md) | [English](releases/release-0.6.0-en.md) |
| 0.5.3 | [中文](releases/release-0.5.3-ch.md) | [English](releases/release-0.5.3-en.md) |
| 0.5.2 | [中文](releases/release-0.5.2-ch.md) | [English](releases/release-0.5.2-en.md) |
| 0.5.1 | [中文](releases/release-0.5.1-ch.md) | [English](releases/release-0.5.1-en.md) |
| 0.5.0 | [中文](releases/release-0.5.0-ch.md) | [English](releases/release-0.5.0-en.md) |
| 0.4.1 | [中文](releases/release-0.4.1-ch.md) | [English](releases/release-0.4.1-en.md) |
| 0.4.0 | [中文](releases/release-0.4.0-ch.md) | [English](releases/release-0.4.0-en.md) |

## 相关资料 · Related resources

- 项目概览 / Project overview：[中文](../README-ch.md) · [English](../README-en.md)
- 更新日志 / Changelog：[中文](../CHANGELOG-ch.md) · [English](../CHANGELOG.md)
- 贡献指南 / Contributing：[中文](../CONTRIBUTING-ch.md) · [English](../CONTRIBUTING.md)
- 一致性用例 / Conformance fixtures：[examples/conformance](../examples/conformance/README.md)

新增文档时放入对应目录，在本页补充中英文链接，并运行 `npm run test:docs` 检查本地链接和标题锚点。
When adding a topic, place both language versions in the matching directory, list them here, and run `npm run test:docs`.
