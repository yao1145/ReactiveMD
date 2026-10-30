# Reactive MD component package template

[中文](README-ch.md)

A copyable npm package that defines a rating control and a Markdown note
container, ships a package theme and an inlined SVG asset, and runs the public
compliance tools against the installed package. Every import comes from a
public `reactive-md` entry.

The SDK is a source preview on package version 0.6.1. Registry copies of 0.6.1
do not include these entries. Copy this folder outside the repository, then
install a freshly packed tarball built from the current source. The consumer
checks install that file outside the tree, so the package imports are exercised
as published.

## Public entries

The package imports only these entry points:

- `reactive-md/sdk`
- `reactive-md/presets/default`
- `reactive-md/react`
- `reactive-md/react/server`
- `reactive-md/standalone`
- `reactive-md/testing`
- `reactive-md/testing/react`
- `reactive-md/testing/browser`
- `reactive-md/build` (export bundle only)

## Contents

| Path | Purpose |
| --- | --- |
| `src/manifests.ts` | Bounded JSON manifests for `rating` and `note`. |
| `src/components.tsx` | React implementations, theme composition, configs. |
| `src/theme.ts`, `src/theme.css` | `defineLocalTheme` package with scoped variables. |
| `src/component.css` | Component structure styles. |
| `src/assets/notice.svg`, `NOTICES.md` | Local asset and attribution notices. |
| `src/harness.tsx` | Optional development page for direct React mounting. |
| `sample/document.reactive.md` | Sample document using the package and theme. |
| `scripts/build.mjs` | Builds the Node/SSR entry, types, browser harness page and offline HTML. |
| `scripts/verify.mjs` | Runs manifest, binding, static, SSR and browser compliance. |
| `scripts/build-export.mjs` | Offline export through `buildLocalStandaloneBundle`. |

## Commands

```sh
npm install
npm run build        # JS, types, harness page and offline HTML
npm test             # full compliance: Node, SSR, browser lifecycle and offline
npm run test:node    # manifest, runtime bindings, static and SSR only
npm run typecheck
```

`npm run build` writes:

- `dist/node/entry.mjs`, `dist/node/manifest.mjs`, `dist/node/theme.mjs`
- `dist/types/*.d.ts`
- `dist/harness.html` and `dist/harness/harness.js`
- `dist/interactive.html`, `dist/static.html`, `dist/standalone.js`
- `dist/build-manifest.json`, `dist/resources.json`, `dist/build.json`

`npm test` runs the build, then executes the full compliance suite. The browser
run covers the rating control and a separate note lifecycle, loads
`dist/interactive.html` from `file:` in an offline context, and asserts zero
http(s)/ws requests. It requires Playwright and a browser. If either is
missing, the command exits nonzero and does not report offline or browser
lifecycle as passed.

`npm run test:node` skips the browser suite. It prints that offline and browser
evidence was not executed and writes `complete:false`.

## Generated package exports

`package.json` exposes compiled JavaScript plus declarations:

| Subpath | JavaScript | Types |
| --- | --- | --- |
| `.` | `dist/node/manifest.mjs` | `dist/types/manifests.d.ts` |
| `./react` | `dist/node/entry.mjs` | `dist/types/node-entry.d.ts` |
| `./theme` | `dist/node/theme.mjs` | `dist/types/theme.d.ts` |
| `./styles.css` | `src/component.css` | n/a |

The declarations are emitted from `src` and rewritten so relative imports keep
explicit extensions.

## What each suite proves

- Manifest cases re-read the JSON manifest, reapply declared defaults and reject
  illegal fields, defaults and values.
- Binding cases compile the sample, then perform real `set`/`setMany` calls.
  Accepted writes change parameters and advance the revision. Rejected writes
  leave values and revision unchanged. Reset restores authored initials and
  advances the reset token.
- Static and SSR cases render the real React implementation through
  `reactive-md/react/server`. Two SSR passes must be identical.
- Browser cases prove mount, edit, hide/show, disabled, reset, descendant error
  isolation and unmount. Offline capability additionally requires a hydration
  pass, an offline context, no unexpected page errors and no network requests.
- A declared capability without a passed, tagged case stays `skipped` or
  `unsupported`, and the aggregate report fails.

The canonical resource list comes from the build step. The same `resources`
array is passed to `renderLocalStaticDocument` and `runLocalReactCompliance`, so
SSR and the compliance run see identical CSS.

Reports are written to `dist/compliance.json`; the harness page is
`dist/harness.html`.

## Offline export

`scripts/build-export.mjs` calls `buildLocalStandaloneBundle` from
`reactive-md/build`. It first writes an explicit host module,
`dist/build-host.mjs`, which exports:

- `config` and `reactConfig`
- `root`
- `allowlist`
- `resources`
- `notices`

The resource collector resolves files inside the declared allowlist. The builder bundles one IIFE script, inlines
CSS, fonts and images, and returns a flat object with `script`, `extensions`,
`seal`, `resources`, `assets`, `css`, `notices` and `manifest`. The script then
passes the bundle and its resources to `createLocalShareableHtml` for both
interactive and static output. The static HTML is also rendered by the same
strict server entry, so it fails on an unavailable component instead of shipping
a placeholder.

The browser suite loads `dist/interactive.html` and checks lifecycle behavior
with network access disabled.

## Publishing this package

The template sets `"private": true`. Rename `name`, choose a license and update
`LICENSE` and `NOTICES.md`, then remove `"private": true` only when you intend to publish the
package to npm. This template does not publish anything.
