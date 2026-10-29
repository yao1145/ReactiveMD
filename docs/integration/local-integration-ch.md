# 本地交互文档集成

本地交互模式使用 HTML 风格标签、就地参数和 `{{ 表达式 }}`。作者规则见 [新用户入门指南](../guides/local-guide-ch.md) 和 [语法规范](../reference/local-interaction-syntax-ch.md)，完整文档见[示例索引](../../examples/local/README.md)。宿主通过带 `Local` 的 API 明确选择此模式。可选修订指令、升级检查与 `migrateLocalSource` 见[源码修订与迁移](../compatibility/source-versioning-ch.md)，升级清单见[0.4.0 发布与迁移](../releases/release-0.4.0-ch.md)。

## 运行环境与入口

下个发行版的 P0 HTML 和三个宿主能力开关见 [HTML 部分兼容](../reference/html-compatibility-ch.md)。本版采用暂时性分流政策：任意开启作者 CSS、JavaScript 或扩展 HTML，整篇文档即按原生 HTML 渲染，停止解析 Markdown 和 ReactiveMD。

| 入口 | 内容 | 依赖 |
| --- | --- | --- |
| `reactive-md` | `compileLocal`、`createLocalRuntime`、表达式与数学工具 | 不依赖 React |
| `reactive-md/react` | `LocalReactiveDocument`、`LocalDocumentView` | React 19 |
| `reactive-md/styles.css` | 组件、主题和文档样式 | 由宿主显式引入 |

包只提供 ESM。Node.js 22.12+ 可用于开发和 Node 端编译、运行。本地浏览器检查使用 Edge；静态 SSR 由 packed 检查覆盖；完整矩阵见[版本与兼容性](../compatibility/compatibility-ch.md)。可复制的项目见[独立接入示例](../../examples/integration/README.md)。单文件 HTML、状态文件与独立浏览器运行时见[可分享文档与静态导出](shareable-export-ch.md)。

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
| `source` | `string` | `LocalReactiveDocument` | 源码变化时重新编译并创建新运行时；旧实例状态不保留。见[源码变化时保留参数](#源码变化时保留参数) |
| `compileOptions` | `LocalCompileOptions` | `LocalReactiveDocument` | 单次编译预算、HTML 能力开关和宿主组件 schema；省略时使用默认 ReactiveMD 模式 |
| `document` | `LocalDocument` | `LocalDocumentView` | 已编译文档；由宿主编译一次 |
| `runtime` | `LocalRuntime` | `LocalDocumentView` | 宿主创建并负责销毁 |
| `onDiagnostics` | `(diagnostics: Diagnostic[]) => void` | 两者 | 接收编译诊断和控件写入被拒绝时的运行时诊断 |
| `urlPolicy` | `(url: string, kind: 'image' \| 'link') => boolean` | 两者 | 在协议检查之后决定是否放行图片或链接 |
| `locale` | `'en' \| 'zh'` | 两者 | 内置控件、标签和诊断显示的语言，默认 `'en'`；回调保留原始结构化诊断 |
| `themes` | `readonly LocalThemeDefinition[]` | 两者 | 宿主登记的主题；CSS 单独加载，内置 `default` 始终可用 |
| `colorScheme` | `'light' \| 'dark' \| 'auto'` | 两者 | 默认 `auto`，跟随最近祖先的显式模式或系统偏好 |
| `hostData` | `Readonly<Record<string, unknown>>` | 两者 | 按 `${kind}:${ref}` 索引的 JSON 安全宿主数据，用于 `hostComponent` 节点；不进入 worker |
| `hostRenderer` | `LocalHostRenderer` | 两者 | `hostComponent` 的客户端渲染函数；缺少 renderer 或数据时显示占位 |
| `externalValues` | `Readonly<Record<string, LocalValue>>` | `LocalReactiveDocument` | `<external>` 声明的值；更新不重新编译、不重置参数。`LocalDocumentView` 也接受该属性以更新宿主自管的运行时 |
| `initialParameters` | `Readonly<Record<string, LocalValue>>` | `LocalReactiveDocument` | 每次创建新运行时后、首次交互前应用一次的公开参数；非法集合原子拒绝并通过 `onDiagnostics` 报告 |
| `onParametersChange` | `(parameters, snapshot) => void` | `LocalReactiveDocument` | 公开可写参数实际变化时每次提交调用一次；初始化、被拒绝的写入、未变化的值和纯 external 更新不触发 |
| `onSourceNavigate` | `(target: LocalSourceTarget) => void` | 两者 | 报告预览节点的源码范围；启用时输出 source 元数据，省略时 DOM 保持不变 |

两个组件都没有 `className`、`style` 或插槽属性。`LocalReactiveDocument` 渲染 `<article class="md-document local-document">`；`LocalDocumentView` 使用同样的文档容器。样式覆盖见下文。

```tsx
<LocalReactiveDocument
  source={source}
  initialParameters={savedParameters}
  onParametersChange={(parameters) => save(parameters)}
  externalValues={{ exchangeRate: 7.2 }}
  onSourceNavigate={(target) => editor.current?.selectRange(target.range)}
  hostRenderer={(node, data, ctx) => <HostWidget node={node} data={data} ctx={ctx} />}
/>
```

每个组件实例独立管理内存状态。修改源码会重新编译并从初值开始；销毁实例会清理订阅和计时器。需要在源码变化时保留值时，使用保留工具或自行管理运行时，见[源码变化时保留参数](#源码变化时保留参数)。文档中的面板重置其内部参数、输入草稿和组件状态，同名参数在面板外的显示也会同步更新。

宿主 React 根与 standalone IIFE 共存于同一页面时，为宿主根设置独立的 `identifierPrefix`，例如 `createRoot(container, { identifierPrefix: 'host-' })`。两个 bundle 各自拥有 React 实例，默认 `useId` 计数可能重叠。独立的服务端渲染根也应在服务端和客户端使用相同且互不重复的前缀。

编译失败时组件渲染停用提示和诊断列表，`onDiagnostics` 也会收到诊断。运行中的局部计算错误在对应内容附近显示，其余内容继续更新。

### 标题与目录链接

文档内可以直接使用 Markdown 目录链接，例如 `[参数说明](#参数说明)` 指向 `## 参数说明`。渲染器根据标题文字生成锚点，同名标题依次追加 `-1`、`-2` 等后缀，并处理与已有标题名称的碰撞。标题中的强调和行内代码按文字参与命名；中文和百分号编码的片段链接均可使用。

每个文档实例拥有独立的锚点前缀，匹配的目录链接会指向当前实例。同一页面可以嵌入多份相同源码。链接仍先经过协议检查和宿主 `urlPolicy`，策略收到作者写入的原始地址。

动态标题的锚点根据源码初值计算，参数变化只更新标题显示文字。渲染后的 DOM ID 属于当前挂载实例；保存目录时应保留源码中的片段链接。

## 持续编辑的增量编译

持续编辑同一份文档时，复用一个 `createLocalCompileSession()`，让未变化的顶层块保留解析与编译产物：

```ts
import { createLocalCompileSession } from 'reactive-md';

const session = createLocalCompileSession();
session.compile('第一段 **文字**。\n\n第二段。');
const result = session.compile('第一段 **文字**。\n\n第二段有修改。');
console.log(session.stats); // mode: 'incremental', compiledBlocks: 1, reusedBlocks: 1
session.dispose(); // 关闭文档时释放会话缓存
```

`compile(source, options?)` 返回 `LocalCompileResult`。`clear()` 清空复用数据，`dispose()` 释放缓存并结束会话；销毁后的会话不能再次编译。结果是可序列化的普通数据，每次返回独立快照，修改旧结果不会污染缓存。会话内未修改块的节点 ID 可跨编辑保持稳定，编号不要求与独立 `compileLocal()` 调用相同；节点 ID 及其元数据关联始终以同一份结果为准。

同一会话内，参数与声明上下文保持不变时，只重新编译受影响的 Markdown 块。改变声明、组件内容、编译选项、权限或宿主 schema 时执行完整编译。引用定义、脚注、导航锚点、HTML、BOM、代码定界符变化及无法确认安全边界的输入也保守回到完整编译。出现诊断时返回完整编译的诊断。整篇源码和累计节点预算仍然生效，缓存只保留当前版本。

连续修改组件或声明时，会话保留最新的成功编译结果，延迟建立块索引。恢复编辑独立正文块时，再建立一次索引并复用其他块。相同源码可直接返回独立快照；选项变化、错误、`clear()` 和 `dispose()` 都会清除待恢复状态。

`stats` 提供最近一次调用的 `mode`（`full`、`incremental`、`cached`）、块数、复用数、编译字符数与可选失效原因，用于观测实际复用。`cacheBuilds` 记录本次调用尝试建立块索引的次数，包括延迟恢复。修改块会在不变的声明前缀下编译，前缀工作量计入 `compiledCharacters`。差异检测、范围重定位和完整结果快照组装仍随文档规模增长；会话不保证每次编辑都是常数时间。

扁平单行列表、表格即使占满整个文档，也可建立增量快照。修改一行后，会话复用上一版的简单行解析计划，并在完整语义校验后保留未修改行的节点 ID。位置不变的行可共享对象；位置变化时克隆并更新 UTF-16 范围。动态插值仍由通用解析器处理。`stats.parse` 中的 `reusedRows` / `reusedItems` 累计解析计划复用，`reusedRowNodes` / `reusedItemNodes` 单独累计最终行节点复用。

Worker 判断结果补丁不划算时，可对同一修订返回完整成功结果，并以该结果继续后续补丁链。`metrics.patchFallback === 'cost'` 表示成本选择；`patchBytes` / `fullBytes` 为 JSON UTF-8 估算，不是结构化克隆的实际大小。这种切换不会触发完整请求重试。

内置 `startLocalCompileWorker()`、`LocalCompileScheduler` 默认降级编译和 `LocalReactiveDocument` 已管理各自会话。自定义 `fallbackCompile` 继续由宿主管理。`compileLocal()` 保持单次完整编译 API。测试与性能数据见[块级增量编译](../development/performance-overview-ch.md)。

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

语法问题通过诊断返回；当前构建只接受 `local-draft-3`。显式旧修订指令会以 `local.version.*` 诊断拒绝；无指令源码保持当前修订的行为。源码上限为 1,000,000 字符。`document` 是当前运行时对象，不应当作持久化格式。

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

#### Next.js Server Components

`compileLocal` 的返回值在每一层都使用普通数据，包括 `document.dependencies`、节点 `attrs`、绑定及诊断。记录对象的原型为 `Object.prototype`，数组为 `Array.prototype`；内部字典仍可使用空原型。已有的冻结元数据和 `undefined` 字段会保留。

在服务端编译并检查 `result.ok` 后，可以直接把 `result.document` 作为属性交给 Client Component，无需 JSON 往返转换。这满足 React 对[可序列化属性中普通对象的要求](https://react.dev/reference/rsc/use-client#serializable-types-returned-by-server-components)。客户端组件负责创建、销毁 `createLocalRuntime(document)`，并把运行时交给 `LocalDocumentView`。运行时实例及宿主回调留在客户端；普通数据保证适用于编译产物。

```tsx
// Server Component；ClientDocument 是宿主的 'use client' 包装组件。
import { compileLocal } from 'reactive-md';
import ClientDocument from './ClientDocument';

export default function Page() {
  const result = compileLocal('<counter bind="n" label="计数" initial="2">');
  if (!result.ok) throw new Error('编译失败');
  return <ClientDocument document={result.document} />;
}
```

### 宿主组件

宿主可以为单次编译登记组件，不改变作者语法修订。schema 声明 `form`，并可声明标量绑定：

```ts
import { compileLocal, type LocalHostComponentSchema } from 'reactive-md';

const hostComponents: LocalHostComponentSchema[] = [
  {
    name: 'host-weather',
    form: 'leaf',
    props: {
      kind: { kind: 'enum', required: true, enum: ['weather'] },
      ref: { kind: 'string', required: true, pattern: '^[a-z-]+$' },
    },
  },
];
const result = compileLocal(source, { hostComponents });
```

不传 `hostComponents` 时，这些标签仍是未知标签并按原文降级。名称必须是唯一的小写 kebab-case，且不得复用 49 个作者标签名、P0 HTML 标签名或 `theme`；一次最多接受 32 个 schema。`pattern` 只接受线性时间安全的正则子集（拒绝反向引用、环视、命名组、嵌套量词和被量词修饰的分支）。schema 不合法返回 `local.options.invalid`，作者写出的属性不合法返回 `local.host.attribute`。一个合法宿主节点计为一个语法节点。

`form` 为 `leaf`、`inline` 或 `container`；inline 和 container 使用成对标签，正文按普通 Markdown 与 ReactiveMD 规则编译，container renderer 可通过 `ctx.render()` 渲染子节点。`binding` 可选，接受 `string`、`number`、`boolean`，可声明静态 `min`、`max`、`step`、`options`、`initialRule` 和 `exclusive`。带绑定的宿主组件隐式接受 `bind`、`initial` 和动态 `disabled`，并与内置控件共享绑定族；例如宿主评分控件可与 `<number>` 共用同一个值。

renderer 接收 `(node, data, ctx)`。`ctx` 在渲染上下文之外提供 `value`、经运行时校验的 `setValue(value)`、`disabled`、`resetToken`、解析后的 `props` 和 `report(diagnostics)`。`setValue` 不会绕过共享约束或 reset。只有声明了 `kind`/`ref` 的组件才需要 `hostData`；纯绑定组件和 container 不需要伪造宿主数据。缺少 renderer、缺少其声明的数据或 renderer 抛错时显示可见占位，不会让整个文档失败。schema 是普通数据，可进入 worker；renderer 永远不进入。

### 版本查看与迁移

三个纯函数在不创建运行时的情况下检查和迁移源码，均从 `reactive-md` 导出：

```ts
import {
  checkLocalUpgrade,
  inspectLocalSourceVersion,
  migrateLocalSource,
} from 'reactive-md';

const info = inspectLocalSourceVersion(source);
const check = checkLocalUpgrade(source, { fromVersion: 'local-draft-1' });
const migrated = migrateLocalSource(source, { fromVersion: 'local-draft-1' });
```

`inspectLocalSourceVersion` 返回声明修订、用于判定的修订、当前编译器是否支持、指令位置和版本诊断。`checkLocalUpgrade` 返回 `ok`、`fromVersion`、`toVersion`、`needsMigration` 和诊断。`migrateLocalSource` 在此基础上增加 `source`、`changed` 和准确的 `edits`。

`LocalUpgradeOptions` 提供 `fromVersion` 和 `allowSemanticChanges`。无版本声明的历史文档需要 `fromVersion: 'local-draft-1'`。显式 `fromVersion` 与声明不一致时被拒绝。迁移源接受 `local-draft-1`、`local-draft-2` 和 `local-draft-3`。

迁移只改元数据指令，保留正文原始字节、BOM 和 CRLF，并且幂等。生成结果前会阻止保留绑定、新增可识别标签、编译错误和文本控件长度语义变化。完整检查与 CLI 见[源码修订与迁移](../compatibility/source-versioning-ch.md)。

### `createLocalRuntime(document: LocalDocument, options?: LocalRuntimeOptions)`

只读命名值在可选的 `document.computations` 记录中用 `LocalComputation` 描述。`bindings` 和 `initialState` 继续只包含可写控件；`snapshot().state` 还包含该修订成功求值的计算结果。需要保留表达式错误语义时用 `evaluate(name)` 读取，失败值不会出现在快照里。见[计算与错误规则](../reference/computations-formatting-ch.md)。

为已编译文档创建独立的内存运行时。`document` 不是本地模式文档、初值超出预算或结构无效时会抛出错误。每个实例拥有独立状态；运行时本身不会保存或发送状态。

### `LocalRuntime`

`validate(): Diagnostic[]` 读取当前修订的跨字段失败提示，保留字段可编辑性，并返回缓存诊断的副本。`document.validations?: LocalValidation[]` 保存可序列化规则。数字集合为 `LocalValue` 增加 `number[]`、为 `LocalValueKind` 增加 `number-array`，原有可写选择控件继续使用字符串数组。见[条件、校验与本地集合](../reference/constraints-collections-ch.md)。

| 成员 | 参数 | 返回 | 行为 |
| --- | --- | --- | --- |
| `document` | — | `LocalDocument` | 创建时使用的编译结果 |
| `snapshot()` | — | `{ revision: number; state: Readonly<Record<string, LocalValue>> }` | 状态未变时返回同一快照对象；状态冻结并包含可用的 external 值；可写参数请用 `getParameters()` |
| `get(node, slot?)` | `LocalNode`、可选槽位 | `LocalValue` | 读取该控件绑定的值；`slot` 选择 `start`/`end` 或 `x`/`y`；无绑定或未知节点返回 `null`；数组为副本 |
| `set(node, value, slot?)` | `LocalNode`、`LocalValue`、可选槽位 | `Diagnostic[]` | 校验所有共享控件；成功返回空数组并提交一次；失败不增加 revision |
| `setMany(node, values)` | `LocalNode`、槽位值对象 | `Diagnostic[]` | 原子写入同一多槽控件的多个槽位；非法批次保持状态与 revision 不变 |
| `validate()` | — | `Diagnostic[]` | 返回当前跨字段校验失败的副本；不改变状态，也不拒绝字段编辑 |
| `parameterNames()` | — | `readonly string[]` | 排序后的公开绑定名；不含 `@` 内部绑定 |
| `getParameter(name)` | `string` | `LocalValue \| undefined` | 公开绑定的值；未知或内部名称返回 `undefined`；数组为副本 |
| `getParameters()` | — | `Readonly<Record<string, LocalValue>>` | 只含公开参数的冻结快照；永不含内部 `@` 键 |
| `setParameter(name, value)` | `string`, `LocalValue` | `Diagnostic[]` | 校验共享该绑定的所有控件；成功只提交一次；失败时状态不变 |
| `setParameters(values)` | `Readonly<Record<string, LocalValue>>` | `Diagnostic[]` | 校验每个公开值和多槽关系后全部提交或全部不提交；未知或内部名称返回 `local.runtime.parameter`；非法值返回 `local.runtime.value`；值未变化不增加 revision |
| `getExternal(name)` | `string` | `LocalValue \| undefined` | 已声明 external 的当前值；未声明或不可用时为 `undefined`；数组为副本 |
| `getExternalValues()` | — | `Readonly<Record<string, LocalValue>>` | 当前可用 external 值的冻结记录 |
| `setExternalValues(values)` | `Readonly<Record<string, LocalValue>>` | `Diagnostic[]` | 原子校验部分更新；只提交并通知一次；未知名称、类型错误或超预算返回 `local.runtime.external`，不改变状态或 revision |
| `evaluate(expression)` | `string` | `LocalValue` | 用当前状态求值；失败抛出 `LocalExpressionError`；数组为副本 |
| `text(template)` | `string` | `string` | 渲染带 `{{ }}` 的文本；失败抛出错误 |
| `reset(node)` | `LocalNode` | `void` | 一次恢复该节点子树内的参数和组件状态，只通知一次 |
| `resetToken(node)` | `LocalNode` | `number` | 控件内部状态的递增标记，供渲染器感知重置 |
| `subscribe(listener)` | `() => void` | `() => void` | 每次提交调用监听器；返回取消订阅函数 |
| `dispose()` | — | `void` | 幂等；清理订阅、表达式缓存和重置标记；之后其他成员会抛出 |

`set` 以文档中登记的控件为准，调用方传入的节点元数据不会放宽约束。`disabled` 与条件隐藏用于交互展示，宿主的业务权限和服务端数据校验仍由宿主执行。

### 按名称读写参数

按名称访问适用于自行保存参数值的宿主，例如表单或 URL。只能看到公开绑定：`parameterNames()` 返回排序后的名称；`getParameter(name)` 对未知或内部名称返回 `undefined`；`getParameters()` 返回只含公开参数的冻结记录。匿名 `@` 绑定不会出现，`getParameter` 返回的数组是副本。

写入会校验共享该绑定的所有控件（包括多槽关系），成功后只提交一次。失败时返回诊断且状态不变；值未变化时不增加 revision。未知或内部名称返回 `local.runtime.parameter`，非法值返回 `local.runtime.value`。

```ts
const names = runtime.parameterNames();          // 例如 ['annual', 'people']
const people = runtime.getParameter('people');   // 2

runtime.setParameter('people', 7);
const diagnostics = runtime.setParameters({ people: 8, annual: true });
if (diagnostics.length) {
  // 没有写入任何值。
}
```

### 状态导出与导入

`exportLocalState(runtime, generator?)` 把公开参数写入 `reactive-md-state/v1` 文件。文件在 `sourceDigest` 中记录文档身份，在 `syntax` 中记录语言修订，并可带生成器名称和版本。`snapshot().state` 中的匿名 `@` 绑定不会写入，因此原始快照不应作为长期协议保存。CLI 和独立浏览器运行时使用的格式见[可分享文档与静态导出](shareable-export-ch.md#起始参数与状态文件)。

`importLocalState(runtime, input, options?)` 接受序列化 JSON 或已解析的文件。它解析载荷，校验源码摘要、语法修订和完整的公开参数集合，验证每个值后再应用；导入失败时返回诊断且运行时状态不变。`options.maxLength` 限制序列化载荷的字节数，默认 1 MiB。

```ts
import { exportLocalState, importLocalState } from 'reactive-md';

const file = exportLocalState(runtime, { name: 'my-host', version: '1.0.0' });
const saved = JSON.stringify(file);

const diagnostics = importLocalState(runtime, saved);
```

较低层的 `createLocalStateFile`、`parseLocalState`、`resolveLocalState`、`applyLocalState` 和 `serializeLocalState` 仍然可用。只需校验、不改动运行中实例时使用 `resolveLocalState(document, input)`。

### 源码变化时保留参数

`LocalReactiveDocument` 在 `source` 变化时仍会按初值创建新运行时。自行管理运行时的宿主可以保留兼容的值：

```ts
import {
  applyLocalStateRetention,
  compileLocal,
  createLocalRuntime,
  planLocalStateRetention,
} from 'reactive-md';

const next = compileLocal(nextSource);
if (!next.ok) throw new Error('先修复编译诊断');

const plan = planLocalStateRetention({
  previous: previousRuntime.document,
  state: previousRuntime.snapshot().state,
  next: next.document,
});
const runtime = createLocalRuntime(next.document);
const { retained, dropped, diagnostics } = applyLocalStateRetention(runtime, plan);
```

`planLocalStateRetention` 返回可复用的值、保留的参数名称，以及带名称和原因的丢弃项。只有满足以下条件的参数才会保留：

- 名称在两份文档中都是公开绑定；
- 两个绑定都可安全保留：绑定拥有控件，每个控件都绑定到该名称，且各控件都不是计时器或清单；
- 类型和初始定义未变，包括有效初值和所有显式 `initial` 属性值。

匿名 `@` 绑定、已删除或改名的参数、计时器和位置清单会被丢弃。每个保留值都会按新文档的约束重新校验；被拒绝的值回退到新初值，并报告为 `invalid`。丢弃原因包括 `internal`、`unknown`、`unretainable`、`type`、`initial` 和 `invalid`。

`applyLocalStateRetention` 先尝试一次原子写入，保持多槽关系一致；随后按参数逐个写入，避免一个过期值阻塞其余参数。`diagnostics` 描述被新文档拒绝的值。

### 在 Worker 中后台编译

Worker 由宿主提供：用你的打包工具创建 worker 入口，并保留 `compileLocal` 作为回退。可复制的浏览器示例见[独立接入示例](../../examples/integration/README.md)。

```ts
// compile.worker.ts
import { startLocalCompileWorker } from 'reactive-md';

startLocalCompileWorker();
```

`startLocalCompileWorker()` 把处理器安装到当前 Worker 全局对象。仅在测试或包装其他消息宿主时显式传入 scope。

```ts
// main.ts
import { LocalCompileScheduler } from 'reactive-md';

const scheduler = new LocalCompileScheduler({
  createWorker: () => new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' }),
  onResult: ({ source, result, mode }) => render(source, result, mode),
  onPendingChange: (pending) => showSpinner(pending),
  onModeChange: (mode, detail) => console.log('compile mode', mode, detail),
});

scheduler.schedule(source);
```

`LocalCompileScheduler` 按 `LOCAL_COMPILE_DELAY_MS`（150 ms，可用 `delay` 覆盖）合并编辑，只保留一个进行中的任务和最新排队源码，并丢弃已被新编辑取代的结果。没有可用 Worker 或 Worker 出错后，它在主线程调用 `fallbackCompile`（默认 `compileLocal`）；Worker 失败后会永久切换到该回退，并通过 `onModeChange` 报告。Worker 抛出的错误或回退编译抛出的错误使用 `local.worker.compile` 诊断码。

`onResult` 接收 `LocalCompileOutcome`（`source`、`result`、`duration`、`mode`），`onPendingChange` 报告是否仍有排队或进行中的任务，`dispose()` 停止计时器、终止 Worker，并阻止之后的回调。

### 其他核心导出

- `LOCAL_SYNTAX_VERSION`：当前为字面量 `'local-draft-3'`。用它记录文档所用的语法修订。
- `compileExpression(source: string)`：返回带 `source`、`dependencies`、`evaluate(env)` 和 `inferType(env)` 的对象；失败抛出 `LocalExpressionError`。
- `LocalExpressionError`：包含 `code` 和 `offset`。
- `compileLatex(source: string)`：返回带 `source`、`dependencies` 和 `evaluate(x, env, budget?)` 的对象；失败抛出带 `code`、`offset` 的错误。
- `samplePlot(expression, env, min, max, samples = 200, sharedBudget?)`：返回 `{ points: { x: number; y: number | null }[]; endpoint: number | null }`；范围、采样数或预算无效时抛出。
- 状态文件：`exportLocalState`、`importLocalState`、`createLocalStateFile`、`parseLocalState`、`resolveLocalState`、`applyLocalState` 和 `serializeLocalState`；`LOCAL_STATE_FORMAT` 为 `'reactive-md-state/v1'`。
- 源码修订：`inspectLocalSourceVersion`、`checkLocalUpgrade` 和 `migrateLocalSource`；`LocalUpgradeOptions` 配置源修订和语义变化许可。
- 参数保留：`planLocalStateRetention` 和 `applyLocalStateRetention`。
- 后台编译：`LocalCompileScheduler`、`LOCAL_COMPILE_DELAY_MS` 和 `startLocalCompileWorker`。
- 类型导出：`Diagnostic`、`SourceRange`、`LocalValue`、`LocalValueKind`、`LocalNode`、`LocalBinding`、`LocalComputation`、`LocalValidation`、`LocalDocument`、`LocalCompileLimits`、`LocalCompileOptions`、`LocalCompileResult`、`LocalHostPropKind`、`LocalHostPropSchema`、`LocalHostComponentSchema`、`LocalUpgradeOptions`、`LocalRuntime`、`LocalSnapshot`、`LocalStateFile`、`LocalStateGenerator`、`LocalStateParseResult`、`LocalStateResolution`、`LocalRetainedState`、`LocalStateRetentionReason`、`LocalStateRetentionDrop`、`LocalStateRetentionInput`、`LocalStateRetentionResult`、`LocalCompileWorker`、`LocalCompileWorkerScope`、`LocalCompileRequest`、`LocalCompileResponse`、`LocalCompileOutcome`、`LocalCompileMode`、`LocalCompileSchedulerOptions`。

`compileExpression`、`compileLatex` 和 `samplePlot` 是较低层的工具，稳定级别与核心 API 相同；通常只需要 `compileLocal` 和 `createLocalRuntime`。

## 诊断

`Diagnostic` 的字段与稳定级别见[版本与兼容性](../compatibility/compatibility-ch.md)中的诊断契约。要点：`line`、`column` 和 `range` 用于程序定位；`code` 可用于当前版本的粗分类，但 0.x 不承诺跨版本稳定；`message` 是默认英文显示文本，不要解析。渲染器和 CLI 可通过共享诊断目录显示中文，回调仍收到结构化字段。

`onDiagnostics` 会在编译结果变化时收到编译诊断，也会收到控件写入被拒绝时的运行时诊断。编译错误文档不激活交互；运行时局部错误只替换对应内容。

## 状态、实例与清理

- `LocalReactiveDocument` 在 `source` 变化时重新编译并创建运行时，清理旧实例；支持 React StrictMode。
- 自行管理生命周期时，用 `<LocalDocumentView document={result.document} runtime={runtime} />` 渲染，并在卸载时调用 `runtime.dispose()`。
- `subscribe()` 返回取消订阅函数。`dispose()` 会清空剩余订阅，之后调用其他运行时方法会抛出错误。
- `snapshot()` 在状态变化前返回同一对象，可用于外部存储订阅。`reset(panelNode)` 对面板子树只提交一次，订阅者收到一次通知；面板内隐藏控件也在重置范围内。
- 文档状态只保存在内存中；运行时不会写入存储、Cookie 或网络。刷新、重新挂载或更换源码都从初值开始。持久化是宿主的显式操作，使用 `exportLocalState` 和 `importLocalState`；[参数保留工具](#源码变化时保留参数)可以把兼容的值带入新运行时。
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
- 文档开头可写 `<theme name="default">`，省略时选择 `default`。自定义主题通过 `themes` 登记；完整要求见[主题协议](../reference/theme-protocol-ch.md)。
- `colorScheme` 可强制深浅模式；默认 `auto` 跟随最近祖先的 `data-color-scheme` 或兼容的 `data-theme`，再跟随系统偏好。文档根节点输出独立的 `data-rmd-theme` 和已解析的 `data-color-scheme`。
- 文档默认 `max-width: 720px` 且水平居中。需要铺满宿主容器时，在自己的作用域内覆盖 `.md-document` 的宽度和边距。
- 主题优先覆盖公共变量；组件外层 `.md-*`、`.local-*` 类和语义状态属性可用于主题样式。内部节点排列不属于扩展接口；兼容要求见主题协议。
- 两个 React 组件都不接受 `className` 或 `style`。需要局部覆盖时，用宿主自己的包裹元素限定作用域。

## 资源限制

单个字符串最多 100,000 字符，数组最多 10,000 项，数组内字符串总长度最多 100,000 字符。邮箱校验使用有长度上限的线性检查。运行时拒绝超限写入，并保持上一次合法状态。

单个文档源码最多 1,000,000 字符。诊断最多 100 条，单条消息最多 2,000 字符。

每个绘图组件最多 16 条曲线，整篇文档最多请求 20,000 个曲线采样点，包括隐藏区域。绘图计算还受 2,000,000 步的共享执行预算限制。每份文档最多 100 条校验规则。`data-table` 的生成行、列数和文本有单表及整篇文档预算，见[条件、校验与本地集合](../reference/constraints-collections-ch.md)。超限文档会收到诊断；表达式和数学渲染也有各自的深度与记号预算。

这些上限限制单个文档的工作量，不替代宿主对请求大小、并发和执行时间的控制。完整威胁边界见[安全策略](../../SECURITY-ch.md)。

## 版本固定与升级

- 在 0.x 阶段固定准确的包版本，并提交 lockfile。`^0.3.0` 只允许补丁版本，但生产接入仍建议写死版本或固定 tarball 的 SHA256。
- 用一个包版本同时提供核心和 React 入口；不要混用不同版本的 `reactive-md` 和 `reactive-md/react`。
- 在应用配置或文档元数据中记录 `LOCAL_SYNTAX_VERSION`，与持久化的 `.reactive.md` 源码一起保存。语法修订变化时按[版本与兼容性](../compatibility/compatibility-ch.md)迁移。
- 升级后重新编译自有文档，检查 `result.diagnostics`、渲染结果和浏览器交互。不要依赖诊断 `message` 的文本。

## 不提供的功能

默认 ReactiveMD 路径支持 P0 HTML。作者 CSS、JavaScript 和扩展 HTML 的宿主开关使用独立的原生 HTML 路径，见 [HTML 部分兼容](../reference/html-compatibility-ch.md)。本地模式仍不提供自动状态持久化或不受限的网络访问、插件或自定义组件注册、作者发起的网络或存储调用、Vue 支持、React 18 支持或 CommonJS 入口。宿主数据必须通过显式只读声明提供，核心不会自行抓取。状态导出与导入是宿主的显式调用。`LocalReactiveDocument` 在源码变化时从初值开始；需要保留参数时使用保留工具，或自行管理运行时和文档。


新增组块、颜色、槽位状态与迁移规则见[local-draft-2 扩展说明](../reference/local-components-v2-ch.md)，升级清单见[0.4.0 发布与迁移](../releases/release-0.4.0-ch.md)。`0.6.0` 同时提供于 `latest` 与 `next` 渠道。

0.5.3 新增接受编译配置的作者工具及显式屏幕、打印样式入口，见 [0.5.3 宿主集成](../releases/release-0.5.3-ch.md)。0.6.0 让 `compileLocal` 返回可跨 React Server Components 边界的普通数据，见 [0.6.0 发布说明](../releases/release-0.6.0-ch.md)。
