# 稳定公共 API

**中文** · [English](api-stability-en.md)

本基线从 `reactive-md@0.9.2` 和 `reactive-md-editor@0.2.1` 生效。稳定范围包括两包的公开 ESM 入口、兼容别名和样式入口，以及[公开接口参考](../reference/public-api-ch.md)和[编辑器入口](https://github.com/yao1145/ReactiveMD-Editor#入口)记载的导出、类型与行为。包的 `exports` 声明负责入口解析。实现文件路径、构建 chunk 名称和内部模块随实现演进。

同一 0.x 次版本的补丁保持既有导入、声明与语义可用。补丁可以新增入口、可选字段和诊断码。必须字段、闭合联合类型、错误处理方式及已承诺的默认行为属于兼容性契约。重命名、移除和其它不兼容变化遵循[弃用与迁移政策](deprecation-ch.md)。

## 子系统契约

| 子系统 | 稳定范围 | 版本与边界 |
| --- | --- | --- |
| 编译器 | 根入口的 `compileLocal`、`LocalCompileOptions` 和 `LocalCompileResult`。两个 compiler 子入口的工厂、`Compiler` 和 `CompilerConfigurationError`。宿主可以按工厂结果的 `ok` 和 `status` 分支，并读取诊断、恢复记录与检查覆盖。编译成功时可读取 `document` 和 `program`。 | `local-draft-3` 的已接受语义遵循[版本与兼容性](compatibility-ch.md)。单次入口执行最终编译。会话和调度器的显式阶段参数及结果字段属于公开契约。程序对象及编译缓存面向当前版本的内存使用。自建 Worker 应使用公开的请求和响应类型及配套引擎。 |
| 运行时 | `createLocalRuntime`、`LocalRuntime` 的公开参数写入、订阅、重置和释放语义，以及 `reactive-md/runtime` 和 `reactive-md/runtime/browser` 的文档化接口。非法写入保留有效状态，多值写入原子提交。 | 持久化使用 `reactive-md-state/v1` 或文档化的组件状态格式。读取会校验源码摘要、修订及相应绑定或组件身份。内存快照、节点 ID、匿名键及具体调度方式属于运行实现。 |
| SDK | `reactive-md/sdk` 的组件和预设定义、配置校验、版本范围、绑定规则和声明的能力。扩展宿主可以依赖组件身份、名称、版本和契约检查。 | SDK 契约为 `0.7.0`，语法、组块和主题各自版本化。通过主机范围校验后仍按组件契约及配置验证恢复。扩展可通过[合规测试](../integration/extension-sdk-ch.md)验证能力。 |
| 导出 | `createShareableHtml`、`reactive-md/export` 的预检、HTML 与恢复接口，以及 `reactive-md/export-assets` 的协议、稳定资源 ID 和 `specifier` 含义。 | 基础 HTML 写出 v1，带恢复契约的 HTML 写出 v2。当前独立运行时读取这两个有效版本，要求 v2 带恢复契约，并在失配时拒绝恢复。已有的无 `sourceSemantics` 历史负载走对应的兼容路径。bundle、恢复要求和资源清单独立版本化。详见[可分享文档与静态导出](../integration/shareable-export-ch.md)。 |
| 诊断 | `Diagnostic` 的机器字段、原始源码 UTF-16 坐标、两级 `severity`（`error`、`warning`）与既有诊断码含义。观察入口公开 `LocalObserver`、`LocalTraceEvent`、`createDiagnosticReport` 和格式化接口。可选的 `recoverable` 表示当前操作能否继续。 | 同一 minor 可以增加码和可选元数据。报告 `reactive-md-diagnostic/v1` 的既有字段保持类型与含义，可增加可选字段或事件。读者应跳过未知字段、事件及枚举值，并先校验 schema。改变必需字段类型或已有含义时升级报告协议。显示文案可以调整。 |

## 编辑器契约

`reactive-md-editor`、`/codemirror` 和 `/commands` 是公开入口。组件及其公开 props、handle、选区类型、命令结果和样式入口随本包发行。根组件和 CodeMirror 别名指向同一组件。可选 observer 观察私有分析 Worker 的诊断和轨迹。更换 observer 会重建分析调度器。编辑器的引擎 peer 和验收组合见[版本与兼容性](compatibility-ch.md)。

## 发布检查

两包的 `npm run check` 验证公共入口、已打包文件及独立 NodeNext 消费。引擎额外验证编译入口隔离、旧宿主的两级诊断类型、公开协议标识和行为测试。跨仓库发布还运行 `npm run compatibility:verify`，并记录[支持矩阵](support-matrix-ch.md)里的实测环境。
