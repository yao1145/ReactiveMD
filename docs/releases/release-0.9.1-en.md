# ReactiveMD 0.9.1

**English** · [中文](release-0.9.1-ch.md)

Install `reactive-md@0.9.1` from npm:

```sh
npm install reactive-md@0.9.1
```

Release notes for the 0.9.1 patch release (2026-11-22).

## Highlights

### Streaming source compilation

Compile sessions, `LocalCompileScheduler`, Workers and `LocalReactiveDocument` accept an explicit `streaming` or `final` source phase. Unfinished regions render as literal text, and fixable issues are reported through `transientDiagnostics`. Deterministic errors and the final strict and recovery semantics remain unchanged. The separate `reactive-md-editor` package applies related external source snapshots as in-place edits, preserving selection, scroll position and undo history, and defers updates during IME composition. See [Streaming source compilation](../integration/local-integration-en.md#streaming-source-compilation).

### Document-scoped jump scrolling

`<jump>` navigation is scoped to the nearest host scroll container around the rendered document. An embedded preview scrolls its own viewport instead of the outer page.

### Stricter source-phase validation

The runtime rejects unsupported `sourcePhase` values instead of falling back to interactive final rendering.

## Compatibility

No syntax, SDK, theme, component or state protocol revision changes. `local-draft-3`, `component-protocol-3`, `reactive-md-theme-1`, `reactive-md-state/v1` and the SDK contract `0.7.0` remain current. Existing document source and state files need no migration. `reactive-md-editor@0.2.0` supports the `0.9.x` engine series.
