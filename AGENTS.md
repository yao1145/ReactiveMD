# ReactiveMD language engine

- Use superpowers-lite. Use original Superpowers only when explicitly requested.
- For prose, read C:/Users/yaozi/.codex/skills/anti-defensive-writing/SKILL.md.
- Preserve unrelated changes. Commit/push/release/deployment follow current user authorization.

## Repository boundary

This repository owns the language compiler, expressions, runtime, sessions, generic Worker, authoring services, SDK, presets, React/SSR, standalone HTML and export.

The editor is maintained in https://github.com/yao1145/ReactiveMD-Editor and the website in https://github.com/yao1145/ReactiveMD-Demo. Do not add workspaces, sibling source imports or editor UI dependencies here. Pure insertion/catalog services belong in src/authoring.

## Necessary checks

Use Node 24 in CI; Node >=22.12 is supported. Run npm ci and npm run check. The check builds/types, runs the retained engine regressions and installs the actual tarball into a fresh consumer to verify public APIs and NodeNext declarations. For a local fix, run the affected tests first; repeat broader checks only for a concrete reason.

Public compiler entries must stay free of React, CSS, Worker and session initialization. Use npm run test:compiler-entry when their dependency graph changes. Package, syntax, data protocol and theme versions are independent.

## Packages and release

Package reactive-md has its own version. The editor has its own version and an explicit engine peer range. Candidate consumers may use committed vendor tarballs plus lockfile integrity; never file:.. or source aliases.

Before release, run npm run check and npm run notices, review metadata/exports and the packed files. Publish only on explicit authorization through .github/workflows/publish.yml using npm trusted publishing (OIDC), Node24 and npm ^11.21. Do not run local npm publish or npm dist-tag. Keep the workflow filename stable for the configured trusted publisher. Check registry integrity and tags after an authorized release.

Demo build/deployment instructions live in the Demo repository's AGENTS.md. An engine push does not authorize npm publication or site deployment.
