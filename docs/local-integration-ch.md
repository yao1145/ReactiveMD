# 本地交互文档集成

本地交互模式使用 HTML 风格标签、就地参数和 `{{ 表达式 }}`。作者规则见 [新用户入门指南](local-guide-ch.md) 和 [语法规范](local-interaction-syntax-ch.md)，完整文档见 [12 份示例](../examples/local/README.md)。宿主通过带 `Local` 的 API 明确选择此模式。

## 运行环境与入口

| 入口 | 内容 | 依赖 |
| --- | --- | --- |
| `reactive-md` | `compileLocal`、`createLocalRuntime`、表达式与数学工具 | 不依赖 React |
| `reactive-md/react` | `LocalReactiveDocument`、`LocalDocumentView` | React 19 |
| `reactive-md/styles.css` | 组件、主题和文档样式 | 由宿主显式引入 |

包只提供 ESM。Node.js 22.12+ 可用于开发和 Node 端编译、运行。Edge 已完成本地交互验证，静态 SSR 已通过独立安装检查；完整矩阵见[版本与兼容性](compatibility-ch.md)。可复制的项目见[独立接入示例](../examples/integration/README.md)。

## React

在已安装 Reactive MD 的宿主中安装 React；使用 TypeScript 时再安装对应类型包：

```sh
npm install react@19 react-dom@19
npm install --save-dev @types/react@19 @types/react-dom@19
```

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

| 属性 | 类型 | 组件 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | `LocalReactiveDocument` | 源码变化时重新编译并创建新运行时；旧实例状态不保留 |
| `document` | `LocalDocument` | `LocalDocumentView` | 已编译文档；由宿主编译一次 |
| `runtime` | `LocalRuntime` | `LocalDocumentView` | 宿主创建并负责销毁 |
| `onDiagnostics` | `(diagnostics: Diagnostic[]) => void` | 两者 | 接收编译诊断和控件写入被拒绝时的运行时诊断 |
| `urlPolicy` | `(url: string, kind: 'image' \| 'link') => boolean` | 两者 | 在协议检查之后决定是否放行图片或链接 |
| `locale` | `'en' \| 'zh'` | 两者 | 内置控件和标签的语言，默认 `'en'`；编译与运行时诊断消息仍为英文 |
| `themes` | `readonly LocalThemeDefinition[]` | 两者 | 宿主登记的主题；CSS 单独加载，内置 `default` 始终可用 |
| `colorScheme` | `'light' \| 'dark' \| 'auto'` | 两者 | 默认 `auto`，跟随最近祖先的显式模式或系统偏好 |

两个组件都没有 `className`、`style` 或插槽属性。`LocalReactiveDocument` 渲染 `<article class="md-document local-document">`；`LocalDocumentView` 使用同样的文档容器。样式覆盖见下文。

每个组件实例独立管理内存状态。修改源码会重新编译；销毁实例会清理订阅和计时器。文档中的面板重置其内部参数、输入草稿和组件状态，同名参数在面板外的显示也会同步更新。

编译失败时组件渲染停用提示和诊断列表，`onDiagnostics` 也会收到诊断。运行中的局部计算错误在对应内容附近显示，其余内容继续更新。

### 标题与目录链接

文档内可以直接使用 Markdown 目录链接，例如 `[参数说明](#参数说明)` 指向 `## 参数说明`。渲染器根据标题文字生成锚点，同名标题依次追加 `-1`、`-2` 等后缀，并处理与已有标题名称的碰撞。标题中的强调和行内代码按文字参与命名；中文和百分号编码的片段链接均可使用。

每个文档实例拥有独立的锚点前缀，匹配的目录链接会指向当前实例。同一页面可以嵌入多份相同源码。链接仍先经过协议检查和宿主 `urlPolicy`，策略收到作者写入的原始地址。

动态标题的锚点根据源码初值计算，参数变化只更新标题显示文字。渲染后的 DOM ID 属于当前挂载实例；保存目录时应保留源码中的片段链接。

## 核心 API

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

### `compileLocal(source: string, options?: LocalCompileOptions)`

`source` 是 `.reactive.md` 原文。返回值是联合类型：

- 成功：`{ ok: true; document: LocalDocument; diagnostics: Diagnostic[] }`
- 失败：`{ ok: false; diagnostics: Diagnostic[] }`

语法问题通过诊断返回；当前构建只接受 `local-draft-2`。源码上限为 1,000,000 字符。`document` 是当前运行时对象，不应当作持久化格式。

宿主可以为单次编译设置语法节点预算：

```ts
import { compileLocal, type LocalCompileOptions } from 'reactive-md';

const options: LocalCompileOptions = {
  limits: { maxSyntaxNodes: 50_000 },
};
const result = compileLocal(source, options);
```

`limits.maxSyntaxNodes` 默认为 10,000，接受 `1` 到 `Number.MAX_SAFE_INTEGER` 之间的整数。省略选项、`limits` 或 `maxSyntaxNodes` 时使用默认值。`0`、负数、小数、`NaN`、无穷大、字符串、`null` 和错误的选项容器返回 `local.options.invalid` 诊断；超过有效节点预算时返回 `local.budget` 诊断。

预算统计解析过程中累计创建的 `LocalNode`，包括 Markdown 文本、段落、列表、表格、插值、组件及部分中间节点，可能大于最终语法树的节点数。设置只影响本次编译，选项对象保持原样，数组等其他资源上限保持独立。该预算由宿主传入，文档内容不能自行提高。

需要在 React 中使用自定义预算时，先调用 `compileLocal`，再把编译文档和运行时交给 `LocalDocumentView`。`LocalReactiveDocument` 和 Playground 的编译线程使用默认预算。提高节点预算后，宿主应结合实际文档测量内存和预览渲染耗时。

### `createLocalRuntime(document: LocalDocument)`

只读命名值在可选的 `document.computations` 记录中用 `LocalComputation` 描述。`bindings` 和 `initialState` 继续只包含可写控件；`snapshot().state` 还包含该修订成功求值的计算结果。需要保留表达式错误语义时用 `evaluate(name)` 读取，失败值不会出现在快照里。见[计算与错误规则](computations-formatting-ch.md)。

为已编译文档创建独立的内存运行时。`document` 不是本地模式文档、初值超出预算或结构无效时会抛出错误。每个实例拥有独立状态；没有存储、网络或跨实例共享。

### `LocalRuntime`

`validate(): Diagnostic[]` 读取当前修订的跨字段失败提示，保留字段可编辑性，并返回缓存诊断的副本。`document.validations?: LocalValidation[]` 保存可序列化规则。数字集合为 `LocalValue` 增加 `number[]`、为 `LocalValueKind` 增加 `number-array`，原有可写选择控件继续使用字符串数组。见[条件、校验与本地集合](constraints-collections-ch.md)。

| 成员 | 参数 | 返回 | 行为 |
| --- | --- | --- | --- |
| `document` | — | `LocalDocument` | 创建时使用的编译结果 |
| `snapshot()` | — | `{ revision: number; state: Readonly<Record<string, LocalValue>> }` | 状态未变时返回同一快照对象；状态冻结 |
| `get(node)` | `LocalNode` | `LocalValue` | 读取该控件绑定的值；无绑定或未知节点返回 `null`；数组为副本 |
| `set(node, value)` | `LocalNode`, `LocalValue` | `Diagnostic[]` | 校验所有共享控件；成功返回空数组并提交一次；失败不增加 revision |
| `evaluate(expression)` | `string` | `LocalValue` | 用当前状态求值；失败抛出 `LocalExpressionError`；数组为副本 |
| `text(template)` | `string` | `string` | 渲染带 `{{ }}` 的文本；失败抛出错误 |
| `reset(node)` | `LocalNode` | `void` | 一次恢复该节点子树内的参数和组件状态，只通知一次 |
| `resetToken(node)` | `LocalNode` | `number` | 控件内部状态的递增标记，供渲染器感知重置 |
| `subscribe(listener)` | `() => void` | `() => void` | 每次提交调用监听器；返回取消订阅函数 |
| `dispose()` | — | `void` | 幂等；清理订阅、表达式缓存和重置标记；之后其他成员会抛出 |

`set` 以文档中登记的控件为准，调用方传入的节点元数据不会放宽约束。`disabled` 与条件隐藏用于交互展示，宿主的业务权限和服务端数据校验仍由宿主执行。

### 其他核心导出

- `LOCAL_SYNTAX_VERSION`：当前为字面量 `'local-draft-2'`。用它记录文档所用的语法修订。
- `compileExpression(source: string)`：返回带 `source`、`dependencies`、`evaluate(env)` 和 `inferType(env)` 的对象；失败抛出 `LocalExpressionError`。
- `LocalExpressionError`：包含 `code` 和 `offset`。
- `compileLatex(source: string)`：返回带 `source`、`dependencies` 和 `evaluate(x, env, budget?)` 的对象；失败抛出带 `code`、`offset` 的错误。
- `samplePlot(expression, env, min, max, samples = 200, sharedBudget?)`：返回 `{ points: { x: number; y: number | null }[]; endpoint: number | null }`；范围、采样数或预算无效时抛出。
- 类型导出：`Diagnostic`、`SourceRange`、`LocalValue`、`LocalValueKind`、`LocalNode`、`LocalBinding`、`LocalDocument`、`LocalCompileResult`、`LocalRuntime`、`LocalSnapshot`。

`compileExpression`、`compileLatex` 和 `samplePlot` 是较低层的工具，稳定级别与核心 API 相同；通常只需要 `compileLocal` 和 `createLocalRuntime`。

## 诊断

`Diagnostic` 的字段与稳定级别见[版本与兼容性](compatibility-ch.md)中的诊断契约。要点：`line`、`column` 和 `range` 用于程序定位；`code` 可用于当前版本的粗分类，但 0.x 不承诺跨版本稳定；`message` 是中文显示文本，不要解析。

`onDiagnostics` 会在编译结果变化时收到编译诊断，也会收到控件写入被拒绝时的运行时诊断。编译错误文档不激活交互；运行时局部错误只替换对应内容。

## 状态、实例与清理

- `LocalReactiveDocument` 在 `source` 变化时重新编译并创建运行时，清理旧实例；支持 React StrictMode。
- 自行管理生命周期时，用 `<LocalDocumentView document={result.document} runtime={runtime} />` 渲染，并在卸载时调用 `runtime.dispose()`。
- `subscribe()` 返回取消订阅函数。`dispose()` 会清空剩余订阅，之后调用其他运行时方法会抛出错误。
- `snapshot()` 在状态变化前返回同一对象，可用于外部存储订阅。`reset(panelNode)` 对面板子树只提交一次，订阅者收到一次通知；面板内隐藏控件也在重置范围内。
- 文档状态只保存在内存中。刷新、重新挂载或更换源码都从初值开始；没有持久化、localStorage、Cookie 或服务端写入。
- 隐藏区域保留参数、标签页和清单状态；隐藏区域中的计时器暂停，恢复显示后保持暂停，由读者再次启动。实例销毁后释放计时器和订阅。

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

| 目标 | 没有策略时 | 有策略时 |
| --- | --- | --- |
| 图片 | 全部拒绝，包括相对地址 | 先检查带协议的地址，只允许 HTTP(S)；相对地址由策略决定 |
| 链接 | 允许相对地址和 `http`、`https`、`mailto`、`tel` | 协议检查后由策略决定；外部 HTTP(S) 链接带 `_blank` 和 `noopener noreferrer` |

策略收到的是去掉首尾空白的原始 URL 和 `'image' | 'link'`。策略抛出异常时拒绝该地址。渲染器始终先检查协议，即使策略放行也不能使用 `javascript:` 或危险的 `data:` 地址。获准加载的图片使用 `referrerPolicy="no-referrer"`；同源请求仍可能携带 Cookie，因此图片白名单应避开业务 API 路径。

`urlPolicy` 只控制渲染出的链接和图片，不是服务端授权或沙箱。宿主仍需处理 CSP、网络出口和不可信作者的隔离策略。

## 主题与样式作用域

`reactive-md/styles.css` 是一份全局样式表，不通过 Shadow DOM 或 CSS Modules 隔离。宿主应显式引入一次；`reactive-md/react` 的库构建把样式提取到该文件，不会在导入 JavaScript 时自动注入。

- 样式选择器以 `.md-document`、`.local-document` 和 `.md-*`、`.local-*` 类名为主。组件渲染的文档根节点是 `.md-document.local-document`。
- 主题变量声明在 `.md-document` 和 `.reactive-md-theme` 上，包括 `--ink`、`--surface`、`--line`、`--blue`、`--teal`、`--danger`、`--radius-*` 和字体变量。在库样式之后用 `.my-article .md-document { --blue: #245c98; }` 等规则覆盖；文档根节点自带默认值，只在祖先容器上设置变量不会覆盖根节点上的同名值。
- 文档开头可写 `<theme name="default">`，省略时选择 `default`。自定义主题通过 `themes` 登记；完整要求见[主题协议](theme-protocol-ch.md)。
- `colorScheme` 可强制深浅模式；默认 `auto` 跟随最近祖先的 `data-color-scheme` 或兼容的 `data-theme`，再跟随系统偏好。文档根节点输出独立的 `data-rmd-theme` 和已解析的 `data-color-scheme`。
- 文档默认 `max-width: 720px` 且水平居中。需要铺满宿主容器时，在自己的作用域内覆盖 `.md-document` 的宽度和边距。
- 主题优先覆盖公共变量；组件外层 `.md-*`、`.local-*` 类和语义状态属性可用于主题样式。内部节点排列不属于扩展接口；兼容要求见主题协议。
- 两个 React 组件都不接受 `className` 或 `style`。需要局部覆盖时，用宿主自己的包裹元素限定作用域。

## 资源限制

单个字符串最多 100,000 字符，数组最多 10,000 项，数组内字符串总长度最多 100,000 字符。邮箱校验使用有长度上限的线性检查。运行时拒绝超限写入，并保持上一次合法状态。

单个文档源码最多 1,000,000 字符。诊断最多 100 条，单条消息最多 2,000 字符。

每个绘图组件最多 16 条曲线，整篇文档最多请求 20,000 个曲线采样点，包括隐藏区域。绘图计算还受 2,000,000 步的共享执行预算限制。超限文档会收到诊断；表达式和数学渲染也有各自的深度与记号预算。

这些上限限制单个文档的工作量，不替代宿主对请求大小、并发和执行时间的控制。完整威胁边界见[安全策略](../SECURITY-ch.md)。

## 版本固定与升级

- 在 0.x 阶段固定准确的包版本，并提交 lockfile。`^0.3.0` 只允许补丁版本，但生产接入仍建议写死版本或固定 tarball 的 SHA256。
- 用一个包版本同时提供核心和 React 入口；不要混用不同版本的 `reactive-md` 和 `reactive-md/react`。
- 在应用配置或文档元数据中记录 `LOCAL_SYNTAX_VERSION`，与持久化的 `.reactive.md` 源码一起保存。语法修订变化时按[版本与兼容性](compatibility-ch.md)迁移。
- 升级后重新编译自有文档，检查 `result.diagnostics`、渲染结果和浏览器交互。不要依赖诊断 `message` 的文本。

## 不提供的功能

本地模式不提供状态持久化、插件或自定义组件注册、任意 HTML、作者 CSS、事件处理器、网络请求、外部数据接口、表单提交、Vue 支持、React 18 支持或 CommonJS 入口。宿主不应把这些能力当作可配置项。


新增组块、颜色、槽位状态与迁移规则见[local-draft-2 扩展说明](local-components-v2-ch.md)。本工作区版本尚未发布。
