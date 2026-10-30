# Reactive MD Tetris component package

A `<tetris>` component package built on the public Reactive MD extension SDK.
It demonstrates a self-contained interactive component: a seeded game engine,
a React implementation, a static/SSR preview and a local compliance suite.

> Status: test integration case. It exercises the local component SDK end to
> end and is not part of the library release.

## Usage

Build the SDK preview in the ReactiveMD repository, then install this package
in a host project:

```sh
npm install ../ReactiveMD/reactive-md-0.6.1.tgz
npm install ../ReactiveMD/examples/tetris-package
```

Assemble the host with the public entries:

```tsx
import { createLocalConfig } from 'reactive-md/sdk';
import { createReactConfig } from 'reactive-md/react';
import { tetris } from 'reactive-md-tetris-package';
import { tetrisImplementation } from 'reactive-md-tetris-package/react';
import 'reactive-md-tetris-package/styles.css';

export const config = createLocalConfig({ components: [tetris] });
export const reactConfig = createReactConfig(config, {
  components: [tetrisImplementation],
});
```

Then author the tag in Markdown:

```md
<tetris label="Tetris" width="10" height="20" speed="600" seed="7">
```

| Attribute | Default | Range | Meaning |
| --- | --- | --- | --- |
| `label` | `Tetris` | text | Accessible title |
| `width` | `10` | 6–14 | Board width in cells |
| `height` | `20` | 12–24 | Board height in cells |
| `speed` | `600` | 100–2000 | Gravity interval in milliseconds |
| `seed` | `7` | 0–99999 | Seeded piece bag |
| `debug` | `false` | boolean | Show the error-isolation probe |
| `disabled` | `false` | boolean | Pause input and gravity |

Keyboard: arrows move, `Space` hard-drops, `P` pauses, `R` restarts. The
toggle buttons cover pointer and touch input. The same `seed` always produces
the same piece sequence, so static rendering and hydration stay reproducible.

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
| `src/tetris-engine.ts` | Pure, deterministic game rules and seeded bag. |
| `src/manifests.ts` | Bounded JSON manifest for `<tetris>`. |
| `src/components.tsx` | React and static implementations plus host config. |
| `src/component.css` | Component structure and piece colors. |
| `sample/document.reactive.md` | Sample document with visibility, lock and debug switches. |
| `scripts/build.mjs` | Node/SSR entry, declarations, harness and offline export. |
| `scripts/verify.mjs` | Manifest, React/SSR and browser compliance suites. |

The browser suite proves mount, edit (pause/resume), hide/show, disabled,
reset, descendant error isolation and unmount. Offline evidence additionally
requires hydration, an offline context and zero network requests.
