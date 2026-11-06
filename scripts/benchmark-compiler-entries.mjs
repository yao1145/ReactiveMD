#!/usr/bin/env node
/**
 * Loading and compile cost for the two single-pass compiler entries.
 *
 * Run after `npm run build:lib`. Reports cold import time, warm compile time
 * and heap growth for a representative document. Use `--json` for raw data.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist-library');
const json = process.argv.includes('--json');

const markdown = [
  '# Report',
  '',
  'A paragraph with **bold**, *italic* and a [link](https://example.com).',
  '',
  '- first item',
  '- second item',
  '',
  '> A quote with `inline code`.',
  '',
  '```js',
  'const value = 1;',
  '```',
  '',
  'Budget: {{ 1 + 2 }}',
].join('\n');

const interactive = [
  '# Interactive',
  '',
  '<number bind="count" label="Count" initial="2" min="0" max="10">',
  '',
  'Value: {{ count }}',
  '',
  '<computed name="double" value="{{ count * 2 }}">',
  '',
  'Double: {{ double }}',
  '',
  '<toggle bind="on" label="On">',
  '',
  '<if when="{{ on }}">',
  'Visible',
  '</if>',
].join('\n');

function bundleBytes(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s*["'](\.\/[^"']+)["']/g)) {
      pending.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  return [...seen].reduce((sum, file) => sum + statSync(file).size, 0);
}

function heap() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return process.memoryUsage().heapUsed;
}

async function measure(name, entry, factory, source, iterations) {
  const started = performance.now();
  const module = await import(pathToFileURL(entry).href);
  const importMs = performance.now() - started;
  const compiler = module[factory]();
  for (let index = 0; index < 5; index += 1) compiler.compile(source);
  const before = heap();
  const begin = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const result = compiler.compile(source);
    if (!result.ok && name === 'standard') throw new Error(JSON.stringify(result.diagnostics));
  }
  const compileMs = (performance.now() - begin) / iterations;
  const heapGrowth = Math.max(0, heap() - before);
  return { name, importMs, compileMs, heapGrowth, bundleBytes: bundleBytes(entry) };
}

const iterations = Number(process.env.RMD_BENCH_ITERATIONS ?? 30);
const minimal = await measure(
  'minimal',
  path.join(dist, 'reactive-md-compiler.js'),
  'createCompiler',
  markdown,
  iterations,
);
const standard = await measure(
  'standard',
  path.join(dist, 'reactive-md-compiler-standard.js'),
  'createStandardCompiler',
  interactive,
  iterations,
);

if (json) {
  console.log(JSON.stringify({ iterations, results: [minimal, standard] }, null, 2));
} else {
  for (const result of [minimal, standard]) {
    console.log(
      `${result.name.padEnd(8)} import ${result.importMs.toFixed(1)} ms | `
      + `compile ${result.compileMs.toFixed(3)} ms/op | `
      + `heap +${(result.heapGrowth / 1024).toFixed(0)} KiB | `
      + `bundle ${result.bundleBytes} bytes`,
    );
  }
}
