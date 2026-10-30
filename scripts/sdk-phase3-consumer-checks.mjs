import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

/** Install and execute the copyable component package, outside the repository. */
export async function verifySdkPhaseThree({ root, artifacts, tarball, peers, npm, run, browser, report }) {
  const require = createRequire(import.meta.url);
  const consumer = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-component-package-'));
  report.phaseThree = { consumer, status: 'running' };
  await cp(path.join(root, 'examples/component-package'), consumer, { recursive: true });
  const version = name => require(`${name}/package.json`).version;
  await npm(['install', tarball, ...peers, `vite@${version('vite')}`, `typescript@${version('typescript')}`,
    `@playwright/test@${version('@playwright/test')}`, '--include=dev', '--offline', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error'], consumer);
  await run(process.execPath, [path.join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit'], consumer);
  await writeFile(path.join(consumer, 'verify-defaults.mjs'), `
import assert from 'node:assert/strict';
import {defaultPreset} from 'reactive-md/presets/default';
import {runLocalManifestCompliance,createLocalComplianceReport} from 'reactive-md/testing';
import {createLocalComponentCatalog} from 'reactive-md/authoring';
import {config} from './dist/node/entry.mjs';
for(const definition of defaultPreset.components){
 const result=runLocalManifestCompliance(definition);
 assert.deepEqual(result.cases.filter(item=>item.status==='failed'),[],definition.name);
}
assert.ok(createLocalComponentCatalog(config,'en').some(item=>item.name==='rating'));
assert.ok(createLocalComponentCatalog(config,'zh').some(item=>item.name==='note'));
const number=defaultPreset.components.find(item=>item.name==='number');
assert.equal(createLocalComplianceReport({config,component:'rating',suites:[runLocalManifestCompliance(number)],capabilities:[]}).ok,false);
console.log('PASS all 46 default manifests and external components use the public compliance tools');
`);
  const output = await npm(['test'], consumer);
  const compliance = JSON.parse(await readFile(path.join(consumer, 'dist/compliance.json'), 'utf8'));
  assert.equal(compliance.complete, true, JSON.stringify(compliance));
  assert.equal(compliance.rating.complete, true);
  assert.equal(compliance.note.complete, true);
  const defaults = await run(process.execPath, ['verify-defaults.mjs'], consumer);
  // Consume the template's own packed public exports from a second project.
  const packageInfo = JSON.parse(await npm(['pack', '--ignore-scripts', '--json'], consumer))[0];
  const packageConsumer = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-component-import-'));
  await writeFile(path.join(packageConsumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await npm(['install', path.join(consumer, packageInfo.filename), tarball, ...peers,
    '--include=dev', '--offline', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error'], packageConsumer);
  await writeFile(path.join(packageConsumer, 'consume.mjs'), `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {rating,note} from 'reactive-md-component-package-template';
import {paper} from 'reactive-md-component-package-template/theme';
import {config,reactConfig,source} from 'reactive-md-component-package-template/react';
import {compileLocal,createLocalRuntime} from 'reactive-md';
import {renderLocalStaticDocument} from 'reactive-md/react/server';
const require=createRequire(import.meta.url);
assert.ok(require.resolve('reactive-md-component-package-template/styles.css').endsWith('component.css'));
assert.equal(rating.name,'rating'); assert.equal(note.name,'note'); assert.equal(paper.name,'paper');
const compiled=compileLocal(source,{config}); assert.ok(compiled.ok,JSON.stringify(compiled.diagnostics));
const runtime=createLocalRuntime(compiled.document);
const rendered=renderLocalStaticDocument({document:compiled.document,runtime,reactConfig,
 resources:[{id:'example/component.css',css:'.rmd-example-note{display:block}'}]});
runtime.dispose();
assert.ok(rendered.ok,JSON.stringify(rendered.diagnostics)); assert.ok(rendered.markup.includes('data-note'));
console.log('PASS packed component package manifest, React, theme and CSS exports');
`);
  const packageExports = await run(process.execPath, ['consume.mjs'], packageConsumer);
  await writeFile(path.join(packageConsumer, 'consume.ts'), `
import {rating,note} from 'reactive-md-component-package-template';
import {paper} from 'reactive-md-component-package-template/theme';
import {config,reactConfig,RatingControl,Note} from 'reactive-md-component-package-template/react';
import type {LocalComponentDefinition,LocalThemePackage} from 'reactive-md/sdk';
const definitions:LocalComponentDefinition[]=[rating,note];
const theme:LocalThemePackage=paper;
void [definitions,theme,config,reactConfig,RatingControl,Note];
`);
  await writeFile(path.join(packageConsumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true,
    lib: ['ES2022', 'DOM'], types: [], jsx: 'react-jsx',
  }, include: ['consume.ts'] }));
  await run(process.execPath, [path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc'),
    '--project', path.join(packageConsumer, 'tsconfig.json')], packageConsumer);
  const manifest = JSON.parse(await readFile(path.join(consumer, 'dist/build-manifest.json'), 'utf8'));
  assert.equal(manifest.protocol, 'reactive-md-build/v1');
  assert.ok(manifest.inlinedAssets.some(asset => asset.mime === 'image/svg+xml'));
  assert.ok(manifest.notices.entries.some(entry => entry.id === 'reactive-md/dependencies'));
  assert.ok(manifest.notices.entries.some(entry => entry.id === 'reactive-md/license'));
  await cp(path.join(consumer, 'dist/interactive.html'), path.join(artifacts, 'component-package-interactive.html'));
  await cp(path.join(consumer, 'dist/static.html'), path.join(artifacts, 'component-package-static.html'));
  const widths = [];
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ offline: true, viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
      await page.goto(pathToFileURL(path.join(consumer, 'dist/interactive.html')).href);
      await expect(page.locator('[data-rating-up]')).toBeEnabled();
      await page.locator('[data-rating-up]').click();
      await expect(page.locator('[data-rating-value]')).toHaveText('4');
      await expect(page.locator('[data-note] p strong')).toHaveText('4');
      await page.screenshot({ path: path.join(artifacts, `component-package-${width}.png`), fullPage: true });
      assert.ok(await page.locator('style[data-reactive-md-resource]').count());
      await page.evaluate(() => globalThis.ReactiveMDStandaloneHost.unmountReactiveMD());
      await expect(page.locator('style[data-reactive-md-resource]')).toHaveCount(0);
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
      widths.push(width);
    } finally { await context.close(); }
  }
  const html = await readFile(path.join(consumer, 'dist/interactive.html'), 'utf8');
  const payloadPattern = /(<script type="application\/reactive-md\+json"[^>]*>)([\s\S]*?)(<\/script>)/;
  const raw = html.match(payloadPattern)?.[2];
  assert.ok(raw);
  const failures = [];
  for (const [name, change, code] of [
    ['resource', payload => { payload.resources[0].css += '\n/* changed */'; }, 'local.extension.restore-resource-digest'],
    ['theme', payload => { payload.restoration.themes[0].version = '99.0.0'; }, 'local.extension.restore-theme'],
    ['version', payload => { payload.restoration.components[0].range = '^99.0.0'; }, 'local.extension.restore-version'],
    ['missing-component', payload => { payload.restoration.components = []; }, 'local.extension.restore-component-missing'],
  ]) {
    const payload = JSON.parse(raw);
    change(payload);
    const file = path.join(consumer, `dist/rejected-${name}.html`);
    await writeFile(file, html.replace(payloadPattern, (_match, start, _body, end) => start + JSON.stringify(payload).replaceAll('<', '\\u003c') + end));
    const context = await browser.newContext({ offline: true });
    try {
      await context.addInitScript(() => {
        globalThis.recoveryDiagnostics = [];
        document.addEventListener('reactive-md-diagnostics', event => globalThis.recoveryDiagnostics.push(event.detail));
      });
      const page = await context.newPage();
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('[data-rating-static]')).toBeVisible();
      await expect(page.locator('[data-rating]')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => JSON.stringify(globalThis.recoveryDiagnostics))).toContain(code);
      await expect(page.locator('[data-reactive-md-mounted]')).toHaveCount(0);
      failures.push(name);
    } finally { await context.close(); }
  }
  const staticContext = await browser.newContext({ offline: true, javaScriptEnabled: false });
  try {
    const page = await staticContext.newPage();
    await page.goto(pathToFileURL(path.join(consumer, 'dist/static.html')).href);
    await expect(page.locator('[data-rating-static]')).toBeVisible();
    await expect(page.locator('[data-rating-up]')).toHaveCount(0);
  } finally { await staticContext.close(); }
  report.phaseThree = { consumer, packageConsumer, packageExports: packageExports.trim(), widths, recoveryFailures: failures, defaults: defaults.trim(),
    compliance: { rating: compliance.rating.summary, note: compliance.note.summary },
    build: { protocol: manifest.protocol, assets: manifest.inlinedAssets.length, notices: manifest.notices.entries.length },
    templateOutput: output.trim().slice(-1200) };
  report.checks.push('phase three: isolated component package, public build/testing tools, all default manifests, full lifecycle, offline assets/notices and fail-before-mount recovery');
}
