# Implementation and verification notes

## Current release: 0.4.0 / local-draft-2

The current source combines read-only calculations, formatting, arrays and bounded data tables, advisory validation, author tools, portable parameter state, HTML export and dependency-aware rendering. The [syntax specification](../docs/reference/local-interaction-syntax-en.md), [compatibility notes](../docs/compatibility/compatibility-en.md) and [release checklist](../docs/development/releasing-en.md) describe the current contracts.

Run `npm run verify:release` from the repository root for the release gate. It builds the package and demo, checks the actual tarball in consumers outside the repository, and runs the browser checks with a managed preview server. Generated reports belong in the ignored artifact directories. Results below are dated historical records; current readiness comes from a fresh gate run. The live site's deployed commit is recorded in its `release.json`.

## Historical local review: 0.4.0 / local-draft-2 (2026-10-23)

This checkout adds ten component names (43 total), checked todo styling, component colors and shared table/chart selection. All 43 components are distributed across the original six bilingual scenarios, with nine new editor insertion templates (34 total). The separate new-interactions and component-reference navigation entries have been removed; old bookmarks resolve to Functions and Forms. Syntax and migration are documented in [new components](../docs/reference/local-components-v2-en.md).

Three Claude Code sessions implemented the compiler/runtime, controls/navigation and visual selection in separate file scopes. The coordinator reviewed the changes and fixed integration issues, including order-independent anchor collisions, inline content validation, decimal interval bounds, coordinate draft reset and anonymous step state. This section records implementation and local validation. The live site identifies its deployed commit in release.json; the deployment record below describes an earlier release.

Validation for this review:

- Core suite and Demo suite pass; new core, renderer, visual and integrated acceptance cases are included.
- Build, component conformance, public package, offline packed install/types/SSR and documentation-link checks pass.
- Edge checks cover 35 container layouts, both languages across all seven navigation entries at 375/768/1440px, existing local controls and document usability, and desktop/mobile editor insertion.
- `verify-v2.mjs` checks the six scenarios and boundary cases covering pointer/keyboard input, hidden jump feedback, focus, todo styling, foreground/accent colors, resets, fractional coordinate boundaries, and shared selection after table search/sort/paging. It captures each scenario in English/Chinese light/dark screenshots at 375px and desktop width, with no browser runtime exceptions.
- The build retains the existing warning about a JavaScript chunk over 500 kB. SSR hydration and screen-reader usability have not been manually verified.

Browser reports and screenshots are in the ignored `demo/artifacts/` directory. The local Vite service listens on `http://127.0.0.1:5173`; it consumes the current workspace library build. Production deployment uses a versioned release directory and an atomic site symlink switch, retaining the previous release for rollback.

## Historical local interaction review (2026-10-22)

The Playground has switched to `local-draft-1` and loads the 12 documents in `examples/local/` directly. Eleven normal examples run, while the diagnostics example fails on purpose and disables interaction. For the authoring syntax see the [local interaction specification](../docs/reference/local-interaction-syntax-en.md); for the public entry points see the [integration guide](../docs/integration/local-integration-en.md).

| Module | Implementation |
| --- | --- |
| Tags and Markdown | `src/local/parser.ts`: isolates code and math regions, nested containers, attributes, table escapes and original source positions |
| Expressions | `src/local/expression.ts`: strict types, short-circuit evaluation, built-in functions, interpolation and execution budgets |
| Compilation and state | `src/local/schema.ts`, `compiler.ts`, `runtime.ts`: 33 components, forward and shared bindings, initial-value constraints, local errors and atomic resets |
| LaTeX | `src/local/math.ts`: real-function evaluation, piecewise functions, execution budgets and discontinuity subdivision; `math-display.ts`, `math-view.tsx`: KaTeX HTML/MathML typesetting, mhchem, shared diagnostics and bundled fonts |
| React | `src/local/LocalDocumentView.tsx`: input drafts, IME composition input, hidden state, timer pausing, error recovery and unique DOM IDs across instances |
| Visualization | `src/local/visuals.tsx`: tables, five chart types, function curves, timeline, auto-layout diagrams and keyboard readouts |

The main agent delegated seven implementation tasks in parallel through `claude-code-subagent`, covering parsing, expressions, math, compile runtime, base components, visualization and Playground integration. The main agent reviewed the actual code, fixed integration issues and ran all tests and browser checks. Task and session records are kept in the ignored directory `.tasks/local-syntax/`.

This round passed:

- `npm test`: 16 test files, 201 tests.
- `npm run build:demo`: core type checks, language package and Playground build.
- `npm run test:demo`: 15 public package and example tests.
- `npm run test:package`: core has no React runtime dependency, public entries, all examples and app style boundaries.
- `npm run test:docs`: documentation links and navigation anchors.
- `demo/scripts/verify-local-browser.mjs`: 38 checks in Edge, including 12 examples, input drafts, IME composition input, hidden checklist, recovery from conditional evaluation errors, timer pause, table sorting and paging, 375px layout, and independent state and unique DOM IDs for two StrictMode instances. Runtime exceptions and unexpected external requests were both 0.

The browser report is in `demo/artifacts/local-browser-results.json`, and screenshots start with `local-`. The checks pointed `DEMO_URL` at the local test server started for this round. The build kept one large-chunk size warning; no on-demand chunk splitting was done.

## Historical cloud server deployment (2026-10-22)

Local mode replaced the [live demo](https://yaozi.raricy.com/) in this deployment. The server was accessed through `ssh rocky2-ts`; the site directory was `/opt/reactive-md`, and the `site` symlink was switched to `releases/20261022-1400-local-draft-1`. The previous release `releases/20261021-235541` was retained for rollback. The existing Caddy, certificate and container configuration was reused.

SHA256 checks passed for the upload package, entry points and all new assets. IPv6 HTTPS on the server returned the new version; through a temporary SSH tunnel, all 38 live browser checks passed with the real domain and normal certificate validation. The current client's direct public connection times out, so this check does not mean direct public access from the current network has recovered. The report is saved in the local `demo/artifacts/deployed-browser-results.json`, and the release record is in `.tasks/deploy/`.
