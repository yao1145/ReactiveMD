import { describe, expect, it, vi } from 'vitest';
import { compileLocal, createLocalStateFile } from 'reactive-md';
import { buildShareableHtml } from '../src/export-html';
import { createImageAsset } from '../src/image-assets';
import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5';

// Parse the document so strings inside the bundled runtime are not counted as
// image elements. KaTeX includes an image builder even when no formula uses it.
function renderedImageTags(html: string): string[] {
  const visit = (node: DefaultTreeAdapterTypes.Node): string[] => [
    ...('tagName' in node && node.tagName === 'img' ? [serializeOuter(node)] : []),
    ...('childNodes' in node ? node.childNodes.flatMap(visit) : []),
  ];
  return visit(parse(html));
}

vi.mock('../../dist-library/reactive-md.css?raw', () => ({ default: '.md-document{}' }));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const source = '# With images\n\n![Photo](images/photo.png)\n\n![Again](images/photo.png)';
const compiled = compileLocal(source);
if (!compiled.ok) throw new Error('fixture failed');
const state = createLocalStateFile(compiled.document, {}, { name: 'test', version: '1' });

describe('browser image HTML export', () => {
  it.each(['static', 'interactive'] as const)('preserves aligned HTML containers around images in %s exports', async mode => {
    const aligned = '# Aligned image\n\n<div align="center">你好\n\n![Photo](images/photo.png)\n</div>';
    const result = compileLocal(aligned);
    if (!result.ok) throw new Error('aligned fixture failed');
    expect(result.diagnostics).toEqual([]);
    const alignedState = createLocalStateFile(result.document, {}, { name: 'test', version: '1' });
    const asset = await createImageAsset(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'photo.png', { type: 'image/png' }), 'images/photo.png');
    const output = await buildShareableHtml({ source: aligned, state: alignedState, mode, imageAssets: [asset] });
    expect(/<div align="center">/.test(output.html)).toBe(true);
    expect(output.imageCount).toBe(1);
    const imageTags = renderedImageTags(output.html);
    expect(imageTags).toHaveLength(1);
    expect(imageTags[0]).toContain(`src="${asset.dataUrl}"`);
  });

  it('reports missing resources rather than exporting broken image references', async () => {
    await expect(buildShareableHtml({ source, state, mode: 'static' })).rejects.toThrow('images/photo.png');
  });

  it.each(['static', 'interactive'] as const)('inlines verified images in %s markup and runtime payload', async mode => {
    const asset = await createImageAsset(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'photo.png', { type: 'image/png' }), 'images/photo.png');
    const result = await buildShareableHtml({ source, state, mode, imageAssets: [asset, { ...asset, url: 'unused.png' }] });
    expect(result.imageCount).toBe(2);
    const imageTags = renderedImageTags(result.html);
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
