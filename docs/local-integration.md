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

## 图片与链接策略

图片默认不加载，包括相对路径图片，避免文档自动向宿主接口或外部站点发起请求。宿主可以通过 `urlPolicy` 明确允许图片来源；`LocalReactiveDocument` 和 `LocalDocumentView` 都接受这一属性。链接默认保留安全协议检查。

```tsx
import type { LocalUrlPolicy } from 'reactive-md/react';

const urlPolicy: LocalUrlPolicy = (raw, kind) => {
  if (kind === 'link') return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.origin === 'https://images.example.com';
  } catch {
    return false;
  }
};

<LocalReactiveDocument source={source} urlPolicy={urlPolicy} />;
```

传入策略后，图片与链接都需要策略返回 `true` 才能使用。策略抛出异常时拒绝该地址。渲染器始终先检查协议，即使策略放行也不能使用 `javascript:` 或危险的 `data:` 地址。获准加载的图片使用 `referrerPolicy="no-referrer"`；同源请求仍可能携带 Cookie，因此图片白名单应避开业务 API 路径。

## 资源限制

单个字符串最多 100,000 字符，数组最多 10,000 项，数组内字符串总长度最多 100,000 字符。邮箱校验使用有长度上限的线性检查。运行时拒绝超限写入，并保持上一次合法状态。

每个绘图组件最多 16 条曲线，整篇文档最多请求 20,000 个曲线采样点，包括隐藏区域。绘图计算还受共享执行预算限制。超限文档会收到诊断；错误诊断数量和单条消息长度也有上限。

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

同名文本控件的写入需要同时满足所有关联控件的约束。`evaluate()` 返回的数组与内部状态隔离，修改返回数组不会更新文档；请通过 `set()` 提交并验证状态变化。`disabled` 与条件隐藏用于交互展示，宿主的业务权限和服务端数据校验仍由宿主执行。

自行管理生命周期时，用 `<LocalDocumentView document={result.document} runtime={runtime} />` 渲染，并在卸载时调用 `runtime.dispose()`。输入、表格和计时器的交互由文档组件提供，无需宿主注册动作。

## 入口

| 用途 | 编译和运行 | React |
| --- | --- | --- |
| 本地交互标签 | `compileLocal`、`createLocalRuntime` | `LocalReactiveDocument`、`LocalDocumentView` |

本地交互模式的参数来自正文控件，表格数据来自 Markdown，不需要服务调用或 YAML 配置。
