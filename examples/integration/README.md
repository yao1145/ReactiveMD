# Standalone integration examples

These directories use the package's public entry points and can be copied outside the repository. The commands below start from the current directory.

These examples target `reactive-md@0.6.0`, published on both `latest` and `next`. Copy the desired example directory outside the repository, then install the pinned version from npm as shown below. React and Vite are installed from the example's own dependencies where needed.

The [extension SDK consumer](extension-sdk/README.md) targets the source preview and uses a locally built tarball. It defines a rating, a Markdown container and an independent theme, then verifies static and offline interactive sharing through public exports.

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

From the source repository root, `npm run verify:release` runs the complete gate, including standalone offline installation from the packed tarball, strict type checking, combined-feature checks, React rendering and HTML export. Use `npm run test:packed` for the focused package check after building. See the [integration guide](../../docs/integration/local-integration-en.md) for the API and host policies.
