# Reactive MD

[中文](README-ch.md)

Write local interactive documents in Markdown. Add input controls, name parameters with `bind`, and connect prose, formulas, charts and diagrams with `{{ expressions }}`. Document authors do not write JavaScript or CSS.

Local mode uses HTML-style tags, with parameters and table data written directly in the prose; LaTeX formulas can drive function plots. The TypeScript core and the React renderer can be integrated independently. `0.4.0` is the preview release on the `next` channel, with syntax revision `local-draft-2`. See [README-ch.md](README-ch.md) for the Chinese overview.

## Start here

- [Beginner guide](docs/local-guide-en.md): move from Markdown to interactive documents, with a complete exercise and an error quick reference.
- [Local interaction syntax specification](docs/local-interaction-syntax-en.md) · [Feature tours and examples](examples/local/README.md): 48 tag names, tags, in-place parameters and LaTeX plots.
- [Local mode integration](docs/local-integration-en.md): `compileLocal`, the state runtime, React embedding, URL policy and style scoping.
- [Shareable documents and static export](docs/shareable-export-en.md): single-file interactive HTML, static output, versioned state files, assets, the CLI and the standalone browser API.
- [Theme protocol](docs/theme-protocol-en.md): document theme selection, custom CSS and light/dark modes.
- [Author tools](docs/author-tools-en.md): source highlighting, completion, binding navigation, rename, formatting and command-line lint.
- [Standalone integration examples](examples/integration/README.md): Node core and React pages you can copy and run outside the repository.
- [Versions and compatibility](docs/compatibility-en.md): 0.x rules, migration, the diagnostics contract and supported platforms.
- [Component protocol](docs/component-protocol-en.md) · [Component development guide](docs/component-development-en.md): declarations, behavior contracts and compatibility acceptance for new components.
- [0.4.0 release and migration](docs/release-0.4.0-en.md): what this release adds and how to upgrade from `0.3.1` / `local-draft-1`.

## Write a document

```markdown
<panel title="Cost estimate">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.
```

Inputs update the result immediately, and the panel includes a restore-defaults action. A standalone counter is a single line: `<counter label="People">`.

`0.4.0` adds `local-draft-2`, named calculations, validation, collections, themes and offline HTML export. `0.3.1`, still the `latest` package, uses `local-draft-1`. See [0.4.0 release and migration](docs/release-0.4.0-en.md).

## Install

Reactive MD requires Node.js 22.12 or newer and ships only ESM entries:

```sh
npm install reactive-md@next
```

The `next` channel resolves to `0.4.0`; pin it with `npm install reactive-md@0.4.0`. The `latest` tag remains `0.3.1`, which uses `local-draft-1` and needs no migration from `0.3.x`.

The `reactive-md` entry provides the local compiler, expressions and runtime; `reactive-md/react` provides the React renderer. Import component styles from `reactive-md/styles.css`.

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

See [Local mode integration](docs/local-integration-en.md) for the full compile and runtime APIs, host URL policy, lifecycle and style overrides.

0.x minor releases may contain breaking changes. Before upgrading, read the [changelog](CHANGELOG.md) and [compatibility rules](docs/compatibility-en.md), and keep the original `.reactive.md` sources.

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

`LocalReactiveDocument` compiles and manages the runtime for you. To control compilation, lifecycle or URL policy yourself, use `LocalDocumentView` as described in [Local mode integration](docs/local-integration-en.md).

## Share documents

Build a self-contained HTML file that readers can open offline, or a script-free static snapshot:

```sh
npm run build
npx reactive-md build examples/local/counter.reactive.md -o counter.html
npx reactive-md build examples/local/counter.reactive.md -o counter-static.html --mode static
```

The interactive file embeds the original source, React 19, the runtime, styles and any verified local images. It hydrates a static first screen, so it remains readable with JavaScript disabled. Use `--state-file doc.state.json` to export a saved `reactive-md-state/v1` baseline; without it, the author initial values are used and become the reader's reset baseline. The demo export dialog can save the current preview parameters as such a file.

See [Shareable documents and static export](docs/shareable-export-en.md) for image limits, CSP/security, printing, exit codes, `ReactiveMD.mount`/`mountAll` and `<reactive-md-doc>`.

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

- [Beginner guide](docs/local-guide-en.md) and [local interaction syntax specification](docs/local-interaction-syntax-en.md).
- [Local mode integration](docs/local-integration-en.md): core and React API, URL policy, lifecycle, styling and version pinning.
- [Shareable documents and static export](docs/shareable-export-en.md): CLI build/lint, state files, local image inlining, printing and the standalone browser runtime.
- [Feature tours and examples](examples/local/README.md) and [standalone integrations](examples/integration/README.md).
- [Versions and compatibility](docs/compatibility-en.md): 0.x rules, migration, diagnostics and supported platforms.
- [0.4.0 release and migration](docs/release-0.4.0-en.md): the upgrade checklist for this release.
- [Component protocol](docs/component-protocol-en.md) and [component development guide](docs/component-development-en.md): contribution contracts, a proposal template and acceptance cases.
- [Performance measurements](docs/performance-en.md) and [release checklist](docs/releasing-en.md).

See the [contributing guide](CONTRIBUTING.md) for development and test commands.

## Support and status

- CI targets Node 22.12 and Node 24 with Playwright Chromium; local browser checks use Microsoft Edge. The packed check covers static SSR, and `npm run test:shareable` covers the single-file export's static-first hydration. General SSR hydration outside that path, Firefox and WebKit remain unverified.
- 0.x minor releases may contain breaking changes. Persist the original `.reactive.md` source, not the runtime AST or in-memory state.
- `0.4.0` is published on the `next` channel; `0.3.1` remains `latest` until a separate promotion decision. Security fixes may ship in minor releases.

## Contributing and security

- [Contributing guide](CONTRIBUTING.md): environment, check commands and change requirements.
- [Security policy](SECURITY.md): threat boundary, resource limits, host responsibilities and vulnerability reporting.
- [Changelog](CHANGELOG.md).
- [Release checklist](docs/releasing-en.md): the verification gate, notices, tarball and the manual release flow for maintainers.

## License

[MIT](LICENSE)
