# Local module layout

**English** · [中文](local-module-layout-ch.md)

`src/local` holds the local-draft implementation: parsing, compilation, evaluation, runtime, worker transport and React rendering. The files are grouped by responsibility. Shared contracts live in the root `types.ts`; `src/local/index.ts` stays at the root as the only barrel and defines the local API re-exported by the package root.

## Responsibility folders

The implementation is grouped into ten responsibility folders.

| Folder | Responsibility |
| --- | --- |
| `source/` | Source text facts and author tooling: offsets and ranges, node traversal, code-point length, editor analysis and syntax migration. |
| `configuration/` | Compile options and manifest normalization, resource limits, diagnostic templates and component schema. |
| `parsing/` | CommonMark fast paths and block planning, tag and region scanning, token conversion, heading anchors and footnotes, parse caching and tolerant RMD recovery. |
| `html/` | Native HTML grammar, allowlists, tables, details and recovery. |
| `compilation/` | Semantic passes, compile entry points, service interfaces, component kernel and value rules, dependency indexing, incremental compilation, semantic cache and row reuse. |
| `evaluation/` | Expression parsing, inference and evaluation, computable LaTeX and plot sampling, KaTeX display checks, computations, formatting, data and collection functions, validation. |
| `transport/` | Worker scheduling and protocol, serialized documents, full, shared and flat result forms, source edits and result patches. |
| `runtime/` | Reactive runtime, document updates, state migration, value checks and retention. |
| `rendering/` | React document views and cores, node rendering, revision and validation projections, leaf views (code, tables, images, math, visuals) and local styles. |
| `theme/` | Theme protocol and name validation, colors and localization. |

## Choosing a location

Start from the output a module produces:

1. Source facts and parse structure go in `source/`, `parsing/` or `html/`, depending on the input that module reads.
2. Shared data contracts go in the root `types.ts`. Option validation, limits, diagnostic text and component schema go in `configuration/`.
3. A module that repeats work across revisions goes in `compilation/` or `parsing/`. Worker messages, serialization and patches go in `transport/`. Live document state goes in `runtime/`.
4. React document and leaf views go in `rendering/`. Locale and theme code go in `theme/`; `theme/i18n.tsx` is the React-aware file there.
5. Fit an existing folder first. A new folder needs a responsibility that no current folder owns.

## Cross-folder imports

Use the exact module path:

```ts
import { parseLocal } from '../parsing/parser';
import type { LocalNode } from '../types';
```

Do not add folder-level `index.ts` barrels. A barrel such as `evaluation/index.ts` would add KaTeX to every expression import, and a broad rendering barrel would add React to compile-only paths. Import an optional capability at the point of use:

- React views: `rendering/`
- Worker scheduling and protocol: `transport/worker`
- KaTeX display: `evaluation/math-display`

The root `index.ts` is the deliberate exception. Add an export there only when a symbol belongs to the package-level local API.

## Public exports

Consumer imports stay the same. The package exposes the paths declared in `package.json`, such as `reactive-md`, `reactive-md/react`, `reactive-md/compiler` and `reactive-md/sdk`. The local barrel feeds the root entry and does not create deep-import subpaths for the new folders.

The layout groups and splits implementation files by responsibility. Public exports and runtime behavior are unchanged, with no release or version bump and no new layering or cycle guarantee.