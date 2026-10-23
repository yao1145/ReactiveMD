# Release checklist

This file is the maintainers' manual release process. This checkout targets the unreleased `0.4.0` development preview. See [Versions and compatibility](compatibility-en.md) for version rules.

## Before release

### Package name and scope

`package.json` currently uses the unscoped name `reactive-md`. Before releasing, confirm:

1. Check that the name is available with `npm view reactive-md` or the npm website; do not rely only on this repository's configuration.
2. Decide whether to keep the unscoped name or switch to `@scope/reactive-md`. A scope requires the corresponding npm account or organization permissions.
3. If renaming, also update `name` in `package.json`, import statements in the documentation, tarball filename references and examples. The `reactive-md/react` and `reactive-md/styles.css` subpaths must change with the package name too.
4. Check release metadata in `package.json`: `repository`, `homepage`, `bugs`, `license`, `engines` and similar fields. They are currently set; before releasing, confirm the URLs and minimum Node version are still correct and that `private` remains removed.
5. Confirm `files` covers what needs to be published. It currently includes `dist-library`, the READMEs (`README.md`, `README-en.md`, `README-ch.md`), the contributing, changelog and security guides in both languages, `THIRD_PARTY_NOTICES.md`, `docs` and `examples`; add any new documentation or notices to `files` as well.

The package name and version determine the tarball name. The expected filename for `0.4.0` is `reactive-md-0.4.0.tgz`; after renaming or changing the version, use the actual output of `npm pack`.

### Third-party notices

The runtime bundles `remark-gfm@4.0.1`, `remark-parse@11.0.0` and `unified@11.0.5`, all MIT. The Vite library build bundles these dependencies and their transitive dependencies into the `dist-library` artifacts (including split runtime chunks), so the published content must retain their copyright and license notices. React is an external peer dependency and is not bundled.

Before releasing, maintainers:

1. Run `npm run notices` to regenerate `THIRD_PARTY_NOTICES.md` from installed dependencies. The generation script covers the dependency trees and actual license texts of `remark-gfm`, `remark-parse` and `unified`.
2. Confirm `files` in `package.json` includes `THIRD_PARTY_NOTICES.md` so it ships in the tarball.
3. Inspect the output of `npm pack --dry-run` and confirm there is no `node_modules`, `demo/`, `demo/artifacts/`, test output or local cache.
4. Check that dependency licenses match the packaged content; regenerate notices after adding or upgrading Markdown dependencies.

## Local tarball installation

Before releasing, verify a standalone installation with the real tarball. In the repository root:

```sh
npm ci
npm pack
```

`npm pack` runs the build and `npm run notices` through `prepack` first, producing `dist-library/` and `THIRD_PARTY_NOTICES.md`. `dist-library/` is the directory targeted by `exports` in `package.json`. Then verify installation in an empty directory:

```sh
mkdir /tmp/reactive-md-consumer
cd /tmp/reactive-md-consumer
npm init -y
npm install /path/to/reactive-md-0.4.0.tgz
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

Static SSR rendering is covered by the packed check; hydration is outside the current check scope. Installation verification should also confirm that the tarball contains complete `dist-library/types`, `README.md`, `README-en.md`, `README-ch.md`, `CHANGELOG.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `docs` and `examples`, and check that `docs` contains no local links to unpackaged `demo/` files.

## Release notes

Release notes are for users and must include at least:

- The package version and `LOCAL_SYNTAX_VERSION`; the two are not the same version number.
- The install command `npm install reactive-md@<version>`, with a downloadable tarball as an offline installation option.
- User-visible changes, breaking changes and migration steps; link directly to the [changelog](../CHANGELOG.md).
- Verified platforms, plus unverified browsers, SSR hydration and other scope.
- Known limitations and a link to [SECURITY.md](../SECURITY.md).

Do not write results for checks that have not run, and do not present the existence of CI configuration as CI passing.

## Manual release checklist

1. Confirm the working tree is clean, changes have been reviewed, and `npm ci` installs successfully from the lockfile.
2. Run the CI-equivalent checks on Node 22.12 and a supported newer LTS (currently 24): `npm run build`, `npm test`, `npm run test:package`, `npm run test:packed`, `npm run test:docs`, the demo build and tests, and Chromium browser checks.
3. Confirm the version number, `CHANGELOG.md` and release notes agree; update `LOCAL_SYNTAX_VERSION` together if the syntax revision changes.
4. Run `npm pack --dry-run` to inspect the file list, size and license files; then run the actual `npm pack` and verify installation in an empty directory.
5. Check the tarball SHA256 and record it in the release notes or an internal release record.
6. Merge the release commit and wait for all CI on `main` to pass.
7. Create and push the tag manually, for example `v0.4.0`. Do not store npm tokens in an automated release workflow.
8. After signing in to npm and completing two-factor authentication on the maintainer's machine, publish the tarball manually: `npm publish reactive-md-0.4.0.tgz --access public`. With a scoped package name, use the corresponding `@scope/name`.
9. Verify the package contents, version, README, license and release notes on npm and GitHub Releases; reinstall once from the public registry.
10. Verify that the install command in the README works from the registry, and that the registry integrity digest matches the released tarball.

The version and install command in the README should be ready before packaging and verified after release. Do not commit tokens, `.npmrc` credentials or local paths during the release process.
