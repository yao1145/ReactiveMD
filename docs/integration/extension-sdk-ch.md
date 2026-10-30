# 扩展 SDK 预览

[English](extension-sdk-en.md)

本页描述源码中的扩展 SDK 预览，覆盖公开扩展与默认组件统一。包版本仍为 `0.6.1`；新增入口随下一次发布提供，现有 registry 中的 `0.6.1` 不因此获得这些功能。开发与验收使用本地构建的 tarball。

```sh
npm run build:lib
npm pack
npm install ../reactive-md-0.6.1.tgz
```

tarball 必须在 `build:lib` 完成后由当前源码打包。registry 中的 `0.6.1` 早于 `reactive-md/build`、`reactive-md/testing` 和第三阶段入口。仓库内消费检查在源码树之外安装这个打包文件，公开导入面因此按发布形态接受检查，而不是依赖源码别名。版本范围仍写 `0.6.1`，预览不需要更换版本号。

SDK 把组件声明、实例配置、React 实现和主题资源分开。声明和配置都是可序列化数据；组件代码由宿主显式安装和导入。编译器、Worker、作者工具、构建适配器和导出器消费同一配置。

## 定义与装配

组件声明从 `reactive-md/sdk` 导入，React 实现从 `reactive-md/react` 导入：

```tsx
import { createLocalConfig, defineLocalComponent } from 'reactive-md/sdk';
import { createReactConfig, defineReactComponent, LocalReactiveDocument } from 'reactive-md/react';

const note = defineLocalComponent({
  id: 'example/note', name: 'note-box', version: '1.0.0',
  protocol: 'reactive-md-component/v1', form: 'container',
  props: { title: { kind: 'string', default: '说明' } },
  children: { kind: 'markdown' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { zh: '提示', en: 'Note' }, category: 'content',
    insertText: '<note-box title="说明">\n普通 **Markdown**。\n</note-box>',
  },
});
const implementation = defineReactComponent(note, {
  render: ctx => <aside><h3>{ctx.props.title}</h3>{ctx.children.render()}</aside>,
  renderStatic: ctx => <aside><h3>{ctx.props.title}</h3>{ctx.children.render()}</aside>,
});
const config = createLocalConfig({ components: [note] });
const reactConfig = createReactConfig(config, { components: [implementation] });

export function Reader({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} reactConfig={reactConfig} />;
}
```

默认预设保持启用。宿主也可从 `reactive-md/presets/default` 显式导入 `defaultPreset` 并传入 `presets: [defaultPreset]`。预设包含 46 个经过公开契约校验的组件；新增组件与默认组件共用编译和渲染机制。注册时拒绝同名覆盖。

配置创建时检查重复名称与 id、保留名称、协议、依赖和预算，并复制、冻结数据。`readLocalConfig` 对 Worker 或导出载荷中的配置重新校验，重新计算语义摘要。React 实现的 manifest 摘要必须与配置匹配。组件集合变化时创建新配置。

组件可声明 `requires: { kernel: '^0.6.1' }`，依赖项使用 `{ id, version }` 指定兼容范围。范围支持完整版本、`^`、`~` 和以空格连接的比较条件，例如 `>=0.6.1 <0.7.0`；不支持的写法会在注册时被拒绝。

## 属性与子内容

属性类型为 `string`、`number`、`boolean` 和 `enum`。声明可以提供默认值、必填规则、静态或动态求值模式，以及数值范围、整数限制、枚举和安全正则。

数值字面量 `max="5"` 和合法完整插值 `max="{{ 5 }}"` 都向实现提供数字 `5`。默认值仅用于属性缺省；非法显式值产生诊断。可选且无默认值的属性读为 `null`。字符串可包含混合文本插值；数字和布尔动态属性要求完整插值。

容器通过 `ctx.children.render()` 呈现已编译子内容。上下文提供归一化 props 和源码范围，组件无需访问内部 AST。父层隐藏状态由适配器传递。

属性的 `description` 接受 locale 映射。编辑器说明变化不改变编译语义摘要，也不会因此重置参数。

## 绑定与生命周期

`bindings.value` 声明主绑定槽位。组件实现通过 `ctx.bindings.value.get()` 和 `.set(next)` 读写；manifest 的 `bind` 与 `initial` 指定文档中的属性名。

写入经过内核共享约束检查，返回 `{ ok, diagnostics }`。非法写入保持状态和 revision。评分组件可以与内置 `<number>` 绑定同一公开参数；数字范围和步长须符合共享约束规则，同一参数只声明一次显式初值。

上下文还提供 `visible`、`disabled`、`resetToken`、`mode`、`instance` 和 `report`。局部展开、悬停或草稿状态由组件管理；需要响应面板重置时监听 `resetToken`。组件卸载时使用 React effect 的清理函数释放资源。

静态渲染使用只读绑定句柄，运行时重置也保持只读。能力声明记录支持哪些渲染环境：纯展示容器也可以支持交互文档环境。SSR 实现应可在没有 DOM 的环境执行。React 子树边界报告渲染异常，事件与异步代码按组件的错误处理接口报告失败。

`reactive-md/react/server` 的 `renderLocalStaticDocument` 先检查 SSR 能力，再执行静态渲染，返回 markup 或结构化诊断。严格导出遇到服务器执行失败时中止，保留错误信息。

离线 HTML 的 `staticMarkup` 使用该 server 入口的返回结果；它保留 React 文本节点边界，供 standalone 的 static-first hydration 恢复交互。组件声明了必需样式时，把同一份 `resources` 同时提供给 server 渲染和导出预检。

数值绑定边界可以引用数值属性；动态 min/max 进入内核约束元数据，并校验属性自身的范围和整数规则。作为 step 来源的属性要求静态数值。绑定 family 声明值的通用语义，例如数字、文本、日期、选项或集合；具体功能与外观由实现决定。

## 命名槽位、集合与结构规则

第二阶段把默认组件的契约放入 `defaultPreset.components`。这些定义经过与外部组件相同的 `defineLocalComponent` 校验。`config.components` 保持外部组件列表，`config.registry` 提供默认与外部组件的完整快照。

`bindings` 是以槽位名为键的记录。坐标控件可以声明 `x`、`y`，分别使用 `bind-x`、`bind-y` 和对应初始值属性。在 React 实现中：

```ts
const x = ctx.bindings.get('x');
const y = ctx.bindings.slots.y.get();
const result = ctx.bindings.setMany({ x: 2, y: 3 });
```

`setMany` 进行一次内核事务：全部槽位通过校验后提交；任一失败时，参数和 revision 都保留原值。主槽位 `value` 可以与命名槽位共存，并参与同一事务。`slotRelations: [{ lower: 'start', upper: 'end' }]` 声明范围顺序。命名槽位采用独占绑定，省略 `exclusive` 时归一化为 `true`，显式 `false` 在注册时拒绝。

集合控件通过主槽位读取数组，并提交一个新数组。`multi-select` 使用结构选项与最大选择数约束；`checklist` 从任务列表派生初值。适配器交付只读值，状态副本由内核统一维护。

通用集合使用 `family: 'collection'`，搭配 `kind: 'array'` 或 `'number-array'`；数组保留顺序和重复值，`initial` 使用 JSON 数组字面量，`maxItems` 限制长度。上限可使用字面量或静态数值属性；动态上限在注册时拒绝。状态文件可保存字符串数组和有限数字数组，并在恢复时按绑定类型重新校验。命名槽位在此版支持 `kind: 'number'`、`family: 'number'`；其余组合在注册时明确拒绝。`required: true` 要求源码提供该槽位的绑定名。

`structure` 声明直接子项、父层要求和内容形态；`rules` 声明可复用的编译或状态规则。规则可描述数值区间、日期、选项序列、表格、图形、导航和预算。内核执行规则，组件实现负责交互。外部组件可以复用默认定义的规则，或组合公开类型声明的原语。

React 上下文的 `content` 与 `children.items()` 提供公开内容投影。组件通过 `children.render()`、`children.options()`、`children.table()` 等方法消费子内容，通过 `validation`、`navigation`、`source` 和 `locale` 使用通用服务。运行时服务提供求值、状态读写与重置；内部 AST 保留在适配器中。

`examples/integration/extension-sdk/advanced.tsx` 展示了自定义坐标、集合和 Markdown 容器。逐项迁移情况见[第二阶段清单](../development/extension-sdk-phase2-inventory-ch.md)。

## 作者工具

```ts
import { compileLocal, completeLocalSource } from 'reactive-md';
import { createLocalComponentCatalog, insertLocalComponent, validateLocalComponentInsertTemplates } from 'reactive-md/authoring';

const result = compileLocal(source, { config });
const candidates = completeLocalSource(source, offset, { config });
const catalog = createLocalComponentCatalog(config, 'zh');
const edit = insertLocalComponent(config, 'example/note', source, selection, 'zh');
```

标签、属性、说明、插入模板及成对标签闭合来自同一配置。`insertLocalComponent` 处理绑定名分配、选区和光标模板，返回编辑结果。`validateLocalComponentInsertTemplates` 编译实际插入结果，报告与当前配置不匹配的模板。宿主可以把目录接入自己的菜单。

## 主题包与组合

`defineLocalTheme`、`composeLocalTheme` 和 `collectLocalThemeCss` 负责定义、组合和收集独立主题包。主题包是纯数据：身份、协议 `reactive-md-theme-1`、明暗两套色彩方案和有界内联 CSS 资源。每条选择器都限制在 `[data-rmd-theme="主题名"]` 根节点中。

```ts
import { defineLocalTheme, composeLocalTheme, collectLocalThemeCss } from 'reactive-md/sdk';

const paper = defineLocalTheme({
  id: 'example/paper', name: 'paper', version: '1.0.0',
  protocol: 'reactive-md-theme-1', colorSchemes: ['light', 'dark'],
  css: [{ id: 'example/paper.css', css: paperCss }],
});
const highContrast = composeLocalTheme({
  id: 'example/paper-contrast', name: 'paper-contrast', version: '1.0.0',
  base: paper, overrides: [{ id: 'example/paper-contrast.css', css: overrideCss }],
});
const stylesheet = collectLocalThemeCss(highContrast);
```

主题 CSS 只接受内联 `data:` 资源，拒绝网络引用、`@import` 和字符串之外的 CSS 转义。主题包本阶段拒绝带全局名称的 `@font-face` 和 `@keyframes`；可使用系统字体、过渡和公共动效变量。

`composeLocalTheme` 把覆盖层追加在基础样式之后。覆盖层不得复用基础主题已声明的资源 id。`collectLocalThemeCss` 按样式表顺序拼接资源。

组件通过 `styles: ['example/rating.css']` 声明必需资源 id，宿主在构建和导出时提供对应 `{ id, css }`。组件默认样式先于主题增强样式输出。组件结构样式使用公共语义变量，与主题增强相互独立。

## 构建独立 bundle

`reactive-md/build` 是 Node 构建适配器。它只读取宿主明确指定的模块，第三方代码仍是宿主安装的依赖。文档中的名称或 URL 不会触发代码下载。

### 宿主入口模块

入口必须是 Node 可加载的 ESM：`.mjs`，或模块包内的 `.js`。它导出两个准备好的对象和文件系统约定：

```js
// build-host.mjs
export { config, reactConfig } from './dist/node/entry.mjs';
export const root = new URL('.', import.meta.url);
export const allowlist = ['src'];
export const resources = [
  { id: 'example/component.css', path: 'src/component.css' },
];
export const notices = [
  { id: 'example/package', license: 'MIT', text: '署名文本。' },
];
```

`root` 是适配器唯一读取的目录。每个 `allowlist` 目录都必须在 `root` 内，资源文件必须同时位于两者之内，入口模块也必须在 `root` 内。`resources`（或 `styles`）可选；`notices` 接受记录数组或字符串。构建调用中的同名 `resources` 与 `notices` 选项会和宿主导出的声明合并。相同声明去重；内容冲突产生诊断。

### 预检与构建

```ts
import { preflightLocalStandaloneBuild, buildLocalStandaloneBundle } from 'reactive-md/build';

const preflight = await preflightLocalStandaloneBuild({
  entry: './build-host.mjs',
  themes: ['paper'],
  budgets: { maxResources: 64 },
});
if (!preflight.ok) {
  for (const item of preflight.diagnostics) console.error(item.code, item.message);
}
const bundle = await buildLocalStandaloneBundle({ entry: './build-host.mjs', themes: ['paper'] });
```

`preflightLocalStandaloneBuild` 校验宿主模块、`LocalConfig` 摘要、React 实现与 manifest 的对应关系、离线能力和每条 CSS 资源引用。返回 `ok`、`diagnostics`、`entry`、`root`、`allowlist`、`config`、`configKey`、`resources`、`assets`、`css` 和 `notices`。这一步不加载 Vite，也不生成脚本。

`buildLocalStandaloneBundle` 执行同一预检，再打包单个 IIFE 脚本，返回扁平对象：

| 字段 | 内容 |
| --- | --- |
| `script` | 单个内联 IIFE 源码。 |
| `extensions` | 与 `LocalStandaloneBundle` 兼容的组件需求。 |
| `seal` | 导出完整性检查使用的 bundle manifest。 |
| `configKey` | 已安装配置的语义摘要。 |
| `resources` | 收集到的样式资源，含 id、origin、摘要和字节数。 |
| `assets` | 内联的 CSS、字体和图片，含路径、MIME 与摘要。 |
| `css` | 按顺序拼接的资源 CSS。 |
| `notices` | 格式化后的声明文本。 |
| `manifest` | 完整构建清单，协议 `reactive-md-build/v1`。 |

构建清单记录 `sdkVersion`、`configKey`、`format: 'iife'`、脚本摘要与字节数、资源身份、内联资源、组件需求、全部已安装主题和声明条目。归档 bundle 时一并保留清单，便于外部核验。

预检或构建失败时抛出 `LocalBuildError`，附带全部诊断。预算覆盖值会先校验；非法值逐项回退到默认值并产生诊断。

Vite 输出必须恰好是一个 chunk，且没有 asset。适配器拒绝带 imports、dynamic imports 或隐式加载块的结果，拒绝包含 `import.meta`、动态 import、Worker 构造函数、service worker、`fetch`/`XMLHttpRequest` 或远程模块说明符的脚本，也拒绝空脚本和超过 32 MiB 的脚本。扩展模块构造 Worker 时构建失败；已安装内核中 ELK 的可选 worker 路径由进程内工厂替代。

### 资源与预算

资源输入在“内联 CSS”和“文件路径”之间二选一。内联 CSS 中的相对 `url()` 需要显式的 `base` 目录，且该目录位于 `root` 内。

```ts
{ id: 'example/component.css', css: inlineCss, base: 'src' }
{ id: 'example/theme.css', path: 'src/theme.css' }
```

收集器内联本地 `@import` 与 `url()` 目标，保留 `data:` URL，并报告缺失文件、远程引用、越过 `root` 或 allowlist 的路径、符号链接逃逸、导入循环、同 id 不同内容和预算超限。输出顺序固定：组件样式 id、宿主声明、所选主题。主题选择默认包含全部已安装主题；显式列出保留主题 `default` 不会增加资源包。

默认预算为 128 个资源、4 MiB CSS、单文件 8 MiB、内联数据 24 MiB、256 个文件、导入深度 16。绝对上限分别为 512、32 MiB、32 MiB、64 MiB、1024 和 32。`maxImportDepth` 与 `maxInlinedBytes` 接受零。

### 可选 Vite peer

Vite 8 是可选 peer 依赖。适配器只在真正执行构建时导入 `vite`，仅做预检或读取 manifest 的消费者无需安装。测试或非标准宿主可以把 `vite` 作为 `{ build }` facade 或其工厂传入；注入值会先经过检查。

## 离线导出与 bundle seal

`defineLocalStandaloneBundle(script, config)` 把宿主预先构建的可信脚本与已安装 manifest 集合绑定。seal 使用协议 `reactive-md-bundle/v1`，记录 SDK 版本、配置摘要、脚本摘要和每个主题的契约摘要。

```ts
import { createLocalExportPlan, createLocalShareableHtml } from 'reactive-md/export';
import { buildLocalStandaloneBundle } from 'reactive-md/build';

const bundle = await buildLocalStandaloneBundle({ entry: './build-host.mjs' });

const plan = createLocalExportPlan({
  document, config, target: 'offline', bundle,
  resources: bundle.resources,
});
if (!plan.ok) throw new Error(plan.diagnostics.map(item => item.message).join('\n'));

const html = createLocalShareableHtml({
  source, document, config, state, title: '我的文档',
  staticMarkup, css,
  bundle, resources: bundle.resources, notices: bundle.notices,
  mode: 'interactive',
});
```

`createLocalExportPlan` 在生成输出或序列化状态之前检查目标能力、组件身份与版本、语义摘要、主题选择和样式资源。它也会重新校验文档携带的组件定义，以及文档实际使用的每个外部组件需求。目标为 `static`、`ssr` 或 `offline`。离线目标要求 bundle 脚本，校验 bundle 的扩展需求与 seal，检查 bundle 覆盖文档所需的每个组件，并把所选主题与 seal 中的主题比较。

`createLocalShareableHtml` 要求 `staticMarkup` 来自 `renderLocalStaticDocument`，并拒绝包含不可用扩展占位符的 markup。它嵌入配置、需求、样式和可选的运行时脚本，同时为下一宿主记录 `reactive-md-restore/v1` 要求。

独立运行入口显式导入 `reactConfig`，再调用 `mountAll`：

```ts
import { mountAll } from 'reactive-md/standalone';
import { reactConfig } from './extensions';

mountAll(document, { reactConfig });
```

把这个入口打包成 IIFE 后交给导出器。生成的构建入口还导出 `mountReactiveMD` 和 `unmountReactiveMD`，挂载前再次检查打包时写入的配置摘要。需求声明不会触发下载代码。

## 恢复与版本

SDK 导出使用 v2 HTML 载荷，记录 `reactive-md-restore/v1` 要求；普通导出保持原有 v1 默认行为。`reactive-md-state/v1` 参数文件不变。

`createLocalRestorationRequirements(document, config, target, resources)` 记录 SDK 范围（`^0.6.1`）、配置摘要、源码摘要、目标、文档实际使用的组件及其版本、范围与契约摘要、所选主题，以及样式资源摘要。

`validateLocalRestorationRequirements(value, { config, source, resources, document })` 在应用状态或挂载 React 之前运行。它检查恢复协议与大小上限、SDK 范围、配置摘要、源码摘要、已安装组件的身份与版本范围、契约摘要、目标能力、主题契约以及资源是否存在且摘要一致。缺失或不匹配会阻止恢复。

版本范围允许升级时，变化的组件契约仍要求重新编译并校验状态，之后才能应用状态。bundle seal 用于发现脚本或配置与构建不一致；构建清单提供 SHA-256，便于归档与外部核验。

## 合规测试

`reactive-md/testing` 不依赖 React、DOM 或浏览器。`reactive-md/testing/react` 增加静态与 SSR 执行；`reactive-md/testing/browser` 运行可移植的浏览器场景，并提供可选的 Playwright 适配器。

核心入口验证 manifest，并执行真实的编译器和运行时行为：

```ts
import {
  createLocalComplianceReport,
  runLocalBehaviorCompliance,
  runLocalManifestCompliance,
} from 'reactive-md/testing';

const manifest = runLocalManifestCompliance(rating);
const behavior = runLocalBehaviorCompliance({
  protocol: 'reactive-md-behavior-spec/v1',
  component: 'rating',
  source: '<rating bind="score" label="Score" max="5" initial="3">',
  writes: [
    { id: 'increment', value: 4, accepted: true, expect: { score: 4 } },
    { id: 'over-max', value: 6, accepted: false },
  ],
}, config);

const report = createLocalComplianceReport({
  config, component: 'rating', suites: [manifest, behavior],
  requireCapabilities: false,
});
```

Manifest 用例重新读取定义，检查键序稳定性、默认值、必填属性、未知字段和非法取值。行为用例编译源码，执行真实 `set` 与 `setMany`，验证回滚与 revision，重置作者初值，并检查集合数组的防御性复制。写入 spec 用 `value` 写单个槽位，或用 `values` 提交一次原子多槽位写入，并声明运行时必须接受还是拒绝，以及可选的预期参数。

`runLocalReactCompliance` 执行静态渲染、两次严格 SSR 和可选的服务器错误探针：

```ts
import { runLocalReactCompliance } from 'reactive-md/testing/react';

const react = runLocalReactCompliance({
  config, reactConfig, resources,
  component: 'rating',
  spec: {
    protocol: 'reactive-md-react-spec/v1',
    source,
    staticMarkupIncludes: ['data-rating-static'],
    ssrMarkupIncludes: ['data-rating-static'],
  },
  locale: 'en',
});
```

`resources` 使用构建步骤给出的规范列表。把同一数组传给 `renderLocalStaticDocument`、`runLocalReactCompliance` 和导出预检，三个环节就会以完全相同的 CSS 校验和渲染。

浏览器合规检查接收 driver 与有界 spec。`createPlaywrightBrowserDriver` 适配已有 Playwright context，不直接导入 Playwright：

```ts
import {
  createPlaywrightBrowserDriver,
  runLocalBrowserCompliance,
} from 'reactive-md/testing/browser';

const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 900 } });
const browser = await runLocalBrowserCompliance({
  driver: createPlaywrightBrowserDriver(context),
  spec: {
    protocol: 'reactive-md-browser-spec/v1',
    url: 'file:///path/to/interactive.html',
    offline: true,
    cases: [
      { id: 'ready', phase: 'mount', kind: 'visible', selector: '[data-rating]', expected: true },
      { id: 'up', phase: 'edit', kind: 'click', selector: '[data-rating-up]' },
      { id: 'edited', phase: 'edit', kind: 'text', selector: '[data-rating-value]', expected: '4' },
      { id: 'unmount', phase: 'unmount', kind: 'unmount' },
    ],
  },
  config, component: 'rating',
});
```

浏览器阶段为 `mount`、`hydration`、`edit`、`hide-show`、`disabled`、`reset`、`descendant-error` 和 `unmount`。用例种类为 `visible`、`text`、`attribute`、`count`、`enabled`、`wait`、`click`、`fill`、`press`、`evaluate`、`isolation` 和 `unmount`。spec 的 URL 必须使用 `file:` 或 `data:`。套件报告 `requiredPhases` 中的每个阶段，默认包含全部八个；缺失阶段记为跳过。交互证据要求除 hydration 外的七个生命周期阶段全部通过且无失败。离线证据另要求 hydration、断网上下文、http(s)/ws 请求为零，且没有意外页面错误。

每份报告区分 `passed`、`failed`、`skipped` 和 `unsupported`。声明的能力只有带该能力标签的通过用例才能满足；缺少这样的用例时证据保持缺失，汇总报告失败。`complete` 仅在每项声明能力都有实际执行证据时为真。`compareLocalComplianceParity` 按用例 id、状态和观测值比较两份结果，可用于核对默认契约的外部别名与内置实现。

## 可复制的组件包

[组件包模板](../../examples/component-package/README-ch.md)是完整的外部消费样例。它定义评分控件、Markdown 提示容器、主题包和内联 SVG，再对安装后的 tarball 运行公开合规工具。

```sh
cd ../reactive-md-component-package
npm install
npm run build
npm test
```

`npm test` 生成实际的单文件离线 HTML，在断网浏览器中运行评分与单独的 note 生命周期，并把报告写入 `dist/compliance.json`。组件包通过 `exports` 映射提供编译后的 JavaScript 和类型声明。模板保持私有；只有在明确要发布时才重命名、选择许可证并移除 `private`。

## 从旧注册方式迁移

旧 `hostComponents`、`hostRenderer` 和 `hostData` 继续保留。它们与新配置同时传入时产生配置冲突。旧组件声明在输入层转换为统一 schema，旧 renderer 保留原有属性解析行为。

迁移步骤：

1. 用 `defineLocalComponent` 替换每个 host component schema，保持名称、版本、属性和能力。
2. 把渲染函数移入 `defineReactComponent`，从上下文读取 `props`、`bindings` 和 `children`。
3. 创建一个 `LocalConfig` 和一个 `LocalReactConfig`，传给所有编译、作者工具、server 和导出调用。
4. 重新编译文档并重建独立 bundle。配置摘要会变化，旧配置生成的 seal 或恢复要求不再匹配。

开发步骤见[组件插件开发指南](../development/component-development-ch.md)；[架构规划](../development/extension-sdk-plan-ch.md)保留设计顺序，结果见[统一验收记录](../development/extension-sdk-acceptance-ch.md)。

## 完整样例与验证

[独立消费样例](../../examples/integration/extension-sdk/README.md)提供评分控件、提示容器和 paper 主题。它使用公开入口，评分与内置数字控件共享绑定，容器显示普通 Markdown 和表达式结果。

先构建库，再执行：

```powershell
npm.cmd run build:lib
npm.cmd run test:sdk-consumer
```

验证脚本在系统临时目录安装真实 tarball，检查类型、绑定、props、目录模板、SSR、导出预检，再用断网的新浏览器上下文检查桌面和手机宽度下的交互恢复、重置与主题。结果位于 `artifacts/sdk-consumer/verification.json`，导出 HTML 和截图保留在同目录。
