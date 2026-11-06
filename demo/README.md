# Reactive MD Demo

The Playground for Reactive MD: an editor, live preview, document library, HTML export and a set of bilingual example articles. It consumes the candidate `reactive-md` engine and the `reactive-md-editor` package from committed tarballs, so this repository builds without the engine source tree.

Live site: [yaozi.raricy.com](https://yaozi.raricy.com/).

## Requirements

- Node.js 22.12 or newer. CI uses Node 24.
- npm.

## Install and run

```sh
npm ci --legacy-peer-deps
npm run dev
```

Open `http://127.0.0.1:5173`. The embed example is at `/embed.html`.

`npm ci` requires `package-lock.json`. On a fresh checkout without a lockfile, run `npm install --legacy-peer-deps` once and commit the result.

The engine and editor arrive as tarballs under `vendor/`:

- `reactive-md` 0.8.0-next.0
- `reactive-md-editor` 0.1.0-next.0

The committed game packages still declare a `reactive-md` peer range of `^0.7.0`, while the Demo runs the 0.8 prerelease. Install with `--legacy-peer-deps`. The Demo uses their public React entries, and the engine APIs those entries call are unchanged.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server on `127.0.0.1:5173` |
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest unit and integration tests |
| `npm run test:browser:smoke` | One Chromium desktop and mobile smoke run |
| `npm run test:editor` | Editor scrolling, views and source navigation checks |
| `npm run test:toolbar` | Toolbar and component insertion checks |
| `npm run test:interactions` | Editor selection and interaction checks |
| `npm run test:export` | HTML and image export checks |
| `npm run test:extensions` | Installed game packages and offline bundle checks |
| `npm run test:outline` | Document outline behavior |
| `npm run test:workbench` | Compact workbench layout |

Most browser scripts target `http://127.0.0.1:5173`; start `npm run dev` first, or set `DEMO_URL` to another running site. `test:browser:smoke`, `test:interactions` and `test:extensions` start their own Vite server. Scripts use Edge by default; set `PLAYWRIGHT_CHANNEL=chromium` to use the bundled browser. Reports and screenshots go to `artifacts/`.

```sh
npm run dev
DEMO_URL=http://127.0.0.1:5173 PLAYWRIGHT_CHANNEL=msedge npm run test:editor
```

## Content

- `content/examples/local/` contains the example articles shown in the Playground.
- `content/guides/` contains the English and Chinese user guide.
- `src/` contains the application: editor shell, preview, document library, export dialog and extension registration.
- `extensions.ts` registers the Tetris and 2048 packages.

Example and guide files are ordinary Markdown sources imported with `?raw`. Edit them in place; the navigation titles and hints live in `src/examples.ts`.

## Export assets

Exported HTML embeds the engine stylesheet, print stylesheet, notices, package version and standalone runtime. These files ship in the `reactive-md` tarball but are not public subpath exports. `vite.export-assets.ts` resolves the installed package root and exposes each file as a build-time string module. Keep this plugin registered in both `vite.config.ts` and `vitest.config.ts`.

## Editor styles

The editor package owns its styles:

```ts
import 'reactive-md-editor/styles.css';
```

The engine stylesheet remains:

```ts
import 'reactive-md/styles.css';
```

## Migration from the monorepo

See [docs/migration.md](docs/migration.md) for the import and path changes that turned `demo/` into this repository.

## Deployment

The site is a static build. `npm run build` writes `dist/`; `.github/workflows/site.yml` uploads that directory as a workflow artifact and stops there. Production deployment is a manual, versioned symlink switch documented in [AGENTS.md](AGENTS.md).
