# Contributing

Reactive MD is a 0.x preview implementation of `local-draft-2`. Contributions can cover syntax, the compiler, the runtime, the React renderer, documentation, examples and the demo. Before starting, read [Versions and compatibility](docs/compatibility/compatibility-en.md) and the [local interaction syntax specification](docs/reference/local-interaction-syntax-en.md).

When adding or changing a component, define its behavior according to the [component protocol](docs/development/component-protocol-en.md), and use the [proposal template in the development guide](docs/development/component-development-en.md) to record declarations, compatibility and acceptance evidence. Components here include input controls, containers, visualizations and structural children.

## Environment

- Node.js 22.12 or newer.
- The repository uses npm workspaces; run `npm ci` from the root.
- Do not commit `node_modules/`, `dist-library/`, `demo/dist/`, `demo/artifacts/` or `.tasks/`.

## Development and checks

```sh
npm ci
npm run verify:release
```

| Command | What it covers |
| --- | --- |
| `npm run build` | Type checking and the language package build |
| `npm test` | Compiler, expression, LaTeX, runtime and renderer tests |
| `npm run lint -- <file>` | Author diagnostics for one or more documents; requires a prior build |
| `npm run test:diagnostics --workspace=@reactive-md/demo` | Browser checks for diagnostic localization, source jumps and Unicode text constraints; requires a running demo |
| `npm run test:components` | Representative cases for the component protocol and existing language acceptance data; new components still need their own targeted tests |
| `npm run test:package` | Public entries, example compilation and style boundaries; requires a prior build |
| `npm run test:packed` | Standalone offline install of the real tarball, strict type checking for core and React, CSS exports and static SSR |
| `npm run notices` | Generate the third-party license inventory from installed dependencies |
| `npm run benchmark` | Node compile, runtime and plotting performance; the report is written to `artifacts/benchmark.json` |
| `npm run test:docs` | Documentation relative links and heading anchors |
| `npm run build:demo`, `npm run test:demo` | Demo build and example index |
| `npm run test:browser:core` | Firefox and WebKit core workflows at 1280px and 375px; uses the built demo and manages its preview server |
| `npm run verify:release` | Complete release gate: core and demo tests, types, notices, package and documentation checks, packed consumption outside the repository, and browser checks for calculations, collections, authoring, state restoration, HTML export and rendering equivalence. It manages the preview server lifecycle |

CI uses `npm run verify:release:node` and `npm run verify:release:browser` to split the same gate. Reports and step logs go to `artifacts/release-verification.json` and `artifacts/release-verification/`; the exact verified tarball and its SHA256 record go to `artifacts/release-package/`. A local browser must already be installed; the gate does not install one.

Browser checks require the demo to be running and a local browser available. The complete gate manages those dependencies itself; when running individual browser scripts, the default address is `http://127.0.0.1:5173` and `DEMO_URL` can point at another address. Reports are written to `demo/artifacts/`. Local runs use Edge by default; CI uses Playwright Chromium on Linux (`PLAYWRIGHT_CHANNEL=chromium`).

The browser release gate keeps the full Chromium suite and adds core workflows in Playwright Firefox and WebKit. Install the matching runtimes with `npm exec --workspace=@reactive-md/demo -- playwright install firefox webkit` (CI installs all three engines with `--with-deps`). After `npm run build:demo`, run `npm run test:browser:core`, or select one engine with `node scripts/verify-browser-core.mjs --browser=webkit`. `DEMO_URL` can reuse an existing server. Reports, screenshots and downloaded HTML go to `artifacts/browser-core/`, grouped by engine. A missing browser or failed check makes the command fail.

The core gate covers examples, controls and calculations, conditions, dates, tables, charts, diagrams, editing and diagnostics, personal document persistence and copies, language switching, guide code themes, keyboard menus, and Markdown/interactive HTML downloads. Exported HTML is reopened from disk and exercised with external requests blocked. WebKit engine checks do not substitute for testing Safari on an Apple device.

```sh
npm run dev
# another terminal
npm run test:browser
```

After changing the language package, rerun `npm run build:lib`, or use `npm run dev:lib` to watch and rebuild.

Performance measurement conditions and current baselines are in [Performance measurements](docs/development/performance-overview-ch.md); reusable inputs and expected results across implementations are in the [language conformance data](examples/conformance/README.md).

## Change requirements

- Keep changes focused. Add tests for behavior changes; update documentation and relevant examples for user-visible changes.
- For breaking changes to syntax or the public API, first update [Versions and compatibility](docs/compatibility/compatibility-en.md) and the [changelog](CHANGELOG.md), describing the old form, the new form and the migration path. Do not silently change author syntax without a syntax revision.
- New components or attributes must implement compile validation, runtime constraints, rendering, accessible names and resource boundaries together. Do not add display styling only.
- A component proposal must state attribute and child-content declarations, state and lifecycle rules, diagnostics, resource budgets, compatibility classification and corresponding acceptance results; see the [protocol acceptance data](examples/conformance/README.md) for `slider`, `tabs` and `plot`. A protocol revision does not automatically change the package version, syntax revision or public API.
- Resource limits are centralized in `src/local/limits.ts`; when adding unbounded input, loops, recursion or plotting computation, define a budget first.
- Do not introduce network requests, arbitrary HTML, event handlers, author CSS or persisted state. These are out of the current scope.
- Keep terminology consistent with the existing documentation; keep the English README concise and do not repeat engineering details.
- Do not commit credentials, `.npmrc` tokens or personal paths. Do not edit `dist-library/` by hand; it is generated by the build.

## Commits and pull requests

- Describe the purpose, affected scope, verification commands and results in the PR. State any checks you did not run explicitly instead of presenting them as passed.
- Do not open a public issue for security matters; follow the [security policy](SECURITY.md).
- Releases are a manual maintainer process; see the [release checklist](docs/development/releasing-en.md). Contributors do not need npm credentials.
