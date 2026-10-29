import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${address.port}/tests/browser/draft3-adoption-fixture.html`);
      const amount = page.getByLabel('Amount', { exact: true });
      await expect(amount).toHaveValue('3');
      await amount.fill('5');
      await amount.blur();
      await expect(page.locator('#calls')).toHaveText('1');
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.getByRole('button', { name: 'Add external', exact: true }).click();
        await expect(page.locator('.local-interpolation').last()).toHaveText('4');
        await expect(amount).toHaveValue('5');
        await expect(page.locator('#calls')).toHaveText('1');
        await page.getByRole('button', { name: 'Remove external', exact: true }).click();
        await expect(page.locator('.local-interpolation')).toHaveCount(1);
        await expect(amount).toHaveValue('5');
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  console.log('PASS draft3 adoption: stable external props, add/remove/readd declarations, parameter retention, initialization and callback isolation, desktop/mobile');
} finally { await browser?.close(); await server.close(); }
