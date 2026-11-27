import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build, createServer } from 'vite';

const root = fileURLToPath(new URL('../examples/integration/static-embed/', import.meta.url));
const render = (args = []) => execFileSync(process.execPath, [join(root, 'render.mjs'), ...args], { encoding: 'utf8' });
const synchronous = render();
const deferred = render(['--defer']);
assert.match(synchronous, /References provided by the host/);
assert.equal((deferred.match(/data-rmd-component-load="loading"/g) ?? []).length, 2);
assert.equal((deferred.match(/data-local-fallback/g) ?? []).length, 1);
assert.match(deferred, /\{\{ visitor.name \}\}/);

// Chromium is installed by CI; local runs on Windows can set PLAYWRIGHT_CHANNEL=msedge.
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chromium';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });

async function verify(url, environment) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route(url, async route => {
      const response = await route.fetch();
      const shell = await response.text();
      const body = shell.replace('<main id="document"></main>', `<main id="document">${deferred.trim()}</main>`);
      await route.fulfill({ response, body });
    });
    await page.goto(url);
    await expect(page.locator('main aside')).toHaveCount(2);
    await expect(page.locator('main .local-if')).toContainText('This paragraph uses the selected layout component.');
    const readReport = async () => JSON.parse(await page.locator('#report').textContent());
    await expect.poll(async () => (await readReport()).revisions[0].productionFinalMounts)
      .toBe(environment === 'production' ? 2 : 0);
    const report = await readReport();
    assert.equal(report.components[0].requests, 1);
    assert.equal(report.components[0].peakSubscribers, 2);
    assert.equal(report.revisions[0].compile.succeeded, 1);
    assert.equal(report.revisions[0].componentLoads.succeeded, 1);
    if (environment === 'development') assert.ok(report.revisions[0].developmentMounts >= 2);
    else assert.equal(report.revisions[0].developmentMounts, 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${environment} hydration, shared resolution and mount counters`);
  } finally { await page.close(); }
}

try {
  process.env.NODE_ENV = 'development';
  const dev = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 } });
  try {
    await dev.listen();
    await verify(dev.resolvedUrls.local[0], 'development');
  } finally { await dev.close(); }

  process.env.NODE_ENV = 'production';
  const buildResult = await build({ root, configFile: false, logLevel: 'error', build: { write: false } });
  const files = new Map((Array.isArray(buildResult) ? buildResult : [buildResult])
    .flatMap(item => item.output).map(item => [item.fileName, item]));
  const server = createHttpServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const file = files.get(path);
    if (!file) { response.writeHead(404).end(); return; }
    const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.setHeader('Content-Type', type);
    response.end(file.type === 'asset' ? file.source : file.code);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await verify(`http://127.0.0.1:${server.address().port}/`, 'production'); }
  finally { server.close(); }
} finally { await browser.close(); }
