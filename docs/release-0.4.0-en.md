# 0.4.0 preview and migration

Status: preview release on the `next` distribution channel. Package version `0.4.0`, syntax revision `local-draft-2`, component protocol `component-protocol-1`, theme protocol `reactive-md-theme-1`. These are separate version axes; `local-draft-2`, `component-protocol-1` and `reactive-md-theme-1` are not package versions.

Install the preview with `npm install reactive-md@next`, or pin it with `npm install reactive-md@0.4.0`. `0.3.1` remains the `latest` release.

This page summarizes what 0.4.0 contains, what changes for existing documents and hosts, and how to move from `0.3.1` / `local-draft-1`. Detailed rules remain in the linked reference pages; this page is the upgrade checklist. Explicit revision declarations and the migration tools are specified in [Source revisions and migration](source-versioning-en.md).

## Who should upgrade

- Authors who need named calculations, formatting, validation, collections, new input types, themes or offline HTML export.
- Hosts that can adopt `local-draft-2` and update exhaustive `LocalValueKind` checks, runtime adapters and state handling.
- Projects that pin `0.3.1` and only need `local-draft-1` can stay there; it remains the `latest` release. The build accepts one syntax revision and has no separate `local-draft-1` mode; unversioned source in supported old forms is read under `local-draft-2` rules, while an explicit `local-draft-1` declaration must be migrated first.

## What 0.4.0 contains

| Area | Included |
| --- | --- |
| Syntax | Ten `local-draft-2` components: `jump`, `anchor`, `text`, `section`, `multi-select`, `range-slider`, `coordinate`, `quiz`, `steps`, `step` |
| Source revisions | Optional `local-draft-2` directive, version inspection and upgrade checks, and single-source metadata migration |
| Calculations | Top-level `<const>` and `<computed>` declarations with dependency ordering, inferred types, cycle detection and per-runtime caching |
| Expressions | String and numeric array literals, indexing, `sum`/`average`/`minOf`/`maxOf`, number/percent/scientific/currency formatting, text functions and UTC date comparison/differences |
| Validation and data | Advisory `<validation>` rules, `runtime.validate()`, dynamic `alert`/`badge` tones, `<data-table>`/`<column>` row generation with stable keys |
| Appearance | `<theme name="…">`, host theme registration, document color schemes, component accent colors and completed-checklist styling |
| Diagnostics | Shared English/Chinese catalogue and localization in the renderer, Playground and CLI, with stable machine fields |
| Host state | Public parameter access by name, `exportLocalState`/`importLocalState`, retention helpers and optional Worker compilation |
| Export | `reactive-md build`/`lint`, interactive and static single-file HTML, versioned state files, verified local raster inlining, standalone `ReactiveMD.mount`/`mountAll` and `<reactive-md-doc>` |
| Author tools | Highlighting, completion, binding navigation, rename, formatting and `lint --locale en|zh` |
| Rendering | Dependency-aware rendering that avoids recomputing unaffected document subtrees |

The runnable examples are in the [example index](../examples/local/README.md), including the six bilingual feature tours, the invoice recipe and the workshop recipe. Every accepted tag name is listed in the [syntax specification](local-interaction-syntax-en.md#12-component-reference-and-syntax-scope).

## Upgrade from 0.3.1 / local-draft-1

Unversioned source in previously supported `local-draft-1` forms keeps its supported forms. The changes below still require a source and host review.

### Newly reserved identifiers

The new expression functions are reserved binding names. Rename any existing control binding with one of these names and update its references before upgrading:

`sum`, `average`, `minOf`, `maxOf`, `formatNumber`, `formatPercent`, `formatScientific`, `formatCurrency`, `trim`, `lower`, `upper`, `startsWith`, `endsWith`, `replace`, `slice`, `dateCompare`, `dateDiff`.

These join the existing reserved names: math and collection functions (`abs`, `sqrt`, `floor`, `ceil`, `round`, `min`, `max`, `pow`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `exp`, `log`, `len`, `contains`, `clamp`), the constants `pi` and `e`, the plot names `x` and `y`, the literals `true`, `false` and `null`, and `__proto__`, `prototype` and `constructor`. See [Reusing calculations and formatting values](computations-formatting-en.md#compatibility).

### Newly recognized tag names

The build now interprets these names as tags: `jump`, `anchor`, `text`, `section`, `multi-select`, `range-slider`, `coordinate`, `quiz`, `steps`, `step`, `computed`, `const`, `validation`, `data-table` and `column`.

Source that used one of these names as literal prose, or as an inert unknown-tag example, now parses as a component or declaration. Put literal examples inside code spans or fences, or escape the tag. Also check reserved identifiers and the behaviour changes below.

The leading `<theme name="…">` declaration is document metadata, not a component. It joins the same placement rule: one declaration before the body.

### Version declarations and migration

A source may declare `<!-- reactive-md: local-draft-2 -->` in its prologue. Unversioned source keeps current-revision behavior. An explicit `local-draft-1` or unknown revision is rejected with a `local.version.*` diagnostic and creates no runtime; declaring an old revision does not select an old parser.

`reactive-md migrate` or the pure core `migrateLocalSource` moves one source to `local-draft-2`. Migration replaces or adds only the metadata comment and preserves body bytes, BOM and CRLF. It blocks newly reserved bindings, newly recognized tags, current compile errors and text-control length changes before writing output. It does not rename identifiers or activate formerly inert tags. Completed checklist styling is a compatibility exception and does not block migration. Because migration changes the source digest, export fresh state files afterwards. Readers built before this declaration, including `0.3.1`, treat it as an ordinary comment and do not enforce the check, so migrate old documents first.

### Behaviour changes

- Completed checklist items are now struck through and muted, including `[x]` items in the initial state.
- `alert` and `badge` accept a dynamic `tone` expression within their existing enums.
- `table` and `chart` expose selection through `bind` when `key` names a stable identifier column. Existing tables without `key` keep renderer-local selection.
- Text-control `min-length` and `max-length` count Unicode code points, matching string `len()`. Values that previously failed because an emoji occupied two UTF-16 code units can now pass. Source positions and resource budgets still use UTF-16 units.
- `document.bindings` and `document.initialState` still describe writable controls. `runtime.snapshot().state` also contains successful named calculation results. Do not assume the snapshot contains controls only.
- `LocalValueKind` gains `number-array`; `LocalValue` gains `number[]`. Writable checklist and multi-select controls still produce string arrays.
- Custom runtime adapters need `validate()`; multi-slot controls use `get(node, slot?)`, `set(node, value, slot?)` and `setMany(node, values)`.
- State files carry `syntax: "local-draft-2"` and a source digest. A file is rejected when either the revision, digest or exact public parameter set differs.
- Displayed diagnostics are localized through the shared catalogue; callbacks still receive structured diagnostics. `message` remains display text, not an API.

## Upgrade checklist

1. Install `0.4.0` from `next` or pin `0.4.0`, keep the original `.reactive.md` sources and record `LOCAL_SYNTAX_VERSION`.
2. Run `reactive-md migrate <file> --check` or `migrateLocalSource` on each source. Unversioned historical documents need `--from local-draft-1`; resolve every reported blocker before writing output.
3. Search prose and examples for the 15 newly recognized tag names outside code regions; escape them or move them into code.
4. Search `bind`, `bind-start`, `bind-end`, `bind-x` and `bind-y` values for the 17 newly reserved identifiers; rename the bindings and their references. The core `renameLocalBinding` helper and the editor rename action update declarations, expression references and plot parameters together.
5. Recompile every document and fix new placement or structure diagnostics, especially top-level `computed`/`const`, `validation`, `data-table`/`column`, `steps`/`step` and `quiz`.
6. Update hosts for `number-array`, `validate()`, slot APIs and snapshots that include calculated values.
7. Recheck state import/export, retention and any HTML export inside the host. Migration changes the source digest; export fresh state files.
8. Check the visible changes: checklist completion styling, table/chart selection and theme CSS.
9. Run the [release verification gate](../CONTRIBUTING.md) and your own document and browser checks.

## Verification scope

The `0.4.0` build targets Node.js 22.12 and Node 24; its CI gate uses Playwright Chromium and local checks use Microsoft Edge. `npm run verify:release` is the complete release gate: it covers core and demo tests, types, package and documentation checks, packed consumption outside the repository, and the browser checks for calculations, collections, authoring, state restoration, HTML export and rendering equivalence. Individual commands remain in the [contributing guide](../CONTRIBUTING.md).

Static SSR is covered by the packed check. Single-file export static-first hydration is covered by the Playwright Chromium and local Edge checks. General SSR hydration outside that path, Firefox and Safari/WebKit are unverified and are not claimed as supported.

Use [Versions and compatibility](compatibility-en.md) for the version rules and diagnostics contract, [Source revisions and migration](source-versioning-en.md) for the directive and migration tools, [Shareable documents and static export](shareable-export-en.md) for the HTML and state formats, and [local-draft-2 components and migration](local-components-v2-en.md) for the component additions.
