# 组件插件完整开发契约

[English](component-development-reference-en.md) · [五分钟入门](component-development-ch.md)

这里的插件是宿主通过 npm 安装、显式导入并组合的组件包或主题包。组件声明、React 实现、编辑器信息与资源共同形成开发契约；宿主用 `createLocalConfig` 和 `createReactConfig` 装配它们。

扩展 SDK 随 `reactive-md@0.7.0` 发布。以下流程安装公开包；只有测试尚未发布的 SDK 改动时才需要从当前源码打包 tarball。完整类型与限制见 [SDK 指南](../integration/extension-sdk-ch.md)。历史实现与验收记录已归档，不再随文档维护。


## 便捷定义与宿主组合

简单组件从 `reactive-md/react` 使用 `defineReactComponentPackage`，声明和实现可以放在一个文件：

```tsx
const componentPackage = defineReactComponentPackage({
  id: 'acme/score', name: 'acme-score', version: '1.0.0',
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  props: { label: { kind: 'string', default: 'Score' } },
  css: '.local-document .acme-score { color: var(--ink); }',
  render: ctx => <span className="acme-score">{String(ctx.props.label)}</span>,
});
const host = createReactHost({ packages: [componentPackage] });
```

工厂默认 `protocol: reactive-md-component/v1`、`form: leaf` 和空属性声明。有 CSS 时默认资源 ID 为 `id + '.css'`；没有 CSS 时不会生成虚假的样式依赖。多资源或共享资源可显式传 `resources`、`styles`。能力仍须声明，并通过合规工具提供证据。

返回的 `componentPackage.definition` 是可序列化 manifest，`components` 是实现数组，`resources` 是经校验的 CSS。宿主通过 `createReactHost({ packages, components?, themes?, resources?, notices? })` 一次组合，得到同源的 `config`、`reactConfig`、`compileOptions`、`resources`、`css` 和 `notices`。组件名称、版本依赖和资源冲突继续走既有校验；默认预设保持启用。

正式包保留纯声明入口。分文件开发时，可将已有 manifest 展开到便捷工厂中；该 manifest 的样式身份应与组件资源一致。脚手架用一个 ID 常量推导纯 manifest 的样式声明，防止纯入口与 React 入口出现不同摘要。单文件开发也可在构建时将规范化后的 `definition` 输出为纯数据入口。React/DOM 实现留在实现入口，Worker 只接收序列化配置。

`renderStatic` 已经可选，缺省复用 `render`。用 `ctx.mode === 'static'` 或 `ctx.bindings.isReadOnly` 切换表现；静态模式拒绝共享绑定写入，但组件自己的 React state、计时器和事件处理仍需自行约束。计时器 effect 在静态模式返回并保留卸载清理。只有不同静态版式才需要额外函数。

## Vite 宿主适配与配置诊断

Vite 项目使用公开 Node 入口：

```ts
import { reactiveMd } from 'reactive-md/vite';
export default { plugins: [reactiveMd({ extensions: './extensions.ts' })] };
```

注册模块导出 `host = createReactHost(...)`。应用从 `virtual:reactive-md/host` 获取 `host`，不再维护专属别名、组件样式注入或依赖排除表。虚拟入口也导出配置与资源字段，以及 `extensions` 命名空间，供宿主读取样例等自定义元数据；这些元数据不会进入 Worker。类型入口为 `reactive-md/vite/client`。

插件合并已有 Vite 设置，排除 ReactiveMD JS 子入口的预构建并对 React 去重。组件默认样式先于主题样式注入；配置变化触发重载并清理旧样式。应用仍显式向预览提供 `host.reactConfig`，向编译器、作者工具及 Worker 提供 `host.compileOptions`，以支持多个独立宿主实例。核心基础样式由应用导入 `reactive-md/styles.css`，脚手架已包含这一步。

生产构建输出 `reactive-md-standalone.js` 和 `reactive-md-export.json`。浏览器导出器也可惰性导入 `virtual:reactive-md/bundle` 获取完整 bundle。插件复用公开构建适配器的能力、资源、预算与离线检查；只支持预览的组件保留预览，缺失能力通过错误清单和导出诊断提供。离线包包含全部登记组件，扩展模块必须能被 Node 构建入口加载。样式声明是资源身份，CSS 内容仍由包或明确资源描述提供，组件代码由宿主安装。

新编译文档携带 `componentConfigKey`，经过 Worker 和增量补丁保留。渲染、严格 SSR 和导出对照实际宿主配置，不一致时报告 `local.extension.config-mismatch`，避免漏传配置后只看到源码回退。已有扩展的版本与实现检查继续保留；旧文档缺少该字段时使用既有契约检查。

## 1. 在仓库外开始

准备 Node 22.12 或更高版本。React 适配器使用 React 19；模板的构建与浏览器测试依赖以它的 `package.json` 为准。

把 [examples/component-package](../../examples/component-package/README-ch.md) 复制到仓库之外的新目录，与 ReactiveMD 仓库并列，命名为 `my-reactivemd-plugin`。模板依赖已发布的 `reactive-md@0.7.0`。在新目录执行：

```sh
npm install
npm run typecheck
npm test
```

测试尚未发布的 SDK 改动时，改为从当前源码打包并安装 tarball。

`npm test` 构建 JS、类型、静态与交互 HTML，再执行 Node、SSR 和离线浏览器检查。浏览器测试需要已安装的 Playwright 浏览器；Windows 可按实际安装设置 `PLAYWRIGHT_CHANNEL=msedge`。先让原模板通过，再修改功能和对应测试。

## 2. 组织插件包

| 文件或出口 | 内容 |
| --- | --- |
| `src/manifests.ts`，包出口 `.` | 数据 manifest；可由核心、Worker、作者工具读取 |
| `src/components.tsx`，包出口 `./react` | React 与静态实现，绑定到同一 manifest |
| `src/theme.ts`，包出口 `./theme` | 独立主题定义与资源身份 |
| `src/component.css`，包出口 `./styles.css` | 组件默认结构样式，CSS 引用的资源一起随包提供 |
| `scripts/build.mjs` | 生成 Node/浏览器产物与 `.d.ts`，完成示例导出 |
| `scripts/verify.mjs` | 执行 manifest、绑定、SSR、评分与容器各自的浏览器场景 |
| `LICENSE`、`NOTICES.md` | 本包及离线分发所需的许可与署名信息 |

manifest 保持可序列化，React 函数留在实现入口。发布出口指向构建后的 JavaScript 和声明文件，普通消费者通过公开包入口导入。

## 3. 定义组件契约

接下来的 `manifests.ts`、`components.tsx` 和 `host.tsx` 组成独立最小演示，`component.css` 见第 6 节。完整模板还有 note、主题与测试出口；在模板中修改组件时同步这些引用与验证场景。

以下评分契约保存为 `src/manifests.ts`：

```ts
import { defineLocalComponent } from 'reactive-md/sdk';

export const rating = defineLocalComponent({
  id: 'example/rating', name: 'rating', version: '1.0.0',
  protocol: 'reactive-md-component/v1', form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
  },
  bindings: {
    value: {
      kind: 'number', family: 'number', bind: 'bind', initial: 'initial',
      initialRule: 'nearest-zero',
      constraints: { min: { literal: 0 }, max: { prop: 'max' }, step: { literal: 1 } },
    },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { zh: '评分', en: 'Rating' }, category: 'input',
    description: { zh: '与数字控件共享评分。', en: 'Share a rating with numeric controls.' },
    insertText: '<rating bind="score" label="Score" max="5" initial="3">',
  },
  styles: ['example/component.css'],
});
```

`id` 标识契约，`name` 是文档标签名，`version` 表示组件版本。注册时校验重复名称/id、协议、依赖、默认值与预算，默认拒绝覆盖内置名称。配置创建后冻结，变更组件集合时创建新配置。

声明为 number 的属性在校验后始终是数值；`max="5"` 与 `max="{{ 5 }}"` 的结果一致。实现读取归一化 props，绑定句柄负责把写入提交给内核。

形态支持 `leaf`、`inline`、`container`。容器在 manifest 中声明内容规则，由 `ctx.children.render()` 渲染 Markdown；有选项、表格或结构子项时使用对应公开内容投影。模板的 `note` 演示了容器实现。新增核心规则另见第 10 节。

## 4. 实现 React 和静态输出

`src/components.tsx` 可以提供以下独立实现：

```tsx
import { defineReactComponent, type LocalComponentContext } from 'reactive-md/react';
import { rating } from './manifests';

export function RatingControl(ctx: LocalComponentContext) {
  const value = ctx.bindings.value.get() as number;
  const maximum = ctx.props.max as number;
  return <button className="rmd-example-rating"
    disabled={ctx.disabled || !ctx.visible || value >= maximum}
    aria-label={String(ctx.props.label)}
    onClick={() => ctx.bindings.value.set(value + 1)}>{value}</button>;
}

export function RatingStatic(ctx: LocalComponentContext) {
  return <span>{String(ctx.props.label)}: {String(ctx.bindings.value.get())}</span>;
}

export const ratingImplementation = defineReactComponent(rating, {
  render: RatingControl, renderStatic: RatingStatic,
});
```

此处数值断言对应 manifest 中的 number 契约。静态实现显示当前值，交互实现通过内核绑定写入；非法更新保留原状态。多个数字槽位使用 `ctx.bindings.setMany` 原子提交，集合与槽位的支持范围见 SDK 指南。

局部 UI 状态可以使用 React state。计时器、订阅和事件监听在 effect 清理函数中释放；隐藏时按功能暂停工作，重置时响应 `resetToken`。静态模式下 setter 被拒绝，运行时服务忽略 reset。读者需要可访问名称、键盘操作、焦点和禁用反馈。

## 5. 在宿主注册并接入编辑器

宿主把同一配置交给编译、渲染、作者工具和导出。独立示例可在 `src/host.tsx` 装配：

```tsx
import { useState } from 'react';
import { createLocalConfig } from 'reactive-md/sdk';
import { createReactConfig, LocalReactiveDocument } from 'reactive-md/react';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import { rating } from './manifests';
import { ratingImplementation } from './components';
import 'reactive-md/styles.css';
import 'reactive-md/editor/styles.css';
import './component.css';

export const config = createLocalConfig({ components: [rating] });
export const reactConfig = createReactConfig(config, { components: [ratingImplementation] });

export function Playground() {
  const [source, setSource] = useState(
    '<number bind="score" label="Score" min="0" max="5" step="1" initial="3">\n'
    + '<rating bind="score" label="Rating" max="5">',
  );
  return <ReactiveMarkdownEditor value={source} onChange={setSource}
    compileOptions={{ config }} toolbar authoring
    preview={<LocalReactiveDocument source={source} reactConfig={reactConfig} />} />;
}
```

默认预设保持启用。此例的两个控件共享同一个数值绑定，仅一个控件写显式初值，约束保持一致。

编辑器从 `authoring` 读取标题、说明、分类和插入模板；属性的 `description` 提供属性帮助。外部模板在同一配置下校验，插入支持绑定名分配、选区、光标与撤销/重做。自建编辑器可使用 `createLocalComponentCatalog`、`insertLocalComponent` 和 `validateLocalComponentInsertTemplates`。

### 接入本仓库 Demo

在 [demo/extensions.ts](https://github.com/yao1145/ReactiveMD/blob/main/demo/extensions.ts) 的现有数组中登记插件。每项可提供 `components`（React 实现数组）、`resources`（`{ id, css }` 数组）、`themes`、`notices` 和 `examples`。清单从实现读取 manifest，一次生成共享的编译与 React 配置，自动接入预览、编辑器目录、样式、样例导航与离线导出。仓库提供两个完整的安装包案例：`examples/tetris-package` 登记 `<tetris>`，`examples/game-2048-package` 登记 `<game-2048>`。两者都打包为 `demo/vendor/` 中的 npm tarball，作为 Demo 依赖安装，并通过公开的 `./react` 与 `./notices` 入口导入。2048 案例同时记录了标签规则：组件名必须以字母开头，因此熟悉的 `<2048>` 不是合法标签。修改任一包的源码后，运行 `npm run update:demo-tetris` 或 `npm run update:demo-2048`，构建并安装新的快照，更新依赖锁文件。

`resources.id` 与 manifest 的 `styles` 对应。Demo 接受内联 CSS 和 data URL；包可导出 CSS 文本，或由 Vite 通过 `?inline` 读取 CSS 文件。样例源码可以直接由包导出，登记中英文元数据后自动进入目录。Vite 去重和编译选项由宿主统一设置，新增包沿用这些设置。

从仓库根目录运行 `npm run build:demo`，再运行 `node demo/scripts/verify-extensions.mjs`；加 `--dev` 复验开发模式。脚本覆盖真实 Worker、目录、控制操作与断网导出。此装配层属于 Demo，插件的公共契约仍是 manifest、React 实现、主题与资源；独立宿主按本节前面的示例装配。完整字段和限制见 [Demo 说明](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md)。

## 6. 样式与独立主题

组件默认 CSS 负责结构和基础可读性，选择器限制在文档根节点内，使用包前缀：

```css
.local-document .rmd-example-rating {
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--accent);
  min-height: 44px;
}
```

组件专属变量使用 `--rmd-<包或组件前缀>-<用途>`。主题读取并覆盖共享语义变量，可在不知道所有组件的情况下改变基础视觉。主题包使用 `defineLocalTheme`，有序组合使用 `composeLocalTheme`，再放入配置的 `themes`；文档以 `<theme name="paper">` 选择主题。

模板的 `paper` 展示深浅模式与作用域；完整规则见[主题协议](../reference/theme-protocol-ch.md)。主题契约使用有作用域的内联 CSS/data 资源，全局字体命名和关键帧不属于当前主题定义。组件 CSS 中的本地文件引用由构建适配器收集，主题包交付前需将资源归一化为其接受的形式。

## 7. 构建、SSR 与离线分享

浏览器预览从宿主显式导入实现；离线分享使用宿主预构建的匹配 bundle。以模板的 `scripts/build-export.mjs` 为起点，Node 可加载的宿主 ESM 导出：

| 字段 | 要求 |
| --- | --- |
| `config`、`reactConfig` | 同一组声明与匹配实现 |
| `root`、`allowlist` | 资源根目录与其内部允许读取的目录；宿主入口也在 root 内 |
| `resources` | 与 manifest 的 styles 身份一致的 CSS，提供 inline CSS 或 root 相对文件路径 |
| `notices` | 本包、ReactiveMD 与实际分发依赖的许可/署名文本 |

先调用 `preflightLocalStandaloneBuild` 查看诊断，再由 `buildLocalStandaloneBundle` 生成单个 IIFE、内联资源、notices 和清单。Vite 8 是实际构建所需的可选 peer。远程资源、目录逃逸、循环引用、资源冲突、预算超限或不支持的离线实现会拒绝构建。

严格 SSR 使用 `renderLocalStaticDocument({ document, runtime, reactConfig, resources })`，结果先判断 `ok` 再取 `markup`。组件声明 styles 后，向 SSR、合规工具和导出器传同一份规范资源列表；构建结果的 `bundle.resources` 可直接使用。

`createLocalShareableHtml` 接收编译文档、状态、严格 SSR markup、CSS 和 bundle。导出时检查能力、组件与主题契约、bundle seal 和资源；恢复在应用状态和挂载前检查版本与摘要。新主机提供已安装实现，文档声明不会下载代码。源码或契约改变后重新编译、校验状态并重建 bundle。

## 8. 为每项能力提供证据

| 工具 | 执行内容 |
| --- | --- |
| `runLocalManifestCompliance` | manifest 往返、默认值、非法值、字段与预算 |
| `runLocalBehaviorCompliance` | 真实编译/运行时写入、拒绝回滚、revision、数组副本与 reset |
| `runLocalReactCompliance` | 静态输出、确定性 SSR、已配置的服务器错误探针 |
| `runLocalBrowserCompliance` | 挂载、编辑、隐藏/显示、禁用、重置、子树错误隔离和卸载；离线另要求 hydration、断网与零请求 |
| `createLocalComplianceReport` | 同组件、版本与配置的结果汇总，缺失证据保持显式缺失 |

`ok` 表示本次要求的检查通过；`complete` 表示所有声明能力都有实际证据。`npm run test:node` 会跳过浏览器并写 `complete:false`。评分与容器分别编写浏览器场景；容器应验证自己的内容、可见性和子项生命周期。

把模板中的示例测试替换成插件真实交互，保留失败、跳过与不支持的区别。对共享语义可用 `compareLocalComplianceParity` 比较内置组件和外部别名。浏览器证据记录实际引擎、宽度、键盘、焦点和无障碍观察。

## 9. 打包与第二消费项目

先运行 `npm run typecheck` 和 `npm test`，再执行 `npm pack --ignore-scripts`。把生成的插件 tarball 与 ReactiveMD SDK tarball 安装到另一个全新项目，通过插件的 `.`、`./react`、`./theme` 和 `./styles.css` 验证公开导入、NodeNext 类型、SSR、预览与离线 HTML。

发布前更新包名、版本、LICENSE、NOTICES 和 exports，检查文件清单、CSS 引用资源及 JS/类型是否齐全。本地 `file:` SDK 依赖要换成实际包含这些 SDK 入口的已发布版本；随后移除模板的 `private`。发布插件前固定其支持的 ReactiveMD 范围，契约变化使用插件自己的版本并给出迁移说明。

旧 `hostComponents`、`hostRenderer` 与 `hostData` 按 [SDK 迁移说明](../integration/extension-sdk-ch.md)转换，重新编译并重建 bundle。

## 10. 向默认预设或内核贡献

插件现有的公开规则足够时，只需要声明、实现和宿主装配。向默认预设贡献时，定义放入 `src/presets/default-components.ts`，实现放入 `src/components/`，作者信息放入默认作者数据；由预设走相同公开协议。

新增表达式、状态 family、结构或预算原语时，再修改相应内核并建立公开契约。按[组件协议](component-protocol-ch.md)、[兼容规则](../compatibility/compatibility-ch.md)和[提案模板](component-protocol-ch.md#13-新组块提案模板)评审，分别判断组件版本、SDK 协议、语法修订与包版本。

仓库文档修改运行 `npm run test:docs`；公开入口/类型修改构建后运行 `test:package` 和 `test:packed`；运行时行为修改运行相关测试，跨系统或发布使用 `verify:release`。历史架构与验收证据已归档，不再随文档维护。
