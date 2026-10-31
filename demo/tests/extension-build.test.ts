import { expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveConfig } from 'vite';
import { reactiveMd } from 'reactive-md/vite';

it('keeps a preview-only package usable and reports its missing offline capability', async () => {
  const artifacts = fileURLToPath(new URL('../../artifacts/demo-extensions/', import.meta.url));
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(path.join(artifacts, 'capabilities-'));
  const packageDirectory = path.join(directory, 'node_modules', 'preview-only-package');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
    name: 'preview-only-package', type: 'module', exports: './index.js',
  }));
  await writeFile(path.join(packageDirectory, 'index.js'), `
import { defineReactComponentPackage } from 'reactive-md/react';
export const componentPackage = defineReactComponentPackage({
  id: 'test/preview', name: 'preview-only', version: '1.0.0',
  capabilities: { interactive: true, static: true, ssr: true, offline: false },
  render: () => null,
});
`);
  const entry = path.join(directory, 'extensions.ts');
  await writeFile(entry, `
import { createReactHost } from 'reactive-md/react';
import { componentPackage } from 'preview-only-package';
export const host = createReactHost({ packages: [componentPackage] });
`);
  const plugin = reactiveMd({ extensions: entry });
  await resolveConfig({ root: directory, configFile: false, logLevel: 'silent', plugins: [plugin] }, 'serve');
  const load = plugin.load as (this: { addWatchFile(file: string): void }, id: string) => Promise<string | null>;
  const code = await load.call({ addWatchFile: () => {} }, '\0virtual:reactive-md/bundle');
  if (!code) throw new Error('Expected a bundle module.');
  const result = JSON.parse(code.replace(/^export default /, '').replace(/;\s*$/, ''));
  expect('error' in result).toBe(true);
  expect(result.error).toContain('test/preview@1.0.0 does not support offline');
  expect(result.diagnostics.map((item: { code: string }) => item.code)).toEqual(['local.extension.export-capability']);
});
