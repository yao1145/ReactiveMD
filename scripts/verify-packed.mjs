import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { moduleSpecifiers } from './module-specifiers.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const projectPkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const releaseFixturePath = path.join(projectRoot, 'tests', 'browser', 'release-document.reactive.md');
const releaseBaselinePath = path.join(projectRoot, 'tests', 'browser', 'release-baseline.json');
const releaseSource = await readFile(releaseFixturePath, 'utf8');
const releaseBaseline = JSON.parse(await readFile(releaseBaselinePath, 'utf8'));
const require = createRequire(import.meta.url);

// Run npm through its JS entry point with the current Node binary: spawning
// npm.cmd without a shell is unreliable on Windows, and argument arrays avoid
// shell quoting entirely.
function locateNpmCli() {
  const candidates = [];
  if (process.env.npm_execpath && /\.(?:cjs|mjs|js)$/i.test(process.env.npm_execpath)) {
    candidates.push(process.env.npm_execpath);
  }
  const nodeDirectory = path.dirname(process.execPath);
  candidates.push(path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error('Cannot locate npm-cli.js; run this check through npm run test:packed.');
  return found;
}

const npmCli = locateNpmCli();

function run(label, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => reject(new Error(`${label} could not start: ${error.message}`)));
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const output = [stderr, stdout].filter(Boolean).join('\n').trim();
      reject(new Error(`${label} failed with exit code ${code}.${output ? `\n${output}` : ''}`));
    });
  });
}

function npm(args, cwd) {
  return run(`npm ${args[0]}`, process.execPath, [npmCli, ...args], cwd);
}

function parsePackJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf('[');
    const end = stdout.lastIndexOf(']');
    assert.ok(start !== -1 && end > start, `npm pack did not return JSON: ${stdout.trim()}`);
    return JSON.parse(stdout.slice(start, end + 1));
  }
}

async function pack(destination, targets = []) {
  await mkdir(destination, { recursive: true });
  const { stdout } = await npm(
    ['pack', ...targets, '--ignore-scripts', '--json', '--pack-destination', destination, '--loglevel', 'error'],
    projectRoot,
  );
  const parsed = parsePackJson(stdout);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const packed = entries.map(entry => {
    const tarball = path.join(destination, path.basename(entry.filename));
    return { entry, tarball };
  });
  for (const { entry, tarball } of packed) {
    const info = await stat(tarball);
    assert.ok(info.size > 0, `npm pack produced an empty tarball for ${entry.name ?? entry.filename}`);
  }
  return packed;
}

async function createConsumer(directory, name) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ name, version: '0.0.0', private: true, type: 'module' }, null, 2),
  );
}

function installArgs(tarballs) {
  return [
    'install',
    ...tarballs,
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--no-save',
    '--loglevel',
    'error',
  ];
}

async function assertInstalledTarball(consumer, packageName) {
  const installed = path.join(consumer, 'node_modules', packageName);
  const info = await lstat(installed);
  assert.ok(info.isDirectory(), `${packageName} must be installed as a directory in the consumer`);
  assert.ok(!info.isSymbolicLink(), `${packageName} must come from the tarball, not a repository symlink or file dependency`);
  return installed;
}

function exportTarget(pkg, key) {
  const value = pkg.exports?.[key];
  if (typeof value === 'string') return value;
  return value?.import ?? value?.default;
}

async function checkPackedDocumentation(directory) {
  const parser = unified().use(remarkParse);
  let links = 0;
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      // Author documents may intentionally refer to assets supplied by a host.
      if (!entry.name.endsWith('.md') || entry.name.endsWith('.reactive.md')) continue;
      const pending = [parser.parse(await readFile(file, 'utf8'))];
      while (pending.length) {
        const node = pending.pop();
        pending.push(...node.children ?? []);
        if (node.type !== 'link' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(node.url)) continue;
        const href = decodeURIComponent(node.url.split('#')[0].split('?')[0]);
        const target = href ? path.resolve(path.dirname(file), href) : file;
        const relative = path.relative(directory, target);
        assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep), `Packed documentation link leaves the package: ${node.url}`);
        assert.ok(existsSync(target), `Missing packed documentation target in ${path.relative(directory, file)}: ${node.url}`);
        links++;
      }
    }
  }
  await walk(directory);
  return links;
}

let tempRoot;
try {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-packed-'));

  const missingBuild = [
    'dist-library/reactive-md.js',
    'dist-library/reactive-md-react.js',
    'dist-library/reactive-md.css',
    'dist-library/types/index.d.ts',
    'dist-library/types/react/index.d.ts',
    'dist-library/reactive-md-editor.js',
    'dist-library/reactive-md-editor.css',
    'dist-library/types/editor/index.d.ts',
    'dist-standalone/reactive-md-standalone.js',
    'dist-standalone/reactive-md-standalone.css',
    'bin/reactive-md.mjs',
    'docs/integration/author-tools-en.md',
    'docs/integration/author-tools-ch.md',
  ].filter(file => !existsSync(path.join(projectRoot, file)));
  assert.deepEqual(missingBuild, [], `dist-library is incomplete (${missingBuild.join(', ')}); run npm run build first.`);

  /* ------------------------------------------------ core tarball and consumer */
  const packDirectory = path.join(tempRoot, 'core-pack');
  const [core] = await pack(packDirectory);
  assert.equal(core.entry.version, projectPkg.version, 'Packed tarball version must match package.json');

  const packedFiles = new Set(core.entry.files.map(file => file.path.replace(/\\/g, '/')));
  for (const required of [
    'package.json',
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'dist-library/reactive-md.js',
    'dist-library/reactive-md-react.js',
    'dist-library/reactive-md.css',
    'dist-library/types/index.d.ts',
    'dist-library/types/react/index.d.ts',
    'dist-library/reactive-md-editor.js',
    'dist-library/reactive-md-editor.css',
    'dist-library/types/editor/index.d.ts',
    'dist-standalone/reactive-md-standalone.js',
    'dist-standalone/reactive-md-standalone.css',
    'bin/reactive-md.mjs',
    'cli/main.mjs',
    'docs/integration/local-integration-en.md',
    'docs/integration/local-integration-ch.md',
    'docs/integration/shareable-export-en.md',
    'docs/integration/shareable-export-ch.md',
    'examples/local/counter.reactive.md',
    'examples/conformance/local-draft-2.json',
    'examples/integration/core/index.mjs',
    'examples/integration/react/main.jsx',
  ]) {
    assert.ok(packedFiles.has(required), `Tarball is missing ${required}`);
  }
  assert.ok(![...packedFiles].some(file => file.startsWith('src/')), 'Tarball must not include TypeScript sources');
  assert.ok(![...packedFiles].some(file => /^(?:demo|tests|\.tasks|node_modules|artifacts|\.npm-cache)\//.test(file)), 'Tarball must exclude development applications, tests, sessions, dependencies and artifacts');
  const coreConsumer = path.join(tempRoot, 'consumer-core');
  await createConsumer(coreConsumer, 'reactive-md-packed-core');
  await npm(installArgs([core.tarball]), coreConsumer);

  const installedCore = await assertInstalledTarball(coreConsumer, 'reactive-md');
  const documentationLinks = await checkPackedDocumentation(installedCore);
  const coreModules = (await readdir(path.join(coreConsumer, 'node_modules')))
    .filter(name => !name.startsWith('.'));
  assert.deepEqual(coreModules, ['reactive-md'], 'Core consumer must install only the package tarball, without React or registry dependencies');

  const installedPkg = JSON.parse(await readFile(path.join(installedCore, 'package.json'), 'utf8'));
  assert.equal(installedPkg.private, undefined, 'Installed package must be publishable');
  assert.equal(installedPkg.type, 'module', 'Installed package must declare ESM');
  assert.equal(installedPkg.license, 'MIT', 'Installed package must declare the MIT license');
  assert.equal(installedPkg.engines?.node, '>=22.12.0', 'Installed package must declare the supported Node version');
  assert.match(installedPkg.repository?.url ?? '', /yao1145\/ReactiveMD/, 'Installed package must point at the public repository');
  assert.ok(installedPkg.description && installedPkg.keywords?.length, 'Installed package must include description and keywords');
  assert.deepEqual(Object.keys(installedPkg.dependencies ?? {}), [], 'Installed core package must have no registry dependencies');
  assert.equal(exportTarget(installedPkg, '.'), './dist-library/reactive-md.js');
  assert.equal(exportTarget(installedPkg, './react'), './dist-library/reactive-md-react.js');
  assert.equal(installedPkg.bin?.['reactive-md']?.replace(/^\.\//, ''), 'bin/reactive-md.mjs');
  const lintFixture = path.join(coreConsumer, 'lint document.reactive.md');
  await writeFile(lintFixture, '<number bind="n" label="Count">\n\n{{ n }}');
  const lint = await run('packed lint command', process.execPath,
    [path.join(installedCore, installedPkg.bin['reactive-md']), 'lint', '--json', lintFixture], coreConsumer);
  assert.deepEqual(JSON.parse(lint.stdout), [{ file: lintFixture, ok: true, diagnostics: [] }]);
  await writeFile(lintFixture, '<future>literal fallback</future>');
  const chineseLint = await run('packed localized lint', process.execPath,
    [path.join(installedCore, installedPkg.bin['reactive-md']), 'lint', '--locale', 'zh', '--json', lintFixture], coreConsumer);
  const localizedReport = JSON.parse(chineseLint.stdout)[0];
  assert.equal(localizedReport.diagnostics[0].code, 'local.component.unknown');
  assert.match(localizedReport.diagnostics[0].message, /[\u3400-\u9fff]/u);
  const coreTypesTarget = installedPkg.exports?.['.']?.types;
  assert.ok(
    coreTypesTarget && existsSync(path.resolve(installedCore, coreTypesTarget)),
    'Core entry types are missing from the installed package',
  );

  const cssTarget = exportTarget(installedPkg, './styles.css');
  assert.equal(cssTarget, './dist-library/reactive-md.css', 'styles.css export must remain published');
  const cssPath = path.resolve(installedCore, cssTarget);
  assert.ok(!path.relative(installedCore, cssPath).startsWith('..'), 'styles.css export must stay inside the package');
  assert.ok(existsSync(cssPath), `CSS export ${cssTarget} does not exist in the installed package`);
  assert.ok((await stat(cssPath)).size > 0, 'CSS export is empty');
  assert.ok(!(await readFile(cssPath, 'utf8')).includes('@page'), 'Installed screen styles must not set global page margins');
  assert.match(await readFile(path.resolve(installedCore, exportTarget(installedPkg, './print.css')), 'utf8'), /@page/);
  assert.equal(exportTarget(installedPkg, './screen.css'), cssTarget);

  // Follow public graphs: renderer chunks may be shared between React entries.
  const checkedModules = new Set();
  async function checkPureGraph(file) {
    if (checkedModules.has(file)) return;
    checkedModules.add(file);
    for (const specifier of moduleSpecifiers(await readFile(file, 'utf8'))) {
      assert.ok(specifier.startsWith('.') && !specifier.endsWith('.css'), `${file} imports ${specifier}; core and authoring must be self-contained`);
      await checkPureGraph(path.resolve(path.dirname(file), specifier));
    }
  }
  await checkPureGraph(path.resolve(installedCore, exportTarget(installedPkg, '.')));
  await checkPureGraph(path.resolve(installedCore, exportTarget(installedPkg, './authoring')));

  await writeFile(
    path.join(coreConsumer, 'core-api.mjs'),
    `import assert from 'node:assert/strict';
import {
  applyLocalStateRetention,
  compileLocal,
  localCompileOptionsKey,
  analyzeLocalSource, completeLocalSource, renameLocalBinding, formatLocalSource,
  inspectLocalSourceVersion, checkLocalUpgrade, migrateLocalSource,
  countLocalCodePoints, formatLocalDiagnostic, LOCAL_DIAGNOSTIC_CODES,
  createLocalRuntime,
  exportLocalState,
  importLocalState,
  LOCAL_COMPILE_DELAY_MS,
  LOCAL_SYNTAX_VERSION,
  LocalCompileScheduler,
  planLocalStateRetention,
  startLocalCompileWorker,
} from 'reactive-md';

import * as authoring from 'reactive-md/authoring';
assert.notEqual(localCompileOptionsKey(), localCompileOptionsKey({ markdownBreaks: true }));
assert.equal(typeof authoring.insertTemplate, 'function');
assert.equal(typeof authoring.getLocalComponent, 'function');
assert.ok(authoring.NATIVE_COMPONENTS.length > 0);
assert.equal(authoring.analyzeLocalSource('{{ literal }}', { enableCss: true }).diagnostics.length, 0);
const brokenLines = compileLocal('first\\nsecond', { markdownBreaks: true });
assert.equal(brokenLines.ok, true);

assert.equal(typeof compileLocal, 'function', 'compileLocal must be exported from the core tarball');
assert.equal(typeof createLocalRuntime, 'function', 'createLocalRuntime must be exported from the core tarball');
assert.equal(typeof exportLocalState, 'function', 'exportLocalState must be exported from the core tarball');
assert.equal(typeof importLocalState, 'function', 'importLocalState must be exported from the core tarball');
assert.equal(typeof planLocalStateRetention, 'function', 'planLocalStateRetention must be exported from the core tarball');
assert.equal(typeof applyLocalStateRetention, 'function', 'applyLocalStateRetention must be exported from the core tarball');
assert.equal(typeof LocalCompileScheduler, 'function', 'LocalCompileScheduler must be exported from the core tarball');
assert.equal(typeof startLocalCompileWorker, 'function', 'startLocalCompileWorker must be exported from the core tarball');
assert.equal(LOCAL_COMPILE_DELAY_MS, 150);
assert.equal(LOCAL_SYNTAX_VERSION, 'local-draft-2');
const oldSource = '<!-- reactive-md: local-draft-1 -->\\n# Historical source';
assert.equal(compileLocal(oldSource).ok, false);
assert.equal(inspectLocalSourceVersion(oldSource).supported, false);
assert.equal(checkLocalUpgrade(oldSource).ok, true);
const migratedSource = migrateLocalSource(oldSource);
assert.equal(migratedSource.ok, true);
assert.equal(compileLocal(migratedSource.source).ok, true);
assert.equal(migrateLocalSource(migratedSource.source).changed, false);

const result = compileLocal('# Packed core');
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
const runtime = createLocalRuntime(result.document);
assert.equal(runtime.snapshot().revision, 0);
runtime.dispose();
const source = '<number  bind="n"   label="Count">\\n\\n{{ n }}';
assert.equal(analyzeLocalSource(source).bindings[0].name, 'n');
assert.ok(completeLocalSource('<sli', 4).some(item => item.label === 'slider'));
assert.match(renameLocalBinding(source, 'n', 'count').source, /count/);
assert.ok(compileLocal(formatLocalSource(source)).ok);
assert.equal(countLocalCodePoints('😀'), 1);
const diagnostic = compileLocal('{{ missing }}').diagnostics[0];
assert.ok(LOCAL_DIAGNOSTIC_CODES.includes(diagnostic.code));
assert.notEqual(formatLocalDiagnostic(diagnostic, 'zh'), diagnostic.message);
console.log('PASS core API without React');
`,
  );
  await run('core API fixture', process.execPath, [path.join(coreConsumer, 'core-api.mjs')], coreConsumer);
  const historicalInput = path.join(coreConsumer, 'historical.reactive.md');
  const migratedOutput = path.join(coreConsumer, 'migrated.reactive.md');
  const historicalText = '<!-- reactive-md: local-draft-1 -->\n# Packed historical document\n';
  await writeFile(historicalInput, historicalText, 'utf8');
  await run('packed migration without React', process.execPath,
    [path.join(installedCore, 'bin/reactive-md.mjs'), 'migrate', historicalInput, '-o', migratedOutput], coreConsumer);
  assert.equal(await readFile(historicalInput, 'utf8'), historicalText);
  assert.equal(await readFile(migratedOutput, 'utf8'), historicalText.replace('local-draft-1', 'local-draft-2'));
  await run('packed upgrade check', process.execPath,
    [path.join(installedCore, 'bin/reactive-md.mjs'), 'migrate', '--check', migratedOutput], coreConsumer);
  await run('standalone Node example', process.execPath, [path.join(installedCore, 'examples/integration/core/index.mjs')], coreConsumer);

  /* --------------------------------------- combined capabilities, core only */
  await writeFile(
    path.join(coreConsumer, 'release-core.mjs'),
    `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
  analyzeLocalSource,
  applyLocalStateRetention,
  compileLocal,
  createLocalRuntime,
  createLocalStateFile,
  exportLocalState,
  importLocalState,
  planLocalStateRetention,
  renameLocalBinding,
  serializeLocalState,
} from 'reactive-md';

const source = ${JSON.stringify(releaseSource)};
const baseline = ${JSON.stringify(releaseBaseline)};

const compiled = compileLocal(source);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
const runtime = createLocalRuntime(compiled.document);
try {
  assert.equal(runtime.evaluate('total'), 25);
  assert.equal(runtime.evaluate('mode')[0], 'standard');
  assert.deepEqual(runtime.setParameters(baseline), []);
  assert.equal(runtime.evaluate('total'), 75);
  assert.equal(runtime.evaluate('mode')[0], 'priority');
  assert.equal(runtime.evaluate('subjectCount'), 2);
  assert.deepEqual(runtime.validate(), []);

  const exported = exportLocalState(runtime, { name: 'packed-release', version: '1' });
  assert.deepEqual(exported.parameters, baseline);
  const serialized = serializeLocalState(exported);
  assert.ok(!serialized.includes('"@'));
  writeFileSync('release-combo.state.json', serialized);

  assert.deepEqual(runtime.setParameters({ quantity: 2, owner: 'Ada', subjects: [] }), []);
  assert.deepEqual(importLocalState(runtime, serialized), []);
  assert.deepEqual(runtime.getParameters(), baseline);
  const revised = compileLocal(source + '\\n\\nRevised prose keeps this session.');
  assert.equal(revised.ok, true);
  const retention = planLocalStateRetention({
    previous: compiled.document,
    state: runtime.snapshot().state,
    next: revised.document,
  });
  assert.deepEqual([...retention.retained].sort(), ['owner', 'quantity', 'subjects']);
  const next = createLocalRuntime(revised.document);
  try {
    assert.deepEqual(applyLocalStateRetention(next, retention).diagnostics, []);
    assert.deepEqual(next.getParameters(), baseline);
  } finally { next.dispose(); }

  assert.deepEqual(runtime.setParameter('quantity', 10), []);
  assert.equal(runtime.evaluate('total'), 125);
  assert.deepEqual(runtime.validate().map(item => item.message), ['Total $125.00 exceeds the limit.']);
} finally { runtime.dispose(); }

const renamed = renameLocalBinding(source, 'quantity', 'seats');
assert.ok(renamed.edits.length > 0);
assert.ok(renamed.source.includes('<number bind="seats"'));
assert.ok(renamed.source.includes('{{ seats * unitPrice }}'));
assert.ok(renamed.source.includes('fields="seats"'));
assert.ok(renamed.source.includes('quantity stays literal here'));
assert.ok(analyzeLocalSource(renamed.source).bindings.find(item => item.name === 'seats').references.length > 1);
const renamedDocument = compileLocal(renamed.source);
assert.equal(renamedDocument.ok, true, JSON.stringify(renamedDocument.diagnostics));
const renamedRuntime = createLocalRuntime(renamedDocument.document);
try {
  assert.deepEqual(renamedRuntime.setParameters({ owner: baseline.owner, subjects: baseline.subjects, seats: 10 }), []);
  assert.equal(renamedRuntime.evaluate('total'), 125);
  assert.deepEqual(renamedRuntime.validate().map(item => item.message), ['Total $125.00 exceeds the limit.']);
} finally { renamedRuntime.dispose(); }

const changed = compileLocal(source.replace('initial="2"', 'initial="3"'));
const changedRetention = planLocalStateRetention({
  previous: compiled.document,
  state: { ...baseline },
  next: changed.document,
});
assert.deepEqual([...changedRetention.retained].sort(), ['owner', 'subjects']);
assert.ok(changedRetention.dropped.some(item => item.name === 'quantity' && item.reason === 'initial'));
console.log('PASS combined declarations, collections, validation, authoring and state without React');
`,
  );
  await run('combined core fixture', process.execPath, [path.join(coreConsumer, 'release-core.mjs')], coreConsumer);
  const releaseStateText = await readFile(path.join(coreConsumer, 'release-combo.state.json'), 'utf8');
  await run(
    'packed CLI lint without React',
    process.execPath,
    [path.join(installedCore, 'bin/reactive-md.mjs'), 'lint', path.join(installedCore, 'examples/local/counter.reactive.md')],
    coreConsumer,
  );

  await writeFile(
    path.join(coreConsumer, 'core-types.ts'),
    `import { localCompileOptionsKey } from 'reactive-md';
import { getNativeComponentCatalog, renderNativeSnippet, insertTemplate, type EditorEdit, type LocalCompileOptions } from 'reactive-md/authoring';
const authorOptions: LocalCompileOptions = { markdownBreaks: true };
const signature: string = localCompileOptionsKey(authorOptions);
const snippet = renderNativeSnippet(getNativeComponentCatalog().components[0], '');
const edit: EditorEdit = insertTemplate('', { start: 0, end: 0 }, snippet);
void signature; void edit;
import {
  applyLocalStateRetention,
  compileLocal,
  createLocalRuntime,
  exportLocalState,
  importLocalState,
  LOCAL_COMPILE_DELAY_MS,
  LOCAL_SYNTAX_VERSION,
  LocalCompileScheduler,
  planLocalStateRetention,
  startLocalCompileWorker,
  type LocalCompileResult,
  type LocalRuntime,
  type LocalStateFile,
} from 'reactive-md';

const result: LocalCompileResult = compileLocal('# Packed types');
if (!result.ok) {
  throw new Error(JSON.stringify(result.diagnostics));
}
const runtime: LocalRuntime = createLocalRuntime(result.document);
const file: LocalStateFile = exportLocalState(runtime, { name: 'packed-types', version: '1' });
const plan = planLocalStateRetention({
  previous: runtime.document,
  state: runtime.snapshot().state,
  next: runtime.document,
});
applyLocalStateRetention(runtime, plan);
importLocalState(runtime, file);
runtime.dispose();
const version: 'local-draft-2' = LOCAL_SYNTAX_VERSION;
const delay: number = LOCAL_COMPILE_DELAY_MS;
void version;
void delay;
void LocalCompileScheduler;
void startLocalCompileWorker;
`,
  );
  const tsPackage = require.resolve('typescript/package.json');
  const tsc = path.join(path.dirname(tsPackage), 'bin', 'tsc');
  const tsconfig = path.join(coreConsumer, 'tsconfig.json');
  await writeFile(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: [],
        typeRoots: [],
      },
      include: ['core-types.ts'],
    }, null, 2),
  );
  await run('core type fixture', process.execPath, [tsc, '--project', tsconfig, '--pretty', 'false'], coreConsumer);

  /* --------------------------------------------- React and SSR consumer */
  const reactPackDirectory = path.join(tempRoot, 'react-pack');
  const reactPackages = await pack(reactPackDirectory, [
    path.join(projectRoot, 'node_modules', 'react'),
    path.join(projectRoot, 'node_modules', 'react-dom'),
    path.join(projectRoot, 'node_modules', 'scheduler'),
    path.join(projectRoot, 'node_modules', '@types', 'react'),
    path.join(projectRoot, 'node_modules', '@types', 'react-dom'),
    path.join(projectRoot, 'node_modules', 'csstype'),
  ]);
  const reactTarballs = new Map(reactPackages.map(({ entry, tarball }) => [entry.name, tarball]));
  for (const name of ['react', 'react-dom', 'scheduler', '@types/react', '@types/react-dom', 'csstype']) {
    assert.ok(reactTarballs.has(name), `Unable to pack local ${name} from node_modules`);
  }

  const reactConsumer = path.join(tempRoot, 'consumer-react');
  await createConsumer(reactConsumer, 'reactive-md-packed-react');
  await npm(installArgs([
    core.tarball,
    reactTarballs.get('react'),
    reactTarballs.get('react-dom'),
    reactTarballs.get('scheduler'),
    reactTarballs.get('@types/react'),
    reactTarballs.get('@types/react-dom'),
    reactTarballs.get('csstype'),
  ]), reactConsumer);
  await assertInstalledTarball(reactConsumer, 'reactive-md');
  await assertInstalledTarball(reactConsumer, 'react');
  await assertInstalledTarball(reactConsumer, 'react-dom');

  const reactInstalled = path.join(reactConsumer, 'node_modules', 'reactive-md');
  const reactTypesTarget = installedPkg.exports?.['./react']?.types;
  assert.ok(
    reactTypesTarget && existsSync(path.resolve(reactInstalled, reactTypesTarget)),
    'React entry types are missing from the installed package',
  );

  await writeFile(
    path.join(reactConsumer, 'react-ssr.mjs'),
    `import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LocalDocumentView, LocalReactiveDocument } from 'reactive-md/react';
import { LocalReactiveDocument as UnstyledReactiveDocument } from 'reactive-md/react/unstyled';

assert.equal(typeof LocalReactiveDocument, 'function', 'LocalReactiveDocument must be exported by the React subpath');
assert.equal(typeof LocalDocumentView, 'function', 'LocalDocumentView must be exported by the React subpath');

const html = renderToString(createElement(LocalReactiveDocument, { source: '# Packed SSR' }));
assert.ok(html.length > 0, 'SSR must render markup');
assert.ok(html.includes('Packed SSR'), 'SSR must render the Markdown source');
const softBreakHtml = renderToString(createElement(UnstyledReactiveDocument, { source: 'first\\nsecond', compileOptions: { markdownBreaks: true } }));
assert.ok(softBreakHtml.includes('first</span><br'));
assert.ok(softBreakHtml.includes('<span>second</span>'));
console.log('PASS React subpath and SSR');
`,
  );
  await run('React SSR fixture', process.execPath, [path.join(reactConsumer, 'react-ssr.mjs')], reactConsumer);

  const packedDocument = path.join(reactConsumer, 'packed.reactive.md');
  await writeFile(packedDocument, '# Packed CLI\n\n<input bind="name" label="Name" initial="Ada">\n\nHello {{ name }}.\n');
  const packedInteractive = path.join(reactConsumer, 'packed.html');
  const packedStatic = path.join(reactConsumer, 'packed-static.html');
  await run(
    'packed CLI interactive build',
    process.execPath,
    [path.join(reactInstalled, 'bin/reactive-md.mjs'), 'build', packedDocument, '-o', packedInteractive],
    reactConsumer,
  );
  await run(
    'packed CLI static build',
    process.execPath,
    [path.join(reactInstalled, 'bin/reactive-md.mjs'), 'build', packedDocument, '-o', packedStatic, '--mode', 'static'],
    reactConsumer,
  );
  const packedInteractiveHtml = await readFile(packedInteractive, 'utf8');
  const packedStaticHtml = await readFile(packedStatic, 'utf8');
  assert.ok(packedInteractiveHtml.includes('application/reactive-md+json'), 'Packed interactive HTML needs the auto-mount payload');
  assert.ok(packedInteractiveHtml.includes('data-reactive-md-auto'), 'Packed interactive HTML needs the auto-mount script');
  assert.ok(!packedStaticHtml.includes('<script'), 'Packed static HTML must not contain a runtime script');
  assert.ok(packedStaticHtml.includes('Hello'), 'Packed static HTML must render document content');

  /* --------------------------------- combined capabilities, installed package */
  const releaseDocument = path.join(reactConsumer, 'release.reactive.md');
  const releaseStatePath = path.join(reactConsumer, 'release.state.json');
  const releaseInteractive = path.join(reactConsumer, 'release-interactive.html');
  const releaseStatic = path.join(reactConsumer, 'release-static.html');
  const releaseInitial = path.join(reactConsumer, 'release-initial.html');
  await writeFile(releaseDocument, releaseSource, 'utf8');
  await writeFile(releaseStatePath, releaseStateText, 'utf8');

  await run(
    'packed combined interactive build',
    process.execPath,
    [path.join(reactInstalled, 'bin/reactive-md.mjs'), 'build', releaseDocument, '-o', releaseInteractive, '--state-file', releaseStatePath],
    reactConsumer,
  );
  await run(
    'packed combined static build',
    process.execPath,
    [path.join(reactInstalled, 'bin/reactive-md.mjs'), 'build', releaseDocument, '-o', releaseStatic, '--state-file', releaseStatePath, '--mode', 'static'],
    reactConsumer,
  );
  await run(
    'packed combined default build',
    process.execPath,
    [path.join(reactInstalled, 'bin/reactive-md.mjs'), 'build', releaseDocument, '-o', releaseInitial],
    reactConsumer,
  );

  const releaseInteractiveHtml = await readFile(releaseInteractive, 'utf8');
  const releaseStaticHtml = await readFile(releaseStatic, 'utf8');
  const releaseInitialHtml = await readFile(releaseInitial, 'utf8');
  const releasePayloadMatch = releaseInteractiveHtml.match(
    /<script type="application\/reactive-md\+json"[^>]*>([\s\S]*?)<\/script>/,
  );
  assert.ok(releasePayloadMatch, 'Packed combined HTML needs the auto-mount payload');
  const releasePayload = JSON.parse(releasePayloadMatch[1]);
  assert.equal(releasePayload.source, releaseSource, 'Packed payload must carry the combined document source');
  assert.deepEqual(releasePayload.state.parameters, releaseBaseline, 'Packed payload must carry public state only');
  assert.ok(!Object.keys(releasePayload.state.parameters).some(name => name.startsWith('@')));
  for (const [label, html] of [['interactive', releaseInteractiveHtml], ['static', releaseStaticHtml]]) {
    assert.ok(html.includes('$75.00'), `Packed ${label} HTML must render the state baseline`);
    assert.ok(html.includes('Physics') && html.includes('Chemistry'), `Packed ${label} HTML must render collection labels`);
    assert.ok(html.includes('>physics<') && html.includes('>chemistry<'), `Packed ${label} HTML must render collection rows`);
    assert.match(html, /data-local-validation="passed"/, `Packed ${label} HTML must render successful baseline validation`);
    assert.doesNotMatch(html, /data-local-validation="(?:failed|error)"/);
  }
  assert.ok(!/<script\b/.test(releaseStaticHtml), 'Packed static HTML must not contain a runtime script');
  assert.ok(releaseInitialHtml.includes('$25.00'), 'Packed default HTML must use author defaults');

  await writeFile(
    path.join(reactConsumer, 'release-ssr.mjs'),
    `import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  compileLocal,
  createLocalRuntime,
  createLocalStateFile,
  resolveLocalStateBaseline,
} from 'reactive-md';
import { LocalDocumentView } from 'reactive-md/react';

const source = ${JSON.stringify(releaseSource)};
const baseline = ${JSON.stringify(releaseBaseline)};
const compiled = compileLocal(source);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
const state = createLocalStateFile(compiled.document, baseline, { name: 'packed-release', version: '1' });
const resolved = resolveLocalStateBaseline(compiled.document, state);
assert.equal(resolved.ok, true, JSON.stringify(resolved.diagnostics));
const runtime = createLocalRuntime(resolved.baseline.document);
try {
  const html = renderToString(createElement(LocalDocumentView, {
    document: resolved.baseline.document,
    runtime,
  }));
  assert.ok(html.includes('$75.00'), 'Packed React view must render the state baseline');
  assert.ok(html.includes('aria-label="Release subjects"'), 'Packed React view must render the collection table');
  assert.ok(html.includes('physics') && html.includes('chemistry'));
  assert.ok(!html.includes('exceeds the limit'));
  assert.ok(!html.includes('local-fallback'));
  const staticHtml = renderToString(createElement(LocalDocumentView, {
    document: resolved.baseline.document,
    runtime,
    mode: 'static',
  }));
  assert.ok(!staticHtml.includes('<input'));
  assert.ok(staticHtml.includes('$75.00'));
  assert.ok(staticHtml.includes('physics'));
} finally { runtime.dispose(); }
console.log('PASS packed React combination view');
`,
  );
  await run('packed combined React fixture', process.execPath, [path.join(reactConsumer, 'release-ssr.mjs')], reactConsumer);

  await writeFile(path.join(reactConsumer, 'react-types.tsx'), `import { createElement } from 'react';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import { LocalDocumentView, LocalReactiveDocument, type LocalUrlPolicy, type LocalRenderContext } from 'reactive-md/react';
import { LocalDocumentView as UnstyledDocumentView } from 'reactive-md/react/unstyled';
import { createRef } from 'react';
import { ReactiveMarkdownEditor, type ReactiveMarkdownEditorHandle, type ReactiveMarkdownEditorProps } from 'reactive-md/editor';

const editorRef = createRef<ReactiveMarkdownEditorHandle>();
const renderContext = (ctx: LocalRenderContext) => ctx.render();
void renderContext;
void UnstyledDocumentView;
const editorProps: ReactiveMarkdownEditorProps = {
  value: '# Editable source', onChange(value) { void value; }, locale: 'zh', theme: 'dark',
  height: 480, minHeight: '240px', documentKey: 'typed-editor', diagnostics: [],
};
const editor = createElement(ReactiveMarkdownEditor, { ...editorProps, ref: editorRef });
editorRef.current?.selectRange({ start: 0, end: 3 });
editorRef.current?.getTextarea();
editorRef.current?.getSelection();
editorRef.current?.undo();
editorRef.current?.redo();
void editor;

const policy: LocalUrlPolicy = (_url, kind) => kind === 'link';
const view = createElement(LocalReactiveDocument, { source: '# Typed host', urlPolicy: policy });
const result = compileLocal('# Controlled host');
if (result.ok) {
  const runtime = createLocalRuntime(result.document);
  createElement(LocalDocumentView, { document: result.document, runtime });
  runtime.dispose();
}
void view;
`);
  const reactTsconfig = path.join(reactConsumer, 'tsconfig.json');
  await writeFile(reactTsconfig, JSON.stringify({
    compilerOptions: {
      target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, skipLibCheck: false, noEmit: true, types: [], jsx: 'react-jsx',
    },
    include: ['react-types.tsx'],
  }, null, 2));
  await run('React type fixture', process.execPath, [tsc, '--project', reactTsconfig, '--pretty', 'false'], reactConsumer);

  for (const file of ['index.html', 'main.jsx']) {
    await copyFile(path.join(installedCore, 'examples/integration/react', file), path.join(reactConsumer, file));
  }
  const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  await run('standalone React example build', process.execPath, [viteCli, 'build'], reactConsumer);

  await writeFile(path.join(reactConsumer, 'editor-ssr.mjs'), `import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
const html = renderToString(createElement(ReactiveMarkdownEditor, {
  value: '# Packed editor\\n\\n<script>literal</script>', onChange() {}, locale: 'zh', theme: 'dark',
}));
assert.ok(html.includes('Packed editor'));
assert.ok(html.includes('textarea'));
assert.ok(!html.includes('<script>literal</script>'));
console.log('PASS packed editor import and SSR');
`);
  await run('packed editor SSR', process.execPath, [path.join(reactConsumer, 'editor-ssr.mjs')], reactConsumer);
  const editorCssTarget = exportTarget(installedPkg, './editor/styles.css');
  assert.equal(editorCssTarget, './dist-library/reactive-md-editor.css');
  assert.ok((await stat(path.resolve(installedCore, editorCssTarget))).size > 0);
  await writeFile(path.join(reactConsumer, 'main.jsx'), `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactiveMarkdownEditor } from 'reactive-md/editor';
import 'reactive-md/editor/styles.css';
function App() {
  const [source, setSource] = useState('# Packed editor');
  return <ReactiveMarkdownEditor value={source} onChange={setSource} locale="zh" />;
}
createRoot(document.getElementById('root')).render(<App />);
`);
  await run('standalone editor consumer build', process.execPath, [viteCli, 'build'], reactConsumer);

  // Retain the exact archive exercised above, so release preparation produces
  // an installable candidate with a digest instead of discarding its evidence.
  const candidateDirectory = path.join(projectRoot, 'artifacts', 'release-package');
  await mkdir(candidateDirectory, { recursive: true });
  const candidateName = path.basename(core.entry.filename);
  await copyFile(core.tarball, path.join(candidateDirectory, candidateName));
  const candidateBytes = await readFile(core.tarball);
  await writeFile(path.join(candidateDirectory, 'package-verification.json'), JSON.stringify({
    name: core.entry.name,
    version: core.entry.version,
    filename: candidateName,
    sha256: createHash('sha256').update(candidateBytes).digest('hex'),
    integrity: core.entry.integrity,
    verifiedAt: new Date().toISOString(),
    checks: ['offline core and React install', 'strict core/React/editor types', 'combined capabilities', 'CLI static and interactive HTML', 'SSR including editor', 'standalone integration example', 'editor CSS and independent consumer build'],
  }, null, 2), 'utf8');
  console.log(`PASS packed tarball installs offline, isolated core and React types compile, SSR and standalone examples work, and ${documentationLinks} packaged documentation links resolve`);
  console.log(`Verified release candidate: ${path.relative(projectRoot, path.join(candidateDirectory, candidateName))}`);
} finally {
  if (tempRoot) {
    assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()), 'Cleanup must remain directly inside the temporary directory');
    assert.ok(path.basename(tempRoot).startsWith('reactive-md-packed-'), 'Cleanup must target this check\'s own temporary directory');
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
