# 扩展 SDK 预览

[English](extension-sdk-en.md)

本页描述源码中的第一阶段 SDK。包版本仍为 `0.6.1`；新增入口随下一次发布提供，现有 registry 中的 `0.6.1` 不因此获得这些功能。开发与验收使用本地构建的 tarball。

SDK 把组件声明、实例配置、React 实现和主题资源分开。声明和配置都是可序列化数据；组件代码由宿主显式安装和导入。编译器、Worker、作者工具和导出器消费同一配置。

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

默认预设保持启用。宿主也可从 `reactive-md/presets/default` 显式导入 `defaultPreset` 并传入 `presets: [defaultPreset]`。第一阶段支持向默认集合添加组件；内置组件的统一迁移在第二阶段完成。

配置创建时检查重复名称与 id、保留名称、协议、依赖和预算，并复制、冻结数据。`readLocalConfig` 对 Worker 或导出载荷中的配置重新校验，重新计算语义摘要。React 实现的 manifest 摘要必须与配置匹配。组件集合变化时创建新配置。

组件可声明 `requires: { kernel: '^0.6.1' }`，依赖项使用 `{ id, version }` 指定兼容范围。范围支持完整版本、`^`、`~` 和以空格连接的比较条件，例如 `>=0.6.1 <0.7.0`；不支持的写法会在注册时被拒绝。

## 属性与子内容

属性类型为 `string`、`number`、`boolean` 和 `enum`。声明可以提供默认值、必填规则、静态或动态求值模式，以及数值范围、整数限制、枚举和安全正则。

数值字面量 `max="5"` 和合法完整插值 `max="{{ 5 }}"` 都向实现提供数字 `5`。默认值仅用于属性缺省；非法显式值产生诊断。可选且无默认值的属性读为 `null`。字符串可包含混合文本插值；数字和布尔动态属性要求完整插值。

容器通过 `ctx.children.render()` 呈现已编译子内容。上下文提供归一化 props 和源码范围，组件无需访问内部 AST。父层隐藏状态由适配器传递。

属性的 `description` 接受 locale 映射。编辑器说明变化不改变编译语义摘要，也不会因此重置参数。

## 绑定与生命周期

`bindings.value` 声明一个标量绑定槽位，类型支持字符串、数字和布尔。声明的 `bind` 和 `initial` 属性名在本阶段固定为同名属性；组件实现通过 `ctx.bindings.value.get()` 和 `.set(next)` 读写。

写入经过内核共享约束检查，返回 `{ ok, diagnostics }`。非法写入保持状态和 revision。评分组件可以与内置 `<number>` 绑定同一公开参数；数字范围和步长须符合共享约束规则，同一参数只声明一次显式初值。

上下文还提供 `visible`、`disabled`、`resetToken`、`mode`、`instance` 和 `report`。局部展开、悬停或草稿状态由组件管理；需要响应面板重置时监听 `resetToken`。组件卸载时使用 React effect 的清理函数释放资源。

静态渲染使用只读绑定句柄。能力声明分别记录交互、静态、SSR 和离线支持；SSR 实现应可在没有 DOM 的环境执行。React 子树边界报告渲染异常，事件与异步代码按组件的错误处理接口报告失败。任意第三方代码仍是宿主主动安装的依赖。

`reactive-md/react/server` 的 `renderLocalStaticDocument` 先检查 SSR 能力，再执行静态渲染，返回 markup 或结构化诊断。严格导出遇到服务器执行失败时中止，保留错误信息。

离线 HTML 的 `staticMarkup` 使用该 server 入口的返回结果；它保留 React 文本节点边界，供 standalone 的 static-first hydration 恢复交互。组件声明了必需样式时，把同一份 `resources` 同时提供给 server 渲染和导出预检。

数值绑定边界可以引用数值属性；动态 min/max 进入内核约束元数据，并校验属性自身的范围和整数规则。作为 step 来源的属性在本阶段要求静态数值。字符串绑定支持 text，以及带显式 options 的 choice；未接入的特殊 family 在注册时被拒绝。

## 作者工具

```ts
import { compileLocal, completeLocalSource } from 'reactive-md';
import { createLocalComponentCatalog } from 'reactive-md/authoring';

const result = compileLocal(source, { config });
const candidates = completeLocalSource(source, offset, { config });
const catalog = createLocalComponentCatalog(config, 'zh');
```

标签、属性、说明、插入模板及成对标签闭合来自同一配置。宿主可以把目录接入自己的菜单；第一阶段提供目录数据，第三阶段统一仓库内编辑器与 Demo 的完整菜单消费。

`insertLocalComponent(config, componentId, source, selection, locale)` 处理绑定名分配、选区和光标模板，返回编辑结果。`validateLocalComponentInsertTemplates(config, locale)` 编译实际插入结果，报告与当前配置不匹配的模板。

## 主题包与组合

`defineLocalTheme` 接受身份、版本、现行主题协议、深浅模式和内联 CSS 资源。CSS 规则限制在对应 `[data-rmd-theme="主题名"]` 根节点中。`composeLocalTheme` 按顺序将覆盖层组合到基础主题，并为组合结果分配新主题名；`collectLocalThemeCss` 供宿主显式加载样式。

第一阶段资源为有界内联 CSS，支持内联 data 资源，拒绝网络引用和 `@import`。组件应读取公共语义变量，并提供基本结构样式。导出器收集所选主题资源和宿主显式声明的组件资源。

组件通过 `styles: ['example/rating.css']` 声明必需资源 id，宿主在导出时提供对应 `{ id, css }`。组件默认样式先于主题增强样式输出。主题包本阶段拒绝带全局名称的 `@font-face` 和 `@keyframes`；可使用系统字体、过渡和公共动效变量。

## 静态与离线导出

导出相关函数位于 `reactive-md/export`：

- `createLocalExportPlan` 检查组件需求、目标能力、主题和资源，返回结构化诊断。
- `defineLocalStandaloneBundle` 把宿主预先构建的脚本与其组件 manifest 集合关联。
- `createLocalShareableHtml` 进行预检，嵌入配置、需求清单、样式和可选的离线运行脚本。
- `validateLocalExtensionRequirements` 校验恢复宿主是否具备相同组件契约。

独立运行入口 `reactive-md/standalone` 提供 `mount` 和 `mountAll`。宿主专用的构建入口显式导入 `reactConfig`，再执行：

```ts
import { mountAll } from 'reactive-md/standalone';
import { reactConfig } from './extensions';

mountAll(document, { reactConfig });
```

将这个入口打包成 IIFE 后交给导出器。恢复时先检查组件身份、版本和 manifest 摘要，再应用已有 `reactive-md-state/v1` 参数文件。需求声明不会触发下载代码。

浏览器中的任意 renderer 函数无法自动转换为可分享 npm 模块。第一阶段使用宿主专用 bundle；通用构建插件和组件资源自动发现属于第三阶段。

## 完整样例与验证

[独立消费样例](../../examples/integration/extension-sdk/README.md)提供评分控件、提示容器和 paper 主题。它使用公开入口，评分与内置数字控件共享绑定，容器显示普通 Markdown 和表达式结果。

先构建库，再执行：

```powershell
npm.cmd run build:lib
npm.cmd run test:sdk-consumer
```

验证脚本在系统临时目录安装真实 tarball，检查类型、绑定、props、目录模板、SSR、导出预检，再用断网的新浏览器上下文检查桌面和手机宽度下的交互恢复、重置与主题。结果位于 `artifacts/sdk-consumer/verification.json`，导出 HTML 和截图保留在同目录。

旧 `hostComponents`、`hostRenderer` 和 `hostData` 继续保留。它们与新配置同时传入时产生配置冲突，旧 renderer 的属性解析行为保持不变。多绑定槽位、集合值、复杂结构子项与完整内置迁移按[后续规划](../development/extension-sdk-plan-ch.md)推进。
