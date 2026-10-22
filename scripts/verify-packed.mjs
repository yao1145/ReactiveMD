import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const projectPkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
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
    'docs/local-integration.md',
    'examples/local/counter.reactive.md',
    'examples/conformance/local-draft-1.json',
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

  // The React entry is allowed to import react; the core entry graph must be self-contained.
  for (const file of (await readdir(path.join(installedCore, 'dist-library')))
    .filter(name => name.endsWith('.js') && name !== 'reactive-md-react.js')) {
    const source = await readFile(path.join(installedCore, 'dist-library', file), 'utf8');
    const imports = [
      ...[...source.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
      ...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]),
    ];
    for (const specifier of imports) {
      assert.ok(specifier.startsWith('.'), `${file} imports ${specifier}; the core tarball must be self-contained`);
    }
  }

  await writeFile(
    path.join(coreConsumer, 'core-api.mjs'),
    `import assert from 'node:assert/strict';
import { compileLocal, createLocalRuntime, LOCAL_SYNTAX_VERSION } from 'reactive-md';

assert.equal(typeof compileLocal, 'function', 'compileLocal must be exported from the core tarball');
assert.equal(typeof createLocalRuntime, 'function', 'createLocalRuntime must be exported from the core tarball');
assert.equal(LOCAL_SYNTAX_VERSION, 'local-draft-1');

const result = compileLocal('# Packed core');
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
const runtime = createLocalRuntime(result.document);
assert.equal(runtime.snapshot().revision, 0);
runtime.dispose();
console.log('PASS core API without React');
`,
  );
  await run('core API fixture', process.execPath, [path.join(coreConsumer, 'core-api.mjs')], coreConsumer);
  await run('standalone Node example', process.execPath, [path.join(installedCore, 'examples/integration/core/index.mjs')], coreConsumer);

  await writeFile(
    path.join(coreConsumer, 'core-types.ts'),
    `import {
  compileLocal,
  createLocalRuntime,
  LOCAL_SYNTAX_VERSION,
  type LocalCompileResult,
  type LocalRuntime,
} from 'reactive-md';

const result: LocalCompileResult = compileLocal('# Packed types');
if (!result.ok) {
  throw new Error(JSON.stringify(result.diagnostics));
}
const runtime: LocalRuntime = createLocalRuntime(result.document);
runtime.dispose();
const version: 'local-draft-1' = LOCAL_SYNTAX_VERSION;
void version;
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

assert.equal(typeof LocalReactiveDocument, 'function', 'LocalReactiveDocument must be exported by the React subpath');
assert.equal(typeof LocalDocumentView, 'function', 'LocalDocumentView must be exported by the React subpath');

const html = renderToString(createElement(LocalReactiveDocument, { source: '# Packed SSR' }));
assert.ok(html.length > 0, 'SSR must render markup');
assert.ok(html.includes('Packed SSR'), 'SSR must render the Markdown source');
console.log('PASS React subpath and SSR');
`,
  );
  await run('React SSR fixture', process.execPath, [path.join(reactConsumer, 'react-ssr.mjs')], reactConsumer);

  await writeFile(path.join(reactConsumer, 'react-types.tsx'), `import { createElement } from 'react';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import { LocalDocumentView, LocalReactiveDocument, type LocalUrlPolicy } from 'reactive-md/react';

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

  console.log(`PASS packed tarball installs offline, isolated core and React types compile, SSR and standalone examples work, and ${documentationLinks} packaged documentation links resolve`);
} finally {
  if (tempRoot) {
    assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()), 'Cleanup must remain directly inside the temporary directory');
    assert.ok(path.basename(tempRoot).startsWith('reactive-md-packed-'), 'Cleanup must target this check\'s own temporary directory');
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
