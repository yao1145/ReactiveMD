import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';

/**
 * The CLI modules are plain ESM and intentionally have no TypeScript
 * declarations. Loading through a runtime URL keeps the test focused on the
 * helpers and avoids coupling the CLI to the library's declaration build.
 */
async function loadCli(name: string): Promise<any> {
  const url = new URL(`../cli/${name}`, import.meta.url).href;
  return import(/* @vite-ignore */ url);
}

describe('CLI asset URL policy', () => {
  it('rejects remote, absolute, protocol-relative, backslash and scheme URLs', async () => {
    const { classifyAssetUrl } = await loadCli('assets.mjs');

    for (const url of ['https://example.com/a.png', 'http://example.com/a.png']) {
      const result = classifyAssetUrl(url);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('remote');
    }

    const cases: [string, string][] = [
      ['//cdn.example.com/a.png', 'protocol-relative'],
      ['/abs/a.png', 'absolute'],
      ['C:/abs/a.png', 'absolute'],
      ['C:\\abs\\a.png', 'backslash'],
      ['images\\a.png', 'backslash'],
      ['data:image/png;base64,AAAA', 'scheme'],
      ['javascript:alert(1)', 'scheme'],
      ['%2Fetc%2Fpasswd', 'absolute'],
      ['images/%00.png', 'control'],
      ['', 'empty'],
    ];
    for (const [url, reason] of cases) {
      const result = classifyAssetUrl(url);
      expect(result.ok, url).toBe(false);
      expect(result.reason, url).toBe(reason);
    }
  });

  it('keeps the trimmed URL key and decodes only the file path', async () => {
    const { classifyAssetUrl } = await loadCli('assets.mjs');
    const result = classifyAssetUrl('  images/pic%20one.png?cache=1#frag  ');
    expect(result.ok).toBe(true);
    expect(result.url).toBe('images/pic%20one.png?cache=1#frag');
    expect(result.path).toBe('images/pic one.png');

    const traversal = classifyAssetUrl('../outside.png');
    expect(traversal.ok).toBe(true);
    expect(traversal.path).toBe('../outside.png');
  });
});

describe('CLI image magic detection', () => {
  it('recognizes PNG, JPEG, GIF and WebP from bytes', async () => {
    const { detectImageMime } = await loadCli('assets.mjs');
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageMime(Buffer.from('GIF87a....'))).toBe('image/gif');
    expect(detectImageMime(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(detectImageMime(Buffer.from('RIFF0000WEBP'))).toBe('image/webp');
    expect(detectImageMime(Buffer.from('RIFF0000WAVE'))).toBeNull();
    expect(detectImageMime(Buffer.from('not an image'))).toBeNull();
  });

  it('detects SVG so the build can explain the rejection', async () => {
    const { detectImageMime, looksLikeSvg } = await loadCli('assets.mjs');
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectImageMime(svg)).toBeNull();
    expect(looksLikeSvg(svg)).toBe(true);
    expect(looksLikeSvg(Buffer.from('<html></html>'))).toBe(false);
  });
});

describe('CLI glob matching', () => {
  it('supports *, ? and ** without crossing separators for single-star', async () => {
    const { globToRegExp } = await loadCli('glob.mjs');
    const recursive = globToRegExp('**/*.reactive.md');
    expect(recursive.test('a.reactive.md')).toBe(true);
    expect(recursive.test('x/y/a.reactive.md')).toBe(true);
    expect(recursive.test('x/y/a.md')).toBe(false);

    const single = globToRegExp('*.md');
    expect(single.test('a.md')).toBe(true);
    expect(single.test('x/a.md')).toBe(false);

    const question = globToRegExp('docs/?.md');
    expect(question.test('docs/a.md')).toBe(true);
    expect(question.test('docs/ab.md')).toBe(false);

    const middle = globToRegExp('a/**/b.md');
    expect(middle.test('a/b.md')).toBe(true);
    expect(middle.test('a/x/y/b.md')).toBe(true);
    expect(middle.test('a/x/y/c.md')).toBe(false);
  });
});

describe('CLI title extraction', () => {
  it('uses the first heading and strips inline Markdown formatting', async () => {
    const { extractDocumentTitle } = await loadCli('document.mjs');
    const compiled = compileLocal('# Hello *World* and `code`\n\n# Second');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(extractDocumentTitle(compiled.document, 'fallback.reactive.md')).toBe('Hello World and code');
  });

  it('falls back to the file name when no heading exists', async () => {
    const { extractDocumentTitle } = await loadCli('document.mjs');
    const compiled = compileLocal('Just a paragraph.');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(extractDocumentTitle(compiled.document, 'fallback.reactive.md')).toBe('fallback.reactive.md');
  });
});

describe('CLI build arguments', () => {
  it('parses options and defaults deterministically', async () => {
    const { parseBuildArgs } = await loadCli('args.mjs');
    const defaults = parseBuildArgs(['doc.reactive.md', '-o', 'doc.html']);
    expect(defaults).toMatchObject({
      help: false,
      input: 'doc.reactive.md',
      output: 'doc.html',
      mode: 'interactive',
      assets: 'inline',
      locale: 'en',
      colorScheme: 'auto',
      strict: false,
    });

    const explicit = parseBuildArgs([
      'doc.reactive.md',
      '--output=doc.html',
      '--mode',
      'static',
      '--assets',
      'omit',
      '--locale',
      'zh',
      '--color-scheme=dark',
      '--title',
      'My title',
      '--strict',
    ]);
    expect(explicit).toMatchObject({
      mode: 'static',
      assets: 'omit',
      locale: 'zh',
      colorScheme: 'dark',
      title: 'My title',
      strict: true,
    });
  });

  it('rejects invalid modes and URL asset roots with usage errors', async () => {
    const { parseBuildArgs } = await loadCli('args.mjs');
    expect(() => parseBuildArgs(['doc.reactive.md', '-o', 'doc.html', '--mode', 'print']))
      .toThrow(/Invalid value/);
    expect(() => parseBuildArgs(['doc.reactive.md', '-o', 'doc.html', '--asset-root', 'https://example.com/assets']))
      .toThrow(/URLs are not supported/);
    expect(() => parseBuildArgs(['doc.reactive.md'])).toThrow(/Missing required option "--output"/);
  });
});
