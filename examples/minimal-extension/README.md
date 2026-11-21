# Reactive MD minimal extension template

**English** · [中文](README-ch.md)

A copyable extension with one rating-card component, one Vite preview page, Node/SSR checks and a single-file offline export. Every import comes from a public `reactive-md` entry; the Demo repository is not involved.

The full authoring walkthrough is [the extension tutorial](../../docs/development/extension-tutorial-ch.md) ([English](../../docs/development/extension-tutorial-en.md)). Move to the [component package template](../component-package/README.md) when you need a theme, compiled type declarations and a browser compliance suite.

## Required and optional

| Step | Required | Where |
| --- | --- | --- |
| Manifest, React implementation, `config`/`reactConfig` | yes | `src/extension.tsx` |
| Vite preview | yes | `index.html`, `src/preview.tsx` |
| Node/SSR checks | yes | `npm test` |
| Offline export | yes | `npm run export` |
| Component CSS resource | optional | Declare `styles` in the manifest and provide matching CSS |
| Standalone theme | optional | `defineLocalTheme`; see `src/theme.ts` in the component package template |
| Playwright browser suite | optional | See `scripts/verify.mjs` in the component package template |
| npm publishing | optional | Tutorial section 9 |

The base flow ships no theme, no CSS resource and no browser suite. The component uses semantic markup without a stylesheet.

## Requirements and start

Use Node 22.12 or newer. Copy this directory outside the repository:

```sh
cp -r examples/minimal-extension ../my-rating-card
cd ../my-rating-card
npm install
npm run preview
```

The template declares `reactive-md@^0.8.0`; adjust the range to the release you are validating. To test an unreleased candidate, replace `npm install` with a tarball packed from the current source:

```sh
npm install ../reactive-md-<version>.tgz
```

That command also installs `react`, `react-dom` and the dev dependencies. Otherwise run plain `npm install`. Open the Vite URL (default `http://localhost:5173`); the page shows the sample document and the rating card.

## Files

| Path | Purpose |
| --- | --- |
| `src/extension.tsx` | `defineLocalComponent` manifest, `defineReactComponent` implementation, `config` and `reactConfig`. |
| `src/preview.tsx` | Mounts the sample document with `LocalReactiveDocument`. |
| `src/source.ts` | Imports the sample document with `?raw`. |
| `index.html` | Vite preview page that loads `src/preview.tsx`. |
| `sample/document.reactive.md` | Sample document; the card shares `score` with the built-in `<number>`. |
| `scripts/build.mjs` | Compiles `src/extension.tsx` to `dist/node/entry.mjs` with Vite. |
| `scripts/test-node.mjs` | Runs manifest, binding, static and SSR compliance. |
| `scripts/export.mjs` | Builds the standalone bundle and writes `dist/interactive.html`. |

## Commands

```sh
npm run build      # dist/node/entry.mjs
npm test           # build + manifest, binding, static and SSR checks
npm run export     # build + dist/interactive.html, dist/build-manifest.json
npm run preview    # Vite dev server
npm run typecheck  # tsc --noEmit
```

`npm test` writes `complete: false` to `dist/compliance.json` and prints that browser and offline evidence did not run. It proves manifest validation, accepted and rejected writes to the shared binding, reset, static rendering and two identical SSR passes. It does not prove browser mounting, hydration, zero network requests offline, or that the exported file restores in a browser.

`npm run export` proves that the bundle preflight, config digest and seal match, strict SSR output, state serialization and notice assembly all succeed. The exported HTML is one file with its script, styles and resources inlined.

## Optional additions

- CSS resource: add `styles: ['example/rating-card.css']` to the manifest and provide that file through `resources` and `allowlist` in the export script.
- Theme: define one with `defineLocalTheme`, pass it in `createLocalConfig({ themes: [theme] })`, and select it with `<theme name="...">`.
- Browser suite: add `reactive-md/testing/browser` and Playwright, load `dist/interactive.html` in an offline context, and cover mount, edit, hide/show, disabled, reset, descendant error isolation and unmount. The component package template contains a complete copy.

## Limits

The template has one leaf component and one binding slot. Container forms, named slots, collections and the authoring catalog are covered by the [full development contract](../../docs/development/component-development-reference-en.md). The package stays `private: true` and has no compiled package exports; publishing is tutorial section 9.
