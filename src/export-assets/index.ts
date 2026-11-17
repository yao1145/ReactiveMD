import { readFileSync } from 'node:fs';

/**
 * Build-time manifest for the files hosts embed in exported HTML.
 * Node-only: this subpath reads the installed package and never enters a
 * browser, React or compiler graph.
 */
export const EXPORT_ASSETS_PROTOCOL = 'reactive-md-export-assets/v1';

export type ExportAssetId = 'base-css' | 'print-css' | 'notices' | 'package-json' | 'runtime';

export interface ExportAssetEntry {
  /** Stable across releases; safe to persist in build configuration. */
  readonly id: ExportAssetId;
  /** Public package specifier that resolves to the emitted file. */
  readonly specifier: string;
  readonly description: string;
}

export interface ExportAssetsManifest {
  /** Protocol string; the trailing segment is the manifest version. */
  readonly protocol: typeof EXPORT_ASSETS_PROTOCOL;
  readonly assets: readonly ExportAssetEntry[];
}

const ASSETS: readonly ExportAssetEntry[] = Object.freeze([
  Object.freeze({
    id: 'base-css',
    specifier: 'reactive-md/styles.css',
    description: 'Document stylesheet used by exported HTML and standalone pages.',
  }),
  Object.freeze({
    id: 'print-css',
    specifier: 'reactive-md/print.css',
    description: 'Print stylesheet appended after the base stylesheet.',
  }),
  Object.freeze({
    id: 'notices',
    specifier: 'reactive-md/notices',
    description: 'Third-party license notices embedded in exported HTML.',
  }),
  Object.freeze({
    id: 'package-json',
    specifier: 'reactive-md/package.json',
    description: 'Installed package metadata; exports record its version as the generator version.',
  }),
  Object.freeze({
    id: 'runtime',
    specifier: 'reactive-md/assets/standalone.js',
    description: 'Standalone browser runtime embedded in interactive exports.',
  }),
]);

const MANIFEST: ExportAssetsManifest = Object.freeze({
  protocol: EXPORT_ASSETS_PROTOCOL,
  assets: ASSETS,
});

/** The frozen manifest. Identical object on every call. */
export function listExportAssets(): ExportAssetsManifest {
  return MANIFEST;
}

function entryFor(id: ExportAssetId): ExportAssetEntry {
  const entry = ASSETS.find(asset => asset.id === id);
  if (!entry) {
    throw new TypeError(
      `Unknown reactive-md export asset: ${String(id)}. Known ids: ${ASSETS.map(asset => asset.id).join(', ')}.`,
    );
  }
  return entry;
}

/** File URL of an asset, resolved through the installed package exports. */
export function resolveExportAsset(id: ExportAssetId): URL {
  return new URL(import.meta.resolve(entryFor(id).specifier));
}

/** UTF-8 contents of an asset. */
export function readExportAsset(id: ExportAssetId): string {
  return readFileSync(resolveExportAsset(id), 'utf8');
}
