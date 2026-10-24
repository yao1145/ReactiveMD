import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, devices, expect } from '@playwright/test';
import { createServer } from 'vite';

const engine = process.env.PLAYWRIGHT_ENGINE ?? 'chromium';
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'mpa' });
let browser;
try {
  await server.listen();
  browser = engine === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tests/browser/date-input-fixture.html`);
  await expect(page.getByLabel('活动日期', { exact: true })).toHaveValue('2026-11-01');

  const assertLayout = async (label) => {
    const overflows = await page.locator('input[type="date"]').evaluateAll(inputs => inputs.flatMap(input => {
      const field = input.parentElement.getBoundingClientRect();
      const rect = input.getBoundingClientRect();
      return rect.left < field.left - 1 || rect.right > field.right + 1
        ? [{ label: input.labels[0].textContent, width: rect.width, available: field.width }] : [];
    }));
    assert.deepEqual(overflows, [], label);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page overflow`);
  };

  for (const width of [320, 375, 390, 430, 844, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await assertLayout(`${engine} viewport ${width}`);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  for (const width of [180, 240]) {
    await page.locator('#root').evaluate((root, width) => { root.style.width = `${width}px`; }, width);
    await assertLayout(`${engine} host ${width}`);
  }
  await page.locator('#root').evaluate(root => { root.style.removeProperty('width'); });
  const date = page.getByLabel('Empty date', { exact: true });
  await expect(date).toHaveAttribute('min', '2026-01-01');
  await expect(date).toHaveAttribute('max', '2026-12-31');
  await expect(page.getByLabel('Disabled date', { exact: true })).toBeDisabled();
  await date.fill('2026-10-24');
  await expect(page.locator('article')).toContainText('Selected date: 2026-10-24');
  await assertLayout('populated date');
  await date.fill('');
  await expect(date).toHaveValue('');
  await assertLayout('cleared date');
  await date.focus();
  await expect(date).toBeFocused();
  await page.emulateMedia({ colorScheme: 'dark' });
  await assertLayout('dark mode');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByLabel('活动日期', { exact: true }).scrollIntoViewIfNeeded();
  await mkdir('artifacts/date-input', { recursive: true });
  await page.screenshot({ path: `artifacts/date-input/${engine}-375.png` });
  assert.deepEqual(errors, []);
  console.log(`PASS ${engine}: date controls fit 6 viewports and 2 narrow hosts; populated, empty, disabled and reactive states work`);
} finally {
  await browser?.close();
  await server.close();
}
