import type { LocalDocument, LocalNode } from 'reactive-md';
import type { LocalUrlPolicy } from 'reactive-md/react';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_IMAGES = 64;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

export interface ImageAsset {
  url: string;
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
}

export type ImageAssetErrorCode = 'empty' | 'type' | 'size' | 'total' | 'count' | 'invalid';
export class ImageAssetError extends Error {
  constructor(readonly code: ImageAssetErrorCode) {
    super(code);
    this.name = 'ImageAssetError';
  }
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  return [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
}

function imageMime(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  return null;
}

function checkUrl(url: string): void {
  if (!url || url.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(url) || url === '__proto__') {
    throw new ImageAssetError('invalid');
  }
}

/** Content determines the format; filename extensions never grant a MIME type. */
export async function createImageAsset(file: File, url: string): Promise<ImageAsset> {
  checkUrl(url);
  if (file.size === 0) throw new ImageAssetError('empty');
  if (file.size > MAX_IMAGE_BYTES) throw new ImageAssetError('size');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new ImageAssetError('invalid');
  const mime = imageMime(bytes);
  if (!mime || (file.type && file.type !== mime && file.type !== 'application/octet-stream')) {
    throw new ImageAssetError('type');
  }
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return { url, name: file.name.slice(0, 255), mime, size: bytes.length,
    dataUrl: `data:${mime};base64,${btoa(chunks.join(''))}` };
}

/** Recheck persisted entries and exported input, including the decoded-byte budget. */
export function validateImageManifest(value: unknown): ImageAsset[] {
  if (!Array.isArray(value)) throw new ImageAssetError('invalid');
  if (value.length > MAX_IMAGES) throw new ImageAssetError('count');
  let total = 0;
  const urls = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new ImageAssetError('invalid');
    const a = entry as ImageAsset;
    if (typeof a.url !== 'string' || typeof a.name !== 'string' || a.name.length > 255
      || typeof a.dataUrl !== 'string' || !Number.isSafeInteger(a.size) || a.size <= 0) {
      throw new ImageAssetError('invalid');
    }
    checkUrl(a.url);
    if (urls.has(a.url)) throw new ImageAssetError('invalid');
    urls.add(a.url);
    if (a.size > MAX_IMAGE_BYTES) throw new ImageAssetError('size');
    total += a.size;
    if (total > MAX_IMAGE_TOTAL_BYTES) throw new ImageAssetError('total');
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(a.dataUrl);
    if (!match || match[1] !== a.mime || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      throw new ImageAssetError('type');
    }
    let binary: string;
    try { binary = atob(match[2]); } catch { throw new ImageAssetError('invalid'); }
    if (binary.length !== a.size || btoa(binary) !== match[2]
      || imageMime(Uint8Array.from(binary.slice(0, 12), c => c.charCodeAt(0))) !== a.mime) {
      throw new ImageAssetError('invalid');
    }
    return { url: a.url, name: a.name, mime: a.mime, size: a.size, dataUrl: a.dataUrl };
  });
}

export function documentImageUrls(document: LocalDocument): string[] {
  const urls = new Set<string>();
  const walk = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      if (node.type === 'image' && typeof node.url === 'string') urls.add(node.url);
      if (node.children) walk(node.children);
    }
  };
  walk(document.nodes);
  return [...urls];
}

export function resolveDocumentImages(document: LocalDocument, manifest: readonly ImageAsset[]) {
  // Import, storage and export boundaries validate bytes once. Rebuilding the
  // reference summary while typing must not decode every stored image again.
  const byUrl = new Map(manifest.map(a => [a.url, a.dataUrl]));
  const references = documentImageUrls(document);
  const missing = references.filter(url => !byUrl.has(url));
  const images: Record<string, string> = Object.create(null);
  for (const url of references) if (byUrl.has(url)) images[url] = byUrl.get(url)!;
  return { references, missing, images };
}

export function imagePolicy(images: Readonly<Record<string, string>>): {
  urlPolicy: LocalUrlPolicy;
  imageResolver: (url: string) => string | null;
} {
  return {
    urlPolicy: (url, kind) => kind === 'link' || Object.hasOwn(images, url),
    imageResolver: url => Object.hasOwn(images, url) ? images[url] : null,
  };
}
