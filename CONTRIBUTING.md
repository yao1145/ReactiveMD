# Contributing

**English** · [中文](CONTRIBUTING-ch.md)

This repository owns the ReactiveMD language engine, runtime, SDK and rendering adapters. The [editor](https://github.com/yao1145/ReactiveMD-Editor) and [Demo](https://github.com/yao1145/ReactiveMD-Demo) are separate projects. Read the [migration guide](docs/releases/release-0.8.0-en.md#repository-split-and-import-migration) and [syntax specification](docs/reference/local-interaction-syntax-en.md).

Use Node >=22.12 (CI uses Node24). Run npm ci, then npm run check. This checks types, builds the library, runs the retained regressions and verifies the actual package in a fresh consumer. Local changes need the directly affected checks; changes to compiler entry dependencies also need npm run test:compiler-entry.

Keep public engine APIs independent of editor UI. Pure catalog, insertion and analysis services belong in reactive-md/authoring. Add focused regressions for behavior changes, preserve security/resource budgets and update public documentation. Keep package, syntax, state and theme versions separate.

Do not commit generated dist directories, dependencies or credentials. Preserve unrelated edits. Describe behavior and actual validation in PRs. Release the engine through its manual OIDC workflow only when authorized; see [Releasing](#releasing). Demo deployment belongs to the Demo repository.

## Releasing

The engine, editor and Demo release independently. `reactive-md` carries its own version; `reactive-md-editor` publishes from the editor repository and the Demo builds its own site artifact.

1. Confirm the branch, the intended diff, the target version and the registry state. Update package.json, package-lock.json, the changelog and the relevant compatibility notes. Package, syntax, protocol and theme versions move separately.
2. Run npm ci, npm run check, npm run notices. Review the packed exports, declaration paths and notices. The public-package check installs the actual tarball in an independent consumer, so no editor or Demo checkout is needed.
3. Commit and push the authorized release source. Run publish.yml on that ref with the chosen dist_tag and update_latest. The workflow uses Node 24, npm ^11.21 and npm trusted publishing over OIDC, and keeps the workflow filename configured on npm. It checks and builds the package before packing, publishes only when that version does not exist, and otherwise updates the requested tags. Do not publish or retag through a local npm login.
4. Confirm the workflow result, registry version, tags and integrity. Tag the matching source when authorized, and verify the published package in a clean consumer before upgrading downstream dependencies.

The editor needs its own npm trusted publisher and publish.yml in its repository. Candidate tarballs stay locked in consumer vendor directories until registry publication. Pushing code does not authorize npm publication or site deployment.
