import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { openWorkbench, clickWorkbenchAction, replaceWorkbenchSource } from './workbench-ui.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = process.env.DEMO_URL ? null : await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server?.listen();
const baseURL = process.env.DEMO_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`;
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chromium';
const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true });
await mkdir('artifacts/browser-smoke', { recursive: true });

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openWorkbench(page, baseURL);

    await expect(page.locator('.local-document')).toBeVisible();
    await expect(page.getByRole('slider', { name: 'People', exact: true })).toBeVisible();

    const slider = page.getByRole('slider', { name: 'People', exact: true });
    await slider.focus();
    await slider.press('ArrowRight');
    await expect(page.locator('.local-document')).toContainText('Current headcount: 3');

    if (width === 390) {
      await clickWorkbenchAction(page, 'Show source');
      await expect(page.locator('#source-editor')).toBeVisible();
    } else {
      await clickWorkbenchAction(page, 'Show source');
      await clickWorkbenchAction(page, /^Export/);
      await expect(page.getByRole('dialog')).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('dialog').getByRole('button', {name: 'Export HTML', exact: true}).click();
      const download = await downloadPromise;
      const htmlPath = resolve('artifacts/browser-smoke/export.html');
      await download.saveAs(htmlPath);
      await expect(page.getByRole('dialog')).toBeHidden();
      const offline = await browser.newPage();
      const offlineErrors = [];
      const requests = [];
      offline.on('pageerror', error => offlineErrors.push(error.message));
      offline.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await offline.goto(pathToFileURL(htmlPath).href);
      await expect(offline.locator('.local-document')).toContainText('Current headcount: 2');
      expect(offlineErrors).toEqual([]);
      expect(requests).toEqual([]);
      await offline.close();
    }
    await replaceWorkbenchSource(page, '# Migration check\n\nWorker boundary {{ 2 + 1 }}');
    await expect(page.locator('.local-document')).toContainText('Worker boundary 3');
    expect(errors).toEqual([]);
    await page.close();
  }
  console.log('PASS browser smoke (desktop and mobile)');
} finally {
  await browser.close();
  await server?.close();
}
