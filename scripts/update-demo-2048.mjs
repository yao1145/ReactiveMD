import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build, pack and install the 2048 component package into the Demo.
 *
 * Mirrors `update-demo-tetris.mjs`: the Demo consumes the packed tarball from
 * `demo/vendor/`, so preview, the editor catalog and offline export all share
 * the same registration and resource identities.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const demo = join(root, 'demo');
const vendor = join(demo, 'vendor');
const packageRoot = join(root, 'examples/game-2048-package');
const packageName = 'reactive-md-game-2048-package';
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run update:demo-2048.');

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, windowsHide: true,
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
  return result.stdout;
}

const previous = JSON.parse(await readFile(join(demo, 'package.json'), 'utf8'))
  .dependencies?.[packageName];
run(process.execPath, ['scripts/build.mjs'], packageRoot);
const artifacts = join(root, 'artifacts/demo-extensions');
await mkdir(artifacts, { recursive: true });
const packedDirectory = await mkdtemp(join(artifacts, 'game-2048-pack-'));
const [packed] = JSON.parse(run(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json',
  '--pack-destination', packedDirectory], packageRoot, true));
for (const required of ['dist/node/entry.mjs', 'dist/types/node-entry.d.ts', 'dist/types/manifest.d.ts',
  'LICENSE', 'NOTICES.md', 'src/component.css']) {
  if (!packed.files.some(file => file.path === required)) {
    throw new Error(`The 2048 package is missing ${required}.`);
  }
}
const archive = join(packedDirectory, packed.filename);
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
const filename = `${packed.name}-${packed.version}-${sha256.slice(0, 12)}.tgz`;
await mkdir(vendor, { recursive: true });
await copyFile(archive, join(vendor, filename));
run(process.execPath, [npmCli, 'install', '--workspace=@reactive-md/demo', '--save-exact',
  '--ignore-scripts', '--no-audit', '--no-fund', '--offline', `./demo/vendor/${filename}`], root);

// Remove only the previous 2048 snapshot owned by this command, after the
// replacement has installed successfully. Other vendored packages stay intact.
if (previous?.startsWith(`file:vendor/${packageName}-`) && previous.endsWith('.tgz')) {
  const oldArchive = resolve(demo, previous.slice('file:'.length));
  if (dirname(oldArchive) === vendor && oldArchive !== join(vendor, filename)) {
    await unlink(oldArchive).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
console.log(`Installed ${filename}\nSHA256 ${sha256}\nIntegrity ${packed.integrity}`);
