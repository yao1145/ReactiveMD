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
- [ ] `npm run test:package`
- [ ] `npm run test:packed`
- [ ] `npm run test:docs`
- [ ] `npm run test:demo`
- [ ] `npm run test:browser` (with the demo server running)

## Compatibility

- [ ] No user-visible change.
- [ ] User-visible change is recorded in `CHANGELOG.md`.
- [ ] Breaking syntax or API change is described in `docs/compatibility.md`, including migration.
- [ ] If the syntax revision changes, `LOCAL_SYNTAX_VERSION` and the package minor version are updated.

## Checklist

- [ ] Tests cover the new behavior or regression.
- [ ] Relative documentation links and headings still resolve.
- [ ] No generated `dist-library/`, `demo/dist/`, `demo/artifacts/`, `node_modules/`, credentials or personal paths are included.
- [ ] Security details, if any, are handled through `SECURITY.md`, not this pull request.
