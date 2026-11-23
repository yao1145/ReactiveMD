# ReactiveMD 0.9.2

[English](release-0.9.2-en.md) · **中文**

从 npm 安装 `reactive-md@0.9.2`：

```sh
npm install reactive-md@0.9.2
```

0.9.2 补丁版本发布说明（2026-11-23）。

## 主要更新

### 最新的回退编译结果优先

观察者在回退编译的开始、结束或诊断回调中调度新的源码后，旧结果、剩余诊断和终态 trace 不再交付。每个调度代次携带当前性令牌，调度器在每次观察回调后重新校验。

### 格式化诊断保留 Worker 失败原因

`formatLocalDiagnostic` 通过有界的 `detail` 参数在中英文诊断中保留 Worker 编译异常的原因。诊断报告仍不包含自由文本。

### 可恢复性与调用方一致

构建 preflight 与导出计划的资源及预算诊断标记为 `recoverable: false`，与在诊断处停止的调用方一致。

### 导出取消事件

`LocalTraceEvent` 新增 `export-cancel` 类型，诊断报告接受 `cancelled` 与 `printed` 状态。

## 兼容性

本次补丁发布不改变语法、SDK、主题、组件或状态协议版本。`local-draft-3`、`component-protocol-3`、`reactive-md-theme-1`、`reactive-md-state/v1` 和 `0.7.0` SDK 契约继续有效。升级引擎包无需迁移已有文档源码和状态文件。已发布的 `reactive-md-editor@0.2.0` 仍兼容 `0.9.x` 引擎系列。升级到 `reactive-md-editor@0.2.1` 时，引擎需满足 `^0.9.2`。仍固定在引擎 0.9.0 或 0.9.1 的宿主需要同时升级引擎。