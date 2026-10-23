# Reactive MD Playground

The Playground opens with a short calculator and six [feature tours](../examples/local/showcase/README.md): functions, forms, data and charts, layout, diagrams, and checklists and timing. Each tour follows one example from a suggested change to the visible result, with key source snippets at the end. English and Chinese versions are available throughout.

Presentation mode shows the document at full width. Choose "Show source" to edit Markdown beside its live preview, or "Presentation mode" to return without resetting the current controls. The reference menu contains the component gallery and an intentionally broken diagnostics example; choosing diagnostics opens the editor. If you are new to the syntax, start with the [getting-started guide](../docs/local-guide-en.md).

On phones, open the feature menu to choose a tour. It closes after selection to leave room for the document; import and export tools appear when source editing is open.

Compile errors are listed by source position. The editor toolbar has common Markdown formatting and a searchable menu for inserting native components.

The "User Guide" view at the top of the page renders `docs/local-guide-en.md` directly, covering everything from your first interactive document to charts, function curves and a quick error reference. Documentation links in the guide point to the repository, and table-of-contents anchors jump within the page.

The masthead has a language toggle: `中` switches the whole demo to Chinese and `EN` switches back. English is the default. The choice is saved in the browser, each language keeps its own example drafts and guide (`docs/local-guide-ch.md` for Chinese), and the Playground preview is rendered with the matching locale.

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

Start with Quick start, then choose a feature in the navigation:

| Tour | What to try |
| --- | --- |
| Functions & formulas | Flatten a sine wave, compare curves, then explore piecewise functions and savings growth |
| Forms & bindings | Configure a workshop and watch its summary, estimate and preparation notes change |
| Data & charts | Change an expense and compare the shared totals, table, bar chart, donut and scatter plot |
| Content & layout | Switch reading roles and explore cards, tabs, tooltips and disclosures |
| Diagrams & flow | Follow a headcount from input to calculation and displayed result |
| Checklists & timing | Prepare a workshop, track completion, count attendees and run a timer |

Feature sources live in `examples/local/showcase/`, with Chinese versions in its `zh/` directory. Quick start, component reference and diagnostics use the corresponding files in `examples/local/` and `examples/local/zh/`. The original standalone examples remain available through the [example catalog](../examples/local/README.md).

The Playground uses the library through `compileLocal`, `createLocalRuntime` and the `reactive-md/react` renderer entry. Controls declare parameters in the body, and table data is written in Markdown. Table search and sorting affect that table; charts continue to show the full data.

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
| `npm run test:showcase --workspace=@reactive-md/demo` | Feature-tour interactions and phone, tablet and desktop layouts in both languages |
| `npm run test:grid-layout --workspace=@reactive-md/demo` | Nested grids and 1–4 columns across narrow panes and embedded containers |
| `npm run test:toolbar` | Editor toolbar and native component insertion checks |
| `npm run test:docs` | Local documentation links and navigation anchors |
| `npm run test:package` | Public package entries, examples and style boundaries; build first |

Changes to app sources hot-reload. After changing the language library, run `npm run build:lib` again, or run `npm run dev:lib` in a separate terminal.

Browser checks require local Edge and a running server. They target `http://127.0.0.1:5173` by default; set `DEMO_URL` to use another address. Reports and screenshots are written to `demo/artifacts/`.

## Integration

Host applications use the public API described in [local mode integration](../docs/local-integration-en.md).
