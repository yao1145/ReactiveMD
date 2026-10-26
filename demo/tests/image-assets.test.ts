import { describe, expect, it } from 'vitest';
import { compileLocal } from 'reactive-md';
import {
  createImageAsset, validateImageManifest, resolveDocumentImages,
  MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL_BYTES, type ImageAsset,
} from '../src/image-assets';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
const file = (bytes = png, type = 'image/png') => new File([bytes], 'photo.png', { type });

describe('browser document images', () => {
  it('reads raster content and records its exact source URL and metadata', async () => {
    const asset = await createImageAsset(file(), 'images/photo.png');
    expect(asset).toMatchObject({ url: 'images/photo.png', name: 'photo.png', mime: 'image/png', size: png.length });
    expect(asset.dataUrl).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...png))}`);
    expect(validateImageManifest([asset])).toEqual([asset]);
  });

  it('rejects empty, unsupported, spoofed and oversized files before exporting', async () => {
    await expect(createImageAsset(file(new Uint8Array()), 'a')).rejects.toMatchObject({ code: 'empty' });
    await expect(createImageAsset(file(new TextEncoder().encode('<svg onload="alert(1)"/>')), 'a')).rejects.toMatchObject({ code: 'type' });
    await expect(createImageAsset(file(png, 'image/jpeg'), 'a')).rejects.toMatchObject({ code: 'type' });
    await expect(createImageAsset(file(new Uint8Array(MAX_IMAGE_BYTES + 1)), 'a')).rejects.toMatchObject({ code: 'size' });
  });

  it('ignores file extensions and accepts supported signatures', async () => {
    for (const [bytes, mime] of [
      [png, 'image/png'],
      [new Uint8Array([255, 216, 255, 224]), 'image/jpeg'],
      [new TextEncoder().encode('GIF89a123'), 'image/gif'],
      [new TextEncoder().encode('RIFF0000WEBP'), 'image/webp'],
    ] as const) {
      const asset = await createImageAsset(new File([bytes], 'unknown', { type: '' }), 'assets/file');
      expect(asset.mime).toBe(mime);
    }
  });

  it('revalidates saved data and rejects duplicate or unsafe keys', async () => {
    const asset = await createImageAsset(file(), 'photo.png');
    expect(() => validateImageManifest([{ ...asset, size: 1 }])).toThrow();
    expect(() => validateImageManifest([{ ...asset, dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }])).toThrow();
    expect(() => validateImageManifest([{ ...asset, dataUrl: 'data:image/png;base64,bm90IGFuIGltYWdl' }])).toThrow();
    expect(() => validateImageManifest([asset, asset])).toThrow();
    for (const url of ['__proto__', '', 'a\u0000b', 'a'.repeat(4097)]) {
      expect(() => validateImageManifest([{ ...asset, url }])).toThrow();
    }
  });

  it('enforces aggregate bytes and entry count', async () => {
    const large = new Uint8Array(MAX_IMAGE_BYTES);
    large.set(png);
    const asset = await createImageAsset(file(large), 'large.png');
    expect(MAX_IMAGE_TOTAL_BYTES).toBe(3 * MAX_IMAGE_BYTES);
    expect(() => validateImageManifest(Array.from({ length: 4 }, (_, i) => ({ ...asset, url: `${i}.png` })))).toThrow();
    const small = await createImageAsset(file(), 'small.png');
    expect(() => validateImageManifest(Array.from({ length: 65 }, (_, i) => ({ ...small, url: `${i}.png` })))).toThrow();
  });

  it('exports only referenced assets and reports all missing URLs without fetching', async () => {
    const compiled = compileLocal('![a](images/a.png)\n\n![again](images/a.png)\n\n![b](https://example.com/b.png)');
    if (!compiled.ok) throw new Error('fixture failed');
    const a = await createImageAsset(file(), 'images/a.png');
    const unused = { ...a, url: 'unused.png' } satisfies ImageAsset;
    const resolved = resolveDocumentImages(compiled.document, [a, unused]);
    expect(resolved.missing).toEqual(['https://example.com/b.png']);
    expect(Object.keys(resolved.images)).toEqual(['images/a.png']);
    expect(resolved.references).toEqual(['images/a.png', 'https://example.com/b.png']);
  });
});
