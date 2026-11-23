# ReactiveMD 0.9.2

**English** · [中文](release-0.9.2-ch.md)

Install `reactive-md@0.9.2` from npm:

```sh
npm install reactive-md@0.9.2
```

Release notes for the 0.9.2 patch release (2026-11-23).

## Highlights

### The newest fallback compile wins

An observer that schedules another source while a fallback compile starts, ends, or reports a diagnostic no longer receives the older result, its remaining diagnostics, or its terminal trace afterwards. Each scheduled source carries a currentness token that the scheduler checks after every observer callback.

### Worker failure reasons in formatted diagnostics

`formatLocalDiagnostic` keeps the underlying Worker compile exception in English and Chinese through a bounded `detail` parameter. Diagnostic reports continue to omit free text.

### Recoverability matches the callers

Build preflight and export plan resource and budget diagnostics are `recoverable: false`, matching the callers that stop on them.

### Export cancellation events

`LocalTraceEvent` adds the `export-cancel` type, and diagnostic reports accept the `cancelled` and `printed` statuses.

## Compatibility

No syntax, SDK, theme, component or state protocol revision changes. `local-draft-3`, `component-protocol-3`, `reactive-md-theme-1`, `reactive-md-state/v1` and the SDK contract `0.7.0` remain current. Existing document source and state files need no migration. The published `reactive-md-editor@0.2.0` remains compatible with the `0.9.x` engine series. When upgrading to `reactive-md-editor@0.2.1`, the engine must satisfy `^0.9.2`. Hosts still pinned to engine 0.9.0 or 0.9.1 must upgrade the engine as well.