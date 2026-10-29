# Local mode integration

Local interaction mode uses HTML-style tags, in-place parameters and `{{ expressions }}`. Author rules are in the [beginner guide](../guides/local-guide-en.md) and the [syntax specification](../reference/local-interaction-syntax-en.md); complete documents are in the [example index](../../examples/local/README.md). Hosts explicitly select this mode through the `Local` APIs. See [Source revisions and migration](../compatibility/source-versioning-en.md) for the optional revision directive, upgrade checks and `migrateLocalSource`, and [0.4.0 release and migration](../releases/release-0.4.0-en.md) for the upgrade checklist.

## Runtime and entries

See [HTML compatibility](../reference/html-compatibility-en.md) for the next release's P0 HTML support and host capability options. The temporary routing policy sends the entire document to native HTML when author CSS, JavaScript or extended HTML is enabled. Markdown and ReactiveMD interpretation stop in that path.

| Entry | Contents | Dependency |
| --- | --- | --- |
| `reactive-md` | `compileLocal`, `createLocalRuntime`, expression and math utilities | No React dependency |
| `reactive-md/react` | `LocalReactiveDocument`, `LocalDocumentView` | React 19 |
| `reactive-md/styles.css` | Component, theme and document styles | Explicitly imported by the host |

The package ships ESM only. Node.js 22.12+ can be used for development and Node-side compilation and runtime. Local browser checks use Edge; static SSR is covered by the packed check; see [Versions and compatibility](../compatibility/compatibility-en.md) for the full matrix. Copyable projects are in [Standalone integration examples](../../examples/integration/README.md). For single-file HTML, state files and the standalone browser runtime, see [Shareable documents and static export](shareable-export-en.md).

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
| `source` | `string` | `LocalReactiveDocument` | Recompiles and creates a new runtime when the source changes; old instance state is not kept. See [Keeping values when source changes](#keeping-values-when-source-changes) |
| `compileOptions` | `LocalCompileOptions` | `LocalReactiveDocument` | Per-compilation limits, HTML capability flags and host component schemas; omitted options use the default ReactiveMD path |
| `document` | `LocalDocument` | `LocalDocumentView` | Compiled document; compiled once by the host |
| `runtime` | `LocalRuntime` | `LocalDocumentView` | Created by the host, which is responsible for disposal |
| `onDiagnostics` | `(diagnostics: Diagnostic[]) => void` | Both | Receives compile diagnostics and runtime diagnostics when control writes are rejected |
| `urlPolicy` | `(url: string, kind: 'image' \| 'link') => boolean` | Both | Decides whether to allow an image or link after protocol checks |
| `locale` | `'en' \| 'zh'` | Both | Language for built-in labels, controls and displayed diagnostics; defaults to `'en'`. Callbacks keep structured diagnostics |
| `themes` | `readonly LocalThemeDefinition[]` | Both | Host registrations; CSS loads separately; built-in `default` is always available |
| `colorScheme` | `'light' \| 'dark' \| 'auto'` | Both | Defaults to `auto`, following the nearest explicit ancestor preference or the system |
| `hostData` | `Readonly<Record<string, unknown>>` | Both | JSON-safe host data keyed `${kind}:${ref}` for `hostComponent` nodes; never enters the worker |
| `hostRenderer` | `LocalHostRenderer` | Both | Client-only renderer for `hostComponent` nodes; a missing renderer or data renders a visible placeholder |
| `externalValues` | `Readonly<Record<string, LocalValue>>` | `LocalReactiveDocument` | Values for `<external>` declarations; updates never recompile or reset parameters. `LocalDocumentView` also accepts it for host-managed runtimes |
| `initialParameters` | `Readonly<Record<string, LocalValue>>` | `LocalReactiveDocument` | Public parameter values applied once after each new runtime is created, before interaction; an invalid set is rejected atomically and reported through `onDiagnostics` |
| `onParametersChange` | `(parameters, snapshot) => void` | `LocalReactiveDocument` | Called once per commit when the public writable parameter set actually changes; initialization, rejected writes, unchanged values and external-only updates do not call it |
| `onSourceNavigate` | `(target: LocalSourceTarget) => void` | Both | Reports a preview node's source range; enabling it adds source metadata attributes, omitting it leaves the DOM unchanged |

Neither component has `className`, `style` or slot props. `LocalReactiveDocument` renders `<article class="md-document local-document">`; `LocalDocumentView` uses the same document container. See below for style overrides.

Each component instance manages in-memory state independently. Changing the source recompiles and starts from initial values; disposing an instance clears subscriptions and timers. To carry values across a source change, use the retention helpers or manage the runtime yourself; see [Keeping values when source changes](#keeping-values-when-source-changes). A panel reset in the document restores its internal parameters, input drafts and component state, and displays of same-name parameters outside the panel update as well.

When a host React root shares a page with the standalone IIFE, give the host root a distinct `identifierPrefix`, for example `createRoot(container, { identifierPrefix: 'host-' })`. The bundles own separate React instances, so their default `useId` counters can overlap. Independent server-rendered roots need matching unique prefixes on the server and client too.

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
  const runtime = createLocalRuntime(result.document, {
    externalValues: { exchangeRate: 7.2 },
  });
  const unsubscribe = runtime.subscribe(() => {
    console.log(runtime.snapshot());
  });

  console.log(runtime.evaluate('people * 100'));
  console.log(runtime.text('People: {{ people }}'));
  runtime.setExternalValues({ exchangeRate: 7.3 });

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

Syntax problems are returned through diagnostics; the current build accepts only `local-draft-3`. An explicit older revision directive is rejected with a `local.version.*` diagnostic; an unversioned source keeps current-revision behavior. The source limit is 1,000,000 characters. `document` is a current runtime object and should not be treated as a persistence format.

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

#### Next.js Server Components

`compileLocal` returns plain data at every depth, including `document.dependencies`, node `attrs`, bindings and diagnostics. Records use `Object.prototype`; arrays use `Array.prototype`. Internal dictionaries may still use null prototypes. Existing frozen metadata and `undefined` fields are preserved.

Compile on the server, check `result.ok`, then pass `result.document` directly to a Client Component as a prop. A JSON round trip is unnecessary. This meets React's [plain-object requirement for serializable props](https://react.dev/reference/rsc/use-client#serializable-types-returned-by-server-components). In the Client Component, create and dispose `createLocalRuntime(document)` and render `LocalDocumentView` with that runtime. Runtime instances and host callbacks stay on the client; the plain-data guarantee applies to compiler output.

```tsx
// Server Component; ClientDocument is the host's 'use client' wrapper.
import { compileLocal } from 'reactive-md';
import ClientDocument from './ClientDocument';

export default function Page() {
  const result = compileLocal('<counter bind="n" label="Count" initial="2">');
  if (!result.ok) throw new Error('Compilation failed');
  return <ClientDocument document={result.document} />;
}
```

### Host components

A host can register components for one compilation without changing the author syntax revision. A schema declares a `form` and may declare a scalar binding:

```ts
import { compileLocal, type LocalHostComponentSchema } from 'reactive-md';

const hostComponents: LocalHostComponentSchema[] = [
  {
    name: 'host-weather',
    form: 'leaf',
    props: {
      kind: { kind: 'enum', required: true, enum: ['weather'] },
      ref: { kind: 'string', required: true, pattern: '^[a-z-]+$' },
    },
  },
  {
    name: 'host-rating',
    form: 'leaf',
    props: { label: { kind: 'string' } },
    binding: { kind: 'number', min: 0, max: 5, step: 1 },
  },
];
const result = compileLocal(source, { hostComponents });
```

Without `hostComponents`, those tags remain unknown and fall back to source. Names must be unique lowercase kebab-case and cannot reuse one of the 49 author tag names, a P0 HTML tag name or `theme`; at most 32 schemas are accepted. `pattern` accepts only a linear-time-safe regex subset (no backreferences, lookarounds, named groups, nested quantifiers or quantified alternation). An invalid schema returns `local.options.invalid`, and an invalid authored attribute returns `local.host.attribute`; a valid host node counts as one syntax node.

`form` is `leaf`, `inline` or `container`. Inline and container tags are paired; their body is compiled as normal Markdown and ReactiveMD content, and the renderer receives `ctx.render()` for children. `binding` is optional and accepts `string`, `number` or `boolean`, with static `min`, `max`, `step`, `options`, `initialRule` and `exclusive`. A bound host component implicitly accepts `bind`, `initial` and dynamic `disabled`, and shares the built-in binding families. For example, this rating control and the built-in number share one value:

```markdown
<host-rating bind="rating" label="Course rating">
<number bind="rating" label="Numeric rating" min="0" max="5" step="1">

Current rating: {{ rating }}
```

The host renderer receives `(node, data, ctx)`. `ctx` extends the render context with `value`, a validating `setValue(value)`, `disabled`, `resetToken`, resolved `props` and `report(diagnostics)`. `setValue` goes through the runtime, so shared constraints and reset behavior still apply. Pass `hostData`, keyed `${kind}:${ref}`, only for components that declare those props; a binding-only or container host does not need host data. A missing renderer, missing declared data or a throwing renderer renders a visible placeholder instead of failing the document. `mode="static"` uses the same dispatch and passes `ctx.mode` to the renderer. Host schemas are plain data and cross the worker boundary; renderers never do.

### External data

`<external name="exchangeRate" type="number">` declares a read-only value for expressions and computations. Pass initial values to `createLocalRuntime(document, { externalValues })` or the `externalValues` prop. `runtime.setExternalValues(partial)` validates every entry, commits once and increments the revision once; unknown names, wrong types, non-finite numbers and budget overruns return diagnostics and keep the previous state. Equal values do not increment the revision. `getExternal(name)` and `getExternalValues()` are read-only; externals never appear in `getParameters()`, `parameterNames()` or a state file.

A missing external makes only expressions that read it fail locally; other content keeps updating, and those expressions recover when the value arrives. Missing values are never coerced to `0`, `false` or an empty string. Static export and SSR use the same rules; the export does not fetch or embed host data.

### Version inspection and migration

Three pure functions inspect and migrate source without creating a runtime. They are exported from `reactive-md`:

```ts
import {
  checkLocalUpgrade,
  inspectLocalSourceVersion,
  migrateLocalSource,
} from 'reactive-md';

const info = inspectLocalSourceVersion(source);
const check = checkLocalUpgrade(source, { fromVersion: 'local-draft-1' });
const migrated = migrateLocalSource(source, { fromVersion: 'local-draft-1' });
```

`inspectLocalSourceVersion` reports the declared and effective revision, whether this compiler supports it, the directive range and version diagnostics. `checkLocalUpgrade` reports `ok`, `fromVersion`, `toVersion`, `needsMigration` and diagnostics. `migrateLocalSource` adds `source`, `changed` and precise `edits`.

`LocalUpgradeOptions` supplies `fromVersion` and `allowSemanticChanges`. An unversioned historical document needs `fromVersion: 'local-draft-1'`. An explicit `fromVersion` that disagrees with the declaration is rejected. `local-draft-1`, `local-draft-2` and `local-draft-3` are accepted migration sources.

Migration changes only the metadata directive, preserves body bytes, BOM and CRLF, and is idempotent. It blocks reserved bindings, newly recognized tags, compile errors and text-control length changes before producing output. See [Source revisions and migration](../compatibility/source-versioning-en.md) for the exact checks and the CLI.

### `createLocalRuntime(document: LocalDocument, options?: LocalRuntimeOptions)`

Named read-only values are described by `LocalComputation` in the optional `document.computations` record. `bindings` and `initialState` remain writable controls; `snapshot().state` also includes successful calculated values for its revision. Read a named value with `evaluate(name)` to preserve expression errors; failed values are absent from snapshots. See [calculation and error semantics](../reference/computations-formatting-en.md).

`options.externalValues` seeds declared `<external>` values; invalid entries are treated as unavailable and can be corrected through `setExternalValues`. The runtime creates an independent in-memory instance. Throws if `document` is not a local mode document, if initial values exceed budgets, or if the structure is invalid. Each instance has independent state; the runtime never stores or transmits state by itself.

### `LocalRuntime`

`validate(): Diagnostic[]` reads advisory cross-field failures for the current revision. Dynamic `min`/`max`/`required` failures are enforced on writes and displayed on the control; `validate()` keeps its existing meaning. It preserves editability and returns copies of cached diagnostics. `document.validations?: LocalValidation[]` holds the serializable rule declarations. Numeric collections add `number[]` to `LocalValue` and `number-array` to `LocalValueKind`; existing writable selection controls keep string arrays. See [constraints and collections](../reference/constraints-collections-en.md).

| Member | Parameters | Returns | Behavior |
| --- | --- | --- | --- |
| `document` | — | `LocalDocument` | The compiled result used at creation |
| `snapshot()` | — | `{ revision: number; state: Readonly<Record<string, LocalValue>> }` | Returns the same snapshot object when state is unchanged; state is frozen and includes available external values; use `getParameters()` for writable parameters only |
| `get(node, slot?)` | `LocalNode`, optional slot | `LocalValue` | Reads the value bound to the control; `slot` selects `start`/`end` or `x`/`y`; returns `null` for no binding or an unknown node; arrays are copies |
| `set(node, value, slot?)` | `LocalNode`, `LocalValue`, optional slot | `Diagnostic[]` | Validates all shared controls; returns an empty array and commits once on success; does not increment revision on failure |
| `setMany(node, values)` | `LocalNode`, slot values | `Diagnostic[]` | Atomically writes several slots of one multi-slot control; invalid batches leave state and revision unchanged |
| `validate()` | — | `Diagnostic[]` | Returns copies of the current advisory validation failures; does not change or reject state |
| `parameterNames()` | — | `readonly string[]` | Sorted public binding names; internal `@` bindings excluded |
| `getParameter(name)` | `string` | `LocalValue \| undefined` | Value of a public binding; `undefined` for unknown or internal names; arrays are copies |
| `getParameters()` | — | `Readonly<Record<string, LocalValue>>` | Frozen public-only snapshot; internal `@` keys are never included |
| `setParameter(name, value)` | `string`, `LocalValue` | `Diagnostic[]` | Validates every control sharing the binding; commits once; state unchanged on failure |
| `setParameters(values)` | `Readonly<Record<string, LocalValue>>` | `Diagnostic[]` | Validates every public value and multi-slot relation, then commits all or nothing; unknown or internal names return `local.runtime.parameter`; invalid values return `local.runtime.value`; unchanged values do not bump the revision |
| `getExternal(name)` | `string` | `LocalValue \| undefined` | Value of a declared external, or `undefined` when undeclared or unavailable; arrays are copies |
| `getExternalValues()` | — | `Readonly<Record<string, LocalValue>>` | Frozen record of the currently available external values |
| `setExternalValues(values)` | `Readonly<Record<string, LocalValue>>` | `Diagnostic[]` | Atomically validates partial external updates; commits and notifies once; unknown names, wrong types and budgets return `local.runtime.external` without changing state or revision |
| `evaluate(expression)` | `string` | `LocalValue` | Evaluates with current state; throws `LocalExpressionError` on failure; arrays are copies |
| `text(template)` | `string` | `string` | Renders text containing `{{ }}`; throws on failure |
| `reset(node)` | `LocalNode` | `void` | Restores parameters and component state within the node's subtree in one commit, notifying once |
| `resetToken(node)` | `LocalNode` | `number` | Incrementing token for a control's internal state, so renderers can detect resets |
| `subscribe(listener)` | `() => void` | `() => void` | Calls the listener on every commit; returns an unsubscribe function |
| `dispose()` | — | `void` | Idempotent; clears subscriptions, expression caches and reset tokens; other members throw afterwards |

`set` relies on the controls registered in the document; node metadata passed by the caller cannot loosen constraints. `disabled` and conditional hiding are for interactive display only; the host still enforces business permissions and server-side data validation.

### Parameters by name

Name-based access is for hosts that keep their own parameter values, such as a form or a URL. Only public bindings are visible: `parameterNames()` returns sorted names, `getParameter(name)` returns `undefined` for an unknown or internal name, and `getParameters()` returns a frozen public-only record. Anonymous `@` bindings never appear, and arrays returned by `getParameter` are copies.

Writes validate every control sharing the binding, including multi-slot relations, and commit once. A failed call returns diagnostics and leaves the state unchanged; unchanged values do not increase the revision. Unknown or internal names return `local.runtime.parameter`; invalid values return `local.runtime.value`.

```ts
const names = runtime.parameterNames();          // e.g. ['annual', 'people']
const people = runtime.getParameter('people');   // 2

runtime.setParameter('people', 7);
const diagnostics = runtime.setParameters({ people: 8, annual: true });
if (diagnostics.length) {
  // Nothing was written.
}
```

### State export and import

`exportLocalState(runtime, generator?)` writes the public parameters to a `reactive-md-state/v1` file. The file carries the document identity in `sourceDigest`, the language revision in `syntax`, and an optional generator name and version. Anonymous `@` bindings from `snapshot().state` are excluded, so a raw snapshot should not be stored as a long-term protocol. The [shareable export guide](shareable-export-en.md#starting-values-and-state-files) documents the format used by the CLI and standalone runtime.

`importLocalState(runtime, input, options?)` accepts serialized JSON or an already parsed file. It parses the payload, checks the source digest, syntax revision and exact public parameter set, validates every value, and applies the result; a failed import returns diagnostics and leaves the runtime unchanged. `options.maxLength` limits the serialized payload in bytes and defaults to 1 MiB.

```ts
import { exportLocalState, importLocalState } from 'reactive-md';

const file = exportLocalState(runtime, { name: 'my-host', version: '1.0.0' });
const saved = JSON.stringify(file);

const diagnostics = importLocalState(runtime, saved);
```

The lower-level `createLocalStateFile`, `parseLocalState`, `resolveLocalState`, `applyLocalState` and `serializeLocalState` remain available. Use `resolveLocalState(document, input)` for validation that does not touch a live runtime.

### Keeping values when source changes

`LocalReactiveDocument` still creates a new runtime from initial values when `source` changes. Hosts that manage the runtime themselves can carry compatible values over:

```ts
import {
  applyLocalStateRetention,
  compileLocal,
  createLocalRuntime,
  planLocalStateRetention,
} from 'reactive-md';

const next = compileLocal(nextSource);
if (!next.ok) throw new Error('Fix the compile diagnostics first');

const plan = planLocalStateRetention({
  previous: previousRuntime.document,
  state: previousRuntime.snapshot().state,
  next: next.document,
});
const runtime = createLocalRuntime(next.document);
const { retained, dropped, diagnostics } = applyLocalStateRetention(runtime, plan);
```

`planLocalStateRetention` returns the values to reuse, the retained parameter names, and dropped entries with a name and reason. A parameter is retained only when:

- its name exists as a public binding in both documents;
- both bindings are safely retainable: the binding has controls, every control is bound to the name, and no control is a timer or checklist;
- its type and initial definition are unchanged, including the effective initial value and any explicit `initial` attribute values.

Anonymous `@` bindings, removed or renamed parameters, timers and positional checklists are dropped. Each retained value is revalidated against the new document's constraints; a rejected value falls back to the new initial value and is reported as `invalid`. Drop reasons are `internal`, `unknown`, `unretainable`, `type`, `initial` and `invalid`.

`applyLocalStateRetention` first tries one atomic write so multi-slot relations stay consistent, then falls back to writing parameters individually, so one stale value does not block the others. `diagnostics` describe values rejected by the new document.

### Background compilation in a Worker

Worker support is host-provided: create the worker entry with your bundler and keep `compileLocal` as the fallback. A copyable browser example is in [Standalone integration examples](../../examples/integration/README.md).

```ts
// compile.worker.ts
import { startLocalCompileWorker } from 'reactive-md';

startLocalCompileWorker();
```

`startLocalCompileWorker()` installs the handler on the current worker global. Pass a scope explicitly only when testing or wrapping another message host.

```ts
// main.ts
import { LocalCompileScheduler } from 'reactive-md';

const scheduler = new LocalCompileScheduler({
  createWorker: () => new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' }),
  onResult: ({ source, result, mode }) => render(source, result, mode),
  onPendingChange: (pending) => showSpinner(pending),
  onModeChange: (mode, detail) => console.log('compile mode', mode, detail),
});

scheduler.schedule(source);
```

`LocalCompileScheduler` coalesces edits for `LOCAL_COMPILE_DELAY_MS` (150 ms; override with `delay`), keeps one compile in flight plus only the latest queued source, and discards results that a newer edit has superseded. When no worker is available, or after a worker error, it compiles on the main thread with `fallbackCompile`, which defaults to `compileLocal`; a worker failure switches permanently to this fallback and reports it through `onModeChange`. Failures thrown by the worker or during fallback compilation use the `local.worker.compile` diagnostic code.

`onResult` receives `LocalCompileOutcome` (`source`, `result`, `duration`, `mode`), `onPendingChange` reports whether work is queued or in flight, and `dispose()` stops the timer, terminates the worker and suppresses later callbacks.

### Other core exports

- `LOCAL_SYNTAX_VERSION`: currently the literal `'local-draft-3'`. Use it to record the syntax revision a document uses.
- `compileExpression(source: string)`: returns an object with `source`, `dependencies`, `evaluate(env)` and `inferType(env)`; throws `LocalExpressionError` on failure.
- `LocalExpressionError`: contains `code` and `offset`.
- `compileLatex(source: string)`: returns an object with `source`, `dependencies` and `evaluate(x, env, budget?)`; throws an error with `code` and `offset` on failure.
- `samplePlot(expression, env, min, max, samples = 200, sharedBudget?)`: returns `{ points: { x: number; y: number | null }[]; endpoint: number | null }`; throws when the range, sample count or budget is invalid.
- State files: `exportLocalState`, `importLocalState`, `createLocalStateFile`, `parseLocalState`, `resolveLocalState`, `applyLocalState` and `serializeLocalState`; `LOCAL_STATE_FORMAT` is `'reactive-md-state/v1'`.
- Source revisions: `inspectLocalSourceVersion`, `checkLocalUpgrade` and `migrateLocalSource`; `LocalUpgradeOptions` configures the source revision and semantic-change allowance.
- Retention: `planLocalStateRetention` and `applyLocalStateRetention`.
- Background compilation: `LocalCompileScheduler`, `LOCAL_COMPILE_DELAY_MS` and `startLocalCompileWorker`.
- Type exports: `Diagnostic`, `SourceRange`, `LocalValue`, `LocalValueKind`, `LocalNode`, `LocalBinding`, `LocalComputation`, `LocalValidation`, `LocalDocument`, `LocalCompileLimits`, `LocalCompileOptions`, `LocalCompileResult`, `LocalHostPropKind`, `LocalHostPropSchema`, `LocalHostComponentForm`, `LocalHostBindingSchema`, `LocalHostComponentSchema`, `LocalExternal`, `LocalDynamicConstraint`, `LocalDynamicConstraints`, `LocalRuntimeOptions`, `LocalUpgradeOptions`, `LocalRuntime`, `LocalSnapshot`, `LocalStateFile`, `LocalStateGenerator`, `LocalStateParseResult`, `LocalStateResolution`, `LocalRetainedState`, `LocalStateRetentionReason`, `LocalStateRetentionDrop`, `LocalStateRetentionInput`, `LocalStateRetentionResult`, `LocalCompileWorker`, `LocalCompileWorkerScope`, `LocalCompileRequest`, `LocalCompileResponse`, `LocalCompileOutcome`, `LocalCompileMode`, `LocalCompileSchedulerOptions`.

`compileExpression`, `compileLatex` and `samplePlot` are lower-level utilities with the same stability level as the core API; usually only `compileLocal` and `createLocalRuntime` are needed.

## Diagnostics

The fields and stability levels of `Diagnostic` are described in the diagnostics contract in [Versions and compatibility](../compatibility/compatibility-en.md). Key points: `line`, `column` and `range` are for programmatic location; `code` can be used for coarse classification in the current version, but 0.x does not promise cross-version stability; `message` is display text and should not be parsed.

`onDiagnostics` receives compile diagnostics when the compilation result changes, and runtime diagnostics when control writes are rejected. Documents with compile errors do not activate interaction; runtime local errors replace only the corresponding content.

## State, instances and cleanup

- `LocalReactiveDocument` recompiles and creates a runtime when `source` changes, cleaning up the old instance; React StrictMode is supported.
- When managing the lifecycle yourself, render with `<LocalDocumentView document={result.document} runtime={runtime} />` and call `runtime.dispose()` on unmount.
- `subscribe()` returns an unsubscribe function. `dispose()` clears remaining subscriptions; calling other runtime methods afterwards throws.
- `snapshot()` returns the same object until state changes, which is useful for external store subscriptions. `reset(panelNode)` commits once for the panel subtree, and subscribers receive one notification; hidden controls inside the panel are also within reset scope.
- Document state lives only in memory; the runtime never writes storage, cookies or the network. Refreshing, remounting or replacing the source starts from initial values. Persistence is an explicit host action through `exportLocalState` and `importLocalState`; the [retention helpers](#keeping-values-when-source-changes) can carry compatible values into a new runtime.
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
- Documents may start with `<theme name="default">`; omission selects `default`. Register custom themes through `themes`; see the [theme protocol](../reference/theme-protocol-en.md).
- `colorScheme` forces light or dark mode. The default `auto` reads the nearest ancestor's `data-color-scheme` or legacy `data-theme`, then the system preference. Each document exposes independent `data-rmd-theme` and resolved `data-color-scheme` attributes.
- Documents default to `max-width: 720px` and are horizontally centered. To fill the host container, override the width and margins of `.md-document` within your own scope.
- Prefer public variables for theme styling. Component outer `.md-*` and `.local-*` classes and semantic state attributes are theme hooks; internal node ordering is not an extension API. See the theme protocol for compatibility requirements.
- Neither React component accepts `className` or `style`. For local overrides, scope them with the host's own wrapper element.

## Resource limits

A single string is limited to 100,000 characters, an array to 10,000 items, and the total string length within an array to 100,000 characters. Email validation uses a length-limited linear check. The runtime rejects writes over a limit and keeps the last valid state.

A single document source is limited to 1,000,000 characters. There are at most 100 diagnostics, and a single message is at most 2,000 characters.

Each plot component has at most 16 curves; the whole document requests at most 20,000 curve sample points, including hidden regions. Plotting computation is also limited by a shared execution budget of 2,000,000 steps. A document has at most 100 validation rules. Generated `data-table` rows, columns and text have per-table and whole-document budgets described in [constraints and collections](../reference/constraints-collections-en.md). Documents over a limit receive diagnostics; expression and math rendering also have their own depth and token budgets.

These limits bound the work for a single document; they do not replace host control over request size, concurrency and execution time. See the [security policy](../../SECURITY.md) for the full threat boundary.

## Version pinning and upgrades

- During 0.x, pin the exact package version and commit the lockfile. `^0.3.0` allows only patch versions, but production integrations should still pin the version or the tarball SHA256.
- Use one package version for both the core and React entries; do not mix different versions of `reactive-md` and `reactive-md/react`.
- Record `LOCAL_SYNTAX_VERSION` in application configuration or document metadata, alongside the persisted `.reactive.md` source. Migrate according to [Versions and compatibility](../compatibility/compatibility-en.md) when the syntax revision changes.
- After upgrading, recompile your own documents and check `result.diagnostics`, rendered output and browser interactions. Do not depend on the text of diagnostic `message`.

## Features not provided

The default ReactiveMD path supports P0 HTML. Host options for author CSS, JavaScript and extended HTML use the separate native HTML path described in [HTML compatibility](../reference/html-compatibility-en.md). Local mode still provides no automatic state persistence or unrestricted network access, plugins or custom component registration, author-issued network or storage calls, Vue support, React 18 support or a CommonJS entry. Host-provided values are explicit read-only declarations; the core never fetches them. State export and import are explicit host calls. `LocalReactiveDocument` starts from initial values when the source changes; use retention helpers or manage the runtime and document yourself.


See [local-draft-2 components and migration](../reference/local-components-v2-en.md) for new tags, colors and slot state, and [0.4.0 release and migration](../releases/release-0.4.0-en.md) for the upgrade checklist. `0.6.0` is available on both the `latest` and `next` channels.

0.5.3 adds compile-option-aware authoring and explicit screen/print styles. See [0.5.3 host integration](../releases/release-0.5.3-en.md). 0.6.0 makes `compileLocal` return plain data that can cross a React Server Components boundary; see the [0.6.0 release notes](../releases/release-0.6.0-en.md).
