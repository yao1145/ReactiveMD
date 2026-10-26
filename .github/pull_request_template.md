## Summary

What changes, and why?

## Scope

- [ ] Core compiler or runtime
- [ ] React renderer or styles
- [ ] Syntax, components or examples
- [ ] Documentation
- [ ] Demo, tests, packaging or CI

## Verification

List the commands actually run and their results. Do not mark checks that were not run.

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:components` (representative component and language conformance cases)
- [ ] `npm run test:package`
- [ ] `npm run test:packed`
- [ ] `npm run test:docs`
- [ ] `npm run test:demo`
- [ ] `npm run test:browser` (with the demo server running)

## Compatibility

- [ ] No user-visible change.
- [ ] User-visible change is recorded in `CHANGELOG.md`.
- [ ] Breaking syntax or API change is described in `docs/compatibility/compatibility-en.md`, including migration.
- [ ] If the syntax revision changes, `LOCAL_SYNTAX_VERSION` and the package minor version are updated.

## Component changes

For new or changed components, include the declaration from [the development template](https://github.com/yao1145/ReactiveMD/blob/main/docs/development/component-development-en.md) and identify the affected [protocol](https://github.com/yao1145/ReactiveMD/blob/main/docs/development/component-protocol-en.md) clauses. Give the attribute and child-content rules, state and reset behavior, diagnostics, resource budgets, and compatibility classification. Attach component-specific test results and browser evidence where applicable. The representative conformance suite is a starting point for these checks.

## Checklist

- [ ] Tests cover the new behavior or regression.
- [ ] Relative documentation links and headings still resolve.
- [ ] No generated `dist-library/`, `demo/dist/`, `demo/artifacts/`, `node_modules/`, credentials or personal paths are included.
- [ ] Security details, if any, are handled through `SECURITY.md`, not this pull request.
