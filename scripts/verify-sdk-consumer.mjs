import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const artifacts = path.join(root, 'artifacts/sdk-consumer');
await mkdir(artifacts, { recursive: true });
const report = { status: 'running', startedAt: new Date().toISOString(), checks: [] };
const consumer = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-sdk-'));
report.consumer = consumer;
const npmCandidates = [process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/npm/bin/npm-cli.js'),
].filter(Boolean);
const npmCli = npmCandidates.find(item => /\.(?:js|mjs|cjs)$/.test(item) && existsSync(item));
assert.ok(npmCli, 'Run through npm run test:sdk-consumer or provide an installed npm CLI.');

async function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: {
      ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    } });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} failed (${code})\n${stderr}\n${stdout}`)));
  });
}
const npm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);
async function pack(directory) {
  const output = await npm(['pack', directory, '--ignore-scripts', '--json', '--pack-destination', artifacts, '--loglevel=error']);
  const data = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1))[0];
  return path.join(artifacts, data.filename);
}

try {
  await cp(path.join(root, 'examples/integration/extension-sdk'), consumer, { recursive: true });
  // Install actual tarballs, including peers/types, without a repository alias or junction.
  const tarball = await pack(root);
  const typescriptRoot = path.dirname(require.resolve('typescript/package.json'));
  const coreConsumer = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-sdk-core-'));
  report.coreConsumer = coreConsumer;
  await writeFile(path.join(coreConsumer,'package.json'),JSON.stringify({name:'sdk-core-consumer',private:true,type:'module'}));
  await npm(['install',tarball,'--offline','--ignore-scripts','--no-package-lock','--no-audit','--no-fund','--loglevel=error'],coreConsumer);
  assert.equal(existsSync(path.join(coreConsumer,'node_modules/react')),false);
  await writeFile(path.join(coreConsumer,'core.mjs'), `import assert from 'node:assert/strict';import {createLocalConfig} from 'reactive-md/sdk';assert.ok(createLocalConfig().key);assert.throws(()=>import.meta.resolve('react'));console.log('PASS DOM-free SDK without React');`);
  await run(process.execPath,['core.mjs'],coreConsumer);
  await writeFile(path.join(coreConsumer,'core.ts'), `import {createLocalConfig,type LocalConfig} from 'reactive-md/sdk';const config:LocalConfig=createLocalConfig();void config.key;`);
  await writeFile(path.join(coreConsumer,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,lib:['ES2022'],types:[]},include:['core.ts']}));
  await run(process.execPath,[path.join(typescriptRoot,'bin/tsc'),'--project',path.join(coreConsumer,'tsconfig.json')],coreConsumer);
  report.checks.push('SDK runtime and NodeNext types without React or DOM libraries');
  const peers = [];
  for (const name of ['react', 'react-dom', 'scheduler', '@types/react', '@types/react-dom', 'csstype']) {
    peers.push(await pack(path.dirname(require.resolve(`${name}/package.json`))));
  }
  // The fixture dev tool versions are examples; this check uses the coordinating
  // toolchain and only installs the library and its real runtime/type peers.
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'sdk-isolated-consumer', version: '0.0.0', private: true, type: 'module' }));
  await npm(['install', tarball, ...peers, '--offline', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error'], consumer);
  report.tarball = tarball;
  report.sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
  report.checks.push('isolated tarball install');
  await run(process.execPath, [path.join(typescriptRoot, 'bin/tsc'), '--project', path.join(consumer, 'tsconfig.json')], consumer);
  report.checks.push('public TypeScript consumption');
  await build({ root: consumer, configFile: false, logLevel: 'warn', build: {
    ssr: path.join(consumer, 'extensions.tsx'), outDir: 'ssr', emptyOutDir: true,
    rollupOptions: { external: [/^reactive-md(?:\/|$)/, /^react(?:\/|$)/], output: { entryFileNames: 'extensions.mjs' } },
  } });
  await build({ root: consumer, configFile: false, logLevel: 'warn', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { outDir: 'standalone-dist', emptyOutDir: true, minify: true,
      lib: { entry: path.join(consumer, 'standalone.ts'), name: 'SDKConsumer', formats: ['iife'], fileName: () => 'consumer.js' } },
  });
  const assertionSource = `
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal, createLocalRuntime, exportLocalState, completeLocalSource } from 'reactive-md';
import { createLocalConfig, localComponentDigest, resolveLocalComponentProps } from 'reactive-md/sdk';
import { createLocalComponentCatalog, insertLocalComponent, validateLocalComponentInsertTemplates } from 'reactive-md/authoring';
import { LocalDocumentView } from 'reactive-md/react';
import { renderLocalStaticDocument } from 'reactive-md/react/server';
import { createLocalShareableHtml, createLocalExportPlan, defineLocalStandaloneBundle, validateLocalExtensionRequirements } from 'reactive-md/export';
import { config, reactConfig, source, rating, componentResources } from './ssr/extensions.mjs';
const result = compileLocal(source, {config});
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
const document = result.document;
const runtime = createLocalRuntime(document);
assert.equal(runtime.getParameter('score'), 3);
assert.equal(runtime.document.bindings.score.nodeIds.length, 2);
assert.deepEqual(runtime.setParameter('score', 4), []);
assert.equal(runtime.getParameter('score'), 4);
assert.ok(runtime.setParameter('score', 6).length);
assert.equal(runtime.getParameter('score'), 4);
const props = resolveLocalComponentProps(rating, {label:'Rating',max:'5'}, runtime);
assert.equal(typeof props.max, 'number');
assert.equal(resolveLocalComponentProps(rating, {label:'Rating',max:'{{ 5 }}'}, runtime).max, 5);
assert.equal(resolveLocalComponentProps(rating, {label:'Rating'}, runtime).max, 5);
assert.throws(() => resolveLocalComponentProps(rating, {label:'Rating',max:'0'}, runtime));
const catalog = createLocalComponentCatalog(config, 'zh');
assert.ok(catalog.some(entry => entry.name === 'rating' && entry.title === '评分'));
assert.deepEqual(validateLocalComponentInsertTemplates(config,'zh'),[]);
const inserted=insertLocalComponent(config,rating.id,source,{start:source.length,end:source.length},'zh');
assert.equal(compileLocal(inserted.value,{config}).ok,true);
for (const entry of catalog.filter(entry => ['rating','hint'].includes(entry.name))) {
 const example = compileLocal(entry.insertText, {config});
 assert.equal(example.ok, true, JSON.stringify(example.diagnostics));
}
assert.ok(completeLocalSource('</hi', 4, {config}).some(entry => entry.label === 'hint'));
const rendered = renderLocalStaticDocument({document, runtime, reactConfig, resources:componentResources, colorScheme:'dark', locale:'zh'});
assert.equal(rendered.ok,true,JSON.stringify(rendered.diagnostics));
const markup=rendered.markup;
assert.ok(markup.replace(/<[^>]*>/g,'').includes('4 / 5'));
assert.ok(markup.includes('example-hint'));
assert.equal(markup.match(/<strong\\b[^>]*>([\\s\\S]*?)<\\/strong>/)?.[1].replace(/<[^>]*>/g,''),'4');
assert.ok(!markup.includes('unavailable'));
const css = await readFile('./node_modules/reactive-md/dist-library/reactive-md.css', 'utf8');
const script = await readFile('./standalone-dist/consumer.js', 'utf8');
const bundle = defineLocalStandaloneBundle(script, config);
const state = exportLocalState(runtime);
const options = {title:'SDK offline consumer',source,document,config,state,staticMarkup:markup,css,colorScheme:'dark',locale:'zh',bundle,resources:componentResources};
await writeFile('./interactive.html', createLocalShareableHtml({...options,mode:'interactive'}));
await writeFile('./static.html', createLocalShareableHtml({...options,mode:'static'}));
assert.ok(!createLocalExportPlan({document,config,target:'offline'}).ok);
assert.ok(!createLocalExportPlan({document,config,target:'static',requiredResources:['missing.css']}).ok);
assert.ok(validateLocalExtensionRequirements(document.extensions, createLocalConfig()).length);
const changed = createLocalConfig({components:[{...rating,version:'2.0.0'}]});
assert.ok(validateLocalExtensionRequirements(document.extensions,changed).length);
assert.equal(typeof localComponentDigest(rating), 'string');
runtime.dispose();
console.log('PASS SDK public imports, shared constraints, typed props, templates, SSR, export preflight');
`;
  await writeFile(path.join(consumer, 'behavior.tsx'), `
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {compileLocal,createLocalRuntime} from 'reactive-md';
import {defineLocalComponent,createLocalConfig} from 'reactive-md/sdk';
import {LocalDocumentView,createReactConfig,defineReactComponent} from 'reactive-md/react';
import {rating,hint,paper,RatingControl,RatingText,Hint} from './extensions';
let active=0; const diagnostics=[];
function TrackedRating(ctx){useEffect(()=>{active++;return()=>{active--;};},[]);return <RatingControl {...ctx}/>;}
const boom=defineLocalComponent({id:'test/boom',name:'test-boom',version:'1.0.0',protocol:'reactive-md-component/v1',form:'leaf',props:{fail:{kind:'boolean',dynamic:true}},capabilities:{interactive:true,static:true,ssr:true,offline:true}});
function Boom(ctx){if(ctx.props.fail)throw new Error('expected test component failure');return <span data-boom="healthy">Healthy</span>;}
const config=createLocalConfig({components:[rating,hint,boom],themes:[paper]});
const reactConfig=createReactConfig(config,{components:[defineReactComponent(rating,{render:TrackedRating,renderStatic:RatingText}),defineReactComponent(hint,{render:Hint,renderStatic:Hint}),defineReactComponent(boom,{render:Boom,renderStatic:Boom})]});
const source='<theme name="paper">\\n<toggle bind="blocked" label="Blocked">\\n<toggle bind="shown" label="Visible" initial="true">\\n<toggle bind="fail" label="Fail">\\n<panel title="Behavior">\\n<number bind="score" label="Score" min="0" max="5" initial="3">\\n<if when="{{ shown }}">\\n<rating bind="score" label="Rating" max="5" disabled="{{ blocked }}">\\n</if>\\n<hint>Score: **{{ score }}**</hint>\\n<test-boom fail="{{ fail }}">\\n</panel>';
const compiled=compileLocal(source,{config});if(!compiled.ok)throw new Error(JSON.stringify(compiled.diagnostics));
const runtime=createLocalRuntime(compiled.document);const root=createRoot(document.getElementById('root'));
function App(){const[color,setColor]=useState('light');window.sdkColor=setColor;return <LocalDocumentView document={compiled.document} runtime={runtime} reactConfig={reactConfig} colorScheme={color} onDiagnostics={items=>diagnostics.push(...items)}/>;}
root.render(<App/>);
window.sdkTest={config,source,requirements:compiled.document.extensions,set:(name,value)=>runtime.setParameter(name,value),state:()=>runtime.getParameters(),active:()=>active,diagnostics:()=>diagnostics,unmount:()=>{root.unmount();runtime.dispose();}};
`);
  await build({root:consumer,configFile:false,logLevel:'warn',define:{'process.env.NODE_ENV':JSON.stringify('production')},
    build:{outDir:'behavior-dist',emptyOutDir:true,minify:true,lib:{entry:path.join(consumer,'behavior.tsx'),name:'SDKBehavior',formats:['iife'],fileName:()=>'behavior.js'}}});
  await writeFile(path.join(consumer,'compile-worker.ts'), "import {startLocalCompileWorker} from 'reactive-md'; startLocalCompileWorker(self);");
  await build({root:consumer,configFile:false,logLevel:'warn',define:{'process.env.NODE_ENV':JSON.stringify('production')},
    build:{outDir:'worker-dist',emptyOutDir:true,minify:true,lib:{entry:path.join(consumer,'compile-worker.ts'),name:'SDKWorker',formats:['iife'],fileName:()=>'worker.js'}}});
  await writeFile(path.join(consumer, 'verify.mjs'), assertionSource);
  const nodeResult = await run(process.execPath, ['verify.mjs'], consumer);
  report.node = nodeResult.trim();
  report.checks.push('Node SSR, typed props, bindings, authoring, export preflight');
  await cp(path.join(consumer, 'interactive.html'), path.join(artifacts, 'interactive.html'));
  await cp(path.join(consumer, 'static.html'), path.join(artifacts, 'static.html'));
  const behaviorScript=await readFile(path.join(consumer,'behavior-dist/behavior.js'),'utf8');
  const workerScript=await readFile(path.join(consumer,'worker-dist/worker.js'),'utf8');
  const baseCss=await readFile(path.join(consumer,'node_modules/reactive-md/dist-library/reactive-md.css'),'utf8');
  await writeFile(path.join(consumer,'behavior.html'), '<!doctype html><html><head><meta charset="utf-8"><style>'+baseCss+'</style></head><body><div id="root"></div><script>'+behaviorScript.replace(/<\/script/gi,'<\\/script')+'</script></body></html>');
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, offline: true });
      const page = await context.newPage();
      const errors = [], requests = [], hydrationErrors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', event => { if (event.type() === 'error') hydrationErrors.push(event.text()); });
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(pathToFileURL(path.join(consumer, 'interactive.html')).href);
      const radio = page.getByRole('radio', {name:'评分 4',exact:true});
      await expect(radio).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('radio', {name:'评分 2',exact:true}).click();
      await page.mouse.move(1, 1);
      await expect(page.getByRole('textbox',{name:'内置评分',exact:true})).toHaveValue('2');
      await expect(page.locator('.example-hint strong')).toHaveText('2');
      await page.getByRole('textbox',{name:'内置评分',exact:true}).fill('5');
      await page.getByRole('textbox',{name:'内置评分',exact:true}).press('Tab');
      await expect(page.getByRole('radio', {name:'评分 5',exact:true})).toHaveAttribute('aria-checked','true');
      await page.getByRole('button', {name:/reset|重置|恢复默认/i}).click();
      // Standalone rebases Reset to the exported state, preserving its v1 contract.
      await expect(page.getByRole('radio', {name:'评分 4',exact:true})).toHaveAttribute('aria-checked','true');
      await expect(page.locator('.example-rating')).not.toHaveAttribute('data-reset-token','0');
      await expect(page.locator('article.local-document')).toHaveAttribute('data-rmd-theme','paper');
      await expect(page.locator('article.local-document')).toHaveAttribute('data-color-scheme','dark');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(errors, []);
      assert.deepEqual(hydrationErrors, []);
      assert.deepEqual(requests, []);
      await page.screenshot({path:path.join(artifacts, `offline-${width}.png`),fullPage:true});
      await context.close();
      report.checks.push(`offline hydration, shared writes, reset, dark theme, layout at ${width}px`);
    }
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(consumer, 'static.html')).href);
    await expect(page.locator('.example-rating-static')).toContainText('4 / 5');
    await expect(page.locator('.example-hint strong')).toHaveText('4');
    await context.close();
    report.checks.push('static HTML without JavaScript');
    const behaviorContext=await browser.newContext({offline:true});
    const behaviorPage=await behaviorContext.newPage();
    await behaviorPage.goto(pathToFileURL(path.join(consumer,'behavior.html')).href);
    await expect(behaviorPage.getByRole('radio',{name:'评分 3',exact:true})).toHaveAttribute('aria-checked','true');
    assert.equal(await behaviorPage.evaluate(()=>window.sdkTest.active()),1);
    const workerResults=await behaviorPage.evaluate(async workerSource=>{
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
      const worker=new Worker(url);
      const request=(data)=>new Promise((resolve,reject)=>{worker.onmessage=event=>resolve(event.data);worker.onerror=event=>reject(new Error(event.message));worker.postMessage(data);});
      try{
        const first=await request({id:1,source:window.sdkTest.source,options:{config:window.sdkTest.config}});
        const changed=structuredClone(window.sdkTest.config);changed.components[0].version='2.0.0';
        const second=await request({id:2,source:window.sdkTest.source,options:{config:changed}});
        return {first,second,requirements:window.sdkTest.requirements};
      }finally{worker.terminate();URL.revokeObjectURL(url);}
    },workerScript);
    assert.equal(workerResults.first.result.ok,true,JSON.stringify(workerResults.first));
    assert.deepEqual(workerResults.first.result.document.extensions,workerResults.requirements);
    assert.equal(workerResults.second.result.document.extensions.components.find(item=>item.id==='example/rating').version,'2.0.0');
    report.checks.push('real browser Worker clone, same-config parity, configuration invalidation');
    await behaviorPage.evaluate(()=>window.sdkTest.set('blocked',true));
    await expect(behaviorPage.getByRole('radio',{name:'评分 3',exact:true})).toBeDisabled();
    await behaviorPage.evaluate(()=>window.sdkTest.set('blocked',false));
    await expect(behaviorPage.getByRole('radio',{name:'评分 3',exact:true})).toBeEnabled();
    await behaviorPage.evaluate(()=>window.sdkTest.set('shown',false));
    await expect(behaviorPage.locator('.example-rating')).toBeHidden();
    assert.equal(await behaviorPage.evaluate(()=>window.sdkTest.state().score),3);
    await behaviorPage.evaluate(()=>window.sdkTest.set('shown',true));
    await expect(behaviorPage.locator('.example-rating')).toBeVisible();
    await behaviorPage.evaluate(()=>{window.sdkTest.set('score',5);window.sdkColor('dark');});
    await expect(behaviorPage.locator('article.local-document')).toHaveAttribute('data-color-scheme','dark');
    assert.equal(await behaviorPage.evaluate(()=>window.sdkTest.state().score),5);
    await behaviorPage.evaluate(()=>window.sdkTest.set('fail',true));
    await expect(behaviorPage.locator('[data-local-host-reason="error"]')).toBeVisible();
    await expect(behaviorPage.locator('.example-hint')).toContainText('5');
    assert.ok((await behaviorPage.evaluate(()=>window.sdkTest.diagnostics())).some(item=>item.code==='local.extension.render'));
    await behaviorPage.evaluate(()=>window.sdkTest.unmount());
    assert.equal(await behaviorPage.evaluate(()=>window.sdkTest.active()),0);
    await behaviorContext.close();
    report.checks.push('disabled, hiding, theme state retention, descendant error isolation, unmount cleanup');
  } finally { await browser.close(); }
  report.status = 'passed';
  console.log(`PASS isolated SDK consumer: ${report.checks.length} checks; ${consumer}`);
} catch (error) {
  report.status = 'failed';
  report.error = error.stack ?? String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify(report, null, 2));
}
