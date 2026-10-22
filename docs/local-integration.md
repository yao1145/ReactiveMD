# 本地交互文档集成

本地交互模式使用 HTML 风格标签、就地参数和 `{{ 表达式 }}`。作者规则见 [新用户入门指南](local-guide.md) 和 [语法规范](local-interaction-syntax.md)，完整文档见 [12 份示例](../examples/local/README.md)。宿主通过带 `Local` 的 API 明确选择此模式。

## React

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const source = `# 费用估算

<panel title="调整方案">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="年度付款">
</panel>

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。`;

export function Article() {
  return <LocalReactiveDocument source={source} />;
}
```

每个组件实例独立管理内存状态。修改源码会重新编译；销毁实例会清理订阅和计时器。文档中的面板重置其内部参数、输入草稿和组件状态。同名参数在面板外的显示也会同步更新。

`onDiagnostics` 接收源码诊断，包含 `code`、`message`、`severity`、`range`、`line` 和 `column`。编译失败时显示诊断并停用交互。运行中的局部计算错误在对应内容附近显示，其余内容继续更新。

## 编译与状态

```ts
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal(source);
if (result.ok) {
  const runtime = createLocalRuntime(result.document);
  const unsubscribe = runtime.subscribe(() => {
    console.log(runtime.snapshot());
  });

  console.log(runtime.evaluate('people * 100'));
  console.log(runtime.text('人数：{{ people }}'));

  unsubscribe();
  runtime.dispose();
} else {
  console.log(result.diagnostics);
}
```

`snapshot()` 在状态变化前返回同一快照，供外部存储订阅使用。`get(node)`、`set(node, value)` 读取和更新输入，`set` 返回诊断数组；成功时为空数组。`reset(panelNode)` 一次恢复面板子树，订阅者收到一次通知。面板内的隐藏控件也在重置范围内。

自行管理生命周期时，用 `<LocalDocumentView document={result.document} runtime={runtime} />` 渲染，并在卸载时调用 `runtime.dispose()`。输入、表格和计时器的交互由文档组件提供，无需宿主注册动作。

## 入口

| 用途 | 编译和运行 | React |
| --- | --- | --- |
| 本地交互标签 | `compileLocal`、`createLocalRuntime` | `LocalReactiveDocument`、`LocalDocumentView` |

本地交互模式的参数来自正文控件，表格数据来自 Markdown，不需要服务调用或 YAML 配置。
