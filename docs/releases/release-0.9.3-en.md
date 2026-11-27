# ReactiveMD 0.9.3

**English** · [中文](release-0.9.3-ch.md)

Install `reactive-md@0.9.3` from npm:

```sh
npm install reactive-md@0.9.3
```

Release notes for the 0.9.3 feature release (2026-11-27).

## Highlights

### Embedding and fallback compilation

`LocalCompileOptions.embedding` selects a restricted compiler profile. `expressions: 'literal'` preserves interpolation delimiters in text and compatible string attributes. With `onUnsupported: 'fallback'`, unsupported nodes and node-level attribute, structure, plot, table and navigation errors become escaped source, `node.fallback` records the code and range, and dependencies and runtime metadata are rebuilt from the surviving nodes. Resource budget failures still fail compilation, and successful results report `document.requiresRuntime`.

### Runtime-free static rendering

A document compiled without runtime requirements renders through `LocalStaticDocumentView` from `reactive-md/react/static` or `renderLocalStaticMarkup` from `reactive-md/react/static/server`. Host slots can render synchronously or resolve after mount, and static components declared by the installed presets render through their pack implementations. Legacy `hostComponents` with literal attributes render through `hostData`/`hostRenderer`; `resolveHostData` supplies missing keyed data after hydration while the server and first client render share a loading placeholder. `createLocalRuntimePool` and `LocalPooledDocumentView` reuse runtime leases for documents that still need a runtime.

### Narrow session and scan entries

`reactive-md/compiler/session` exports `createLocalCompileSession` for one incremental session per document and `localCompileCacheKey` for caching a source snapshot by entry, effective phase, validated options, component configuration and host policy version. `reactive-md/scan` exports `analyzeLocalSource` for read-only tokens, bindings and UTF-16 ranges. Neither graph loads React, CSS, DOM or Worker scheduling.

### Component inventory

`document.usedComponents` lists the distinct built-in, SDK and declared legacy host component names in first-use order, and the single-pass compiler also exposes it as `program.usedComponents`. Preload implementations and select CSS before rendering. Conditional branches stay represented; declarations, source fallbacks and external slot names are omitted.

### Multi-document Worker pool

`createLocalCompilePool` from `reactive-md/worker-pool` compiles revisions across documents in a bounded queue. It supports `latest` or `all` delivery, priority aging, backpressure, `release(documentId)`, warmup and idle recycling, and rejects oversized sources before they enter the queue. `hold()` pauses document dispatch, full retries and local fallback while allowing in-flight work, warmup and idle recycling to finish; `resume()` continues with the existing priorities and queue age.

### Performance reports

`createLocalPerformanceReport` summarizes compile, Worker and rendering events under schema `reactive-md-performance/v1`. It reports pool readiness, Worker spawn and warmup, component-load waits, and document and component mount, lifetime and unmount timings.

### On-demand component loading

`reactive-md/react/packed` composes selected React packs. Per-component entries under `reactive-md/presets/default/packs/react/component/*` keep unselected views out of the bundle, and `packStyleManifest` maps the selected components to their CSS resources. `createDeferredReactConfig` shares one async request per definition, aborts when its last subscriber leaves, and accepts a synchronous resolver for SSR and hydration.

## Compatibility

No syntax, SDK, theme, component or state protocol revision changes. `local-draft-3`, `component-protocol-3`, `reactive-md-theme-1`, `reactive-md-state/v1` and the SDK contract `0.7.0` remain current. Existing document source and state files need no migration. The editor pair remains `reactive-md-editor@0.2.1`, whose `^0.9.2` peer accepts this release.