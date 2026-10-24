import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const args = process.argv.slice(2);
let iterations = 25;
let output = 'artifacts/benchmark-stages.json';
for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  const value = args[++index];
  if (option === '--iterations' && /^\d+$/.test(value ?? '')) iterations = Number(value);
  else if (option === '--output' && value) output = value;
  else throw new Error('Usage: node scripts/benchmark-stages.mjs [--iterations 5..200] [--output path.json]');
}
assert.ok(iterations >= 5 && iterations <= 200, 'iterations must be between 5 and 200');

const harnessRoot = fileURLToPath(new URL('./benchmark-stages/', import.meta.url));
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    iterations: samples.length,
    medianMs: Number(percentile(0.5).toFixed(4)),
    p95Ms: Number(percentile(0.95).toFixed(4)),
    minMs: Number(sorted[0].toFixed(4)),
    maxMs: Number(sorted.at(-1).toFixed(4)),
  };
}

const port = await freePort();
const server = await createViteServer({
  configFile: false,
  root: harnessRoot,
  plugins: [react()],
  optimizeDeps: { exclude: ['reactive-md', 'reactive-md/react'] },
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [projectRoot] } },
  logLevel: 'error',
});

let browser;
try {
  await server.listen();
  const baseURL = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${port}/`;
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
  });
  page.setDefaultTimeout(120_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const started = performance.now();
  await page.goto(new URL('index.html', baseURL).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.stageBench?.ready === true);
  const raw = await page.evaluate((count) => window.stageBench.run(count), iterations);
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  const wallMs = Number((performance.now() - started).toFixed(2));

  const renderFinal = summarize(
    raw.render.samples.map((sample) => sample.reactMs + sample.layoutMs),
  );
  const renderReact = summarize(raw.render.samples.map((sample) => sample.reactMs));
  const renderLayout = summarize(raw.render.samples.map((sample) => sample.layoutMs));
  const renderWrite = summarize(raw.render.samples.map((sample) => sample.writeMs));
  const interactionFinal = summarize(
    raw.interaction.samples.map((sample) => sample.reactMs + sample.layoutMs),
  );
  const interactionReact = summarize(raw.interaction.samples.map((sample) => sample.reactMs));
  const interactionLayout = summarize(raw.interaction.samples.map((sample) => sample.layoutMs));
  const interactionWrite = summarize(raw.interaction.samples.map((sample) => sample.writeMs));
  const localityResults = raw.locality.streams.map((stream) => ({
    name: stream.label,
    ...summarize(stream.samples.map((sample) => sample.reactMs + sample.layoutMs)),
    unit: 'one update',
    reactCommit: summarize(stream.samples.map((sample) => sample.reactMs)),
    forcedLayout: summarize(stream.samples.map((sample) => sample.layoutMs)),
    runtimeWrite: summarize(stream.samples.map((sample) => sample.writeMs)),
    documentCharacters: raw.locality.documentCharacters,
  }));
  const visualsResults = raw.visuals.streams.map((stream) => ({
    name: stream.label,
    ...summarize(stream.samples.map((sample) => sample.reactMs + sample.layoutMs)),
    unit: 'one update',
    reactCommit: summarize(stream.samples.map((sample) => sample.reactMs)),
    forcedLayout: summarize(stream.samples.map((sample) => sample.layoutMs)),
    runtimeWrite: summarize(stream.samples.map((sample) => sample.writeMs)),
    documentCharacters: raw.visuals.documentCharacters,
  }));
  const chartsResults = raw.charts.streams.map((stream) => ({
    name: stream.label,
    ...summarize(stream.samples.map((sample) => sample.reactMs + sample.layoutMs)),
    unit: 'one update',
    reactCommit: summarize(stream.samples.map((sample) => sample.reactMs)),
    forcedLayout: summarize(stream.samples.map((sample) => sample.layoutMs)),
    runtimeWrite: summarize(stream.samples.map((sample) => sample.writeMs)),
    documentCharacters: raw.charts.documentCharacters,
  }));

  const results = [
    {
      name: 'compile:interactive-article',
      ...summarize(raw.compileMs),
      sourceCharacters: raw.config.sourceCharacters,
      sections: raw.config.sections,
    },
    {
      name: 'update:runtime-set',
      ...summarize(raw.updateMsPerWrite),
      unit: 'one write',
      writesPerSample: raw.config.updatesPerSample,
    },
    {
      name: 'plot:3-curves-200-samples',
      ...summarize(raw.plotMsPerPlot),
      unit: 'one plot',
      curves: raw.config.plotCurves,
      samplesPerCurve: raw.config.samplesPerCurve,
      plotsPerSample: raw.config.plotsPerSample,
    },
    {
      name: 'render:final',
      ...renderFinal,
      unit: 'one update',
      reactCommit: renderReact,
      forcedLayout: renderLayout,
      runtimeWrite: renderWrite,
      documentCharacters: raw.render.documentCharacters,
      plotSampling: 'not included',
    },
    {
      name: 'interaction:update-plot-render',
      ...interactionFinal,
      unit: 'one update',
      reactCommit: interactionReact,
      forcedLayout: interactionLayout,
      runtimeWrite: interactionWrite,
      documentCharacters: raw.interaction.documentCharacters,
      plotSampling: 'included',
    },
    ...localityResults,
    ...visualsResults,
    ...chartsResults,
  ];

  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    packageVersion: version,
    environment: {
      node: process.version,
      platform: platform(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
      browser: `Chromium ${browser.version()}`,
      viewport: '1440x1000',
      wallMs,
    },
    methodology:
      'Five warmups per case in headless Chromium against a Vite dev server. compile = compileLocal on a 100-section interactive article (3-curve plot included). update = runtime.set with one no-op subscriber, no React, amortized over 1000 writes. plot = compileLatex + samplePlot for 3 curves x 200 points, amortized over 20 plots. render:final = slider write -> React re-render -> DOM commit -> forced getBoundingClientRect() style/layout on the plot-free 100-section article; its median excludes the runtime write, which is reported separately, and plot sampling is excluded. interaction = the same write on the article version containing the 3-curve plot, so React work includes plot sampling, SVG path generation and DOM updates. locality = one plot-free 100-section article mounted once; three sliders are written in forward and reverse passes (five warmups per pass, samples merged) so drift cancels: a value referenced by every section, a value referenced by exactly one section, and a value referenced by no other node; it isolates how much update cost lies outside the dependency footprint of the written value. visuals = one article made of 10 interpolated tables mounted once; three sliders are written in forward and reverse passes: a value referenced by every table, one referenced by exactly one table, and one referenced by none; it measures how much per-write cost table rendering adds and how much of that cost is independent of the written value. charts = the same footprint comparison on an article made of 4 interpolated bar charts. Paint/presentation after layout is not included. Observations under load, not cross-machine thresholds.',
    config: raw.config,
    results,
  };
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  console.table(results.map(({ name, medianMs, p95Ms }) => ({ name, medianMs, p95Ms })));
  console.log(`Stage benchmark report: ${destination}`);
} finally {
  await browser?.close();
  await server.close();
}
