# Local mode source layout

`src/local` contains the local document pipeline. `index.ts` lists the local API re-exported by the package root.

| Folder | Responsibility |
| --- | --- |
| `source/` | Source offsets and ranges, node traversal, editor analysis and syntax migration. |
| `configuration/` | Option-check rules, manifest normalization and diagnostic templates. The validated default-option entry points live in `src/assemblies/`; shared component and runtime contracts live in `src/contracts/`. |
| `parsing/` | CommonMark parsing, tag and region scanning, token conversion, parser caches and tolerant recovery. |
| `html/` | Native HTML grammar, sanitization, recovery, tables and disclosures. |
| `compilation/` | Single-pass compilation, component validation, compiled metadata and dependency indexing. |
| `evaluation/` | Expressions and their built-ins in `expression/`, LaTeX and sampling in `math/`, plus computation graphs and validation rules. |
| `transport/` | Worker scheduling and protocol, serialized documents, source edits and result patches. |
| `runtime/` | Live document state, value checks, updates, state migration and retention. |
| React rendering | `src/react/rendering/` contains document views, code, image and table views, with helpers grouped by feature. |

## Compiler and session

`src/contracts/component-kernel.ts` defines the component vocabulary and normalization rules used by parsing, compilation and the SDK. `configuration/component-kernel.ts` and `configuration/kernel-value-rules.ts` keep the local implementation imports stable.

`compilation/compiler-core.ts` runs one compilation. Its phases decode and validate attributes, resolve bindings and declarations, check expressions and lower component metadata. `compilation/compiler.ts` assembles the full `compileLocal` entry and supplies the tracked compile adapter. `compilation/session/` owns cross-revision block reuse, row reuse and the semantic cache. The compiler accepts cache operations through `compiler-services.ts`; the session creates the cache.

The minimal compiler uses LaTeX to collect formula dependencies. The standard compiler also installs GFM, Lezer block planning, native HTML handling, the KaTeX display precheck and plot formula validation. Load those capabilities through the assembly or feature that uses them.

## Rendering and themes

`src/react/rendering/document/LocalDocumentViewCore.tsx` assembles the view of a compiled document. `LocalReactiveDocumentCore.tsx` owns the compile session and runtime lifecycle. Node rendering, memoized revision and validation projections, color scheme and document styles live beside those views. Diagram geometry and ELK layout belong to `src/components/diagram/`.

`src/themes/document-theme.ts` defines the document theme protocol and theme resolution. The CSS layer contract and default tokens live in `src/themes/`. React locale context lives in `src/react/localization.tsx`. The compiler and SDK share color literal validation in `src/contracts/color-values.ts`.

## Shared contracts

Put a type in `types.ts` when it describes data shared across stages or serialized with a compiled document, such as `LocalNode`, `Diagnostic` or `LocalDocument`. Keep parser state, compiler service interfaces, session statistics and view props beside the modules that own them. Import implementation symbols directly from their modules and maintain public exports through the package entry points.

Pure cross-stage types and helpers belong in `src/contracts/`. Default preset and runtime wiring belongs in `src/assemblies/`, which composes contracts, the local compiler, SDK definitions and presets for package entry points. Keep React rendering in `src/react/` so the local language core remains independent of React and components.

`src/local` imports the default assembly from exactly these files, and the
boundary script pins the list:

| File | Why it reads the default assembly |
| --- | --- |
| `index.ts` | Public re-export of `localCompileOptionsKey`. |
| `compilation/compiler.ts` | Full `compileLocal` entry validates options against the default preset. |
| `compilation/session/incremental.ts` | Freezes a trusted config snapshot for per-block keys. |
| `configuration/portable-options.ts` | Copies validated config into portable payloads. |
| `parsing/parse-session.ts`, `parsing/parser.ts` | Option key and option validation for parsing. |
| `runtime/retention.ts`, `runtime/runtime-values.ts` | Resolve binding and value rules for hand-built documents from the public default manifests. |
| `source/authoring.ts` | Editor analysis validates options the same way a compile does. |
| `transport/worker-job.ts` | Worker side revalidates config so a caller cannot mutate an in-flight job. |

The minimal compiler and the minimal preset reach no assembly at all; use
`reactive-md/compiler` or `reactive-md/presets/minimal` when the default preset
must stay out of the bundle.
