# Standalone integration examples

These directories use the package's public entry points and can be copied outside the repository. The commands below start from the current directory.

## Node core

Requires Node.js 22.12 or newer. The core example needs no React and makes no network requests.

```sh
cd core
npm install reactive-md@0.3.1 --ignore-scripts --no-audit --no-fund
npm start
```

It should print `People: 2, cost: 200` first, then `People: 5, cost: 500`. The source is in [core/index.mjs](core/index.mjs).

## React page

Requires Node.js 22.12 or newer. The first install fetches React 19 and Vite.

```sh
cd react
npm install reactive-md@0.3.1
npm run dev
```

Open the local URL printed by the terminal, adjust the headcount and watch the cost change. The example entry is [react/main.jsx](react/main.jsx), and the library styles are imported through `reactive-md/styles.css`.

From the source repository root, `npm run test:packed` verifies standalone offline installation from the packed tarball, strict type checking and React static server rendering. See the [integration guide](../../docs/local-integration-en.md) for the API and host policies.
