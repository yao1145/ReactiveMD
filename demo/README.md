# Reactive MD Playground

The Playground uses the [local interaction syntax](../docs/local-interaction-syntax-en.md) and ships with [12 complete examples](../examples/local/README.md). If you are new to the syntax, start with the [getting-started guide](../docs/local-guide-en.md). Edit Markdown on the left; inputs, computed results and visualizations appear on the right. Compile errors are listed in the diagnostics panel by source position. The editor toolbar offers common Markdown formatting plus a menu for inserting native components such as sliders, panels, charts and diagrams, grouped and searchable.

The "User Guide" view at the top of the page renders `docs/local-guide-en.md` directly, covering everything from your first interactive document to charts, function curves and a quick error reference. Documentation links in the guide point to the repository, and table-of-contents anchors jump within the page.

While you edit, consecutive keystrokes are coalesced and compiled on a background thread; the previous preview stays visible while waiting. The preview updates once the current source compiles successfully and shows diagnostics when it fails. For implementation details and how to re-measure, see [performance measurement](../docs/performance-en.md#playground-live-editing).

"Keep trial state" is on by default. When you edit prose, control labels or formulas, parameter values with the same name and type that still satisfy the new constraints are kept; they are also restored after a temporary compile error is fixed. Changing `initial` or an effective default uses the new initial value. With the option off, the next compile starts from initial values.

Trial values live only in the current editing session. Running again, restoring an example, switching examples, importing a document or refreshing the page resets them; anonymous controls, checklists and timers reset after every recompile. The `LocalReactiveDocument` library component still creates a fresh document instance whenever the source changes.

Live demo: [yaozi.raricy.com](https://yaozi.raricy.com/).

## Getting started

From the repository root:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The embed example is at `/embed.html` and shows two independent in-memory document instances. If the library is already built, you can run `npm run dev` inside `demo/`.

## Examples

Start with the counter and cost estimate, then try the parameter panel, checkable checklist, local catalog search, charts, LaTeX function curves, interactive diagram and timer. The diagnostics example contains deliberate errors: the preview should disable interaction and show diagnostics.

Example sources live in `examples/local/` at the repository root. The Playground uses the library through `compileLocal`, `createLocalRuntime` and the `reactive-md/react` renderer entry, without importing language internals directly. Controls declare parameters in the body, and table data is written directly in Markdown.

## Development and checks

From the repository root:

| Command | Purpose |
| --- | --- |
| `npm run build` | Language package and type declarations, output to `dist-library/` |
| `npm run build:demo` | Build the language package and app, output to `demo/dist/` |
| `npm run dev:lib` | Watch and rebuild the language package |
| `npm test` | Language, runtime and renderer tests |
| `npm run test:demo` | Build the library and check the Playground examples |
| `npm run test:browser` | Browser interaction checks for the new syntax |
| `npm run test:toolbar` | Editor toolbar and native component insertion checks |
| `npm run test:docs` | Local documentation links and navigation anchors |
| `npm run test:package` | Public package entries, examples and style boundaries; build first |

Changes to app sources hot-reload. After changing the language library, run `npm run build:lib` again, or run `npm run dev:lib` in a separate terminal.

Browser checks require local Edge and a running server. They target `http://127.0.0.1:5173` by default; set `DEMO_URL` to use another address. Reports and screenshots are written to `demo/artifacts/`.

## Integration

Host applications use the public API described in [local mode integration](../docs/local-integration-en.md).
