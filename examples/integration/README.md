# Standalone integration examples

**English** · [中文](README-ch.md)

These directories use the package's public entry points and can be copied outside the repository. The commands below start from the current directory.

Most examples below target `reactive-md@0.6.0`. Copy the desired example directory outside the repository, then install its pinned version from npm. React and Vite are installed from the example's own dependencies where needed.

The [extension SDK consumer](extension-sdk/README.md) targets `reactive-md@0.8.0` and verifies static and offline interactive sharing through public exports. Release preparation uses a locally built tarball; the SDK contract remains at `0.7.0`. The other older examples retain their 0.6.0 pins.

To run the [streaming source](streaming) example against the current checkout, install the `reactive-md-0.9.3.tgz` built below. The example's standalone manifest pins `0.9.1` as its baseline.

## Static embed

The [static embed](static-embed) imports `card` and `if` through their individual layout pack entries and loads their shared layout stylesheet. It renders without a document runtime, keeps `{{ visitor.name }}` as text and shows a fallback for an unknown component. Two identical host slots share one dynamic import. The performance report groups compilation, loading and rendering under one revision.

From the engine repository root, build the package and render the server example:

```sh
npm run build:lib
node examples/integration/static-embed/render.mjs
```

For the browser example, start `npx vite examples/integration/static-embed` from the same directory and open the printed URL. `node examples/integration/static-embed/render.mjs --defer` emits the loading placeholder that the browser hydration entry expects; use the same external-slot strategy on both sides.

Component implementations can also load on demand instead of entering the initial bundle. `createDeferredReactConfig` from `reactive-md/react/packed` shares one resolver request per component definition, aborts when its last subscriber leaves, and accepts `resolveSync` for SSR and hydration. The async resolver starts after mount, so server output keeps a stable loading placeholder until the implementation is available.

## Node core

Requires Node.js 22.12 or newer. The core example runs without React or network access after installation.

```sh
cd core
npm install reactive-md@0.6.0 --ignore-scripts --no-audit --no-fund
npm start
```

It should print `People: 2, cost: 200` first, then `People: 5, cost: 500`. The source is in [core/index.mjs](core/index.mjs).

## React page

Requires Node.js 22.12 or newer. The first install fetches React 19 and Vite.

```sh
cd react
npm install reactive-md@0.6.0
npm run dev
```

Open the local URL printed by the terminal, adjust the headcount and watch the cost change. The example entry is [react/main.jsx](react/main.jsx), and the library styles are imported through `reactive-md/styles.css`.

## Worker compilation

[worker](worker) is a copyable browser page that keeps compilation off the main thread. It debounces edits, compiles in a module Worker, and falls back to the main thread when a Worker cannot start or crashes.

```sh
cd worker
npm install reactive-md@0.6.0
npm run dev
```

The UI and scheduler wiring live in [worker/main.js](worker/main.js); the Worker entry is [worker/worker.js](worker/worker.js).

## Streaming source compilation

[streaming](streaming) is a deterministic browser example for streaming-source compilation. It appends fixed text chunks on a timer, submits each complete snapshot with `sourcePhase: 'streaming'`, then submits the completed source with `sourcePhase: 'final'`. The page shows the provisional status, transient diagnostics, final diagnostics and a compiled snapshot summary. Cancel or restart invalidates the current run; results from an older run are counted and discarded instead of repainting the page. It uses no model service, network request or credential.

Build a tarball from the current tree in the repository root, then install it in the example:

```sh
# in the repository root
npm pack

cd examples/integration/streaming
npm install ../../../reactive-md-0.9.3.tgz
npm run dev
```

If the directory was copied outside the repository, pass the tarball's absolute path to `npm install` instead. The example uses only `reactive-md` public entries; scheduling lives in [streaming/main.js](streaming/main.js) and the Worker entry is [streaming/worker.js](streaming/worker.js).

## Chat session and scan

[chat-session](chat-session) is a DOM-free Node example that imports only `reactive-md/compiler/session` and `reactive-md/scan`. It keeps one incremental compile session per chat document, shows a cached recompile for unchanged source, an incremental edit, and disposes the session. Host markers come from the scan result's UTF-16 ranges. It imports no React, `reactive-md/authoring`, template or catalog code.

Build a tarball from the current tree in the repository root, then install it in the example:

```sh
# in the repository root
npm pack

cd examples/integration/chat-session
npm install ../../../reactive-md-0.9.3.tgz
npm start
```

The whole example is [chat-session/index.mjs](chat-session/index.mjs); the same file can run inside a Worker.

## Comprehensive host example

[react-comprehensive](react-comprehensive) combines the host-facing additions in one page: a host-provided exchange rate and inventory, dynamic `max="{{ inventory }}"`, a `host-rating` component that shares its binding with built-in controls, saved and restored public parameters through `initialParameters` and `onParametersChange`, and preview-to-source navigation through `onSourceNavigate`.

```sh
cd react-comprehensive
npm install reactive-md@0.6.0
npm run dev
```

Change the rate or inventory buttons, rate the course, and click a paragraph or a control label to see the reported source range. The host schema and renderer are in [react-comprehensive/main.jsx](react-comprehensive/main.jsx).

## Local package verification

To try an unpublished build, run `npm pack` in the repository root and replace `reactive-md@0.6.0` in the install commands with the absolute path to the generated `reactive-md-0.6.0.tgz`.

From the source repository root, `npm run check` runs the complete gate, including standalone offline installation from the packed tarball, strict type checking, combined-feature checks, React rendering and HTML export. Use `npm run test:boundary` for the focused package check after building. See the [integration guide](../../docs/integration/local-integration-en.md) for the API and host policies.
