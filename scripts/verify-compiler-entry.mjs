import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { isBuiltin, register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { moduleSpecifiers } from './module-specifiers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist-library');
const artifacts = path.join(root, 'artifacts', 'claude-task1');
const runtimeEntries = {
  compiler: path.join(dist, 'reactive-md-compiler.js'),
  standard: path.join(dist, 'reactive-md-compiler-standard.js'),
};
const declarationEntries = {
  compiler: path.join(dist, 'types', 'compiler', 'index.d.ts'),
  standard: path.join(dist, 'types', 'compiler', 'standard.d.ts'),
};
const m1ResidualMarkers = [
  ['@lezer', 'Lezer'],
  ['katex', 'KaTeX'],
  ['parse5', 'parse5'],
  ['remark', 'GFM/remark'],
  ['unified', 'unified'],
  ['highlight.js', 'highlight.js'],
  ['lowlight', 'lowlight'],
  ['elkjs', 'ELK'],
];

function requireFile(file, label) {
  assert.ok(existsSync(file), `${label} is missing: ${file}. Run "npm run build:lib" first.`);
  assert.ok(statSync(file).isFile(), `${label} is not a file: ${file}.`);
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

async function inspectRuntimeGraph(entry) {
  const files = [];
  const externals = [];
  const pending = [entry];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    const source = await readFile(file, 'utf8');
    assert.ok(!/\bnew\s+(?:Shared)?Worker\b/.test(source), `Worker construction leaked into ${relative(file)}`);
    assert.ok(!source.includes('data-rmd-theme'), `Theme CSS protocol leaked into ${relative(file)}`);
    assert.ok(!/import\s*\(\s*(?!["'`])/.test(source), `Unresolvable dynamic import in ${relative(file)}`);
    const specifiers = moduleSpecifiers(source, path.basename(file));
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) {
        externals.push({ file: relative(file), specifier });
        continue;
      }
      assert.ok(!specifier.endsWith('.css'), `CSS import ${specifier} reached ${relative(file)}`);
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(existsSync(target), `Missing shared chunk ${specifier} imported by ${relative(file)}`);
      assert.ok(target.startsWith(dist + path.sep), `Bundle import ${specifier} leaves dist-library (${relative(file)})`);
      pending.push(target);
    }
  }
  assert.deepEqual(externals, [], `Compiler bundle must be self-contained, found ${JSON.stringify(externals)}`);
  files.sort();
  return files;
}

function declarationCandidates(specifier, from) {
  return [
    new URL(`${specifier}.d.ts`, from),
    new URL(specifier.replace(/\.js$/, '.d.ts'), from),
    new URL(`${specifier}/index.d.ts`, from),
  ];
}

function forbiddenTypeSpecifier(specifier) {
  return /^(?:react(?:-dom)?|@types\/react(?:-dom)?|@codemirror|vite)(?:\/|$)/.test(specifier)
    || /^node:/.test(specifier)
    || /(^|\/)(?:worker|session|incremental|retention|editor|standalone)(\/|\.|$)/.test(specifier)
    || /(^|\/)react(\/|\.|$)/.test(specifier);
}

async function inspectDeclarationGraph(entry) {
  const files = [];
  const externals = [];
  const pending = [pathToFileURL(entry)];
  const seen = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    files.push(fileURLToPath(url));
    const source = await readFile(fileURLToPath(url), 'utf8');
    for (const specifier of moduleSpecifiers(source, 'module.d.ts')) {
      assert.ok(!forbiddenTypeSpecifier(specifier), `Forbidden type dependency ${specifier} in ${relative(fileURLToPath(url))}`);
      if (!specifier.startsWith('.')) {
        externals.push({ file: relative(fileURLToPath(url)), specifier });
        continue;
      }
      const target = declarationCandidates(specifier, url).find((candidate) => {
        try { return statSync(fileURLToPath(candidate)).isFile(); } catch { return false; }
      });
      assert.ok(target, `Missing declaration ${specifier} imported by ${relative(fileURLToPath(url))}`);
      pending.push(target);
    }
  }
  files.sort();
  return files;
}

function residualDependencies(sources) {
  const text = sources.join('\n').toLowerCase();
  return m1ResidualMarkers.filter(([marker]) => text.includes(marker)).map(([, label]) => label);
}

async function verifyBrowserConsumption() {
  const consumer = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-compiler-browser-'));
  const entry = path.join(consumer, 'entry.js');
  await writeFile(entry, [
    "import { createCompiler } from 'reactive-md/compiler';",
    "import { createStandardCompiler } from 'reactive-md/compiler/standard';",
    "const minimal = createCompiler().compile('# Browser minimal\\n\\nParagraph.');",
    "const standard = createStandardCompiler().compile('<number bind=\"count\" label=\"Count\" initial=\"3\">');",
    'globalThis.__reactiveMdCompilerEntry = { minimal, standard };',
  ].join('\n'));
  const outDir = path.join(consumer, 'dist');
  await build({
    configFile: false,
    root: consumer,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{
      name: 'compiler-consumer-reject-node-builtins',
      resolveId(id) {
        if (isBuiltin(id)) throw new Error(`Node builtin in browser compiler consumer: ${id}`);
      },
    }],
    resolve: {
      alias: [
        { find: /^reactive-md\/compiler\/standard$/, replacement: runtimeEntries.standard },
        { find: /^reactive-md\/compiler$/, replacement: runtimeEntries.compiler },
      ],
    },
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      target: 'es2022',
      lib: { entry, formats: ['iife'], name: 'ReactiveMdCompilerConsumer', fileName: () => 'consumer.js' },
    },
  });
  const code = await readFile(path.join(outDir, 'consumer.js'), 'utf8');
  assert.ok(code.length > 0, 'Browser production build produced no code');
  assert.ok(!moduleSpecifiers(code).some(isBuiltin), 'Browser production bundle imports a Node builtin');
  assert.ok(!/\brequire\s*\(/.test(code), 'Browser production bundle contains require()');
  assert.ok(!/\bprocess\s*\.\s*(?:env|platform|versions|argv)\b/.test(code), 'Browser production bundle reads process');

  const context = vm.createContext({
    console,
    performance,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    crypto,
  });
  vm.runInContext(code, context, { filename: 'compiler-production-browser.js', timeout: 15000 });
  const compiled = context.__reactiveMdCompilerEntry;
  assert.ok(compiled, 'Browser production bundle did not run');
  assert.equal(compiled.minimal.ok, true, JSON.stringify(compiled.minimal.diagnostics));
  assert.equal(compiled.standard.ok, true, JSON.stringify(compiled.standard.diagnostics));
  return { bytes: code.length, consumer };
}

const blockedLoader = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-compiler-loader-'));
const loaderFile = path.join(blockedLoader, 'blocked-loader.mjs');
await writeFile(loaderFile, `
const blocked = [
  /^react(?:$|\\/)/,
  /^react-dom(?:$|\\/)/,
  /^scheduler(?:$|\\/)/,
  /^@codemirror(?:$|\\/)/,
  /^vite(?:$|\\/)/,
  /^vitest(?:$|\\/)/,
  /^node:/,
  /^file:.*\\.css(?:\\?|$)/,
  /(?:^|\\/)(?:worker|incremental|session|retention)(?:\\.js|\\/|$)/,
  /(?:^|\\/)theme\\.js$/,
  /(?:^|\\/)react\\//,
  /(?:^|\\/)editor\\//,
];
export async function resolve(specifier, context, nextResolve) {
  if (blocked.some((pattern) => pattern.test(specifier))) {
    throw new Error('Blocked module in compiler isolation check: ' + specifier);
  }
  return nextResolve(specifier, context);
}
`);

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.deepEqual(pkg.exports['./compiler'], {
  types: './dist-library/types/compiler/index.d.ts',
  import: './dist-library/reactive-md-compiler.js',
});
assert.deepEqual(pkg.exports['./compiler/standard'], {
  types: './dist-library/types/compiler/standard.d.ts',
  import: './dist-library/reactive-md-compiler-standard.js',
});
for (const [name, file] of Object.entries(runtimeEntries)) requireFile(file, `Compiler ${name} runtime entry`);
for (const [name, file] of Object.entries(declarationEntries)) requireFile(file, `Compiler ${name} declaration entry`);

const runtimeGraph = {};
const runtimeSources = {};
for (const [name, entry] of Object.entries(runtimeEntries)) {
  const files = await inspectRuntimeGraph(entry);
  runtimeGraph[name] = files.map(relative);
  runtimeSources[name] = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
}
const declarationGraph = {};
for (const [name, entry] of Object.entries(declarationEntries)) {
  declarationGraph[name] = (await inspectDeclarationGraph(entry)).map(relative);
}

/**
 * The minimal entry installs no preset. Its runtime and type graph must not
 * reach the default component manifests or authoring copy; the standard entry
 * keeps both, proving the markers are meaningful.
 */
const minimalPresetMarkers = [
  ['reactive-md/${', 'default component manifest ids'],
  ['Input controls', 'default authoring copy'],
];
for (const [marker, label] of minimalPresetMarkers) {
  assert.ok(
    !runtimeSources.compiler.includes(marker),
    `Minimal compiler runtime graph must not include ${label} (found "${marker}")`,
  );
}
assert.ok(
  runtimeSources.standard.includes('reactive-md/${') && runtimeSources.standard.includes('Input controls'),
  'The standard compiler must still carry the default preset and its authoring copy',
);
/**
 * Specialized abilities are installed by the full assembly only. The minimal
 * core keeps CommonMark, RMD structure, expressions, bindings and budgets.
 */
const minimalCapabilityMarkers = [
  ['@lezer', 'Lezer block planning'],
  ['parse5', 'native HTML parsing'],
  ['remark-gfm', 'GFM syntax'],
  ['katex', 'KaTeX display'],
  ['sampleImplicit', 'plot curve sampling'],
];
for (const [marker, label] of minimalCapabilityMarkers) {
  assert.ok(
    !runtimeSources.compiler.toLowerCase().includes(marker),
    `Minimal compiler runtime graph must not include ${label} (found "${marker}")`,
  );
}
assert.ok(
  runtimeSources.standard.toLowerCase().includes('@lezer') && runtimeSources.standard.toLowerCase().includes('parse5'),
  'The standard compiler must still carry GFM, native HTML and Lezer planning',
);
const presetDeclarationFiles = declarationGraph.compiler.filter(
  (file) => /(?:^|\/)presets\//.test(file) || /default-(?:components|semantics|authoring)\.d\.ts$/.test(file),
);
assert.deepEqual(
  presetDeclarationFiles,
  [],
  `Minimal compiler declaration graph must not include default presets: ${presetDeclarationFiles.join(', ')}`,
);

const browser = await verifyBrowserConsumption();

async function expectBlocked(specifier) {
  let caught;
  try {
    await import(specifier);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, `The isolation loader allowed ${specifier}`);
  assert.match(caught.message, /Blocked module/, `Unexpected isolation error for ${specifier}: ${caught.message}`);
}

register(pathToFileURL(loaderFile).href);
assert.equal(typeof globalThis.document, 'undefined', 'The isolation check must run without DOM globals');
assert.equal(typeof globalThis.window, 'undefined', 'The isolation check must run without DOM globals');
await expectBlocked('react');
await expectBlocked('react-dom');
await expectBlocked('@codemirror/state');
await expectBlocked('node:fs');

const compilerEntry = await import('reactive-md/compiler');
const standardEntry = await import('reactive-md/compiler/standard');
assert.equal(typeof compilerEntry.createCompiler, 'function');
assert.equal(typeof compilerEntry.CompilerConfigurationError, 'function');
assert.equal(typeof standardEntry.createStandardCompiler, 'function');
assert.throws(
  () => compilerEntry.createCompiler({ limits: { maxSyntaxNodes: 0 } }),
  (error) => error instanceof compilerEntry.CompilerConfigurationError,
  'Compiler factory must throw CompilerConfigurationError',
);
const minimal = compilerEntry.createCompiler().compile('# Node ESM compiler entry\n\nParagraph.');
assert.equal(minimal.ok, true, JSON.stringify(minimal.diagnostics));
assert.equal(minimal.document.syntax, 'local');
const standard = standardEntry.createStandardCompiler().compile('<number bind="count" label="Count" initial="2">');
assert.equal(standard.ok, true, JSON.stringify(standard.diagnostics));
assert.equal(standard.document.bindings.count.initial, 2);
assert.equal(standard.status, 'valid');
assert.ok(Object.isFrozen(standard.program.nodes));
const damagedSource = '<alert>\n{{ missing }}\n\n## After\n\nReadable';
const recovered = standardEntry.createStandardCompiler({ strict: false }).compile(damagedSource);
assert.equal(recovered.status, 'recovered', JSON.stringify(recovered.diagnostics));
assert.ok(recovered.recoveries.length > 0);
assert.ok(Object.isFrozen(recovered.program));
assert.equal(standardEntry.createStandardCompiler().compile(damagedSource).status, 'failed');

const residual = residualDependencies(Object.values(runtimeSources));
const minimalResidual = residualDependencies([runtimeSources.compiler]);
const report = {
  status: 'passed',
  createdAt: new Date().toISOString(),
  entries: {
    runtime: Object.fromEntries(Object.entries(runtimeEntries).map(([name, file]) => [name, relative(file)])),
    declarations: Object.fromEntries(Object.entries(declarationEntries).map(([name, file]) => [name, relative(file)])),
  },
  runtimeGraph,
  declarationGraph,
  browser,
  isolation: {
    dom: false,
    blockedModules: ['react', 'react-dom', 'scheduler', '@codemirror/*', 'node:*', 'CSS', 'worker/session/theme modules'],
    directEsmCompile: true,
  },
  residualM1Dependencies: residual,
  residualByEntry: Object.fromEntries(Object.entries(runtimeSources).map(([name, source]) => [name, residualDependencies([source])])),
  m4Todos: [
    'CommonMark (unified/remark-parse) stays in the core body parser by design.',
    'GFM syntax, native HTML, Lezer planning, KaTeX display and plot sampling stay in the standard assembly.',
    'Verify the final packed tarball in a clean consumer and repeat the declaration graph check.',
  ],
};
await mkdir(artifacts, { recursive: true });
await writeFile(path.join(artifacts, 'compiler-entry-report.json'), JSON.stringify(report, null, 2));
console.log(`PASS compiler entry packaging and isolation (browser bundle ${browser.bytes} bytes, minimal residual: ${minimalResidual.join(', ') || 'none'}, all entries residual: ${residual.join(', ') || 'none'})`);
