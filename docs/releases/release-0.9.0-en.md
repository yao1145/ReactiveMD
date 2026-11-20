# ReactiveMD 0.9.0

**English** · [中文](release-0.9.0-ch.md)

Install `reactive-md@0.9.0` from npm.

```sh
npm install reactive-md@0.9.0
```

## Highlights

### Theme cascade and controls

The default theme now uses semantic tokens and cascade layers to define a stable baseline for document structure and component styling. Host and extension styles can override theme layers while sharing the same tokens. The heading scale now covers h1 through h6, and the default control and table styles have been aligned with the document typography. See the [theme protocol](../reference/theme-protocol-en.md) and the [theme integration guide](../integration/local-integration-en.md).

### 18-component minimal profile

`reactive-md/presets/minimal` and `reactive-md/react/minimal` provide inputs, basic layout, conditional content, alerts, badges, navigation, and text components without loading the full default component set. Add charting, networking, or other official packages explicitly through the extension SDK. The profile is covered by the minimal-budget example and scaffold checks.

### Static PDF export

The CLI accepts `--format pdf`, and Node hosts can call `renderLocalPdf` from `reactive-md/pdf`. PDF output renders static HTML with Chromium and supports paper size, landscape orientation, margins, and background printing. Install Playwright and its Chromium browser in the exporting environment.

### Named host network channels

Hosts can expose named submit and subscription channels through the runtime. Documents use channel names. Hosts manage endpoints, credentials, validation, transport, cancellation and idempotency. Adapters include HTTP submit, SSE, WebSocket and WebRTC. Channels limit JSON payload size and can map subscription values to document externals. See the [host network guide](../integration/network-host-en.md) and the [network survey example](../../examples/network-survey/README.md).

### Plot formulas and extension onboarding

`<plot>` accepts polar equations such as `r = f(θ)` and a configurable point count for explicit, parametric and polar curves. Sampling shares document-level computation budgets. The extension author tutorial now walks through component creation, preview, SSR, offline export and package checks. The `reactive-md/export-assets` entry gives build tools a stable manifest for the files used by HTML export.

### Other updates

- The `error` tone renders a danger callout with `role="alert"` and works in literal values and dynamic tone expressions.
- Parser shielding, table-pipe handling, HTML attribute decoding, restored-state validation, dynamic constraints and incremental-session boundaries have been corrected.
- Diagnostics, state samples, chart labels and CLI output truncate without leaving an unpaired UTF-16 surrogate.
- The performance overview has been rerun against the current source layout.

## Compatibility

No syntax, SDK, theme, component, or state protocol revision changes in this package release. `local-draft-3`, `component-protocol-3`, `reactive-md-theme-1`, `reactive-md-state/v1`, and the SDK contract `0.7.0` remain current. Existing document source and state files need no migration for the engine package update.

The engine remains independent from the editor and Demo releases. The 0.8 repository split still applies: use `reactive-md-editor` for the editor package.
