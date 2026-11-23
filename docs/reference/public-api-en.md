# Public API reference

**English** · [中文](public-api-ch.md)

This page lists every public interface Reactive MD offers to external developers: package entries, the command line, browser protocols and the editor package. Use it to choose an entry before reading the topic documents.

Three packages exist. Each has its own version and release workflow.

| Package | Version | Responsibility |
| --- | --- | --- |
| `reactive-md` | `0.9.2` | Compiler, runtime, authoring services, SDK, React and SSR rendering, export, build adapters |
| `reactive-md-editor` | `0.2.1` | CodeMirror 6 source editor, toolbar, editor-side navigation |
| `reactive-md-demo` | private | Website, examples and deployment. No public API |

The engine ships ESM only and targets Node.js 22.12 or newer in Node builds. React 19 and Vite 8 are optional peers, each used by a subset of the entries.

## Quick index

| Entry | Kind | React | Node-only | One-line purpose |
| --- | --- | --- | --- | --- |
| `reactive-md` | ESM | No | No | Full core surface: one-shot and streaming compile, incremental sessions, runtime, state, Worker, shareable HTML |
| `reactive-md/compiler` | ESM | No | No | One-shot semantic compiler without the default preset |
| `reactive-md/compiler/standard` | ESM | No | No | One-shot compiler with GFM, native HTML, KaTeX and the default preset |
| `reactive-md/react` | ESM | Yes | No | React document renderer and component development API |
| `reactive-md/react/unstyled` | ESM | Yes | No | The same renderer without the stylesheet side effect |
| `reactive-md/react/minimal` | ESM | Yes | No | Renderer built on the 18-component minimal preset |
| `reactive-md/react/server` | ESM | Yes | Yes | Strict SSR adapter returning markup or diagnostics |
| `reactive-md/react/runtime` | ESM | Yes | No | Component-facing React hooks: timers, frames, swipe, keys, state |
| `reactive-md/sdk` | ESM | No | No | Component, preset and theme manifests with validation |
| `reactive-md/presets/default` | ESM | No | No | The 48-component default preset as plain data |
| `reactive-md/presets/default/packs` | ESM | No | No | Four named subsets of the default preset |
| `reactive-md/presets/minimal` | ESM | No | No | The 18-component minimal preset |
| `reactive-md/presets/minimal/react` | ESM | Yes | No | React implementations for the minimal preset |
| `reactive-md/plugins/*` | ESM | Yes | No | Eight optional official component packages |
| `reactive-md/authoring` | ESM | No | No | Analysis, completion, rename, formatting, catalog, toolbar commands |
| `reactive-md/export` | ESM | No | Partly | Export preflight, shareable HTML, bundle sealing, restoration rules |
| `reactive-md/export-assets` | ESM | No | Yes | Locate the stylesheets, notices and runtime that an export embeds |
| `reactive-md/build` | ESM | No | Yes | Build a standalone interactive bundle through Vite |
| `reactive-md/vite` | ESM | No | Yes | Vite plugin for directory discovery and virtual modules |
| `reactive-md/vite/client` | types | — | — | Declarations for the virtual modules |
| `reactive-md/standalone` | ESM | Yes | No | Programmatic mount API for the bundled standalone runtime |
| `reactive-md/standalone/host` | ESM | Yes | No | The same mount API bound to a fixed React configuration |
| `reactive-md/testing` | ESM | No | No | Manifest and behavior compliance runners |
| `reactive-md/testing/react` | ESM | Yes | Yes | Static and SSR compliance runners |
| `reactive-md/testing/browser` | ESM | No | No | Browser lifecycle compliance with an optional Playwright driver |
| `reactive-md/runtime` | ESM | No | No | Document identity, seeds, random, scheduler, component-state registry, network channels |
| `reactive-md/runtime/browser` | ESM | No | No | `localStorage` persistence, page-hide flush, HTTP/SSE, WebSocket, WebRTC adapters |
| `reactive-md/observability` | ESM | No | No | Observe compile and Worker events and produce diagnostic reports |
| `reactive-md/pdf` | ESM | No | Yes | Render prepared static HTML to PDF bytes through Playwright |
| `reactive-md/styles.css` | CSS | — | — | Document, component and theme styles |
| `reactive-md/styles/minimal.css` | CSS | — | — | Styles for the minimal preset |
| `reactive-md/screen.css` | CSS | — | — | Alias of `styles.css` |
| `reactive-md/print.css` | CSS | — | — | Print layout; load after `styles.css` |
| `reactive-md/notices` | file | — | — | Generated third-party notices |
| `reactive-md/assets/standalone.js` | IIFE | — | — | Prebuilt browser runtime exposing `ReactiveMD` |
| `reactive-md/package.json` | file | — | — | Package metadata |

## Compilation and the core runtime

### `reactive-md`

The full core surface. No React, no stylesheet, no DOM.

| Area | Exports |
| --- | --- |
| One-shot compile | `compileLocal`, `LocalCompileResult`, `LocalCompileOptions` |
| Incremental editing | `createLocalCompileSession`, `LocalCompileSession`, `LocalIncrementalStats` |
| Streaming source | `LocalSourcePhase`, `LocalCompileStatus`; phased session and scheduler arguments |
| Runtime | `createLocalRuntime`, `updateLocalRuntime`, `notifyLocalRuntime`, `LocalRuntime`, `LocalSnapshot` |
| Expressions and math | `compileExpression`, `LocalExpressionError`, `compileLatex`, `compilePlotFormula`, `plotFormulaKind`, `implicitGridSize`, `samplePlot`, `sampleImplicit`, `sampleParametric`, `samplePolar` |
| Diagnostics | `formatLocalDiagnostic`, `LOCAL_DIAGNOSTIC_CODES`, `isLocalDiagnosticCode`, `localDiagnosticTemplate`, `localDiagnosticTemplateKeys` |
| State files | `createLocalStateFile`, `parseLocalState`, `resolveLocalState`, `applyLocalState`, `exportLocalState`, `importLocalState`, `serializeLocalState`, `LOCAL_STATE_FORMAT` |
| State retention | `planLocalStateRetention`, `applyLocalStateRetention` |
| Source versions | `inspectLocalSourceVersion`, `checkLocalUpgrade`, `migrateLocalSource`, `LOCAL_SYNTAX_VERSION` |
| Authoring (re-export) | `analyzeLocalSource`, `completeLocalSource`, `renameLocalBinding`, `formatLocalSource` |
| Background compile | `LocalCompileScheduler`, `startLocalCompileWorker`, `LOCAL_COMPILE_DELAY_MS`, `LOCAL_COMPILE_PREPARATION_DELAY_MS`, `compileFailureDiagnostic`, `localWorkerOptionsKey`, `LocalCompileOutcome`, `LocalCompileRequest`, `LocalCompileResponse` |
| Result patches | `LOCAL_RESULT_PATCH_PROTOCOL`, `diffSourceEdit`, `applySourceEdit`, `encodeLocalResultPatch`, `applyLocalResultPatch` |
| Themes | `LOCAL_THEME_PROTOCOL`, `DEFAULT_LOCAL_THEME`, `resolveLocalTheme`, `isLocalThemeName` |
| HTML envelope | `createShareableHtml`, `resolveLocalStateBaseline`, `SHAREABLE_HTML_FORMAT`, `SHAREABLE_HTML_FORMAT_V2`, `serializeForScript` |
| Component state | `LOCAL_STATE_FORMAT`, `localSourceDigest`, plus the `./export/component-state` surface |

Use this entry when a host compiles, runs and persists documents in memory. `compileLocal()` is the one-shot full compiler; `createLocalCompileSession()` reuses unchanged Markdown blocks across edits; `createLocalRuntime()` owns parameters, subscriptions and disposal. The runtime writes no storage, cookies or network on its own.

`LocalCompileOptions.sourcePhase` marks a snapshot as `streaming` or `final`; sessions accept `compile(source, options?, phase?)` and `compileShared(source, options?, phase?)`, and `LocalCompileScheduler.schedule(source, options?, hint?, phase?)` takes the same phase, with `final` bypassing the debounce. Explicit phases add `status` (`partial`, `valid`, `recovered`, `failed`), and streaming results may add `transientDiagnostics`; transient diagnostics never appear in `diagnostics`. Worker full requests and responses echo `sourcePhase` when a phase was declared (on the request or the options object); phase-less legacy jobs omit it. `LocalCompileOutcome.sourcePhase` reports it, revisions stay monotonic, and streaming results never become patch baselines. One-shot `compileLocal` and the compiler entries remain final-only.

### `reactive-md/compiler`

A single-pass compiler with no component preset. It keeps CommonMark, ReactiveMD structure, expressions, bindings, semantic checks and budgets. It creates no session, Worker, timer or cache, and loads no React, CSS, theme implementation or preset.

```ts
import { createCompiler } from 'reactive-md/compiler';

const result = createCompiler().compile('# Notes\n\nPlain Markdown.');
```

Capabilities the minimal assembly does not install produce an explicit capability diagnostic instead of silently changing meaning. For example `enableCss` reports `local.capability.html`.

### `reactive-md/compiler/standard`

The same result contract, wired to the full experience: the default preset, GFM, native HTML parsing and repair, Lezer block planning, the KaTeX display precheck and plot formula semantics. Use it when a host wants one-shot compilation with the complete language but without sessions, Workers or React.

Both factories validate options at creation and freeze a snapshot. Invalid configuration throws `CompilerConfigurationError`. Results carry `status: 'valid' | 'recovered' | 'failed'`, plus `ok`, `document`, `diagnostics`, `program`, `recoveries` and check coverage.

## React rendering

### `reactive-md/react`

| Export | Purpose |
| --- | --- |
| `LocalReactiveDocument` | Compiles a `source` string and owns the runtime; the usual entry for an article |
| `LocalDocumentView` | Renders a host-compiled `LocalDocument` with a host-owned `LocalRuntime` |
| `createReactConfig`, `createReactHost` | Bind component manifests to React implementations |
| `defineReactComponent`, `defineReactComponentPackage`, `defineReactPreset`, `defaultReactPresetPackage` | Package formats for external and official components |
| `reportLocalComponentError`, `safeLocalComponentEvent`, `LocalReactExtensionMissingError`, `validateLocalReactExtensions` | Component error and lifecycle helpers |
| Component context types | `LocalComponentContext`, `LocalComponentRuntime`, `LocalComponentServices`, `LocalComponentBindingHandle`, `LocalComponentContent` and the related value, table, option and locale types |
| Adapter primitives | `compileExpression`, `compileLatex`, `compilePlotFormula`, `samplePlot`, `sampleImplicit`, `sampleParametric`, `samplePolar`, `layoutDiagram`, `diagramEdgePath`, `TableSurface`, `LatexView`, limits and formatting helpers |
| Adapter utilities | `useComponentView`, `useWriter`, `useDisabled`, `useResetToken`, `useSourceAttributes`, `useValidationField`, `useValidationHint`, `formatNumber`, `snapToStep` and the other `component-utils` helpers |

`LocalReactiveDocument` also accepts `sourcePhase?: 'streaming' | 'final'` and `onTransientDiagnostics?: (diagnostics: Diagnostic[]) => void`. While streaming it renders in static mode and defers side effects; `final` restores the host's interaction mode. See [Streaming source compilation](../integration/local-integration-en.md#streaming-source-compilation). Neither component accepts `className`, `style` or children.

### `reactive-md/react/unstyled`

The identical React surface without importing `styles.css`. Hosts that inject the stylesheet themselves, or render inside a shadow root, use this entry.

### `reactive-md/react/minimal`

The same two components and helpers, built on the 18-component minimal preset. `createReactHost()` and `createReactConfig()` here pair with `reactive-md/presets/minimal` and `reactive-md/styles/minimal.css`.

### `reactive-md/react/server`

`renderLocalStaticDocument` runs capability preflight, validates the installed contracts and returns either markup or structured diagnostics. Its markup is the intended `staticMarkup` input for static and offline export; keeping React text boundaries lets the standalone runtime hydrate the same tree.

### `reactive-md/react/runtime`

Hooks for component implementations: `useTicker`, `useFrame`, `useSwipe` with `classifySwipe`, `useKeys` with `isEditableTarget`, and `useComponentState`. The entry imports no renderer and no compiler.

## Component SDK and presets

### `reactive-md/sdk`

| Group | Exports |
| --- | --- |
| Definition | `defineLocalComponent`, `readLocalComponentManifest`, manifest limits, protocol constants |
| Configuration | `createLocalConfig`, `readLocalConfig`, `localConfigKey`, `snapshotLocalConfig`, `localComponentConfigKey`, `validateLocalDocumentConfig` |
| Registry | `getLocalComponentRegistry`, `getLocalComponentDefinition`, `localComponentSchemas` |
| Presets | `defineLocalPreset`, `readLocalPresetPackage`, `localPresetDigest` |
| Themes | `defineLocalTheme`, `composeLocalTheme`, `collectLocalThemeCss`, `isLocalInlineCss`, `LocalStyleResource` |
| Assembly | `localAssemblyIdentity`, `localAssemblySeal`, `localConfigKeyMatches` |
| Compatibility | `LOCAL_COMPAT_PROFILES`, `findLocalCompatProfile`, `localCompatProfiles` |
| Props and bindings | `resolveLocalComponentProps`, `resolveLocalComponentProp`, `resolveLocalComponentBindingConstraints`, `localBindingAttributeNames`, `localComponentHostBinding` |
| Versions and protocols | `LOCAL_SDK_VERSION`, `LOCAL_COMPONENT_PROTOCOL`, `LOCAL_PRESET_PROTOCOL`, `LOCAL_REACT_PRESET_PROTOCOL`, `LOCAL_CONFIG_PROTOCOL`, `LOCAL_CONFIG_PROTOCOL_V2`, `LOCAL_EXTENSIONS_PROTOCOL`, `LOCAL_ASSEMBLY_PROTOCOL`, `localVersionSatisfies`, `parseLocalVersionRange` |
| Style contract | `LOCAL_STYLE_CONTRACT`, `LOCAL_STYLE_LAYERS`, `LOCAL_THEME_STYLE_LAYER`, `LOCAL_STYLE_LAYER_ORDER` |

Manifests are plain, serializable data. Registration validates identities, names, protocols, dependencies and budgets, then copies and freezes. `readLocalConfig` revalidates a serialized configuration and recomputes its semantic key, so a host can round-trip configuration through JSON safely.

### Built-in presets

| Entry | Contents |
| --- | --- |
| `reactive-md/presets/default` | `defaultPreset`, id `reactive-md/default`, 48 components: `input`, `textarea`, `number`, `slider`, `range-slider`, `coordinate`, `toggle`, `checkbox`, `date`, `select`, `choices`, `radio-group`, `multi-select`, `option`, `counter`, `timer`, `checklist`, `progress`, `jump`, `anchor`, `text`, `section`, `quiz`, `panel`, `card`, `grid`, `gallery`, `gallery-item`, `tabs`, `tab`, `steps`, `step`, `accordion`, `disclosure`, `if`, `alert`, `badge`, `tooltip`, `validation`, `data-table`, `column`, `table`, `chart`, `plot`, `timeline`, `diagram`, `node`, `edge` |
| `reactive-md/presets/default/packs` | `controlsPack` (19), `layoutPack` (21), `dataPack` (4), `visualsPack` (5) |
| `reactive-md/presets/minimal` | `minimalPreset`, id `reactive-md/minimal`, 18 components: `input`, `textarea`, `number`, `slider`, `toggle`, `date`, `select`, `option`, `jump`, `anchor`, `text`, `section`, `panel`, `card`, `grid`, `if`, `alert`, `badge` |
| `reactive-md/presets/minimal/react` | `minimalReactPresetPackage`: React implementations for those 18 components |

Packs are ordinary presets, so a host selects one or more and never combines a pack with `defaultPreset`. `visualsPack` depends on `dataPack` because `plot` and `data-table` share the `column` layout component. `layoutPack` declares `column` as well, so `layoutPack` and `dataPack` cannot be installed together.

### Optional plugin packages

Each `reactive-md/plugins/<name>` entry exports a React preset package as its default export.

| Entry | Preset id | Components | Declared base |
| --- | --- | --- | --- |
| `reactive-md/plugins/forms` | `reactive-md/forms` | `range-slider`, `checkbox`, `choices`, `radio-group`, `multi-select`, `counter`, `timer`, `checklist`, `progress`, `quiz` | requires `reactive-md/minimal` |
| `reactive-md/plugins/network` | `reactive-md/network` | `submit-button` | none; works with every base |
| `reactive-md/plugins/navigation` | `reactive-md/navigation` | `tabs`, `tab`, `steps`, `step`, `accordion`, `disclosure`, `tooltip`, `validation` | none declared |
| `reactive-md/plugins/data` | `reactive-md/data` | `data-table`, `column`, `table`, `timeline` | none declared |
| `reactive-md/plugins/chart` | `reactive-md/chart` | `chart` | none declared |
| `reactive-md/plugins/plot` | `reactive-md/plot` | `coordinate`, `plot` | none declared |
| `reactive-md/plugins/diagram` | `reactive-md/diagram` | `diagram`, `node`, `edge` | none declared |
| `reactive-md/plugins/gallery` | `reactive-md/gallery` | `gallery`, `gallery-item` | none declared |

Every component except `submit-button` already exists in `defaultPreset`. Installing a plugin on top of the default preset therefore fails registration with a duplicate-id error. Pair these plugins with `minimalPreset` or with packs that exclude the overlapping components. `plugins/forms` requires the minimal preset explicitly and reports a missing-dependency error without it.

This is the supported way to keep a small install: start from `minimalPreset`, add packs and plugins the document actually uses, and register the matching React packages.

## Authoring tools

### `reactive-md/authoring`

DOM-free and React-free, so it runs in a Worker or a server process.

| Group | Exports |
| --- | --- |
| Source services | `analyzeLocalSource`, `completeLocalSource`, `renameLocalBinding`, `formatLocalSource` |
| Catalog | `createLocalComponentCatalog`, `createLocalComponentCatalogForOptions`, `filterLocalComponentCatalog`, `localComponentCatalogGroups`, `localComponentCatalogKey`, `localComponentHelp`, `localCatalogAncestors`, `createLocalAuthoringLookup` |
| Insertion | `insertLocalComponent`, `insertLocalComponentFromOptions`, `validateLocalComponentInsertTemplates` |
| Schema | `LOCAL_COMPONENTS`, `LOCAL_COMPONENT_NAMES`, `getLocalComponent`, `getPropDefault`, `localComponentNames`, `suggestComponent`, `suggestAttribute`, `closestName` and the schema types |
| Native catalog | `NATIVE_COMPONENTS`, `NATIVE_COMPONENTS_ZH`, `NATIVE_COMPONENT_GROUPS`, `EXTENDED_NATIVE_COMPONENTS`, `getNativeComponentCatalog`, `renderNativeSnippet` |
| Toolbar commands | `formatBold`, `formatItalic`, `formatStrike`, `formatInlineCode`, `formatHeading`, `formatBulletList`, `formatOrderedList`, `formatTaskList`, `formatQuote`, `indentSelection`, `outdentSelection`, `insertLink`, `insertImage`, `insertCodeBlock`, `insertTable`, `insertDivider`, `insertText`, `insertTemplate`, `readFormatState` |

Pass the same `LocalCompileOptions` used for rendering, so diagnostics, host components, limits and HTML mode stay consistent. Analysis ranges refer to the source version that produced them.

## Export and deployment

### `reactive-md/export`

| Export | Purpose |
| --- | --- |
| `createLocalExportPlan` | Preflight a target (`static`, `ssr`, `offline`) before any output exists: capabilities, resources, themes, bundle seal |
| `createLocalShareableHtml` | Produce single-file HTML with the host's prebuilt bundle |
| `defineLocalStandaloneBundle` | Bind an explicitly built script to the installed manifest set and seal it |
| `createLocalBundleManifest`, `createLocalRestorationRequirements`, `validateLocalRestorationRequirements`, `localThemeContractDigest`, `localExportContentDigest` | Bundle and restoration metadata |
| `resolveLocalComponentStateExport` | Validate a component-state sidecar against the document before embedding |
| `readLocalExportResources` | Validate and normalize host style resources |
| `prepareLocalPrintHtml`, `waitForLocalPrintImages` | Prepare static HTML for printing |
| `validateLocalComponentContracts`, `validateLocalExtensionRequirements` | Contract checks shared with the CLI |

Content digests detect mismatches. They are not signatures.

### `reactive-md/export-assets`

`listExportAssets()`, `resolveExportAsset(id)`, `readExportAsset(id)` over a frozen manifest with protocol `reactive-md-export-assets/v1`.

| Id | Specifier |
| --- | --- |
| `base-css` | `reactive-md/styles.css` |
| `print-css` | `reactive-md/print.css` |
| `notices` | `reactive-md/notices` |
| `package-json` | `reactive-md/package.json` |
| `runtime` | `reactive-md/assets/standalone.js` |

Read assets through this entry. Tarball layout and file names change between releases; the ids and protocol do not.

### `reactive-md/build`

Node adapter that reads only modules the host names explicitly, so third-party code stays a host dependency.

| Export | Purpose |
| --- | --- |
| `preflightLocalStandaloneBuild` | Validate the host entry, config key, React implementations, capabilities and resources without running Vite |
| `buildLocalStandaloneBundle` | Produce the IIFE script, seal, resources, assets, CSS and notices |
| `readLocalBuildHost`, `createLocalStandaloneEntrySource`, `VIRTUAL_HOST_ENTRY`, `VIRTUAL_HOST_MODULE` | Host entry loading and the generated entry module |
| `collectLocalBuildResources`, `readLocalBuildBudgets`, `readLocalStyleResourceInputs`, `DEFAULT_LOCAL_BUILD_BUDGETS` | Resource collection and budgets |
| `collectLocalBuildNotices` | Notice aggregation |
| `resolveLocalVite`, `LocalViteApi` | Optional Vite peer resolution |
| `LocalBuildError`, `LOCAL_BUILD_PROTOCOL` | Diagnostics and `reactive-md-build/v1` |

### `reactive-md/vite` and `reactive-md/vite/client`

`reactiveMd(options)` registers one Vite plugin.

| Option | Effect |
| --- | --- |
| none | Directory mode: discover `theme/*` and `plugin/*` under the Vite root |
| `themeDir`, `pluginDir` | Alternate discovery roots |
| `defaultPreset: false \| 'minimal'` | Start with no preset or the core set |
| `includeMinimal: true` | Also expose the `-minimal-host` and `-minimal-bundle` virtual modules |
| `extensions: './extensions.ts'` | Manual mode: one module exporting `host = createReactHost(...)` |

Directory and manual options are mutually exclusive. `loadLocalDirectoryHost` exposes the discovery result to hosts that want it outside the plugin lifecycle.

`reactive-md/vite/client` declares four virtual modules: `virtual:reactive-md/host`, `virtual:reactive-md/bundle`, `virtual:reactive-md-minimal-host` and `virtual:reactive-md-minimal-bundle`. The host module exports `host`, `config`, `reactConfig`, `resources`, `css`, `notices`, `discovery`, and in manual mode `extensions`. The bundle module default-exports `LocalStandaloneBuild` or `{ error, diagnostics }`.

### `reactive-md/pdf`

`renderLocalPdf(html, options)` returns PDF bytes. Options cover paper format, orientation, margins, background printing and a strict mode. The CLI loads this entry on demand, so Playwright and Chromium are only required for PDF output.

## Browser runtime

### `reactive-md/standalone`

| Export | Purpose |
| --- | --- |
| `mount`, `mountAll`, `isReactiveMDMounted`, `REACTIVE_MD_MOUNTED_ATTRIBUTE` | Programmatic mounting and mount detection |
| `parseMountPayload` | Validate an `application/reactive-md+json` payload |
| `ReactiveMDMountError` | Typed mount failure |
| `REACTIVE_MD_DIAGNOSTICS_EVENT`, `REACTIVE_MD_STATE_CHANGE_EVENT` | Event names emitted by the element and auto-mounts |

This entry performs no automatic mount and registers no implicit components. A host that builds its own page uses it.

### `reactive-md/standalone/host`

The same mounting functions bound to a fixed React configuration from the host bundle. No compiler surface and no auto-mount.

### Prebuilt runtime: `reactive-md/assets/standalone.js`

An IIFE that exposes the global `ReactiveMD` and mounts `application/reactive-md+json` payloads once on load. It also registers the `<reactive-md-doc>` custom element.

| Interface | Members |
| --- | --- |
| Global | `ReactiveMD.mount(element, options)`, `ReactiveMD.mountAll(root)`, `ReactiveMD.isReactiveMDMounted()` |
| Handle | `getState()`, `unmount()` |
| Element attributes | `src`, `source`, `locale`, `color-scheme`, `theme` |
| Element properties | `source`, `state`, `documentId`, `randomSeed`, `componentState`, `urlPolicy`, `imageResolver`, `themes` |
| Element events | `reactive-md-diagnostics`, `reactive-md-state-change` |

`src` fetches with cancellation; an explicit `source` avoids network access. Disconnecting the element aborts fetches, removes subscriptions and the React root, and disposes the runtime. The element uses Light DOM. `<script type="text/reactive-md">` text is not interpreted.

## Runtime services

### `reactive-md/runtime`

| Group | Exports |
| --- | --- |
| Identity | `componentStateKey`, `localSourceDigest`, `normalizeDocumentId`, `normalizeStateKey`, `resolveDocumentId`, `resolveComponentSeed`, `deriveSeed`, `fnv1a32`, `toUint32` |
| Randomness | `createRandom`, `deriveRandom`, `nextRandom`, `normalizeRandomState`, `randomBool`, `randomInt`, `shuffleRandom`, `LOCAL_RANDOM_ALGORITHM`, `LOCAL_RANDOM_VERSION` |
| Scheduling | `createLocalScheduler` with `LocalClock`, `LocalSchedulerPorts`, `LocalTickerOptions` |
| Component state | `createLocalComponentStateRegistry`, `parseLocalComponentStateDocument`, `LOCAL_COMPONENT_STATE_FORMAT`, `LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT` and the budget constants |
| Runtime services | `createLocalRuntimeServices`, `createDetachedRuntimeServices` |
| Network contract | `ComponentNetwork`, `NetworkChannel`, `SubmitAdapter`, `SubscribeAdapter`, `ChannelValidator`, `ChannelError`, `StreamEvent`, `DEFAULT_NETWORK_MAX_BYTES` |

### `reactive-md/runtime/browser`

| Group | Exports |
| --- | --- |
| Storage | `createLocalBrowserStateStorage`, `LOCAL_COMPONENT_STATE_STORAGE_PREFIX`, `LocalWebStorageLike` |
| Lifecycle | `flushComponentStateOnPageHide` |
| HTTP and SSE | `httpSubmit`, `sseStream` |
| Duplex | `webSocketChannel`, `webRtcChannel`, `jsonDuplexCodec`, `DEFAULT_DUPLEX_ACK_TIMEOUT_MS`, `DEFAULT_DUPLEX_MESSAGE_BYTES` |

Storage and transport objects are resolved lazily, so importing this entry in a server build touches no `window`, `localStorage`, `fetch` or `EventSource`.

## Testing tools

| Entry | Exports | Dependency |
| --- | --- | --- |
| `reactive-md/testing` | `runLocalManifestCompliance`, `runLocalBehaviorCompliance`, `readLocalBehaviorSpec`, `createLocalComplianceReport`, `compareLocalComplianceParity`, `describeLocalComplianceCase`, protocol constants | none |
| `reactive-md/testing/react` | `readLocalReactSpec`, `runLocalReactCompliance`, `checkLocalComplianceMarkup`, `REACT_COMPLIANCE_CAPABILITIES` | React 19 + react-dom 19 |
| `reactive-md/testing/browser` | `readLocalBrowserSpec`, `runLocalBrowserCompliance`, `createPlaywrightBrowserDriver`, driver and phase types | a browser context |

The three suites produce the same `LocalComplianceReport` shape. A declared capability counts as satisfied only when a case tagged with that capability passed. `compareLocalComplianceParity` compares two suite results by case id, status and observed values, which is how an external alias of a default contract is checked against the built-in implementation.

## Stylesheets

| Entry | Purpose |
| --- | --- |
| `reactive-md/styles.css` | Component, theme and document layers in the published cascade order |
| `reactive-md/styles/minimal.css` | The subset for the minimal preset |
| `reactive-md/screen.css` | Alias of `styles.css` |
| `reactive-md/print.css` | Print rules; load after `styles.css` |
| `reactive-md/notices` | Generated `THIRD_PARTY_NOTICES.md` |

Component styles are emitted as CSS files, never injected by the JavaScript entries. Import the stylesheet once where the document renders.

## Command line

`reactive-md` is the package binary.

| Command | Purpose | Exit codes |
| --- | --- | --- |
| `build <doc> -o <out>` | Compile one document into self-contained HTML or PDF, with state files, inlined images and optional project discovery | 0, 3, 4, 5 |
| `lint [--json] [--warnings-as-errors] [--locale] <file... \| ->` | Compile and report diagnostics without changing files | 0 clean, 1 diagnostics, 2 usage or read error |
| `migrate <file \| ->` | Rewrite syntax revision metadata, with `--check`, `--json`, `--accept-semantic-changes` | 0, 1, 2 |
| `check <package>` | Validate an installed preset or component package without a browser run | 0, 2, 3, 4 |
| `init component \| preset <dir>` | Generate a runnable package scaffold | 0, 2, 4 |

Documented exit codes: 0 success, 2 usage, 3 compile/render/build failure, 4 I/O, 5 asset or security policy.

`build` accepts `--format html|pdf`, `--mode interactive|static`, `--state-file`, `--component-state-file`, `--document-id`, `--random-seed`, `--assets inline|omit`, `--asset-root`, `--locale`, `--color-scheme`, `--title`, `--strict` and the `--pdf-*` family.

## Editor package

### `reactive-md-editor`

| Export | Purpose |
| --- | --- |
| `ReactiveMarkdownEditor` (alias `ReactiveMarkdownCodeEditor`) | Controlled CodeMirror 6 source editor |
| `ReactiveMarkdownEditorHandle` | `focus`, `selectRange`, `getSelection`, `getSource`, `getEditorElement`, `getVisibleRanges`, `insertText`, `undo`, `redo` |
| `MobileDocBar` | Narrow-screen document bar |
| Types | `EditorAuthorAnalysis`, `EditorTransaction`, `SourceChange`, `EditorEdit`, `EditorSelection`, `EditorViewMode`, `EditorComponentMode`, `EditorTheme`, `EditorLocale`, `EditorSurface` |

The component is controlled: `value` and `onChange` are required. It renders source only and does not compile a preview. Props include `locale`, `theme`, `preview`, `viewMode`, `height`, `readOnly`, `disabled`, `documentKey`, `diagnostics`, `document`, `toolbar`, `authoring`, `onExport`, `analysis`, `onTransaction` and `createAnalysisWorker`.

### `reactive-md-editor/codemirror`

The same component under the migration specifier, for hosts moving from `reactive-md/editor/codemirror`.

### `reactive-md-editor/commands`

The DOM-free toolbar commands, re-exported from `reactive-md/authoring`, with the editor's edit and selection types. Use it when a host wants text transformations without the component tree.

### Editor stylesheets

`reactive-md-editor/styles.css` and its alias `reactive-md-editor/codemirror/styles.css` carry the component, CodeMirror and mobile styles, scoped to the editor root.

## Protocol and version constants

| Constant | Value | Scope |
| --- | --- | --- |
| Package version | `0.9.2` | Engine releases |
| SDK contract | `0.7.0` (`LOCAL_SDK_VERSION`) | Component, preset and configuration manifests |
| Syntax revision | `local-draft-3` (`LOCAL_SYNTAX_VERSION`) | Document source |
| State file | `reactive-md-state/v1` (`LOCAL_STATE_FORMAT`) | Exported parameters |
| Component state | `reactive-md-component-state/v1` | Component-state sidecar |
| HTML envelope | `reactive-md-html/v1`, `reactive-md-html/v2` | Single-file export |
| Bundle manifest | `reactive-md-bundle/v1` | Sealed standalone bundle |
| Restoration | `reactive-md-restore/v1` | Export-side contract requirements |
| Export assets | `reactive-md-export-assets/v1` | Asset manifest |
| Build manifest | `reactive-md-build/v1` | Standalone build output |
| Diagnostic report | `reactive-md-diagnostic/v1` | Diagnostic report format version |
| Component protocol | `reactive-md-component/v1`, `component-protocol-3` | Component contribution |
| Theme protocol | `reactive-md-theme-1` | Document themes |
| Editor package | `0.2.1` | Editor releases, peer `reactive-md: ^0.9.2` |

Each constant is versioned independently: a package release can ship a new HTML envelope without moving the syntax revision, and a new theme protocol does not change the SDK contract.

## Observability

Import `LocalObserver`, `LocalTraceEvent`, `createDiagnosticReport` and `formatLocalDiagnostic` from `reactive-md/observability`. Supply an observer through `compileLocal(source, { observer })` or `new LocalCompileScheduler({ observer, createWorker, onResult })`. Observer callbacks receive independent copies, and callback exceptions are isolated from compilation.

```ts
import { compileLocal } from 'reactive-md';
import { createDiagnosticReport, type LocalObserver, type LocalTraceEvent } from 'reactive-md/observability';

const events: LocalTraceEvent[] = [];
const observer: LocalObserver = {
  onDiagnostic(diagnostic) { console.warn(diagnostic.code, diagnostic.phase); },
  onTrace(event) {
    events.push(event);
    if (events.length > 50) events.shift();
  },
};
const source = '# Example';
const result = compileLocal(source, { observer });
const report = createDiagnosticReport(source, { diagnostics: result.diagnostics, events });
```

Diagnostics expose optional `phase`, `messageKey`, `recoverable` and scalar `details`. Existing codes retain their meanings. English and Chinese templates for Worker, export and resource diagnostics are exported as `LOCAL_OBSERVABILITY_MESSAGES`. `LocalTraceEvent` covers compile, Worker and export stages; the `export-cancel` type records an export that stops, and diagnostic reports accept its `cancelled` and `printed` statuses. Worker requests carry `traceId`, `sourceRevision`, and `requestId`, which equals the transport `id`. Recovery requests preserve the source revision and trace. The scheduler defaults to a 30,000 ms timeout, configurable through `timeoutMs`, and falls back to main-thread compilation on transport failure.

A `createWorker` factory that throws is reported once, on the first task that runs on the fallback thread, as a `worker-error` trace with code `local.worker.startup` and status `failed`. The event reuses that task's `traceId` and `sourceRevision` and carries the bounded reason in the optional `detail` field. Later tasks do not repeat it. `detail` is observer-only free text.

Reports use schema `reactive-md-diagnostic/v1` and include package/protocol versions, runtime environment, source byte count and digest, registered diagnostic codes, ranges, selected budget details and the latest 50 events. Browser reports include user agent and platform. Node reports include Node version and platform. Hosts may supply editor, React and Vite versions through `options.package`. Report serialization is bounded to 64 KiB by removing oldest events and then trailing diagnostics. Free-text messages, source, diagnostic parameters, resource owner paths and the trace `detail` field are omitted. The host controls copying, storage and transmission.

## Where to read next

| Task | Document |
| --- | --- |
| Embed a document in an app | [Local mode integration](../integration/local-integration-en.md) |
| Write a component package | [Extension SDK](../integration/extension-sdk-en.md) and the [component protocol](../development/component-protocol-en.md) |
| Add a theme | [Theme protocol](theme-protocol-en.md) |
| Export or host standalone HTML | [Shareable documents and static export](../integration/shareable-export-en.md) |
| Wire a Vite project | [Directory discovery](../integration/directory-discovery-en.md) |
| Drive an editor | [React source editor](../integration/editor-en.md) and [author tools](../integration/author-tools-en.md) |
| Compile once without a runtime | [One-shot compilation](../integration/compiler-en.md) |
| Check compatibility before upgrading | [Versions and compatibility](../compatibility/compatibility-en.md) |
