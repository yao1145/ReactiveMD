# Changelog

This file records user-visible changes. The project is in a 0.x preview; version and migration rules are in [Versions and compatibility](docs/compatibility-en.md).

## 0.5.2 (2026-10-26, next channel)

Compatible with 0.5.1. Syntax remains `local-draft-2`, the component protocol is `component-protocol-2` and the theme protocol is `reactive-md-theme-1`. See [0.5.2 release notes](docs/release-0.5.2-en.md).

### Added

- Add an opt-in host component extension axis: `compileLocal(source, { hostComponents })` registers leaf tag schemas for one compilation. Registered tags become `hostComponent` nodes; invalid schemas return `local.options.invalid` and invalid attributes return `local.host.attribute`. A valid host node counts as one syntax node.
- Add `hostData` and `hostRenderer` to `LocalDocumentView` and `LocalReactiveDocument`. Host data is keyed `${kind}:${ref}`; a missing renderer, missing data or throwing renderer renders a visible placeholder. `mode="static"` uses the same dispatch.
- Export `LocalHostComponentSchema`, `LocalHostPropSchema` and `LocalHostPropKind`, and carry schemas through the compile worker without sending the renderer or host data.

### Security

- Restrict host `pattern` to a linear-time-safe regex subset, apply the shared string-length budget to host attributes, bound oversized schema arrays before scheduling, reject P0 HTML tag names as host names, and keep option signatures collision-free for BigInt or cyclic schema metadata.

### Changed

- Raise the component protocol to `component-protocol-2`. The syntax revision and the 48 author components are unchanged; the frozen `component-protocol-1.json` conformance baseline still applies to author components.

## 0.5.1 (2026-10-25, next channel)

Compatible with 0.5.0. Syntax remains `local-draft-2`, with `component-protocol-1` and `reactive-md-theme-1`. See [0.5.1 release notes](docs/release-0.5.1-en.md).

### Added

- Add P0 HTML compatibility to the default ReactiveMD rendering path, including rich disclosures, containers, headings, code, lists, links and images.
- Add host-owned `enableCss`, `enableJavaScript` and `enableExtendedHtml` options, all off by default. Any enabled option routes the entire document to isolated native HTML. This temporary routing policy disables Markdown and ReactiveMD interpretation in that path; see [HTML compatibility](docs/html-compatibility-en.md).
- Add localized Demo controls and preserve HTML mode in export. Static export disables author JavaScript.
- Add a built-in editor status bar with Unicode character count, a keyboard hint and Edit, Split and Preview views. The host supplies preview content. View changes keep the source selection, undo history and preview state.
- Narrow editor containers offer only Edit and Preview, and source-only editors keep the count and keyboard hint.

### Changed

- The editor source surface, gutter, syntax highlighting, toolbar and menus now follow the editor light, dark or automatic theme instead of staying on a fixed dark background.

## 0.5.0 (2026-10-25, next channel)

Compatible with 0.4.1. Syntax remains `local-draft-2`, with `component-protocol-1` and `reactive-md-theme-1`. Existing `reactive-md`, `reactive-md/react` and `reactive-md/styles.css` imports are unchanged, and the renderer entry keeps its API. See [0.5.0 release notes](docs/release-0.5.0-en.md).

### Added

- Add `reactive-md/editor`, a controlled React 19 source editor extracted from the Playground, with the independent style entry `reactive-md/editor/styles.css`. It provides highlighting, formatting and insertion tools, completion, binding navigation, rename, format, undo and redo, line numbers and scroll synchronization. Locale and theme are set per instance; `diagnostics` and `document` add gutter markers and binding value types. The host owns preview, persistence and export.
- Support attribute-free `<b>`, `<i>`, `<u>`, `<s>`, `<mark>` and `<br>` formatting.
- Render Markdown footnotes with rich definitions, numbering, repeated references and return links.
- Highlight fenced code in common languages and copy its exact source with localized feedback. Approved images open in a keyboard-accessible modal viewer.

### Fixed

- Preserve ordinary generic/comparison text and currency without misreading them as component tags or formulas.

## 0.4.1 (2026-10-25)

Compatible with 0.4.0; syntax remains `local-draft-2`, with `component-protocol-1` and `reactive-md-theme-1`. See [0.4.1 release notes](docs/release-0.4.1-en.md).

### Changed

- Refine light/dark document surfaces, visual hierarchy, muted chart colors and control transitions.
- Use rounded fields and buttons, custom slider tracks and circular selection controls. Slider `color` now colors the track.
- Balance full-width table columns, show triangle sort indicators and enlarge donut charts.
- Draw coordinate controls with a grid, arrow axes, dashed projections and a labeled draggable point. Keep keyboard and numeric input alternatives.
- Let quiz inputs fill their container and vertically center quiz content.

### Fixed

- Render LaTeX at the document body size, with black/white ink and non-overlapping piecewise conditions.
- Preserve source editor scroll after toolbar insertion and keep date inputs within narrow layouts.

## 0.4.0 (2026-10-24, next channel)

`0.4.0` is a 0.x preview available on both `latest` and `next`. It uses syntax revision `local-draft-2` and upgrades from `0.3.1` / `local-draft-1`; the package version, syntax revision, `component-protocol-1` component protocol and `reactive-md-theme-1` theme protocol are independent version axes. See [0.4.0 release and migration](docs/release-0.4.0-en.md) for the complete upgrade checklist.

### Fixed

- Keep the Playground toolbar on one row in compact desktop layouts with wider system fonts.
- Align source highlighting with the editor scroll position on first opening and give the source pane more vertical space.

### Added

- Add source highlighting, completion, binding navigation, rename and formatting APIs, with corresponding Playground author tools.
- Add dependency-aware rendering with browser equivalence checks for updates, resets, visual selections and locale changes.
- Add `npm run verify:release` and matching CI shards, including combined-feature documents and actual tarball consumers outside the repository. Retain the verified archive with SHA256 and npm integrity records.
- Add advisory cross-field `<validation>` rules with associated accessible hints and `runtime.validate()`. `alert` and `badge` accept conditional values from their existing tone enums.
- Add homogeneous string/numeric array literals, array indexing, `sum`, `average`, `minOf` and `maxOf`, plus `<data-table>`/`<column>` for bounded local row generation with stable keys. See [constraints and collections](docs/constraints-collections-en.md). `LocalValueKind` gains `number-array`; aggregate names become reserved identifiers.

- Add invisible, read-only `<computed>` and `<const>` declarations with dependency ordering, inferred types, cycle detection and per-runtime calculation caching. Prose, conditions, formulas and charts can share intermediate results.
- Add number, percentage, scientific and currency formatting, common string functions and UTC date comparison/differences. Defaults, rounding, nulls and accepted regions are specified in [Reusing calculations and formatting values](docs/computations-formatting-en.md). New function names are reserved; rename any existing bindings with those names before upgrading to this release.

- Add an optional `<!-- reactive-md: local-draft-2 -->` source revision directive. Explicit older, unknown, malformed, duplicate or misplaced revisions fail with `local.version.*` diagnostics and create no runtime; unversioned source keeps current-revision behavior. Readers built before the directive ignore it. See [Source revisions and migration](docs/source-versioning-en.md).
- Add `inspectLocalSourceVersion`, `checkLocalUpgrade` and `migrateLocalSource`, plus `reactive-md migrate` with `--from`, `--check`, `--json`, `-o/--output`, `--accept-semantic-changes` and `--locale`. Migration changes only the directive, preserves body bytes, BOM and CRLF, is idempotent, blocks reserved bindings, newly recognized tags, compile errors and text-length semantic changes, and never rewrites state files.

- Add a shared English/Chinese diagnostic catalogue and stable code meanings within a minor series. The Playground, React renderer and `lint --locale en|zh` localize displayed diagnostics while preserving machine fields.
- Make text-control length constraints count Unicode code points, matching string `len()`. Source positions and resource budgets keep UTF-16 units. Existing emoji values may now satisfy limits that previously rejected them. See [Diagnostics and counting rules](docs/diagnostics-counting-en.md).

- Add leading `<theme name="…">` declarations, host theme registration and the `reactive-md-theme-1` protocol. Both React components support independent color schemes and system preferences; `default` preserves the existing design. See the [theme protocol](docs/theme-protocol-en.md).
- Add shareable single-file HTML export: the `reactive-md build` and `reactive-md lint` CLI, interactive and static modes, static-first hydration, printable current values, versioned `reactive-md-state/v1` files, verified local raster inlining, the standalone `ReactiveMD.mount`/`mountAll` IIFE and `<reactive-md-doc>`. See [Shareable documents and static export](docs/shareable-export-en.md).
- Add host state APIs: name-based public parameter access on `LocalRuntime` (`parameterNames`, `getParameter`, `getParameters`, `setParameter`, `setParameters`) and `exportLocalState`/`importLocalState` for `reactive-md-state/v1` files. Writes validate before a single commit and leave state unchanged on failure.
- Add retention helpers for source changes: `planLocalStateRetention` and `applyLocalStateRetention` keep only public parameters whose type and initial definition are unchanged and whose bindings are safely retainable; anonymous `@` bindings, timers and positional checklists are dropped, and rejected values are reported with a reason.
- Add an optional background compile adapter: `LocalCompileScheduler` with a 150 ms debounce, one in-flight job plus the latest source, a permanent main-thread `compileLocal` fallback, and `startLocalCompileWorker`; fallback failures use the `local.worker.compile` diagnostic code.

### local-draft-2 components

- Add document jumps/anchors, text/section color, multiple selection, interval and coordinate inputs, practice questions and guided steps.
- Add checked-item strike-through, component accent colors and stable shared table/chart selection.
- Extend runtime get/set with optional slots and add atomic setMany. New slot bindings are exclusive.
- Add a bilingual feature tour and editor insertion templates. See [migration](docs/local-components-v2-en.md). The preview is published on the `next` channel.

- The Playground adds a Chinese/English toggle that localizes the interface, examples, guide and built-in control labels, and saves the choice in the browser.
- `LocalDocumentView` and `LocalReactiveDocument` accept `locale: 'en' | 'zh'` (default `'en'`) for built-in UI labels. Displayed compile and runtime diagnostics use the shared English/Chinese catalogue; callbacks still receive structured diagnostics with stable machine fields.
- `timeline` accepts either the English columns `Task`, `Start`, `Duration` and optional `Notes` or the Chinese columns `事项`, `开始`, `时长` and optional `说明`.

## 0.3.1 (2026-10-23)

Compatibility update that keeps the `local-draft-1` syntax; existing documents need no migration.

- The Playground adds a Markdown editing toolbar and insertion templates for 25 native components, with format state, undo/redo, search, keyboard navigation and a compact mobile layout.
- Large documents use background compilation, input coalescing and deferred storage; the syntax node budget can be configured through `limits.maxSyntaxNodes`.
- Unified the document theme and the heading/body hierarchy for components; improved diagram wrapping for long labels, edge captions and fallback styles.
- Added the `component-protocol-1` component contribution protocol, development proposal template, JSON Schema and representative acceptance cases, with `npm run test:components`; this protocol does not change the `local-draft-1` syntax or runtime API.
- Markdown headings generate per-instance anchors; in-document table-of-contents links support Chinese, formatted headings and duplicate headings; anchors stay stable after interactive updates.
- The Playground keeps compatible named parameters from the current editing session by default, with an option to turn retention off; trial state is restored after a temporary compile error is fixed, and reset when re-running, restoring an example, switching examples or importing a document.
- Structurally complete unknown tags are kept as source with a warning, while other prose and interactions keep working; tags and interpolations inside the fallback region are not executed.
- Footnote references and definitions keep their source text and produce a diagnostic that footnote layout is not yet supported.

## 0.3.0 (2026-10-22)

The first public preview, with syntax revision `local-draft-1`. Install: `npm install reactive-md@0.3.0`. See the [README](README.md) for integration steps.

### Added

- `local-draft-1` local interaction syntax: Markdown prose, 33 component names, `bind` parameters and `{{ expression }}` interpolation.
- Parameter controls, panel reset, conditional content, tabs, accordions, alerts, checklists, progress and timers.
- Enhanced tables, five chart types, LaTeX function curves, timelines and interactive diagrams.
- Core entry `reactive-md`: `compileLocal`, `createLocalRuntime`, `compileExpression`, `compileLatex`, `samplePlot` and `LOCAL_SYNTAX_VERSION`.
- React entry `reactive-md/react`: `LocalReactiveDocument`, `LocalDocumentView`, with host URL policy support.
- Global style entry `reactive-md/styles.css`, with light and `data-theme="dark"` theme variables.
- A beginner guide, the complete syntax specification, integration notes, version and compatibility notes, and 12 local examples (1 is an intentional diagnostics example).
- Checks for documentation, examples, package entries, browser interactions and resource limits; offline installation outside the repository, strict type checking for pure core and React, and static SSR verification.
- Copyable standalone Node/React integration examples, machine-readable language conformance data, performance benchmarks and a third-party license inventory.
- CI checks on Node 22.12/24 and Chromium pass; private vulnerability reporting is enabled.

### Compatibility

- First preview; there is no published npm version to upgrade from.
- Legacy directives and YAML `state`/`data`/`computed`/`actions` and event attributes are not part of `local-draft-1`; see [Versions and compatibility](docs/compatibility-en.md) for migration.
- Persist the original `.reactive.md` source; do not persist `LocalDocument`, node IDs or runtime state.
- Diagnostic `line`, `column` and `range` can be used for programmatic location; `code` is not promised to be stable across versions in 0.x; `message` is display text and not guaranteed stable.

### Known limitations

- ESM only; the React entry requires React 19; the core entry does not depend on React.
- Node.js 22.12+ is the minimum for development and Node-side consumption.
- Microsoft Edge (Chromium-based) has completed local browser verification; Firefox, Safari/WebKit and SSR hydration are unverified.
- No state persistence, plugin system, arbitrary HTML, network services, Vue support, React 18 support or CommonJS entry.

### Security

- Expressions and LaTeX use closed evaluators and do not execute scripts or arbitrary HTML.
- Images are not loaded by default; links and images pass protocol checks first, and hosts can tighten or allow them with `urlPolicy`.
- Documents, values, diagnostics and plotting computations all have resource limits. See the [security policy](SECURITY.md) for the security boundary and host responsibilities.
