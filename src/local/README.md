# Local mode source layout

`src/local` implements local-draft parsing, compilation, evaluation, runtime, transport and React rendering. Implementation files are grouped by responsibility. `src/local/index.ts` is the only barrel in this tree and defines the local API that the package root re-exports.

## Responsibility folders

| Folder | Responsibility | Main files |
| --- | --- | --- |
| `contracts/` | Shared data shapes: document, node, diagnostic, compilation and runtime types; syntax version; locale. | `types.ts`, `version.ts`, `locale.ts` |
| `source/` | Source text facts and author tooling: line, fence and indent scans, node traversal, code-point length, version inspection and migration, editor analysis. | `source-context.ts`, `node-walk.ts`, `text-length.ts`, `source-migration.ts`, `authoring.ts` |
| `configuration/` | Compile option validation and identity, default preset assembly, limits, diagnostic templates, component schema. | `options.ts`, `options-core.ts`, `portable-options.ts`, `limits.ts`, `diagnostics.ts`, `schema.ts`, `schema-core.ts` |
| `parsing/` | Parser kernel and facade, parse work budgets, tolerant RMD recovery. | `parser.ts`, `parser-core.ts`, `parse-budget.ts`, `rmd-recovery.ts` |
| `markdown/` | Markdown fast paths and transforms: block planning, plain paragraphs, heading anchors, footnotes. | `fast-markdown.ts`, `markdown-blocks.ts`, `plain-paragraphs.ts`, `heading-anchors.ts`, `footnotes.ts` |
| `html/` | HTML parsing, allowlists, tables, details and recovery. | `html.ts`, `html-names.ts`, `html-table.ts`, `html-details.ts`, `html-recovery.ts` |
| `compilation/` | Single semantic pass, compile entry points, service interfaces, component kernel, dependency index. | `compiler.ts`, `compiler-core.ts`, `compiler-services.ts`, `component-kernel.ts`, `dependencies.ts` |
| `evaluation/` | Expression language, computable LaTeX and plot sampling, KaTeX display checks, computations, dates, formatting, collection and data functions, validation. | `expression.ts`, `math.ts`, `math-display.ts`, `computations.ts`, `formatting.ts`, `validation.ts` |
| `session/` | Cross-revision reuse: semantic and parse caches, incremental block session, row reuse. | `compiler-cache.ts`, `parse-session.ts`, `incremental.ts`, `row-reuse.ts` |
| `transport/` | Worker protocol and message shapes; full, shared and flat result forms; source edits and result patches. | `worker.ts`, `compile-patch.ts`, `compiled-data.ts`, `flat-compiled-data.ts`, `shared-data.ts` |
| `runtime/` | Reactive runtime, state import and export, retention. | `runtime.ts`, `state.ts`, `retention.ts` |
| `rendering/` | React document view, render contracts, legacy adapter, view revision projections, view styles. | `LocalDocumentView.tsx`, `render-types.ts`, `view-revision.ts`, `local.css` |
| `widgets/` | Leaf React views: code highlighting, data tables, images, math, table surface, diagrams and visuals. | `code-block.tsx`, `data-table.tsx`, `math-view.tsx`, `visuals.tsx` |
| `theme/` | Theme protocol and name validation, colors, localization. | `theme.ts`, `theme-name.ts`, `colors.ts`, `i18n.tsx` |

## Placing a new file

1. Follow the output. Code that builds parse facts belongs in `parsing/` or `source/`, Markdown transforms in `markdown/`, HTML normalization in `html/`, and computed or formatted values in `evaluation/`.
2. Put shared data contracts in `contracts/`. Put option validation, limits, diagnostic text and component schema in `configuration/`.
3. Put cross-revision reuse in `session/`, worker messages and patches in `transport/`, and live document state in `runtime/`.
4. Put React document and leaf views in `rendering/` or `widgets/`. Locale and theme code goes in `theme/`; `theme/i18n.tsx` is the React-aware file there.
5. Fit an existing folder first. Add a folder only when the new responsibility is distinct from every folder above.

## Cross-folder imports

Import the exact module path:

```ts
import { parseLocal } from '../parsing/parser';
import type { LocalNode } from '../contracts/types';
```

Keep these imports direct. Do not add folder-level `index.ts` barrels. A barrel such as `evaluation/index.ts` would put KaTeX into every expression import, and a broad rendering barrel would pull React into compile-only paths. Import optional capabilities where they are used:

- React views: `rendering/` and `widgets/`
- Worker scheduling and protocol: `transport/worker`
- KaTeX display: `evaluation/math-display`

## Public entry

`src/local/index.ts` is a curated export list. Add an export only when the symbol belongs to the package-level local API. Package subpaths stay as declared in `package.json`; the file move creates no new deep-import path.

This is a path-only reorganization of 75 files into 14 responsibility folders. Public exports and runtime behavior are unchanged, with no release or version bump.
