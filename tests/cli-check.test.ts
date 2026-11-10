import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/reactive-md.mjs', import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', windowsHide: true,
});

let directory: string;
beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'rmd-check-')); });
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function createPreset(name: string): string {
  const target = join(directory, name);
  const result = run([
    'init', 'preset', target,
    '--name', name,
    '--id', `test/${name}`,
    '--yes',
  ]);
  expect(result.status, result.stderr).toBe(0);
  return target;
}

describe('reactive-md check', () => {
  it('checks exports, configuration round-trip, registry and pairing', () => {
    const target = createPreset('working-preset');
    const result = run(['check', target]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Checked preset package "reactive-md-working-preset-preset@0.1.0"');
    expect(result.stdout).toContain('exports: ., ./react');
    expect(result.stdout).toContain('roundtrip: structuredClone ok, JSON ok, registry rebuilt');
    expect(result.stdout).toContain('implementations: 0/0');
    expect(result.stdout).toContain('resources: 0 required, 0 missing');
  });

  it('accepts a package.json path', () => {
    const target = createPreset('manifest-path-preset');
    const result = run(['check', join(target, 'package.json')]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Checked preset package');
  });

  it('fails when a declared export entry is missing', () => {
    const target = createPreset('missing-entry-preset');
    const metadata = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    metadata.exports['./react'].import = './src/missing-react.js';
    writeFileSync(join(target, 'package.json'), JSON.stringify(metadata, null, 2));
    const result = run(['check', target]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('points to a missing file');
  });

  it('fails when the entry cannot be loaded as a preset', () => {
    const target = createPreset('invalid-preset');
    writeFileSync(join(target, 'src/preset.js'), 'export const preset = { protocol: "wat" };\nexport default preset;\n');
    const result = run(['check', target]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('does not export a preset or component package');
  });

  it('checks a component package and its declared resources', () => {
    const target = join(directory, 'component-package');
    mkdirSync(join(target, 'src'), { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({
      name: 'test-component-package',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': { import: './src/manifest.js' },
        './react': { import: './src/react.js' },
      },
    }, null, 2));
    writeFileSync(join(target, 'src/manifest.js'), `import { defineLocalComponent } from 'reactive-md/sdk';
export const manifest = defineLocalComponent({
  id: 'test/note', name: 'note', version: '1.0.0', protocol: 'reactive-md-component/v1',
  form: 'leaf', props: {}, styles: ['test/note.css'],
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
});
export default manifest;
`);
    writeFileSync(join(target, 'src/react.js'), `import { defineReactComponentPackage } from 'reactive-md/react';
import { manifest } from './manifest.js';
export const componentPackage = defineReactComponentPackage({
  ...manifest, css: '.note { color: red; }', render: () => null,
});
export default componentPackage;
`);
    const result = run(['check', target]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Checked component package "test-component-package@1.0.0"');
    expect(result.stdout).toContain('implementations: 1');
    expect(result.stdout).toContain('resources: 1 required, 0 missing');
  });

  it('fails when the React pairing is missing', () => {
    const target = createPreset('broken-pairing');
    writeFileSync(join(target, 'src/react.js'), "import preset from './preset.js';\nexport default { protocol: 'reactive-md-react-preset/v1', preset, components: [], resources: [] };\n");
    writeFileSync(join(target, 'src/preset.js'), "import { defineLocalPreset } from 'reactive-md/sdk';\nconst component = { id: 'test/note', name: 'note', version: '1.0.0', protocol: 'reactive-md-component/v1', form: 'leaf', props: {}, capabilities: { interactive: true, static: true, ssr: true, offline: true } };\nexport const preset = defineLocalPreset({ protocol: 'reactive-md-preset/v1', id: 'test/broken-pairing', version: '0.1.0', components: [component] });\nexport default preset;\n");
    const result = run(['check', target]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('local.config.implementation-missing');
  });

  it('reports usage errors and bilingual help', () => {
    const missing = run(['check']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('Missing package path');

    const unknown = run(['check', 'x', '--bogus']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('Unknown option');

    const english = run(['check', '--help']);
    expect(english.status).toBe(0);
    expect(english.stdout).toContain('reactive-md check <package>');
    expect(english.stdout).toContain('structuredClone');

    const chinese = run(['check', '--help', '--locale', 'zh']);
    expect(chinese.status).toBe(0);
    expect(chinese.stdout).toContain('reactive-md check <包>');
    expect(chinese.stdout).toContain('退出码');
  });
});

describe('version sync check', () => {
  it('passes against the current repository metadata', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/check-versions.mjs')], {
      encoding: 'utf8', windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Versions in sync');
  });
});
