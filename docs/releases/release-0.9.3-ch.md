# ReactiveMD 0.9.3

[English](release-0.9.3-en.md) · **中文**

从 npm 安装 `reactive-md@0.9.3`：

```sh
npm install reactive-md@0.9.3
```

0.9.3 功能版本发布说明（2026-11-27）。

## 主要更新

### 嵌入与降级编译

`LocalCompileOptions.embedding` 用于选择受限的编译档位。`expressions: 'literal'` 在正文和兼容的字符串属性中保留插值定界符。启用 `onUnsupported: 'fallback'` 后，受限节点以及属性、结构、绘图、表格、导航等节点级错误会变为转义原文，`node.fallback` 记录诊断码与范围，依赖和运行时元数据按存留节点重建。资源预算超限仍使编译失败，成功结果会报告 `document.requiresRuntime`。

### 无运行时静态渲染

无需运行时的文档可交给 `reactive-md/react/static` 的 `LocalStaticDocumentView`，或 `reactive-md/react/static/server` 的 `renderLocalStaticMarkup`。宿主槽位可以同步渲染，也可以在挂载后解析；已安装预设声明了静态渲染的组件由对应 pack 实现直接输出。属性为字面值的旧式 `hostComponents` 可通过 `hostData`/`hostRenderer` 渲染；缺失的键控数据由 `resolveHostData` 在水合后解析，服务端与客户端首帧共享加载占位。仍需要运行时的文档可通过 `createLocalRuntimePool` 与 `LocalPooledDocumentView` 复用租约。

### 精简的会话与扫描入口

`reactive-md/compiler/session` 导出 `createLocalCompileSession`，为每份文档维护一个增量会话，并导出 `localCompileCacheKey`，按编译器入口、有效阶段、已验证选项、组件配置和宿主策略版本缓存源码快照。`reactive-md/scan` 导出 `analyzeLocalSource`，以只读方式返回标记、绑定和 UTF-16 范围。两个依赖图都不加载 React、CSS、DOM 或 Worker 调度。

### 组件清单

`document.usedComponents` 按首次出现顺序列出内置、SDK 和已声明的旧式宿主组件名称；单次编译入口还会以 `program.usedComponents` 提供该字段。宿主可在渲染前预加载实现并选择 CSS。条件分支中的组件仍会列出；声明、原文降级节点和外部槽位名不会出现。

### 多文档 Worker 池

`reactive-md/worker-pool` 的 `createLocalCompilePool` 在有界队列中编译多份文档的 revision，支持 `latest` 与 `all` 交付、优先级老化、`backpressure`、`release(documentId)`、预热和空闲回收，并在超长源码入队前拒绝它。`hold()` 暂停文档派发、全量重试和本地回退，已在执行的任务、预热和空闲回收仍可完成；`resume()` 按现有优先级和排队时长恢复派发。

### 性能报告

`createLocalPerformanceReport` 以 schema `reactive-md-performance/v1` 汇总编译、Worker 与渲染事件，报告池就绪、Worker 启动与预热、组件装载等待，以及文档与组件的挂载、存活和卸载耗时。

### 按需组件装载

`reactive-md/react/packed` 用于组合所选的 React pack。`reactive-md/presets/default/packs/react/component/*` 的逐组件入口把未选视图排除在 bundle 之外，`packStyleManifest` 给出所选组件与 CSS 资源的映射。`createDeferredReactConfig` 按定义共享异步请求，最后一个订阅者离开时中止，并接受同步 resolver 以服务 SSR 与水合。

## 兼容性

本次发布不改变语法、SDK、主题、组件或状态协议版本。`local-draft-3`、`component-protocol-3`、`reactive-md-theme-1`、`reactive-md-state/v1` 和 `0.7.0` SDK 契约继续有效。已有文档源码和状态文件无需迁移。编辑器仍配对 `reactive-md-editor@0.2.1`，其 `^0.9.2` peer 接受本版本。