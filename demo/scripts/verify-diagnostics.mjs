import { textareaWorkbenchURL, clickWorkbenchAction } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const checks = [];
const errors = [];

page.on('pageerror', (error) => errors.push(error.message));

async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS ' + name);
}

const status = () => page.locator('.status-chip');
const failed = /Compile failed|编译失败/;
const editor = () => page.locator('#source-editor');
const diagMessages = () => page.locator('.diagnostics-panel .diag-message');
const fieldError = () => page.locator('.local-input .field-error');
const toggleLanguage = () => page.locator('[data-testid="language-toggle"]');
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

async function fillSource(source) {
  await editor().fill(source);
}

try {
  await page.goto(textareaWorkbenchURL(baseURL));
  await clickWorkbenchAction(page, 'Show source');

  await check('a one-code-point emoji fits max-length="1" and a second code point is rejected', async () => {
    await fillSource('<input bind="name" label="Name" max-length="1">\n\nLength: {{ len(name) }}');
    await expect(status()).toContainText('Compiled');
    const input = page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(input).toBeVisible();
    await input.click();
    await page.keyboard.insertText('😀');
    await expect(input).toHaveValue('😀');
    await expect(fieldError()).toHaveCount(0);
    await expect(page.locator('.pane-preview .local-document')).toContainText('Length: 1');
    await page.keyboard.insertText('😀');
    await expect(input).toHaveValue('😀😀');
    await input.blur();
    await expect(fieldError()).toContainText('At most 1');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.pane-preview .local-document')).toContainText('Length: 1');
  });

  await check('Chinese diagnostics keep their source position and locate the error', async () => {
    await fillSource('{{ absent }}');
    await expect(status()).toContainText(failed);
    await expect(diagMessages().first()).toContainText('undeclared parameter');
    await diagMessages().first().click();
    // The editor applies diagnostic selections in requestAnimationFrame.
    await expect.poll(() => editor().evaluate((element) => element.selectionStart)).toBe(3);
    const englishSelection = await editor().evaluate((element) => element.selectionStart);

    await toggleLanguage().click();
    await fillSource('{{ absent }}');
    await expect(status()).toContainText(failed);
    await expect(diagMessages().first()).toContainText('未声明');
    await diagMessages().first().click();
    await expect.poll(() => editor().evaluate((element) => element.selectionStart)).toBe(englishSelection);
    const chineseSelection = await editor().evaluate((element) => element.selectionStart);
    expect(chineseSelection).toBe(englishSelection);

    // Switching back loads the saved English draft: same source, same code and
    // position, only the display language changes.
    await toggleLanguage().click();
    await expect(status()).toContainText(failed);
    await expect(diagMessages().first()).toContainText('undeclared parameter');
    await toggleLanguage().click();
    await expect(status()).toContainText(failed);
    await expect(diagMessages().first()).toContainText('未声明');
    await page.screenshot({ path: 'artifacts/diagnostics-zh.png', fullPage: true });
  });

  await check('diagnostics and length errors stay visible at 375px', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.locator('.diagnostics-panel')).toBeVisible();
    await expect(diagMessages().first()).toBeVisible();
    const width = await page.locator('.diagnostics-panel').evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(375);
    expect(await fits()).toBe(true);
    await page.screenshot({ path: 'artifacts/diagnostics-mobile.png', fullPage: true });
  });

  expect(errors).toEqual([]);
  console.log(`\n${checks.length} diagnostic checks passed.`);
} finally {
  await browser.close();
}
