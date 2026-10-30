# Extension SDK preview

[中文](extension-sdk-ch.md)

The source tree includes an SDK preview covering public extensions and unified default components. The package version remains `0.6.1`; the new entries will ship with a later release. Existing registry copies of `0.6.1` do not include the SDK. Build and install a local tarball to use this preview.

Component manifests and instance configuration are plain data. React implementations remain explicitly imported host code. The compiler, Worker, authoring tools and exporter use the same validated configuration.

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

`examples/integration/extension-sdk/advanced.tsx` implements an external coordinate control, collection control and Markdown container. The [phase-two inventory](../development/extension-sdk-phase2-inventory-ch.md) tracks each default component.

## Authoring and themes

Pass `{ config }` to `compileLocal`, `completeLocalSource` and other authoring services. `createLocalComponentCatalog(config, locale)` from `reactive-md/authoring` derives the insertion catalog from the same manifests. Paired components receive closing-tag completion. This phase exposes catalog data for host menus; full editor and Demo menu consolidation follows later.

`defineLocalTheme`, `composeLocalTheme` and `collectLocalThemeCss` define, combine and collect independent theme packages. Theme CSS uses the existing theme protocol and document scopes. This phase supports bounded inline CSS and data resources. Component structural styles remain independent of theme enhancements and use shared semantic variables.

`insertLocalComponent(config, componentId, source, selection, locale)` resolves insertion tokens and allocates fresh binding names. `validateLocalComponentInsertTemplates` compiles actual insertion output under the same configuration. Props can carry localized descriptions; editor copy and theme changes do not alter the compilation key.

Components declare required resource ids through `styles`; the host supplies corresponding `{ id, css }` resources to export. Component defaults precede theme enhancements. Theme packages reject global `@font-face` and `@keyframes` names in this phase; system fonts, transitions and shared motion variables remain available.

## Offline sharing

`reactive-md/export` provides `createLocalExportPlan`, `defineLocalStandaloneBundle`, `createLocalShareableHtml` and `validateLocalExtensionRequirements`. They check target capabilities, component identities, versions, semantic digests, themes and resources before creating output or restoring state.

The host's standalone entry imports its implementations and calls:

```ts
import { mountAll } from 'reactive-md/standalone';
import { reactConfig } from './extensions';

mountAll(document, { reactConfig });
```

Bundle this entry into an IIFE before export. Document requirements never trigger code downloads. This phase uses a host-specific bundle; general build adapters and automatic dependency collection belong to the third phase. Parameter state keeps `reactive-md-state/v1`, with extension requirements stored separately.

## Verify a real consumer

The [consumer fixture](../../examples/integration/extension-sdk/README.md) defines a rating, a Markdown hint container and a paper theme through public exports.

```powershell
npm.cmd run build:lib
npm.cmd run test:sdk-consumer
```

The verifier installs tarballs outside the repository, checks types and SSR, builds the standalone bundle, and opens static and interactive HTML in fresh offline browser contexts. Results, exports and screenshots are retained in `artifacts/sdk-consumer`.

Legacy `hostComponents`, `hostRenderer` and `hostData` remain available. Combining legacy registration with the new configuration is rejected. Legacy declarations enter the common schema through an input adapter, while legacy render callbacks retain their prop behavior. The [architecture plan](../development/extension-sdk-plan-ch.md) tracks subsequent stabilization and consumer tooling.
