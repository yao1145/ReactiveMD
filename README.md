# Reactive MD

[English](README-en.md) · [中文](README-ch.md)

Write local interactive documents in Markdown. Add input controls, name parameters with `bind`, and connect prose, formulas, charts and diagrams with `{{ expressions }}`. Document authors do not write JavaScript or CSS.

Local mode uses HTML-style tags, with parameters and table data written directly in the prose; LaTeX formulas can drive function plots. The TypeScript core and the React renderer can be integrated independently. The current preview is `0.3.1` with syntax revision `local-draft-1`. See [README-ch.md](README-ch.md) for the Chinese overview.

## Start here

- [Beginner guide](docs/local-guide-en.md): move from Markdown to interactive documents, with a complete exercise and an error quick reference.
- [Local interaction syntax specification](docs/local-interaction-syntax-en.md) · [12 examples](examples/local/README.md): 33 component names, tags, in-place parameters and LaTeX plots.
- [Local mode integration](docs/local-integration-en.md): `compileLocal`, the state runtime, React embedding, URL policy and style scoping.
- [Standalone integration examples](examples/integration/README.md): Node core and React pages you can copy and run outside the repository.
- [Versions and compatibility](docs/compatibility-en.md): 0.x rules, migration, the diagnostics contract and supported platforms.
- [Component protocol](docs/component-protocol-en.md) · [Component development guide](docs/component-development-en.md): declarations, behavior contracts and compatibility acceptance for new components.
- [Demo notes](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md).

## Write a document

```markdown
<panel title="Cost estimate">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.
```

Inputs update the result immediately, and the panel includes a restore-defaults action. A standalone counter is a single line: `<counter label="People">`.

## Install

Reactive MD requires Node.js 22.12 or newer and ships only ESM entries:

```sh
npm install reactive-md@0.3.1
```

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
- [12 examples](examples/local/README.md) and [standalone integrations](examples/integration/README.md).
- [Versions and compatibility](docs/compatibility-en.md): 0.x rules, migration, diagnostics and supported platforms.
- [Component protocol](docs/component-protocol-en.md) and [component development guide](docs/component-development-en.md): contribution contracts, a proposal template and acceptance cases.
- [Performance measurements](docs/performance-en.md) and [release checklist](docs/releasing-en.md).

See the [contributing guide](CONTRIBUTING.md) for development and test commands.

## Support and status

- Node 22.12, Node 24 and Playwright Chromium pass CI; Microsoft Edge is verified locally. Static SSR is covered by the packed check. Firefox, WebKit and SSR hydration remain unverified.
- 0.x minor releases may contain breaking changes. Persist the original `.reactive.md` source, not the runtime AST or in-memory state.
- The project maintains the latest 0.x preview. Security fixes may ship in minor releases.

## Contributing and security

- [Contributing guide](CONTRIBUTING.md): environment, check commands and change requirements.
- [Security policy](SECURITY.md): threat boundary, resource limits, host responsibilities and vulnerability reporting.
- [Changelog](CHANGELOG.md).
- [Release checklist](docs/releasing-en.md): package name, notices, tarball and the manual release flow for maintainers.

## License

[MIT](LICENSE)
