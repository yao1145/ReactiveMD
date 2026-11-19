# Local mode source layout

`src/local` contains the local document pipeline. `types.ts` defines the document, diagnostic and runtime contracts shared across the pipeline. `index.ts` lists the local API re-exported by the package root.

| Folder | Responsibility |
| --- | --- |
| `source/` | Source offsets and ranges, node traversal, editor analysis and syntax migration. |
| `configuration/` | Compiler options, manifest normalization, resource limits and diagnostic templates. |
| `parsing/` | CommonMark parsing, tag and region scanning, token conversion, parser caches and tolerant recovery. |
| `html/` | Native HTML grammar, sanitization, recovery, tables and disclosures. |
| `compilation/` | Semantic passes, component rules, compiled metadata, dependency indexing and incremental compilation. |
| `evaluation/` | Expression and LaTeX parsing, inference and evaluation, value formatting and validation. |
| `transport/` | Worker scheduling and protocol, serialized documents, source edits and result patches. |
| `runtime/` | Live document state, value checks, updates, state migration and retention. |
| `rendering/` | React document views, revision and validation projections, node rendering, leaf views and local styles. |
| `theme/` | Theme names and manifests, colors and localization. |

## Compiler and renderer

`compilation/compiler-core.ts` runs the compilation phases in order. The phase modules own attribute decoding and validation, bindings, declarations, expression checks and component-specific validation. `compiler-values.ts` holds shared value parsing and initial-value checks. `compiler-structure.ts` handles component traversal, child rules and metadata that the runtime consumes.

`rendering/LocalDocumentViewCore.tsx` assembles the document view from a compiled document. `LocalReactiveDocumentCore.tsx` owns the compile session and runtime lifecycle. `render-nodes.tsx` renders the node tree. `view-revision.ts`, `validation-state.ts` and `use-color-scheme.ts` supply the derived state the view consumes.

## Imports

Import implementation symbols directly from their modules. Shared contracts live in `types.ts`. Keep optional dependencies at the assembly or feature that uses them. For example, `parsing/parser-standard.ts` installs GFM and Lezer planning, `evaluation/math-display.ts` handles KaTeX display checks, and `rendering/` owns React views.
