import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'mpa' });
let browser;
const checks = [];
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
  const primary = page.locator('#primary article');
  const system = page.locator('#system article');
  await page.goto(`${server.resolvedUrls.local[0]}tests/browser/theme-fixture.html`);
  await expect(primary).toHaveAttribute('data-rmd-theme', 'test-a');
  await check('nearest host mode, explicit light override and separate document scope', async () => {
    await expect.poll(() => page.evaluate(() => window.themeHarness.cleanDiagnosticCalls)).toBe(1);
    await expect(primary).toHaveAttribute('data-color-scheme', 'dark');
    await expect(page.locator('#forced-light article')).toHaveAttribute('data-color-scheme', 'light');
    await expect(page.locator('#forced-light article')).toHaveCSS('color', 'rgb(35, 35, 35)');
    await expect(primary).toHaveCSS('color', 'rgb(236, 235, 231)');
    await expect(primary).toHaveCSS('background-color', 'rgb(40, 25, 35)');
    await expect(page.locator('#forced-light article')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('#other input[type="range"]')).toHaveCount(0);
    await expect(page.locator('#other article')).toHaveCSS('--accent', 'rgb(20 90 40)');
    await expect(page.locator('#host-sentinel')).toHaveCSS('color', 'rgb(0, 0, 0)');
  });
  await check('custom styles reach controls, cards and SVG series', async () => {
    await expect(primary.getByRole('slider', { name: 'Accent', exact: true })).toHaveCSS('accent-color', 'rgb(250, 170, 200)');
    await expect(primary.getByRole('slider', { name: 'Explicit color', exact: true })).toHaveCSS('accent-color', 'rgb(255, 0, 0)');
    await expect(primary.locator('.md-card')).toHaveCSS('border-radius', '19px');
    await expect(primary.locator('.local-panel')).toHaveCSS('background-color', 'rgb(40, 25, 35)');
    const fills = await primary.locator('svg rect').evaluateAll(elements => elements.map(element => getComputedStyle(element).fill));
    assert.ok(fills.includes('rgb(240, 120, 170)'), `custom series color missing: ${fills}`);
  });
  await primary.getByRole('button', { name: 'Count increase', exact: true }).click();
  await expect(primary).toContainText('Count value: 3');
  await check('prop changes retain interactions and explicit mode wins', async () => {
    await page.evaluate(() => window.themeHarness.scheme('light'));
    await expect(primary).toHaveAttribute('data-color-scheme', 'light');
    await expect(primary.locator('.local-panel')).toHaveCSS('background-color', 'rgb(255, 250, 240)');
    await expect(primary).toContainText('Count value: 3');
    await page.keyboard.press('Tab');
    await primary.getByRole('slider', { name: 'Accent', exact: true }).focus();
    await expect(primary.getByRole('slider', { name: 'Accent', exact: true })).toHaveCSS('outline-style', 'solid');
  });
  await check('registration changes fall back and recover without state loss', async () => {
    await page.evaluate(() => window.themeHarness.registered(false));
    await expect(primary).toHaveAttribute('data-rmd-theme', 'default');
    await expect(primary).toContainText('Count value: 3');
    await expect.poll(() => page.evaluate(() => window.themeHarness.diagnostics.map(item => item.code))).toContain('local.theme.missing');
    await page.evaluate(() => window.themeHarness.registered(true));
    await expect(primary).toHaveAttribute('data-rmd-theme', 'test-a');
    await expect(primary).toContainText('Count value: 3');
  });
  await check('auto reacts to nearest ancestor attributes and OS preferences', async () => {
    await page.evaluate(() => window.themeHarness.scheme('auto'));
    await expect(primary).toHaveAttribute('data-color-scheme', 'dark');
    await page.locator('#dark-host').evaluate(element => element.setAttribute('data-theme', 'light'));
    await expect(primary).toHaveAttribute('data-color-scheme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(system).toHaveAttribute('data-color-scheme', 'dark');
    await expect(primary).toHaveAttribute('data-color-scheme', 'light');
    await page.locator('#dark-host').evaluate(element => element.removeAttribute('data-theme'));
    await expect(primary).toHaveAttribute('data-color-scheme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(primary).toHaveAttribute('data-color-scheme', 'light');
    await expect(system).toHaveAttribute('data-color-scheme', 'light');
  });
  await check('compile and theme warnings are delivered together', async () => {
    const codes = await page.evaluate(() => window.warningDiagnostics.map(item => item.code));
    assert.ok(codes.includes('local.theme.missing'), codes.join(', '));
    assert.ok(codes.some(code => !code.startsWith('local.theme.')), codes.join(', '));
    await expect(page.locator('#warnings').getByRole('button', { name: 'Warning survivor increase', exact: true })).toBeEnabled();
  });
  await check('375px layout and reduced-motion preferences', async () => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await mkdir('artifacts/theme', { recursive: true });
    await primary.screenshot({ path: 'artifacts/theme/light-375.png' });
    await page.evaluate(() => window.themeHarness.scheme('dark'));
    await expect(primary).toHaveAttribute('data-color-scheme', 'dark');
    await primary.screenshot({ path: 'artifacts/theme/dark-375.png' });
  });
  await check('unmount and remount release subscriptions', async () => {
    await page.evaluate(() => window.themeHarness.mounted(false));
    await expect(primary).toHaveCount(0);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => window.themeHarness.mounted(true));
    await expect(primary).toHaveAttribute('data-color-scheme', 'dark');
    await expect(primary).toContainText('Count value: 2');
    assert.deepEqual(errors, []);
  });
  console.log(`PASS ${checks.length} theme browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
