import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const self = fileURLToPath(import.meta.url);
const slider = '<slider bind="n" label="Parameter" initial="2" min="0" max="100">';
const raised = { limits: { maxSyntaxNodes: 250_000 } };
export function fixture(kind, size) {
  if (kind === 'plain') return '普通文字 abc '.repeat(Math.ceil(size / 9)).slice(0, size);
  if (kind === 'article') return slider + '\n\n' + Array.from({ length: size }, (_, i) =>
    `## Section ${i + 1}\n\nA local document with **Markdown**, a computed value {{ n * ${i + 1} }}, and ordinary explanatory text.\n\n- Read the value\n- Adjust the parameter\n`).join('\n');
  if (kind === 'paragraphs') return 'word\n\n'.repeat(size);
  if (kind === 'formatted-paragraphs') return 'A **bold** paragraph with _emphasis_ and ordinary text.\n\n'.repeat(size);
  if (kind === 'controls') return Array.from({ length: size }, (_, i) => `<slider bind="v${i}" label="Value ${i}" initial="2" min="0" max="100">`).join('\n');
  if (kind === 'shared-controls') return '<slider bind="same" label="Shared" min="0" max="100">\n'.repeat(size);
  if (kind === 'conflicting-controls') return Array.from({ length: size }, (_, i) => `<slider bind="same" label="Shared" initial="${i % 2}" min="0" max="100">`).join('\n');
  if (kind === 'expressions') return slider + '\n\n' + Array.from({ length: size }, (_, i) => `Value {{ n * ${i + 1} }}.\n\n`).join('');
  if (kind === 'containers') return '<panel>\n\n'.repeat(size) + 'text\n\n' + '</panel>\n\n'.repeat(size);
  if (kind === 'unclosed') return '<panel>\n\n'.repeat(size) + 'text';
  if (kind === 'markdown-depth') return '> '.repeat(size) + 'text';
  if (kind === 'math') return '$x^2 + 2x + 1$\n\n'.repeat(size);
  if (kind === 'table') return `${slider}\n\n<table label="Costs">\n| Item | Cost |\n| --- | --- |\n${Array.from({ length: size }, (_, i) => `| Item ${i} | {{ n * ${i + 1} }} |`).join('\n')}\n</table>`;
  if (kind === 'computed-chain') return '<slider bind="v0" label="Seed" initial="2">\n' + Array.from({ length: size }, (_, i) => `<computed name="v${i + 1}" value="{{ v${i} + 1 }}">`).join('\n') + `\n\n{{ v${size} }}`;
  throw new Error(`Unknown fixture ${kind}`);
}

const cases = [
  ...[10_000, 100_000, 500_000, 1_000_000, 1_000_001].map(size => ({ kind: 'plain', size })),
  ...[10, 100, 600, 2_000].map(size => ({ kind: 'article', size })),
  { kind: 'article', size: 2_000, options: raised },
  ...[1_000, 5_000, 10_000, 10_001, 12_000].map(size => ({ kind: 'controls', size })),
  { kind: 'controls', size: 10_000, options: raised },
  { kind: 'controls', size: 12_000, options: raised },
  { kind: 'shared-controls', size: 5_000 },
  { kind: 'conflicting-controls', size: 5_000 },
  ...[1_000, 5_000].map(size => ({ kind: 'expressions', size })),
  { kind: 'expressions', size: 5_000, options: raised },
  ...[1_000, 5_000, 10_000, 20_000].map(size => ({ kind: 'paragraphs', size, samples: 5, warmups: 1 })),
  { kind: 'paragraphs', size: 100_000, samples: 3, warmups: 1 },
  { kind: 'paragraphs', size: 100_000, options: raised, samples: 3, warmups: 1 },
  { kind: 'formatted-paragraphs', size: 5_000, samples: 5, warmups: 1 },
  { kind: 'formatted-paragraphs', size: 5_000, options: raised, samples: 5, warmups: 1 },
  ...[50, 100, 101, 1_000].map(size => ({ kind: 'containers', size })),
  { kind: 'unclosed', size: 1_000 },
  ...[100, 500, 1_000, 1_500, 2_000, 5_000].map(size => ({ kind: 'markdown-depth', size })),
  { kind: 'math', size: 1_000 },
  { kind: 'table', size: 1_000 },
  ...[1_000, 5_000].map(size => ({ kind: 'computed-chain', size })),
];
for (const c of cases) c.id = `${c.kind}-${c.size}${c.options ? '-raised' : ''}`;

const round = n => Number(n.toFixed(3));
const memory = () => ({ ...process.memoryUsage(), maxRssBytes: process.resourceUsage().maxRSS * 1024 });
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = f => round(sorted[Math.ceil(sorted.length * f) - 1]);
  return { samples: samples.map(round), count: samples.length, medianMs: p(0.5), p95Ms: p(0.95), maxMs: p(1) };
}
function describe(result) {
  let nodes = 0, components = 0, maxDepth = 0;
  const stack = (result.document?.nodes ?? []).map(n => [n, 1]);
  while (stack.length) {
    const [node, depth] = stack.pop();
    nodes++;
    if (node.type === 'component') components++;
    maxDepth = Math.max(maxDepth, depth);
    for (const child of node.children ?? []) stack.push([child, depth + 1]);
  }
  return { ok: result.ok, nodes, components, maxDepth,
    bindings: Object.keys(result.document?.bindings ?? {}).length,
    computations: Object.keys(result.document?.computations ?? {}).length,
    diagnostics: result.diagnostics.length,
    diagnosticKeys: [...new Set(result.diagnostics.map(d => d.messageKey ?? d.code))],
    firstDiagnostic: result.diagnostics[0]?.message };
}

async function child(c) {
  const importStart = performance.now();
  const { compileLocal } = await import(c.compilerModule ?? 'reactive-md');
  const importMs = performance.now() - importStart;
  global.gc();
  const imported = memory();
  const source = fixture(c.kind, c.size);
  // Materialize strings before timing and before the source baseline.
  const utf8Bytes = Buffer.byteLength(source);
  global.gc();
  const sourceBaseline = memory();
  process.send({ ...c, phase: 'first-compile-running', sourceCharacters: source.length, utf8Bytes,
    importMs: round(importMs), memory: { imported, sourceBaseline } });
  let result;
  const compile = () => {
    const start = performance.now();
    result = compileLocal(source, c.options);
    return performance.now() - start;
  };
  const coldMs = compile();
  const firstCompileEnd = memory();
  global.gc();
  const resultRetained = memory();
  const outcome = describe(result);
  result = null;
  global.gc();
  const firstResultReleased = memory();
  process.send({ ...c, phase: 'first-compile-completed', sourceCharacters: source.length,
    utf8Bytes, importMs: round(importMs), coldMs: round(coldMs), outcome,
    memory: { imported, sourceBaseline, firstCompileEnd, resultRetained, firstResultReleased } });
  if (c.once) return;
  if (c.soak) {
    const checkpoints = [];
    const times = [];
    for (let i = 1; i <= c.soak; i++) {
      // Retain the previous preview while its replacement is being compiled.
      const start = performance.now();
      result = compileLocal(source + `\n\nRevision ${i}`, c.options);
      times.push(performance.now() - start);
      assert.equal(result.ok, outcome.ok);
      if (i % 10 === 0) {
        global.gc();
        checkpoints.push({ iteration: i, ...memory() });
      }
    }
    result = null;
    global.gc();
    process.send({ ...c, sourceCharacters: source.length, outcome, timing: summary(times), checkpoints,
      memory: { imported, sourceBaseline, firstCompileEnd, resultRetained, firstResultReleased, finalReleased: memory() } });
    return;
  }
  for (let i = 0; i < (c.warmups ?? 2); i++) { compile(); result = null; }
  const samples = [];
  for (let i = 0; i < (c.samples ?? 10); i++) {
    result = null;
    samples.push(compile());
    assert.deepEqual(describe(result), outcome, 'Compilation outcome changed across iterations');
  }
  const measuredEnd = memory();
  let cloneMs = null;
  let cloneError = null;
  if (result.ok) {
    const start = performance.now();
    try {
      let copy = structuredClone(result);
      cloneMs = performance.now() - start;
      assert.deepEqual(describe(copy), outcome);
      copy = null;
    } catch (error) {
      cloneError = { name: error.name, message: error.message };
    }
  }
  result = null;
  global.gc();
  const finalReleased = memory();
  const report = { ...c, sourceCharacters: source.length, utf8Bytes, importMs: round(importMs), coldMs: round(coldMs),
    timing: summary(samples), outcome, cloneMs: cloneMs === null ? null : round(cloneMs), cloneError,
    memory: { imported, sourceBaseline, firstCompileEnd, resultRetained, firstResultReleased, measuredEnd, finalReleased },
    resultHeapDeltaBytes: resultRetained.heapUsed - firstResultReleased.heapUsed,
    releasedHeapGrowthBytes: finalReleased.heapUsed - firstResultReleased.heapUsed };
  process.send(report);
}

async function runCase(c, timeoutMs) {
  return new Promise(resolveCase => {
    const start = performance.now();
    const proc = fork(self, ['--child', JSON.stringify(c)], { execArgv: ['--expose-gc', '--max-old-space-size=1024'], silent: true });
    let stderr = '', report, timedOut = false;
    proc.stdout.resume();
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    proc.on('message', message => { report = message; });
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutMs);
    proc.on('error', error => { stderr += error.message; });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveCase({ ...(report ?? c), status: timedOut ? 'timeout' : code === 0 && report ? 'completed' : 'crash',
        exitCode: code, signal, wallMs: round(performance.now() - start), ...(stderr ? { stderr } : {}) });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const filter = new RegExp(option('--case', '.*'));
  const output = resolve(option('--output', 'artifacts/compiler-stress.json'));
  const samples = option('--samples', null);
  const soak = option('--soak', null);
  const warmups = option('--warmups', null);
  const timeoutMs = Number(option('--timeout', '60000'));
  const modulePath = option('--module', null);
  const compilerModule = modulePath === null ? 'reactive-md' : pathToFileURL(resolve(modulePath)).href;
  assert.ok(samples === null || Number.isInteger(Number(samples)) && Number(samples) > 0, '--samples must be a positive integer');
  assert.ok(soak === null || Number.isInteger(Number(soak)) && Number(soak) > 0, '--soak must be a positive integer');
  assert.ok(warmups === null || Number.isInteger(Number(warmups)) && Number(warmups) >= 0, '--warmups must be a nonnegative integer');
  assert.ok(timeoutMs > 0 && Number.isFinite(timeoutMs), '--timeout must be positive');
  const results = [];
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  let commit;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
  const report = { generatedAt: new Date().toISOString(), version, commit, compilerModule,
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), childOldSpaceLimitMiB: 1024, timeoutMs },
    methodology: 'Serial isolated processes. Public production compileLocal. First compile after import reported separately; 2 further warmups and 10 measured calls by default, with per-case/CLI overrides recorded on each result. --once stops after the first compile; --soak replaces timing loops with successive edit versions and GC checkpoints every 10 versions. No forced GC inside ordinary timing loops. Input generation, assertions and optional one-shot structuredClone excluded from compile timing. GC snapshots before/after first compile, with result retained and released. Peak RSS is OS process.resourceUsage maxRSS (KiB converted to bytes), includes runtime/import/input and is captured before correctness traversal or cloning on first compile. Returned node count excludes intermediate allocations. P95 for small sample counts is descriptive only. Uncaught errors, process exits and timeout are separate outcomes. Results written after every case.', results };
  await mkdir(dirname(output), { recursive: true });
  for (const c of cases.filter(c => filter.test(c.id))) {
    console.log(`START ${c.id}`);
    const result = await runCase({ ...c, compilerModule, samples: samples === null ? c.samples ?? 10 : Number(samples), warmups: warmups === null ? c.warmups ?? 2 : Number(warmups), ...(args.includes('--once') ? { once: true } : {}), ...(soak === null ? {} : { soak: Number(soak) }) }, timeoutMs);
    results.push(result);
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ id: c.id, status: result.status, ok: result.outcome?.ok, medianMs: result.timing?.medianMs, peakMiB: result.memory?.firstCompileEnd ? round(result.memory.firstCompileEnd.maxRssBytes / 2 ** 20) : null, keys: result.outcome?.diagnosticKeys }));
  }
  console.log(`Report: ${output}`);
}

if (process.argv[2] === '--child') {
  await child(JSON.parse(process.argv[3]));
} else if (process.argv[1] && resolve(process.argv[1]) === self) {
  await main();
}
