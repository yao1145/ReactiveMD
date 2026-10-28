import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { fixture } from './benchmark-compiler-stress.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = arg('--output', 'artifacts/compiler-browser.json');
const filter = new RegExp(arg('--case', '.*'));

const root = resolve('dist-library');
const server = createServer(async (request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Compiler benchmark</title>');
    return;
  }
  const path = resolve('.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!path.startsWith(root + sep)) { response.writeHead(404).end(); return; }
  try { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
  const page = await browser.newPage();
  await page.goto(base);
  const cases = [['article', 100], ['article', 600], ['controls', 1_000], ['controls', 5_000], ['controls', 10_000], ['paragraphs', 5_000], ['plain', 1_000_000], ['markdown-depth', 500], ['markdown-depth', 1_000], ['markdown-depth', 2_000]];
  const results = [];
  for (const [kind, size] of cases) {
    if (!filter.test(`${kind}-${size}`)) continue;
    const source = fixture(kind, size);
    const result = await page.evaluate(async ({ base, source }) => {
      const code = `import {compileLocal} from '${base}dist-library/reactive-md.js';
        self.onmessage = ({data: source}) => {
          let result; const start=performance.now();
          try { result=compileLocal(source); }
          catch(error) { self.postMessage({phase:'compile-error', name:error.name, message:error.message}); return; }
          const compileMs=performance.now()-start;
          try { self.postMessage({phase:'result', result, compileMs}); }
          catch(error) { self.postMessage({phase:'transfer-error', compileOk:result.ok, compileMs, name:error.name, message:error.message}); }
        }; self.postMessage({phase:'ready'});`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const worker = new Worker(url, { type: 'module' });
      const receive = () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker benchmark message timed out')), 60000);
        worker.onmessage = ({data}) => { clearTimeout(timeout); resolve(data); };
        worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
      });
      try {
        await receive();
        const samples = [];
        const outcomes = [];
        let outcome;
        for (let i = 0; i < 7; i++) {
          const pending = receive(); const start = performance.now();
          worker.postMessage(source);
          const data = await pending;
          const roundTripMs = performance.now() - start;
          outcome = { phase: data.phase, ok: data.result?.ok ?? data.compileOk, name: data.name, message: data.message, diagnostics: data.result?.diagnostics };
          outcomes.push(outcome);
          if (data.phase !== 'result') return { outcome, outcomes, firstCompileMs: data.compileMs };
          if (i >= 2) samples.push({ compileMs: data.compileMs, roundTripMs });
        }
        return { outcome, outcomes, warmups: 2, samples };
      } finally { worker.terminate(); URL.revokeObjectURL(url); }
    }, { base, source });
    results.push({ kind, size, sourceCharacters: source.length, ...result });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.ok(results.filter(r => r.kind !== 'markdown-depth').every(r => r.outcomes.every(o => o.phase === 'result' && o.ok)), 'Normal browser fixtures must compile and transfer');
  const workerProtocolRecovery = await page.evaluate(async base => {
    const code = `import {startLocalCompileWorker} from '${base}dist-library/reactive-md.js'; startLocalCompileWorker(); self.postMessage({ready:true});`;
    const url = URL.createObjectURL(new Blob([code], {type: 'text/javascript'}));
    const worker = new Worker(url, {type: 'module'});
    const receive = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Protocol worker timed out')), 60000);
      worker.onmessage = ({data}) => { clearTimeout(timer); resolve(data); };
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
    });
    try {
      await receive();
      let pending = receive();
      worker.postMessage({id: 1, source: '> '.repeat(500) + 'text'});
      const deep = await pending;
      pending = receive();
      worker.postMessage({id: 2, source: 'ordinary text'});
      const recovery = await pending;
      return {deep, recoveryOk: recovery.ok && recovery.result.ok};
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }, base);
  assert.ok(workerProtocolRecovery.recoveryOk, 'The public worker must recover for the next ordinary input');
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), browser: browser.version(), methodology: 'Production ESM over local HTTP; one dedicated module Worker per fixture, two warmups and five measured compile+postMessage round trips. No React rendering. Round-trip includes source and result cloning, queueing and main-thread delivery. Deep inputs record compile and transfer errors separately.', workerProtocolRecovery, results }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
