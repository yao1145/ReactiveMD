# Language conformance data

[local-draft-2.json](local-draft-2.json) is a copyable minimal semantic conformance suite containing source documents, compilation results, initial parameters, state writes and expected text. The data is distributed with the npm package so other tools or implementations can read the same JSON.

- `syntaxVersion` matches the core export `LOCAL_SYNTAX_VERSION`.
- `ok` is the expected compilation result; `codes` is the deduplicated set of expected diagnostic codes, and when omitted no diagnostics are expected. A successful compile can still contain degradation warnings.
- `initial` checks the initial values of public parameters; `bindingNames`, when present, checks the complete set of binding names.
- `actions` finds controls by `bind` and submits `value`; when `codes` is present the write is expected to be rejected, otherwise it is expected to succeed.
- `text` is evaluated with the updated state and the result should equal `expectedText`.

The runner lives at `tests/conformance.test.ts` in the repository; run `npm test` to check it. This suite covers shared parameters, hidden initialization, write constraints, code isolation, diagnostics, multi-slot controls, multiple selection, generated-table selection and a computed-value aggregate recalculation. It does not cover validation hints, generated table rendering, HTML export, author tooling or browser behavior; those have dedicated tests and the release gate. Full syntax conformance also includes other language tests and browser checks, with rules in the [syntax specification](../../docs/local-interaction-syntax-en.md). See the [compatibility notes](../../docs/compatibility-en.md) for cross-version guarantees on diagnostic codes.

## Component protocol conformance

[component-protocol-1.json](component-protocol-1.json) provides representative cases for the [component protocol](../../docs/component-protocol-en.md), covering `slider`, `tabs`, `plot` and lazy degradation of unknown components. The [JSON Schema](component-protocol-1.schema.json) defines the conformance file format so tools from other implementations can read it. This JSON is test input and expected results; see the [development guide](../../docs/component-development-en.md) for the declaration template of a component proposal.

```sh
npm run test:components
```

That command runs the component protocol cases and the existing language conformance data. A new component should add its own cases, unit tests and affected renderer checks; passing this suite only proves these specific cases pass.

### File and case fields

The file root object contains `protocolVersion`, `syntaxVersion` and a non-empty `cases` array. Currently these are `component-protocol-1` and `local-draft-2`. The package version is identified separately by `package.json` and is not inferred from these two fields.

| Field | Rule |
| --- | --- |
| `id` | Required, unique within the file; describes one observable behavior |
| `component` | Required, names the component primarily under test; the source may use other components too |
| `source` | Required, the original document source |
| `ok` | Required, whether compilation is expected to succeed |
| `codes` | Required, the deduplicated set of compilation diagnostic codes; `[]` when there are none, order ignored, the set compared exactly |
| `initial` | Optional, initial state expectations after successful compilation, partially matched by the given keys |
| `bindingNames` | Optional, the complete set of public binding names; excludes internal state keys of anonymous components |
| `actions` | Optional, writes to named bindings in order; each entry requires `bind`, `value`, `codes` and may include `expectedState` |
| `reset` | Optional, resets the named node after the writes; requires `component` and `expectedState`, `index` defaults to the 0th in source order among components with that name |
| `text`, `expectedText` | Optional, must be paired; evaluated after writes and reset with the result compared exactly |
| `htmlIncludes`, `htmlExcludes` | Optional, performs React static rendering in the final state and checks each listed fragment is present or absent |

`initial` and `expectedState` values use the language's existing `LocalValue`: a string, finite number, boolean, `null` or string array. Public writable controls do not produce numeric arrays; numeric arrays are available to expressions and computed values. `actions[].codes` is the set of diagnostic codes returned by that write; still write `[]` when there are none. A rejected write should keep the last valid state. The runner finds compiled controls by `bind` and calls `runtime.set`; it does not simulate browser input events.

Execution order is fixed: validate the data format and unique IDs, compile and compare diagnostics, check the initial state and public binding names, perform writes in order, then reset, and finally check text and optional rendering results. Every created runtime is disposed at the end. Cases with `ok: false` may only use compile-time fields and cannot add state, action or rendering expectations; unknown fields, missing fields and invalid values should fail conformance.

`reset` calls `runtime.reset(node)` on the current instance; nodes are found by component name and index, and the conformance file does not store `node.id`. This check verifies runtime reset semantics; clicking a reset button still needs a renderer or browser check.

### Portable scope

Compilation results, diagnostic sets, state changes and expression text are portable semantic expectations. HTML fragments only check this repository's React reference renderer; other renderers should verify equivalent user behavior and need not generate the same DOM or CSS class names.

These cases do not prove real keyboard operation, focus movement, Chinese input methods, 375px layout, timer pause, or timer cleanup after disposal. Contributions involving those behaviors still need corresponding browser evidence; see the [development guide](../../docs/component-development-en.md) for verification methods. Cross-version stability of diagnostic codes continues to follow the [compatibility notes](../../docs/compatibility-en.md).
