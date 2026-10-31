import assert from 'node:assert/strict';
import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// TypeScript's Bundler resolution keeps extensionless source imports in .d.ts.
// Published ESM declarations also need to resolve for NodeNext consumers.
const root = fileURLToPath(new URL('../dist-library/types/', import.meta.url));
await copyFile(new URL('../src/vite/client.d.ts', import.meta.url), join(root, 'vite/client.d.ts'));
async function declarations(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await declarations(join(directory, entry.name)));
    else if (entry.name.endsWith('.d.ts')) files.push(join(directory, entry.name));
  }
  return files;
}
async function isFile(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}
const pattern = /((?:\bfrom\s*|\bimport\s*\(\s*)['"])(\.[^'"]+)(['"])/g;
const files = await declarations(root);
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const replacements = new Map();
  for (const [, , specifier] of source.matchAll(pattern)) {
    const target = resolve(dirname(file), specifier);
    const candidates = specifier.endsWith('.js')
      ? [[target.slice(0, -3) + '.d.ts', specifier]]
      : [[target + '.d.ts', specifier + '.js'], [join(target, 'index.d.ts'), specifier + '/index.js']];
    let resolved;
    for (const [candidate, nextSpecifier] of candidates) {
      const location = relative(root, candidate);
      assert.ok(location !== '..' && !location.startsWith('..' + sep), `Declaration leaves package types: ${specifier}`);
      if (await isFile(candidate)) { resolved = nextSpecifier; break; }
    }
    assert.ok(resolved, `Missing declaration for ${specifier} in ${relative(root, file)}`);
    replacements.set(specifier, resolved);
  }
  const updated = source.replace(pattern, (_match, prefix, specifier, suffix) => `${prefix}${replacements.get(specifier)}${suffix}`);
  if (updated !== source) await writeFile(file, updated);
}
console.log(`Finalized ${files.length} ESM declaration files for NodeNext and bundler consumers.`);
