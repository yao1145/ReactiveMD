# Release checklist

This file is the maintainers' manual release process. This checklist covers the `0.5.0` preview release, which targets the `next` channel; `latest` remains `0.4.0`. See [Versions and compatibility](compatibility-en.md) for version rules and [0.5.0 release notes](release-0.5.0-en.md) for the user-facing summary.

## Before release

### Package identity and metadata

The unscoped name `reactive-md` is already established by the published `0.3.0` and `0.3.1` releases, together with the `reactive-md/react` and `reactive-md/styles.css` subpaths. `0.5.0` adds `reactive-md/editor` and `reactive-md/editor/styles.css`. Do not treat a rename as routine release preparation: changing the name is a breaking change for imports, state tooling and documentation.

1. Keep `reactive-md` unless maintainers explicitly decide on a scoped rename. A scope requires the corresponding npm account or organization permissions.
2. If renaming, update `name` in `package.json`, import statements in the documentation, tarball filename references, examples and the relevant subpaths, then record the change as breaking in the changelog.
3. Check release metadata in `package.json`: `repository`, `homepage`, `bugs`, `license`, `engines` and similar fields. They are currently set; before releasing, confirm the URLs and minimum Node version are still correct and that `private` remains removed.
4. Confirm `files` covers what needs to be published. It currently includes `dist-library`, `dist-standalone`, `bin`, `cli`, the READMEs (`README.md`, `README-en.md`, `README-ch.md`), the contributing, changelog and security guides in both languages, `THIRD_PARTY_NOTICES.md`, `docs` and `examples`; add any new documentation or notices to `files` as well.

The package name and version determine the tarball name. The expected filename for `0.5.0` is `reactive-md-0.5.0.tgz`; after renaming or changing the version, use the actual output of `npm pack`.

### Third-party notices

The library bundles `remark-gfm@4.0.1`, `remark-parse@11.0.0`, `unified@11.0.5` and their dependencies. The standalone HTML runtime also bundles React, React DOM and scheduler; the library React entry uses host-provided peers. All these bundles retain the installed dependencies' copyright and license notices in `THIRD_PARTY_NOTICES.md`.

Before releasing, maintainers:

1. Run `npm run notices` to regenerate `THIRD_PARTY_NOTICES.md` from installed dependencies. The generation script covers the dependency trees and actual license texts of `remark-gfm`, `remark-parse`, `unified`, `react` and `react-dom`, including scheduler.
2. Confirm `files` in `package.json` includes `THIRD_PARTY_NOTICES.md` so it ships in the tarball.
3. Inspect the output of `npm pack --dry-run` and confirm there is no `node_modules`, `demo/`, `demo/artifacts/`, test output or local cache.
4. Check that dependency licenses match the packaged content; regenerate notices after adding or upgrading Markdown dependencies.

## Local tarball installation

The complete local gate is:

```sh
npm ci
npm run verify:release
```

`verify:release` runs the Node-side and browser checks, builds the package, installs the real tarball outside the repository and exercises combined document behavior. It manages the preview server and browser lifecycle itself. The gate also covers the editor entry, its stylesheet and two editor instances on one page. CI splits the same gate with `verify:release:node` and `verify:release:browser`. A browser must already be installed locally.

The packed check retains the exact verified archive in `artifacts/release-package/` and records its SHA256 and npm integrity in `package-verification.json` there. Publish that archive after the complete gate passes. Re-run verification if source, package metadata or packaged documentation changes.

To inspect the package manually, use the tarball directly. In the repository root:

```sh
npm pack
```

`npm pack` runs the build and `npm run notices` through `prepack` first, producing `dist-library/` and `THIRD_PARTY_NOTICES.md`. `dist-library/` is the directory targeted by `exports` in `package.json`. Then verify installation in an empty directory:

```sh
mkdir /tmp/reactive-md-consumer
cd /tmp/reactive-md-consumer
npm init -y
npm install /path/to/reactive-md-0.5.0.tgz
```

The core entry can be checked directly in Node:

```sh
node --input-type=module -e "import { compileLocal, LOCAL_SYNTAX_VERSION } from 'reactive-md'; console.log(LOCAL_SYNTAX_VERSION, compileLocal('# ok').ok)"
```

The React entry requires React 19 to be installed separately:

```sh
npm install react@19 react-dom@19
```

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
```

The editor entry uses the same React peer and a separate stylesheet:

```tsx
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import 'reactive-md/editor/styles.css';
```

Static SSR rendering is covered by the packed check. The editor entry is imported in the server-render check and exercised in the browser check. Single-file export static-first hydration is covered by the Playwright Chromium and local Edge browser checks; general SSR hydration outside that path is unverified. Installation verification should also confirm that the tarball contains complete `dist-library/types`, including the editor entry and stylesheet, `dist-standalone`, `bin`, `cli`, `README.md`, `README-en.md`, `README-ch.md`, `CHANGELOG.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `docs` and `examples`, and check that `docs` contains no local links to unpackaged `demo/`, `src/`, `tests/` or `.tasks/` files.

## Release notes

Release notes are for users and must include at least:

- The package version, `LOCAL_SYNTAX_VERSION`, component protocol revision and theme protocol revision; these are different version numbers.
- The install command `npm install reactive-md@next`, or `npm install reactive-md@<version>` to pin the release, with a downloadable tarball as an offline installation option.
- User-visible changes, breaking changes and migration steps; link directly to the [changelog](../CHANGELOG.md) and the [0.5.0 release notes](release-0.5.0-en.md) for this cycle.
- Verified platforms, plus unverified browsers, general SSR hydration and other scope.
- Known limitations and a link to [SECURITY.md](../SECURITY.md).

Do not write results for checks that have not run, and do not present the existence of CI configuration as CI passing.

## Manual release checklist

1. Confirm the working tree is clean, changes have been reviewed, and `npm ci` installs successfully from the lockfile.
2. On Node 22.12 and a supported newer LTS (currently 24), run `npm run verify:release`. This is the same complete gate local maintainers and CI use; do not replace it with a list of hand-picked commands.
3. Confirm the version number, `CHANGELOG.md` and the release notes agree. `0.5.0` adds the editor entry but keeps `LOCAL_SYNTAX_VERSION` and the component and theme protocol revisions. Update a version axis only when its own contract changes.
4. Inspect the verified archive retained by the gate, including its file list, size and license files. A fresh manual `npm pack` produces a new candidate that needs its own installation verification.
5. Compare the archive's SHA256 with `artifacts/release-package/package-verification.json` and record it in the release notes or an internal release record.
6. Merge the release commit and wait for all CI on `main` to pass.
7. Create and push the tag manually, for example `v0.5.0`. Do not store npm tokens in an automated release workflow.
8. After signing in to npm and completing two-factor authentication on the maintainer's machine, publish the verified preview tarball manually: `npm publish artifacts/release-package/reactive-md-0.5.0.tgz --access public --tag next`. Preview releases start on `next`, and this release keeps `latest` on `0.4.0`. Promoting `0.5.0` requires a separate decision: `npm dist-tag add reactive-md@0.5.0 latest`.
9. Verify the package contents, version, README, license and release notes on npm and GitHub Releases; reinstall once from the public registry.
10. Verify that the install command in the README works from the registry, and that the registry integrity digest matches the released tarball.

The version and install command in the README should be ready before packaging and verified after release. Do not commit tokens, `.npmrc` credentials or local paths during the release process.
