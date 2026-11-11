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

  const trigger = (label) => page.getByLabel(label, { exact: true });
  const field = trigger('活动日期');
  await expect(field).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(field).toContainText('2026');
  await expect(trigger('Disabled date')).toBeDisabled();

  // The default theme renders the UIArc date picker: a button trigger with a
  // calendar dialog instead of a native date input.
  const assertLayout = async (label) => {
    const overflows = await page.locator('button[aria-haspopup="dialog"]').evaluateAll(buttons => buttons.flatMap(button => {
      const control = button.closest('.md-control');
      if (!control) return [];
      const available = control.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      return rect.left < available.left - 1 || rect.right > available.right + 1
        ? [{ label: button.getAttribute('aria-label') ?? button.textContent, width: rect.width, available: available.width }] : [];
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

  const empty = trigger('Empty date');
  await expect(empty).toContainText('请选择日期');
  await empty.click();
  await expect(page.getByRole('dialog', { name: 'Empty date calendar' })).toBeVisible();
  await page.getByRole('button', { name: /^今天/ }).click();
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  await expect(page.getByRole('dialog', { name: 'Empty date calendar' })).toBeHidden();
  await expect(page.locator('article')).toContainText(`Selected date: ${today}`);
  await assertLayout('populated date');

  await empty.click();
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(page.locator('article')).toContainText('Selected date:');
  await expect(empty).toContainText('请选择日期');
  await assertLayout('cleared date');

  await empty.focus();
  await expect(empty).toBeFocused();
  await page.emulateMedia({ colorScheme: 'dark' });
  await assertLayout('dark mode');
  await page.emulateMedia({ colorScheme: 'light' });
  await field.scrollIntoViewIfNeeded();
  await mkdir('artifacts/date-input', { recursive: true });
  await page.screenshot({ path: `artifacts/date-input/${engine}-375.png` });
  assert.deepEqual(errors, []);
  console.log(`PASS ${engine}: date controls fit 6 viewports and 2 narrow hosts; populated, empty, disabled and reactive states work`);
} finally {
  await browser?.close();
  await server.close();
}
