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
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/tests/browser/dynamic-fixture.html`);
      await page.locator('.md-document').waitFor();

      const total = page.locator('.local-interpolation').last();
      const calls = page.locator('#parameter-calls');
      await expect(total).toHaveText('144');
      await expect(calls).toHaveText('0');

      // External updates change computed content without touching parameters.
      await page.getByRole('button', { name: 'Rate 7.3', exact: true }).click();
      await expect(total).toHaveText('146');
      await expect(calls).toHaveText('0');
      await expect(page.locator('#parameters')).not.toContainText('exchangeRate');

      // Numeric inputs and native sliders share the dynamic step origin.
      const fractional = page.getByLabel('Offset number', { exact: true });
      await fractional.fill('2.5');
      await fractional.blur();
      await expect(page.locator('#parameters')).toContainText('"fraction":2.5');
      const fractionalSlider = page.getByRole('slider', { name: 'Offset slider', exact: true });
      await fractionalSlider.focus();
      await fractionalSlider.press('ArrowRight');
      await expect(page.locator('#parameters')).toContainText('"fractionSlider":2.5');

      // A host rating control shares its value with the built-in number.
      await page.getByRole('button', { name: '5 stars', exact: true }).click();
      await expect(page.locator('.local-interpolation').first()).toHaveText('5');
      await expect(page.getByLabel('Numeric rating', { exact: true })).toHaveValue('5');
      await expect(calls).toHaveText('3');
      await expect(page.locator('#parameters')).toContainText('"rating":5');
      await expect(page.locator('#parameters')).not.toContainText('exchangeRate');

      // Narrowing a dynamic max keeps the existing value and shows the error.
      await page.getByRole('button', { name: 'Inventory 1', exact: true }).click();
      const quantity = page.getByLabel('Quantity', { exact: true });
      const guests = page.getByLabel('Guests', { exact: true });
      await expect(quantity).toHaveAttribute('max', '1');
      await expect(quantity).toHaveValue('2');
      await expect(quantity.locator('..').locator('.field-error')).toHaveText('Must be at most 1');
      const retained = page.locator('.local-slider').filter({ has: page.getByRole('slider', { name: 'Retained slider', exact: true }) });
      await expect(retained.locator('.md-slider-value')).toHaveText('4');
      await expect(retained.locator('[data-local-print-value]')).toHaveText('4');
      await expect(retained.locator('.field-error')).toHaveText('Must be at most 1');

      await quantity.fill('1');
      await quantity.blur();
      await expect(quantity).toHaveValue('1');
      await expect(guests).toHaveAttribute('max', '4');
      await expect(guests).toHaveValue('6');
      await page.getByText('Must be at most 4', { exact: true }).waitFor();
      await expect(guests).toHaveAttribute('aria-invalid', 'true');

      await guests.fill('4');
      await guests.blur();
      await expect(guests).toHaveValue('4');
      await expect(page.getByText('Must be at most 4', { exact: true })).toBeHidden();

      // Reset restores the panel subtree but not independent controls outside it.
      await page.getByRole('button', { name: 'Reset Plan', exact: true }).click();
      await expect(quantity).toHaveValue('2');
      await expect(page.getByLabel('Numeric rating', { exact: true })).toHaveValue('4');
      await expect(guests).toHaveValue('4');
      await expect(calls).toHaveText('6');

      // Clicking preview text reports a source range without editing.
      await total.click();
      await expect(page.locator('#target')).toContainText(/^interpolation:\d+-\d+$/);

      if (width === 390) {
        const overflow = await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          elements: [...document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > window.innerWidth || element.scrollWidth > element.clientWidth).map((element) => ({
            tag: element.tagName, id: element.id, className: element.getAttribute('class'), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
          })),
        }));
        assert.ok(overflow.scrollWidth <= overflow.width, JSON.stringify(overflow));
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: fileURLToPath(new URL(`../artifacts/dynamic-${width}.png`, import.meta.url)), fullPage: true });
    } finally {
      await context.close();
    }
  }
  console.log('PASS dynamic: external updates, host binding sync, dynamic step base, retained slider values, dynamic narrowing, native attributes, reset, source navigation, desktop/mobile');
} finally {
  await browser?.close();
  await server.close();
}
