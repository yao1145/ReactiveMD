import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { CliError, EXIT, fsFailure } from './errors.mjs';

/** 8 MiB of decoded image bytes per asset. */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
/** 24 MiB of decoded bytes across all distinct assets. */
export const MAX_TOTAL_ASSET_BYTES = 24 * 1024 * 1024;
/** At most 64 distinct image payloads. */
export const MAX_ASSETS = 64;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;

/**
 * Keep rejected URLs printable in diagnostics without allowing terminal
 * control sequences or unbounded output.
 *
 * @param {unknown} value
 */
export function displayAssetUrl(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const clipped = text.length > 200 ? `${text.slice(0, 197)}...` : text;
  return clipped.replace(CONTROL_CHARACTERS, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

/** @param {unknown} url @param {string} detail */
function assetFailure(url, detail) {
  return new CliError(
    `Image "${displayAssetUrl(url)}": ${detail} Use --assets omit to export without images, `
    + 'or place the file next to the document (or under --asset-root) and reference it with a relative URL.',
    EXIT.ASSET,
  );
}

/**
 * Validate an image URL before touching the filesystem. Only host-explicit
 * relative paths are accepted; remote URLs are never fetched.
 *
 * @param {unknown} rawUrl
 * @returns {{ok: true, url: string, path: string} | {ok: false, reason: string, message: string}}
 */
export function classifyAssetUrl(rawUrl) {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const fail = (reason, message) => ({ ok: false, reason, message });

  if (!url) {
    return fail('empty', 'The image URL is empty or missing.');
  }
  if (CONTROL_CHARACTERS.test(url)) {
    return fail('control', 'The image URL contains NUL or control characters.');
  }
  if (url.includes('\\')) {
    return fail('backslash', 'Backslash paths are not allowed; use a relative URL with "/" separators.');
  }
  if (url.startsWith('//')) {
    return fail('protocol-relative', 'Protocol-relative image URLs are not allowed.');
  }
  if (WINDOWS_DRIVE_PATH.test(url)) {
    return fail('absolute', 'Absolute image paths are not allowed.');
  }
  const scheme = URL_SCHEME.exec(url);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === 'http' || name === 'https') {
      return fail('remote', 'Remote images are never fetched; download the image and use a relative path.');
    }
    return fail('scheme', `The "${name}:" URL scheme is not supported; only relative file assets are allowed.`);
  }
  if (url.startsWith('/')) {
    return fail('absolute', 'Absolute image paths are not allowed.');
  }

  // Query strings and fragments belong to the URL, not the local file name.
  let end = url.length;
  for (const marker of ['?', '#']) {
    const index = url.indexOf(marker);
    if (index !== -1 && index < end) end = index;
  }
  const rawPath = url.slice(0, end);
  if (!rawPath) {
    return fail('empty', 'The image URL does not contain a file path.');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return fail('encoding', 'The image URL contains malformed percent-encoding.');
  }
  if (!decoded) {
    return fail('empty', 'The image URL does not contain a file path.');
  }
  if (CONTROL_CHARACTERS.test(decoded)) {
    return fail('control', 'The decoded image path contains NUL or control characters.');
  }
  if (decoded.includes('\\')) {
    return fail('backslash', 'The decoded image path contains a backslash.');
  }
  if (decoded.startsWith('/') || WINDOWS_DRIVE_PATH.test(decoded) || URL_SCHEME.test(decoded)) {
    return fail('absolute', 'The decoded image path is absolute or uses a URL scheme.');
  }

  return { ok: true, url, path: decoded };
}

/** @param {Uint8Array} bytes @param {number} start @param {string} text */
function hasAscii(bytes, start, text) {
  if (bytes.length < start + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[start + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Identify a supported raster image by magic bytes. The extension and any
 * caller-supplied MIME are ignored.
 *
 * @param {Uint8Array | null | undefined} bytes
 * @returns {'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null}
 */
export function detectImageMime(bytes) {
  if (!bytes || bytes.length < 3) return null;
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')) return 'image/gif';
  if (
    bytes.length >= 12
    && hasAscii(bytes, 0, 'RIFF')
    && hasAscii(bytes, 8, 'WEBP')
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Used only to explain why an unrecognized file was rejected. SVG is never a
 * supported image format, even when it contains no XML declaration.
 *
 * @param {Uint8Array | null | undefined} bytes
 */
export function looksLikeSvg(bytes) {
  if (!bytes || bytes.length === 0) return false;
  const length = Math.min(bytes.length, 4096);
  const head = Buffer.from(bytes.subarray(0, length))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  return head.startsWith('<svg') || head.includes('<svg');
}

/**
 * Collect image nodes in document order, including nested blocks.
 * @param {any[] | undefined} nodes
 * @returns {any[]}
 */
export function collectImageNodes(nodes) {
  const images = [];
  const walk = (list) => {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (node?.type === 'image') images.push(node);
      if (Array.isArray(node?.children)) walk(node.children);
    }
  };
  walk(nodes);
  return images;
}

/**
 * @param {string} root
 * @param {string} candidate
 */
export function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/**
 * Try the document directory first, then an optional asset root. Resolution is
 * based on the real path so `..` segments and symlinks cannot escape a root.
 *
 * @param {string} relativePath
 * @param {{base: string, root: string}[]} roots
 */
async function locateAsset(relativePath, roots) {
  let sawOutside = false;
  let sawDirectory = false;
  let sawUnreadable = false;

  for (const entry of roots) {
    const candidate = path.resolve(entry.base, relativePath);
    let real;
    try {
      real = await realpath(candidate);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') sawUnreadable = true;
      continue;
    }
    if (!isPathInside(entry.root, real)) {
      sawOutside = true;
      continue;
    }
    let info;
    try {
      info = await stat(real);
    } catch {
      sawUnreadable = true;
      continue;
    }
    if (!info.isFile()) {
      sawDirectory = true;
      continue;
    }
    return { ok: true, realPath: real, size: info.size };
  }

  if (sawDirectory) {
    return { ok: false, message: 'The resolved path is a directory, not a file.' };
  }
  if (sawOutside) {
    return {
      ok: false,
      message: 'The resolved file is outside the allowed roots; path traversal and symlink escapes are not allowed.',
    };
  }
  if (sawUnreadable) {
    return { ok: false, message: 'The file could not be resolved or inspected.' };
  }
  return { ok: false, message: 'The file was not found relative to the document or --asset-root.' };
}

/**
 * Resolve and verify every image referenced by the compiled document, then
 * inline the accepted files as data URLs. Nothing is fetched from the network
 * and no URL is ever read from `--asset-root` as a remote base.
 *
 * @param {{document: {nodes?: any[]}, inputPath: string, assetRoot?: string}} options
 */
export async function collectInlineAssets({ document, inputPath, assetRoot }) {
  const documentDirectory = path.dirname(path.resolve(inputPath));
  let documentRoot;
  try {
    documentRoot = await realpath(documentDirectory);
  } catch (error) {
    throw fsFailure('Cannot resolve document directory', documentDirectory, error, EXIT.IO);
  }

  /** @type {{base: string, root: string}[]} */
  const roots = [{ base: documentDirectory, root: documentRoot }];

  if (assetRoot !== undefined) {
    const absoluteAssetRoot = path.resolve(assetRoot);
    let info;
    try {
      info = await stat(absoluteAssetRoot);
    } catch (error) {
      throw fsFailure('Asset root does not exist', absoluteAssetRoot, error, EXIT.IO);
    }
    if (!info.isDirectory()) {
      throw new CliError(`Asset root is not a directory: "${absoluteAssetRoot}".`, EXIT.IO);
    }
    let assetRootReal;
    try {
      assetRootReal = await realpath(absoluteAssetRoot);
    } catch (error) {
      throw fsFailure('Cannot resolve asset root', absoluteAssetRoot, error, EXIT.IO);
    }
    roots.push({ base: absoluteAssetRoot, root: assetRootReal });
  }

  const imageNodes = collectImageNodes(document?.nodes);
  /** @type {Map<string, string>} */
  const byUrl = new Map();
  /** @type {Map<string, string>} */
  const contents = new Map();
  let totalBytes = 0;

  for (const node of imageNodes) {
    const classified = classifyAssetUrl(node.url);
    if (!classified.ok) {
      throw assetFailure(node.url, classified.message);
    }
    const key = classified.url;
    if (byUrl.has(key)) continue;

    const located = await locateAsset(classified.path, roots);
    if (!located.ok) {
      throw assetFailure(key, located.message);
    }
    if (located.size > MAX_ASSET_BYTES) {
      throw assetFailure(
        key,
        `The file is ${located.size} bytes, larger than the 8 MiB (${MAX_ASSET_BYTES} byte) per-image limit.`,
      );
    }

    let bytes;
    try {
      bytes = await readFile(located.realPath);
    } catch {
      throw assetFailure(key, 'The file exists but could not be read.');
    }
    if (bytes.length > MAX_ASSET_BYTES) {
      throw assetFailure(
        key,
        `The file grew beyond the 8 MiB (${MAX_ASSET_BYTES} byte) per-image limit while it was read.`,
      );
    }

    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = contents.get(hash);
    if (existing) {
      byUrl.set(key, existing);
      continue;
    }

    const mime = detectImageMime(bytes);
    if (!mime) {
      if (looksLikeSvg(bytes)) {
        throw assetFailure(key, 'SVG images are not supported; use PNG, JPEG, GIF or WebP.');
      }
      throw assetFailure(
        key,
        'The file is not a supported raster image; use PNG, JPEG, GIF or WebP (identified from file contents, not the extension).',
      );
    }

    if (contents.size >= MAX_ASSETS) {
      throw assetFailure(key, `The document references more than ${MAX_ASSETS} distinct image assets.`);
    }
    if (totalBytes + bytes.length > MAX_TOTAL_ASSET_BYTES) {
      throw assetFailure(
        key,
        `Inlined images would exceed the 24 MiB (${MAX_TOTAL_ASSET_BYTES} byte) total limit `
        + `(${totalBytes} bytes already accepted, this file is ${bytes.length} bytes).`,
      );
    }

    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    contents.set(hash, dataUrl);
    totalBytes += bytes.length;
    byUrl.set(key, dataUrl);
  }

  return {
    byUrl,
    imageCount: byUrl.size,
    assetCount: contents.size,
    totalBytes,
  };
}

/**
 * Host URL policy for the React renderer. Links keep the renderer's existing
 * protocol checks. Images are true only for URLs that were verified and
 * inlined; imageResolver maps exactly those URLs to their data URI.
 *
 * @param {Map<string, string>} byUrl
 */
export function createAssetPolicy(byUrl) {
  const images = byUrl instanceof Map ? byUrl : new Map();
  return {
    /** @param {string} url @param {'image' | 'link'} kind */
    urlPolicy(url, kind) {
      if (kind === 'link') return true;
      return kind === 'image' && typeof url === 'string' && images.has(url);
    },
    /** @param {string} url */
    imageResolver(url) {
      return typeof url === 'string' ? images.get(url) ?? null : null;
    },
  };
}
