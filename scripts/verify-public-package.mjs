import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { moduleSpecifiers } from './module-specifiers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const consumer = mkdtempSync(join(process.env.REACTIVE_MD_BOUNDARY_TEMP ?? tmpdir(), 'reactive-md-boundary-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Keep existing specifiers in the same minor series, including compatibility aliases.
const stableEntries = [
  '.', './compiler', './compiler/standard', './compiler/session', './scan', './authoring', './sdk',
  './presets/default', './presets/default/packs', './presets/minimal', './presets/minimal/react',
  './plugins/forms', './plugins/network', './plugins/navigation', './plugins/data',
  './plugins/chart', './plugins/plot', './plugins/diagram', './plugins/gallery',
  './react', './react/unstyled', './react/minimal', './react/server', './react/runtime',
  './react/packed', './react/static', './react/static/server', './worker-pool',
  ...['controls', 'layout', 'data', 'visuals'].map(name => `./presets/default/packs/react/${name}`),
  './runtime', './runtime/browser', './observability', './export', './export-assets',
  './build', './vite', './vite/client', './pdf', './standalone', './standalone/host',
  './testing', './testing/react', './testing/browser',
  './styles.css', './styles/minimal.css', './screen.css', './print.css',
  './package.json', './notices', './assets/standalone.js',
];
function run(command, args, cwd = root) {
  const isNpm = command === npm;
  const executable = isNpm && process.env.npm_execpath ? process.execPath : command;
  const parameters = isNpm && process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  const r = spawnSync(executable, parameters, { cwd, encoding: 'utf8', shell: isNpm && !process.env.npm_execpath && process.platform === 'win32', env: process.env });
  assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function verifyPackGraph(entry, forbidden) {
  const files = [join(root, 'dist-library', entry)];
  const visited = new Set();
  const modules = new Set();
  while (files.length) {
    const file = files.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, module] of source.matchAll(/^\/\/ (src\/\S+)\s*$/gm)) {
      modules.add(module);
      assert.ok(!forbidden.test(module), `${entry} includes an unselected module: ${module}`);
    }
    for (const specifier of moduleSpecifiers(source, basename(file))) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) files.push(resolve(dirname(file), specifier));
    }
  }
  return modules;
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
  for (const specifier of stableEntries) {
    assert.ok(Object.hasOwn(pkg.exports, specifier), `Stable package entry was removed: ${specifier}`);
  }
  const exportTargets = (target) => typeof target === 'string' ? [target]
    : target && typeof target === 'object' ? Object.values(target).flatMap(exportTargets) : [];
  const packedFiles = new Set(packed.files.map(file => file.path));
  assert.ok(!packedFiles.has('docs/compatibility/compatibility-manifest.json'),
    'The workspace compatibility manifest records this tarball digest and must stay outside it');
  for (const target of exportTargets(pkg.exports)) {
    assert.ok(packedFiles.has(target.replace(/^\.\//, '')), `Package export is missing: ${target}`);
  }
  verifyPackGraph('reactive-md-react-pack-layout.js', /^src\/components\/(?:controls|chart|plot|diagram|table)\//);
  verifyPackGraph('reactive-md-react-pack-data.js', /^src\/components\/(?:controls|chart|plot|diagram|gallery)\/|\/shared\/visuals\.tsx$/);
  verifyPackGraph('reactive-md-react-packed.js', /\/default-preset\.ts$/);
  // Static entries may reach pure compilation helpers such as dependencies.ts and
  // runtime-requirement.ts, but never the compiler pipeline, incremental sessions,
  // Workers, or the live local runtime.
  const staticForbidden = /^src\/local\/(?:runtime\/|compilation\/(?:session\/|compiler)|transport\/worker)/;
  for (const entry of ['reactive-md-react-static.js', 'reactive-md-react-static-server.js']) {
    const graph = verifyPackGraph(entry, staticForbidden);
    assert.ok(graph.has('src/local/compilation/runtime-requirement.ts'),
      `${entry} no longer reaches compilation/runtime-requirement.ts; the static isolation assertion is vacuous`);
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
import { createLocalCompileSession as createNarrowCompileSession, localCompileOptionsKey as narrowCompileOptionsKey } from 'reactive-md/compiler/session';
import { analyzeLocalSource as scanLocalSource } from 'reactive-md/scan';
import { compileLocal, createLocalCompileSession, createLocalRuntime, LocalCompileScheduler, startLocalCompileWorker, localCompileOptionsKey } from 'reactive-md';
import { createDiagnosticReport, createLocalPerformanceReport } from 'reactive-md/observability';
import { createLocalCompilePool } from 'reactive-md/worker-pool';
import { createReactHost as createPackedHost, deriveLocalReactPreset } from 'reactive-md/react/packed';
import { LocalStaticDocumentView } from 'reactive-md/react/static';
import { renderLocalStaticMarkup } from 'reactive-md/react/static/server';
import layoutReact from 'reactive-md/presets/default/packs/react/layout';
import dataReact from 'reactive-md/presets/default/packs/react/data';
import visualsReact from 'reactive-md/presets/default/packs/react/visuals';
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
const packedHost = createPackedHost({ presets: [layoutReact] });
assert.ok(packedHost.config.registry.some(definition => definition.name === 'alert'));
assert.ok(!packedHost.config.registry.some(definition => definition.name === 'chart'));
assert.match(packedHost.css, /local-accordion/);
assert.ok(createPackedHost({ presets: [dataReact, visualsReact] }).config.registry.some(definition => definition.name === 'chart'));
const combined = createPackedHost({ presets: [layoutReact, dataReact] });
assert.equal(combined.config.registry.filter(definition => definition.name === 'column').length, 1);
const tableHost = createPackedHost({ presets: [deriveLocalReactPreset(dataReact, { include: ['data-table', 'column'] })] });
assert.match(tableHost.css, /local-visual-table/);
assert.doesNotMatch(tableHost.css, /local-visual-(?:plot|chart|diagram)/);
const embedded = compileLocal('Literal {{ none }}', { embedding: { expressions: 'literal' } });
assert.ok(embedded.ok && embedded.document.requiresRuntime === false);
assert.ok(server.renderLocalStaticMarkup({ document: embedded.document }).ok);
const slots = compileLocal('<external slot="references" />', { embedding: { allowExternalSlots: true } });
assert.ok(slots.ok && typeof LocalStaticDocumentView === 'function');
const staticMarkup = renderLocalStaticMarkup({ document: slots.document, renderExternalSlot: slot => slot.name });
assert.ok(staticMarkup.ok && staticMarkup.markup.includes('references'));
assert.equal(createLocalPerformanceReport([]).schema, 'reactive-md-performance/v1');
const compilePool = createLocalCompilePool({ workers: 1, createWorker() { throw new Error('No Worker in Node'); } });
try {
  const outcome = await compilePool.schedule({ documentId: 'packed-smoke', revision: 1, source: 'Worker fallback' });
  assert.equal(outcome.mode, 'fallback');
  assert.equal(outcome.result.ok, true);
} finally { compilePool.dispose(); }
const diagnosticReport = createDiagnosticReport('plain text');
assert.equal(diagnosticReport.schema, 'reactive-md-diagnostic/v1');
assert.equal(diagnosticReport.document.sourceBytes, 10);
assert.equal(JSON.stringify(diagnosticReport).includes('plain text'), false);
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
const narrowOptionsKey = narrowCompileOptionsKey({ strict: false });
assert.equal(typeof narrowOptionsKey, 'string');
const narrowSource = '<number bind="count" label="Count" initial="1">\\n\\nTotal: {{ count }}\\n\\nA reusable paragraph.';
const narrowSession = createNarrowCompileSession();
try {
  const firstNarrow = narrowSession.compile(narrowSource, undefined, 'final');
  assert.equal(firstNarrow.ok, true, JSON.stringify(firstNarrow.diagnostics));
  assert.equal(firstNarrow.status, 'valid');
  const repeatedNarrow = narrowSession.compile(narrowSource, undefined, 'final');
  assert.equal(repeatedNarrow.status, 'valid');
  assert.equal(narrowSession.stats.mode, 'cached');
  const editedNarrow = narrowSession.compile(narrowSource + '\\n\\nMore text.', undefined, 'final');
  assert.equal(editedNarrow.ok, true, JSON.stringify(editedNarrow.diagnostics));
  assert.equal(editedNarrow.status, 'valid');
} finally {
  narrowSession.dispose();
}
assert.throws(() => narrowSession.compile(narrowSource), /disposed/);
const narrowAnalysis = scanLocalSource(narrowSource);
assert.ok(narrowAnalysis.tokens.some((token) => token.kind === 'tag'));
assert.ok(narrowAnalysis.tokens.some((token) => token.kind === 'expression'));
const narrowBinding = narrowAnalysis.bindings.find((binding) => binding.name === 'count');
assert.equal(narrowSource.slice(narrowBinding.declarations[0].start, narrowBinding.declarations[0].end), 'count');
assert.equal(narrowSource.slice(narrowBinding.references[0].start, narrowBinding.references[0].end), 'count');
assert.equal(narrowAnalysis.diagnostics.length, 0);
assert.ok(scanLocalSource('<number bind="count">').diagnostics.some((diagnostic) => diagnostic.code === 'local.label.required'));
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
console.log('Packed public compiler, session, scan, authoring, Worker, SDK, React/SSR, export and export-asset boundaries passed.');
`);
  process.stdout.write(run(process.execPath, ['smoke.mjs'], consumer));
  writeFileSync(join(consumer, 'consumer.ts'), `import {createCompiler} from 'reactive-md/compiler';
import {createStandardCompiler} from 'reactive-md/compiler/standard';
import {createLocalCompileSession, localCompileOptionsKey} from 'reactive-md/compiler/session';
import type {LocalCompileSession, LocalIncrementalStats} from 'reactive-md/compiler/session';
import {analyzeLocalSource as scanLocalSource} from 'reactive-md/scan';
import type {AuthorAnalysis, AuthorBinding, AuthorToken} from 'reactive-md/scan';
import {analyzeLocalSource, insertTemplate} from 'reactive-md/authoring';
import {startLocalCompileWorker} from 'reactive-md';
import type {LocalEmbeddingOptions, LocalRuntimePool} from 'reactive-md';
import type {LocalCompilePoolRequest} from 'reactive-md/worker-pool';
import {createReactHost as createPackedHost} from 'reactive-md/react/packed';
import layoutReact from 'reactive-md/presets/default/packs/react/layout';
import {LocalStaticDocumentView, type LocalStaticExternalResolver} from 'reactive-md/react/static';
import {renderLocalStaticMarkup} from 'reactive-md/react/static/server';
import {createLocalPerformanceReport, type LocalPerformanceReport} from 'reactive-md/observability';
import {layoutPack} from 'reactive-md/presets/default/packs';
import {listExportAssets, readExportAsset, resolveExportAsset} from 'reactive-md/export-assets';
createCompiler().compile('hello'); createStandardCompiler().compile('hello'); analyzeLocalSource('hello'); void insertTemplate; void startLocalCompileWorker; void layoutPack;
const embedding: LocalEmbeddingOptions = { expressions: 'literal', allowExternalSlots: true };
const request: LocalCompilePoolRequest = { documentId: 'doc', revision: 1, source: 'test', options: { embedding } };
const release = (pool: LocalRuntimePool) => pool.dispose();
const staticResult = createCompiler({ embedding }).compile('<external slot="notes" />');
const resolveExternalSlot: LocalStaticExternalResolver = async ({ name }) => () => name;
if (staticResult.ok) renderLocalStaticMarkup({ document: staticResult.document, resolveExternalSlot });
const performance: LocalPerformanceReport = createLocalPerformanceReport([]);
void request; void release; void LocalStaticDocumentView; void performance; createPackedHost({ presets: [layoutReact] });
const narrowSession: LocalCompileSession = createLocalCompileSession();
const narrowStats: LocalIncrementalStats = narrowSession.stats;
narrowSession.dispose();
const narrowAnalysis: AuthorAnalysis = scanLocalSource('hello');
const narrowToken: AuthorToken | undefined = narrowAnalysis.tokens[0];
const narrowBinding: AuthorBinding | undefined = narrowAnalysis.bindings[0];
void localCompileOptionsKey; void narrowStats; void narrowToken; void narrowBinding;
for (const asset of listExportAssets().assets) { void resolveExportAsset(asset.id); }
void readExportAsset;
`);
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
  writeFileSync(join(consumer, 'diagnostics.ts'), `
import { compileLocal, type Diagnostic } from 'reactive-md';
import { createDiagnosticReport, type LocalObserver } from 'reactive-md/observability';

const labels: Record<Diagnostic['severity'], string> = { warning: 'Warning', error: 'Error' };
function oldHostSeverity(diagnostic: Diagnostic): 'warning' | 'error' {
  return diagnostic.severity;
}
const observer: LocalObserver = { onDiagnostic(diagnostic) {
  void labels[oldHostSeverity(diagnostic)];
} };
const result = compileLocal('hello', { observer });
const report = createDiagnosticReport('hello', { diagnostics: result.diagnostics });
for (const diagnostic of report.diagnostics) {
  const severity: 'warning' | 'error' = diagnostic.severity;
  void labels[severity];
}
`);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2022', module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:false},include:['consumer.ts', 'network.ts', 'diagnostics.ts']}));
  run(process.execPath, [resolve(consumer, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
  console.log('Packed NodeNext declarations passed in an independent consumer.');
} finally {
  // Keep failed consumers for diagnosis; successful runs can be removed by the OS temp policy.
  console.log(`Consumer directory: ${consumer}`);
}
