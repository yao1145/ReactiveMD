# Local module layout

**English** · [中文](local-module-layout-ch.md)

See the [source map](../../src/local/README.md) for the current directory tree.

## Choosing a location

- Put source offsets and editor tooling in `source/`. Put CommonMark and RMD scanning in `parsing/`, and native HTML grammar, sanitization, and recovery in `html/`.
- Put component schema, normalization, shared rules, limits, and diagnostics in `configuration/`. Parsing, compilation, and the SDK use that component vocabulary.
- Put single-pass compilation in `compilation/` and cross-revision reuse in `compilation/session/`. The session owns the cache and supplies services to the compiler. Worker messages, serialization, and patches live in `transport/`. Live state and document updates live in `runtime/`.
- Put expression parsing, inference, and built-ins in `evaluation/expression/`. LaTeX, sampling, and KaTeX display live in `evaluation/math/`. The minimal compiler uses LaTeX for formula dependency tracking. The standard assembly adds display and plot checks.
- Keep React document views, projections, and document styles in `rendering/document/`. Code, image, and table views live with their feature helpers. Diagram geometry lives in `src/components/diagram/`. Document theme resolution and CSS layer contracts live in `src/themes/`; React locale context lives in `src/react/localization.tsx`.

## Contracts and imports

Use `src/local/types.ts` for shared document, node, diagnostic, and value contracts. Keep parser state, compiler services, session statistics, and view props in the modules that own them.

Import each implementation module directly. Keep optional capabilities at the assembly or feature that uses them. The local root `index.ts` feeds the package root. Consumer entry points are declared in [package.json](../../package.json).
