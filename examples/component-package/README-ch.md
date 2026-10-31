# Reactive MD 组件包模板

[English](README.md)

这是一个可复制的 npm 组件包，定义评分控件与 Markdown 提示容器，附带主题包和内联 SVG 资源，并用公开合规工具验证安装后的包。所有导入都来自公开的 `reactive-md` 入口。

扩展 SDK 随 `reactive-md@0.7.0` 发布，可从公开 registry 安装。把本目录复制到仓库之外并运行 `npm install`。测试尚未发布的 SDK 改动时，改为安装由当前源码新打包出的 tarball。

## 公开入口

组件包只导入以下入口：

- `reactive-md/sdk`
- `reactive-md/presets/default`
- `reactive-md/react`
- `reactive-md/react/server`
- `reactive-md/standalone`
- `reactive-md/testing`
- `reactive-md/testing/react`
- `reactive-md/testing/browser`
- `reactive-md/build`（仅导出 bundle）

## 目录内容

| 路径 | 用途 |
| --- | --- |
| `src/manifests.ts` | `rating` 与 `note` 的有界 JSON manifest。 |
| `src/components.tsx` | React 实现、主题组合与配置。 |
| `src/theme.ts`、`src/theme.css` | 使用 `defineLocalTheme` 的主题包与作用域变量。 |
| `src/component.css` | 组件结构样式。 |
| `src/assets/notice.svg`、`NOTICES.md` | 本地资源与署名声明。 |
| `src/harness.tsx` | 用于直接挂载 React 的开发页面。 |
| `sample/document.reactive.md` | 使用组件包与主题的示例文档。 |
| `scripts/build.mjs` | 构建 Node/SSR 入口、类型声明、浏览器载体页与离线 HTML。 |
| `scripts/verify.mjs` | 运行 manifest、绑定、静态、SSR 与浏览器合规检查。 |
| `scripts/build-export.mjs` | 通过 `buildLocalStandaloneBundle` 生成离线导出。 |

## 命令

```sh
npm install
npm run build        # JS、类型、载体页与离线 HTML
npm test             # 完整合规：Node、SSR、浏览器生命周期与离线
npm run test:node    # 仅 manifest、运行时绑定、静态与 SSR
npm run typecheck
```

`npm run build` 生成：

- `dist/node/entry.mjs`、`dist/node/manifest.mjs`、`dist/node/theme.mjs`
- `dist/types/*.d.ts`
- `dist/harness.html` 与 `dist/harness/harness.js`
- `dist/interactive.html`、`dist/static.html`、`dist/standalone.js`
- `dist/build-manifest.json`、`dist/resources.json`、`dist/build.json`

`npm test` 先构建，再运行完整合规套件。浏览器检查覆盖评分控件和单独的 note 生命周期，以 `file:` 打开 `dist/interactive.html`，在断网上下文中运行，并断言 http(s)/ws 请求为零。该命令需要 Playwright 和浏览器；缺少任一项时命令以非零状态退出，不会把离线或浏览器生命周期报告为通过。

`npm run test:node` 跳过浏览器套件。它打印离线与浏览器证据未执行，并写出 `complete:false`。

## 生成的包入口

`package.json` 提供编译后的 JavaScript 和类型声明：

| 子路径 | JavaScript | 类型 |
| --- | --- | --- |
| `.` | `dist/node/manifest.mjs` | `dist/types/manifests.d.ts` |
| `./react` | `dist/node/entry.mjs` | `dist/types/node-entry.d.ts` |
| `./theme` | `dist/node/theme.mjs` | `dist/types/theme.d.ts` |
| `./styles.css` | `src/component.css` | 无 |

类型声明从 `src` 生成，并重写相对导入以保留显式扩展名。

## 各类检查证明什么

- Manifest 用例重新读取 JSON manifest，重新应用声明的默认值，并拒绝非法字段、默认值和取值。
- 绑定用例先编译示例源码，再执行真实的 `set` 与 `setMany` 调用。接受的写入改变参数并推进 revision；拒绝的写入保持参数与 revision 不变；重置恢复作者声明的初值并推进 reset token。
- 静态与 SSR 用例通过 `reactive-md/react/server` 渲染真实 React 实现。两次 SSR 输出必须一致。
- 浏览器用例证明挂载、编辑、隐藏/显示、禁用、重置、子组件错误隔离和卸载。离线能力还要求 hydration、断网上下文、无意外页面错误与无网络请求。
- 声明了某能力但缺少带标签的通过用例时，该能力保持 `skipped` 或 `unsupported`，汇总报告失败。

构建步骤给出规范的资源列表。同一个 `resources` 数组同时传给 `renderLocalStaticDocument` 和 `runLocalReactCompliance`，因此 SSR 与合规检查使用完全相同的 CSS。

报告写入 `dist/compliance.json`；载体页为 `dist/harness.html`。

## 离线导出

`scripts/build-export.mjs` 调用 `reactive-md/build` 的 `buildLocalStandaloneBundle`。它先写出显式的宿主模块 `dist/build-host.mjs`，该模块导出：

- `config` 与 `reactConfig`
- `root`
- `allowlist`
- `resources`
- `notices`

资源收集器读取 allowlist 内声明的文件。构建器将 JavaScript 依赖打成单个 IIFE 脚本，内联 CSS、字体和图片，返回包含 `script`、`extensions`、`seal`、`resources`、`assets`、`css`、`notices`、`manifest` 的扁平对象。脚本再把 bundle 和资源交给 `createLocalShareableHtml`，分别生成交互与静态 HTML。静态 HTML 同样经过严格 server 入口渲染；遇到不可用组件时直接失败。

浏览器用例加载 `dist/interactive.html`，在断网状态下检查生命周期行为。

## 发布这个包

模板保留 `"private": true`。重命名 `name`，选择许可证并更新 `LICENSE` 和 `NOTICES.md`；准备发布到 npm 时移除 `"private": true`。
