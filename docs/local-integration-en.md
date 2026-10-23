# Local mode integration

Local interaction mode uses HTML-style tags, in-place parameters and `{{ expressions }}`. Author rules are in the [beginner guide](local-guide-en.md) and the [syntax specification](local-interaction-syntax-en.md); complete documents are in the [12 examples](../examples/local/README.md). Hosts explicitly select this mode through the `Local` APIs.

## Runtime and entries

| Entry | Contents | Dependency |
| --- | --- | --- |
| `reactive-md` | `compileLocal`, `createLocalRuntime`, expression and math utilities | No React dependency |
| `reactive-md/react` | `LocalReactiveDocument`, `LocalDocumentView` | React 19 |
| `reactive-md/styles.css` | Component, theme and document styles | Explicitly imported by the host |

The package ships ESM only. Node.js 22.12+ can be used for development and Node-side compilation and runtime. Edge has completed local interaction verification, and static SSR has passed the standalone installation check; see [Versions and compatibility](compatibility-en.md) for the full matrix. Copyable projects are in [Standalone integration examples](../examples/integration/README.md).

## React

Install React in a host that already has Reactive MD; when using TypeScript, also install the matching type packages:

```sh
npm install react@19 react-dom@19
npm install --save-dev @types/react@19 @types/react-dom@19
```

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const source = `# Cost estimate

<panel title="Adjust the plan">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.`;

export function Article() {
  return <LocalReactiveDocument source={source} />;
}
```

| Prop | Type | Component | Notes |
| --- | --- | --- | --- |
| `source` | `string` | `LocalReactiveDocument` | Recompiles and creates a new runtime when the source changes; old instance state is not kept |
| `document` | `LocalDocument` | `LocalDocumentView` | Compiled document; compiled once by the host |
| `runtime` | `LocalRuntime` | `LocalDocumentView` | Created by the host, which is responsible for disposal |
| `onDiagnostics` | `(diagnostics: Diagnostic[]) => void` | Both | Receives compile diagnostics and runtime diagnostics when control writes are rejected |
| `urlPolicy` | `(url: string, kind: 'image' \| 'link') => boolean` | Both | Decides whether to allow an image or link after protocol checks |

Neither component has `className`, `style` or slot props. `LocalReactiveDocument` renders `<article class="md-document local-document">`; `LocalDocumentView` uses the same document container. See below for style overrides.

Each component instance manages in-memory state independently. Changing the source recompiles; disposing an instance clears subscriptions and timers. A panel reset in the document restores its internal parameters, input drafts and component state, and displays of same-name parameters outside the panel update as well.

When compilation fails, the component renders a disabled notice and the diagnostics list, and `onDiagnostics` also receives the diagnostics. Local computation errors during runtime are displayed near the corresponding content while the rest keeps updating.

### Headings and table-of-contents links

Documents can use Markdown table-of-contents links directly, for example `[Parameter description](#parameter-description)` targeting `## Parameter description`. The renderer generates anchors from heading text, appends `-1`, `-2` and so on to duplicate headings, and handles collisions with existing heading names. Emphasis and inline code in headings participate in naming as text; both Chinese and percent-encoded fragment links work.

Each document instance has its own anchor prefix, and matching table-of-contents links target the current instance. The same page can embed multiple copies of the same source. Links still go through protocol checks and the host `urlPolicy` first; the policy receives the raw address written by the author.

Anchors for dynamic headings are computed from source initial values, and parameter changes only update the displayed heading text. Rendered DOM IDs belong to the current mounted instance; when saving a table of contents, keep the fragment links from the source.

## Core API

```ts
import { compileLocal, createLocalRuntime } from 'reactive-md';

const result = compileLocal(source);
if (result.ok) {
  const runtime = createLocalRuntime(result.document);
  const unsubscribe = runtime.subscribe(() => {
    console.log(runtime.snapshot());
  });

  console.log(runtime.evaluate('people * 100'));
  console.log(runtime.text('People: {{ people }}'));

  unsubscribe();
  runtime.dispose();
} else {
  console.log(result.diagnostics);
}
```

### `compileLocal(source: string, options?: LocalCompileOptions)`

`source` is the `.reactive.md` source. The return value is a union:

- Success: `{ ok: true; document: LocalDocument; diagnostics: Diagnostic[] }`
- Failure: `{ ok: false; diagnostics: Diagnostic[] }`

Syntax problems are returned through diagnostics; the current build accepts only `local-draft-1`. The source limit is 1,000,000 characters. `document` is a current runtime object and should not be treated as a persistence format.

Hosts can set the syntax node budget for a single compilation:

```ts
import { compileLocal, type LocalCompileOptions } from 'reactive-md';

const options: LocalCompileOptions = {
  limits: { maxSyntaxNodes: 50_000 },
};
const result = compileLocal(source, options);
```

`limits.maxSyntaxNodes` defaults to 10,000 and accepts integers from `1` to `Number.MAX_SAFE_INTEGER`. Omitting the options, `limits` or `maxSyntaxNodes` uses the default. `0`, negative numbers, decimals, `NaN`, infinity, strings, `null` and malformed option containers return a `local.options.invalid` diagnostic; exceeding the valid node budget returns a `local.budget` diagnostic.

The budget counts `LocalNode` instances created cumulatively during parsing, including Markdown text, paragraphs, lists, tables, interpolations, components and some intermediate nodes, so it may exceed the final syntax tree node count. The setting affects only this compilation, leaves the options object untouched, and keeps other resource limits such as arrays independent. The budget comes from the host; document content cannot raise it on its own.

To use a custom budget in React, call `compileLocal` first and pass the compiled document and runtime to `LocalDocumentView`. `LocalReactiveDocument` and the Playground compilation thread use the default budget. After raising the node budget, hosts should measure memory and preview rendering time with their actual documents.

### `createLocalRuntime(document: LocalDocument)`

Creates an independent in-memory runtime for a compiled document. Throws if `document` is not a local mode document, if initial values exceed budgets, or if the structure is invalid. Each instance has independent state; there is no storage, network or cross-instance sharing.

### `LocalRuntime`

| Member | Parameters | Returns | Behavior |
| --- | --- | --- | --- |
| `document` | — | `LocalDocument` | The compiled result used at creation |
| `snapshot()` | — | `{ revision: number; state: Readonly<Record<string, LocalValue>> }` | Returns the same snapshot object when state is unchanged; state is frozen |
| `get(node)` | `LocalNode` | `LocalValue` | Reads the value bound to the control; returns `null` for no binding or an unknown node; arrays are copies |
| `set(node, value)` | `LocalNode`, `LocalValue` | `Diagnostic[]` | Validates all shared controls; returns an empty array and commits once on success; does not increment revision on failure |
| `evaluate(expression)` | `string` | `LocalValue` | Evaluates with current state; throws `LocalExpressionError` on failure; arrays are copies |
| `text(template)` | `string` | `string` | Renders text containing `{{ }}`; throws on failure |
| `reset(node)` | `LocalNode` | `void` | Restores parameters and component state within the node's subtree in one commit, notifying once |
| `resetToken(node)` | `LocalNode` | `number` | Incrementing token for a control's internal state, so renderers can detect resets |
| `subscribe(listener)` | `() => void` | `() => void` | Calls the listener on every commit; returns an unsubscribe function |
| `dispose()` | — | `void` | Idempotent; clears subscriptions, expression caches and reset tokens; other members throw afterwards |

`set` relies on the controls registered in the document; node metadata passed by the caller cannot loosen constraints. `disabled` and conditional hiding are for interactive display only; the host still enforces business permissions and server-side data validation.

### Other core exports

- `LOCAL_SYNTAX_VERSION`: currently the literal `'local-draft-1'`. Use it to record the syntax revision a document uses.
- `compileExpression(source: string)`: returns an object with `source`, `dependencies`, `evaluate(env)` and `inferType(env)`; throws `LocalExpressionError` on failure.
- `LocalExpressionError`: contains `code` and `offset`.
- `compileLatex(source: string)`: returns an object with `source`, `dependencies` and `evaluate(x, env, budget?)`; throws an error with `code` and `offset` on failure.
- `samplePlot(expression, env, min, max, samples = 200, sharedBudget?)`: returns `{ points: { x: number; y: number | null }[]; endpoint: number | null }`; throws when the range, sample count or budget is invalid.
- Type exports: `Diagnostic`, `SourceRange`, `LocalValue`, `LocalValueKind`, `LocalNode`, `LocalBinding`, `LocalDocument`, `LocalCompileResult`, `LocalRuntime`, `LocalSnapshot`.

`compileExpression`, `compileLatex` and `samplePlot` are lower-level utilities with the same stability level as the core API; usually only `compileLocal` and `createLocalRuntime` are needed.

## Diagnostics

The fields and stability levels of `Diagnostic` are described in the diagnostics contract in [Versions and compatibility](compatibility-en.md). Key points: `line`, `column` and `range` are for programmatic location; `code` can be used for coarse classification in the current version, but 0.x does not promise cross-version stability; `message` is display text and should not be parsed.

`onDiagnostics` receives compile diagnostics when the compilation result changes, and runtime diagnostics when control writes are rejected. Documents with compile errors do not activate interaction; runtime local errors replace only the corresponding content.

## State, instances and cleanup

- `LocalReactiveDocument` recompiles and creates a runtime when `source` changes, cleaning up the old instance; React StrictMode is supported.
- When managing the lifecycle yourself, render with `<LocalDocumentView document={result.document} runtime={runtime} />` and call `runtime.dispose()` on unmount.
- `subscribe()` returns an unsubscribe function. `dispose()` clears remaining subscriptions; calling other runtime methods afterwards throws.
- `snapshot()` returns the same object until state changes, which is useful for external store subscriptions. `reset(panelNode)` commits once for the panel subtree, and subscribers receive one notification; hidden controls inside the panel are also within reset scope.
- Document state lives only in memory. Refreshing, remounting or replacing the source starts from initial values; there is no persistence, localStorage, cookie or server write.
- Hidden regions keep parameters, tab selection and checklist state; timers in hidden regions pause and stay paused when shown again until the reader starts them. Disposing an instance releases timers and subscriptions.

## Image and link policy

Images are not loaded by default, including relative-path images, so documents do not automatically request host APIs or external sites. Hosts can explicitly allow image sources through `urlPolicy`; both `LocalReactiveDocument` and `LocalDocumentView` accept this prop. Links keep safe protocol checks by default.

```tsx
import type { LocalUrlPolicy } from 'reactive-md/react';

const urlPolicy: LocalUrlPolicy = (raw, kind) => {
  if (kind === 'link') return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.origin === 'https://images.example.com';
  } catch {
    return false;
  }
};

<LocalReactiveDocument source={source} urlPolicy={urlPolicy} />;
```

| Target | Without a policy | With a policy |
| --- | --- | --- |
| Images | All rejected, including relative addresses | Protocol-bearing addresses are checked first and only HTTP(S) is allowed; relative addresses are decided by the policy |
| Links | Relative addresses and `http`, `https`, `mailto`, `tel` allowed | Decided by the policy after protocol checks; external HTTP(S) links get `_blank` and `noopener noreferrer` |

The policy receives the raw URL with leading and trailing whitespace removed, and `'image' | 'link'`. If the policy throws, the address is rejected. The renderer always checks the protocol first; even if the policy allows it, `javascript:` or dangerous `data:` addresses cannot be used. Images allowed to load use `referrerPolicy="no-referrer"`; same-origin requests may still carry cookies, so image allowlists should avoid business API paths.

`urlPolicy` controls only rendered links and images; it is not server-side authorization or a sandbox. Hosts still need to handle CSP, network egress and isolation policies for untrusted authors.

## Theme and style scoping

`reactive-md/styles.css` is a global stylesheet, not isolated through Shadow DOM or CSS Modules. Hosts should import it explicitly once; the `reactive-md/react` library build extracts styles into this file and does not inject them automatically when importing JavaScript.

- Style selectors are mainly `.md-document`, `.local-document` and `.md-*`, `.local-*` class names. The document root rendered by components is `.md-document.local-document`.
- Theme variables are declared on `.md-document` and `.reactive-md-theme`, including `--ink`, `--surface`, `--line`, `--blue`, `--teal`, `--danger`, `--radius-*` and font variables. Override them after the library styles with rules such as `.my-article .md-document { --blue: #245c98; }`; the document root carries default values, so setting variables only on an ancestor container will not override same-name values on the root.
- The dark theme is triggered by an explicit `data-theme="dark"` ancestor or the document node itself; components do not read `prefers-color-scheme` and do not provide a theme toggle button.
- Documents default to `max-width: 720px` and are horizontally centered. To fill the host container, override the width and margins of `.md-document` within your own scope.
- `.md-*` and `.local-*` class names are current style hooks and may change with style refactoring in 0.x. For stable integration, prefer CSS variables and container-level overrides; do not treat internal class names as an API.
- Neither React component accepts `className` or `style`. For local overrides, scope them with the host's own wrapper element.

## Resource limits

A single string is limited to 100,000 characters, an array to 10,000 items, and the total string length within an array to 100,000 characters. Email validation uses a length-limited linear check. The runtime rejects writes over a limit and keeps the last valid state.

A single document source is limited to 1,000,000 characters. There are at most 100 diagnostics, and a single message is at most 2,000 characters.

Each plot component has at most 16 curves; the whole document requests at most 20,000 curve sample points, including hidden regions. Plotting computation is also limited by a shared execution budget of 2,000,000 steps. Documents over a limit receive diagnostics; expression and math rendering also have their own depth and token budgets.

These limits bound the work for a single document; they do not replace host control over request size, concurrency and execution time. See the [security policy](../SECURITY.md) for the full threat boundary.

## Version pinning and upgrades

- During 0.x, pin the exact package version and commit the lockfile. `^0.3.0` allows only patch versions, but production integrations should still pin the version or the tarball SHA256.
- Use one package version for both the core and React entries; do not mix different versions of `reactive-md` and `reactive-md/react`.
- Record `LOCAL_SYNTAX_VERSION` in application configuration or document metadata, alongside the persisted `.reactive.md` source. Migrate according to [Versions and compatibility](compatibility-en.md) when the syntax revision changes.
- After upgrading, recompile your own documents and check `result.diagnostics`, rendered output and browser interactions. Do not depend on the text of diagnostic `message`.

## Features not provided

Local mode does not provide state persistence, plugins or custom component registration, arbitrary HTML, author CSS, event handlers, network requests, external data APIs, form submission, Vue support, React 18 support or a CommonJS entry. Hosts should not treat these capabilities as configuration options.
