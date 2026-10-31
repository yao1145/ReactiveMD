import { expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDemoExtensionBundle } from '../extension-build';

it('keeps a preview-only package usable and reports its missing offline capability', async () => {
  const artifacts = fileURLToPath(new URL('../../artifacts/demo-extensions/', import.meta.url));
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(path.join(artifacts, 'capabilities-'));
  const entry = path.join(directory, 'registration.ts');
  const assembly = fileURLToPath(new URL('../src/extension-host.ts', import.meta.url)).replaceAll('\\', '/');
  const packageDirectory = path.join(directory, 'node_modules', 'preview-only-package');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
    name: 'preview-only-package', type: 'module', exports: './index.js',
  }));
  await writeFile(path.join(packageDirectory, 'index.js'), `
import { defineLocalComponent } from 'reactive-md/sdk';
import { defineReactComponent } from 'reactive-md/react';
const component = defineLocalComponent({
  id: 'test/preview', name: 'preview-only', version: '1.0.0',
  protocol: 'reactive-md-component/v1', form: 'leaf', props: {},
  capabilities: { interactive: true, static: true, ssr: true, offline: false },
});
export const implementation = defineReactComponent(component, { render: () => null });
`);
  await writeFile(entry, `
import { implementation } from 'preview-only-package';
import { createDemoExtensions } from ${JSON.stringify(assembly)};
export const { config, reactConfig, resources, notices } = createDemoExtensions([
  { components: [implementation] },
]);
`);
  const result = await buildDemoExtensionBundle(() => {}, entry);
  expect('error' in result).toBe(true);
  if (!('error' in result)) throw new Error('Expected an offline capability diagnostic.');
  expect(result.error).toContain('test/preview@1.0.0 does not support offline');
  expect(result.diagnostics.map(item => item.code)).toEqual(['local.extension.export-capability']);
});
