import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { moduleSpecifiers } from './module-specifiers.mjs';
import { compileLocal, createLocalRuntime, LOCAL_THEME_PROTOCOL, resolveLocalTheme, countLocalCodePoints, formatLocalDiagnostic, LOCAL_DIAGNOSTIC_CODES } from 'reactive-md';

// Diagnostic prose must not be mistaken for an external module dependency.
assert.deepEqual(moduleSpecifiers(`
import './static.js';
const message = 'from "not-a-package"';
export type Example = import('./types.js').Example;
export { value } from './export.js';
import('./dynamic.js');
`, 'fixture.ts'), ['./static.js', './types.js', './export.js', './dynamic.js']);

// Exercise the installed command entry through Node on every supported platform.
const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/reactive-md.mjs', import.meta.url)), 'lint', '--json', '-'], {
  input: '<number bind="n" label="Count">\n\n{{ n }}', encoding: 'utf8', windowsHide: true,
});
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(JSON.parse(cli.stdout), [{ file: '<stdin>', ok: true, diagnostics: [] }]);
assert.equal(countLocalCodePoints('😀'), 1);
const diagnostic = compileLocal('{{ missing }}').diagnostics[0];
assert.ok(LOCAL_DIAGNOSTIC_CODES.includes(diagnostic.code));
assert.match(formatLocalDiagnostic(diagnostic, 'zh'), /[\u3400-\u9fff]/u);
assert.equal(formatLocalDiagnostic(diagnostic), diagnostic.message);

// Exercise the built public options API, including preservation of defaults.
assert.equal(compileLocal('hello', { limits: { maxSyntaxNodes: 1 } }).ok, false);
assert.equal(compileLocal('hello', { limits: { maxSyntaxNodes: 2 } }).ok, true);
assert.equal(compileLocal('hello').ok, true);
assert.equal(compileLocal('hello', { limits: { maxSyntaxNodes: Infinity } }).diagnostics[0]?.code, 'local.options.invalid');

// Public built exports include document metadata and host-side registration.
const themed = compileLocal('<theme name="package-test">\n\n# Theme');
assert.equal(themed.ok, true);
assert.equal(themed.document.theme, 'package-test');
assert.equal(compileLocal('# Default').document.theme, 'default');
const themeDefinition = { name: 'package-test', protocol: LOCAL_THEME_PROTOCOL, colorSchemes: ['light', 'dark'] };
assert.deepEqual(resolveLocalTheme('package-test', [themeDefinition]), { name: 'package-test', diagnostics: [] });
assert.equal(resolveLocalTheme('package-test', []).name, 'default');

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

for (const name of (await readdir('examples/local/zh')).filter(name => name.endsWith('.reactive.md'))) {
  const result = compileLocal(await readFile(`examples/local/zh/${name}`, 'utf8'));
  if (name === 'diagnostics.reactive.md') {
    assert.equal(result.ok, false, 'Chinese diagnostics fixture must fail');
    continue;
  }
  assert.ok(result.ok, `local/zh/${name}: ${JSON.stringify(result.diagnostics)}`);
  const runtime = createLocalRuntime(result.document);
  assert.equal(runtime.snapshot().revision, 0);
  runtime.dispose();
}

const visited = new Set();
async function inspectCoreModule(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const imports = moduleSpecifiers(source);
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('.'), `Core bundle must include its dependency ${specifier}`);
    await inspectCoreModule(new URL(specifier, url));
  }
}
await inspectCoreModule(new URL('../dist-library/reactive-md.js', import.meta.url));

// The core declaration graph is consumed without React or repository @types.
const declared = new Set();
async function inspectCoreDeclaration(url) {
  if (declared.has(url.href)) return;
  declared.add(url.href);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const specifiers = moduleSpecifiers(source, 'module.d.ts');
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith('.'), `Core types must not depend on ${specifier} (in ${fileURLToPath(url)})`);
    const candidates = [
      new URL(`${specifier}.d.ts`, url),
      new URL(`${specifier.replace(/\.js$/, '.d.ts')}`, url),
      new URL(`${specifier}/index.d.ts`, url),
    ];
    const target = candidates.find(candidate => {
      try { return statSync(fileURLToPath(candidate)).isFile(); } catch { return false; }
    });
    assert.ok(target, `Core declaration ${specifier} from ${fileURLToPath(url)} is missing`);
    await inspectCoreDeclaration(target);
  }
}
await inspectCoreDeclaration(new URL('../dist-library/types/index.d.ts', import.meta.url));

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
assert.equal(pkg.private, undefined, 'package.json must not be private');
assert.equal(pkg.type, 'module', 'package.json must declare ESM via type: module');
assert.equal(pkg.license, 'MIT', 'package.json must declare the MIT license');
assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'Core must not require registry dependencies; bundled packages belong in devDependencies');
assert.ok(!Object.keys(pkg.dependencies ?? {}).some(name => /react|vite|playwright/.test(name)), 'Core must not require UI or demo packages');
const renderer = await import('reactive-md/react');
assert.equal(typeof renderer.LocalReactiveDocument, 'function');
assert.equal(typeof renderer.LocalDocumentView, 'function');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const themeHtml = renderToStaticMarkup(createElement(renderer.LocalReactiveDocument, {
  source: themed.document.source, themes: [themeDefinition], colorScheme: 'dark',
}));
assert.ok(themeHtml.includes('data-rmd-theme="package-test"'));
assert.ok(themeHtml.includes('data-color-scheme="dark"'));
console.log('PASS public package imports, local language fixtures, core type boundaries and React entry boundaries');
