import assert from 'node:assert/strict';
import { readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

/** Runs in the already installed, isolated tarball consumer from phase one. */
export async function verifySdkPhaseTwo({ consumer, artifacts, build, run, browser, report }) {
  await build({ root: consumer, configFile: false, logLevel: 'warn', build: {
    ssr: path.join(consumer, 'advanced.tsx'), outDir: 'advanced-ssr', emptyOutDir: true,
    rollupOptions: { external: [/^reactive-md(?:\/|$)/, /^react(?:\/|$)/], output: { entryFileNames: 'advanced.mjs' } },
  } });
  await build({ root: consumer, configFile: false, logLevel: 'warn', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: {
    outDir: 'advanced-dist', emptyOutDir: true, minify: true,
    lib: { entry: path.join(consumer, 'advanced-standalone.ts'), name: 'AdvancedSDK', formats: ['iife'], fileName: () => 'advanced.js' },
  } });
  await writeFile(path.join(consumer, 'advanced-verify.mjs'), `
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { compileLocal, createLocalRuntime, exportLocalState, analyzeLocalSource, renameLocalBinding } from 'reactive-md';
import { defaultPreset } from 'reactive-md/presets/default';
import { createLocalConfig } from 'reactive-md/sdk';
import { createLocalAuthoringLookup } from 'reactive-md/authoring';
import { renderLocalStaticDocument } from 'reactive-md/react/server';
import { createLocalShareableHtml, defineLocalStandaloneBundle } from 'reactive-md/export';
import { advancedConfig as config, advancedReactConfig as reactConfig, advancedSource as source, vector, basket, memo } from './advanced-ssr/advanced.mjs';
assert.equal(defaultPreset.components.length,46);
const compiled=compileLocal(source,{config});
assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
const document=compiled.document, runtime=createLocalRuntime(document);
assert.deepEqual(runtime.getParameter('picked'),['one']);
assert.deepEqual(runtime.getParameter('samples'),[1,2]);
const numbers=[3,4]; assert.deepEqual(runtime.setParameter('samples',numbers),[]);numbers[0]=99;
assert.deepEqual(runtime.getParameter('samples'),[3,4]);
const read=runtime.getParameter('samples');read[0]=88;assert.deepEqual(runtime.getParameter('samples'),[3,4]);
assert.ok(runtime.setParameter('samples',[1,Infinity]).length);
assert.ok(runtime.setParameter('samples',[1,2,3]).length);
assert.ok(runtime.setParameter('samples',['wrong']).length);
assert.deepEqual(runtime.getParameter('samples'),[3,4]);
runtime.setParameter('samples',[1,2]);
const named=analyzeLocalSource(source,{config}).bindings.map(item=>item.name);
assert.ok(named.includes('pointX')&&named.includes('pointY')&&named.includes('picked'));
const renamed=renameLocalBinding(source,'pointX','horizontal',{config});
assert.equal(compileLocal(renamed.source,{config}).ok,true);
const lookup=createLocalAuthoringLookup({config});
assert.ok(lookup.attribute('vector-pad','bind-x'));
assert.ok(lookup.attribute('vector-pad','initial-y'));
const node=document.nodes.flatMap(function visit(n){return [n,...(n.children??[]).flatMap(visit)]}).find(item=>item.name==='vector-pad');
assert.ok(node);
assert.deepEqual(runtime.setMany(node,{x:2,y:3}),[]);
assert.equal(runtime.getParameter('pointX'),2); assert.equal(runtime.getParameter('pointY'),3);
assert.ok(runtime.setMany(node,{x:4,y:99}).length);
assert.equal(runtime.getParameter('pointX'),2); assert.equal(runtime.getParameter('pointY'),3);
assert.ok(runtime.setParameter('picked',['one','two','three']).length);
assert.deepEqual(runtime.getParameter('picked'),['one']);
runtime.reset(node);
assert.equal(runtime.getParameter('pointX'),0);assert.equal(runtime.getParameter('pointY'),0);
// Alias parity uses the same public rules under different names.
for(const [original,alias,snippet] of [
 ['coordinate',vector,'<coordinate label="Position" bind-x="px" bind-y="py" x-min="-2" x-max="8" initial-x="3">'],
 ['multi-select',basket,'<multi-select label="Items" bind="items" max-selected="2" initial="a"><option value="a">A</option><option value="b">B</option></multi-select>'],
 ['card',memo,'<card title="Body">\\n**Markdown**\\n</card>'],
]){
 const builtin=compileLocal(snippet);
 const external=compileLocal(snippet.replaceAll('<'+original,'<'+alias.name).replaceAll('</'+original,'</'+alias.name),{config});
 assert.equal(external.ok,builtin.ok,JSON.stringify(external.diagnostics));
 const a=createLocalRuntime(builtin.document), b=createLocalRuntime(external.document);
 assert.deepEqual(b.getParameters(),a.getParameters());a.dispose();b.dispose();
}
const ssr=renderLocalStaticDocument({document,runtime,reactConfig,locale:'en'});
assert.equal(ssr.ok,true,JSON.stringify(ssr.diagnostics));
assert.ok(ssr.markup.includes('data-memo'));
const css=await readFile('./node_modules/reactive-md/dist-library/reactive-md.css','utf8');
const script=await readFile('./advanced-dist/advanced.js','utf8');
const bundle=defineLocalStandaloneBundle(script,config);
const options={title:'Advanced SDK',source,document,config,state:exportLocalState(runtime),staticMarkup:ssr.markup,css,bundle,locale:'en'};
await writeFile('advanced-interactive.html',createLocalShareableHtml({...options,mode:'interactive'}));
await writeFile('advanced-static.html',createLocalShareableHtml({...options,mode:'static'}));
runtime.dispose();
console.log('PASS public default manifests, named slots, atomic rollback, arrays, authoring, alias parity, SSR/export');
`);
  const result = await run(process.execPath, ['advanced-verify.mjs'], consumer);
  report.phaseTwo = { node: result.trim(), widths: [] };
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, offline: true });
    try {
      const page = await context.newPage();
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      await page.goto(pathToFileURL(path.join(consumer, 'advanced-interactive.html')).href);
      await expect(page.getByRole('button', { name: 'Move vector', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Move vector', exact: true }).click();
      await expect(page.getByLabel('Vector value')).toHaveText('2, 3');
      await expect(page.locator('[data-memo] strong')).toHaveText('2, 3');
      await page.getByRole('button', { name: 'Invalid vector', exact: true }).click();
      await expect(page.getByLabel('Vector result')).toHaveText('rejected');
      await expect(page.getByLabel('Vector value')).toHaveText('2, 3');
      await page.getByRole('checkbox', { name: 'Two', exact: true }).check();
      await expect(page.getByLabel('Basket value')).toHaveText('one,two');
      await page.getByRole('button', { name: 'Set series', exact: true }).click();
      await expect(page.getByLabel('Series value')).toHaveText('3,4');
      await page.getByRole('button', { name: 'Invalid series', exact: true }).click();
      await expect(page.getByLabel('Series result')).toHaveText('rejected');
      await expect(page.getByLabel('Series value')).toHaveText('3,4');
      await page.getByRole('checkbox', { name: 'Three', exact: true }).click();
      await expect(page.getByLabel('Basket result')).toHaveText('rejected');
      await expect(page.getByLabel('Basket value')).toHaveText('one,two');
      await page.getByRole('checkbox', { name: 'Disable vector', exact: true }).check();
      await expect(page.getByRole('button', { name: 'Move vector', exact: true })).toBeDisabled();
      await page.getByRole('checkbox', { name: 'Disable vector', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: 'Show vector', exact: true }).uncheck();
      await expect(page.locator('[data-vector]')).toBeHidden();
      await page.getByRole('checkbox', { name: 'Show vector', exact: true }).check();
      await expect(page.getByLabel('Vector value')).toHaveText('2, 3');
      await page.getByRole('button', { name: /reset|恢复默认/i }).click();
      await expect(page.getByLabel('Vector value')).toHaveText('0, 0');
      await expect(page.getByLabel('Basket value')).toHaveText('one');
      await expect(page.getByLabel('Series value')).toHaveText('1,2');
      assert.deepEqual(errors, [], `advanced consumer browser errors at ${width}`);
      assert.deepEqual(requests, [], 'offline consumer requested network resources');
      await page.screenshot({ path: path.join(artifacts, `advanced-offline-${width}.png`), fullPage: true });
      report.phaseTwo.widths.push(width);
    } finally { await context.close(); }
  }
  const staticContext = await browser.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await staticContext.newPage();
    await page.goto(pathToFileURL(path.join(consumer, 'advanced-static.html')).href);
    await expect(page.locator('[data-memo] strong')).toHaveText('0, 0');
    await expect(page.getByRole('button', { name: 'Move vector', exact: true })).toBeDisabled();
  } finally { await staticContext.close(); }
  await cp(path.join(consumer, 'advanced-interactive.html'), path.join(artifacts, 'advanced-interactive.html'));
  report.checks.push('phase two: isolated multi-slot/collection/container contracts, alias parity, atomic rollback, SSR/static/offline desktop+mobile');
}
