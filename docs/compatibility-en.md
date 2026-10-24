# Versions and compatibility

Reactive MD is currently a 0.x preview. This page covers package versions, syntax versions, what can be persisted, the diagnostics contract and the current platform scope. See [Local mode integration](local-integration-en.md) for the public API and style integration, and [0.4.0 development preview and migration](release-0.4.0-en.md) for this build's upgrade summary.

## Version mapping

| Item | Current value | Notes |
| --- | --- | --- |
| Package version | `0.4.0` | Unreleased; build this checkout |
| Syntax version | `local-draft-2` | `LOCAL_SYNTAX_VERSION`; the current build accepts only this revision |
| Component protocol | `component-protocol-1` | Contribution and acceptance contract, see [Component protocol](component-protocol-en.md); not a runtime version selection parameter |
| Core entry | `reactive-md` | Compilation, expressions and runtime, without loading React |
| React entry | `reactive-md/react` | `LocalReactiveDocument`, `LocalDocumentView` |
| Style entry | `reactive-md/styles.css` | One global stylesheet, explicitly imported by the host |

One package version corresponds to exactly one syntax revision. Before upgrading the package, record the `LOCAL_SYNTAX_VERSION` your application uses. If document sources come from another syntax revision, keep rendering them with the old package version or rewrite them according to the migration notes below. `compileLocal(source, options?)` has no syntax version parameter; hosts can adjust the syntax node budget for a single compilation through `options.limits.maxSyntaxNodes`, see [Local mode integration](local-integration-en.md).

## Compatibility rules for 0.x

- Minor versions (`0.3` to `0.4`) may contain breaking changes; patch versions contain only compatibility and security fixes.
- The 0.x phase does not promise a fixed deprecation period. Every breaking change is recorded in the [changelog](../CHANGELOG.md), with the old form, new form and migration steps.
- Before 1.0, treat every upgrade as potentially requiring changes to document sources or host code.
- Applications should pin the package version, keep the original `.reactive.md` sources, and rerun compile and render checks with their own documents and examples after upgrading.

## Breaking changes and migration

The same development build adds [constraints and collections](constraints-collections-en.md): `LocalRuntime.validate()`, serializable `LocalValidation` rules, numeric arrays and generated tables. Hosts implementing a runtime adapter need the new `validate()` method; exhaustive value-kind checks need `number-array`. Rename bindings colliding with `sum`, `average`, `minOf` or `maxOf`.

The unreleased `0.4.0` build adds [named calculations and formatting functions](computations-formatting-en.md). `computed`/`const` use the existing local tag syntax. The new built-in function names become reserved; rename colliding input bindings and their references before using this build. `document.bindings` and `initialState` still contain writable controls; snapshots also expose successful calculated values.

`0.4.0` establishes `local-draft-2`. Supported `local-draft-1` source remains valid, but the build now recognizes 15 additional tag names: the ten `local-draft-2` components plus `computed`, `const`, `validation`, `data-table` and `column`. Text that previously displayed as an unknown or literal tag now parses as a component or declaration; move literal examples into code spans or fences. The leading `<theme>` declaration is document metadata and is not counted as a component. See [0.4.0 development preview and migration](release-0.4.0-en.md) for the complete rename and upgrade checklist.

Author-visible syntax changes establish a new syntax revision, such as `local-draft-2`, and raise the minor version and update `LOCAL_SYNTAX_VERSION`. Changes to the core or React API are also recorded in the changelog. The project does not rewrite sources automatically; after upgrading, authors or hosts migrate according to the record.

Legacy configuration syntax is not part of `local-draft-2`. Common replacements:

| Old form | What to do in `local-draft-2` |
| --- | --- |
| Directives such as `:::card`, `:::row` | Tags such as `<card>`, `<grid>` |
| YAML `state:` declaring parameters | `bind` and `initial` on controls |
| YAML `computed:` | `{{ expression }}` in the prose |
| `actions:`, button actions, `on-*` events | No equivalent entry point; use component built-in interactions and panel reset |
| `data:` or external API data | Markdown tables written directly in the prose; parameters are declared by controls |
| Persisted runtime state | The host saves the original source. Public parameters may additionally be exported as a validated `reactive-md-state/v1` file; it is tied to the source digest, syntax revision and exact public parameter set and is not a document format. |

## What to persist

Persist the original `.reactive.md` source. A `reactive-md-state/v1` file may preserve public parameter values for the same source and syntax revision; it is rejected when the digest, revision or parameter set differs. Do not persist `LocalDocument`, `LocalNode`, `node.id`, `initialState`, `LocalSnapshot` or internal `@` runtime keys: they belong to the current runtime object and their structure and field meanings are not guaranteed across versions. `node.id` is regenerated when the source changes. Diagnostic line numbers, columns and offsets locate the current source and are not stable persistence identifiers.

## Diagnostics contract

`Diagnostic` contains `code`, `message`, `severity`, `range`, `line` and `column`.

- Lines and columns are one-based. Columns and half-open ranges count UTF-16 code units in the original source.
- `line`, `column` and `range` can be used for programmatic location and editor jumps.
- `code` is a string identifier, such as `local.type`, `expression-type` or `latex-plot-range`. Existing codes keep their meaning within one 0.x minor series. New codes may be added; removal, renaming or a change of meaning requires a new minor version and migration notes.
- `message` contains default English display text. Use `formatLocalDiagnostic(diagnostic, 'zh')` for Chinese. Wording may improve; do not parse messages or make business decisions based on their complete text. Language changes preserve machine fields.
- `severity` is `warning` or `error`. Structurally complete unknown tags and footnotes keep their source and produce fallback warnings, and compilation can still succeed; compile errors make `result.ok` `false` and disable the preview. Runtime local errors affect only the corresponding content.

See [Diagnostics and counting rules](diagnostics-counting-en.md) for units and resource-budget scopes.

## Platforms and runtimes

| Environment | Current status |
| --- | --- |
| Node.js 22.12+ | Minimum for development and Node-side consumption; CI targets both 22.12 and 24 |
| ESM | The only module format; no CommonJS entry |
| React 19 | Required by `reactive-md/react`; the core entry does not depend on React |
| Microsoft Edge (Chromium-based) | Local browser verification has used Edge |
| Playwright Chromium | Linux CI browser target |
| Firefox, Safari/WebKit | Unverified; no support claim |
| Shareable state format | `reactive-md-state/v1`: public parameter values with a syntax version and source digest; see [Shareable documents](shareable-export-en.md) |
| Single-file HTML format | `reactive-md-html/v1`: interactive or static export, with an inline standalone runtime only in interactive mode |
| SSR | `react-dom/server` static rendering is covered by the packed check. Static-first hydration of the single-file export is covered in Playwright Chromium/Edge; general SSR hydration is unverified and should be checked before use |

Node-side consumption means importing `reactive-md` in Node and calling `compileLocal` and `createLocalRuntime` without a DOM. React rendering requires a browser environment, or the host must handle server output itself.

See the [syntax specification](local-interaction-syntax-en.md) for the language scope, and the [security policy](../SECURITY.md) for the security boundary and host responsibilities.


See [local-draft-2 components and migration](local-components-v2-en.md) for new tags, colors and slot state, and [0.4.0 development preview and migration](release-0.4.0-en.md) for the upgrade checklist. This checkout is unreleased.
