import { chromium, expect } from '@playwright/test';
import { createServer, preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { openWorkbench, clickWorkbenchAction } from './workbench-ui.mjs';

const dev = process.argv.includes('--dev');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = fileURLToPath(new URL('../../artifacts/demo-extensions/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const config = { root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 5187, strictPort: true }, preview: { host: '127.0.0.1', port: 5187, strictPort: true } };
const server = dev ? await createServer(config) : await preview(config);
if (dev) await server.listen();
const baseURL = server.resolvedUrls.local[0];
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
let browser;
const checks = [];
const errors = [];
const workers = [];
let status = 'failed';
const check = async (name, action) => { await action(); checks.push(name); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).pathname !== '/favicon.ico') {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('worker', worker => workers.push(worker.url()));
  await openWorkbench(page, baseURL);
  const examplesButton = page.getByRole('button', { name: 'Try examples', exact: true });
  if (await examplesButton.isVisible()) await examplesButton.click();
  await page.locator('#example-select').selectOption('tetris');
  const game = page.locator('[data-tetris]');
  await check('registered sample compiles through the worker and renders with CSS', async () => {
    await expect(game).toBeVisible();
    await expect(page.locator('.status-chip')).toContainText('Compiled');
    expect(workers.some(url => url.includes('local-compile-worker'))).toBe(true);
    expect(await page.locator('[data-tetris-board]').evaluate(element => getComputedStyle(element).display)).toBe('grid');
    await expect(page.locator('[data-tetris-cell]')).toHaveCount(200);
  });
  await check('external controls receive the SDK interaction context', async () => {
    const moves = Number(await game.getAttribute('data-tetris-moves'));
    await page.locator('[data-tetris-drop]').click();
    await expect.poll(async () => Number(await game.getAttribute('data-tetris-moves'))).toBeGreaterThan(moves);
    await page.getByRole('checkbox', { name: 'Lock tetris', exact: true }).check();
    await expect(page.locator('[data-tetris-drop]')).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Lock tetris', exact: true }).uncheck();
    await expect(page.locator('[data-tetris-drop]')).toBeEnabled();
  });
  await check('the editor catalog automatically includes Tetris', async () => {
    await page.locator('[data-editor-view-option="edit"]').click();
    await page.locator('[data-toolbar-id="components"]').click();
    await expect(page.getByRole('menuitem', { name: /Tetris/ })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  for (const mode of ['interactive', 'static']) {
    await check(`${mode} HTML includes the plugin and works without network access`, async () => {
      await clickWorkbenchAction(page, /^Export/);
      const dialog = page.getByRole('dialog', { name: /Export document/ });
      await expect(dialog).toBeVisible();
      if (mode === 'static') await dialog.getByRole('radio', { name: /^Static HTML/ }).check();
      const downloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export HTML', exact: true }).click();
      const download = await downloadPromise;
      const file = path.join(artifacts, `tetris-${dev ? 'dev' : 'production'}-${mode}.html`);
      await download.saveAs(file);
      const html = await readFile(file, 'utf8');
      expect(html).toContain('.local-document .rmd-tetris');
      expect(html).toContain('original code written for this example');
      const offlineContext = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
      try {
        const exported = await offlineContext.newPage();
        const requests = [];
        exported.on('pageerror', error => errors.push(error.message));
        exported.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        exported.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
        await exported.goto(pathToFileURL(file).href);
        await expect(exported.locator(mode === 'interactive' ? '[data-tetris]' : '[data-tetris-static]')).toBeVisible();
        expect(await exported.locator('[data-tetris-board]').evaluate(element => getComputedStyle(element).display)).toBe('grid');
        if (mode === 'interactive') {
          const offlineGame = exported.locator('[data-tetris]');
          const before = Number(await offlineGame.getAttribute('data-tetris-moves'));
          await exported.locator('[data-tetris-drop]').click();
          await expect.poll(async () => Number(await offlineGame.getAttribute('data-tetris-moves'))).toBeGreaterThan(before);
        } else {
          expect(html).not.toMatch(/<script\b/);
        }
        expect(requests).toEqual([]);
      } finally { await offlineContext.close(); }
    });
  }
  await check('mobile preview retains a visible board and usable controls', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-editor-view-option="preview"]').click();
    await expect(game).toBeVisible();
    await expect(page.locator('[data-tetris-drop]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, `tetris-${dev ? 'dev' : 'production'}-mobile.png`), fullPage: true });
  status = 'passed';
} finally {
  await writeFile(path.join(artifacts, `verification-${dev ? 'dev' : 'production'}.json`), JSON.stringify({ status, baseURL, dev, checks, errors, workers }, null, 2));
  await browser?.close();
  if (dev) await server.close();
  else await new Promise(resolve => { server.httpServer.close(resolve); server.httpServer.closeAllConnections(); });
}
