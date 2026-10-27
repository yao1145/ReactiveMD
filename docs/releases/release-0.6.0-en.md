# 0.6.0 release

`reactive-md@0.6.0` is a 0.x preview that updates both `latest` and `next`. It keeps syntax revision `local-draft-2`, component protocol `component-protocol-2` and theme protocol `reactive-md-theme-1`. Existing imports and documents need no migration.

```sh
npm install reactive-md
# or pin the version
npm install reactive-md@0.6.0
```

For offline installation, use the [npm tarball](https://registry.npmjs.org/reactive-md/-/reactive-md-0.6.0.tgz).

## Native HTML

The default P0 HTML path now supports native tables. When a `<table>` body contains `caption`, `colgroup`, `thead`, `tbody`, `tr`, `th` or `td`, it renders as an HTML table with `colspan`, `rowspan`, `scope`, `headers` and column-group `span`, without enabling extended HTML. Native and Markdown tables share the frame, caption, cell styles and narrow-screen scrolling; numeric columns keep the same automatic alignment. Native tables do not add search, sort, paging or row selection, and Markdown, formulas, interpolation and controls inside cells keep working. Mixing Markdown table rows with HTML structure produces a diagnostic and shows that table as source.

`div`, `p` and `h1` through `h6` accept a static `align` attribute with `left`, `center`, `right` or `justify`. Links accept explicit `target` and `rel`: HTTP(S) links without attributes still open in a new window, `target="_blank"` keeps author relationship words, merges `noopener noreferrer` and removes `opener`, and relative links still open in the current page.

Unparseable native HTML fragments now display as source instead of failing the whole document; the remaining Markdown, formulas and controls keep rendering. New `local.html.fallback` and `local.html.fallbackAttribute` warnings mark elements converted to inert source because of an unsupported tag or attribute. React previews and standalone mounts show the full source, with line breaks preserved and tags escaped, when whole-document HTML parsing fails.

## Math layout

Prose accepts `\(...\)` for inline math and `\[...\]` for display math through the same renderer as the dollar delimiters; plots still accept only `$$...$$`.

Display adds the `aligned`, `align`, `align*`, `pmatrix`, `bmatrix` and `vmatrix` environments with `\tag` numbering. It also adds `\mathbb`, `\mathcal`, `\mathscr`, `\mathfrak`, `\textbf`, `\textit`, labeled arrows, `\big` delimiter sizes and commands such as `\sec`, `\sinh` and `\pmod`.

Chemistry uses mhchem `\ce{...}`, for example `$\ce{H2O}$` or `$$\ce{2 H2 + O2 -> 2 H2O}$$`. `mhchemparser` converts subscripts, ionic charges, isotopes, states and reaction arrows before the shared MathML renderer; conversion is bounded by length, token and nesting budgets, and unsupported commands produce `local.math.display` diagnostics.

## Code fences

New highlighting covers `cattca`, `mermaid` and `vue`. Vue single-file components highlight templates, JavaScript/TypeScript and CSS/SCSS as separate regions; Cattca highlights Markdown prose and command blocks; Mermaid fences highlight source only and do not render diagrams. Unlabeled blocks keep the restricted automatic detection, and unknown languages or blocks longer than 20,000 characters stay plain text.

## Diagrams and tooltips

Node/edge diagrams now use a layered layout: source order sets order within a layer, cycles are grouped, parallel edges and label positions are computed by the layout, and edges use smooth paths. Server rendering and the first paint still emit a deterministic synchronous layout, then swap to the final layout after mount.

Tooltips stay inside the viewport and reposition on scroll, zoom and content-size changes. Their colors follow the document's light, dark and custom themes.

## Forms and host APIs

Required text, textarea and date controls no longer set the native `required` attribute. They use `aria-required` and the existing local validation instead. Inside a host form, an empty control no longer blocks submission or the Enter action with a browser validation bubble.

`compileLocal` now returns only plain objects and arrays, so results can cross a React Server Components boundary safely while frozen metadata and shared references stay intact.

The editor ref handle adds `insertText(text)`, which replaces the current selection, records one undoable edit and places the caret after the inserted text.

## Compatibility

Existing entries, imports and document syntax are unchanged; documents written for `0.5.x` need no edit. Native HTML tables and the new math commands only add recognized forms; source that previously displayed as ordinary text may now render as HTML or a formula. Two dependencies are bundled into the build: `elkjs` (EPL-2.0 OR GPL-3.0-or-later) and `mhchemparser` (Apache-2.0); `THIRD_PARTY_NOTICES.md` is updated.

`latest` moves from `0.4.0` to `0.6.0`, and `next` moves from `0.5.3` to `0.6.0`. See the [changelog](../../CHANGELOG.md) and [Versions and compatibility](../compatibility/compatibility-en.md) for the version axes and migration rules.

## Validation and limits

The release uses the full `npm run verify:release` gate: core and Demo tests, type checking, builds, third-party notices, package entries, documentation links, real tarball consumption outside the repository and browser interaction. CI runs the Node gate on Node 22.12 and 24; the browser gate runs the full suite on Chromium and core workflows on Firefox and WebKit. Local browser checks use Microsoft Edge. The full Firefox and WebKit interaction suites and general SSR hydration outside exported HTML remain unverified.

The project remains a 0.x preview. Security boundaries and host responsibilities are documented in [SECURITY.md](../../SECURITY.md).
