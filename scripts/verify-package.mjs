import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_COMPILE_DELAY_MS,
  LOCAL_STATE_FORMAT,
  LOCAL_THEME_PROTOCOL,
  SHAREABLE_HTML_FORMAT,
  LocalCompileScheduler,
  applyLocalStateRetention,
  compileLocal,
  createLocalRuntime,
  createLocalStateFile,
  createShareableHtml,
  exportLocalState,
  importLocalState,
  planLocalStateRetention,
  resolveLocalTheme,
  startLocalCompileWorker,
} from 'reactive-md';

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
assert.equal(LOCAL_STATE_FORMAT, 'reactive-md-state/v1');
assert.equal(SHAREABLE_HTML_FORMAT, 'reactive-md-html/v1');
const stateRuntime = createLocalRuntime(themed.document);
const stateFile = createLocalStateFile(themed.document, stateRuntime.snapshot().state, {
  name: 'package-test', version: '1',
});
stateRuntime.dispose();
const shell = createShareableHtml({
  title: themed.document.source,
  source: themed.document.source,
  state: stateFile,
  staticMarkup: '<article class="md-document">static</article>',
  css: '.md-document{}',
  mode: 'static',
});
assert.ok(shell.startsWith('<!doctype html>'));
assert.ok(shell.includes('reactive-md-html/v1'));
assert.ok(!shell.includes('<script'));

// Name-based state and source-edit retention are available from the built core entry.
const stateSource = '<number bind="count" label="Count" initial="2" min="0" max="10">';
const stateDocument = compileLocal(stateSource);
assert.equal(stateDocument.ok, true);
const liveState = createLocalRuntime(stateDocument.document);
assert.deepEqual(liveState.parameterNames(), ['count']);
assert.equal(liveState.getParameter('count'), 2);
assert.deepEqual(liveState.setParameters({ count: 4 }), []);
const exported = exportLocalState(liveState, { name: 'package-test', version: '1' });
assert.equal(exported.parameters.count, 4);
assert.ok(!Object.keys(exported.parameters).some(name => name.startsWith('@')));
liveState.setParameter('count', 1);
assert.deepEqual(importLocalState(liveState, JSON.stringify(exported)), []);
assert.equal(liveState.getParameter('count'), 4);
const revised = compileLocal(`${stateSource}\n\nRevised prose`);
assert.equal(revised.ok, true);
const retention = planLocalStateRetention({
  previous: stateDocument.document,
  state: liveState.snapshot().state,
  next: revised.document,
});
assert.deepEqual(retention.retained, ['count']);
const nextState = createLocalRuntime(revised.document);
assert.deepEqual(applyLocalStateRetention(nextState, retention).diagnostics, []);
assert.equal(nextState.getParameter('count'), 4);
nextState.dispose();
liveState.dispose();
assert.equal(LOCAL_COMPILE_DELAY_MS, 150);
assert.equal(typeof LocalCompileScheduler, 'function');
assert.equal(typeof startLocalCompileWorker, 'function');

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
  const imports = [...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
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
  const specifiers = [
    ...[...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
    ...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]),
  ];
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
assert.deepEqual(pkg.bin, { 'reactive-md': './bin/reactive-md.mjs' }, 'package.json must publish the reactive-md CLI');
for (const required of ['dist-standalone', 'bin', 'cli']) {
  assert.ok(pkg.files.includes(required), `package.json files must include ${required}`);
}
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
const staticHtml = renderToStaticMarkup(createElement(renderer.LocalReactiveDocument, {
  source: '<input bind="name" label="Name" initial="Ada">', mode: 'static',
}));
assert.ok(staticHtml.includes('data-render-mode="static"'));
assert.ok(staticHtml.includes('Ada'));
assert.ok(!staticHtml.includes('<input'));
console.log('PASS public package imports, local language fixtures, core type boundaries and React entry boundaries');
