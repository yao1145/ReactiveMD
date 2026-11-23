# Support matrix

**English** · [中文](support-matrix-ch.md)

This page is the canonical public support statement for `reactive-md` 0.9.x, `reactive-md-editor` 0.2.x and the current Demo. Support status comes from local checks: each row names a check ID that `npm run support:verify` runs and records. Compatibility rules and version mapping are in [Versions and compatibility](compatibility-en.md).

## Support levels

| Level | Definition |
| --- | --- |
| Verified | The listed check passed for the current release line and a record exists. |
| Declared | The published range or environment is supported, and the check must be run in that environment before release. |
| Unverified | No current support statement. |
| Not supported | Outside the supported scope. |

## Support matrix

| Area | Scope | Level | Check | Notes |
| --- | --- | --- | --- | --- |
| Node.js | 22.x (minimum 22.12.0) | Verified | `node-runtime` | Local acceptance on 2026-11-23 ran on 22.17.0; the check compares the running version with `engines.node`. |
| Node.js | 24.x | Declared | `node-runtime` | Run the same check on Node 24 in the release environment. |
| React | 19.x (peer `^19.0.0`) | Declared | `react-range` | The installed React 19.3.1 is checked against the peer range. |
| Vite | 8.x (optional peer `^8.0.0` for `reactive-md/vite`) | Declared | `vite-range` | The installed Vite 8.3.5 is checked. |
| Playwright Chromium | Engine browser fixture | Unverified | `playwright-chromium-core` | The bundled Playwright Chromium check is available; it is outside the current verified set. |
| Google Chrome | Engine browser fixture | Verified | `chrome-core` | Local run on 2026-11-23 through the installed Chrome channel. |
| Microsoft Edge | Engine browser fixture | Verified | `edge-core` | Local run on 2026-11-23 through the installed Edge channel. |
| Playwright Firefox | Engine browser fixture | Unverified | `firefox-core` | The check is available; it is outside the current verified set. |
| Playwright WebKit | Engine browser fixture | Unverified | `webkit-core` | The check is available; it is outside the current verified set. |
| Safari | Apple devices | Unverified | none | Manual device testing; Playwright WebKit is not Safari. |
| Desktop layout | 1280-1440 px | Verified | `demo-smoke` | Demo smoke covers 1440 px in Microsoft Edge. |
| Narrow layout | 375-390 px | Verified | `demo-smoke` | Demo smoke covers 390 px in Microsoft Edge; the engine fixture covers 375 px. |
| SSR static rendering | `react-dom/server` | Declared | `ssr-static` | Run after `npm run build`; covers server markup only. |
| Single-file HTML export | `reactive-md-html/v1` | Verified | `demo-smoke` | Demo smoke exports the file and opens it offline in Microsoft Edge. |
| Interactive single-file HTML boot | Inline runtime in `reactive-md-html/v1` | Verified | `demo-smoke` | The offline export loads in interactive mode and updates content after a slider change in Microsoft Edge. |
| General SSR hydration | Host-managed hydration | Not supported | none | The supported interactive path is the single-file HTML boot above. |
| Engine Worker | `LocalCompileScheduler` and `LocalCompileWorker` | Verified | `worker-unit` | The fast check runs the engine Worker unit suite. |
| Editor analysis Worker | CodeMirror analysis Worker | Declared | `editor-pack` | The packed consumer checks the emitted Worker asset and its imports; browser UI uses the browser rows above. |
| PDF | `reactive-md/pdf` | Declared | `pdf-static` | The verification environment needs Playwright Chromium and `pdftotext`. |
| Editor package | `reactive-md-editor` 0.2.1 | Declared | `editor-pack` | The packed consumer covers SSR import, the Worker asset and NodeNext declarations; browser UI uses the browser rows above. |
| Compatibility manifest | Cross-package version set | Verified | `compatibility-manifest` | The schema-validated `compatibility-manifest.json` checks engine constants, installed runtime versions, the editor package, Demo tarballs and the recommended install command. |

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
| `playwright-chromium-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=chromium node scripts/verify-required-form-browser.mjs` |
| `chrome-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=chrome node scripts/verify-required-form-browser.mjs` |
| `edge-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium PLAYWRIGHT_CHANNEL=msedge node scripts/verify-required-form-browser.mjs` |
| `firefox-core` | release | engine | `PLAYWRIGHT_ENGINE=firefox node scripts/verify-required-form-browser.mjs` |
| `webkit-core` | release | engine | `PLAYWRIGHT_ENGINE=webkit node scripts/verify-required-form-browser.mjs` |
| `ssr-static` | release | engine | `npm run test:boundary` after `npm run build` |
| `pdf-static` | release | engine | `node scripts/verify-pdf.mjs` |
| `demo-smoke` | release | demo | `cd ../ReactiveMD-Demo && PLAYWRIGHT_CHANNEL=msedge npm run test:browser:smoke` |
| `editor-pack` | release | editor | `cd ../ReactiveMD-Editor && npm run check` |

## Running checks

```sh
npm run support:verify
npm run support:verify -- --profile release
npm run compatibility:verify
npm run support:verify -- --only chrome-core
npm run support:verify -- --only edge-core
npm run support:verify -- --only playwright-chromium-core
npm run support:verify -- --include-external --only demo-smoke
```

The default run uses the `fast` profile: the built-in checks, the documented-version check and the Worker unit suite, with no browser, build output or sibling checkout. `--profile release` adds the compatibility manifest, browser, SSR and PDF checks, plus the checks owned by the Demo and editor repositories. `--only <id>` limits a run to one check. `--include-external` runs the checks owned by the Demo and editor repositories in their own checkouts; they are skipped without it. `--list` prints every check ID with its profile and owner and runs nothing. `npm run compatibility:verify` checks the manifest directly and requires the editor and Demo checkouts.

## Evidence

Each run writes a timestamped record under `artifacts/support/` and updates `artifacts/support/latest.json`; the directory is gitignored. The record identifies its schema (`reactive-md-support-evidence/v2`), the engine, editor and Demo source commits with dirty flags, the compatibility manifest schema and SHA256, the run date, package version, exact Node version, platform, Playwright channel when set, profile and the pass, fail or skip result of every check. A row stays Verified only while a passing record exists for the current release line. Release records reference the evidence summary from the release run.

## Maintenance

- Update the matrix when supported engines, peer ranges or environments change, and update both language versions in the same change.
- Update `compatibility-manifest.json` when a package version, protocol revision, Demo candidate or recommended install range changes.
- `npm run check:versions` checks that the compatibility page package version and the matrix release line match `package.json`.
- Run `npm run support:verify -- --profile release` before a release.
- Mark a row Verified only from a passing record for the current release line; a partial, failed or skipped run leaves the level unchanged.
- Run external checks in their owning repository.
- Keep check IDs stable. The `docs-matrix` check verifies that both language versions contain every ID.