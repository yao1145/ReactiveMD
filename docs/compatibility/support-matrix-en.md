# Support matrix

**English** · [中文](support-matrix-ch.md)

This matrix defines public support for `reactive-md@0.9.3`, `reactive-md-editor@0.2.1` and the paired Demo candidate. See [Versions and compatibility](compatibility-en.md) for the package pair.

## Support levels

| Level | Definition |
| --- | --- |
| Verified | A passing candidate check covers the listed version or environment. |
| Declared | The range and acceptance check are defined. The release evidence records the result for the candidate. |
| Unverified | The environment awaits verification. |
| Not supported | Outside the current support scope. |

The package requires Node 22.12.0 or newer. This release line verifies the listed Node 22.x and 24.x versions. React and Vite peer ranges are installation constraints. The table gives the tested versions. A complete run records the three source revisions, the compatibility manifest digest and per-check results in `artifacts/support/latest.json`.

## Support matrix

| Area | Scope | Level | Check | Verification |
| --- | --- | --- | --- | --- |
| `Node.js` | 22.x (minimum 22.12.0) | Verified | `node-runtime` | The full engine check passed on 22.17.0. |
| `Node.js` | 24.x | Verified | `node-runtime` | Release validation uses 24.22.2. |
| React / react-dom | Peer `^19.0.0` | Verified | `react-range` | Tested with `19.3.1`. The editor requires React 19. |
| Vite | Optional peer `^8.0.0` for `reactive-md/vite` | Verified | `vite-range` | Tested with `8.3.5`. |
| Playwright Chromium | Bundled browser | Verified | `playwright-chromium-core` | Tested with `156.0.8078.4`. Run the check separately. |
| Google Chrome | Chrome channel on Windows | Verified | `chrome-core` | Engine fixture tested with `157.0.8103.80`. |
| Microsoft Edge | Edge channel on Windows | Verified | `edge-core` | Engine fixture tested with `135.0.3179.66`. |
| Playwright Firefox | Bundled browser | Unverified | `firefox-core` | The optional check can run separately. |
| Playwright WebKit | Bundled browser | Unverified | `webkit-core` | The optional check can run separately. Safari requires its own device check. |
| Safari | Apple devices | Unverified | none | Device verification is pending. |
| Desktop layout | Desktop browser | Declared | `demo-smoke` | The Demo smoke check covers 1440 px in Edge. |
| Narrow layout | Narrow viewport | Declared | `demo-smoke` | The Demo smoke check covers 390 px in Edge. |
| Static SSR | `react-dom/server` | Verified | `ssr-static` | The packed consumer verifies server-rendered markup. |
| Single-file HTML export | `reactive-md-html/v1` | Declared | `demo-smoke` | The Demo smoke check builds the file and opens it offline in Edge. |
| Interactive single-file HTML | Inline `reactive-md-html/v1` runtime | Declared | `demo-smoke` | The Demo smoke check operates the slider offline and checks the resulting content. |
| General SSR hydration | Host-managed hydration | Not supported | none | See interactive single-file HTML for the supported boot path. |
| Engine Worker | `LocalCompileScheduler` and `LocalCompileWorker` | Verified | `worker-unit` | The Worker unit suite passed. |
| Editor analysis Worker | CodeMirror analysis Worker | Declared | `editor-pack` | The packed consumer checks the Worker asset and its imports. |
| PDF | `reactive-md/pdf` | Verified | `pdf-static` | Tested with bundled Chromium and `pdftotext`. |
| Editor package | `reactive-md-editor` 0.2.1 | Declared | `editor-pack` | Peer range `^0.9.2`. Packed-consumer checks cover SSR, the Worker and NodeNext declarations. |
| Compatibility manifest | Cross-repository release candidates | Declared | `compatibility-manifest` | Checks the versions, recommended install set, tarballs and lockfile integrity. |

## Verification checks

| Check | Profile | Owner | Command |
| --- | --- | --- | --- |
| `node-runtime` | fast | engine | `built-in` |
| `react-range` | fast | engine | `built-in` |
| `vite-range` | fast | engine | `built-in` |
| `docs-matrix` | fast | engine | `built-in` |
| `documented-versions` | fast | engine | `node scripts/check-versions.mjs` |
| `worker-unit` | fast | engine | `npm run test -- tests/local-compile-worker.test.ts` |
| `compatibility-manifest` | release | engine | `node scripts/verify-compatibility-manifest.mjs --require-workspace` |
| `chrome-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=chrome node scripts/verify-required-form-browser.mjs` |
| `edge-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=msedge node scripts/verify-required-form-browser.mjs` |
| `ssr-static` | release | engine | `npm run test:boundary` after `npm run build` |
| `pdf-static` | release | engine | `node scripts/verify-pdf.mjs` |
| `demo-smoke` | release | demo | `cd ../ReactiveMD-Demo && PLAYWRIGHT_CHANNEL=msedge npm run test:browser:smoke` |
| `editor-pack` | release | editor | `cd ../ReactiveMD-Editor && npm run check` |
| `playwright-chromium-core` | optional | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=chromium node scripts/verify-required-form-browser.mjs` |
| `firefox-core` | optional | engine | `PLAYWRIGHT_ENGINE=firefox node scripts/verify-required-form-browser.mjs` |
| `webkit-core` | optional | engine | `PLAYWRIGHT_ENGINE=webkit node scripts/verify-required-form-browser.mjs` |

## Running checks

```sh
npm run support:verify
npm run support:verify -- --profile release
npm run support:verify -- --profile optional
npm run compatibility:verify
npm run support:verify -- --only chrome-core
npm run support:verify -- --only edge-core
npm run support:verify -- --only playwright-chromium-core
npm run support:verify -- --only firefox-core
npm run support:verify -- --only webkit-core
npm run support:verify -- --only pdf-static
npm run support:verify -- --include-external --only demo-smoke
npm run support:verify -- --only node-runtime --out artifacts/support/node24.json
```

The default run uses the `fast` profile: the built-in checks, the documented-version check and the Worker unit suite, with no browser, build output or sibling checkout. `--profile release` runs every fast check and then the release checks: the compatibility manifest, the Chrome and Edge engine fixtures, SSR, PDF, and the external checks owned by the Demo and editor repositories. `--profile optional` runs only the undeclared or extra-download environments: bundled Playwright Chromium, Firefox and WebKit. `--profile all` runs every check.

`--only <id>` limits a run to the named checks. A check named by `--only` is an explicit request: a missing sibling checkout, a missing `pdftotext` or missing build output is a failure, not a silent skip. A profile run may skip an optional environment it cannot exercise, and the skip reason is written to the evidence. `--include-external` runs the checks owned by the Demo and editor repositories in their own checkouts; without it those checks skip in profile runs and fail when named by `--only`. `--out <path>` writes the evidence to that path without touching `artifacts/support/latest.json` or the timestamped archive. `--list` prints every check ID with its profile, owner and command and runs nothing. For the Node 24 run, invoke the same script with the Node 24 `node` binary.

`npm run compatibility:verify` checks the manifest directly and requires the editor and Demo checkouts.

## Evidence

Each run writes a timestamped record under `artifacts/support/` and updates `artifacts/support/latest.json`; the directory is gitignored. Records use the `reactive-md-support-evidence/v2` schema and contain:

- The package name, version, source commit and dirty flag for the engine, editor and Demo; the compatibility manifest path, schema and SHA256; the run time, profile, package name and version.
- `environment`: `node` (exact version), `nodeLine` (major), `nodeLineDeclared` (whether the run is on the declared 22.x or 24.x line), `platform`, `arch` and `playwrightChannel`.
- For each check, `id`, `label`, `owner`, `profile`, `status` (`pass`, `fail` or `skip`), `durationMs`, `command`, `env`, `cwd`, and the skip or failure reason.
- `node-runtime` `details`: `required`, `actual`, `line`, `declaredLine`, platform and architecture.
- Browser checks add `details.browser`: `report` (the fixture report path), `requestedChannel`, `browserName`, `browserVersion` and `status`. The fixture reads the actual version from the driver after launch, so the evidence names a real browser version and channel rather than only the requested channel.

A row stays Verified only while a passing record exists for the current candidate. Release records reference the evidence summary from the release run.

## Maintenance

- Update the matrix when supported engines, peer ranges or environments change, and update both language versions in the same change.
- Update `compatibility-manifest.json` when a package version, protocol revision, Demo candidate or recommended install range changes.
- `npm run check:versions` checks that the compatibility page package version and the matrix release line match `package.json`.
- Run `npm run support:verify -- --profile release` before a release; run `--profile optional` separately to cover undeclared browsers.
- Mark a row Verified only from a passing record for the current candidate; a partial, failed or skipped run leaves the level unchanged. Historical results stay in the "Latest record" column and are not overwritten by a new candidate.
- Run external checks in their owning repository.
- Keep check IDs stable. The `docs-matrix` check verifies that both language versions contain every ID.
