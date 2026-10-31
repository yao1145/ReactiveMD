# Component plugin development contract

[中文](component-development-reference-ch.md) · [Five-minute quick start](component-development-en.md)

A plugin is an npm component or theme package that a host installs, imports and composes explicitly. Its contract consists of data manifests, React implementations, authoring information and resources. Hosts assemble it with `createLocalConfig` and `createReactConfig`.

The SDK is a source preview on package version `0.6.1`. Registry copies of `0.6.1` predate these APIs. Use a tarball built from the current source for this workflow. See the [SDK reference](../integration/extension-sdk-en.md) for types and limits. Historical delivery evidence is archived outside the published documentation.


## Convenience packages and host composition

Use `defineReactComponentPackage` from `reactive-md/react` for simple components. It accepts an inline manifest, `render`, optional `renderStatic`, inline `css` and explicit `resources`. Defaults are protocol `reactive-md-component/v1`, form `leaf` and empty props. CSS defaults its resource ID to `id + '.css'`; components without CSS acquire no style requirement. Capabilities stay explicit and require compliance evidence.

The result exposes a serializable `definition`, implementation array `components` and validated `resources`. `createReactHost({ packages, components?, themes?, resources?, notices? })` composes them once and returns matching `config`, `reactConfig`, `compileOptions`, resources, CSS and notices. Existing collision, dependency and resource checks remain in use, with the default preset enabled.

Distributable packages retain a pure manifest entry. A separate manifest can be spread into the convenience factory, with matching style identities. The scaffold derives its style identity from one ID constant so the pure and React entries have the same digest. Single-file authors can emit the normalized `definition` as pure data during their build. Workers receive serialized configuration; implementation code stays in its own entry.

`renderStatic` is already optional and falls back to `render`. Branch on `ctx.mode === 'static'` or `ctx.bindings.isReadOnly`. The kernel rejects shared binding writes in static mode; components still control their own React state, timers and event handlers. Timer effects should return in static mode and clean up on unmount. Separate static renderers are useful for different layouts.

## Vite integration and configuration diagnostics

```ts
import { reactiveMd } from 'reactive-md/vite';
export default { plugins: [reactiveMd({ extensions: './extensions.ts' })] };
```

The registration module exports `host = createReactHost(...)`. Applications import it from `virtual:reactive-md/host`, which supplies styles without a private alias or manual injection. It also exposes configuration/resource fields and an `extensions` namespace for host-owned metadata such as examples. Metadata never enters the Worker. Reference `reactive-md/vite/client` for virtual-module types.

The adapter merges Vite settings, excludes ReactiveMD JS entries from prebundling and deduplicates React. Component defaults precede theme CSS; configuration changes reload the host and dispose old styles. Applications explicitly pass `host.reactConfig` to views and `host.compileOptions` to compilers, editors and Workers. Import the core stylesheet `reactive-md/styles.css`; the scaffold includes it.

Production builds emit `reactive-md-standalone.js` and `reactive-md-export.json`. Browser exporters can lazily import the complete bundle through `virtual:reactive-md/bundle`. The adapter reuses public build capability, resource, budget and offline checks. Preview-only packages remain usable, with missing export capabilities recorded in the error manifest and export diagnostics. An offline bundle covers every registered component, and registration modules must be loadable by the Node build entry. Style declarations identify resources; packages or explicit resource records provide their CSS.

New documents carry `componentConfigKey` through Worker transport and incremental patches. Views, strict SSR and export compare it with the installed host and report `local.extension.config-mismatch` when compilation used another registry. Existing version/implementation validation remains in place. Documents without the new field retain contract-based checks.

## 1. Start outside the repository

Use Node 22.12 or later and React 19 for the React adapter. The template's `package.json` declares its build and browser test dependencies.

Build the preview package in the ReactiveMD checkout:

```sh
npm run build
npm pack --ignore-scripts
```

Copy [examples/component-package](../../examples/component-package/README.md) into a new sibling directory named `my-reactivemd-plugin`. From that directory run:

```sh
npm install ../ReactiveMD/reactive-md-0.6.1.tgz
npm run typecheck
npm test
```

`npm test` builds JavaScript, declarations, static and interactive HTML, then runs Node, SSR and offline browser checks. Install a Playwright browser first; on Windows, select an installed channel with `PLAYWRIGHT_CHANNEL=msedge` when appropriate. Get the unchanged template passing before changing its behavior and tests.

## 2. Package layout

| File or export | Purpose |
| --- | --- |
| `src/manifests.ts`, package `.` | Data manifests for core, Worker and authoring consumers |
| `src/components.tsx`, `./react` | React and static implementations bound to those manifests |
| `src/theme.ts`, `./theme` | Independent theme definition and resource identities |
| `src/component.css`, `./styles.css` | Default structural styles, shipped with their referenced assets |
| `scripts/build.mjs` | Node/browser output, `.d.ts` files and example exports |
| `scripts/verify.mjs` | Manifest, binding, SSR and separate rating/container browser scenarios |
| `LICENSE`, `NOTICES.md` | Package license and attribution for offline distribution |

Keep manifests serializable and functions in the implementation entry. Package exports point to built JavaScript and declarations. Consumers import public package entries.

## 3. Define the contract

The following `manifests.ts`, `components.tsx` and `host.tsx` form a standalone minimal example; section 6 supplies `component.css`. The full template also has note, theme and test exports. Update those references and scenarios when changing template components.

Save this rating contract as `src/manifests.ts`:

```ts
import { defineLocalComponent } from 'reactive-md/sdk';

export const rating = defineLocalComponent({
  id: 'example/rating', name: 'rating', version: '1.0.0',
  protocol: 'reactive-md-component/v1', form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', dynamic: true, default: 5, min: 1, max: 10, integer: true },
  },
  bindings: {
    value: {
      kind: 'number', family: 'number', bind: 'bind', initial: 'initial',
      initialRule: 'nearest-zero',
      constraints: { min: { literal: 0 }, max: { prop: 'max' }, step: { literal: 1 } },
    },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { zh: '评分', en: 'Rating' }, category: 'input',
    description: { zh: '与数字控件共享评分。', en: 'Share a rating with numeric controls.' },
    insertText: '<rating bind="score" label="Score" max="5" initial="3">',
  },
  styles: ['example/component.css'],
});
```

`id` identifies the contract, `name` is the document tag and `version` is the component version. Registration checks duplicate names/ids, protocol, dependencies, defaults and budgets. Built-in name overrides are rejected. Configurations are frozen; create a new configuration when the component set changes.

Validated number props are numbers for both `max="5"` and `max="{{ 5 }}"`. Implementations read normalized props and submit state changes through binding handles.

Forms are `leaf`, `inline` and `container`. Containers declare content rules and render Markdown through `ctx.children.render()`. Use public content projections for options, tables and structural children. The template's `note` demonstrates a container. Section 10 covers new kernel primitives.

## 4. React and static output

A standalone `src/components.tsx` implementation can be:

```tsx
import { defineReactComponent, type LocalComponentContext } from 'reactive-md/react';
import { rating } from './manifests';

export function RatingControl(ctx: LocalComponentContext) {
  const value = ctx.bindings.value.get() as number;
  const maximum = ctx.props.max as number;
  return <button className="rmd-example-rating"
    disabled={ctx.disabled || !ctx.visible || value >= maximum}
    aria-label={String(ctx.props.label)}
    onClick={() => ctx.bindings.value.set(value + 1)}>{value}</button>;
}

export function RatingStatic(ctx: LocalComponentContext) {
  return <span>{String(ctx.props.label)}: {String(ctx.bindings.value.get())}</span>;
}

export const ratingImplementation = defineReactComponent(rating, {
  render: RatingControl, renderStatic: RatingStatic,
});
```

The assertions correspond to the manifest's number contracts. Static rendering reads the current value; interactive rendering writes through the kernel, which preserves state on invalid updates. Multiple numeric slots commit atomically with `ctx.bindings.setMany`. The SDK reference defines supported slot and collection combinations.

Use React state for local UI state. Release timers, subscriptions and listeners in effect cleanup. Pause work when hidden where appropriate, and respond to `resetToken`. Static setters are rejected and runtime reset is ignored in static mode. Provide accessible names, keyboard operation, focus and disabled feedback.

## 5. Host registration and editor support

Pass the same configuration to compilation, rendering, authoring and export. A standalone `src/host.tsx` can assemble the example:

```tsx
import { useState } from 'react';
import { createLocalConfig } from 'reactive-md/sdk';
import { createReactConfig, LocalReactiveDocument } from 'reactive-md/react';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import { rating } from './manifests';
import { ratingImplementation } from './components';
import 'reactive-md/styles.css';
import 'reactive-md/editor/styles.css';
import './component.css';

export const config = createLocalConfig({ components: [rating] });
export const reactConfig = createReactConfig(config, { components: [ratingImplementation] });

export function Playground() {
  const [source, setSource] = useState(
    '<number bind="score" label="Score" min="0" max="5" step="1" initial="3">\n'
    + '<rating bind="score" label="Rating" max="5">',
  );
  return <ReactiveMarkdownEditor value={source} onChange={setSource}
    compileOptions={{ config }} toolbar authoring
    preview={<LocalReactiveDocument source={source} reactConfig={reactConfig} />} />;
}
```

The default preset stays enabled. These controls share a numeric binding with matching constraints and one explicit initial value.

The editor reads titles, descriptions, category and insertion template from `authoring`; prop `description` supplies help. Supplied templates are validated under the same configuration. Insertion supports fresh binding names, selections, caret placement and undo/redo. Custom editors can use `createLocalComponentCatalog`, `insertLocalComponent` and `validateLocalComponentInsertTemplates`.

### Use the repository Demo

Add the package to the existing array in [demo/extensions.ts](https://github.com/yao1145/ReactiveMD/blob/main/demo/extensions.ts). Contributions accept `components` (React implementations), `resources` (`{ id, css }` records), `themes`, `notices` and `examples`. The Demo reads manifests from implementations and assembles shared compiler and React configuration, preview styles, the editor catalog, example navigation and offline exports. The repository ships two complete installed-package cases: `examples/tetris-package` registers `<tetris>` and `examples/game-2048-package` registers `<game-2048>`. Both are packed into npm tarballs under `demo/vendor/`, installed as Demo dependencies, and imported through their public `./react` and `./notices` entries. The 2048 case also records the tag rule: component names must start with a letter, so the familiar `<2048>` spelling is not valid. After editing either package, run `npm run update:demo-tetris` or `npm run update:demo-2048` to build and install a new snapshot and update the dependency lockfile.

Resource IDs match manifest `styles`. Supply inline CSS with data URLs, either exported by the package or imported from a CSS file with Vite's `?inline`. Example source can come directly from the package; bilingual metadata registers it in the catalog. The host maintains Vite deduplication and compiler options for every package.

From the repository root, run `npm run build:demo`, then `node demo/scripts/verify-extensions.mjs`. Add `--dev` to exercise development mode. The script checks the real Worker, catalog, controls and exports opened offline. This assembly layer belongs to the Demo; packages retain the public manifest, React, theme and resource contracts. Independent hosts use the assembly example above. See the [Demo guide](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md) for fields and limits.

## 6. Styles and independent themes

Default component CSS supplies structure and readable basics. Scope selectors to the document and use a package prefix:

```css
.local-document .rmd-example-rating {
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--accent);
  min-height: 44px;
}
```

Use `--rmd-<package-or-component>-<purpose>` for component variables. Themes override shared semantic variables without needing to know every component. Define a theme with `defineLocalTheme`, compose ordered overrides with `composeLocalTheme`, and include the result in configuration `themes`. Documents select it with `<theme name="paper">`.

The template's `paper` demonstrates light/dark modes and scope; see the [theme protocol](../reference/theme-protocol-en.md). Theme definitions accept scoped inline CSS/data resources. Global font names and keyframes are outside that contract. The build adapter resolves local files referenced by component CSS; normalize theme resources into the accepted form before distributing a theme package.

## 7. Build, SSR and offline sharing

Preview uses implementations explicitly imported by the host. Offline sharing uses a matching prebuilt bundle. Start from the template's `scripts/build-export.mjs`. Its Node-loadable host ESM exports:

| Field | Requirement |
| --- | --- |
| `config`, `reactConfig` | Matching declarations and implementations |
| `root`, `allowlist` | Resource root and allowed directories inside it; the host entry is also inside root |
| `resources` | CSS identities matching manifest styles, supplied as inline CSS or root-relative file paths |
| `notices` | License/attribution for the package, ReactiveMD and distributed dependencies |

Use `preflightLocalStandaloneBuild` for diagnostics, then `buildLocalStandaloneBundle` for one IIFE, inline resources, notices and a manifest. Vite 8 is the optional peer needed for actual builds. Missing/remote resources, directory escapes, cycles, conflicts, exceeded budgets and unsupported offline implementations reject the build.

Strict SSR calls `renderLocalStaticDocument({ document, runtime, reactConfig, resources })`. Check `ok` before reading `markup`. Pass the same canonical resources to SSR, compliance and export when a component declares styles. `bundle.resources` is suitable for all three.

`createLocalShareableHtml` receives the compiled document, state, strict SSR markup, CSS and bundle. Export validates capabilities, component/theme contracts, the bundle seal and resources. Restoration validates versions and digests before applying state or mounting. Hosts supply installed code; document declarations never download it. Changed source or contracts require recompilation, state validation and a rebuilt bundle.

## 8. Evidence for each capability

| Tool | Executed checks |
| --- | --- |
| `runLocalManifestCompliance` | Manifest round trips, defaults, invalid values, fields and budgets |
| `runLocalBehaviorCompliance` | Real compiler/runtime writes, rollback, revision, array copies and reset |
| `runLocalReactCompliance` | Static output, deterministic SSR and configured server error probes |
| `runLocalBrowserCompliance` | Mount/edit/hide/disable/reset, descendant error isolation and unmount; offline also requires hydration, disabled networking and zero requests |
| `createLocalComplianceReport` | Evidence for the same component, version and config; missing evidence stays explicit |

`ok` means the requested checks passed; `complete` means every declared capability has executed evidence. `npm run test:node` skips the browser and writes `complete:false`. Give the rating and container separate browser scenarios; the container must exercise its own content, visibility and child lifecycle.

Replace template scenarios with the plugin's actual interactions. Preserve distinctions between failed, skipped and unsupported. `compareLocalComplianceParity` compares shared semantics of default components and external aliases. Record actual engines, widths, keyboard/focus behavior and accessibility observations.

## 9. Pack and consume in a second project

Run `npm run typecheck` and `npm test`, then `npm pack --ignore-scripts`. Install that plugin tarball and the ReactiveMD SDK tarball in another fresh project. Exercise the plugin's `.`, `./react`, `./theme` and `./styles.css` exports, NodeNext types, SSR, preview and offline HTML.

Before publishing, update name, version, LICENSE, NOTICES and exports. Inspect built JS/types, CSS and referenced assets. Replace local `file:` SDK dependencies with an actually published version containing these SDK entries, then remove template `private`. Declare the ReactiveMD range the package supports; version changed plugin contracts and document migrations.

Migrate `hostComponents`, `hostRenderer` and `hostData` through the [SDK migration guide](../integration/extension-sdk-en.md), then recompile and rebuild the bundle.

## 10. Contribute to the default preset or kernel

Public rules usually require only a definition, implementation and host assembly. For default preset contributions, definitions live in `src/presets/default-components.ts`, implementations in `src/components/`, and authoring information in the default authoring data. The preset uses the same public protocol.

Add kernel code when introducing expression, state-family, structure or budget primitives, and define their public contracts. Review them through the [component protocol](component-protocol-en.md), [compatibility rules](../compatibility/compatibility-en.md) and [proposal template](component-protocol-en.md#13-new-component-proposal-template). Component version, SDK protocol, syntax revision and package version are separate decisions.

Run `npm run test:docs` for repository documentation. Build before `test:package`/`test:packed` when public entries or types change. Exercise affected runtime behavior with focused tests, and use `verify:release` for cross-system work or releases. Historical architecture evidence is archived outside the published documentation.
