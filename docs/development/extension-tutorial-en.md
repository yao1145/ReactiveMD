# Extension author tutorial: definition to offline export

**English** · [中文](extension-tutorial-ch.md) · [Minimal template](../../examples/minimal-extension/README.md)

This tutorial follows the minimal template through one complete path: manifest definition, React implementation, host registration, preview, SSR checks, offline export and tests. The template is [examples/minimal-extension](../../examples/minimal-extension/README.md); the component is `rating-card`, and every command runs in that directory.

Move to the [component package template](../../examples/component-package/README.md) when you need a theme, compiled type declarations or a browser suite. The full field contract is in [the component development contract](component-development-reference-en.md) and [the extension SDK](../integration/extension-sdk-en.md).

## 1. Required steps and optional capabilities

| Step | Required | Output or command | What it proves |
| --- | --- | --- | --- |
| Manifest, React implementation, `config`/`reactConfig` | yes | `src/extension.tsx` | The component compiles, assembles and renders |
| Vite preview | yes | `npm run preview` | The author sees real behavior inside a document |
| Node/SSR checks | yes | `npm test` | Manifest, binding, static and SSR output are correct |
| Offline export | yes | `npm run export` | Bundle, seal, strict SSR and notices assemble into one file |
| Component CSS resource | optional | manifest `styles` + export `resources` | Styles ship to preview, SSR and export |
| Standalone theme | optional | `defineLocalTheme` + `<theme>` | Document-level visual switching |
| Playwright browser suite | optional | `reactive-md/testing/browser` | Real browser evidence for mount, hydration, zero network |
| npm publishing | optional | `npm pack --ignore-scripts` | A second project consumes the public entries |

The base flow covers the first four rows. The template ships no theme, no CSS resource and no browser suite; section 8 states which evidence each capability still needs.

## 2. Copy the template and install

Use Node 22.12 or newer. Copy the template outside the repository:

```sh
cp -r examples/minimal-extension ../my-rating-card
cd ../my-rating-card
npm install
npm run preview
```

The template declares `reactive-md@^0.8.0`; raise the range to the release you target before installing. To test an unreleased candidate, install the tarball packed from the current source instead of the registry version:

```sh
npm install ../reactive-md-<version>.tgz
```

That command also installs `react`, `react-dom` and the dev dependencies. Open the Vite URL (default `http://localhost:5173`) and confirm the sample document, the rating card and the built-in number field all appear.

| Path | Purpose |
| --- | --- |
| `src/extension.tsx` | Manifest, both render functions, `config`, `reactConfig` |
| `src/preview.tsx`, `index.html` | Vite preview page |
| `src/source.ts`, `sample/document.reactive.md` | Sample document and its `?raw` import |
| `scripts/build.mjs` | Compiles `dist/node/entry.mjs` |
| `scripts/test-node.mjs` | Node/SSR compliance |
| `scripts/export.mjs` | Offline export |

## 3. Define the manifest

The manifest is plain data in the first half of `src/extension.tsx`:

```ts
export const ratingCard = defineLocalComponent({
  id: 'example/rating-card',
  name: 'rating-card',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: { kind: 'string', required: true },
    max: { kind: 'number', dynamic: true, default: 5, integer: true, min: 1, max: 10 },
  },
  bindings: {
    value: {
      kind: 'number', family: 'number',
      bind: 'bind', initial: 'initial', initialRule: 'nearest-zero',
      constraints: {
        min: { literal: 0 },
        max: { prop: 'max' },
        step: { literal: 1 },
      },
    },
  },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Rating card', zh: '评分卡' },
    description: { en: 'A leaf card that increments one shared number.', zh: '递增一个共享数值的叶子卡片。' },
    category: 'input',
    insertText: '<rating-card bind="score" label="Score" max="5" initial="3">',
  },
});
```

What each part does:

- `id`, `name`, `version`, `protocol`, `form`: identity and shape. `name` is the document tag name and must be lowercase kebab-case; `form: 'leaf'` means no child content.
- `props`: document attributes. `label` is required; `max` can be dynamic, defaults to 5, and is an integer from 1 to 10. The implementation reads normalized values, so `max="5"` and `max="{{ 5 }}"` both arrive as the number `5`.
- `bindings.value`: the main binding slot. `bind="score"` connects it to the public parameter `score`, `initial="3"` sets the authored initial value, and `initialRule: 'nearest-zero'` picks the closest legal value when it is missing. The lower constraint is a literal, the upper constraint comes from the `max` prop, and the step is 1. The kernel accepts or rejects writes against these constraints.
- `capabilities`: declares interactive, static, SSR and offline support. Each declaration needs matching evidence; section 8 maps suites to capabilities.
- `authoring`: title, description, category and insert template for editor catalogs. Changing this text does not change compiled semantics or reset existing parameters.
- The template declares no `styles`, so it has no CSS resource dependency. CSS is optional; see the end of section 7.

`createLocalConfig` validates duplicate names, reserved names, protocol, dependencies and budgets, then copies and freezes the data. The default preset stays enabled, so `rating-card` uses the same compiler and renderer as built-in components.

## 4. Implement React and static output

The second half of the file implements the interactive and static views and binds both to the same manifest with `defineReactComponent`:

```tsx
export function RatingCard(context: LocalComponentContext) {
  const value = currentValue(context);
  const maximum = typeof context.props.max === 'number' ? context.props.max : 5;
  const unavailable = context.disabled || !context.visible;
  const locked = unavailable || value >= maximum;
  return (
    <div className="rating-card" data-rating-card role="group" aria-label={String(context.props.label)}>
      <output data-rating-card-value>{String(value)}</output>
      <button type="button" data-rating-card-up disabled={locked}
        onClick={() => context.bindings.value.set(value + 1)}>Add one</button>
      <button type="button" data-rating-card-reset disabled={unavailable}
        onClick={() => context.runtime.reset(context.content)}>Reset</button>
    </div>
  );
}

export function RatingCardStatic(context: LocalComponentContext) {
  return (
    <span className="rating-card" data-rating-card-static>
      {String(context.props.label)}: {String(currentValue(context))}
    </span>
  );
}

const ratingCardImplementation = defineReactComponent(ratingCard, {
  render: RatingCard,
  renderStatic: RatingCardStatic,
});
```

Implementation notes:

- `context.bindings.value.get()` reads the shared parameter and `.set(next)` submits a write to the kernel. Out-of-range, mistyped or off-step writes are rejected and keep the value and revision unchanged.
- `context.disabled` and `context.visible` come from the parent and document state. The interactive view disables both buttons while the component is disabled or hidden; reset changes shared state, so it must honor the same gate.
- `context.runtime.reset(context.content)` restores authored initial values. In static mode the runtime ignores resets, so the component needs no extra branch.
- `renderStatic` uses read-only bindings and produces text-equivalent output. Provide it when the static layout differs; the adapter enforces read-only bindings, while your own state and timers still need their own guards.

Create both host objects at the end of the file:

```ts
export const config = createLocalConfig({ components: [ratingCard] });
export const reactConfig = createReactConfig(config, { components: [ratingCardImplementation] });
```

`createReactConfig` checks that the implementation's manifest digest matches the configuration. Recreate both after changing the manifest; changing one side alone fails.

## 5. Register the host and preview in Vite

A host needs two objects: `config` for compilers, editors and workers (usually as `compileOptions.config`), and `reactConfig` for preview, SSR and export. Both must come from the same declarations.

The preview page is two files. `src/preview.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import { reactConfig } from './extension';
import { source } from './source';

const host = document.getElementById('app');
if (!host) throw new Error('The preview page is missing #app.');
createRoot(host).render(
  <LocalReactiveDocument source={source} reactConfig={reactConfig} locale="en" />,
);
```

`index.html` loads `/src/preview.tsx` into `#app`. Vite handles TSX and `?raw` directly, so the template needs no `vite.config.ts`. Run:

```sh
npm run preview
```

Reload the page after editing `src/extension.tsx` or the sample document. The buttons, the `<number>` field and `{{ score }}` in the prose all share one parameter.

In an existing product host, the host owns assembly:

- A Vite project using `reactiveMd()` places the package in `plugin/<name>/index.ts` with a default-exported `LocalReactPackage`, and themes in `theme/<name>/`.
- Manual mode uses `extensions.ts` and exports `host = createReactHost(...)`.
- The Demo repository steps are in [Demo extension authoring](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/extension-authoring-en.md); directory rules are in [directory discovery](../integration/directory-discovery-en.md).

## 6. SSR check

`npm test` builds first, then runs the Node checks:

```sh
npm run build
node scripts/test-node.mjs
```

`scripts/build.mjs` uses the Vite SSR build to compile `src/extension.tsx` into `dist/node/entry.mjs` and keeps `reactive-md` and React external. The test and export scripts import that file, so all three use one manifest and one implementation.

`scripts/test-node.mjs` calls four public tools:

```ts
const manifest = runLocalManifestCompliance(entry.ratingCard);
const behavior = runLocalBehaviorCompliance(behaviorSpec, entry.config);
const react = runLocalReactCompliance({
  config: entry.config,
  reactConfig: entry.reactConfig,
  component: 'rating-card',
  spec: reactSpec,
  locale: 'en',
});
const report = createLocalComplianceReport({
  config: entry.config,
  component: 'rating-card',
  suites: [manifest, behavior, react],
  capabilities: ['interactive', 'static', 'ssr'],
});
```

- The manifest suite re-reads the definition and checks key-order stability, defaults, required props, unknown fields and illegal values.
- The behavior suite compiles `behaviorSpec.source` and performs real `set` calls: `4` and `5` are accepted, `6` and the string `'four'` are rejected, and reset restores the initial `3`. One accepted write, one rejected write and an executed reset produce the tagged `interactive` evidence.
- The react suite renders the static view and runs two strict SSR passes. It requires `data-rating-card-static` and identical output from both passes. `reactSpec.source` is the whole sample document.
- The report goes to `dist/compliance.json` and prints `passed`, `failed`, `skipped` or `unsupported` for each capability.

The report's `capabilities` list intentionally contains only `interactive`, `static` and `ssr`, so a successful run still writes `complete: false`: offline is declared but this run carries no offline evidence.

## 7. Offline export

```sh
npm run export
```

The command runs `scripts/build.mjs`, then `scripts/export.mjs`. Export has three steps:

1. Write the host module `dist/build-host.mjs` for the builder only. It exports `config`, `reactConfig`, `root` and `allowlist`. `root` bounds readable files, and `allowlist` must contain at least one directory inside `root`; the template has no CSS resources and keeps `src`.
2. `buildLocalStandaloneBundle({ entry: host, notices })` runs preflight: config digest, React implementations against manifests, `interactive`/`static`/`offline` support for every component, resource references and budgets. Vite then bundles the implementations into one IIFE and returns `script`, `seal`, `resources`, `notices` and `manifest`.
3. `renderLocalStaticDocument` produces markup through the strict server entry, `exportLocalState` serializes runtime state, and `createLocalShareableHtml` validates the export plan, bundle seal and config digest before writing HTML.

Outputs:

| File | Contents | What it proves |
| --- | --- | --- |
| `dist/interactive.html` | One HTML file with script, styles, state, restoration requirements and notices inlined | Bundle, seal, resources, notices and SSR markup form a deliverable file |
| `dist/build-manifest.json` | Build manifest with SDK version, `configKey`, script digest, resources and component requirements | SHA-256 values support archival verification |

Open `dist/interactive.html` in a browser to try it by hand. That is a manual check, not automated evidence: the template runs no hydration, offline or lifecycle assertions.

CSS resources are optional. To enable them, declare `styles: ['example/rating-card.css']` in the manifest and add `resources: [{ id: 'example/rating-card.css', path: 'src/rating-card.css' }]` to the `buildLocalStandaloneBundle` call in `scripts/export.mjs`, with `allowlist` covering the file. `resources.id` must match `styles`. Themes are optional too: define one with `defineLocalTheme`, pass it to `createLocalConfig({ themes })`, and select it with `<theme name="...">`. Both change the config digest, so rebuild the bundle; an old seal no longer matches.

## 8. Tests and compliance reports

| Suite | Declared capabilities | Evidence | Runs by default |
| --- | --- | --- | --- |
| `runLocalManifestCompliance` | none (baseline validation) | Defaults, required fields, illegal fields, budgets | yes |
| `runLocalBehaviorCompliance` | `interactive` | Real compile and writes, rejection rollback, revision, reset | yes |
| `runLocalReactCompliance` | `static`, `ssr` | Static markup, two identical strict SSR passes, optional server error probe | yes |
| `runLocalBrowserCompliance` | `interactive`, `static`, `offline` | Mount, edit, hide/show, disabled, reset, descendant error isolation, unmount; offline also needs hydration, an offline context and zero requests | no |

`npm test` results mean:

- Passed: the manifest contract, binding rules, static output and SSR output match the declaration.
- Not verified: browser mounting and hydration, zero network requests in an offline context, and whether the exported HTML restores interactivity in a browser.
- `complete` in `dist/compliance.json` is therefore `false`, and the script prints the same statement.

To add that evidence, install `@playwright/test` and import `reactive-md/testing/browser`. Follow `scripts/verify.mjs` in the component package template, write a `reactive-md-browser-spec/v1` scenario, load the `file:` URL of `dist/interactive.html`, and run it in `newContext({ offline: true })`. Extend the report's capability list to four entries only after those checks pass.

Other checks:

```sh
npm run typecheck
```

`tsconfig.json` includes `src` only, and `types: ["vite/client"]` types the `?raw` import. The scripts are `.mjs` and stay outside TypeScript.

## 9. Publish and consume

The template stays `private: true` and has no compiled exports; it serves as a local extension or a development starting point. Publishing needs the three pieces the component package template already provides:

1. Build output: compile TSX to ESM and emit `.d.ts` files. `scripts/build.mjs` in the component package template builds `dist/node/entry.mjs` with Vite SSR and writes `dist/types` with `tsc`.
2. An `exports` map: `.` for the pure manifest entry, `./react` for implementations, and `./styles.css` for component CSS when present. Consumers import only these subpaths.
3. License and notices: add `LICENSE`, `NOTICES.md`, and your package entry in the export script's `notices`.

Rough sequence:

```sh
npm run typecheck
npm test
npm pack --ignore-scripts
```

Install the tarball into a fresh project and verify that `.`, `./react` (plus optional `./theme` and `./styles.css`) import, and that SSR and offline export run. Declare `peerDependencies` or version ranges in `package.json`. Raise the plugin's own version with migration notes when its contract or SDK range changes. The template's `reactive-md` range is `^0.8.0`; raise it when targeting a newer engine. The SDK contract version follows the published package.

The Demo repository consumes candidate packages as content-addressed vendor tarballs with lockfile integrity, never `file:..` or source aliases. The update procedure is [Updating candidate packages](https://github.com/yao1145/ReactiveMD-Demo/blob/main/docs/candidate-package-updates-en.md); the fixture list is in the [Demo vendor README](https://github.com/yao1145/ReactiveMD-Demo/blob/main/vendor/README.md).

## 10. Troubleshooting and limits

| Symptom | Cause | Action |
| --- | --- | --- |
| `Cannot find package 'reactive-md'` | Dependencies are not installed, or the template runs inside the engine repository | Copy it outside the repository and `npm install`, or install the engine tarball |
| `npm test` cannot find `dist/node/entry.mjs` | The build was skipped | Run `npm test` or `npm run build` first |
| Port 5173 is in use | Another Vite server is running | `npm run preview -- --port 5174` |
| `tsc` reports no types for `?raw` | Vite client types are missing | Keep `types: ["vite/client"]` |
| Export reports `local.extension.export-capability` | Some installed component lacks `static`, `interactive` or `offline` | Add the capability and rebuild the bundle; default preset components are checked too |
| The exported HTML opens but does not react | The bundle and config do not match, or the browser blocked inline scripts | Re-run `npm run export` and read the browser console |
| Demo does not discover the component | The entry file name is not recognized, or the package is not the default export | Use `index.ts`/`index.tsx` and `export default` the package |

Template limits:

- One leaf component and one binding slot. Container forms, named slots, collections, structure rules and the authoring catalog are in [the full development contract](component-development-reference-en.md).
- No theme, CSS resource or browser suite; sections 7 and 8 explain how to add them.
- No compiled type declarations or package exports; complete section 9 or start from the component package template.
- Preview and export share one manifest, but the demo has one document. A multi-document host reuses `config`/`reactConfig` instead of creating configurations per document.
