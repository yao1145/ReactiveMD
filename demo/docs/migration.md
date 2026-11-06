# Migration from the monorepo

This repository was `demo/` inside the ReactiveMD monorepo. It now builds against installed packages and owns its content, configuration and workflows.

## Dependencies

Replace the workspace link with versioned tarballs:

```json
{
  "dependencies": {
    "reactive-md": "file:vendor/reactive-md-0.8.0-next.0.tgz",
    "reactive-md-editor": "file:vendor/reactive-md-editor-0.1.0-next.0.tgz"
  }
}
```

The game packages keep their existing vendor tarballs. Install with `--legacy-peer-deps` because those packages still declare a `reactive-md` peer range of `^0.7.0`.

## Editor imports

The editor is a separate package:

| Before | After |
| --- | --- |
| `reactive-md/editor` | `reactive-md-editor` |
| `reactive-md/editor/styles.css` | `reactive-md-editor/styles.css` |
| `reactive-md/editor/codemirror` | `reactive-md-editor/codemirror` |
| `reactive-md/editor/codemirror/styles.css` | `reactive-md-editor/codemirror/styles.css` |

Engine imports stay unchanged:

```ts
import { compileLocal } from 'reactive-md';
import { LocalDocumentView } from 'reactive-md/react';
import { reactiveMd } from 'reactive-md/vite';
```

## Styles

Both stylesheets are loaded at the application entry:

```ts
import 'reactive-md/styles.css';
import 'reactive-md-editor/styles.css';
```

The engine stylesheet covers document components. The editor stylesheet covers the CodeMirror frame, gutter, toolbar and view bar.

## Content paths

Parent references no longer resolve. The Demo now owns the files it renders:

| Before | After |
| --- | --- |
| `../../examples/local/...` | `../content/examples/local/...` |
| `../../docs/guides/local-guide-*.md` | `../content/guides/local-guide-*.md` |

`src/examples.ts` imports example sources with `?raw`. `src/App.tsx` imports both guide sources. Tests and browser scripts read the same files through path variables relative to `tests/` or `scripts/`.

The guide footer shows `content/guides/local-guide-en.md` and `content/guides/local-guide-ch.md`.

## TypeScript

`tsconfig.json` is standalone. It no longer extends the monorepo root and has no `paths` aliases back to engine source. Module resolution uses the installed package exports:

```json
{
  "moduleResolution": "Bundler",
  "types": ["vite/client", "node"]
}
```

## Export artifacts

`src/export-html.ts` previously imported generated files from `../../dist-library/` and `../../dist-standalone/`. Those parent paths do not exist here. The engine now exposes explicit public asset exports.

`vite.export-assets.ts` resolves public engine exports and exposes them as string modules:

| Virtual module | Package file |
| --- | --- |
| `virtual:reactive-md-assets/base-css` | `reactive-md/styles.css` |
| `virtual:reactive-md-assets/print-css` | `reactive-md/print.css` |
| `virtual:reactive-md-assets/notices` | `reactive-md/notices` |
| `virtual:reactive-md-assets/package-json` | `reactive-md/package.json` |
| `virtual:reactive-md-assets/runtime` | `reactive-md/assets/standalone.js` |

The plugin is registered in both `vite.config.ts` and `vitest.config.ts`.

## Vite plugin order

Keep `reactiveMd({ extensions: './extensions.ts' })` and `exportAssets()` registered together:

```ts
plugins: [react(), reactiveMd({ extensions: './extensions.ts' }), exportAssets()]
```

`reactiveMd` owns the host and bundle virtual modules, dependency exclusion and React deduplication. `exportAssets` only serves raw engine artifacts.

## Tests and browser checks

Vitest keeps the article, rendering, export, document-library and editor integration suites. Browser checks are grouped by purpose:

- `test:editor`: scrolling, views and source navigation.
- `test:toolbar`: toolbar actions.
- `test:interactions`: selection and editor interaction probes.
- `test:export`: HTML and image export.
- `test:extensions`: installed game packages.
- `test:browser:smoke`: one Chromium pass at desktop and mobile widths.

Most browser scripts target a running site at `http://127.0.0.1:5173` or `DEMO_URL`; `test:browser:smoke`, `test:interactions` and `test:extensions` start their own Vite server. `PLAYWRIGHT_CHANNEL=chromium` selects the bundled browser.

## CI and deployment

`ci.yml` installs, tests and builds on Node 24. `site.yml` builds and uploads `dist/` as an artifact. Production deployment remains the manual versioned symlink switch in [AGENTS.md](../AGENTS.md).
