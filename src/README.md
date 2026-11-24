# Engine source layout

## Directories

| Directory | Responsibility |
| --- | --- |
| `authoring/` | Editor-facing analysis, component catalog, insertion, and source commands. |
| `build/` | Standalone bundle planning and builds, including host configuration, resources, and notices. |
| `compiler/` | Public single-pass compiler factories. The minimal factory installs the core language, and the standard factory adds the default preset and optional compiler capabilities. |
| `assemblies/` | Default assembly snapshots that pair the default preset with the local compiler, SDK definitions, and validated options. This is the only layer that knows the default preset. |
| `components/` | Built-in renderers, controls, and React plugin assemblies. |
| `export/` | Export plans and rendering for static, SSR, and offline targets, plus component state restoration and print preparation. |
| `export-assets/` | Access to the packaged CSS, standalone runtime, notices, and package metadata for export consumers. |
| `contracts/` | Pure cross-stage types and helpers shared by the SDK, the language core, and components. Depends on no other engine layer and is published as `reactive-md/contracts`. |
| `local/` | Language implementation, including parsing, semantic compilation, incremental sessions, Worker transport, evaluation, and document runtime. React views live in `react/rendering/`. See the [local source map](local/README.md). |
| `presets/` | Default and minimal compiler component presets and optional component packs. |
| `react/` | Public React views, SSR, host and component adapters, localization, document rendering under `rendering/`, and React runtime bindings. |
| `runtime-services/` | Host services for component state, scheduling, identity, randomness, and networking, including browser transports. |
| `sdk/` | Component, preset, and theme contracts and registration APIs. |
| `standalone/` | Standalone HTML runtime, payload preparation, extension-aware host, and document lifecycle. |
| `styles/` | Shared reset, document and primitive styles, and full and minimal stylesheet assembly. |
| `testing/` | SDK conformance helpers for manifests, behavior, React, and browser consumers. |
| `themes/` | Document theme selection, public styling contract, cascade layers, and default tokens. |
| `vite/` | Vite plugin, directory discovery, extension registration, and client types. |

## Root files

| File | Role |
| --- | --- |
| `index.ts` | Package root for the local API, shareable HTML, and component state export. |
| `shareable.ts` | Builds shareable HTML with document payloads and optional assets and state. |
| `pdf.ts` | Produces PDFs through Chromium using the print preparation in `export/`. |
| `styles.css` | Source entry for the full screen stylesheet. |
| `print.css` | Print overrides used by the PDF and print paths. |
| `theme.css` | Compatibility import for the default semantic theme tokens. |

## Layering

Layers may only import themselves and the layers to their left:

```text
contracts -> sdk -> local -> assemblies -> presets -> components -> react
```

`compiler/`, `export/`, `standalone/`, `testing/`, `build/`, and `vite/` are
consumers that sit above this chain; `runtime-services/` and `themes/` sit below
`local`. Two boundaries are checked by `scripts/verify-architecture-boundaries.mjs`
and must not widen silently:

- `sdk/` is a contract layer. Only `sdk/config.ts` and `sdk/registry.ts` reach the
  default assembly, because they are compatibility facades.
- `local/` owns no default preset. Only the files pinned in the boundary script
  read `assemblies/`, and only to revalidate options or resolve the public default
  manifests for hand-built documents.

Run `npm run check:boundaries` after moving a module across layers.

## Where to make changes

- Syntax and semantic behavior belong in `local/`. Compiler capability selection belongs in `compiler/`, with the normal package root also providing the full local compile API.
- Component contracts belong in `sdk/`, preset composition in `presets/`, and built-in implementations in `components/`. Editor consumers use `reactive-md/authoring`.
- Types shared across stages belong in `contracts/`. Default preset and runtime wiring belongs in `assemblies/`; `local/` must stay independent of React, components, and the default preset.
- Follow the export pipeline from `export/` for document preparation to `shareable.ts` for HTML packaging, `standalone/` for running interactive exports, or `pdf.ts` for printing.
- Import internal modules directly. Use the public subpaths declared in [package.json](../package.json) across repositories. The [library build configuration](../vite.lib.config.ts) and [build-tool configuration](../vite.build.config.ts) map those entry points to source.
