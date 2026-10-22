import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { compileLocal, createLocalRuntime, compileLatex, samplePlot } from 'reactive-md';

const args = process.argv.slice(2);
let iterations = 20;
let output = 'artifacts/benchmark.json';
for (let index = 0; index < args.length; index++) {
  const option = args[index];
  const value = args[++index];
  if (option === '--iterations' && /^\d+$/.test(value ?? '')) iterations = Number(value);
  else if (option === '--output' && value) output = value;
  else throw new Error('Usage: npm run benchmark -- [--iterations 1..1000] [--output path.json]');
}
assert.ok(iterations >= 1 && iterations <= 1000, 'iterations must be between 1 and 1000');

const results = [];
function measure(name, run, details = {}) {
  for (let index = 0; index < 3; index++) run();
  const timings = [];
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    run();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const percentile = fraction => Number(timings[Math.max(0, Math.ceil(timings.length * fraction) - 1)].toFixed(6));
  results.push({ name, iterations, medianMs: percentile(0.5), p95Ms: percentile(0.95), ...details });
}
function compile(source) {
  const result = compileLocal(source);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.document;
}

const slider = '<slider bind="n" label="Parameter" initial="2" min="0" max="100">';
const documents = [
  ['pricing', await readFile(new URL('../examples/local/pricing.reactive.md', import.meta.url), 'utf8')],
  ['table-250-rows', `${slider}\n\n<table label="Costs">\n| Item | Cost |\n| --- | --- |\n${Array.from({ length: 250 }, (_, index) => `| Item ${index + 1} | {{ n * ${index + 1} }} |`).join('\n')}\n</table>`],
  ['article-100-sections', `${slider}\n\n${Array.from({ length: 100 }, (_, index) => `## Section ${index + 1}\n\nA local document with **Markdown**, a computed value {{ n * ${index + 1} }}, and ordinary explanatory text.\n\n- Read the value\n- Adjust the parameter\n`).join('\n')}`],
];
for (const [name, source] of documents) {
  measure(`compile:${name}`, () => compile(source), { sourceCharacters: source.length });
}

const document = compile(`${slider}\n\nResult: {{ n * n + 5 }}.`);
const input = document.nodes.find(node => node.name === 'slider');
assert.ok(input, 'benchmark slider must exist');
const runtime = createLocalRuntime(document);
try {
  let nextValue = 0;
  measure('runtime:100-updates-and-evaluations', () => {
    for (let index = 0; index < 100; index++) {
      nextValue = (nextValue + 1) % 101;
      assert.deepEqual(runtime.set(input, nextValue), []);
      assert.equal(runtime.evaluate('n * n + 5'), nextValue * nextValue + 5);
    }
  }, { updatesPerIteration: 100 });
} finally { runtime.dispose(); }

const curves = [String.raw`y = a \sin x`, 'y = x^2 / 10', String.raw`y = \frac{1}{x - 0.09}`].map(compileLatex);
measure('plot:3-curves-200-samples', () => {
  const budget = { steps: 0, limit: 2_000_000 };
  for (const curve of curves) {
    const sample = samplePlot(curve, { a: 2 }, -10, 10, 200, budget);
    assert.ok(sample.points.length >= 200);
  }
}, { curves: 3, samplesPerCurve: 200 });

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const report = {
  generatedAt: new Date().toISOString(), packageVersion: version,
  environment: { node: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model },
  methodology: 'Three warmups per case; measured wall time includes validation. Node core compilation, runtime and sampling only; browser rendering and input-to-paint latency are not measured. Percentiles are observations, not pass/fail thresholds.',
  results,
};
const destination = resolve(output);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.table(results.map(({ name, medianMs, p95Ms }) => ({ name, medianMs, p95Ms })));
console.log(`Benchmark report: ${destination}`);
