# Changelog

**English** · [中文](CHANGELOG-ch.md)

## Unreleased

Parser, state restoration and incremental editing edge cases, with no protocol or API change.

### Fixed

- Unescape `\|` inside GFM table cells on the fast Markdown path as well as the remark path, so `{{ a \|\| b }}` compiles inside a table.
- Follow the Markdown parse in lexical shielding: a backtick in a fence info string no longer opens a fence, indented code inside a container is no longer scanned for interpolations, tags or renames, image alt text keeps its source text instead of private-use markers, and text at the list marker column after a blank line closes the list level.
- Decode basic HTML attributes with attribute-value rules: a legacy named reference without `;` stays literal before `=` or an alphanumeric (`href="?a=1&copy=2"`), the first duplicate attribute wins while duplicates are still validated, and NUL becomes U+FFFD on every path.
- Validate a restored state file against the whole parameter set in one atomic write, so a constraint that reads another parameter no longer depends on declaration order; the retention fallback repeats its pass until it stops accepting values.
- Keep a value that a dynamic constraint has narrowed out of range across unrelated document edits in live preview; a changed constraint definition or value rule still revalidates and falls back to the new initial value.
- Decide the sign of zero from the rounded result, so a value within one decimal rounding step of zero no longer prints `-0.0000`.
- Skip the dependents of a constant that failed static evaluation instead of reporting a second, misleading "Variable ... is not declared" diagnostic.
- Report unknown-reference and const-violation diagnostics at the identifier token rather than at the first textual match, which could sit inside a string literal.
- Truncate diagnostic, state-sample, chart-label and CLI text without leaving an unpaired high surrogate.

### Changed

- An incremental editing session validates the boundaries next to a recompiled block against the local parser and falls back to a full compile when they disagree, so a session result always matches `compileLocal`. Sources with a lone `\r`, or a context block followed directly by Markdown, always use the full path.
- Block planning keeps ambiguous inputs on the general parser: a bare `1.` / `2)`, lazy continuation after a fast list, interruption after a masked paragraph, lists Lezer ends early, loose lists joined across masked lines, indented code, and lists ending in an empty item. Those edge inputs now parse as remark does.
- A container that may contain indented code makes one extra Markdown parse of its body; plain containers do no extra work.

### Compatibility

- No syntax, component or state protocol change. `local-draft-3`, `component-protocol-3`, `reactive-md-theme-1` and `reactive-md-state/v1` are unchanged.

## 0.8.0 (2026-11-12, latest channel)

The release splits the editor into `reactive-md-editor` and the Demo into independent repositories. Replace `reactive-md/editor` imports with `reactive-md-editor`. Add one-shot compiler entries, strict/local recovery and HTML details mapping. Package, syntax and data protocols retain independent versioning.

### Added

- Add `reactive-md/compiler` and `reactive-md/compiler/standard`. The minimal entry registers no components; the standard entry installs the default preset and the KaTeX display checks. Both return plain data, enforce source, expression, structure and budget limits, and use `status: 'valid' | 'recovered' | 'failed'` results while keeping the existing `ok` and `document` read path.
- Add `strict` and local recovery to compiler factories, `compileLocal`, editing sessions and Workers. Strict mode remains the default. With `strict: false`, a damaged region stays as literal source, each finalized recovery produces one stable warning, and compilation resumes at the next reliable boundary. Both modes map a blank-line-free `<details>` / `<summary>` fragment to one disclosure.
- The Vite adapter discovers `theme/<folder>/theme.css` (optional `theme.json`) and `plugin/<folder>/index.*` (optional `component.css`) under the Vite root when `reactiveMd()` has no `extensions` module. Discovered local CSS and assets are resolved and inlined through the bounded build-resource collector.
- Default charts give each bar its own hover and focus target, show each visible donut slice's share in the legend, and let legend items toggle series or slices. Bars, lines, points and arcs animate geometry changes, with reduced-motion preferences respected.
- Refine default-theme UI: fit function plots to their axis ranges with square screen-space grids, let tooltip layers escape nested clipping, restore primary-button text contrast, align Jump buttons with standard buttons and add brief selection feedback to interactive options.
- Add `<gallery>` and `<gallery-item>` to the default preset, layout pack and insertion catalog: mixed images/cards/Markdown, native mandatory snapping, wheel/keyboard/thumb navigation, h3 captions and complete static output.
- Default-theme diagrams show node notes in hover/focus popovers, with zoom/fit controls, related-path highlighting, full-frame status colors and long-label handling. Static output retains all node descriptions.
- `reactive-md/runtime`: document and component identity, serializable seeded randomness, injected clock/scheduler, and the component-state protocol with budgets.
- `reactive-md/react/runtime`: `useTicker`, `useFrame`, `useSwipe`, `useKeys` and `useComponentState`.
- `reactive-md/runtime/browser`: a Web Storage persistence backend; the component-state registry accepts any `LocalComponentStateStorage` and persists after save or clear. Pass `componentStateWriteDelayMs` to coalesce high-frequency saves; `state.flush()` writes pending state, and `flushComponentStateOnPageHide` flushes on `pagehide` and `visibilitychange`. Runtime disposal also flushes pending state; a failed backend keeps the latest state pending so the next save, flush or disposal retries it.
- `reactive-md build` gains `--component-state-file`, `--document-id` and `--random-seed`. Interactive exports embed the validated component-state sidecar in the auto-mount payload; static output rejects it.
- `LocalRuntimeOptions` accepts `documentId`, `randomSeed`, `componentState` and injected `services`; `LocalReactiveDocument` exposes matching props plus `onComponentStateChange`.
- Component contexts gain `services.random`, `services.clock`, `services.scheduler` and `services.state`. Random state stays saveable and replayable; the scheduler handles page visibility.
- The Tetris example uses `useTicker`; the 2048 example uses `useSwipe`.
- Add `examples/sci-fi-theme`: a hard-sci-fi theme package with three-layer tokens, light/dark modes, component styling for panels, tables, forms, navigation and chart containers, a live gallery, design specification and screenshot verification.
- The default theme renders interactive `<coordinate>` and `<plot>` with Mafs: draggable snapped points, pan and zoom, click-to-focus curves with dimmed backgrounds, and a pointer-tracked point on the focused curve. Server rendering, static export and print keep the existing SVG output.

### Removed

- Remove `reactive-md/editor`, `reactive-md/editor/codemirror` and their stylesheet exports. Install `reactive-md-editor@0.1.0` and use `reactive-md-editor`, `reactive-md-editor/codemirror` and the matching stylesheets. Published 0.7 packages keep the old entries.

### Compatibility

- The engine and editor publish separately. Publish `reactive-md@0.8.0` first, then `reactive-md-editor@0.1.0`.
- `0.8.0` keeps syntax `local-draft-3`, `component-protocol-3`, `reactive-md-theme-1`, `reactive-md-state/v1` and the `0.7.0` SDK contract. Document sources and state files need no migration for this package update.
- The new services are additive; existing components can ignore them. Component state uses a separate `reactive-md-component-state/v1` sidecar and does not change `reactive-md-state/v1`.
- Cross-edit restore requires an explicit `state-key`; without it, restore is limited to the same source and session.

## 0.7.0 (2026-10-31, latest and next channels)

See the [0.7.0 release notes](docs/releases/release-0.7.0-en.md). Syntax revision `local-draft-3` and component protocol `component-protocol-3` replace their previous revisions; theme protocol `reactive-md-theme-1` is unchanged.

### Added

- Add `<external>` read-only declarations. Hosts supply `externalValues` through `LocalReactiveDocument` or `runtime.setExternalValues()`; missing values fail only dependent expressions and are never converted to `0`, `false` or an empty string.
- Add dynamic `min`, `max` and `required` constraints on number, slider, date, input and textarea controls. Constraints are checked on write and display; invalid stored values are reported, not clamped.
- Publish the extension SDK entries: `reactive-md/sdk`, `/vite`, `/build`, `/testing`, `/testing/react`, `/testing/browser`, `/authoring`, `/export`, `/standalone` and `/react/server`.
- Add `defineLocalComponent`, `defineReactComponentPackage`, `createLocalConfig`, `createReactConfig`, `createReactHost`, `defineLocalTheme`, `composeLocalTheme` and the `reactiveMd({ extensions })` Vite adapter.
- Add manifest-derived authoring catalogs, component/theme packages, offline build and restoration, compliance tools and configuration-mismatch diagnostics.
- Add component package examples for `<tetris>` and `<game-2048>`, installed as committed npm tarballs in the Demo.

### Changed

- Use CM6 as the only source editor at `reactive-md/editor`; retain `/editor/codemirror` as an alias sharing the same runtime and styles. Remove `textareaRef` and `getTextarea`; use the editor ref for source, selection and DOM access. Document textarea controls remain supported. Add preview-to-source navigation.
- Migrate the 46 default components to the public extension contract; external and default components share the same validator, compiler and renderer.
- `component-protocol-3` adds host inline/container forms and scalar bindings. Legacy `hostComponents`, `hostRenderer` and `hostData` remain available for migration.
- Reuse flat list/table row plans and unchanged node identities across edits, including documents containing a single large list or table. Keep shifted UTF-16 ranges accurate and count plan reuse separately from node reuse.
- Return a complete successful Worker result when a result patch costs too much, retaining the negotiated revision chain. Copy short inline-cache strings so they cannot retain old full document strings.
- Consolidate performance history, current measurements and reproduction commands into the [performance overview](docs/development/performance-overview-en.md).

### Compatibility

- Explicit `local-draft-1` and `local-draft-2` declarations are rejected. Migrate with `reactive-md migrate`, or keep rendering with the old package version.
- Migration from `local-draft-2` blocks newly active `<external>` tags; move literal examples into code first.
- `LOCAL_SDK_VERSION` changes the configuration key. Documents carrying an old `componentConfigKey` report `local.extension.config-mismatch` and must be recompiled.
- The editor textarea ref fields are removed. Use `getSource()`, `getSelection()`, `selectRange()` and `getEditorElement()`.
- Migration changes the source digest; export a fresh `reactive-md-state/v1` file afterwards.

## 0.6.1 (2026-10-27, latest and next channels)

- Typeset formulas with KaTeX HTML and accessible MathML, retaining the original LaTeX annotation and mhchem chemistry.
- Embed WOFF2 math fonts for offline preview, printing and static or interactive HTML exports. Match inline baselines, wrap inline math and reserve space for tags beside scrolling display formulas.
- Share KaTeX support detection between compilation and display. Support additional environments and style commands; invalid formulas fall back to bounded source text with source-ranged warnings.
- Keep plot evaluation and protocol revisions unchanged. `align` now numbers rows; use `align*` or `aligned` for unnumbered alignment.

See the [0.6.1 release notes](docs/releases/release-0.6.1-en.md) for installation and compatibility details.

## 0.6.0 (2026-10-27, latest and next channels)

See [0.6.0 release notes](docs/releases/release-0.6.0-en.md). Syntax revision `local-draft-2`, component protocol `component-protocol-2` and theme protocol `reactive-md-theme-1` are unchanged.

### Added

- Add native HTML tables to the default P0 HTML path, including `caption`, `colgroup`, `colspan`, `rowspan`, `scope`, `headers` and shared table styling. No extended HTML switch is needed.
- Add static `align` on `div`, `p` and headings, and `target`/`rel` on links with safe handling for `_blank`.
- Add `\(...\)` and `\[...\]` math delimiters, the `aligned`, `align`, `align*`, `pmatrix`, `bmatrix` and `vmatrix` environments, `\tag`, additional alphabets, arrows, delimiter sizes and functions, and mhchem `\ce{...}`.
- Add `cattca`, `mermaid` and `vue` fenced-code highlighting.
- Lay out node/edge diagrams with ELK layered routing while keeping the deterministic synchronous first paint.
- Add `insertText(text)` to the editor ref handle.

### Changed

- Return only plain objects and arrays from `compileLocal` so results can cross a React Server Components boundary.
- Clamp tooltips to the viewport, reposition them on scroll, resize and content changes, and follow document themes.
- Use `aria-required` and local validation instead of the native `required` attribute so required controls do not block host form submission.
- Unparseable native HTML now falls back to inert source instead of failing the document; add `local.html.fallback` and `local.html.fallbackAttribute` warnings.
- Add two bundled dependencies, `elkjs` and `mhchemparser`, and update `THIRD_PARTY_NOTICES.md`.

## 0.5.3 (2026-10-26, next channel)

See [0.5.3 release notes](docs/releases/release-0.5.3-en.md). Syntax and protocol revisions are unchanged.

- Add opt-in `markdownBreaks` across compilation, rendering, workers and cache keys while preserving source ranges.
- Add an unstyled React entry, screen CSS and optional print CSS; remove global `@page` from screen styles.
- Export `localCompileOptionsKey` and `LocalRenderContext`, and add the React-free `reactive-md/authoring` entry.
- Accept preview compile options in analysis, completion, rename and formatting.
- Report source-ranged diagnostics when display math falls back for unsupported commands, environments or budgets.


This file records user-visible changes. The project is in a 0.x preview; version and migration rules are in [Versions and compatibility](docs/compatibility/compatibility-en.md).

## 0.5.2 (2026-10-26, next channel)

Compatible with 0.5.1. Syntax remains `local-draft-2`, the component protocol is `component-protocol-2` and the theme protocol is `reactive-md-theme-1`. See [0.5.2 release notes](docs/releases/release-0.5.2-en.md).

### Added

- Add an opt-in host component extension axis: `compileLocal(source, { hostComponents })` registers leaf tag schemas for one compilation. Registered tags become `hostComponent` nodes; invalid schemas return `local.options.invalid` and invalid attributes return `local.host.attribute`. A valid host node counts as one syntax node.
- Add `hostData` and `hostRenderer` to `LocalDocumentView` and `LocalReactiveDocument`. Host data is keyed `${kind}:${ref}`; a missing renderer, missing data or throwing renderer renders a visible placeholder. `mode="static"` uses the same dispatch.
- Export `LocalHostComponentSchema`, `LocalHostPropSchema` and `LocalHostPropKind`, and carry schemas through the compile worker without sending the renderer or host data.

### Security

- Restrict host `pattern` to a linear-time-safe regex subset, apply the shared string-length budget to host attributes, bound oversized schema arrays before scheduling, reject P0 HTML tag names as host names, and keep option signatures collision-free for BigInt or cyclic schema metadata.

### Changed

- Raise the component protocol to `component-protocol-2`. The syntax revision and the 48 author components are unchanged; the frozen `component-protocol-1.json` conformance baseline still applies to author components.

## 0.5.1 (2026-10-25, next channel)

Compatible with 0.5.0. Syntax remains `local-draft-2`, with `component-protocol-1` and `reactive-md-theme-1`. See [0.5.1 release notes](docs/releases/release-0.5.1-en.md).

### Added

- Add P0 HTML compatibility to the default ReactiveMD rendering path, including rich disclosures, containers, headings, code, lists, links and images.
- Add host-owned `enableCss`, `enableJavaScript` and `enableExtendedHtml` options, all off by default. Any enabled option routes the entire document to isolated native HTML. This temporary routing policy disables Markdown and ReactiveMD interpretation in that path; see [HTML compatibility](docs/reference/html-compatibility-en.md).
- Add localized Demo controls and preserve HTML mode in export. Static export disables author JavaScript.
- Add a built-in editor status bar with Unicode character count, a keyboard hint and Edit, Split and Preview views. The host supplies preview content. View changes keep the source selection, undo history and preview state.
- Narrow editor containers offer only Edit and Preview, and source-only editors keep the count and keyboard hint.

### Changed

- The editor source surface, gutter, syntax highlighting, toolbar and menus now follow the editor light, dark or automatic theme instead of staying on a fixed dark background.

## 0.5.0 (2026-10-25, next channel)

Compatible with 0.4.1. Syntax remains `local-draft-2`, with `component-protocol-1` and `reactive-md-theme-1`. Existing `reactive-md`, `reactive-md/react` and `reactive-md/styles.css` imports are unchanged, and the renderer entry keeps its API. See [0.5.0 release notes](docs/releases/release-0.5.0-en.md).

### Added

- Add `reactive-md/editor`, a controlled React 19 source editor extracted from the Playground, with the independent style entry `reactive-md/editor/styles.css`. It provides highlighting, formatting and insertion tools, completion, binding navigation, rename, format, undo and redo, line numbers and scroll synchronization. Locale and theme are set per instance; `diagnostics` and `document` add gutter markers and binding value types. The host owns preview, persistence and export.
- Support attribute-free `<b>`, `<i>`, `<u>`, `<s>`, `<mark>` and `<br>` formatting.
- Render Markdown footnotes with rich definitions, numbering, repeated references and return links.
- Highlight fenced code in common languages and copy its exact source with localized feedback. Approved images open in a keyboard-accessible modal viewer.

### Fixed

- Preserve ordinary generic/comparison text and currency without misreading them as component tags or formulas.

## 0.4.1 (2026-10-25)

Compatible with 0.4.0; syntax remains `local-draft-2`, with `component-protocol-1` and `reactive-md-theme-1`. See [0.4.1 release notes](docs/releases/release-0.4.1-en.md).

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

`0.4.0` is a 0.x preview available on both `latest` and `next`. It uses syntax revision `local-draft-2` and upgrades from `0.3.1` / `local-draft-1`; the package version, syntax revision, `component-protocol-1` component protocol and `reactive-md-theme-1` theme protocol are independent version axes. See [0.4.0 release and migration](docs/releases/release-0.4.0-en.md) for the complete upgrade checklist.

### Fixed

- Keep the Playground toolbar on one row in compact desktop layouts with wider system fonts.
- Align source highlighting with the editor scroll position on first opening and give the source pane more vertical space.

### Added

- Add source highlighting, completion, binding navigation, rename and formatting APIs, with corresponding Playground author tools.
- Add dependency-aware rendering with browser equivalence checks for updates, resets, visual selections and locale changes.
- Add `npm run verify:release` and matching CI shards, including combined-feature documents and actual tarball consumers outside the repository. Retain the verified archive with SHA256 and npm integrity records.
- Add advisory cross-field `<validation>` rules with associated accessible hints and `runtime.validate()`. `alert` and `badge` accept conditional values from their existing tone enums.
- Add homogeneous string/numeric array literals, array indexing, `sum`, `average`, `minOf` and `maxOf`, plus `<data-table>`/`<column>` for bounded local row generation with stable keys. See [constraints and collections](docs/reference/constraints-collections-en.md). `LocalValueKind` gains `number-array`; aggregate names become reserved identifiers.

- Add invisible, read-only `<computed>` and `<const>` declarations with dependency ordering, inferred types, cycle detection and per-runtime calculation caching. Prose, conditions, formulas and charts can share intermediate results.
- Add number, percentage, scientific and currency formatting, common string functions and UTC date comparison/differences. Defaults, rounding, nulls and accepted regions are specified in [Reusing calculations and formatting values](docs/reference/computations-formatting-en.md). New function names are reserved; rename any existing bindings with those names before upgrading to this release.

- Add an optional `<!-- reactive-md: local-draft-2 -->` source revision directive. Explicit older, unknown, malformed, duplicate or misplaced revisions fail with `local.version.*` diagnostics and create no runtime; unversioned source keeps current-revision behavior. Readers built before the directive ignore it. See [Source revisions and migration](docs/compatibility/source-versioning-en.md).
- Add `inspectLocalSourceVersion`, `checkLocalUpgrade` and `migrateLocalSource`, plus `reactive-md migrate` with `--from`, `--check`, `--json`, `-o/--output`, `--accept-semantic-changes` and `--locale`. Migration changes only the directive, preserves body bytes, BOM and CRLF, is idempotent, blocks reserved bindings, newly recognized tags, compile errors and text-length semantic changes, and never rewrites state files.

- Add a shared English/Chinese diagnostic catalogue and stable code meanings within a minor series. The Playground, React renderer and `lint --locale en|zh` localize displayed diagnostics while preserving machine fields.
- Make text-control length constraints count Unicode code points, matching string `len()`. Source positions and resource budgets keep UTF-16 units. Existing emoji values may now satisfy limits that previously rejected them. See [Diagnostics and counting rules](docs/reference/diagnostics-counting-en.md).

- Add leading `<theme name="…">` declarations, host theme registration and the `reactive-md-theme-1` protocol. Both React components support independent color schemes and system preferences; `default` preserves the existing design. See the [theme protocol](docs/reference/theme-protocol-en.md).
- Add shareable single-file HTML export: the `reactive-md build` and `reactive-md lint` CLI, interactive and static modes, static-first hydration, printable current values, versioned `reactive-md-state/v1` files, verified local raster inlining, the standalone `ReactiveMD.mount`/`mountAll` IIFE and `<reactive-md-doc>`. See [Shareable documents and static export](docs/integration/shareable-export-en.md).
- Add host state APIs: name-based public parameter access on `LocalRuntime` (`parameterNames`, `getParameter`, `getParameters`, `setParameter`, `setParameters`) and `exportLocalState`/`importLocalState` for `reactive-md-state/v1` files. Writes validate before a single commit and leave state unchanged on failure.
- Add retention helpers for source changes: `planLocalStateRetention` and `applyLocalStateRetention` keep only public parameters whose type and initial definition are unchanged and whose bindings are safely retainable; anonymous `@` bindings, timers and positional checklists are dropped, and rejected values are reported with a reason.
- Add an optional background compile adapter: `LocalCompileScheduler` with a 150 ms debounce, one in-flight job plus the latest source, a permanent main-thread `compileLocal` fallback, and `startLocalCompileWorker`; fallback failures use the `local.worker.compile` diagnostic code.

### local-draft-2 components

- Add document jumps/anchors, text/section color, multiple selection, interval and coordinate inputs, practice questions and guided steps.
- Add checked-item strike-through, component accent colors and stable shared table/chart selection.
- Extend runtime get/set with optional slots and add atomic setMany. New slot bindings are exclusive.
- Add a bilingual feature tour and editor insertion templates. See [migration](docs/reference/local-components-v2-en.md). The preview is published on the `next` channel.

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
- Legacy directives and YAML `state`/`data`/`computed`/`actions` and event attributes are not part of `local-draft-1`; see [Versions and compatibility](docs/compatibility/compatibility-en.md) for migration.
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
