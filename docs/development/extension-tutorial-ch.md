# 扩展作者教程：从定义到离线导出

**中文** · [English](extension-tutorial-en.md) · [最小模板](../../examples/minimal-extension/README-ch.md)

本教程沿着最小模板走完一条完整路径：定义 manifest、实现 React、注册宿主、预览、SSR 检查、离线导出和测试。模板是 [examples/minimal-extension](../../examples/minimal-extension/README-ch.md)，组件名 `rating-card`，全部命令都能在该目录执行。

需要主题、编译后类型声明和浏览器套件时，再转到[组件包模板](../../examples/component-package/README-ch.md)。完整字段与契约见[组件插件完整开发契约](component-development-reference-ch.md)和[扩展 SDK](../integration/extension-sdk-ch.md)。

## 1. 必需步骤与可选能力

| 步骤 | 是否必需 | 产物或命令 | 证明什么 |
| --- | --- | --- | --- |
| manifest、React 实现、`config`/`reactConfig` | 必需 | `src/extension.tsx` | 组件能被编译、装配和渲染 |
| Vite 预览 | 必需 | `npm run preview` | 作者能看到组件在文档中的实际行为 |
| Node/SSR 检查 | 必需 | `npm test` | manifest、绑定、静态与 SSR 输出正确 |
| 离线导出 | 必需 | `npm run export` | bundle、seal、严格 SSR 和 notices 能组装成单文件 |
| 组件 CSS 资源 | 可选 | manifest `styles` + 导出 `resources` | 样式随预览、SSR 和导出一起交付 |
| 独立主题包 | 可选 | `defineLocalTheme` + `<theme>` | 文档级视觉切换 |
| 浏览器 Playwright 套件 | 可选 | `reactive-md/testing/browser` | 挂载、hydration、断网零请求等真实浏览器证据 |
| 发布到 npm | 可选 | `npm pack --ignore-scripts` | 第二个项目通过公开入口消费 |

基础流程只走前四行。模板默认不包含主题、CSS 资源和浏览器套件；第 8 节说明这些能力各自还需要什么证据。

## 2. 复制模板并安装

需要 Node 22.12 或更高版本。把模板复制到仓库之外：

```sh
cp -r examples/minimal-extension ../my-rating-card
cd ../my-rating-card
npm install
npm run preview
```

模板声明 `reactive-md@^0.8.0`，安装前先把范围提升到目标发布版本。测试尚未发布的候选版本时，用当前源码打包的 tarball 替换 registry 安装：

```sh
npm install ../reactive-md-<version>.tgz
```

该命令同时安装 `react`、`react-dom` 和开发依赖。打开 Vite 打印的地址（默认 `http://localhost:5173`），确认页面出现示例文档、评分卡和内置数字框。

| 路径 | 用途 |
| --- | --- |
| `src/extension.tsx` | manifest、两个渲染函数、`config`、`reactConfig` |
| `src/preview.tsx`、`index.html` | Vite 预览页 |
| `src/source.ts`、`sample/document.reactive.md` | 示例文档及 `?raw` 导入 |
| `scripts/build.mjs` | 编译 `dist/node/entry.mjs` |
| `scripts/test-node.mjs` | Node/SSR 合规检查 |
| `scripts/export.mjs` | 离线导出 |

## 3. 定义 manifest

manifest 是纯数据，放在 `src/extension.tsx` 的前半部分：

```ts
export const ratingCard = defineLocalComponent({
  id: 'example/rating-card',
  name: 'rating-card',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', dynamic: true, default: 5, integer: true, min: 1, max: 10 },
  },
  bindings: {
    value: {
      kind: 'number', family: 'number',
      bind: 'bind', initial: 'initial', initialRule: 'nearest-zero',
      constraints: {
        min: { literal: 0 },
        max: { prop: 'max' },
        step: { literal: 1 },
      },
    },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Rating card', zh: '评分卡' },
    description: { en: 'A leaf card that increments one shared number.', zh: '递增一个共享数值的叶子卡片。' },
    category: 'input',
    insertText: '<rating-card bind="score" label="Score" max="5" initial="3">',
  },
});
```

各部分的作用：

- `id`、`name`、`version`、`protocol`、`form`：身份与形态。`name` 是文档里的标签名，必须是小写 kebab-case；`form: 'leaf'` 表示没有子内容。
- `props`：文档属性。`label` 必填；`max` 可动态求值，默认 5，限制为 1 到 10 的整数。实现读到的是归一化后的值，`max="5"` 与 `max="{{ 5 }}"` 都是数字 `5`。
- `bindings.value`：主绑定槽位。`bind="score"` 把它连接到公开参数 `score`，`initial="3"` 给出初值，`initialRule: 'nearest-zero'` 在缺少初值时取最近的合法值。`constraints` 的下限来自字面量，上限来自 `max` 属性，步长为 1。内核按这些约束接受或拒绝写入。
- `capabilities`：声明支持交互、静态、SSR 和离线导出。声明越多，需要的证据越多；第 8 节按能力列出对应套件。
- `authoring`：编辑器目录使用的标题、说明、分类和插入模板。它不改变编译语义，改文案不会让已有参数失效。
- 模板不声明 `styles`，因此没有 CSS 资源依赖。CSS 是可选能力，见第 7 节末尾。

`createLocalConfig` 在创建时校验重复名称、保留名称、协议、依赖和预算，然后复制并冻结数据。默认预设保持启用，`rating-card` 与内置组件共用同一套编译和渲染机制。

## 4. 实现 React 与静态输出

同一文件的第二半部分实现交互版与静态版，并用 `defineReactComponent` 绑定到同一个 manifest：

```tsx
export function RatingCard(context: LocalComponentContext) {
  const value = currentValue(context);
  const maximum = typeof context.props.max === 'number' ? context.props.max : 5;
  const unavailable = context.disabled || !context.visible;
  const locked = unavailable || value >= maximum;
  return (
    <div className="rating-card" data-rating-card role="group" aria-label={String(context.props.label)}>
      <output data-rating-card-value>{String(value)}</output>
      <button type="button" data-rating-card-up disabled={locked}
        onClick={() => context.bindings.value.set(value + 1)}>Add one</button>
      <button type="button" data-rating-card-reset disabled={unavailable}
        onClick={() => context.runtime.reset(context.content)}>Reset</button>
    </div>
  );
}

export function RatingCardStatic(context: LocalComponentContext) {
  return (
    <span className="rating-card" data-rating-card-static>
      {String(context.props.label)}: {String(currentValue(context))}
    </span>
  );
}

const ratingCardImplementation = defineReactComponent(ratingCard, {
  render: RatingCard,
  renderStatic: RatingCardStatic,
});
```

实现要点：

- `context.bindings.value.get()` 读取共享参数，`.set(next)` 交给内核校验。越界、类型错误或步长不符的写入被拒绝，状态和 revision 保持不变。
- `context.disabled` 与 `context.visible` 由父层和文档状态传入。组件被禁用或隐藏时，两个按钮都要禁用；Reset 会修改共享状态，同样不能绕过这个开关。
- `context.runtime.reset(context.content)` 恢复作者声明的初值。静态模式下运行时服务忽略重置，组件不需要额外分支。
- `renderStatic` 使用只读绑定，输出纯文本等价内容。需要不同静态版式时才单独提供；只读能力由适配器保证，组件自己的 state 和计时器仍需自行约束。

`config` 与 `reactConfig` 在同一文件末尾创建：

```ts
export const config = createLocalConfig({ components: [ratingCard] });
export const reactConfig = createReactConfig(config, { components: [ratingCardImplementation] });
```

`createReactConfig` 会检查实现的 manifest 摘要与配置是否一致。修改 manifest 后必须重新创建两者，不能只改一边。

## 5. 注册宿主并在 Vite 中预览

宿主需要两个对象：编译、编辑器和 Worker 使用 `config`（通常作为 `compileOptions.config`），预览、SSR 和导出使用 `reactConfig`。两者必须来自同一组声明。

模板的预览页只有两个文件。`src/preview.tsx`：

```tsx
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import { reactConfig } from './extension';
import { source } from './source';

const host = document.getElementById('app');
if (!host) throw new Error('The preview page is missing #app.');
createRoot(host).render(
  <LocalReactiveDocument source={source} reactConfig={reactConfig} locale="en" />,
);
```

`index.html` 加载 `/src/preview.tsx`，容器是 `#app`。Vite 直接处理 TSX 和 `?raw`，模板不需要 `vite.config.ts`。运行：

```sh
npm run preview
```

修改 `src/extension.tsx` 或示例文档后刷新页面即可看到结果。页面上的按钮、`<number>` 和正文里的 `{{ score }}` 共享同一个参数。

在已有产品宿主中，装配位置由宿主决定：

- 使用 `reactiveMd()` 的 Vite 项目把组件包放入 `plugin/<名称>/index.ts`，主题放入 `theme/<名称>/`。组件包默认导出 `LocalReactPackage`。
- 手动模式使用 `extensions.ts`，导出 `host = createReactHost(...)`。
- Demo 仓库的接入步骤见 [Demo 扩展编写说明](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/extension-authoring-ch.md)，目录规则见[按目录接入](../integration/directory-discovery-ch.md)。

## 6. SSR 检查

`npm test` 先编译再运行 Node 检查：

```sh
npm run build
node scripts/test-node.mjs
```

`scripts/build.mjs` 用 Vite 的 SSR 构建把 `src/extension.tsx` 编译为 `dist/node/entry.mjs`，并把 `reactive-md` 和 React 保持为外部依赖。测试和导出脚本导入这个文件，因此三处使用同一份 manifest 与实现。

`scripts/test-node.mjs` 调用四个公开工具：

```ts
const manifest = runLocalManifestCompliance(entry.ratingCard);
const behavior = runLocalBehaviorCompliance(behaviorSpec, entry.config);
const react = runLocalReactCompliance({
  config: entry.config,
  reactConfig: entry.reactConfig,
  component: 'rating-card',
  spec: reactSpec,
  locale: 'en',
});
const report = createLocalComplianceReport({
  config: entry.config,
  component: 'rating-card',
  suites: [manifest, behavior, react],
  capabilities: ['interactive', 'static', 'ssr'],
});
```

- manifest 套件重新读取定义，检查键序稳定性、默认值、必填属性、未知字段和非法取值。
- behavior 套件编译 `behaviorSpec.source`，执行真实的 `set`：`4` 和 `5` 被接受，`6` 和字符串 `'four'` 被拒绝，重置恢复初值 `3`。一个接受、一个拒绝加一次重置才产生 `interactive` 标签的证据。
- react 套件执行静态渲染和两次严格 SSR，要求 `data-rating-card-static` 出现且两次输出一致。`reactSpec.source` 使用整份示例文档。
- 报告写入 `dist/compliance.json`，同时打印每项能力的 `passed`、`failed`、`skipped` 或 `unsupported`。

报告里的 `capabilities` 列表故意只写 `interactive`、`static` 和 `ssr`，所以命令成功时 `complete` 仍为 `false`：offline 已声明，但这次运行没有它的证据。

## 7. 离线导出

```sh
npm run export
```

命令执行 `scripts/build.mjs`，然后执行 `scripts/export.mjs`。导出分三步：

1. 写出只供构建器读取的宿主模块 `dist/build-host.mjs`，导出 `config`、`reactConfig`、`root` 和 `allowlist`。`root` 限定可读目录，`allowlist` 必须是 `root` 内至少一个目录；模板没有 CSS 资源，仍保留 `src`。
2. `buildLocalStandaloneBundle({ entry: host, notices })` 做预检：配置摘要、React 实现与 manifest 的对应关系、每个组件的 `interactive`/`static`/`offline` 能力、资源引用和预算。预检通过后，Vite 把实现打成单个 IIFE，返回 `script`、`seal`、`resources`、`notices` 和 `manifest`。
3. `renderLocalStaticDocument` 用严格 server 入口生成 markup，`exportLocalState` 导出运行时状态，`createLocalShareableHtml` 校验导出计划、bundle seal 和配置摘要后写出 HTML。

产物：

| 文件 | 内容 | 证明什么 |
| --- | --- | --- |
| `dist/interactive.html` | 单文件 HTML，内联脚本、样式、状态、恢复要求和 notices | bundle、seal、资源、notices 与 SSR markup 能组成可交付文件 |
| `dist/build-manifest.json` | 构建清单，含 SDK 版本、`configKey`、脚本摘要、资源和组件需求 | 归档时可用 SHA-256 外部核验 |

直接用浏览器打开 `dist/interactive.html` 可以手动试用。这一步是人工检查，不是自动化证据：模板不运行 hydration、断网或生命周期断言。

CSS 资源是可选能力。启用时在 manifest 声明 `styles: ['example/rating-card.css']`，在 `scripts/export.mjs` 的 `buildLocalStandaloneBundle` 调用中加入 `resources: [{ id: 'example/rating-card.css', path: 'src/rating-card.css' }]`，并让 `allowlist` 覆盖该文件。`resources.id` 必须与 `styles` 一致。主题同样可选：用 `defineLocalTheme` 定义主题，传给 `createLocalConfig({ themes })`，文档用 `<theme name="...">` 选择。两者都要重新构建 bundle，配置摘要变化后旧 seal 不再匹配。

## 8. 测试与合规报告

| 套件 | 覆盖的声明能力 | 具体证据 | 默认是否执行 |
| --- | --- | --- | --- |
| `runLocalManifestCompliance` | 无（基础校验） | 默认值、必填、非法字段、预算 | 是 |
| `runLocalBehaviorCompliance` | `interactive` | 真实编译与写入、拒绝回滚、revision、重置 | 是 |
| `runLocalReactCompliance` | `static`、`ssr` | 静态 markup、两次一致的严格 SSR、可选服务器错误探针 | 是 |
| `runLocalBrowserCompliance` | `interactive`、`static`、`offline` | 挂载、编辑、隐藏/显示、禁用、重置、子树错误隔离、卸载；离线另需 hydration、断网和零请求 | 否 |

`npm test` 的结果说明：

- 通过：manifest 契约、绑定规则、静态输出和 SSR 输出符合声明。
- 未验证：浏览器中的挂载与 hydration、离线上下文的零网络请求、导出的 HTML 能否在浏览器恢复交互。
- 因此 `dist/compliance.json` 的 `complete` 为 `false`，脚本输出也明确写了这一点。

需要这些证据时，增加 `@playwright/test` 与 `reactive-md/testing/browser`，按组件包模板的 `scripts/verify.mjs` 编写 `reactive-md-browser-spec/v1` 场景，加载 `dist/interactive.html` 的 `file:` URL，并在 `newContext({ offline: true })` 中运行。补齐后再把报告的能力列表改成四项，`complete` 才有意义。

其他检查：

```sh
npm run typecheck
```

`tsconfig.json` 只包含 `src`，`types: ["vite/client"]` 提供 `?raw` 导入的类型。脚本是 `.mjs`，不参与 TypeScript 检查。

## 9. 发布与消费

模板保持 `private: true`，也不提供编译后的出口，适合作为本地扩展或继续开发。要作为包发布，需要补齐组件包模板已有的三项：

1. 构建产物：把 TSX 编译为 ESM，并生成 `.d.ts`。组件包模板的 `scripts/build.mjs` 用 Vite SSR 构建 `dist/node/entry.mjs`，再用 `tsc` 输出 `dist/types`。
2. `exports` 映射：`.` 指向纯 manifest 入口，`./react` 指向实现入口，`./styles.css` 指向组件 CSS（如果有）。消费者只通过这些子路径导入。
3. 许可证与 notices：补 `LICENSE`、`NOTICES.md`，并把本包条目加入导出脚本的 `notices`。

大致流程：

```sh
npm run typecheck
npm test
npm pack --ignore-scripts
```

把 tarball 安装到一个全新项目，验证 `.`、`./react`（以及可选的 `./theme`、`./styles.css`）能导入，SSR 和离线导出都能运行。`package.json` 写明 `peerDependencies` 或依赖范围；组件契约或 SDK 范围变化时提升插件自己的版本并给出迁移说明。模板的 `reactive-md` 依赖范围是 `^0.8.0`，面向更新的引擎时应提升该范围；SDK 契约版本以实际发布包为准。

Demo 仓库消费候选包时使用内容摘要命名的 vendor tarball 加 lockfile 完整性，不使用 `file:..` 或源码别名。候选包更新流程见 Demo 仓库的[更新候选安装包](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/candidate-package-updates-ch.md)；vendor 清单见 [Demo vendor README](https://github.com/yao1145/ReactiveMD-Demo/blob/main/vendor/README-ch.md)。

## 10. 故障排查与限制

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Cannot find package 'reactive-md'` | 模板未安装依赖，或在引擎仓库内直接运行 | 复制到仓库外并 `npm install`，或安装引擎 tarball |
| `npm test` 找不到 `dist/node/entry.mjs` | 跳过了构建 | 运行 `npm test` 或先执行 `npm run build` |
| 端口 5173 被占用 | 另一个 Vite 服务在运行 | `npm run preview -- --port 5174` |
| `tsc` 报 `?raw` 模块无类型 | 缺少 Vite 客户端类型 | 保留 `types: ["vite/client"]` |
| 导出报 `local.extension.export-capability` | 某个已安装组件没有声明 `static`、`interactive` 或 `offline` | 补齐能力声明并重建 bundle；默认预设组件同样受检 |
| 导出的 HTML 打开后不能交互 | bundle 与当前配置不匹配，或浏览器阻止了内联脚本 | 重新执行 `npm run export`；用浏览器控制台确认错误 |
| Demo 没有发现新组件 | 入口文件名不在识别列表，或没有默认导出包 | 使用 `index.ts`/`index.tsx` 并 `export default` 组件包 |

模板的限制：

- 只有一个叶子组件和一个绑定槽位。容器、命名槽位、集合、结构规则和作者工具目录见[完整开发契约](component-development-reference-ch.md)。
- 没有主题、CSS 资源和浏览器套件；第 7、8 节说明如何加入。
- 没有编译后类型声明与包出口；发布前按第 9 节补齐，或直接使用组件包模板。
- 预览与导出使用同一份 manifest，但演示数据只有一个文档。多文档宿主应复用 `config`/`reactConfig`，不要为每篇文档重新创建配置。
