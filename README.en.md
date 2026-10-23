# Reactive MD

Write interactive documents in Markdown. Add input controls, give them names with `bind`, and connect prose, formulas, charts and diagrams with `{{ expressions }}`. Document authors do not write JavaScript or CSS.

The current preview is `0.3.1`, using syntax revision `local-draft-1`.

## Minimal example

```markdown
<panel title="Cost estimate">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }}**.
```

Drag the slider or turn billing on and the result updates immediately. A standalone counter is one line: `<counter label="People">`.

## Install

The package is ESM and requires Node.js 22.12 or newer:

```sh
npm install reactive-md@0.3.1
```

For the React entry, install React 19 as well:

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

The core entry runs in Node without React:

```js
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal('<number bind="n" label="Count" initial="2">');
if (result.ok) {
  const runtime = createLocalRuntime(result.document);
  try { console.log(runtime.text('Total: {{ n * 100 }}')); }
  finally { runtime.dispose(); }
}
```

## Documentation

The author guides are currently in Chinese; API identifiers and types are English.

- [Local integration](docs/local-integration.md): core and React API, URL policy, lifecycle, styling and version pinning.
- [Compatibility](docs/compatibility.md): 0.x rules, migration, diagnostics and supported platforms.
- [Component protocol](docs/component-protocol.md) and [development guide](docs/component-development.md): contribution contracts, a proposal template and conformance cases.
- [Beginner guide](docs/local-guide.md) and [syntax reference](docs/local-interaction-syntax.md).
- [Examples](examples/local/README.md): 12 example documents, including one intentional diagnostics fixture.
- [Standalone integrations](examples/integration/README.md): small Node and React projects you can copy outside the repository.

## Support and status

- Node 22.12, Node 24 and Playwright Chromium pass CI; Microsoft Edge is verified locally. Static SSR is covered by the packed check. Firefox, WebKit and SSR hydration remain unverified.
- 0.x minor releases may contain breaking changes. Persist the original `.reactive.md` source, not the runtime AST or in-memory state.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
