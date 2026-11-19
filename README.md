# Reactive MD

**English** · [中文](README-ch.md)

> Repository split: this checkout is the language engine. The [editor](https://github.com/yao1145/ReactiveMD-Editor) and [Demo](https://github.com/yao1145/ReactiveMD-Demo) build independently. Engine 0.8 uses the separate reactive-md-editor package. See the [migration guide](docs/releases/release-0.8.0-en.md#repository-split-and-import-migration).

[![npm](https://img.shields.io/npm/v/reactive-md.svg)](https://www.npmjs.com/package/reactive-md)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Interactive Markdown documents that run on the reader's device.**

Reactive MD turns ordinary Markdown into a small application: named inputs, live calculations, charts, tables, diagrams, quizzes and formula-driven plots. Authors write tags and expressions in the document; readers get a responsive document with no server, no account and no build step. When the document is finished, export one HTML file that still works offline.

- **Local-first by design.** Parameters and state stay in the browser. There is no backend runtime and no round trip for an interaction.
- **Markdown-native authoring.** Inputs are HTML-style tags, values are `bind` names, and results are `{{ expressions }}`. Authors do not write JavaScript or CSS.
- **A real expression language.** Arithmetic, comparisons, logic, conditionals, math and formatting functions, aggregates, date helpers and read-only host values.
- **Rich output without glue code.** Tables, five chart kinds, LaTeX-driven plots, diagrams, steps, tabs and quizzes share the same parameters.
- **Fast where it matters.** A Worker compiler, block reuse, row-level patches and hard input budgets keep long documents responsive.
- **Extensible.** Ship an npm component package with a manifest, a React renderer and CSS; it appears in the editor catalog and can be exported offline.
- **One file to share.** Build a self-contained interactive HTML file or a script-free static snapshot.

Themes and components can be loaded from `theme/` and `plugin/` with `reactiveMd()`. See [directory integration](docs/integration/directory-discovery-en.md).

## At a glance

| Area | What you get |
| --- | --- |
| Authoring | `.reactive.md` with HTML-style tags and `{{ expressions }}` |
| Runtime | Local-first state; no backend required |
| Views | 51 built-in tags, 5 chart kinds, tables, plots, diagrams, galleries, steps and quizzes |
| Integration | TypeScript core, React 19 renderer, CM6 source editor, CLI |
| Extensions | npm component packages, themes, authoring catalog, offline bundles |
| Sharing | Single-file interactive HTML, static HTML, versioned state files |

## Syntax in one example

```markdown
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ people * rate }}">

<panel title="Workshop estimate">
<slider bind="people" label="People" initial="4" min="1" max="12">
<toggle bind="annual" label="Annual billing">
</panel>

**{{ people }} people × {{ rate }} = {{ total }} USD.**

Annual price: **{{ formatCurrency(annual ? total * 0.8 : total, 'USD', 2, 'en-US') }}**.

<if when="{{ annual }}">
<alert tone="success" title="Annual billing">The 20% discount is applied.</alert>
</if>

<chart kind="bar" title="Cost and budget">
| Category | Cost | Budget |
| --- | ---: | ---: |
| Venue | 400 | 500 |
| Catering | {{ total }} | 900 |
</chart>
```

The slider and toggle create parameters. `const` and `computed` name derived values. Prose, conditions and the chart read the same state, and every view updates together.

| Idea | Syntax |
| --- | --- |
| Parameters | `<slider bind="people">`, `<number>`, `<input>`, `<select>`, `<date>`, `<toggle>` |
| Named values | `<const name="rate" value="{{ 80 }}">`, `<computed name="total" value="{{ people * rate }}">` |
| Expressions | `{{ people * rate }}`, `{{ annual ? total * 0.8 : total }}` |
| Formatting | `formatCurrency`, `formatPercent`, `formatNumber`, `formatScientific` |
| Data views | Markdown tables inside `<table>` and `<chart>`; `bar`, `line`, `area`, `scatter`, `donut` |
| Structure | `<panel>`, `<card>`, `<grid>`, `<tabs>`, `<accordion>`, `<disclosure>` |
| Flow and teaching | `<if>`, `<diagram>`, `<steps>`, `<quiz>` |
| Formulas | LaTeX inside prose and `<plot>`; curves follow shared parameters |
| Themes | `<theme name="paper">`, light/dark modes, scoped custom CSS |

Expressions are deliberately small and safe: no assignment, method calls, property access, custom functions or imports. The full function set is listed in the [syntax specification](docs/reference/local-interaction-syntax-en.md#51-expression-set).

## Performance

Reactive MD is built for long documents and continuous editing. The current measurements (2026-10-29) use Node 22.17 on an Intel Core Ultra 5 125H and headless Edge 135 at 1440×1000. The machine was not frequency-pinned, so these numbers are reproducible evidence, not a guarantee.

| Workload | Result |
| --- | --- |
| 1,000,000-character plain document | 12.26 ms first compile, 5.15 ms steady median |
| 600-section article | 282 ms full compile → 62 ms incremental session (1 block compiled, 1,799 reused) |
| 500-row dynamic table | input-to-preview 286 ms → 134 ms in the latest comparison |
| 1,000-item dynamic list, 500 consecutive edits | 0.463 MiB post-GC heap growth |
| 600-section article through Worker + React | 193 ms round-trip |
| 1,000 controls through Worker + React | 70 ms round-trip |
| Parameter write / three-curve plot resample | 0.0004 ms / 0.28 ms |

The compiler runs in a Worker, reuses unchanged blocks, publishes row-level patches and negotiates a flat result format for deep trees. Hard budgets stop pathological input before it can freeze the interface: 10,000 nodes by default, 1,000,000 characters and 100 component nesting levels.

See [Performance measurements](docs/development/performance-overview-en.md) for the full 45-scenario matrix, regressions, memory checks and reproduction commands, and `benchmarks/performance-overview-2026-10-29.json` for the condensed data.

## Try the demo

Live demo: [yaozi.raricy.com](https://yaozi.raricy.com/)

From the ReactiveMD-Demo repository root:

```sh
npm ci --legacy-peer-deps
npm run dev
```

This installs the locked engine/editor candidates and starts the standalone app at `http://127.0.0.1:5173`. `/embed.html` shows the embedding path. The language toggle in the masthead switches the whole Demo between English and Chinese and remembers the choice.

What to try:

- Work through the guided tours: pricing, functions, forms, data and charts, layout, diagrams, checklists and timing.
- Drag a slider or change a table cell and watch prose, cards and charts update from the same parameters.
- Open the source editor to see highlighting, completion, binding navigation and diagnostics.
- Insert a component from the editor toolbar; external packages appear in the catalog with their authoring metadata.
- Open the Tetris and 2048 plugin examples to see timer-driven and turn-based external components.
- Export the current preview as a single-file interactive HTML or a static snapshot, then open it offline.

Check the integration from the ReactiveMD-Demo repository root:

```sh
npm run build
npm run test:runtime-extensions
npm run test:runtime-extensions -- --dev
```

The script starts and stops its own server, exercises the real Worker, both plugin examples, the editor catalog, mobile layout and offline exports, and writes results to `artifacts/demo-extensions/`.

## Extend with your own components

A plugin is an npm package with three parts: a plain-data manifest, a React implementation and optional CSS. The manifest declares the tag, props, bindings, capabilities and authoring metadata; the implementation reads normalized props and writes through binding handles.

```tsx
// src/my-widget.tsx
import { defineReactComponentPackage, type LocalComponentContext } from 'reactive-md/react';
import { manifest } from './manifest.js';

export const widgetPackage = defineReactComponentPackage({
  ...manifest,
  render: (ctx: LocalComponentContext) => (
    <button onClick={() => ctx.bindings.value.set(1)}>Activate</button>
  ),
  css: '.local-document .my-widget { color: var(--ink); }',
});
```

Assemble the host once, and let Vite load the same registration module:

```ts
// extensions.ts
import { createReactHost } from 'reactive-md/react';
import { widgetPackage } from 'my-widget/react';

export const host = createReactHost({ packages: [widgetPackage] });
```

```ts
// vite.config.ts
import { reactiveMd } from 'reactive-md/vite';

export default { plugins: [reactiveMd({ extensions: './extensions.ts' })] };
```

The Demo ships two complete installed-package cases:

| Package | Tag | Demonstrates | Update guide |
| --- | --- | --- | --- |
| `reactive-md-tetris-package` | `<tetris>` | Timer-driven game, keyboard and pointer input, seeded pieces, offline export | [Demo candidate guide](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/candidate-package-updates-en.md) |
| `reactive-md-game-2048-package` | `<game-2048>` | Turn-based state, deterministic spawns, keyboard and pointer input, static preview | [Demo candidate guide](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/candidate-package-updates-en.md) |

The Demo site runs local copies under `ReactiveMD-Demo/plugin/`; the committed tarballs under `vendor/` are installed-package fixtures for compatibility tests. Both package entries are read through their public `./react` and `./notices` entries. Their authoring metadata feeds the editor catalog, and their capability evidence supports offline export.

Component tags must start with a letter, so the 2048 plugin registers `<game-2048>` rather than `<2048>`. See the [component plugin development guide](docs/development/component-development-en.md) and the [full development contract](docs/development/component-development-reference-en.md) for manifests, bindings, themes, resources, compliance tools and packaging.

## Where it fits

| Scenario | What Reactive MD gives you |
| --- | --- |
| Interactive reports and dashboards | One source for prose, parameters, tables and charts; links to related views stay in sync |
| Teaching, tutorials and courseware | Formula-driven plots, diagrams, guided steps, quizzes and self-checking examples |
| Pricing, planning and calculators | Shared named calculations, validation, currency and percentage formatting |
| Forms, checklists and onboarding | Scoped inputs, required fields, checklists and timers without a server |
| Offline handouts and proposals | A single HTML file with embedded styles, images and runtime; readable without JavaScript |
| Embedded widgets in apps and docs | React renderer, standalone browser API or `<reactive-md-doc>` elements |
| Games and experimental interfaces | Component SDK with local React state, keyboard input, timers and offline bundles |
| Internal tools and living documentation | Local-first state, no account or backend, source stays in plain `.reactive.md` |

## Install

Reactive MD requires Node.js 22.12 or newer and ships only ESM entries:

```sh
npm install reactive-md
```

The 0.8.0 stable release uses the `latest` channel:

```sh
npm install reactive-md
# or pin the version
npm install reactive-md@0.8.0
```

Read the [0.8.0 release notes](docs/releases/release-0.8.0-en.md) for this release, and the [compatibility guide](docs/compatibility/compatibility-en.md) before upgrading from `0.6.x` / `local-draft-2`.

### Upgrade to 0.8.0

`reactive-md@0.8.0` moves the source editor to the separate `reactive-md-editor@0.1.0` package. Install the engine and editor separately:

```sh
npm install reactive-md@0.8.0
npm install reactive-md-editor@0.1.0
```

Read the [0.8.0 release notes](docs/releases/release-0.8.0-en.md) and the [repository migration guide](docs/releases/release-0.8.0-en.md#repository-split-and-import-migration) before replacing `reactive-md/editor` imports. `0.8.0` keeps syntax `local-draft-3`, the `0.7.0` SDK contract and the existing state protocols, so document sources need no migration.

The `reactive-md` entry provides the local compiler, expressions and runtime; `reactive-md/react` provides the React renderer. Import component styles from `reactive-md/styles.css`. The `reactive-md-editor` entry provides the source editor with its own stylesheet at `reactive-md-editor/styles.css`. Engine 0.8 removes the old `reactive-md/editor` entries; published 0.7 packages keep them.

The core entry does not depend on React:

```js
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal('<number bind="n" label="Count" initial="2">');
if (result.ok) {
  const runtime = createLocalRuntime(result.document);
  try { console.log(runtime.text('Total: {{ n * 100 }}')); }
  finally { runtime.dispose(); }
}
```

See [Local mode integration](docs/integration/local-integration-en.md) for the full compile and runtime APIs, host URL policy, lifecycle and style overrides.

## Choose an entry point by task

Every subpath is an ESM entry with its own declarations. Pick the one that matches the job; optional peers appear only in the last column.

| Task | Entry | What it gives you | What it leaves out | React / Vite |
| --- | --- | --- | --- | --- |
| Compile once and run in memory | `reactive-md` | `compileLocal`, `createLocalCompileSession`, `createLocalRuntime`, expressions and plot sampling, state import/export and retention, the host-supplied Worker protocol (`startLocalCompileWorker`, `LocalCompileScheduler`), `createShareableHtml`, the default preset | React, CSS, Vite, the component catalog and toolbar commands, export planning | — |
| Compile in a Worker or a size-sensitive bundle | `reactive-md/compiler` | `createCompiler` and the `CompileResult` contract: CommonMark, ReactiveMD structure, expressions, bindings, budgets | React, CSS, the compile-worker protocol, session, retention, shareable/export code, default preset, GFM, native HTML, Lezer planning, KaTeX display, plot sampling | — |
| Keep the full language in one pass | `reactive-md/compiler/standard` | `createStandardCompiler`: adds GFM, native HTML, Lezer block planning, the KaTeX display check, plot formula sampling and the default preset | React, CSS, the compile-worker protocol, session, retention, shareable/export code | — |
| Render in React | `reactive-md/react` | `LocalReactiveDocument`, `LocalDocumentView`, `defineReactComponentPackage`, `createReactHost`; the build extracts the stylesheet instead of injecting it | Node build and export tooling, the editor | React 19, plus `reactive-md/styles.css` |
| Render on a server | `reactive-md/react/server` | `renderLocalStaticDocument` with capability preflight and diagnostics | client runtime, DOM, stylesheet | React 19 + react-dom 19 |
| Render without the stylesheet import | `reactive-md/react/unstyled` | the same components without the CSS side effect | `styles.css` | React 19 |
| Build interactive components | `reactive-md/react/runtime` | `useTicker`, `useFrame`, `useSwipe`, `useKeys`, `useComponentState` | the document renderer, the compiler | React 19 |
| Publish a component package | `reactive-md/sdk` | `defineLocalComponent`, `defineLocalPreset`, manifest, config, registry and theme contracts with validation | React renderers, document rendering, DOM | — |
| Drive an editor | `reactive-md/authoring` | `analyzeLocalSource`, `completeLocalSource`, `formatLocalSource`, `renameLocalBinding`, the component catalog and toolbar insert commands | React, CSS, DOM, compile sessions | — |
| Preflight an export | `reactive-md/export` | `createLocalExportPlan`, `createLocalShareableHtml`, restoration requirements, component-state files, style resources | Vite build, React rendering (the caller supplies markup), the CLI | — |
| Build an offline bundle | `reactive-md/build` | `buildLocalStandaloneBundle`, preflight, manifest and seal, resource and notice collection | browser rendering, the CLI | Vite 8 (optional peer, loaded on demand), Node |
| Resolve the files an export embeds | `reactive-md/export-assets` | `listExportAssets`, `resolveExportAsset`, `readExportAsset` for the stylesheets, notices, package metadata and standalone runtime | the compiler, React, browser code | Node |
| Wire Vite | `reactive-md/vite` | `reactiveMd()` registration, the dev host, `reactive-md-standalone.js` and `reactive-md-export.json` assets | the runtime API, browser code | Vite 8, Node |
| Mount an exported document | `reactive-md/standalone` | `mount`, `mountAll`, `isReactiveMDMounted`, payload parsing, mount diagnostics and events | the compiler surface, automatic mounting, build tooling | React 19, plus `reactive-md/styles.css` |
| Share identity, randomness, timers and component state | `reactive-md/runtime` | document identity and seeds, seeded random, the scheduler, the component-state registry and runtime services | rendering, web storage, network | — |
| Persist component state in a browser | `reactive-md/runtime/browser` | `createLocalBrowserStateStorage`, `flushComponentStateOnPageHide` | Node persistence, the runtime entry | a browser storage object |
| Verify a component package | `reactive-md/testing` | manifest and behavior compliance runners, report and parity helpers | React, DOM, a browser | — |
| Verify SSR output | `reactive-md/testing/react` | `runLocalReactCompliance`, `readLocalReactSpec`, error probes, `checkLocalComplianceMarkup` | a browser driver | React 19 + react-dom 19 |
| Verify the browser lifecycle | `reactive-md/testing/browser` | `runLocalBrowserCompliance`, the driver contract, `createPlaywrightBrowserDriver` | Playwright as a dependency | a browser context |
| Install the built-in components | `reactive-md/presets/default` | `defaultPreset`: manifest data for the built-in tags | the engine runtime, React renderers | — |
| Install a subset of them | `reactive-md/presets/default/packs` | `controlsPack`, `layoutPack`, `dataPack`, `visualsPack` | the components outside the pack | — |
| Style a document | `reactive-md/styles.css` | component, theme and document layers in the published cascade order | JavaScript | — |
| Print a document | `reactive-md/print.css` | print rules that hide controls and reveal `.local-print-value` | screen layout | load after `styles.css` |
| Ship third-party notices | `reactive-md/notices` | the generated `THIRD_PARTY_NOTICES.md` text | code | — |
| Drop in a prebuilt runtime | `reactive-md/assets/standalone.js` | the IIFE build with `ReactiveMD.mount`, `mountAll` and auto-mount for exported payloads | ESM imports, tree shaking, the compiler | a script tag, plus `reactive-md/styles.css` |

`reactive-md` (root) is the full core surface: default preset, incremental session, state and retention tools, the Worker protocol and the shareable HTML envelope. `reactive-md/compiler` is the light entry, with no React, CSS, Worker, session or default preset. `reactive-md/compiler/standard` adds GFM, native HTML, Lezer block planning, the KaTeX display check, plot sampling and the default preset, and keeps React, CSS, Worker and session out. `npm run test:compiler-entry` enforces that split on every build: it walks the root, compiler and standard graphs, records file count and byte size per entry, and fails when a compiler graph reaches a worker, session, retention, shareable, export, React, standalone or preset module, a stylesheet or the theme protocol.

### Smallest useful code

**Compile and run in memory**

```js
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal('<number bind="n" label="Count" initial="2">');
if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('\n'));

const runtime = createLocalRuntime(result.document);
try { console.log(runtime.text('Total: {{ n * 100 }}')); }
finally { runtime.dispose(); }
```

**Compile without a runtime**

```js
import { createCompiler } from 'reactive-md/compiler';
import { createStandardCompiler } from 'reactive-md/compiler/standard';

console.log(createCompiler().compile('# Title\n\nPlain **Markdown**.').status);          // 'valid'
console.log(createStandardCompiler().compile('| a | b |\n| - | - |\n| 1 | 2 |').status); // 'valid'
```

**Render in React**

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} />;
}
```

**Author in an editor**

```ts
import { analyzeLocalSource, insertLocalComponentFromOptions } from 'reactive-md/authoring';

const analysis = analyzeLocalSource(source);
const edit = insertLocalComponentFromOptions(undefined, 'chart', source, { start: 0, end: 0 });
console.log(analysis.bindings, edit.value);
```

**Export and build**

```ts
import { buildLocalStandaloneBundle } from 'reactive-md/build';
import { createLocalExportPlan } from 'reactive-md/export';

const bundle = await buildLocalStandaloneBundle({ entry: '.reactive-md/host.mjs' });
const plan = createLocalExportPlan({ document, config, target: 'offline', bundle });
if (!plan.ok) throw new Error(plan.diagnostics.map(item => item.message).join('\n'));
```

**Test a component package**

```ts
import { LOCAL_BEHAVIOR_SPEC_PROTOCOL, runLocalBehaviorCompliance, runLocalManifestCompliance } from 'reactive-md/testing';

const manifest = runLocalManifestCompliance(widgetManifest);
const behavior = runLocalBehaviorCompliance({
  protocol: LOCAL_BEHAVIOR_SPEC_PROTOCOL,
  component: 'my-widget',
  source,
  binding: 'value',
}, config);
console.log([...manifest.cases, ...behavior.cases].filter(item => item.status === 'failed'));
```

## Use with React

The React entry requires React 19:

```sh
npm install react@19 react-dom@19
```

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} />;
}
```

`LocalReactiveDocument` compiles and manages the runtime for you. To control compilation, lifecycle or URL policy yourself, use `LocalDocumentView` as described in [Local mode integration](docs/integration/local-integration-en.md).

## Edit source with React

The reusable source editor lives in the separate `reactive-md-editor` package (`0.1.0` in the 0.8 release), with its own stylesheet. Install it alongside the engine after publication. In 0.7 it shipped as `reactive-md/editor`. The component is controlled and requires React 19:

```tsx
import { useState } from 'react';
import { ReactiveMarkdownEditor } from 'reactive-md-editor';
import 'reactive-md-editor/styles.css';

export function Editor() {
  const [source, setSource] = useState('# Notes');
  return <ReactiveMarkdownEditor value={source} onChange={setSource} />;
}
```

The editor handles highlighting, formatting and insertion tools, completion, binding tools, undo and redo, and line numbers. It does not compile or render a preview; keep the source in your app and render it with `reactive-md/react`. See [React source editor](docs/integration/editor-en.md) for props, the ref handle, diagnostics, themes, locales and history.

## Share documents

Build a self-contained HTML file that readers can open offline, or a script-free static snapshot:

```sh
npm run build
npx reactive-md build examples/local/counter.reactive.md -o counter.html
npx reactive-md build examples/local/counter.reactive.md -o counter-static.html --mode static
```

The interactive file embeds the original source, React 19, the runtime, styles and any verified local images. It hydrates a static first screen, so it remains readable with JavaScript disabled. Use `--state-file doc.state.json` to export a saved `reactive-md-state/v1` baseline; without it, the author initial values are used and become the reader's reset baseline. Use `--component-state-file game.state.json` to embed component progress, and `--document-id` or `--random-seed` to set its identity and random stream. The Demo export dialog can save the current preview parameters as such a file.

See [Shareable documents and static export](docs/integration/shareable-export-en.md) for image limits, CSP/security, printing, exit codes, `ReactiveMD.mount`/`mountAll` and `<reactive-md-doc>`.

## Repository layout

```text
src/           Local syntax compilation, expressions, runtime and React renderer
examples/      Copyable local interactive examples and component packages
docs/          Syntax specification, integration, development and release documentation
tests/         Language and renderer tests
ReactiveMD-Demo/  Separate repository: website and plugin integrations
benchmarks/    Condensed performance measurements with provenance
```

## Documentation

- [Documentation index](docs/README.md) and [beginner guide](docs/guides/local-guide-en.md).
- [Local interaction syntax specification](docs/reference/local-interaction-syntax-en.md) and [feature tours](examples/local/README.md).
- [Local mode integration](docs/integration/local-integration-en.md): core and React API, URL policy, lifecycle, styling and version pinning.
- [Shareable documents and static export](docs/integration/shareable-export-en.md): CLI build/lint, state files, local image inlining, printing and the standalone browser runtime.
- [React source editor](docs/integration/editor-en.md) and [author tools](docs/integration/author-tools-en.md).
- [Component protocol](docs/development/component-protocol-en.md) and [component plugin development guide](docs/development/component-development-en.md).
- [Extension tutorial](docs/development/extension-tutorial-en.md): choose an entry, build a component package and verify it.
- [Versions and compatibility](docs/compatibility/compatibility-en.md).
- [Performance measurements](docs/development/performance-overview-en.md) and [release checklist](CONTRIBUTING.md#releasing).
- [0.8.0 release notes](docs/releases/release-0.8.0-en.md), [0.7.0 release notes](docs/releases/release-0.7.0-en.md) and earlier release records in [docs/releases](docs/releases).

## Support and status

- CI targets Node 22.12 and Node 24 with Playwright Chromium for the full browser gate and Firefox/WebKit for core workflows; local browser checks use Microsoft Edge. The packed check covers static SSR, and `npm run test:shareable` covers the single-file export's static-first hydration. General SSR hydration outside that path and the full Firefox/WebKit interaction suites remain unverified.
- 0.x minor releases may contain breaking changes. Persist the original `.reactive.md` source, not the runtime AST or in-memory state.
- `0.8.0` is the stable release on `latest`. Security fixes may ship in minor releases.
- The extension SDK contract is `0.7.0`; `0.8.0` keeps it unchanged. Component packages, themes, the Vite adapter, offline builds and compliance tools use the public entries.

## Contributing and security

- [Contributing guide](CONTRIBUTING.md): environment, check commands and change requirements.
- [Security policy](SECURITY.md): threat boundary, resource limits, host responsibilities and vulnerability reporting.
- [Changelog](CHANGELOG.md).
- [Release checklist](CONTRIBUTING.md#releasing): the verification gate, notices, tarball and the manual release flow for maintainers.

## License

[MIT](LICENSE)
