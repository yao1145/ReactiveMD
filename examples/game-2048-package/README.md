# Reactive MD 2048 component package

A `<game-2048>` component package built on the public Reactive MD extension
SDK. It is a self-contained interactive component: a seeded engine, a React
implementation, a static/SSR preview and a local compliance suite.

> Component tags must start with a letter, so `<2048>` is not a valid SDK tag
> name (`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`). `<game-2048>` keeps the familiar
> number and satisfies the contract.

> Status: test integration case. It exercises the local component SDK end to
> end and is not part of the library release.

## Usage

Build the SDK preview and component tarballs in the ReactiveMD repository:

```sh
npm run build:lib
npm pack --ignore-scripts
npm --prefix examples/game-2048-package run build
npm pack ./examples/game-2048-package --ignore-scripts
```

Then install both tarballs in the host project:

```sh
npm install ../ReactiveMD/reactive-md-0.6.1.tgz ../ReactiveMD/reactive-md-game-2048-package-0.1.0.tgz
```

ReactiveMD, React and React DOM are peer dependencies supplied by the host.

Assemble the host with the public entries:

```tsx
import { createReactHost } from 'reactive-md/react';
import { game2048Package } from 'reactive-md-game-2048-package/react';

export const host = createReactHost({ packages: [game2048Package] });
export const { config, reactConfig } = host;
```

Then author the tag in Markdown:

```md
<game-2048 label="2048" size="4" seed="7">
```

| Attribute | Default | Range | Meaning |
| --- | --- | --- | --- |
| `label` | `2048` | text | Accessible title |
| `size` | `4` | 3–6 | Cells per board side |
| `target` | `2048` | 8–131072 | Tile value that completes the game |
| `seed` | `7` | 0–99999 | Seeded tile placement |
| `debug` | `false` | boolean | Show the error-isolation probe |
| `disabled` | `false` | boolean | Pause input |

Keyboard: arrows or `W A S D` move tiles, `R` restarts. The buttons cover
pointer and touch input. The same `seed` always produces the same opening
position, so static rendering and hydration stay reproducible.

## Try it in the repository Demo

[demo/extensions.ts](https://github.com/yao1145/ReactiveMD/blob/main/demo/extensions.ts)
registers the npm tarball installed from `demo/vendor/`. It reads the
implementation, CSS text and example from `reactive-md-game-2048-package/react`,
and attribution from `reactive-md-game-2048-package/notices?raw`. After editing
this package, run `npm run update:demo-2048` from the repository root to build,
pack and install the replacement. Commit the tarball, dependency declaration
and lockfile together. Preview, the editor catalog and offline HTML use that
same registration; see the [Demo guide](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md)
for fields.

## Commands

```sh
npm run build        # JS, types, harness page and offline HTML
npm test             # full compliance: Node, SSR, browser lifecycle, offline
npm run test:node    # manifest, static and SSR checks only
npm run typecheck
```

`npm test` requires Playwright and a browser. On Windows, set
`PLAYWRIGHT_CHANNEL=msedge` when only Edge is installed.

## Layout

| Path | Purpose |
| --- | --- |
| `src/game-engine.ts` | Pure, deterministic rules and seeded tile generator. |
| `src/manifest.ts` | Bounded JSON manifest for `<game-2048>`. |
| `src/components.tsx` | React and static implementations plus host config. |
| `src/component.css` | Component structure and tile colors. |
| `sample/document.reactive.md` | Sample document with visibility, lock and debug switches. |
| `scripts/build.mjs` | Node/SSR entry, declarations, harness and offline export. |
| `scripts/verify.mjs` | Manifest, React/SSR and browser compliance suites. |

The browser suite proves mount, edit (move tiles), hide/show, disabled,
reset, descendant error isolation and unmount. Offline evidence additionally
requires hydration, an offline context and zero network requests.
