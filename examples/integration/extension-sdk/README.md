# Extension SDK consumer

This fixture defines a rating control, a Markdown hint container, and a light/dark paper theme through public package exports. The rating shares its numeric binding with the built-in number control.

`advanced.tsx` adds a coordinate control, string collection, numeric collection and Markdown container. The coordinate, multi-select and card contracts come from `defaultPreset.components`; the project supplies its own React implementations. Its acceptance checks cover atomic rollback, array limits and copies, reset, disabled/hidden states, static output, SSR and offline desktop/mobile restoration. `advanced-standalone.ts` bundles the same installed implementations for that export.

The extension SDK ships in `reactive-md@0.7.0`. The verifier installs the published package and peer dependencies in a separate directory; when testing unreleased changes, it uses a freshly packed tarball instead.

From the repository root:

```powershell
npm.cmd run build:lib
npm.cmd run test:sdk-consumer
```

The verifier copies this project to a separate temporary directory, installs the actual package and peer tarballs, checks TypeScript and Node SSR, builds a host-specific standalone entry, and verifies static and offline interactive HTML in fresh browser contexts. It uses no source aliases or repository dependency junctions. See `artifacts/sdk-consumer/verification.json` for the result and consumer directory.

For manual development, install the verified tarball in a copy of this directory, install its development dependencies, then run `npm run dev`. The theme stylesheet is loaded explicitly by `main.tsx`. `standalone.ts` is the trusted entry used to restore the same installed implementations in offline output.

The runtime does not fetch component code based on document declarations. Host code imports the implementations before mounting. The exporter checks the component contracts, capabilities, theme, and declared resources before producing the HTML.

中文接口说明：[扩展 SDK 预览](../../../docs/integration/extension-sdk-ch.md)。
