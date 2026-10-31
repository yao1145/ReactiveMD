import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const demo = join(root, 'demo');
const vendor = join(demo, 'vendor');
const packageRoot = join(root, 'examples/tetris-package');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run update:demo-tetris.');

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, windowsHide: true,
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
  return result.stdout;
}

const previous = JSON.parse(await readFile(join(demo, 'package.json'), 'utf8'))
  .dependencies['reactive-md-tetris-package'];
run(process.execPath, ['scripts/build.mjs'], packageRoot);
const artifacts = join(root, 'artifacts/demo-extensions');
await mkdir(artifacts, { recursive: true });
const packedDirectory = await mkdtemp(join(artifacts, 'tetris-pack-'));
const [packed] = JSON.parse(run(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json',
  '--pack-destination', packedDirectory], packageRoot, true));
for (const required of ['dist/node/entry.mjs', 'dist/types/node-entry.d.ts', 'LICENSE', 'NOTICES.md', 'src/component.css']) {
  if (!packed.files.some(file => file.path === required)) throw new Error(`Tetris package is missing ${required}.`);
}
const archive = join(packedDirectory, packed.filename);
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
const filename = `${packed.name}-${packed.version}-${sha256.slice(0, 12)}.tgz`;
await mkdir(vendor, { recursive: true });
await copyFile(archive, join(vendor, filename));
run(process.execPath, [npmCli, 'install', '--workspace=@reactive-md/demo', '--save-exact',
  '--ignore-scripts', '--no-audit', '--no-fund', '--offline', `./demo/vendor/${filename}`], root);

// Remove only the previous Tetris snapshot owned by this command, after the
// replacement has installed successfully. Other vendored packages stay intact.
if (previous?.startsWith('file:vendor/reactive-md-tetris-package-') && previous.endsWith('.tgz')) {
  const oldArchive = resolve(demo, previous.slice('file:'.length));
  if (dirname(oldArchive) === vendor && oldArchive !== join(vendor, filename)) {
    await unlink(oldArchive).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
console.log(`Installed ${filename}\nSHA256 ${sha256}\nIntegrity ${packed.integrity}`);
