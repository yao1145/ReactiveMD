# Standalone integration examples

These directories use the package's public entry points and can be copied outside the repository. The commands below start from the current directory.

These examples target `0.4.0`, the preview release on the `next` channel. First run `npm pack` in the repository, then copy the desired example directory outside the repository. In each command below, replace `/path/to/reactive-md-0.4.0.tgz` with the tarball's absolute path. The install uses the built package; React and Vite are installed from the example's own dependencies where needed.

## Node core

Requires Node.js 22.12 or newer. The core example needs no React and makes no network requests.

```sh
cd core
npm install /path/to/reactive-md-0.4.0.tgz --ignore-scripts --no-audit --no-fund
npm start
```

It should print `People: 2, cost: 200` first, then `People: 5, cost: 500`. The source is in [core/index.mjs](core/index.mjs).

The core and worker examples use host APIs added in the `0.4.0` preview.

## React page

Requires Node.js 22.12 or newer. The first install fetches React 19 and Vite.

```sh
cd react
npm install /path/to/reactive-md-0.4.0.tgz
npm run dev
```

Open the local URL printed by the terminal, adjust the headcount and watch the cost change. The example entry is [react/main.jsx](react/main.jsx), and the library styles are imported through `reactive-md/styles.css`.

## Worker compilation

[worker](worker) is a copyable browser page that keeps compilation off the main thread. It debounces edits, compiles in a module Worker, and falls back to the main thread when a Worker cannot start or crashes.

```sh
cd worker
npm install /path/to/reactive-md-0.4.0.tgz
npm run dev
```

The UI and scheduler wiring live in [worker/main.js](worker/main.js); the Worker entry is [worker/worker.js](worker/worker.js).

From the source repository root, `npm run verify:release` runs the complete gate, including standalone offline installation from the packed tarball, strict type checking, combined-feature checks, React rendering and HTML export. Use `npm run test:packed` for the focused package check after building. See the [integration guide](../../docs/local-integration-en.md) for the API and host policies.
