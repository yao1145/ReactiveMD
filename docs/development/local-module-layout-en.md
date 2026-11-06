# Local module layout

**English** · [中文](local-module-layout-ch.md)

`src/local` holds the local-draft implementation: parsing, compilation, evaluation, runtime, worker transport and React rendering. The files are grouped by responsibility. `src/local/index.ts` stays at the root as the only barrel and defines the local API re-exported by the package root.

## Responsibility folders

The reorganization moves 75 implementation and asset files into 14 folders.

| Folder | Responsibility |
| --- | --- |
| `contracts/` | Shared data shapes: document, node, diagnostic, compilation and runtime types, syntax version and locale. |
| `source/` | Source text facts and author tooling: line, fence and indent scans, node traversal, code-point length, source version inspection and migration, editor analysis. |
| `configuration/` | Compile option validation and identity, default preset assembly, limits, diagnostic templates and component schema. |
| `parsing/` | Parser kernel and facade, parse work budgets and tolerant RMD recovery. |
| `markdown/` | Markdown fast paths and transforms: block planning, plain paragraphs, heading anchors and footnotes. |
| `html/` | HTML parsing, allowlists, tables, details and recovery. |
| `compilation/` | Single semantic pass, compile entry points, service interfaces, component kernel and dependency index. |
| `evaluation/` | Expression language, computable LaTeX and plot sampling, KaTeX display checks, computations, dates, formatting, collection and data functions, validation. |
| `session/` | Cross-revision reuse: semantic and parse caches, incremental block session and row reuse. |
| `transport/` | Worker protocol and message shapes, full, shared and flat result forms, source edits and result patches. |
| `runtime/` | Reactive runtime, state import and export, retention. |
| `rendering/` | React document view, render contracts, legacy adapter, view revision projections and view styles. |
| `widgets/` | Leaf React views: code highlighting, data tables, images, math, table surface, diagrams and visuals. |
| `theme/` | Theme protocol and name validation, colors and localization. |

## Choosing a location

Start from the output a module produces:

1. Source facts and parse structure go in `source/`, `parsing/`, `markdown/` or `html/`, depending on the input that module reads.
2. Shared data contracts go in `contracts/`. Option validation, limits, diagnostic text and component schema go in `configuration/`.
3. A module that repeats work across revisions goes in `session/`. Worker messages, serialization and patches go in `transport/`. Live document state goes in `runtime/`.
4. React document and leaf views go in `rendering/` or `widgets/`. Locale and theme code go in `theme/`; `theme/i18n.tsx` is the React-aware file there.
5. Fit an existing folder first. A new folder needs a responsibility that no current folder owns.

## Cross-folder imports

Use the exact module path:

```ts
import { parseLocal } from '../parsing/parser';
import type { LocalNode } from '../contracts/types';
```

Do not add folder-level `index.ts` barrels. A barrel such as `evaluation/index.ts` would add KaTeX to every expression import, and a broad rendering barrel would add React to compile-only paths. Import an optional capability at the point of use:

- React views: `rendering/` and `widgets/`
- Worker scheduling and protocol: `transport/worker`
- KaTeX display: `evaluation/math-display`

The root `index.ts` is the deliberate exception. Add an export there only when a symbol belongs to the package-level local API.

## Public exports

Consumer imports stay the same. The package exposes the paths declared in `package.json`, such as `reactive-md`, `reactive-md/react`, `reactive-md/compiler` and `reactive-md/sdk`. The local barrel feeds the root entry and does not create deep-import subpaths for the new folders.

This is a path-only reorganization. Public exports and runtime behavior are unchanged, with no release or version bump and no new layering or cycle guarantee.
