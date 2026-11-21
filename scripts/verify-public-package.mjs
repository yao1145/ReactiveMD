import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const root = fileURLToPath(new URL('..', import.meta.url));
const consumer = mkdtempSync(join(tmpdir(), 'reactive-md-boundary-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd = root) {
  const isNpm = command === npm;
  const executable = isNpm && process.env.npm_execpath ? process.execPath : command;
  const parameters = isNpm && process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  const r = spawnSync(executable, parameters, { cwd, encoding: 'utf8', shell: isNpm && !process.env.npm_execpath && process.platform === 'win32', env: process.env });
  assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
try {
  const expectedLayers = ['rmd.reset', 'rmd.defaults', 'rmd.components', 'rmd.themes', 'rmd.overrides'];
  for (const cssFile of ['dist-library/reactive-md.css', 'dist-library/reactive-md-minimal.css', 'dist-standalone/reactive-md-standalone.css']) {
    const actualLayers = [];
    // Minifiers may replace a redundant order statement with equivalent
    // ordered blocks. Both forms must create the same public layer order.
    for (const node of postcss.parse(readFileSync(join(root, cssFile), 'utf8')).nodes) {
      if (node.type !== 'atrule' || node.name !== 'layer') continue;
      for (const name of node.params.split(',').map(value => value.trim())) {
        if (expectedLayers.includes(name) && !actualLayers.includes(name)) actualLayers.push(name);
      }
    }
    assert.deepEqual(actualLayers, expectedLayers, `${cssFile}: built CSS changed the public cascade order`);
  }
  console.log('Built library and standalone CSS preserve the public cascade order.');
  const minimalCss = readFileSync(join(root, 'dist-library/reactive-md-minimal.css'), 'utf8');
  assert.match(minimalCss, /\._thumb_/, 'Minimal stylesheet is missing the slider CSS module');
  assert.match(minimalCss, /\._calendar_/, 'Minimal stylesheet is missing the calendar CSS module');
  const packed = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer]))[0];
  assert.ok(!packed.files.some(f => /^(?:src|demo|editor|tests)\//.test(f.path)), 'Package contains repository source');
  assert.ok(!packed.files.some(f => /(?:types\/editor\/|reactive-md-(?:editor|codemirror))/.test(f.path)), 'Package still contains editor artifacts');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const exportTargets = (target) => typeof target === 'string' ? [target]
    : target && typeof target === 'object' ? Object.values(target).flatMap(exportTargets) : [];
  const packedFiles = new Set(packed.files.map(file => file.path));
  for (const target of exportTargets(pkg.exports)) {
    assert.ok(packedFiles.has(target.replace(/^\.\//, '')), `Package export is missing: ${target}`);
  }
  assert.ok(!packed.files.some(file => /^docs\/(?:archive|plan)\//.test(file.path)), 'Package contains local archived development documents');
  assert.ok(!packed.files.some(file => /^examples\/.*\/(?:dist|node_modules)\//.test(file.path)), 'Package contains generated example output');
  assert.ok(!packed.files.some(file => /^examples\/sci-fi-theme\/(?:dist|screenshots)\//.test(file.path)), 'Package contains generated theme preview output');
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: {
    'reactive-md': `file:${join(consumer, packed.filename).replaceAll('\\', '/')}`,
    react: pkg.devDependencies.react, 'react-dom': pkg.devDependencies['react-dom'],
    '@types/react': pkg.devDependencies['@types/react'], '@types/react-dom': pkg.devDependencies['@types/react-dom'],
    typescript: pkg.devDependencies.typescript,
  }}));
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], consumer);
  writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStandardCompiler } from 'reactive-md/compiler/standard';
import { createCompiler } from 'reactive-md/compiler';
import { compileLocal, createLocalCompileSession, createLocalRuntime, LocalCompileScheduler, startLocalCompileWorker, localCompileOptionsKey } from 'reactive-md';
import { analyzeLocalSource, insertTemplate, getNativeComponentCatalog } from 'reactive-md/authoring';
import { createRandom } from 'reactive-md/runtime';
import { createLocalBrowserStateStorage, httpSubmit, sseStream, webSocketChannel, webRtcChannel } from 'reactive-md/runtime/browser';
import { useSwipe } from 'reactive-md/react/runtime';
import { layoutPack } from 'reactive-md/presets/default/packs';
import { createReactHost } from 'reactive-md/react';
import { createReactHost as createMinimalHost } from 'reactive-md/react/minimal';
import { minimalReactPresetPackage } from 'reactive-md/presets/minimal/react';
import navigation from 'reactive-md/plugins/navigation';
import network from 'reactive-md/plugins/network';
import { renderLocalPdf } from 'reactive-md/pdf';
import { prepareLocalPrintHtml, waitForLocalPrintImages } from 'reactive-md/export';
import { listExportAssets, readExportAsset, resolveExportAsset } from 'reactive-md/export-assets';
import { renderToStaticMarkup } from 'react-dom/server';
import * as server from 'reactive-md/react/server';
assert.equal(createStandardCompiler().compile('# Package boundary').status, 'valid');
assert.equal(createCompiler().compile('plain text').status, 'valid');
assert.equal(compileLocal('plain text').ok, true);
const streamingSession = createLocalCompileSession();
try {
  const partialSource = '<number bind="count" label="Count" initial="1">\\n\\nTotal: {{ count';
  const partial = streamingSession.compile(partialSource, undefined, 'streaming');
  assert.equal(partial.ok, true);
  assert.equal(partial.status, 'partial');
  assert.ok(Array.isArray(partial.transientDiagnostics));
  const complete = streamingSession.compile(partialSource + ' }}', undefined, 'final');
  assert.equal(complete.ok, true);
  assert.equal(complete.status, 'valid');
} finally {
  streamingSession.dispose();
}
const scheduledResults = [];
const invalidPhaseScheduler = new LocalCompileScheduler({
  createWorker: () => { throw new Error('no worker in the packed consumer'); },
  onResult: (outcome) => scheduledResults.push(outcome),
});
try {
  invalidPhaseScheduler.schedule('# Hello', undefined, undefined, 'streamingg');
  assert.equal(scheduledResults.length, 1);
  assert.equal(scheduledResults[0].result.ok, false);
  assert.equal(scheduledResults[0].result.status, 'failed');
  assert.equal(scheduledResults[0].result.diagnostics[0].code, 'local.options.invalid');
  assert.equal(scheduledResults[0].result.diagnostics[0].messageKey, 'local.options.invalid.source-phase');
} finally {
  invalidPhaseScheduler.dispose();
}
assert.equal(typeof startLocalCompileWorker, 'function');
assert.equal(typeof localCompileOptionsKey({strict:false}), 'string');
assert.ok(analyzeLocalSource('hello'));
assert.equal(typeof insertTemplate, 'function');
assert.ok(getNativeComponentCatalog());
assert.equal(createRandom(7).state, 7);
assert.equal(typeof createLocalBrowserStateStorage, 'function');
assert.ok([httpSubmit, sseStream, webSocketChannel, webRtcChannel].every(factory => typeof factory === 'function'));
assert.equal(typeof useSwipe, 'function');
assert.equal(layoutPack.id, 'reactive-md/default-layout');
assert.equal(createMinimalHost().config.registry.length, 18);
assert.equal(createReactHost().config.registry.some(item => item.name === 'submit-button'), false);
assert.equal(createMinimalHost().config.registry.some(item => item.name === 'submit-button'), false);
assert.ok(createMinimalHost({ presets: [minimalReactPresetPackage, navigation] }).config.registry.some(item => item.name === 'tabs'));
const surveyHost = createMinimalHost({ presets: [minimalReactPresetPackage, network] });
const survey = compileLocal([
  '<external name="total" type="number">',
  '<input bind="answer" label="Answer" required>',
  '<submit-button channel="answers" fields="answer" label="Send answer">',
].join('\\n'), { config: surveyHost.config });
assert.ok(survey.ok, JSON.stringify(survey.diagnostics));
let requests = 0;
const surveyNetwork = { channels: { answers: { submit: httpSubmit({
  endpoint: '/private-survey-endpoint', validate: () => true, fetch: () => { requests++; throw new Error('Unexpected request'); },
}) } } };
const surveyRuntime = createLocalRuntime(survey.document, { network: surveyNetwork });
try {
  const staticNetwork = { channels: { ...surveyNetwork.channels, results: {
    subscribe: { validate: () => true, open: () => { requests++; return () => {}; } },
    mapExternalValues: () => ({ total: 42 }),
  } } };
  const rendered = server.renderLocalStaticDocument({
    document: survey.document, runtime: surveyRuntime, reactConfig: surveyHost.reactConfig,
    network: staticNetwork, resources: surveyHost.resources,
  });
  assert.ok(rendered.ok, JSON.stringify(rendered.diagnostics));
  assert.match(rendered.markup, /Send answer/);
  assert.doesNotMatch(rendered.markup, /private-survey-endpoint/);
  await Promise.resolve();
  assert.equal(requests, 0);
} finally {
  surveyRuntime.dispose();
}
await assert.rejects(renderLocalPdf('<h1>PDF</h1>'), /PDF export requires Playwright/);
assert.equal(prepareLocalPrintHtml('<h1>PDF</h1>'), '<h1>PDF</h1>');
assert.equal(typeof waitForLocalPrintImages, 'function');
assert.ok(Object.keys(server).length);
assert.equal(typeof renderToStaticMarkup, 'function');
for (const entry of ['reactive-md/sdk','reactive-md/presets/default','reactive-md/export']) await import(entry);
const manifest = listExportAssets();
assert.equal(manifest.protocol, 'reactive-md-export-assets/v1');
assert.ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.assets), 'Export-asset manifest is not frozen');
assert.deepEqual(manifest.assets.map(asset => asset.id), ['base-css', 'print-css', 'notices', 'package-json', 'runtime']);
for (const asset of manifest.assets) {
  const file = resolveExportAsset(asset.id);
  assert.equal(file.protocol, 'file:', 'Export asset is not a file URL: ' + asset.id);
  assert.ok(existsSync(fileURLToPath(file)), 'Export asset is missing: ' + asset.id);
  assert.ok(readExportAsset(asset.id).trim(), 'Export asset is empty: ' + asset.id);
}
assert.equal(JSON.parse(readExportAsset('package-json')).name, 'reactive-md');
assert.throws(() => readExportAsset('not-an-asset'), TypeError, 'Unknown export assets must throw a TypeError');
console.log('Packed public compiler, authoring, Worker, SDK, React/SSR, export and export-asset boundaries passed.');
`);
  process.stdout.write(run(process.execPath, ['smoke.mjs'], consumer));
  writeFileSync(join(consumer, 'consumer.ts'), `import {createCompiler} from 'reactive-md/compiler';\nimport {createStandardCompiler} from 'reactive-md/compiler/standard';\nimport {analyzeLocalSource, insertTemplate} from 'reactive-md/authoring';\nimport {startLocalCompileWorker} from 'reactive-md';\nimport {layoutPack} from 'reactive-md/presets/default/packs';\nimport {listExportAssets, readExportAsset, resolveExportAsset} from 'reactive-md/export-assets';\ncreateCompiler().compile('hello'); createStandardCompiler().compile('hello'); analyzeLocalSource('hello'); void insertTemplate; void startLocalCompileWorker; void layoutPack;\nfor (const asset of listExportAssets().assets) { void resolveExportAsset(asset.id); }\nvoid readExportAsset;\n`);
  writeFileSync(join(consumer, 'network.ts'), `
import { createLocalRuntime, compileLocal } from 'reactive-md';
import { httpSubmit, sseStream } from 'reactive-md/runtime/browser';
import type { NetworkConfig, SubmitResult } from 'reactive-md/runtime';
import networkPlugin from 'reactive-md/plugins/network';
const network: NetworkConfig = { channels: {
  answers: { submit: httpSubmit({
    endpoint: '/answers', validate: payload => typeof payload.choice === 'string',
    interpret: response => response.ok ? { ok: true, data: { registrationId: 'R-1042' } } : undefined,
  }) },
  results: {
    subscribe: sseStream({ endpoint: '/results', validate: value => typeof value === 'number' }),
    mapExternalValues: value => typeof value === 'number' ? { total: value } : undefined,
  },
} };
export function receipt(result: SubmitResult) { return result.ok ? result.data : undefined; }
const compiled = compileLocal('# Survey');
if (compiled.ok) createLocalRuntime(compiled.document, { network }).dispose();
void networkPlugin;
`);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2022', module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:false},include:['consumer.ts', 'network.ts']}));
  run(process.execPath, [resolve(consumer, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
  console.log('Packed NodeNext declarations passed in an independent consumer.');
} finally {
  // Keep failed consumers for diagnosis; successful runs can be removed by the OS temp policy.
  console.log(`Consumer directory: ${consumer}`);
}
