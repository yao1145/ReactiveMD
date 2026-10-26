import { describe, expect, it, vi } from 'vitest';
import { compileLocal, createLocalStateFile } from 'reactive-md';
import { buildShareableHtml } from '../src/export-html';
import { createImageAsset } from '../src/image-assets';

vi.mock('../../dist-library/reactive-md.css?raw', () => ({ default: '.md-document{}' }));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const source = '# With images\n\n![Photo](images/photo.png)\n\n![Again](images/photo.png)';
const compiled = compileLocal(source);
if (!compiled.ok) throw new Error('fixture failed');
const state = createLocalStateFile(compiled.document, {}, { name: 'test', version: '1' });

describe('browser image HTML export', () => {
  it('reports missing resources rather than exporting broken image references', async () => {
    await expect(buildShareableHtml({ source, state, mode: 'static' })).rejects.toThrow('images/photo.png');
  });

  it.each(['static', 'interactive'] as const)('inlines verified images in %s markup and runtime payload', async mode => {
    const asset = await createImageAsset(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'photo.png', { type: 'image/png' }), 'images/photo.png');
    const result = await buildShareableHtml({ source, state, mode, imageAssets: [asset, { ...asset, url: 'unused.png' }] });
    expect(result.imageCount).toBe(2);
    const imageTags = result.html.match(/<img\b[^>]*>/g) ?? [];
    expect(imageTags).toHaveLength(2);
    for (const tag of imageTags) expect(tag).toContain(`src="${asset.dataUrl}"`);
    expect(result.html).not.toContain('unused.png');
    if (mode === 'interactive') {
      expect(result.html).toContain('"images":{"images/photo.png":"data:image/png;base64,');
    } else {
      expect(result.html).not.toMatch(/<script\b/);
    }
  });

  it('rejects a forged manifest at the export boundary', async () => {
    await expect(buildShareableHtml({ source, state, mode: 'static', imageAssets: [
      { url: 'images/photo.png', name: 'bad.png', mime: 'image/png', size: 4, dataUrl: 'data:image/png;base64,ZXZpbA==' },
    ] })).rejects.toThrow();
  });
});
