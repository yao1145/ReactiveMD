# Versions and compatibility

Reactive MD is currently a 0.x preview. This page covers package versions, syntax versions, what can be persisted, the diagnostics contract and the current platform scope. See [Local mode integration](local-integration-en.md) for the public API and style integration.

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

Author-visible syntax changes establish a new syntax revision, such as `local-draft-2`, and raise the minor version and update `LOCAL_SYNTAX_VERSION`. Changes to the core or React API are also recorded in the changelog. The project does not rewrite sources automatically; after upgrading, authors or hosts migrate according to the record.

Legacy configuration syntax is not part of `local-draft-2`. Common replacements:

| Old form | What to do in `local-draft-2` |
| --- | --- |
| Directives such as `:::card`, `:::row` | Tags such as `<card>`, `<grid>` |
| YAML `state:` declaring parameters | `bind` and `initial` on controls |
| YAML `computed:` | `{{ expression }}` in the prose |
| `actions:`, button actions, `on-*` events | No equivalent entry point; use component built-in interactions and panel reset |
| `data:` or external API data | Markdown tables written directly in the prose; parameters are declared by controls |
| Persisted runtime state | The host saves the original source; document runtime state lives only in the current instance's memory |

## What to persist

Persist the original `.reactive.md` source. Do not persist `LocalDocument`, `LocalNode`, `node.id`, `initialState`, `LocalSnapshot` or runtime parameter state: they belong to the current runtime object and their structure and field meanings are not guaranteed across versions. `node.id` is regenerated when the source changes. Diagnostic line numbers, columns and offsets locate the current source and are not stable persistence identifiers.

## Diagnostics contract

`Diagnostic` contains `code`, `message`, `severity`, `range`, `line` and `column`.

- `line` and `column` start at 1; `range.start` and `range.end` are indexes into the current source string.
- `line`, `column` and `range` can be used for programmatic location and editor jumps.
- `code` is a string identifier, such as `local.type`, `expression-type` or `latex-plot-range`. Within a fixed package version it can be used for coarse classification; 0.x does not promise stability across versions, and minor versions may adjust codes.
- `message` is display text and may change at any time. Do not parse `message` or make business decisions based on its full text.
- `severity` is `warning` or `error`. Structurally complete unknown tags and footnotes keep their source and produce fallback warnings, and compilation can still succeed; compile errors make `result.ok` `false` and disable the preview. Runtime local errors affect only the corresponding content.

## Platforms and runtimes

| Environment | Current status |
| --- | --- |
| Node.js 22.12+ | Minimum for development and Node-side consumption; both 22.12 and 24 pass CI |
| ESM | The only module format; no CommonJS entry |
| React 19 | Required by `reactive-md/react`; the core entry does not depend on React |
| Microsoft Edge (Chromium-based) | Local browser verification completed |
| Playwright Chromium | Linux CI browser checks pass |
| Firefox, Safari/WebKit | Unverified; no support claim |
| SSR | `react-dom/server` static rendering is covered by the pre-release packed check; hydration is unverified and should be checked before use |

Node-side consumption means importing `reactive-md` in Node and calling `compileLocal` and `createLocalRuntime` without a DOM. React rendering requires a browser environment, or the host must handle server output itself.

See the [syntax specification](local-interaction-syntax-en.md) for the language scope, and the [security policy](../SECURITY.md) for the security boundary and host responsibilities.


See [local-draft-2 components and migration](local-components-v2-en.md) for new tags, colors and slot state. This checkout is unreleased.
