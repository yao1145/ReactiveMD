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
  for (const width of [1100, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/tests/browser/constraints-fixture.html`);
      await page.getByRole('heading', { name: 'Check a workshop plan' }).waitFor();
      const budget = page.locator('input').and(page.getByLabel('Budget', { exact: true }));
      await budget.fill('100');
      await budget.blur();
      await page.getByText('The estimated $320.00 exceeds the budget.', { exact: true }).waitFor();
      await expect(page.locator('.md-badge-warning')).toHaveCount(1);
      const described = await page.locator('[aria-invalid="true"][aria-describedby]').count();
      assert.ok(described >= 1, 'failed rules must be associated with their fields');
      await page.locator('input').and(page.getByLabel('End date', { exact: true })).fill('2026-10-20');
      await page.getByText('End date must be on or after start date.', { exact: true }).waitFor();
      await budget.fill('1000');
      await budget.blur();
      await expect(page.getByText('The estimated $320.00 exceeds the budget.', { exact: true })).toBeHidden();
      await page.getByRole('checkbox', { name: 'Physics', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Chemistry', exact: true }).check();
      const selected = page.getByRole('table', { name: 'Selected subjects', exact: true });
      await selected.getByRole('cell', { name: 'physics', exact: true }).waitFor();
      await selected.getByRole('cell', { name: 'chemistry', exact: true }).waitFor();
      const stableTable = page.getByRole('table', { name: 'Stable rows', exact: true });
      const chemistry = await stableTable.getByRole('row').filter({ hasText: 'chemistry' }).elementHandle();
      assert.ok(chemistry);
      await page.getByRole('checkbox', { name: 'Reverse rows', exact: true }).check();
      await expect(stableTable.locator('tbody tr').first()).toContainText('physics');
      assert.equal(await chemistry.evaluate(node => node.isConnected), true, 'reorder must preserve the row node');
      await page.getByRole('checkbox', { name: 'Duplicate rows', exact: true }).check();
      await expect(stableTable).toHaveCount(0);
      await page.getByRole('checkbox', { name: 'Duplicate rows', exact: true }).uncheck();
      await page.getByRole('table', { name: 'Stable rows', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reset Workshop plan', exact: true }).click();
      await expect(budget).toHaveValue('500');
      await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
      await expect(page.locator('.md-badge-success')).toHaveCount(1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: fileURLToPath(new URL(`../artifacts/constraints-${width}.png`, import.meta.url)), fullPage: true });
    } finally { await context.close(); }
  }
  console.log('PASS constraints: cross-field hints, dynamic tones, generated rows, stable DOM identity, duplicate-key recovery, reset, desktop/mobile');
} finally {
  await browser?.close();
  await server.close();
}
