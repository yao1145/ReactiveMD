import { describe, expect, it } from 'vitest';
import {
  EXPORT_ASSETS_PROTOCOL,
  listExportAssets,
  readExportAsset,
  resolveExportAsset,
  type ExportAssetId,
} from '../src/export-assets/index';

describe('export asset manifest', () => {
  it('publishes one frozen, versioned manifest', () => {
    const manifest = listExportAssets();
    expect(manifest.protocol).toBe(EXPORT_ASSETS_PROTOCOL);
    expect(manifest.protocol).toBe('reactive-md-export-assets/v1');
    expect(listExportAssets()).toBe(manifest);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.assets)).toBe(true);
    expect(manifest.assets.every(asset => Object.isFrozen(asset))).toBe(true);
    expect(manifest.assets.map(asset => asset.id)).toEqual([
      'base-css',
      'print-css',
      'notices',
      'package-json',
      'runtime',
    ]);
  });

  it('maps every id to a public specifier that resolves to a file URL', () => {
    for (const asset of listExportAssets().assets) {
      expect(asset.specifier.startsWith('reactive-md/')).toBe(true);
      const url = resolveExportAsset(asset.id);
      expect(url).toBeInstanceOf(URL);
      expect(url.protocol).toBe('file:');
    }
  });

  it('reads the notices file without a built dist', () => {
    expect(readExportAsset('notices')).toContain('Third-party notices');
  });

  it('rejects unknown ids with a TypeError', () => {
    expect(() => resolveExportAsset('missing' as ExportAssetId)).toThrow(TypeError);
    expect(() => readExportAsset('missing' as ExportAssetId)).toThrow(/Unknown reactive-md export asset: missing/);
  });
});
