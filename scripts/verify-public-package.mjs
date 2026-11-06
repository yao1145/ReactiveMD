import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  const packed = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer]))[0];
  assert.ok(!packed.files.some(f => /^(?:src|demo|editor|tests)\//.test(f.path)), 'Package contains repository source');
  assert.ok(!packed.files.some(f => /(?:types\/editor\/|reactive-md-(?:editor|codemirror))/.test(f.path)), 'Package still contains editor artifacts');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: {
    'reactive-md': `file:${join(consumer, packed.filename).replaceAll('\\', '/')}`,
    react: pkg.devDependencies.react, 'react-dom': pkg.devDependencies['react-dom'],
    '@types/react': pkg.devDependencies['@types/react'], '@types/react-dom': pkg.devDependencies['@types/react-dom'],
    typescript: pkg.devDependencies.typescript,
  }}));
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], consumer);
  writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { createStandardCompiler } from 'reactive-md/compiler/standard';
import { createCompiler } from 'reactive-md/compiler';
import { compileLocal, startLocalCompileWorker, localCompileOptionsKey } from 'reactive-md';
import { analyzeLocalSource, insertTemplate, getNativeComponentCatalog } from 'reactive-md/authoring';
import { renderToStaticMarkup } from 'react-dom/server';
import * as server from 'reactive-md/react/server';
assert.equal(createStandardCompiler().compile('# Package boundary').status, 'valid');
assert.equal(createCompiler().compile('plain text').status, 'valid');
assert.equal(compileLocal('plain text').ok, true);
assert.equal(typeof startLocalCompileWorker, 'function');
assert.equal(typeof localCompileOptionsKey({strict:false}), 'string');
assert.ok(analyzeLocalSource('hello'));
assert.equal(typeof insertTemplate, 'function');
assert.ok(getNativeComponentCatalog());
assert.ok(Object.keys(server).length);
assert.equal(typeof renderToStaticMarkup, 'function');
for (const entry of ['reactive-md/sdk','reactive-md/presets/default','reactive-md/export']) await import(entry);
console.log('Packed public compiler, authoring, Worker, SDK, React/SSR and export boundaries passed.');
`);
  process.stdout.write(run(process.execPath, ['smoke.mjs'], consumer));
  writeFileSync(join(consumer, 'consumer.ts'), `import {createCompiler} from 'reactive-md/compiler';\nimport {createStandardCompiler} from 'reactive-md/compiler/standard';\nimport {analyzeLocalSource, insertTemplate} from 'reactive-md/authoring';\nimport {startLocalCompileWorker} from 'reactive-md';\ncreateCompiler().compile('hello'); createStandardCompiler().compile('hello'); analyzeLocalSource('hello'); void insertTemplate; void startLocalCompileWorker;\n`);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2022', module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:false},include:['consumer.ts']}));
  run(process.execPath, [resolve(consumer, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
  console.log('Packed NodeNext declarations passed in an independent consumer.');
} finally {
  // Keep failed consumers for diagnosis; successful runs can be removed by the OS temp policy.
  console.log(`Consumer directory: ${consumer}`);
}
