import { describe, expect, it } from 'vitest';
import {
  assertUniqueRegistration,
  createDirectoryRegistration,
  mergeDiscoveredAssets,
  readLocalReactPackage,
} from '../src/vite/registration';

const themePackage = {
  id: 'local/theme/paper',
  name: 'paper',
  version: '0.0.0',
  protocol: 'reactive-md-theme-1',
  colorSchemes: ['light', 'dark'],
  css: [{ id: 'directory-theme/paper.css', css: '[data-rmd-theme="paper"]{color:red}' }],
};

const component = {
  definition: { id: 'example.card', name: 'card', version: '1.0.0' },
  render: () => null,
  digest: 'digest',
};

const packageA = { components: [component] };
const packageB = { components: [{ ...component, definition: { id: 'example.other', name: 'other', version: '1.0.0' } }] };

function discovery() {
  return {
    themes: [{ file: '/root/theme/paper/theme.css', theme: themePackage }],
    plugins: [
      { file: '/root/plugin/a/index.ts', resources: [{ id: 'directory-plugin/a.css', css: '.a { color: blue; }' }] },
      { file: '/root/plugin/b/index.ts', resources: [] },
    ],
    files: ['/root/theme/paper/theme.css', '/root/plugin/a/index.ts'],
    directories: ['/root/theme', '/root/theme/paper', '/root/plugin', '/root/plugin/a'],
    assets: [{ path: 'theme/paper/font.woff2', digest: 'abc', bytes: 12, mime: 'font/woff2' }],
  } as never;
}

describe('directory registration source', () => {
  it('prefers a default LocalReactPackage export', () => {
    expect(readLocalReactPackage({ default: packageA, named: packageB }, 'a.ts')).toBe(packageA);
  });

  it('accepts one distinct named package and deduplicates aliases', () => {
    expect(readLocalReactPackage({ card: packageA, alias: packageA }, 'a.ts')).toBe(packageA);
    expect(readLocalReactPackage({ card: packageA }, 'a.ts')).toBe(packageA);
  });

  it('falls back from a non-package default to one distinct named package', () => {
    expect(readLocalReactPackage({ default: 'not-a-package', card: packageA }, 'a.ts')).toBe(packageA);
  });

  it('rejects several distinct named packages instead of picking one', () => {
    expect(() => readLocalReactPackage({ a: packageA, b: packageB }, 'dir/index.ts'))
      .toThrow(/dir\/index\.ts.*more than one distinct LocalReactPackage/);
  });

  it('rejects entries without a package export', () => {
    expect(() => readLocalReactPackage({ default: { components: 'nope' } }, 'dir/index.ts'))
      .toThrow(/must export a LocalReactPackage/);
  });

  it('names both entries for duplicate component and theme identities', () => {
    expect(() => assertUniqueRegistration([
      { file: '/root/plugin/a/index.ts', id: 'example.card', name: 'card' },
      { file: '/root/plugin/b/index.ts', id: 'example.card', name: 'other' },
    ], [])).toThrow(/component id "example\.card".*\/root\/plugin\/a\/index\.ts.*\/root\/plugin\/b\/index\.ts/);
    expect(() => assertUniqueRegistration([
      { file: '/root/plugin/a/index.ts', id: 'example.a', name: 'card' },
      { file: '/root/plugin/b/index.ts', id: 'example.b', name: 'card' },
    ], [])).toThrow(/component tag <card>.*\/root\/plugin\/a\/index\.ts.*\/root\/plugin\/b\/index\.ts/);
    expect(() => assertUniqueRegistration([], [
      { file: '/root/plugin/a/index.ts', id: 'local/theme/paper', name: 'paper' },
      { file: '/root/theme/paper/theme.css', id: 'local/theme/paper', name: 'other' },
    ])).toThrow(/theme id "local\/theme\/paper".*\/root\/plugin\/a\/index\.ts.*\/root\/theme\/paper\/theme\.css/);
    expect(() => assertUniqueRegistration([], [
      { file: '/root/plugin/a/index.ts', id: 'theme/a', name: 'paper' },
      { file: '/root/theme/paper/theme.css', id: 'theme/b', name: 'paper' },
    ])).toThrow(/theme name "paper".*\/root\/plugin\/a\/index\.ts.*\/root\/theme\/paper\/theme\.css/);
  });

  it('emits one browser-safe module with imports, merged resources and metadata', () => {
    const registration = createDirectoryRegistration(discovery(), 'style-id');
    expect(registration.code).toContain('import * as __rmdPlugin0 from "/root/plugin/a/index.ts";');
    expect(registration.code).toContain('import * as __rmdPlugin1 from "/root/plugin/b/index.ts";');
    expect(registration.code).toContain('import { createReactHost } from "reactive-md/react";');
    expect(registration.code).toContain('[...(pkg.resources ?? []), ...entry.resources]');
    expect(registration.code).toContain('__rmdAssertUnique(components, themeOwners)');
    expect(registration.code).toContain('export let discovery');
    expect(registration.code).toContain('reactive-md:themes');
    expect(registration.code).not.toContain('node:fs');
    expect(registration.code).not.toContain("from 'node:");
    expect(registration.files).toEqual(['/root/theme/paper/theme.css', '/root/plugin/a/index.ts']);
  });

  it('merges discovered assets without replacing collector assets', () => {
    const collector = { path: 'theme/existing.css', digest: 'keep', bytes: 1, mime: 'text/css' };
    const bundle = {
      assets: [collector],
      manifest: { inlinedAssets: [collector] },
    } as never;
    const merged = mergeDiscoveredAssets(bundle, [
      { path: 'theme/paper/font.woff2', digest: 'abc', bytes: 12, mime: 'font/woff2' },
      { ...collector },
    ]);
    expect(merged.assets.map((asset) => asset.path)).toEqual(['theme/existing.css', 'theme/paper/font.woff2']);
    expect(merged.assets[0].digest).toBe('keep');
    expect(merged.manifest.inlinedAssets).toBe(merged.assets);
    expect((bundle as { assets: unknown[] }).assets).toHaveLength(1);
    expect(() => mergeDiscoveredAssets(bundle, [{ ...collector, digest: 'conflict' }])).toThrow(/conflicting contents/);
  });
});
