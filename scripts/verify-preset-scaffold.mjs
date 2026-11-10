import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Close the scaffold loop from the built checkout: init preset, then check the
 * generated package with the same CLI. The temporary directory stays outside
 * the repository.
 */

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = path.join(root, 'bin', 'reactive-md.mjs');
const directory = mkdtempSync(path.join(tmpdir(), 'reactive-md-preset-'));

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, `reactive-md ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  const target = path.join(directory, 'demo-preset');
  run(['init', 'preset', target, '--name', 'demo-preset', '--id', 'example/demo-preset', '--yes']);
  const output = run(['check', target]);
  assert.match(output, /Checked preset package "reactive-md-demo-preset-preset@0\.1\.0"/);
  assert.match(output, /roundtrip: structuredClone ok, JSON ok, registry rebuilt/);

  const packageInfo = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(packageInfo.exports['.'].import, './src/preset.js');
  assert.equal(packageInfo.exports['./react'].import, './src/react.js');
  assert.equal(packageInfo.scripts.export, 'node scripts/build-export.mjs');
  console.log('PASS init preset and check round-trip');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
