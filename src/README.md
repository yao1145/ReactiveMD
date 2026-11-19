# Engine source layout

## Directories

| Directory | Responsibility |
| --- | --- |
| `authoring/` | Editor-facing analysis, component catalog, insertion, and source commands. |
| `build/` | Standalone bundle planning and builds, including host configuration, resources, and notices. |
| `compiler/` | Public single-pass compiler factories. The minimal factory installs the core language, and the standard factory adds the default preset and optional compiler capabilities. |
| `components/` | Built-in renderers, controls, and React plugin assemblies. |
| `export/` | Export plans and rendering for static, SSR, and offline targets, plus component state restoration and print preparation. |
| `export-assets/` | Access to the packaged CSS, standalone runtime, notices, and package metadata for export consumers. |
| `local/` | Language implementation, including parsing, semantic compilation, incremental sessions, Worker transport, evaluation, document runtime, and rendering. See the [local source map](local/README.md). |
| `presets/` | Default and minimal compiler component presets and optional component packs. |
| `react/` | Public React views, SSR, host and component adapters, localization, and React runtime bindings. |
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

## Where to make changes

- Syntax and semantic behavior belong in `local/`. Compiler capability selection belongs in `compiler/`, with the normal package root also providing the full local compile API.
- Component contracts belong in `sdk/`, preset composition in `presets/`, and built-in implementations in `components/`. Editor consumers use `reactive-md/authoring`.
- Follow the export pipeline from `export/` for document preparation to `shareable.ts` for HTML packaging, `standalone/` for running interactive exports, or `pdf.ts` for printing.
- Import internal modules directly. Use the public subpaths declared in [package.json](../package.json) across repositories. The [library build configuration](../vite.lib.config.ts) and [build-tool configuration](../vite.build.config.ts) map those entry points to source.
