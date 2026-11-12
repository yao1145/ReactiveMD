# 0.8.0 release (2026-11-12)

**English** · [中文](release-0.8.0-ch.md)

This page records the contents, breaking change and publication checks for `reactive-md@0.8.0`. The engine publishes first, then the editor: `reactive-md-editor@0.1.0` is a separate package in a separate repository.

## Release status

| Item | Value |
| --- | --- |
| Engine package | `reactive-md@0.8.0` (2026-11-12; latest) |
| Editor package | `reactive-md-editor@0.1.0` (separate package; publish after the engine) |
| SDK contract | `0.7.0` (`LOCAL_SDK_VERSION`, unchanged) |
| Syntax | `local-draft-3` (unchanged) |
| Component protocol | `component-protocol-3` (unchanged) |
| Theme protocol | `reactive-md-theme-1` (unchanged) |
| State formats | `reactive-md-state/v1`; `reactive-md-component-state/v1` |
| Runtime | Node.js 22.12 or newer; ESM only |

After the engine and the editor are published, install:

```sh
npm install reactive-md@0.8.0
npm install reactive-md-editor@0.1.0
npm install react@19 react-dom@19
```

`react` and `react-dom` 19 are required by `reactive-md/react` and `reactive-md-editor`. Vite 8 is an optional peer of `reactive-md`, needed only when using `reactive-md/vite`.

## Breaking changes

The engine package no longer exports the editor. The old entries belong to published 0.7 packages and do not move to 0.8.

| Removed from `reactive-md` 0.8 | Replacement |
| --- | --- |
| `reactive-md/editor` | `reactive-md-editor` |
| `reactive-md/editor/codemirror` | `reactive-md-editor/codemirror` |
| `reactive-md/editor/styles.css` | `reactive-md-editor/styles.css` |
| `reactive-md/editor/codemirror/styles.css` | `reactive-md-editor/codemirror/styles.css` |

The editor remains a controlled React 19 component with the same editing surface: highlighting, toolbar and insertion commands, completion, binding navigation, rename and format, undo and redo, diagnostics and the ref handle. See the [editor guide](../integration/editor-en.md) and the [repository migration guide](../integration/repository-split-en.md).

No document-syntax or state-format migration accompanies this change. `local-draft-3` remains the only accepted revision, and the SDK, component, theme and state protocols keep their previous values. State restoration still checks the source digest, component configuration key and identity.

## Minimal upgrade

1. Update the engine to `reactive-md@0.8.0`.
2. If the application renders the source editor, add `reactive-md-editor@0.1.0` and replace the four imports and stylesheet paths in the table above. Keep the source in application state and the preview in `reactive-md/react`.
3. If the application uses `reactiveMd()` from `reactive-md/vite`, keep the existing Vite setup. Directory discovery needs no import change; the adapter itself requires Vite 8.
4. Keep document sources and state files as they are. Run the application's compile and render checks against its own documents after the upgrade.

## Compiler entries

The release adds two one-shot compiler entries that return plain data for a host to run or render:

```ts
import { createCompiler } from 'reactive-md/compiler';
import { createStandardCompiler } from 'reactive-md/compiler/standard';

const minimal = createCompiler().compile('# Notes');
const standard = createStandardCompiler().compile('<number bind="n" label="Count" initial="2">\n\n{{ n * 3 }}');
```

`createCompiler` registers no components and keeps CommonMark, RMD structure, expressions, bindings and budgets. `createStandardCompiler` installs the default preset and the KaTeX display checks. Compilation creates no editing session, Worker or runtime and loads no React, theme implementation or CSS. Results use `status: 'valid' | 'recovered' | 'failed'` and keep the `ok` and `document` read path. A minimal result carries its own component configuration key, so passing it to the existing renderer with its default configuration reports `local.extension.config-mismatch`; use the standard entry for the existing React and SSR hosts.

Both factories accept `strict`. Strict mode is the default. With `strict: false`, an unclosed or mismatched region stays as literal source, each finalized recovery produces one stable warning, and compilation resumes at a reliable boundary. Recoverable structure does not downgrade binding, type, configuration, version or budget errors. Both modes map a blank-line-free `<details>` / `<summary>` fragment to one disclosure. See [one-shot compilation](../integration/compiler-en.md) and [strict parsing and local recovery](../reference/tolerance-en.md).

## Runtime services and persistence

New public entries cover component time, randomness and saved progress:

- `reactive-md/runtime` provides document and component identity, serializable seeded randomness, an injectable clock and scheduler, the component-state registry and its budgets.
- `reactive-md/runtime/browser` provides a Web Storage persistence backend and `flushComponentStateOnPageHide`. The registry accepts any `LocalComponentStateStorage`.
- `reactive-md/react/runtime` provides `useTicker`, `useFrame`, `useSwipe`, `useKeys` and `useComponentState`.

`LocalRuntimeOptions` and the React document components accept `documentId`, `randomSeed`, `componentState`, `componentStateStorage` and `componentStateWriteDelayMs`. A write delay coalesces high-frequency saves; `state.flush()` writes pending state, and runtime disposal also flushes. A failed backend keeps the latest state pending so the next save, flush or disposal retries it. `onComponentStateChange` reports explicit saves and clears.

Component state uses the separate `reactive-md-component-state/v1` sidecar. It does not change `reactive-md-state/v1`. Cross-edit restore requires an explicit `state-key`; without it, restore is limited to the same source and session. The SDK contract remains at 0.7.0; changes to the extension assembly require recompilation and a fresh export for that configuration.

## Vite directories

When `reactiveMd()` is called without an `extensions` module, the adapter discovers immediate children of `theme/` and `plugin/` under the Vite root:

```text
theme/paper/theme.css
theme/paper/theme.json       # optional
plugin/tetris/index.ts
plugin/tetris/component.css  # optional
```

Theme CSS, local imports and relative assets are resolved and inlined through the bounded build-resource collector. Remote references, paths outside the allowed directory and budget violations fail. Manual registration with `reactiveMd({ extensions: './extensions.ts' })` remains available; directory and manual options are mutually exclusive. See [directory integration](../integration/directory-discovery-en.md).

## Default UI, charts, Mafs, diagrams and gallery

- `<gallery>` and `<gallery-item>` join the default preset and insertion catalog. They mix images, cards and Markdown, use native mandatory snapping, support wheel, keyboard and thumb navigation, take h3 captions and produce complete static output.
- Default charts give each bar its own hover and focus target, show each visible donut slice's share in the legend, and let legend items toggle series or slices. Bars, lines, points and arcs animate geometry changes; reduced-motion preferences skip the animation.
- Interactive `<coordinate>` and `<plot>` use Mafs for draggable snapped points, pan and zoom, click-to-focus curves with dimmed backgrounds and a pointer-tracked point on the focused curve. Server rendering, static export and print keep the SVG output.
- Default-theme diagrams show node notes in hover and focus popovers, add zoom and fit controls, highlight related paths, use full-frame status colors and handle long labels. Static output retains the node descriptions.
- The default-theme round also fits function plots to their axis ranges with square screen-space grids, lets tooltip layers escape nested clipping, restores primary-button text contrast, aligns Jump buttons with standard buttons and adds brief selection feedback to interactive options.

## Static, SSR and offline boundaries

- Interactive export embeds the validated `reactive-md-component-state/v1` sidecar and restores it before the first render. Static export runs no component runtime and rejects `--component-state-file`.
- Mafs interaction exists only in the client renderer. Server rendering, static export and print use the SVG coordinate and plot output.
- The packed-consumer check covers static SSR and declarations. The host application and Demo own browser acceptance for single-file exports and hydration.
- Offline HTML embeds the source, runtime, styles and verified local raster images. Component state and state files participate only where their formats and identities match.

## Publishing and acceptance

The release uses the manual `.github/workflows/publish.yml` workflow with npm trusted publishing (OIDC), Node 24 and npm ^11.21. The workflow filename stays stable to match the configured trusted publisher. A repository push does not publish npm packages. Publication requires explicit authorization.

Publish in this order:

1. Publish `reactive-md@0.8.0`; verify the registry tarball, integrity and the selected dist-tags.
2. Publish `reactive-md-editor@0.1.0` after the engine is available; the editor names the published engine in its peer range.

Before packing, the engine runs `npm run check` and `npm run notices`. The check builds and type-checks, runs retained regressions, verifies the compiler entry boundary and installs the actual tarball into a fresh consumer for public API and NodeNext declaration checks. Registry integrity and dist-tags are separate post-publish checks.

## Publish-day checklist

- Confirm the release date and status against the completed publication.
- Update the README install pin and the compatibility distribution-tag row only after querying the registry for the published versions.
- Confirm the editor peer range names the published engine before publishing the editor.
- Record the verified registry tarball and integrity values for both packages.

See [versions and compatibility](../compatibility/compatibility-en.md), [source revisions and migration](../compatibility/source-versioning-en.md), and the [0.7.0 release notes](release-0.7.0-en.md) for the previous published release.
