# Reactive MD Playground

> **Reactive MD** is a Markdown dialect for local, interactive documents. Authors add HTML-style input controls, name parameters with `bind`, and connect prose, formulas, charts and diagrams with `{{ expressions }}` — no JavaScript or CSS required. Change any input and every bound value, formula, chart and diagram updates instantly, turning a static article into something readers can explore first-hand. Everything compiles and runs in the browser, so a document is one portable source file, and the TypeScript core and React renderer can be embedded in any app.

> **Reactive MD** 是一门用于编写本地交互文档的 Markdown 扩展语言。作者只需放入 HTML 风格的输入控件、用 `bind` 命名参数，再用 `{{ 表达式 }}` 把文字、公式、图表和图解连接起来，无需编写 JavaScript 或 CSS。读者改动任意输入，所有绑定的数值、公式、图表和图解都会立即更新，静态文章由此变成可以亲手探索的交互页面。编译与运行都在浏览器本地完成，一份文档就是一个可随处分享的源文件；TypeScript 核心与 React 渲染器也可独立嵌入任意应用。

The Playground opens with a short calculator and six [feature tours](../examples/local/showcase/README.md): functions, forms, data and charts, layout, diagrams, and checklists and timing. Each tour follows one example from a suggested change to the visible result, with key source snippets at the end. English and Chinese versions are available throughout.

Presentation mode shows the document at full width. Choose "Show source" to edit Markdown beside its live preview, or "Presentation mode" to return without resetting the current controls. The six scenarios demonstrate controls, declarations, validation and collections together. The auxiliary menu opens an intentionally broken diagnostics example in the editor. If you are new to the syntax, start with the [getting-started guide](../docs/guides/local-guide-en.md).

Choose **Try examples** to explore the built-in tours, or **My documents** to create and reopen your own work. Name a document, edit it, and the Playground saves it automatically in this browser. Duplicate a document or an example to make an independent copy. Import creates a new personal document; export downloads its Markdown source or an HTML document. Personal documents keep their source when you switch the interface language.

**体验示例**保留内置示例，**我的文档**用于新建、命名和重新打开自己的文档。编辑后自动保存在当前浏览器中；复制文档或示例会创建独立副本，导入文件会新建个人文档。导出可下载 Markdown 源码或 HTML 文档。切换界面语言时，个人文档的内容保持原样。

The save indicator reports pending writes and storage failures. Browser storage belongs to this browser profile and site; export files to keep a portable backup. Theme, import and HTML compatibility settings are available through compact, expandable controls.

Compile errors are listed by source position. The editor toolbar has common Markdown formatting and a searchable menu for inserting native components.

The "User Guide" view at the top of the page renders `docs/guides/local-guide-en.md` directly, covering everything from your first interactive document to charts, function curves and a quick error reference. Documentation links in the guide point to the repository, and table-of-contents anchors jump within the page.

The export dialog downloads Markdown, interactive HTML or static HTML. It defaults to the author initial values and can use the current preview parameters as the exported reset baseline; the dialog shows how many public parameters changed. Choose images in the Document images panel, or paste them into the source editor. The demo validates PNG, JPEG, GIF and WebP contents and decodeability, with limits of 8 MiB per image, 24 MiB total and 64 resources. It saves the manifest with each language-specific draft in IndexedDB and embeds referenced images in both HTML modes. Missing references can be filled in the export dialog; incomplete image sets block HTML export. "Save current state" downloads a `reactive-md-state/v1` file for a later CLI build. See [Shareable documents and static export](../docs/integration/shareable-export-en.md).

The masthead has a language toggle: `中` switches the whole demo to Chinese and `EN` switches back. English is the default. The choice is saved in the browser, each language keeps its own example drafts and guide (`docs/guides/local-guide-ch.md` for Chinese), and the Playground preview is rendered with the matching locale.

While you edit, consecutive keystrokes are coalesced and compiled on a background thread; the previous preview stays visible while waiting. The preview updates once the current source compiles successfully and shows diagnostics when it fails. For implementation details and how to re-measure, see [performance measurement](../docs/development/performance-overview-en.md).

"Keep trial state" is on by default. When you edit prose, control labels or formulas, parameter values with the same name and type that still satisfy the new constraints are kept; they are also restored after a temporary compile error is fixed. Changing `initial` or an effective default uses the new initial value. With the option off, the next compile starts from initial values.

Trial values live only in the current editing session. Running again, restoring an example, switching examples, importing a document or refreshing the page resets them. Anonymous controls, positional checklists and timers reset after every recompile; compatible named slots can be retained. The `LocalReactiveDocument` library component creates a fresh document instance whenever the source changes.

Live demo: [yaozi.raricy.com](https://yaozi.raricy.com/).

## Getting started

From the repository root:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The embed example is at `/embed.html` and shows two independent in-memory document instances. If the library is already built, you can run `npm run dev` inside `demo/`.

## External packages / 外部组件包

Register packages in [extensions.ts](extensions.ts). The Demo derives its compiler and React configuration, editor catalog, styles, example navigation and offline bundle from this file. Two installed plugins are registered as working cases:

| Package | Tag | Source | Update command |
| --- | --- | --- | --- |
| `reactive-md-tetris-package` | `<tetris>` | `examples/tetris-package` | `npm run update:demo-tetris` |
| `reactive-md-game-2048-package` | `<game-2048>` | `examples/game-2048-package` | `npm run update:demo-2048` |

Both packages arrive as npm tarballs committed under `demo/vendor/`; versions and integrity values are recorded in the dependency lockfile. Implementations, CSS text and samples are imported from each package's `./react` entry, and notices from `./notices`. A fresh checkout installs both snapshots with `npm install`. The 2048 tag is `<game-2048>` because component names must start with a letter, so `<2048>` is not a valid tag.

两个插件均已登记，作为真实安装包案例：

```ts
import { createReactHost } from 'reactive-md/react';
import { tetrisPackage } from 'reactive-md-tetris-package/react';
import { game2048Package } from 'reactive-md-game-2048-package/react';
import tetrisNotices from 'reactive-md-tetris-package/notices?raw';
import game2048Notices from 'reactive-md-game-2048-package/notices?raw';

export const host = createReactHost({
  packages: [tetrisPackage, game2048Package],
  notices: [
    { id: 'reactive-md-tetris-package', license: 'MIT', text: tetrisNotices },
    { id: 'reactive-md-game-2048-package', license: 'MIT', text: game2048Notices },
  ],
});
```

新增包只需修改 `demo/extensions.ts`，把安装包导出的组件包加入 `packages`；`themes`、`resources` 和 `notices` 仅在包提供时传入。样例通过同一文件的 `examples` 导出登记，使用 `PlaygroundExample` 的中英文元数据与包内源码。

修改任一插件源码后，从仓库根目录执行对应更新命令，重新构建、打包并安装，再提交替换后的 tarball、依赖声明和锁文件；后续预览及导出使用更新后的安装包。

组件包已包含规范 manifest、React 实现与 CSS 资源。宿主生成同源的编译与渲染配置，编辑器读取 manifest 的 `authoring`。Vite 配置只需 `reactiveMd({ extensions: './extensions.ts' })`；虚拟模块自动加载组件和主题样式，插件统一处理依赖预构建、React 去重及离线运行时，Demo 不再维护私有构建适配器或手工创建 style 元素。

可选 `themes`、`resources` 和 `notices` 交给 `createReactHost`。样例作为同一清单的额外 `examples` 导出，使用 `PlaygroundExample` 的中英文元数据与包内源码，自动进入目录。应用通过 `virtual:reactive-md/host` 的 `extensions` 命名空间读取这些元数据；它们不会发送给 Worker。资源 ID 冲突和样例 ID 冲突会明确报告。

CSS 中的字体与图片需内联为 data URL。生产构建自动输出 `reactive-md-standalone.js` 与 `reactive-md-export.json`，浏览器导出通过 `virtual:reactive-md/bundle` 取得对应运行时。只支持预览的组件继续提供预览，交互导出报告缺少的能力。编译配置漏传或错接时显示 `local.extension.config-mismatch`；自建 Worker 应使用 `host.compileOptions`。

从仓库根目录验证：

```sh
npm run build:demo
node demo/scripts/verify-extensions.mjs
node demo/scripts/verify-extensions.mjs --dev
```

脚本自行启动并关闭 `127.0.0.1:5187`，覆盖 Worker 编译、游戏控制、编辑器目录、手机布局，以及断网打开静态和交互 HTML。结果保存在 `artifacts/demo-extensions/`。插件包开发流程见[组件插件开发指南](../docs/development/component-development-ch.md)。

## Examples

Start with Quick start, then choose a feature in the navigation:

| Tour | What to try |
| --- | --- |
| Functions & formulas | Compare curves and savings growth, adjust a point and interval, then answer a distance question |
| Forms & bindings | Configure a workshop with text, choice, multi-select and checkbox inputs |
| Data & charts | Change expenses and link category selection across the table, bar chart, donut and scatter plot |
| Content & layout | Jump between sections, style prose colors and explore cards, tabs and disclosures |
| Diagrams & flow | Follow the calculation through diagram nodes, guided steps and a choice question |
| Checklists & timing | Prepare a workshop, track completion, count attendees and run a timer |

Feature sources live in `examples/local/showcase/`, with Chinese versions in its `zh/` directory. Quick start and diagnostics use the corresponding files in `examples/local/` and `examples/local/zh/`. The original standalone examples remain available through the [example catalog](../examples/local/README.md).

The Playground uses the library through `compileLocal`, `createLocalRuntime` and the `reactive-md/react` renderer entry. Controls declare parameters in the body, and table data is written in Markdown. Table search and sorting affect that table; charts continue to show the full data.

## Development and checks

From the repository root:

| Command | Purpose |
| --- | --- |
| `npm run verify:release` | Complete release gate, including the actual tarball, outside-repository consumers and browser checks; manages its own preview server |
| `npm run build` | Language package and type declarations, output to `dist-library/` |
| `npm run build:demo` | Build the language package and app, output to `demo/dist/` |
| `npm run dev:lib` | Watch and rebuild the language package |
| `npm test` | Language, runtime and renderer tests |
| `npm run test:demo` | Build the library and check the Playground examples |
| `npm run test:browser` | Browser interaction checks for the new syntax |
| `npm run test:showcase --workspace=@reactive-md/demo` | Feature-tour interactions and phone, tablet and desktop layouts in both languages |
| `npm run test:documents --workspace=@reactive-md/demo` | Personal document workflows, storage failures, exports and guide code blocks in the browser |
| `npm run test:browser:core` | Firefox and WebKit core workflows, run from the repository root after building the demo; manages its own server |
| `npm run test:grid-layout --workspace=@reactive-md/demo` | Nested grids and 1–4 columns across narrow panes and embedded containers |
| `npm run test:toolbar` | Editor toolbar and native component insertion checks |
| `npm run test:docs` | Local documentation links and navigation anchors |
| `npm run test:package` | Public package entries, examples and style boundaries; build first |

Changes to app sources hot-reload. After changing the language library, run `npm run build:lib` again, or run `npm run dev:lib` in a separate terminal.

Browser checks require local Edge and a running server. They target `http://127.0.0.1:5173` by default; set `DEMO_URL` to use another address. Reports and screenshots are written to `demo/artifacts/`.

## Integration

Host applications use the public API described in [local mode integration](../docs/integration/local-integration-en.md).

## Local review of 0.4.0

Run `npm run dev` from the repository root, then open [Functions & formulas](http://127.0.0.1:5173/?example=functions). This checkout uses local-draft-2 and has not been published. The six scenarios cover all components, including the new controls and linked table/chart selection, in English and Chinese. See the [syntax and migration reference](../docs/reference/local-components-v2-en.md).

Use `npm run test:v2 --workspace=@reactive-md/demo` against the running service for the new browser checks.
