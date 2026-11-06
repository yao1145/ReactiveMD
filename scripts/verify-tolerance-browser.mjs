import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const directory = 'artifacts/tolerance/browser';
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'mpa' });
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}tests/browser/html-compat-fixture.html`);
    await page.waitForFunction(() => typeof window.setHtmlCase === 'function');
    const setCase = async (source, strict = false) => {
      await page.evaluate(({ source, strict }) => window.setHtmlCase(source, { strict }), { source, strict });
    };

    for (const strict of [true, false]) {
      await setCase('<details>\n  <summary>1145</summary>\n  1145\n</details>', strict);
      const trigger = page.getByRole('button', { name: '1145', exact: true });
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.local-accordion')).toHaveCount(1);
      const panel = page.locator('.local-disclosure-panel');
      await expect(panel).toBeHidden();
      await trigger.click();
      await expect(panel).toBeVisible();
      await expect(panel).toHaveText('1145');
      await trigger.press('Enter');
      await expect(panel).toBeHidden();
      await trigger.press('Space');
      await expect(panel).toBeVisible();
      await expect(page.locator('article')).not.toContainText('Details');
      await page.screenshot({ path: `${directory}/${width}-details-${strict ? 'strict' : 'relaxed'}.png` });
    }

    await setCase('<details open>\n<summary>Outer <strong>title</strong></summary>\n<details>\n<summary>Inner</summary>\n<counter bind="inside" label="Inside" initial="2">\n</details>\n</details>');
    await expect(page.getByRole('button', { name: 'Outer title', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Inner', exact: true }).click();
    await page.getByRole('button', { name: 'Inside increase', exact: true }).click();
    await expect(page.locator('.local-disclosure-panel').last()).toContainText('3');

    const broken = '<alert>\nBroken {{ missing }}\n\n## After\n\n**Readable**\n\n<counter bind="count" label="Count" initial="2">\n\nCurrent: {{ count }}';
    await setCase(broken);
    await expect(page.locator('.local-fallback')).toContainText('<alert>\nBroken {{ missing }}');
    await expect(page.getByRole('heading', { name: 'After', exact: true })).toBeVisible();
    await expect(page.locator('strong')).toHaveText('Readable');
    await page.getByRole('button', { name: 'Count increase', exact: true }).click();
    await expect(page.locator('article')).toContainText('Current: 3');
    assert.equal(await page.evaluate(() => window.htmlFallbackDiagnostics.some(d => d.severity === 'error')), false);
    await page.screenshot({ path: `${directory}/${width}-recovered-article.png` });

    await setCase('<p>one<p>two\n\n## Preserved\n\n**After**');
    await expect(page.locator('article p').filter({ hasText: /^one$/ })).toHaveCount(1);
    await expect(page.locator('article p').filter({ hasText: /^two$/ })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Preserved', exact: true })).toBeVisible();

    await setCase(broken, true);
    await expect.poll(() => page.evaluate(() => window.htmlFallbackDiagnostics.some(d => d.code === 'local.tag.unclosed' && d.severity === 'error'))).toBe(true);
    assert.deepEqual(errors, []);
    results.push({ width, detailsStrict: true, detailsRelaxed: true, nested: true, keyboard: true, htmlRepair: true, recoveredArticle: true, pageErrors: errors });
    await page.close();
  }
  await writeFile(`${directory}/report.json`, JSON.stringify({ status: 'passed', createdAt: new Date().toISOString(), results }, null, 2));
  console.log('PASS strict/relaxed article recovery and details interaction at desktop/mobile widths');
} finally {
  await browser?.close();
  await server.close();
}
