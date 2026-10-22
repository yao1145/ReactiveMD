# 宿主集成

本页对应 v0.1/v0.2 的 directive/YAML API。本地交互标签通过 `compileLocal`、`createLocalRuntime` 和 `LocalReactiveDocument` 集成，见 [本地模式集成](local-integration.md)。

Reactive MD 的文档作者使用 Markdown；宿主开发者通过 TypeScript 接入存储、组件和外部服务。根目录是语言包，`demo/` 是独立的 Playground 工作区。语言包名为 `reactive-md`，尚未发布到 npm。

## 构建产物

```sh
npm run build:lib
```

`dist-library/` 包含 `reactive-md.js`、`reactive-md-react.js`、共享 ESM 分块、`reactive-md.css`、`components.json` 和 `types/` 类型声明。核心入口不依赖 React 或浏览器 DOM；React 渲染入口把 React、React DOM 与 JSX runtime 作为宿主依赖。分发时保留整个 `dist-library/`，包括共享分块。通过本地包连接或打包器引用本仓库时，可以使用 package exports：

```tsx
import { ReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

export function Article({ source }: { source: string }) {
  return <ReactiveDocument source={source} documentId="article:42" />;
}
```

`ReactiveDocument` 接受 `source`、可选 `documentId`、`storage`、`capabilities`、`preserveState`、`onDiagnostics`。传入 `storage={localStorage}` 启用恢复，省略时使用内存状态。SSR 应在客户端取得存储对象。默认保留源码更新前的兼容状态，设置 `preserveState={false}` 每次初始化。为文档设置稳定且互不冲突的 ID，并为 `capabilities` 保持稳定对象引用，避免重建会话。

通过根目录的 `npm run dev` 启动 demo 后，`/embed.html` 可运行两个隔离实例、持久化、卸载重挂载与自定义组件示例，使用 React StrictMode。

## 包入口与本地依赖

| 入口 | 内容 |
| --- | --- |
| `reactive-md` | 编译器、状态运行时、会话、格式化与组件 schema |
| `reactive-md/core` | 核心入口的兼容别名 |
| `reactive-md/react` | `ReactiveDocument`、`RuntimeDocumentView`、宿主组件注册与上下文 |
| `reactive-md/styles.css` | 组件样式、文档排版和默认主题 |
| `reactive-md/manifest.json` | 构建时生成的组件清单 |

在本仓库运行 `npm install && npm run build` 后，工作区 demo 自动解析本地语言包。其他本地项目可以执行 `npm install /绝对路径/ReactiveMD`，然后按需安装 React 19 与 React DOM 19。源码入口与 demo 不会被打包进发布清单，语言包当前保留 `private: true`，需要发布时由维护者显式调整。

组件样式以 `.md-document` 为主要作用域，不重置宿主页面的 `body` 或编辑器样式。组件内部定义默认颜色变量，宿主可用 `.your-container .md-document { --blue: ...; }` 覆盖；祖先上的 `data-theme="dark"` 启用深色主题。只有需要在文档之外使用同套主题变量时才给宿主容器加 `reactive-md-theme` 类。

## 编译与运行时

```ts
import { compile, createRuntime } from 'reactive-md';

const result = compile(source);
if (!result.ok) {
  console.log(result.diagnostics); // code、message、severity、range、line、column
} else {
  const runtime = createRuntime(result.document);
  const unsubscribe = runtime.subscribe(['*'], () => {
    console.log(runtime.snapshot());
  });
  const outcome = runtime.dispatch('increment');
  if (!outcome.ok) console.log(outcome.diagnostics);
  unsubscribe();
  runtime.dispose();
}
```

`snapshot()` 返回冻结的 state/computed/resources 与 revision。局部动作使用 `dispatch`；`dispatchAsync` 可同时处理局部与宿主动作。`writeBinding(componentId, value, locals?)` 执行绑定约束；`evaluate(valueSource, locals?)` 求值；`subscribe(names, listener)` 返回解除订阅函数，`'*'` 订阅全部变化。销毁后停止使用运行时。

## 宿主 capability

文档只引用名字，宿主决定它可访问什么服务。例如 [异步查询文档](../examples/async.reactive.md) 引用 `catalog.search`：

```ts
import { createRuntime, type Capability } from 'reactive-md';

const search: Capability = async (input, { signal, action }) => {
  const response = await fetch('/api/catalog/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, action }),
    signal,
  });
  if (!response.ok) throw new Error(`查询失败：${response.status}`);
  return response.json();
};

const capabilities = { 'catalog.search': search };
const runtime = createRuntime(document, { capabilities });
await runtime.dispatchAsync('search');
runtime.cancel('search');
```

同一动作的新请求采用最新结果；旧请求会收到 abort，忽略 abort 的服务迟到返回也不会提交。取消与销毁中止请求，宿主应把 signal 传入实际服务。返回值必须是有限、可序列化的 JSON。调用错误进入 `resources.<动作名>.error` 并返回诊断。

React 集成时将同一个 capability 字典传给 `<ReactiveDocument capabilities={capabilities} ... />`。文档与浏览器端不保存服务凭据；需要凭据的请求通过宿主后端处理。Playground 的目录查询实现位于 `demo/src/demo-capabilities.ts`，是可取消的本地异步服务。

## 持久化和流式接收

```ts
import { DocumentSession } from 'reactive-md';

const session = new DocumentSession({
  id: 'conversation:message:42',
  storage: localStorage,
  runtime: { capabilities },
});

session.beginStream();
for await (const chunk of markdownChunks) {
  const result = session.append(chunk);
  if (result.ok) renderCommitted(result.document, result.runtime);
}
const final = session.append('', true);
if (!final.ok) showDiagnostics(final.diagnostics);
// 卸载时：session.dispose();
```

`markdownChunks`、`renderCommitted` 与 `showDiagnostics` 是宿主提供的流和渲染函数。`DocumentSession` 管理编译文档与运行时；`current()` 读取上次提交。完整源码可通过 `update(source, {preserveState})` 更新。

非最终分片无法编译时返回 `ok:false, pending:true`，并保留 `current`。成功的前缀会提交可呈现内容；最终分片仍不合法则返回正式诊断。每次成功提交保留兼容的状态并创建新运行时，因此宿主应替换对旧运行时的订阅，跨提交的未完成请求会取消。分片与完整字符串经过同一个传统 Markdown 编译管线。

存储适配器仅需 `getItem`、`setItem`、`removeItem`。保存源码、结构签名和状态；按文档 ID 隔离。恢复时检查源码签名、值类型与绑定约束，失效状态回到当前初值。异步资源结果不持久化。`readSavedDocument(storage, id)` 可读取保存的源码，`clearSaved()` 删除当前文档存储。存储异常不阻止交互。

需要自行控制已编译文档的宿主可从 `reactive-md/react` 导入 `RuntimeDocumentView`，传入 `document`、`runtime`、`report` 与 `focusDiagnostic`，并在替换或卸载时销毁旧会话。React 的简化入口 `ReactiveDocument` 已管理这些生命周期。

流式 API 可接收任何生成端的 Markdown 分片。模型选择布局的提示词可结合 `getComponentManifest()` 输出的 schema、语言参考和 examples；本库提供编译渲染链路，推理调用由宿主实现。

## 注册自定义组件

```tsx
import {
  registerReactiveComponent, useReactiveContext, type ComponentProps,
} from 'reactive-md/react';

function HostNote({ node }: ComponentProps) {
  const { runtime } = useReactiveContext();
  return <aside>{String(runtime.evaluate(node.props!.value))}</aside>;
}

const unregister = registerReactiveComponent({
  name: 'host-note', form: 'container', label: 'none', children: 'any',
  props: { value: { type: 'string', dynamic: true, required: true } },
}, HostNote);
```

对应文档：

```markdown
:::host-note{value="=name"}
:::
```

在编译前注册。`useReactiveContext()` 提供当前作用域的 runtime、快照、document 与报告诊断的接口；嵌套 `each` 的求值自动使用行局部值。渲染器在父文档更新后读取新快照。

`unregister()` 阻止后续文档编译使用该名称；已编译文档保留自己的 schema 与渲染器，能继续交互。只需要无 UI 的编译扩展时使用 `registerComponent(schema)`。自定义渲染器是宿主应用代码，宿主负责其行为与样式。

## 格式化与组件清单

`formatDocument(source)` 返回格式化字符串；输入或输出编译不通过时抛出错误，调用方应保留原文。格式化复用 remark stringify。

`getComponentManifest()` 返回可序列化的 schema 数组，包含形态、属性类型、动态能力、默认值、绑定和事件。`npm run build:lib` 同时生成 JSON 清单与 [组件参考](components.md)，作者工具也提供清单下载。
