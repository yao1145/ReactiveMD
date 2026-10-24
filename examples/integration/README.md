# Standalone integration examples

These directories use the package's public entry points and can be copied outside the repository. The commands below start from the current directory.

## Node core

Requires Node.js 22.12 or newer. The core example needs no React and makes no network requests.

```sh
cd core
npm install reactive-md@0.4.0 --ignore-scripts --no-audit --no-fund
npm start
```

It should print `People: 2, cost: 200` first, then `People: 5, cost: 500`. The source is in [core/index.mjs](core/index.mjs).

The core and worker examples use host APIs added in the unreleased 0.4.0 preview. Until 0.4.0 is published, install a tarball produced by `npm pack` in this checkout instead of fetching that version from npm.

## React page

Requires Node.js 22.12 or newer. The first install fetches React 19 and Vite.

```sh
cd react
npm install reactive-md@0.3.1
npm run dev
```

Open the local URL printed by the terminal, adjust the headcount and watch the cost change. The example entry is [react/main.jsx](react/main.jsx), and the library styles are imported through `reactive-md/styles.css`.

## Worker compilation

[worker](worker) is a copyable browser page that keeps compilation off the main thread. It debounces edits, compiles in a module Worker, and falls back to the main thread when a Worker cannot start or crashes.

```sh
cd worker
npm install
npm run dev
```

The UI and scheduler wiring live in [worker/main.js](worker/main.js); the Worker entry is [worker/worker.js](worker/worker.js).

From the source repository root, `npm run test:packed` verifies standalone offline installation from the packed tarball, strict type checking and React static server rendering. See the [integration guide](../../docs/local-integration-en.md) for the API and host policies.
