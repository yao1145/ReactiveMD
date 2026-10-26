# Shareable documents and static export

This guide covers the single-file HTML exporter introduced with `local-draft-2`. It complements [Local mode integration](local-integration-en.md), the [syntax reference](../reference/local-interaction-syntax-en.md), [Source revisions and migration](../compatibility/source-versioning-en.md) and the [0.4.0 release notes](../releases/release-0.4.0-en.md).

## Output modes

The rules below describe default ReactiveMD documents. Native HTML interactive export preserves `compileOptions` and whole-document HTML routing; static export disables author JavaScript. These documents have no ReactiveMD parameters. See [HTML compatibility](../reference/html-compatibility-en.md) for capability flags, isolation and the temporary routing policy.

**Interactive HTML** is one self-contained `.html` file. It embeds the original source, the standalone browser runtime, React 19, the current stylesheet and print styles. Readers can open it through `file://` without Node.js, React, the reactive-md package or network access.

The first rendered pass is static. After the embedded runtime hydrates it, controls become interactive. With JavaScript disabled the same static values, tables, formulas and charts remain readable. Refreshing restores the exported baseline; the reader's changes are not persisted.

**Static HTML** (`--mode static`) contains read-only values and no executable script cargo. It is intended for archives, static sites and email attachments. Interactive action buttons, form widgets and the reset action are removed.

Both modes use the same renderer as the React integration, so conditional content, interpolation, tables, formulas, charts and layout follow the runtime state.

## CLI

The package exposes the `reactive-md` command. HTML builds require React 19 and React DOM in the project that installs the package; `lint` and `migrate` do not.

```sh
reactive-md build doc.reactive.md -o doc.html
reactive-md build doc.reactive.md -o doc.html --mode static
reactive-md build doc.reactive.md -o doc.html --state-file doc.state.json
reactive-md build doc.reactive.md -o doc.html --assets omit
reactive-md lint "docs/**/*.reactive.md"
reactive-md lint "docs/**/*.reactive.md" --json --strict
```

Build options:

| Option | Meaning |
| --- | --- |
| `-o, --output <file>` | Required output path. Its parent directory must already exist. |
| `--mode interactive\|static` | Output mode. Default: `interactive`. |
| `--state-file <json>` | Use a validated `reactive-md-state/v1` file as the starting and reset baseline. |
| `--assets inline\|omit` | Inline verified local raster images (default) or leave the renderer's alt fallback. |
| `--asset-root <dir>` | Additional local directory that relative image paths may resolve inside. |
| `--locale en\|zh` | Renderer labels and validation messages. Default: `en`. |
| `--color-scheme auto\|light\|dark` | Document color mode. Default: `auto`. |
| `--title <text>` | Override the HTML title. The first heading or the input filename is used otherwise. |
| `--strict` | Fail on compiler warnings; with `--assets omit`, fail when images are omitted. |

Exit codes are separate so build automation can distinguish failures:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Usage or argument error |
| `3` | Document compile, render, React, or packaged-artifact failure |
| `4` | Input/output file failure |
| `5` | Asset or security-policy failure |

The CLI does not use a current preview implicitly. `--state-file` is the only way to select a non-initial baseline. `format` is not part of this release.

## Migrating source

`reactive-md migrate` moves one source revision declaration to `local-draft-2`:

```sh
reactive-md migrate old.reactive.md --from local-draft-1 -o new.reactive.md
reactive-md migrate old.reactive.md --check --json
```

By default it prints the migrated source to standard output. `-o` creates a new file with exclusive creation and refuses any existing path, including the input. `--check` never writes. `--json` prints a structured report and nothing else. `--accept-semantic-changes` allows the text-control length change and reports warnings; `--locale en|zh` selects the display language.

A migration exits `1` when blocked and `0` on success. `--check` exits `1` when changes are needed or blocked, and `0` when the source is current. Usage and I/O errors exit `2`. The command does not overwrite in place and has no batch or `--write` mode. See [Source revisions and migration](../compatibility/source-versioning-en.md) for the checks, preserved bytes and state-digest consequences.

## Starting values and state files

By default, the exported baseline is the document's author initial values. This keeps builds repeatable and avoids leaking trial inputs.

A state file has this versioned shape:

```json
{
  "format": "reactive-md-state/v1",
  "syntax": "local-draft-2",
  "sourceDigest": "fnv1a32:0123abcd",
  "parameters": {
    "people": 7,
    "plan": "pro"
  },
  "generator": { "name": "example-host", "version": "1.0.0" }
}
```

Only public, serializable binding values are stored. The file identifies the document through `sourceDigest` and the language revision through `syntax`. Internal bindings (names beginning with `@`), revisions, node IDs, AST data, timers, open panels and focus are never persisted; internal snapshot keys and IDs are implementation details, not a storage format.

Resolution verifies the source digest, syntax revision, exact public parameter set and every value against the document's constraints. Unknown, missing or invalid parameters reject the file with a named diagnostic; a mismatched file is never partially applied. Slot controls such as `<range-slider>` are validated atomically.

The selected state becomes the document's reset baseline. Opening, refreshing and the panel reset action therefore return to the exported values, not to a different hidden default.

Hosts can create and apply the same file without the CLI:

```ts
import { exportLocalState, importLocalState } from 'reactive-md';

const file = exportLocalState(runtime, { name: 'example-host', version: '1.0.0' });
const saved = JSON.stringify(file);

const diagnostics = importLocalState(runtime, saved);
```

`exportLocalState` reads public parameters only. `importLocalState` validates the source digest, syntax, parameter set and constraints, then applies the values; a failed import leaves the runtime unchanged. Both are explicit host calls: the runtime still does not save or send state by itself. Use `resolveLocalState(document, input)` to validate without touching a live runtime.

The demo's export dialog can download the current preview parameters as a state file for a later CLI build. The lower-level `createLocalStateFile`, `parseLocalState`, `applyLocalState` and `serializeLocalState` remain available from `reactive-md`.

## Images

### Browser

Use **Document images** in the demo to select files, or paste an image into the source editor. Accepted files create a Markdown reference at the selection and appear in the resource list. The list shows each source URL, format, size and whether the document references it; files can be replaced or removed. Imports are checked as a batch: an invalid file leaves the source and manifest unchanged.

PNG, JPEG, GIF and WebP are checked by content, declared MIME type and browser decoding. Limits are 8 MiB per image, 24 MiB total and 64 resources. SVG is unsupported. Resources are saved in IndexedDB for the current document and language; a storage warning means they remain available only for this page session.

The export dialog lists missing image references and lets you choose a local file for each one, including a local replacement for a remote URL. It never fetches remote images. All references must be supplied before HTML export. Both interactive and static exports inline the referenced files; unused resources stay out of the export. Markdown and state downloads contain no image files.

These browser resource controls apply to the ReactiveMD route, including P0 `<img>` elements. Native HTML routing keeps its separate image policy.

### CLI

Offline export defaults to `--assets inline`:

- Only relative paths that resolve inside the document directory, or an explicit `--asset-root`, are read.
- Absolute paths, URL schemes, protocol-relative URLs, backslashes, path traversal and symlink escapes are rejected.
- Remote images are never fetched.
- PNG, JPEG, GIF and WebP are detected by file contents; SVG, forged MIME types and unknown formats are rejected.
- Files are limited to 8 MiB each, 24 MiB total and 64 distinct payloads. Identical content is deduplicated.
- Alt text is preserved. A failure stops the build by default. `--assets omit` is the explicit opt-out and leaves the alt fallback.

The renderer's global security boundary is unchanged: images are still rejected by default unless a host URL policy explicitly allows them. The exporter supplies a host policy and image resolver after it has verified each local file.

## Single-file security and printing

The HTML shell includes:

- a CSP that disallows connections, frames, objects, base URL changes and form submission while allowing the inline stylesheet/runtime and `data:` images;
- HTML- and script-context escaping for JSON, source, titles and license notices;
- the MIT and third-party notices in a non-executed `<template>`;
- no CDN or remote stylesheet, font or runtime.

Clicking an ordinary external link can still navigate, but opening the document itself performs no remote request. The exporter is not a sandbox for fully untrusted authors; use a sandboxed iframe when that threat model applies.

Printing does not require a temporary state switch. The current runtime values are rendered in print-only nodes, so `Ctrl+P` prints the state the reader currently sees. Print CSS forces a light paper theme, hides toolbars and controls, uses printer-owned page margins, keeps headings with following content, repeats table headers, wraps long code and URLs, and constrains charts to page width. Static HTML already contains only read-only values.

## Standalone runtime API

The build emits `dist-standalone/reactive-md-standalone.js` (IIFE, global `ReactiveMD`) and `reactive-md-standalone.css`. Load the stylesheet and script as classic browser assets:

```html
<link rel="stylesheet" href="reactive-md-standalone.css">
<script src="reactive-md-standalone.js"></script>
```

Programmatic mounting:

```js
const handle = ReactiveMD.mount(document.getElementById('doc'), {
  source: '# Hello\n\n<slider bind="n" label="Count" initial="2">\n\nValue: {{ n }}',
  locale: 'en',
  colorScheme: 'auto',
});
handle.getState(); // reactive-md-state/v1 snapshot
handle.unmount();
```

`ReactiveMD.mountAll(root)` scans only once for safe auto-mount payloads:

```html
<div id="doc"></div>
<script type="application/reactive-md+json" data-reactive-md-auto>
{"version":1,"target":"doc","source":"# Hello","state":{"format":"reactive-md-state/v1","syntax":"local-draft-2","sourceDigest":"fnv1a32:01209266","parameters":{}},"locale":"en","colorScheme":"auto","hydrate":false}
</script>
```

Targets are resolved by `id`, never by an interpolated selector. Payload source is data, not executable markup. Raw `<script type="text/reactive-md">` text is deliberately not interpreted.

### `<reactive-md-doc>`

The IIFE registers a light-DOM custom element. Simple options are attributes; complex options are DOM properties.

```html
<reactive-md-doc src="./doc.reactive.md" locale="en" color-scheme="auto"></reactive-md-doc>
```

- Attributes: `src`, `source`, `locale`, `color-scheme`, `theme`.
- Properties: `source`, `state`, `urlPolicy`, `imageResolver`, `themes`.
- Events: `reactive-md-diagnostics` and `reactive-md-state-change`.
- `src` uses `fetch` with cancellation; an explicit source avoids network access.
- Disconnecting aborts fetches, removes subscriptions and the React root, and disposes the runtime. Two elements with the same source have independent state.

The element uses Light DOM so the existing document CSS, heading anchors and print styles apply. Shadow DOM is intentionally out of scope for this release.

## Security boundaries

- Core and React entry points keep React external. Only the standalone IIFE bundles React.
- The core entry remains React-free.
- State export and import use only public binding names and validated values.
- Exported HTML does not persist a reader's changes.
- The demo previews and exports images supplied through its document resource list. Missing references block HTML export until files are selected.
- The export format version is `reactive-md-html/v1`; inspect it in the generated meta tags.

## Bundle baseline

`npm run test:shareable` records the standalone artifact size and fails above these regression alarms:

| Artifact | Current baseline | Alarm |
| --- | --- | --- |
| `reactive-md-standalone.js` | ≈925 kB (≈276 kB gzip) | 1024 KiB / 320 KiB gzip |
| `reactive-md-standalone.css` | ≈81.2 kB (≈13.5 kB gzip) | 80 KiB / 20 KiB gzip |

The 0.5 baseline includes the syntax highlighter and common language grammars for offline use.

Sizes vary slightly with the minifier and React patch release. The alarm is intentionally well above normal noise while catching a React or renderer duplication regression. The full generated HTML also contains the source, notices and inline images, so it is larger than this baseline.

## Current scope

Included: CLI `build`/`lint`/`migrate`, interactive and static HTML, state files, local raster inlining, print output, standalone mount APIs, auto-mount, and the Web Component.

Not included in this release: `format`, UMD, remote image fetching, SVG inlining, framework plugins (Vite, Astro, Docusaurus, Next.js), Shadow DOM, and general SSR hydration guarantees outside the single-file export path.

Single-file static-first hydration is covered by the Playwright Chromium checks and local Edge checks. Firefox, Safari/WebKit and general server-side hydration remain unverified and are not claimed as supported.
