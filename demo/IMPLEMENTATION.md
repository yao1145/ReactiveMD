# Implementation and verification notes

## Local interaction mode (2026-10-22)

The Playground has switched to `local-draft-1` and loads the 12 documents in `examples/local/` directly. Eleven normal examples run, while the diagnostics example fails on purpose and disables interaction. For the authoring syntax see the [local interaction specification](../docs/local-interaction-syntax-en.md); for the public entry points see the [integration guide](../docs/local-integration-en.md).

| Module | Implementation |
| --- | --- |
| Tags and Markdown | `src/local/parser.ts`: isolates code and math regions, nested containers, attributes, table escapes and original source positions |
| Expressions | `src/local/expression.ts`: strict types, short-circuit evaluation, built-in functions, interpolation and execution budgets |
| Compilation and state | `src/local/schema.ts`, `compiler.ts`, `runtime.ts`: 33 components, forward and shared bindings, initial-value constraints, local errors and atomic resets |
| LaTeX | `src/local/math.ts`, `math-view.tsx`: real-function parsing, piecewise functions, global execution budget, discontinuity subdivision and native MathML typesetting |
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

## Cloud server deployment (2026-10-22)

Local mode replaced the [live demo](https://yaozi.raricy.com/). The server is accessed through `ssh rocky2-ts`; the site directory is `/opt/reactive-md`, and the `site` symlink points to `releases/20261022-1400-local-draft-1`. The previous release `releases/20261021-235541` is kept, so an atomic symlink switch can roll back. The existing Caddy, certificate and container configuration was reused.

SHA256 checks passed for the upload package, entry points and all new assets. IPv6 HTTPS on the server returned the new version; through a temporary SSH tunnel, all 38 live browser checks passed with the real domain and normal certificate validation. The current client's direct public connection times out, so this check does not mean direct public access from the current network has recovered. The report is saved in the local `demo/artifacts/deployed-browser-results.json`, and the release record is in `.tasks/deploy/`.
