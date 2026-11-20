#!/usr/bin/env node
/**
 * Streaming-source compilation benchmark (Stage 2 artifact).
 *
 * Loads the compiler from `src/` through Vite's SSR module loader so the
 * benchmark never depends on `dist-library/` being up to date. Both documents
 * are fixed, and every snapshot is the deterministic prefix of the previous
 * one, so repeated runs submit the same source sequence.
 *
 * For each snapshot this measures `session.compile(source, options, 'streaming')`
 * wall time, status, transient diagnostic count and the session stats. It then
 * compiles the completed document with `'final'` and asserts the document tree is
 * deep-equal to an independent one-shot `compileLocal` (ignoring `status`).
 *
 * A 150 ms host-side throttle is simulated from the measured samples: one
 * submission per window, using the prefix that arrived last in that window.
 * This approximates Worker message volume and input-to-preview latency without
 * starting a Worker.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const OPTIONS = { strict: true };

function readNumber(name, fallback) {
  const raw = process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

const paragraphs = Math.floor(readNumber('paragraphs', 200));
const longChunk = Math.floor(readNumber('chunk', 64));
const shortChunk = Math.floor(readNumber('short-chunk', 16));
const throttleWindow = readNumber('window', 150);
const arrivalMs = readNumber('arrival', 20);

/** A representative short generation: headings, prose, a control, interpolation. */
function buildShortDocument() {
  return [
    '# Streaming brief',
    '',
    'A short generated note with **bold**, a [link](https://example.com), inline math \\(a + b\\), and a live value {{ 2 * 21 }}.',
    '',
    '## Inputs',
    '',
    '<slider bind="people" label="People" initial="2" min="1" max="20">',
    '',
    'Estimated cost: **{{ people * 100 }} USD**.',
    '',
    '## Notes',
    '',
    '- first note',
    '- second note with `code`',
    '',
  ].join('\n');
}

/**
 * A long generation: many blocks, several headings and controls, interpolations
 * spread through the document so streaming snapshots hit them mid-word.
 */
function buildLongDocument(count) {
  const parts = ['# Long streaming document', ''];
  for (let index = 1; index <= count; index += 1) {
    if (index === 1 || (index - 1) % 20 === 0) {
      parts.push(`## Section ${Math.floor((index - 1) / 20) + 1}`, '');
    }
    parts.push(
      `Paragraph ${index} records **finding ${index}** and value {{ ${index} * 2 }} for review.`,
      '',
    );
    if (index % 50 === 0) {
      parts.push(
        `<slider bind="s${index}" label="Section ${index}" initial="2" min="1" max="20">`,
        '',
        `Count for section ${index}: {{ s${index} }}.`,
        '',
      );
    }
    if (index % 25 === 0) {
      parts.push('- alpha', '- beta', '- gamma', '');
    }
  }
  return parts.join('\n');
}

/**
 * Fixed-size prefixes. Every fifth cut is extended to the next newline (when
 * close) so the round contains both mid-word and structural boundaries.
 */
function snapshotPrefixes(source, chunk) {
  const snapshots = [];
  let end = 0;
  while (end < source.length) {
    end = Math.min(source.length, end + chunk);
    if (snapshots.length % 5 === 4 && end < source.length) {
      const newline = source.indexOf('\n', end);
      if (newline !== -1 && newline + 1 - end <= 48) end = newline + 1;
    }
    snapshots.push(source.slice(0, end));
  }
  if (snapshots.at(-1) !== source) snapshots.push(source);
  return snapshots;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function summary(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    samples: samples.length,
    total,
    mean: samples.length ? total / samples.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

/**
 * One submission per `window` while the generation is still producing input.
 * A snapshot is dispatched at the first window boundary after its arrival; the
 * simulated preview latency is that wait plus its measured compile duration.
 */
function simulateThrottle(snapshots, durations, source, finalMs) {
  const generationMs = snapshots.length * arrivalMs;
  const dispatched = [];
  const latencies = [];
  for (let boundary = throttleWindow; boundary < generationMs; boundary += throttleWindow) {
    const index = Math.min(snapshots.length - 1, Math.floor(boundary / arrivalMs) - 1);
    if (index < 0 || dispatched.at(-1) === index) continue;
    dispatched.push(index);
    const arrivedAt = (index + 1) * arrivalMs;
    latencies.push(Math.max(0, boundary - arrivedAt) + durations[index]);
  }
  const sentCharacters = dispatched.reduce((sum, index) => sum + snapshots[index].length, 0);
  const unthrottledCharacters = snapshots.reduce((sum, snapshot) => sum + snapshot.length, 0) + source.length;
  return {
    streamingMessages: dispatched.length,
    coalescedSnapshots: snapshots.length - dispatched.length,
    sentCharacters,
    unthrottledMessages: snapshots.length + 1,
    unthrottledCharacters,
    streamingLatency: summary(latencies),
    finalLatencyMs: finalMs,
    totalMessages: dispatched.length + 1,
    totalCharacters: sentCharacters + source.length,
  };
}

function measureDocument(name, source, chunk, { compileLocal, LocalCompileSession }) {
  const snapshots = snapshotPrefixes(source, chunk);
  const session = new LocalCompileSession();
  const durations = [];
  let transientTotal = 0;
  let transientMax = 0;
  let transientSnapshots = 0;
  const statuses = new Map();
  let streamingStats = null;
  let finalMs = 0;
  let finalResult = null;
  let finalStats = null;
  let equivalence = 'not checked';
  const transientSources = [];
  const transientCodes = new Map();

  try {
    for (const snapshot of snapshots) {
      const started = performance.now();
      const result = session.compile(snapshot, OPTIONS, 'streaming');
      const elapsed = performance.now() - started;
      durations.push(elapsed);
      const status = result.status ?? (result.ok ? 'partial' : 'failed');
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
      const transient = result.transientDiagnostics?.length ?? 0;
      transientTotal += transient;
      transientMax = Math.max(transientMax, transient);
      for (const diagnostic of result.transientDiagnostics ?? []) {
        transientCodes.set(diagnostic.code, (transientCodes.get(diagnostic.code) ?? 0) + 1);
      }
      if (transient > 0) {
        transientSnapshots += 1;
        transientSources.push(snapshot);
      }
      const stats = session.stats;
      if (stats.mode !== 'streaming') throw new Error(`${name}: expected streaming stats, got ${stats.mode}`);
      assert.ok(result.ok, `${name}: snapshot at ${snapshot.length} chars was not renderable: ${JSON.stringify(result.diagnostics)}`);
      assert.equal(status, 'partial', `${name}: snapshot at ${snapshot.length} chars had status ${status}`);
    }
    streamingStats = session.stats;

    const finalStarted = performance.now();
    finalResult = session.compile(source, OPTIONS, 'final');
    finalMs = performance.now() - finalStarted;
    finalStats = session.stats;
    assert.ok(finalResult.ok, `${name}: final compile failed: ${JSON.stringify(finalResult.diagnostics)}`);
    assert.equal(finalResult.status, 'valid', `${name}: expected final status valid, got ${finalResult.status}`);

    const comparable = { ...finalResult };
    delete comparable.status;
    const independent = compileLocal(source, OPTIONS);
    assert.ok(independent.ok, `${name}: independent one-shot compile failed`);
    try {
      assert.deepStrictEqual(comparable, independent);
      equivalence = 'exact deep-equal';
    } catch (error) {
      equivalence = 'MISMATCH';
      throw new Error(`${name}: final document differs from the one-shot compile: ${error.message.slice(0, 800)}`);
    }
  } finally {
    session.dispose();
  }

  const slowestIndex = durations.indexOf(Math.max(...durations));
  return {
    name,
    source,
    characters: source.length,
    blocks: finalResult.ok ? finalResult.document.nodes.length : 0,
    snapshots: snapshots.length,
    chunk,
    durations,
    timing: summary(durations),
    slowest: {
      index: slowestIndex,
      chars: snapshots[slowestIndex].length,
      ms: durations[slowestIndex],
    },
    statuses,
    transientTotal,
    transientMax,
    transientSnapshots,
    transientSources,
    transientCodes,
    streamingStats,
    finalMs,
    finalStatus: finalResult.status,
    finalStats,
    equivalence,
  };
}

function warmup({ compileLocal, LocalCompileSession }) {
  const short = buildShortDocument();
  const long = buildLongDocument(paragraphs);
  const session = new LocalCompileSession();
  try {
    for (const source of [short, long.slice(0, Math.min(4000, long.length))]) {
      session.compile(source, OPTIONS, 'streaming');
      session.compile(source, OPTIONS, 'final');
    }
  } finally {
    session.dispose();
  }
  compileLocal(short, OPTIONS);
  compileLocal(long, OPTIONS);
}

function printReport(results, throttleWindow, arrivalMs, node, cpu) {
  console.log('');
  console.log(`Streaming-source compilation benchmark | node ${node} | ${cpu}`);
  console.log(`Host-side throttle simulation: ${throttleWindow} ms window, ${arrivalMs} ms per chunk, no transport time.`);
  console.log('');
  const header = [
    'document'.padEnd(14),
    'chars'.padStart(7),
    'blocks'.padStart(7),
    'snaps'.padStart(6),
    'chunk'.padStart(6),
    'stream total'.padStart(13),
    'p50'.padStart(9),
    'p95'.padStart(9),
    'max'.padStart(9),
    'transient'.padStart(10),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const result of results) {
    console.log([
      result.name.padEnd(14),
      String(result.characters).padStart(7),
      String(result.blocks).padStart(7),
      String(result.snapshots).padStart(6),
      String(result.chunk).padStart(6),
      formatMs(result.timing.total).padStart(13),
      formatMs(result.timing.p50).padStart(9),
      formatMs(result.timing.p95).padStart(9),
      formatMs(result.timing.max).padStart(9),
      `${result.transientSnapshots}/${result.transientTotal}`.padStart(10),
    ].join('  '));
  }
  console.log('');
  const second = [
    'document'.padEnd(14),
    'stream stats (mode/chars blocks reused)'.padStart(40),
    'final'.padStart(10),
    'final stats'.padStart(26),
    'equivalence'.padStart(18),
  ].join('  ');
  console.log(second);
  console.log('-'.repeat(second.length));
  for (const result of results) {
    const stats = result.streamingStats;
    console.log([
      result.name.padEnd(14),
      `${stats.mode}/${stats.compiledCharacters} ${stats.compiledBlocks}/${stats.totalBlocks}b r${stats.reusedBlocks}`.padStart(40),
      formatMs(result.finalMs).padStart(10),
      `${result.finalStats.mode}/${result.finalStats.compiledCharacters}`.padStart(26),
      result.equivalence.padStart(18),
    ].join('  '));
  }
  console.log('');
  const third = [
    'document'.padEnd(14),
    'messages'.padStart(9),
    'coalesced'.padStart(10),
    'sent chars'.padStart(12),
    'p50 latency'.padStart(12),
    'p95 latency'.padStart(12),
    'final msg'.padStart(10),
  ].join('  ');
  console.log(third);
  console.log('-'.repeat(third.length));
  for (const result of results) {
    const throttle = result.throttle;
    console.log([
      result.name.padEnd(14),
      `${throttle.totalMessages}`.padStart(9),
      `${throttle.coalescedSnapshots}`.padStart(10),
      `${throttle.totalCharacters}`.padStart(12),
      formatMs(throttle.streamingLatency.p50).padStart(12),
      formatMs(throttle.streamingLatency.p95).padStart(12),
      formatMs(throttle.finalLatencyMs).padStart(10),
    ].join('  '));
  }
  console.log('');
  for (const result of results) {
    const statuses = [...result.statuses].map(([status, count]) => `${status}=${count}`).join(', ');
    const attempts = result.attempts
      ? `attempts on transient snapshots (direct probe, n=${result.attempts.count}) ${result.attempts.min}..${result.attempts.max}, mean ${result.attempts.mean.toFixed(2)}`
      : 'no transient snapshots to probe';
    const throttle = result.throttle;
    const codes = [...result.transientCodes].map(([code, count]) => `${code}=${count}`).join(', ') || 'none';
    console.log(`${result.name}: statuses ${statuses}; transient per snapshot max ${result.transientMax}; ${attempts}; whole-source literal snapshots ${result.wholeLiteralSnapshots}.`);
    console.log(`${result.name}: transient codes ${codes}.`);
    console.log(`${result.name}: slowest snapshot ${result.slowest.index + 1}/${result.snapshots} at ${result.slowest.chars} chars took ${formatMs(result.slowest.ms)}.`);
    console.log(`${result.name}: messages ${throttle.totalMessages} vs ${throttle.unthrottledMessages} unthrottled; sent characters ${throttle.totalCharacters} vs ${throttle.unthrottledCharacters}.`);
  }
  console.log('');
}

let server = null;
try {
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  const sessionModule = await server.ssrLoadModule('/src/local/compilation/session/incremental.ts');
  const compilerModule = await server.ssrLoadModule('/src/local/compilation/compiler.ts');
  const workerModule = await server.ssrLoadModule('/src/local/transport/worker-job.ts');
  const { LocalCompileSession } = sessionModule;
  const { compileLocal } = compilerModule;
  assert.equal(workerModule.LOCAL_COMPILE_DELAY_MS, 150, 'benchmark assumes the 150 ms scheduler default');

  const dependencies = { compileLocal, LocalCompileSession };
  warmup(dependencies);

  const shortDocument = buildShortDocument();
  const longDocument = buildLongDocument(paragraphs);
  const started = performance.now();
  const shortResult = measureDocument('short', shortDocument, shortChunk, dependencies);
  const longResult = measureDocument('long', longDocument, longChunk, dependencies);
  const wallMs = performance.now() - started;

  for (const result of [shortResult, longResult]) {
    result.throttle = simulateThrottle(
      snapshotPrefixes(result.source, result.chunk),
      result.durations,
      result.source,
      result.finalMs,
    );
  }

  // The session result and stats do not expose stabilization attempts, so probe
  // the snapshots that reported transient diagnostics with the internal tracked
  // compiler. One attempt with no transient diagnostics is the common case.
  const streamingModule = await server.ssrLoadModule('/src/local/compilation/streaming.ts');
  for (const result of [shortResult, longResult]) {
    const attempts = result.transientSources.map(snapshot => {
      const tracked = streamingModule.compileLocalStreamingTracked(snapshot, OPTIONS);
      assert.ok(
        tracked.attempts >= 1 && tracked.attempts <= streamingModule.LOCAL_STREAMING_MAX_ATTEMPTS,
        `${result.name}: attempts ${tracked.attempts} exceeded the stabilization budget`,
      );
      const whole = tracked.literalRanges.length === 1
        && tracked.literalRanges[0].start === 0
        && tracked.literalRanges[0].end === snapshot.length;
      return { attempts: tracked.attempts, whole };
    });
    const attemptValues = attempts.map(entry => entry.attempts);
    result.wholeLiteralSnapshots = attempts.filter(entry => entry.whole).length;
    result.attempts = attemptValues.length === 0 ? null : {
      count: attemptValues.length,
      min: Math.min(...attemptValues),
      max: Math.max(...attemptValues),
      mean: attemptValues.reduce((sum, value) => sum + value, 0) / attemptValues.length,
    };
    delete result.transientSources;
  }

  printReport(
    [shortResult, longResult],
    throttleWindow,
    arrivalMs,
    process.version,
    `${cpus()[0]?.model ?? 'unknown CPU'} (${cpus().length} logical cores)`,
  );
  console.log(`Measured wall time (warmup excluded): ${(wallMs / 1000).toFixed(2)} s.`);
  console.log(`Median long-document snapshot ${formatMs(median(longResult.durations))}.`);

  const targets = [
    ['short p95 < 150 ms', shortResult.timing.p95 < 150, formatMs(shortResult.timing.p95)],
    ['long p95 < 300 ms', longResult.timing.p95 < 300, formatMs(longResult.timing.p95)],
    ['long final < 300 ms', longResult.finalMs < 300, formatMs(longResult.finalMs)],
    [
      'final documents deep-equal',
      shortResult.equivalence === 'exact deep-equal' && longResult.equivalence === 'exact deep-equal',
      'deepStrictEqual ignoring status',
    ],
  ];
  console.log('');
  for (const [label, passed, detail] of targets) {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${label} (${detail})`);
  }
  if (targets.some(([, passed]) => !passed)) process.exitCode = 1;
} finally {
  if (server) await server.close();
}