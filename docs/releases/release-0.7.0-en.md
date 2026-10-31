# 0.7.0 release

`reactive-md@0.7.0` moves both `latest` and `next` to the first release that ships the public extension SDK, the `local-draft-3` syntax revision and the CM6-only editor. It also includes a large compilation and rendering performance round. Existing imports keep working, but documents with an explicit older revision and host integrations using removed editor fields need the migration steps below.

```sh
npm install reactive-md
# or pin the version
npm install reactive-md@0.7.0
```

For offline installation, use the [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.7.0.tgz).

## Syntax: local-draft-3

`local-draft-3` is the only accepted revision in this build. Sources without a revision directive keep current-revision behavior. An explicit `local-draft-1` or `local-draft-2` declaration is rejected with a `local.version.*` diagnostic, and an old declaration does not select an old parser.

- Add `<external name="..." type="...">` read-only declarations. Text, conditions, charts and calculations may read host values supplied through `externalValues` on `LocalReactiveDocument` or `runtime.setExternalValues()`. A missing value fails only the expressions that read it; it is never converted to `0`, `false` or an empty string.
- Add dynamic `min`, `max` and `required` constraints on `number`, `slider`, `date`, `input` and `textarea`. Constraints are checked when a value is written and when the control is displayed. Narrowing a range keeps the stored value and shows a constraint error instead of clamping it.
- Shared bindings must declare the same static range and step and, when a bound is dynamic, the same expression. Date bounds and `required` follow the same rule.
- The optional prologue directive remains one line: `<!-- reactive-md: local-draft-3 -->`. `inspectLocalSourceVersion`, `checkLocalUpgrade` and `migrateLocalSource` expose the check outside the compiler, and `reactive-md migrate` moves one source's metadata and blocks body-level conflicts.
- Migration from `local-draft-2` blocks newly active `<external>` tags. Preserve literal examples as code before migrating; the migrator does not rewrite the body.

## Extension SDK

The `0.7.0` package publishes the SDK entries that were previously available only from a source-built tarball:

| Entry | Purpose |
| --- | --- |
| `reactive-md/sdk` | Manifests, configuration, themes and version contracts |
| `reactive-md/vite` | Vite adapter, virtual host, style loading and deduplication |
| `reactive-md/react` | Renderer plus `defineReactComponent`, `createReactConfig` and `createReactHost` |
| `reactive-md/build` | Resource collection and standalone bundle builds |
| `reactive-md/testing`, `/testing/react`, `/testing/browser` | Manifest, behavior, SSR and browser compliance |
| `reactive-md/authoring` | Schema, catalog and editor helpers without React or CSS |
| `reactive-md/export` | Shareable HTML and state restoration |
| `reactive-md/react/server` | Strict static rendering |
| `reactive-md/standalone` | Browser mount APIs |

`defineLocalComponent`, `defineReactComponentPackage`, `createLocalConfig`, `createReactConfig`, `createReactHost`, `defineLocalTheme` and `composeLocalTheme` form the authoring path. The Vite adapter reads one registration module and configures styles, dependency deduplication and the offline runtime. Component packages can declare styles, authoring metadata, dependencies, capabilities and resources; the editor catalog, preview and offline export consume the same registration.

`component-protocol-3` adds host inline and container forms and scalar bindings. The default preset's 46 components use the same public validator and contract as external components. Version ranges name `^0.7.0`; dependencies use `{ id, version }`.

Legacy `hostComponents`, `hostRenderer` and `hostData` remain available for migration. Combining legacy registration with the new configuration is rejected. Migrate through the [SDK migration guide](../integration/extension-sdk-en.md) before rebuilding bundles.

## Editor and authoring

CodeMirror 6 is now the only source editor at `reactive-md/editor`; `reactive-md/editor/codemirror` remains an alias for the same component, stylesheet and runtime. The textarea editor and its `textareaRef` / `getTextarea` fields are removed. Use the ref's `getSource()`, `getSelection()`, `selectRange()` and `getEditorElement()` for source and DOM access. Document `<textarea>` form controls remain supported.

Authoring menus now derive from component manifests, so external packages appear in the editor catalog with their titles, categories, descriptions and insertion templates. The round also adds preview-to-source navigation and fixes composition commits, preserved line breaks and selections, and pane scroll synchronization.

## Performance

This release includes the incremental-compilation and editing work measured on 2026-10-29:

- Block-level sessions compile only changed blocks and reuse the rest.
- Large lists and tables reuse row plans and unchanged node identities; shifted UTF-16 ranges stay accurate.
- The Worker returns a complete successful result when a patch costs more than a refresh, retains the negotiated revision chain, and negotiates a flat result format for deep trees.
- Deep containers use iterative traversal and earlier budget termination; component nesting above 100 levels and Markdown above 1,000 levels is rejected before heavy work.
- A 600-section article drops from 282 ms full compilation to 62 ms incremental session editing, with 1 block compiled and 1,799 reused.
- A 500-row dynamic table improves from 286 ms to 134 ms input-to-preview.
- A 1,000-item dynamic list retains about 0.463 MiB of post-GC heap growth after 500 consecutive edits.
- A 1,000,000-character plain document compiles in 12.26 ms on first call and 5.15 ms steady median.

See the [performance overview](../development/performance-overview-en.md) for the full matrix, regressions, memory checks, budgets and reproduction commands.

## Demo and example packages

The Demo now consumes Tetris and 2048 as installed npm tarballs from `demo/vendor/`, reads implementations and notices through public entries, and verifies both packages in production and development modes. The `2048` package uses the `<game-2048>` tag because component names must start with a letter. The repository also ships the component package template, standalone integration examples and the updated plugin development guides.

## Compatibility

- Package version: `0.7.0`; `latest` and `next` both point here.
- Syntax revision: `local-draft-3`; `component-protocol-3`; theme protocol `reactive-md-theme-1` is unchanged.
- Explicit `local-draft-1` and `local-draft-2` declarations are rejected. Migrate them with `reactive-md migrate` or keep rendering them with the old package version.
- Newly active `<external>` tags and dynamic constraints may change how previously literal source is parsed. Move literal examples into code spans or fences.
- `LOCAL_SDK_VERSION` changes the configuration key. Documents that carry an old `componentConfigKey` report `local.extension.config-mismatch` and must be recompiled with the installed configuration.
- The editor textarea ref fields are removed; use the editor ref APIs above.
- Persist original `.reactive.md` sources, not runtime ASTs or in-memory state. Migration changes the source digest, so export a fresh `reactive-md-state/v1` file after migrating.

## Validation and limits

The release uses the full `npm run verify:release` gate: core and Demo tests, type checking, builds, third-party notices, package entries, documentation links, real tarball consumption outside the repository and browser interaction. CI runs the Node gate on Node 22.12 and 24; the browser gate runs the full suite on Chromium and core workflows on Firefox and WebKit. Local browser checks use Microsoft Edge. The full Firefox and WebKit interaction suites and general SSR hydration outside exported HTML remain unverified.

The project remains a 0.x preview. Security boundaries and host responsibilities are documented in [SECURITY.md](../../SECURITY.md).
