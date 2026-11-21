# ReactiveMD 0.9.1

[English](release-0.9.1-en.md) · **中文**

从 npm 安装 `reactive-md@0.9.1`：

```sh
npm install reactive-md@0.9.1
```

0.9.1 补丁版本发布说明（2026-11-22）。

## 主要更新

### 流式源码编译优化

流式源码路径现在支持显式的 `streaming` 或 `final` 阶段，覆盖编译会话、`LocalCompileScheduler`、Worker 和 `LocalReactiveDocument`。未完成的区域以原文显示，可由后续源码修复的问题通过 `transientDiagnostics` 报告。确定性错误以及最终阶段的严格与恢复语义保持不变。详见[流式源码编译](../integration/local-integration-ch.md#流式源码编译)。

### `<jump>` 跳转限定在文档滚动容器内

`<jump>` 跳转只滚动文档所在的最近宿主滚动容器。嵌入页面的预览滚动自己的视口，不再带动外层页面。

### 更严格的源码阶段校验

运行时会拒绝不支持的 `sourcePhase` 值，不再回退到交互式最终渲染。

## 兼容性

本次补丁发布不改变语法、SDK、主题、组件或状态协议版本。`local-draft-3`、`component-protocol-3`、`reactive-md-theme-1`、`reactive-md-state/v1` 和 `0.7.0` SDK 契约继续有效。升级引擎包无需迁移已有文档源码和状态文件。已发布的 `reactive-md-editor@0.2.0` 仍兼容 `0.9.x` 引擎系列；编辑器侧的对应快照优化随单独的编辑器版本发布。
