# Extension SDK preview

[中文](extension-sdk-ch.md)

The source tree includes an SDK preview covering public extensions and unified default components. The package version remains `0.6.1`; the new entries will ship with a later release. Existing registry copies of `0.6.1` do not include the SDK. Build and install a local tarball to use this preview.

```sh
npm run build:lib
npm pack
npm install ../reactive-md-0.6.1.tgz
```

Use a tarball packed from the current source tree after `build:lib` completes. The npm registry copy of `0.6.1` predates `reactive-md/build`, `reactive-md/testing` and the phase-three entries. The consumer checks install that packed file outside the repository, so the public import surface is exercised as published rather than through source aliases. Version ranges still name `0.6.1`, so the preview does not require a different version string.

Component manifests and instance configuration are plain data. React implementations remain explicitly imported host code. The compiler, Worker, authoring tools, build adapter and exporter use the same validated configuration.


See the [development contract](../development/component-development-reference-en.md) for convenience packages, createReactHost, Vite integration and configuration diagnostics, or start with the [five-minute guide](../development/component-development-en.md).

## Define and register a component

```tsx
import { createLocalConfig, defineLocalComponent } from 'reactive-md/sdk';
import { createReactConfig, defineReactComponent, LocalReactiveDocument } from 'reactive-md/react';

const note = defineLocalComponent({
  id: 'example/note', name: 'note-box', version: '1.0.0',
  protocol: 'reactive-md-component/v1', form: 'container',
  props: { title: { kind: 'string', default: 'Note' } },
  children: { kind: 'markdown' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Note', zh: '提示' }, category: 'content',
    insertText: '<note-box title="Note">\nSome **Markdown**.\n</note-box>',
  },
});
const implementation = defineReactComponent(note, {
  render: ctx => <aside><h3>{ctx.props.title}</h3>{ctx.children.render()}</aside>,
  renderStatic: ctx => <aside><h3>{ctx.props.title}</h3>{ctx.children.render()}</aside>,
});
const config = createLocalConfig({ components: [note] });
const reactConfig = createReactConfig(config, { components: [implementation] });

export function Reader({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} reactConfig={reactConfig} />;
}
```

The default preset remains enabled. `reactive-md/presets/default` exports `defaultPreset` for explicit configuration. Its 46 components pass the public validator and share compilation and rendering with external components. Registration rejects name overrides.

Registration validates identities, names, protocol, dependencies and budgets, then copies and freezes the data. `readLocalConfig` revalidates serialized configuration and recomputes its semantic key. React implementations must match their registered manifests.

`requires: { kernel: '^0.6.1' }` declares kernel compatibility. Dependencies use `{ id, version }`. Ranges support complete versions, `^`, `~` and whitespace-separated comparisons such as `>=0.6.1 <0.7.0`. Unsupported syntax is rejected.

## Props, bindings and lifecycle

Props support strings, numbers, booleans and enums, with defaults, required flags, static/dynamic modes, numeric bounds, integer checks and safe patterns. A valid numeric literal and a full numeric interpolation both reach the component as a number. Defaults apply to omitted attributes; invalid explicit values produce diagnostics. Missing optional props without a default resolve to `null`.

The main slot is `bindings.value`. Read through `ctx.bindings.value.get()` and write through `.set(next)`, which returns `{ ok, diagnostics }`. The manifest's `bind` and `initial` fields name the authored attributes. Writes use the kernel's shared constraints. A rating can share a parameter with the built-in number control when their bounds and step agree. Declare an explicit initial value only once per shared parameter.

The context also exposes `props`, `children.render()`, `instance`, `mode`, `visible`, `disabled`, `resetToken` and `report`. It contains no internal AST. Components use React effect cleanup for resources and observe `resetToken` for local UI state. Static rendering receives read-only binding handles.

React descendant render failures produce a placeholder and diagnostics. `reactive-md/react/server` provides `renderLocalStaticDocument`, a strict adapter that checks SSR capability and returns markup or structured diagnostics. Event and asynchronous failures use the React SDK error-reporting helpers.

Use this server adapter's markup as the offline export's `staticMarkup`. It retains React text boundaries for static-first standalone hydration. Supply the same `resources` to server rendering and export when components declare required styles.

Numeric bounds may reference props. Dynamic min/max use kernel constraints, including the bound prop's own range and integer checks. A prop used as a step must be static. Binding families declare general value semantics such as numbers, text, dates, choices and collections; implementations provide the interaction and appearance.

## Named slots, collections and structure

Phase two places default contracts in `defaultPreset.components`. Every definition passes the same `defineLocalComponent` validator as external definitions. `config.components` remains the external list; `config.registry` contains the complete default and external snapshot.

`bindings` is a record keyed by slot name. A coordinate control can declare `x` and `y`, with separate `bind-x`, `bind-y` and initial-value attributes. Its React implementation uses:

```ts
const x = ctx.bindings.get('x');
const y = ctx.bindings.slots.y.get();
const result = ctx.bindings.setMany({ x: 2, y: 3 });
```

`setMany` commits one kernel transaction after every slot passes validation. Failure preserves all parameters and the revision. The primary `value` slot may coexist with named slots and participate in the same transaction. `slotRelations: [{ lower: 'start', upper: 'end' }]` declares an ordered range. Named slots use exclusive ownership: omitted `exclusive` normalizes to `true`, and explicit `false` is rejected at registration.

Collection controls read arrays through the main slot and submit new arrays. Multi-select uses structural options and a selection limit; checklist derives its initial values from a task list. The adapter supplies read-only values, and the kernel owns state copies.

Use `family: 'collection'` with `kind: 'array'` or `'number-array'` for general collections. Arrays retain order and duplicates, `initial` accepts a JSON array literal, and `maxItems` limits length through a literal or static numeric prop. Dynamic caps are rejected at registration. State files preserve string arrays and finite-number arrays, with binding validation on restoration. Named slots support `kind: 'number'` with `family: 'number'`; registration rejects other combinations. `required: true` requires an authored binding name. Capabilities describe supported rendering environments, so a display-only container can support an interactive document. Static runtime reset remains read-only.

`structure` describes direct children, placement and content shape. `rules` declares reusable compile or state semantics for numeric ranges, dates, option sequences, tables, diagrams, navigation and budgets. External components may reuse default contracts or compose the primitives described by the public types.

The React context exposes public content projections through `content` and `children.items()`. Use `children.render()`, `children.options()` and `children.table()` for child content, plus `validation`, `navigation`, `source` and `locale` for shared services. Runtime services expose evaluation, state writes and resets. The adapter owns internal AST access.

`examples/integration/extension-sdk/advanced.tsx` implements an external coordinate control, collection control and Markdown container.

## Authoring and themes

Pass `{ config }` to `compileLocal`, `completeLocalSource` and other authoring services. `createLocalComponentCatalog(config, locale)` from `reactive-md/authoring` derives the insertion catalog from the same manifests. Paired components receive closing-tag completion.

```ts
import { compileLocal, completeLocalSource } from 'reactive-md';
import { createLocalComponentCatalog, insertLocalComponent, validateLocalComponentInsertTemplates } from 'reactive-md/authoring';

const result = compileLocal(source, { config });
const candidates = completeLocalSource(source, offset, { config });
const catalog = createLocalComponentCatalog(config, 'zh');
const edit = insertLocalComponent(config, 'example/note', source, selection, 'zh');
```

`insertLocalComponent` resolves insertion tokens and allocates fresh binding names. `validateLocalComponentInsertTemplates` compiles actual insertion output under the same configuration. Props can carry localized descriptions; editor copy and theme changes do not alter the compilation key.

`defineLocalTheme`, `composeLocalTheme` and `collectLocalThemeCss` define, combine and collect independent theme packages. A theme package is plain data: identity, protocol `reactive-md-theme-1`, both light and dark color schemes, and bounded inline CSS resources. Every selector is scoped to `[data-rmd-theme="name"]`. Component structural styles remain independent of theme enhancements and use shared semantic variables.

```ts
import { defineLocalTheme, composeLocalTheme, collectLocalThemeCss } from 'reactive-md/sdk';

const paper = defineLocalTheme({
  id: 'example/paper', name: 'paper', version: '1.0.0',
  protocol: 'reactive-md-theme-1', colorSchemes: ['light', 'dark'],
  css: [{ id: 'example/paper.css', css: paperCss }],
});
const highContrast = composeLocalTheme({
  id: 'example/paper-contrast', name: 'paper-contrast', version: '1.0.0',
  base: paper, overrides: [{ id: 'example/paper-contrast.css', css: overrideCss }],
});
const stylesheet = collectLocalThemeCss(highContrast);
```

Theme CSS accepts inline `data:` URLs and rejects network references, `@import` and CSS escapes outside strings. Theme packages reject globally named `@font-face` and `@keyframes` in this phase; system fonts, transitions and shared motion variables remain available.

`composeLocalTheme` appends overrides after the base stylesheet. An override must use a resource id the base does not declare. `collectLocalThemeCss` concatenates resources in stylesheet order.

Components declare required resource ids through `styles`; the host supplies corresponding `{ id, css }` resources to build and export. Component defaults precede theme enhancements.

## Build a standalone bundle

`reactive-md/build` is a Node adapter. It reads only modules the host names explicitly, so third-party code stays a host-installed dependency. Names or URLs in a document never trigger a download.

### Host entry module

The entry is Node-loadable ESM: an `.mjs` file, or a `.js` file inside a module package. It exports two prepared objects plus the filesystem contract:

```js
// build-host.mjs
export { config, reactConfig } from './dist/node/entry.mjs';
export const root = new URL('.', import.meta.url);
export const allowlist = ['src'];
export const resources = [
  { id: 'example/component.css', path: 'src/component.css' },
];
export const notices = [
  { id: 'example/package', license: 'MIT', text: 'Attribution text.' },
];
```

`root` is the only directory the adapter reads from. Every `allowlist` directory must be inside `root`, and every resource file must resolve inside both. The entry module must also be inside `root`. `resources` (or `styles`) is optional; `notices` accepts an array of records or a string. The same `resources` and `notices` options passed to the build call are merged with host exports. Identical declarations deduplicate; conflicting contents produce a diagnostic.

### Preflight and build

```ts
import { preflightLocalStandaloneBuild, buildLocalStandaloneBundle } from 'reactive-md/build';

const preflight = await preflightLocalStandaloneBuild({
  entry: './build-host.mjs',
  themes: ['paper'],
  budgets: { maxResources: 64 },
});
if (!preflight.ok) {
  for (const item of preflight.diagnostics) console.error(item.code, item.message);
}
const bundle = await buildLocalStandaloneBundle({ entry: './build-host.mjs', themes: ['paper'] });
```

`preflightLocalStandaloneBuild` validates the host module, the `LocalConfig` key, React implementations against their manifests, offline capabilities and every CSS reference. It returns `ok`, `diagnostics`, `entry`, `root`, `allowlist`, `config`, `configKey`, `resources`, `assets`, `css` and `notices`. It does not load Vite or produce a script.

`buildLocalStandaloneBundle` runs the same preflight, bundles one IIFE script and returns a flat object:

| Field | Contents |
| --- | --- |
| `script` | The single inline IIFE source. |
| `extensions` | Component requirements compatible with `LocalStandaloneBundle`. |
| `seal` | Bundle manifest used by export integrity checks. |
| `configKey` | Semantic key of the installed configuration. |
| `resources` | Collected style resources with id, origin, digest and byte length. |
| `assets` | Inlined CSS, font and image files with path, MIME and digest. |
| `css` | Concatenated resource CSS. |
| `notices` | Formatted notice text. |
| `manifest` | Full build manifest, protocol `reactive-md-build/v1`. |

The build manifest records `sdkVersion`, `configKey`, `format: 'iife'`, the script digest and byte length, resource identities, inlined assets, component requirements, every installed theme and notice entries. Keep it with archived bundles for external verification.

A failed preflight or build throws `LocalBuildError` with every diagnostic attached. Budget overrides are validated; invalid values fall back per key with a diagnostic.

The Vite output must contain exactly one chunk and no assets. The adapter rejects chunks with imports, dynamic imports or implicitly loaded chunks, script text containing `import.meta`, dynamic imports, Worker constructors, service workers, `fetch`/`XMLHttpRequest` or remote module specifiers, an empty script, and a script over 32 MiB. Extension modules that construct a Worker fail the build; the installed kernel's optional ELK worker path is replaced by the in-process factory.

### Resources and budgets

A resource input declares exactly one of inline CSS or a file path. Relative `url()` values in inline CSS need an explicit `base` directory inside `root`.

```ts
{ id: 'example/component.css', css: inlineCss, base: 'src' }
{ id: 'example/theme.css', path: 'src/theme.css' }
```

The collector inlines local `@import` and `url()` targets, keeps `data:` URLs, and reports missing files, remote references, paths outside `root` or the allowlist, symbolic-link escapes, import cycles, duplicate ids with different contents and budget overruns. Output order is deterministic: component style ids, host declarations, then selected themes. Theme selection defaults to every installed theme; listing the reserved `default` name explicitly adds no package.

Default budgets are 128 resources, 4 MiB of CSS, 8 MiB per file, 24 MiB of inlined data, 256 files and import depth 16. The absolute ceilings are 512, 32 MiB, 32 MiB, 64 MiB, 1024 and 32. `maxImportDepth` and `maxInlinedBytes` accept zero.

### Optional Vite peer

Vite 8 is an optional peer dependency. The adapter imports `vite` only when a build actually runs, so consumers that only preflight or read manifests do not install it. For tests or nonstandard hosts, pass `vite` as a `{ build }` facade or a factory returning one. The injected facade is checked before use.

## Offline export and the bundle seal

`defineLocalStandaloneBundle(script, config)` binds a trusted host-built script to the installed manifest set. The seal uses protocol `reactive-md-bundle/v1` and records the SDK version, configuration key, script digest and every theme contract digest.

```ts
import { createLocalExportPlan, createLocalShareableHtml } from 'reactive-md/export';
import { buildLocalStandaloneBundle } from 'reactive-md/build';

const bundle = await buildLocalStandaloneBundle({ entry: './build-host.mjs' });
// `buildLocalStandaloneBundle` already returns a compatible bundle plus resources.

const plan = createLocalExportPlan({
  document, config, target: 'offline', bundle,
  resources: bundle.resources,
});
if (!plan.ok) throw new Error(plan.diagnostics.map(item => item.message).join('\n'));

const html = createLocalShareableHtml({
  source, document, config, state, title: 'My document',
  staticMarkup, css,
  bundle, resources: bundle.resources, notices: bundle.notices,
  mode: 'interactive',
});
```

`createLocalExportPlan` checks target capabilities, component identities and versions, semantic digests, theme selection and style resources before any output or state serialization. It also revalidates carried component definitions and the requirements for every external component the document uses. Targets are `static`, `ssr` and `offline`. An offline target requires a bundle script, validates the bundle's extension requirements and seal, checks that the bundle includes every component the document requires, and compares the selected theme against the sealed themes.

`createLocalShareableHtml` requires `staticMarkup` from `renderLocalStaticDocument` and rejects markup containing an unavailable extension placeholder. It embeds configuration, requirements, styles and the optional runtime script, and records `reactive-md-restore/v1` requirements for the next host.

The standalone entry imports the host's implementations and calls `mountAll`:

```ts
import { mountAll } from 'reactive-md/standalone';
import { reactConfig } from './extensions';

mountAll(document, { reactConfig });
```

Bundle this entry into an IIFE before export. The generated build entry also exports `mountReactiveMD` and `unmountReactiveMD`, and checks the baked configuration key before mounting. Document requirements never trigger code downloads.

## Restoration and versions

SDK exports use a v2 HTML payload that records `reactive-md-restore/v1` requirements. Plain exports keep the existing v1 default behavior. The `reactive-md-state/v1` parameter file is unchanged.

`createLocalRestorationRequirements(document, config, target, resources)` records the SDK range (`^0.6.1`), configuration key, source digest, target, the components the document actually uses with version, range and contract digest, the selected theme, and style resource digests.

`validateLocalRestorationRequirements(value, { config, source, resources, document })` runs before any state is applied or React is mounted. It checks the restoration protocol and size bounds, SDK range, configuration key, source digest, installed component identity and version range, contract digest, target capabilities, theme contract, and resource presence and digest. Missing or mismatched entries block restoration.

A version range may allow an upgrade. A changed component contract still requires recompilation and state validation before the state is applied. The bundle seal catches a script or configuration that differs from its build; the build manifest carries SHA-256 digests for archiving and external checks.

## Compliance testing

`reactive-md/testing` is framework-neutral and has no React, DOM or browser dependency. `reactive-md/testing/react` adds static and SSR execution through React. `reactive-md/testing/browser` runs a portable browser scenario, with an optional Playwright adapter.

The core entry validates manifests and executes real compiler and runtime behavior:

```ts
import {
  createLocalComplianceReport,
  runLocalBehaviorCompliance,
  runLocalManifestCompliance,
} from 'reactive-md/testing';

const manifest = runLocalManifestCompliance(rating);
const behavior = runLocalBehaviorCompliance({
  protocol: 'reactive-md-behavior-spec/v1',
  component: 'rating',
  source: '<rating bind="score" label="Score" max="5" initial="3">',
  writes: [
    { id: 'increment', value: 4, accepted: true, expect: { score: 4 } },
    { id: 'over-max', value: 6, accepted: false },
  ],
}, config);

const report = createLocalComplianceReport({
  config, component: 'rating', suites: [manifest, behavior],
  requireCapabilities: false,
});
```

Manifest cases re-read the definition, check key-order stability, defaults, required props, unknown fields and illegal values. Behavior cases compile the source, perform real `set` and `setMany` calls, prove rollback and revision behavior, reset authored initials, and verify defensive copies for collection arrays. A write spec sets `value` for one slot or `values` for an atomic multi-slot write, and records whether the runtime must accept it plus optional expected parameters.

`runLocalReactCompliance` executes static rendering, two strict SSR passes and an optional server error probe:

```ts
import { runLocalReactCompliance } from 'reactive-md/testing/react';

const react = runLocalReactCompliance({
  config, reactConfig, resources,
  component: 'rating',
  spec: {
    protocol: 'reactive-md-react-spec/v1',
    source,
    staticMarkupIncludes: ['data-rating-static'],
    ssrMarkupIncludes: ['data-rating-static'],
  },
  locale: 'en',
});
```

The `resources` value is the canonical list from the build step. Pass the same array to `renderLocalStaticDocument`, `runLocalReactCompliance` and the export plan, so every stage validates and renders with identical CSS.

Browser compliance takes a driver and a bounded spec. `createPlaywrightBrowserDriver` adapts an existing Playwright context without importing Playwright:

```ts
import {
  createPlaywrightBrowserDriver,
  runLocalBrowserCompliance,
} from 'reactive-md/testing/browser';

const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 900 } });
const browser = await runLocalBrowserCompliance({
  driver: createPlaywrightBrowserDriver(context),
  spec: {
    protocol: 'reactive-md-browser-spec/v1',
    url: 'file:///path/to/interactive.html',
    offline: true,
    cases: [
      { id: 'ready', phase: 'mount', kind: 'visible', selector: '[data-rating]', expected: true },
      { id: 'up', phase: 'edit', kind: 'click', selector: '[data-rating-up]' },
      { id: 'edited', phase: 'edit', kind: 'text', selector: '[data-rating-value]', expected: '4' },
      { id: 'unmount', phase: 'unmount', kind: 'unmount' },
    ],
  },
  config, component: 'rating',
});
```

Browser phases are `mount`, `hydration`, `edit`, `hide-show`, `disabled`, `reset`, `descendant-error` and `unmount`. Case kinds are `visible`, `text`, `attribute`, `count`, `enabled`, `wait`, `click`, `fill`, `press`, `evaluate`, `isolation` and `unmount`. A spec URL must use `file:` or `data:`. The suite reports every phase in `requiredPhases`, which defaults to all eight; a missing phase becomes skipped. Interactive evidence needs the seven lifecycle phases, which exclude hydration, to pass without failures. Offline evidence additionally needs a hydration pass, an offline context, zero http(s)/ws requests and no unexpected page errors.

Every report separates `passed`, `failed`, `skipped` and `unsupported`. A declared capability is satisfied only by a passed case tagged with that capability. Without such a case, evidence stays missing and the aggregate report fails. `complete` is true only when every declared capability has executed evidence. `compareLocalComplianceParity` compares two suite results by case id, status and observed values, which lets an external alias of a default contract be checked against the built-in implementation.

## Copyable component package

The [component package template](../../examples/component-package/README.md) is a complete external consumer. It defines a rating control, a Markdown note container, a package theme and an inlined SVG, then runs the public compliance tools against the installed tarball.

```sh
cd ../reactive-md-component-package
npm install
npm run build
npm test
```

`npm test` builds actual single-file offline HTML, runs the rating and a separate note lifecycle in an offline browser, and writes reports to `dist/compliance.json`. The package exposes compiled JavaScript and type declarations through its `exports` map. The template stays private; rename it, choose a license and remove `private` only when you intend to publish.

## Migration from legacy registration

Legacy `hostComponents`, `hostRenderer` and `hostData` remain available. Combining legacy registration with the new configuration is rejected. Legacy declarations enter the common schema through an input adapter, while legacy render callbacks retain their prop behavior.

To migrate:

1. Replace each host component schema with `defineLocalComponent` and the same name, version, props and capabilities.
2. Move the render function to `defineReactComponent` and read `props`, `bindings` and `children` from the context.
3. Create one `LocalConfig` and one `LocalReactConfig`, then pass them to every compiler, authoring, server and export call.
4. Recompile documents and rebuild standalone bundles. The configuration key changes, and a sealed bundle or restoration requirement from the old configuration no longer matches.

Follow the [component plugin development guide](../development/component-development-en.md) for the workflow.

## Verify a real consumer

The [consumer fixture](../../examples/integration/extension-sdk/README.md) defines a rating, a Markdown hint container and a paper theme through public exports.

```powershell
npm.cmd run build:lib
npm.cmd run test:sdk-consumer
```

The verifier installs tarballs outside the repository, checks types and SSR, builds the standalone bundle, and opens static and interactive HTML in fresh offline browser contexts. Results, exports and screenshots are retained in `artifacts/sdk-consumer`.
