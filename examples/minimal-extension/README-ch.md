# Reactive MD 最小扩展模板

**中文** · [English](README.md)

一个可以直接复制运行的扩展：一个评分卡片组件、一个 Vite 预览页、Node/SSR 检查和单文件离线导出。全部导入来自公开的 `reactive-md` 入口，不依赖 Demo 仓库。

完整的编写流程见[扩展作者教程](../../docs/development/extension-tutorial-ch.md)。需要主题、编译后类型声明和浏览器合规套件时，改用[组件包模板](../component-package/README-ch.md)。

## 必需与可选

| 步骤 | 是否必需 | 说明 |
| --- | --- | --- |
| manifest、React 实现、`config`/`reactConfig` | 必需 | `src/extension.tsx` |
| Vite 预览 | 必需 | `index.html` 与 `src/preview.tsx` |
| Node/SSR 检查 | 必需 | `npm test` |
| 离线导出 | 必需 | `npm run export` |
| 组件 CSS 资源 | 可选 | 在 manifest 声明 `styles`，并提供同一 id 的 CSS |
| 独立主题包 | 可选 | `defineLocalTheme`，见组件包模板的 `src/theme.ts` |
| 浏览器 Playwright 套件 | 可选 | 见组件包模板的 `scripts/verify.mjs` |
| 发布到 npm | 可选 | 见教程第 9 节 |

基础流程不包含主题、CSS 资源和浏览器套件。模板里的组件只有语义标记，没有样式表。

## 环境与启动

需要 Node 22.12 或更高版本。把本目录复制到仓库之外：

```sh
cp -r examples/minimal-extension ../my-rating-card
cd ../my-rating-card
npm install
npm run preview
```

模板声明 `reactive-md@^0.8.0`，请把范围调整为要验证的发布版本。测试尚未发布的候选版本时，把 `npm install` 换成当前源码打包的引擎 tarball：

```sh
npm install ../reactive-md-<version>.tgz
```

该命令同时安装 `react`、`react-dom` 和开发依赖；常规安装直接运行 `npm install`。打开 Vite 打印的地址（默认 `http://localhost:5173`），页面显示示例文档和评分卡。

## 文件

| 路径 | 用途 |
| --- | --- |
| `src/extension.tsx` | `defineLocalComponent` manifest、`defineReactComponent` 实现、`config` 与 `reactConfig`。 |
| `src/preview.tsx` | 用 `LocalReactiveDocument` 挂载示例文档。 |
| `src/source.ts` | 以 `?raw` 导入示例文档。 |
| `index.html` | Vite 预览页，挂载 `src/preview.tsx`。 |
| `sample/document.reactive.md` | 示例文档；评分卡与内置 `<number>` 共享 `score`。 |
| `scripts/build.mjs` | 用 Vite 把 `src/extension.tsx` 编译为 `dist/node/entry.mjs`。 |
| `scripts/test-node.mjs` | 运行 manifest、绑定、静态与 SSR 合规检查。 |
| `scripts/export.mjs` | 构建 standalone bundle，写出 `dist/interactive.html`。 |

## 命令

```sh
npm run build      # dist/node/entry.mjs
npm test           # build + manifest、绑定、静态与 SSR 检查
npm run export     # build + dist/interactive.html、dist/build-manifest.json
npm run preview    # Vite 开发服务器
npm run typecheck  # tsc --noEmit
```

`npm test` 先把 `dist/compliance.json` 的 `complete` 写成 `false`，并在输出里说明浏览器离线证据没有执行。它证明 manifest 校验、共享绑定的接受与拒绝、重置、静态渲染和两次一致的 SSR。它不证明浏览器挂载、hydration、断网零请求，也不证明导出文件能被浏览器恢复。

`npm run export` 证明 bundle 预检、配置摘要和 seal 匹配、严格 SSR 输出、状态导出和 notices 组装成功。导出的 HTML 是单个文件，脚本、样式和资源都已内联。

## 可选扩展

- CSS 资源：在 manifest 加 `styles: ['example/rating-card.css']`，在导出脚本的 `resources` 和 `allowlist` 中提供该文件。
- 主题：用 `defineLocalTheme` 定义主题，放入 `createLocalConfig({ themes: [theme] })`，文档用 `<theme name="...">` 选择。
- 浏览器套件：增加 `reactive-md/testing/browser` 与 Playwright 依赖，加载 `dist/interactive.html`，在断网上下文中覆盖挂载、编辑、隐藏、禁用、重置、错误隔离与卸载。组件包模板给出了可复制的完整写法。

## 限制

模板只包含一个叶子组件和一个绑定槽位。容器、命名槽位、集合和作者工具目录的写法见[完整开发契约](../../docs/development/component-development-reference-ch.md)。模板保持 `private: true`，不提供编译后的包出口；发布步骤见教程第 9 节。
