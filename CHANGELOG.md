# Changelog

This file records user-visible changes. The project is in a 0.x preview; version and migration rules are in [Versions and compatibility](docs/compatibility-en.md).

## Unreleased

- Add advisory cross-field `<validation>` rules with associated accessible hints and `runtime.validate()`. `alert` and `badge` accept conditional values from their existing tone enums.
- Add homogeneous string/numeric array literals, array indexing, `sum`, `average`, `minOf` and `maxOf`, plus `<data-table>`/`<column>` for bounded local row generation with stable keys. See [constraints and collections](docs/constraints-collections-en.md). `LocalValueKind` gains `number-array`; aggregate names become reserved identifiers.

- Add invisible, read-only `<computed>` and `<const>` declarations with dependency ordering, inferred types, cycle detection and per-runtime calculation caching. Prose, conditions, formulas and charts can share intermediate results.
- Add number, percentage, scientific and currency formatting, common string functions and UTC date comparison/differences. Defaults, rounding, nulls and accepted regions are specified in [Reusing calculations and formatting values](docs/computations-formatting-en.md). New function names are reserved; rename any existing bindings with those names before using this development build.

- Add leading `<theme name="…">` declarations, host theme registration and the `reactive-md-theme-1` protocol. Both React components support independent color schemes and system preferences; `default` preserves the existing design. See the [theme protocol](docs/theme-protocol-en.md).

### 0.4.0 development preview (local-draft-2)

- Add document jumps/anchors, text/section color, multiple selection, interval and coordinate inputs, practice questions and guided steps.
- Add checked-item strike-through, component accent colors and stable shared table/chart selection.
- Extend runtime get/set with optional slots and add atomic setMany. New slot bindings are exclusive.
- Add a bilingual feature tour and editor insertion templates. See [migration](docs/local-components-v2-en.md). No release has been published.

- The Playground adds a Chinese/English toggle that localizes the interface, examples, guide and built-in control labels, and saves the choice in the browser.
- `LocalDocumentView` and `LocalReactiveDocument` accept `locale: 'en' | 'zh'` (default `'en'`) for built-in UI labels; compiler and runtime diagnostic messages remain English.
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
