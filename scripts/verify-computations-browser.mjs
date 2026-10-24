import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  for (const options of [
    { locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 1100, height: 1000 } },
    { locale: 'de-DE', timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 844 } },
  ]) {
    const context = await browser.newContext(options);
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/tests/browser/computations-fixture.html`);
      const document = page.locator('.local-document');
      await document.getByText('Invoice: $25.00.', { exact: false }).waitFor();
      assert.match(await document.innerText(), /Calendar hours: 24/);
      assert.equal(await page.locator('.local-fallback').count(), 0);
      assert.ok(await page.locator('svg').count() >= 2);
      const quantity = page.getByLabel('Quantity', { exact: true });
      await quantity.fill('10');
      await quantity.blur();
      await document.getByText('Invoice: $125.00.', { exact: false }).waitFor();
      await document.getByText('Eligible for bulk delivery.').waitFor();
      await quantity.fill('0');
      await quantity.blur();
      await document.getByText('Invoice: $0.00.', { exact: false }).waitFor();
      assert.equal(await document.getByText('Eligible for bulk delivery.').isVisible(), false);
      await page.locator('.local-error').waitFor();
      await quantity.fill('4');
      await quantity.blur();
      await document.getByText('Reciprocal: 25.00.', { exact: false }).waitFor();
      assert.equal(await page.locator('.local-error').count(), 0);
      const reset = page.getByRole('button', { name: /Restore defaults|Reset/ }).first();
      await reset.click();
      await document.getByText('Invoice: $25.00.', { exact: false }).waitFor();
      await expect(quantity).toHaveValue('2');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: fileURLToPath(new URL(`../artifacts/computations-${options.locale}.png`, import.meta.url)), fullPage: true });
    } finally { await context.close(); }
  }
  console.log('PASS computations: live edits, conditions, chart/plot, error recovery, reset, locales/timezones, desktop/mobile');
} finally {
  await browser?.close();
  await server.close();
}
