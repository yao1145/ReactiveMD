import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileLocal, createLocalRuntime } from 'reactive-md';

// This import and compilation run in Node without DOM or React rendering.
for (const name of (await readdir('examples/local')).filter(name => name.endsWith('.reactive.md'))) {
  const result = compileLocal(await readFile(`examples/local/${name}`, 'utf8'));
  if (name === 'diagnostics.reactive.md') {
    assert.equal(result.ok, false, 'local diagnostics fixture must fail');
    continue;
  }
  assert.ok(result.ok, `local/${name}: ${JSON.stringify(result.diagnostics)}`);
  const runtime = createLocalRuntime(result.document);
  assert.equal(runtime.snapshot().revision, 0);
  runtime.dispose();
}

const visited = new Set();
async function inspectCoreModule(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const imports = [...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const specifier of imports) {
    assert.ok(!/^react(?:-dom)?(?:\/|$)/.test(specifier), 'Core graph depends on React');
    if (specifier.startsWith('.')) await inspectCoreModule(new URL(specifier, url));
  }
}
await inspectCoreModule(new URL('../dist-library/reactive-md.js', import.meta.url));

// Only public, built entry points may be consumed by the demo.
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}
for (const file of await files('demo/src')) {
  if (!/\.[tj]sx?$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  const imports = [...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(imports.every(value => !value.startsWith('../') || value.endsWith('?raw')), `${file} reaches outside the demo`);
}
const css = await readFile('dist-library/reactive-md.css', 'utf8');
for (const selector of ['.app-shell', '.workbench', '.editor-input', '.observer', '.author-tools']) {
  assert.ok(!css.includes(selector), `Library includes demo selector ${selector}`);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.ok(!Object.keys(pkg.dependencies).some(name => /react|vite|playwright/.test(name)), 'Core must not require UI or demo packages');
const renderer = await import('reactive-md/react');
assert.equal(typeof renderer.LocalReactiveDocument, 'function');
assert.equal(typeof renderer.LocalDocumentView, 'function');
console.log('PASS public package imports, local language fixtures and React entry boundaries');
