# Contributing

This repository owns the ReactiveMD language engine, runtime, SDK and rendering adapters. The [editor](https://github.com/yao1145/ReactiveMD-Editor) and [Demo](https://github.com/yao1145/ReactiveMD-Demo) are separate projects. Read the [migration guide](docs/integration/repository-split-en.md) and [syntax specification](docs/reference/local-interaction-syntax-en.md).

Use Node >=22.12 (CI uses Node24). Run npm ci, then npm run check. This checks types, builds the library, runs the retained regressions and verifies the actual package in a fresh consumer. Local changes need the directly affected checks; changes to compiler entry dependencies also need npm run test:compiler-entry.

Keep public engine APIs independent of editor UI. Pure catalog, insertion and analysis services belong in reactive-md/authoring. Add focused regressions for behavior changes, preserve security/resource budgets and update public documentation. Keep package, syntax, state and theme versions separate.

Do not commit generated dist directories, dependencies or credentials. Preserve unrelated edits. Describe behavior and actual validation in PRs. Release the engine through its manual OIDC workflow only when authorized; see the [release guide](docs/development/releasing-en.md). Demo deployment belongs to the Demo repository.
