# Reactive MD

[中文](README-ch.md)

Write local interactive documents in Markdown. Add input controls, name parameters with `bind`, and connect prose, formulas, charts and diagrams with `{{ expressions }}`. Document authors do not write JavaScript or CSS.

Local mode uses HTML-style tags, with parameters and table data written directly in the prose; LaTeX formulas can drive function plots. The TypeScript core and the React renderer can be integrated independently. `0.6.1` is available on both `latest` and `next` and switches formula display to KaTeX with bundled math fonts and offline HTML support. Syntax revision stays `local-draft-2`, and the component protocol is `component-protocol-2`. See [README-ch.md](README-ch.md) for the Chinese overview.

## Start here

- [Documentation index](docs/README.md): guides, references, integration, compatibility, development and releases.
- [Beginner guide](docs/guides/local-guide-en.md): move from Markdown to interactive documents, with a complete exercise and an error quick reference.
- [Local interaction syntax specification](docs/reference/local-interaction-syntax-en.md) · [Feature tours and examples](examples/local/README.md): 49 tag names, tags, in-place parameters and LaTeX plots.
- [Local mode integration](docs/integration/local-integration-en.md): `compileLocal`, the state runtime, React embedding, URL policy and style scoping.
- [HTML compatibility](docs/reference/html-compatibility-en.md): P0 HTML and the next release's temporary routing policy for author CSS, JavaScript and extended HTML.
- [Shareable documents and static export](docs/integration/shareable-export-en.md): single-file interactive HTML, static output, versioned state files, assets, the CLI and the standalone browser API.
- [Theme protocol](docs/reference/theme-protocol-en.md): document theme selection, custom CSS and light/dark modes.
- [Author tools](docs/integration/author-tools-en.md): source highlighting, completion, binding navigation, rename, formatting and command-line lint.
- [React source editor](docs/integration/editor-en.md): controlled editor, props, ref handle, diagnostics, locale, theme and history.
- [Standalone integration examples](examples/integration/README.md): Node core and React pages you can copy and run outside the repository.
- [Versions and compatibility](docs/compatibility/compatibility-en.md): 0.x rules, migration, the diagnostics contract and supported platforms.
- [Component protocol](docs/development/component-protocol-en.md) · [Component development guide](docs/development/component-development-en.md): declarations, behavior contracts and compatibility acceptance for new components.
- [0.6.1 release notes](docs/releases/release-0.6.1-en.md): KaTeX formula display, bundled fonts and offline math.
- [0.5.3 release notes](docs/releases/release-0.5.3-en.md): host integration and authoring patches.
- [0.5.1 release notes](docs/releases/release-0.5.1-en.md): editor views and themes, plus HTML compatibility.
- [0.5.0 release notes](docs/releases/release-0.5.0-en.md): the editor entry and document rendering fixes.
- [0.4.1 release notes](docs/releases/release-0.4.1-en.md): visual and interaction fixes, compatible with 0.4.0.
- [0.4.0 release and migration](docs/releases/release-0.4.0-en.md): what the minor series adds and how to upgrade from `0.3.1` / `local-draft-1`.

## Write a document

```markdown
<panel title="Cost estimate">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.
```

Inputs update the result immediately, and the panel includes a restore-defaults action. A standalone counter is a single line: `<counter label="People">`.

`0.4.0` adds `local-draft-2`, named calculations, validation, collections, themes and offline HTML export. The earlier `0.3.1` release uses `local-draft-1`. See [0.4.0 release and migration](docs/releases/release-0.4.0-en.md).

## Install

Reactive MD requires Node.js 22.12 or newer and ships only ESM entries:

```sh
npm install reactive-md
```

`latest` and `next` both resolve to `0.6.1`:

```sh
npm install reactive-md
# or pin the version
npm install reactive-md@0.6.1
```

Read the [0.6.1 release notes](docs/releases/release-0.6.1-en.md) for this release, and the [migration guide](docs/releases/release-0.4.0-en.md) before upgrading from `0.3.1` / `local-draft-1`.

The `reactive-md` entry provides the local compiler, expressions and runtime; `reactive-md/react` provides the React renderer. Import component styles from `reactive-md/styles.css`. The `reactive-md/editor` entry provides the source editor with its own stylesheet at `reactive-md/editor/styles.css`. Existing renderer and style imports are unchanged in 0.6.1.

The core `reactive-md` entry does not depend on React:

```js
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal('<number bind="n" label="Count" initial="2">');
if (result.ok) {
  const runtime = createLocalRuntime(result.document);
  try { console.log(runtime.text('Total: {{ n * 100 }}')); }
  finally { runtime.dispose(); }
}
```

See [Local mode integration](docs/integration/local-integration-en.md) for the full compile and runtime APIs, host URL policy, lifecycle and style overrides.

0.x minor releases may contain breaking changes. Before upgrading, read the [changelog](CHANGELOG.md) and [compatibility rules](docs/compatibility/compatibility-en.md), and keep the original `.reactive.md` sources.

## Use with React

The React entry requires React 19:

```sh
npm install react@19 react-dom@19
```

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} />;
}
```

`LocalReactiveDocument` compiles and manages the runtime for you. To control compilation, lifecycle or URL policy yourself, use `LocalDocumentView` as described in [Local mode integration](docs/integration/local-integration-en.md).

## Edit source with React

The 0.5.x preview adds a reusable source editor at `reactive-md/editor`, with its own stylesheet at `reactive-md/editor/styles.css`. The component is controlled and requires React 19:

```tsx
import { useState } from 'react';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import 'reactive-md/editor/styles.css';

export function Editor() {
  const [source, setSource] = useState('# Notes');
  return <ReactiveMarkdownEditor value={source} onChange={setSource} />;
}
```

The editor handles highlighting, formatting and insertion tools, completion, binding tools, undo and redo, and line numbers. It does not compile or render a preview; keep the source in your app and render it with `reactive-md/react`. See [React source editor](docs/integration/editor-en.md) for the props, ref handle, diagnostics, themes, locales and history.

## Share documents

Build a self-contained HTML file that readers can open offline, or a script-free static snapshot:

```sh
npm run build
npx reactive-md build examples/local/counter.reactive.md -o counter.html
npx reactive-md build examples/local/counter.reactive.md -o counter-static.html --mode static
```

The interactive file embeds the original source, React 19, the runtime, styles and any verified local images. It hydrates a static first screen, so it remains readable with JavaScript disabled. Use `--state-file doc.state.json` to export a saved `reactive-md-state/v1` baseline; without it, the author initial values are used and become the reader's reset baseline. The demo export dialog can save the current preview parameters as such a file.

See [Shareable documents and static export](docs/integration/shareable-export-en.md) for image limits, CSP/security, printing, exit codes, `ReactiveMD.mount`/`mountAll` and `<reactive-md-doc>`.

## Try the demo

```sh
npm ci
npm run dev
```

The command builds the language package first, then starts the standalone `demo/` app at `http://127.0.0.1:5173`. `/embed.html` demonstrates the embedding approach. The masthead language toggle switches the demo between English and Chinese, and the choice is saved in the browser. The demo pages, editor, demo server, assets and browser checks all live in `demo/` and integrate through the package's public entries.

## Repository layout

```text
src/           Local syntax compilation, expressions, runtime and React renderer
examples/      Copyable local interactive examples, independent of the demo app
docs/          Local syntax specification, integration and release documentation
tests/         Language and renderer tests
demo/          Standalone Playground app
```

## Documentation

- [Beginner guide](docs/guides/local-guide-en.md) and [local interaction syntax specification](docs/reference/local-interaction-syntax-en.md).
- [Local mode integration](docs/integration/local-integration-en.md): core and React API, URL policy, lifecycle, styling and version pinning.
- [Shareable documents and static export](docs/integration/shareable-export-en.md): CLI build/lint, state files, local image inlining, printing and the standalone browser runtime.
- [Feature tours and examples](examples/local/README.md) and [standalone integrations](examples/integration/README.md).
- [React source editor](docs/integration/editor-en.md): controlled editor for `.reactive.md` source, with its own stylesheet.
- [Versions and compatibility](docs/compatibility/compatibility-en.md): 0.x rules, migration, diagnostics and supported platforms.
- [0.6.1 release notes](docs/releases/release-0.6.1-en.md): KaTeX formula display, bundled fonts and offline math.
- [0.5.3 release notes](docs/releases/release-0.5.3-en.md): host integration and authoring patches.
- [0.5.1 release notes](docs/releases/release-0.5.1-en.md): editor views and themes, plus HTML compatibility.
- [0.5.0 release notes](docs/releases/release-0.5.0-en.md): the editor entry and document rendering fixes.
- [0.4.0 release and migration](docs/releases/release-0.4.0-en.md): the upgrade checklist for that minor series.
- [Component protocol](docs/development/component-protocol-en.md) and [component development guide](docs/development/component-development-en.md): contribution contracts, a proposal template and acceptance cases.
- [Performance measurements](docs/development/performance-overview-ch.md) and [release checklist](docs/development/releasing-en.md).

See the [contributing guide](CONTRIBUTING.md) for development and test commands.

## Support and status

- CI targets Node 22.12 and Node 24 with Playwright Chromium for the full browser gate and Firefox/WebKit for core workflows; local browser checks use Microsoft Edge. The packed check covers static SSR, and `npm run test:shareable` covers the single-file export's static-first hydration. General SSR hydration outside that path and the full Firefox/WebKit interaction suites remain unverified.
- 0.x minor releases may contain breaking changes. Persist the original `.reactive.md` source, not the runtime AST or in-memory state.
- `latest` and `next` are both `0.6.1`. Security fixes may ship in minor releases.

## Contributing and security

- [Contributing guide](CONTRIBUTING.md): environment, check commands and change requirements.
- [Security policy](SECURITY.md): threat boundary, resource limits, host responsibilities and vulnerability reporting.
- [Changelog](CHANGELOG.md).
- [Release checklist](docs/development/releasing-en.md): the verification gate, notices, tarball and the manual release flow for maintainers.

## License

[MIT](LICENSE)
