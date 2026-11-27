import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build, createServer } from 'vite';
import { renderToString } from 'react-dom/server';

const root = fileURLToPath(new URL('../examples/integration/static-embed/', import.meta.url));
const render = (args = []) => execFileSync(process.execPath, [join(root, 'render.mjs'), ...args], { encoding: 'utf8' });
const synchronous = render();
const deferred = render(['--defer']);
assert.match(synchronous, /References provided by the host/);
assert.match(synchronous, /md-card-title/);
assert.match(synchronous, /Selected layout card/);
assert.match(synchronous, /class="local-if md-if"/);
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
    await expect(page.locator('main .local-card')).toContainText('This paragraph uses the selected layout component.');
    await expect(page.locator('main .local-if')).toContainText('The conditional branch stays static.');
    const readReport = async () => JSON.parse(await page.locator('#report').textContent());
    // Two host slots plus the selected pack card mount under one revision.
    await expect.poll(async () => (await readReport()).revisions[0].productionFinalMounts)
      .toBe(environment === 'production' ? 3 : 0);
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

async function verifyDeferredComponents(url) {
  const { view } = await import('../tests/fixtures/deferred-components/view.mjs');
  let serverCalls = 0;
  const markup = renderToString(view(() => { serverCalls++; return null; }));
  assert.equal(serverCalls, 0);
  assert.match(markup, /<b>immediate-card<\/b>/);
  assert.equal((markup.match(/data-rmd-component-load="loading"/g) ?? []).length, 3);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route(url, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('<main id="document"></main>', `<main id="document">${markup}</main>`) });
    });
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => window.deferredFixture?.requests.map(request => request.name).sort()), { timeout: 15_000 })
      .toEqual(['aborted-card', 'deferred-card']);
    await expect(page.locator('[data-rmd-component-load="loading"]')).toHaveCount(3);
    await page.evaluate(() => window.deferredFixture.fail('deferred-card'));
    await expect(page.locator('[data-rmd-component-load="failed"]')).toHaveCount(2);
    await expect(page.locator('article')).toContainText('After');
    await expect(page.locator('b')).toHaveText('immediate-card');
    await expect.poll(() => page.evaluate(() => window.deferredFixture.diagnostics.filter(d => d.code === 'local.extension.load-failed').length)).toBe(1);
    await page.getByRole('button', { name: 'Retry' }).first().click();
    await expect.poll(() => page.evaluate(() => window.deferredFixture.requests.length)).toBe(3);
    await page.evaluate(() => window.deferredFixture.resolve('deferred-card'));
    await expect(page.locator('b').filter({ hasText: 'deferred-card' })).toHaveCount(2);
    await page.evaluate(() => window.deferredFixture.unmount());
    await expect.poll(() => page.evaluate(() => window.deferredFixture.requests.find(request => request.name === 'aborted-card').signal.aborted)).toBe(true);
    await page.evaluate(() => window.deferredFixture.resolve('aborted-card'));
    await expect(page.locator('main')).toBeEmpty();
    const report = await page.evaluate(() => window.deferredFixture.events);
    assert.ok(report.some(event => event.type === 'component-load-end' && event.componentName === 'aborted-card' && event.status === 'cancelled'));
    assert.ok(report.some(event => event.type === 'render-unmount' && !event.componentName && typeof event.unmountMs === 'number'));
    assert.ok(report.some(event => event.type === 'render-unmount' && event.componentName === 'deferred-card' && typeof event.unmountMs === 'number'));
    assert.deepEqual(errors, []);
    console.log('PASS deferred component hydration, retry, cancellation and unmount timings');
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

  process.env.NODE_ENV = 'development';
  const fixture = await createServer({ root: fileURLToPath(new URL('../tests/fixtures/deferred-components/', import.meta.url)),
    configFile: false, server: { host: '127.0.0.1', port: 0 } });
  try {
    await fixture.listen();
    await verifyDeferredComponents(fixture.resolvedUrls.local[0]);
  } finally { await fixture.close(); }
} finally { await browser.close(); }
