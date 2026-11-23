import { chromium, firefox, webkit, expect } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const engines = (process.env.PLAYWRIGHT_ENGINE ?? 'chromium,firefox,webkit').split(',');
const types = { chromium, firefox, webkit };
if (engines.some(engine => !types[engine])) throw new Error('Unknown PLAYWRIGHT_ENGINE');
const reportPath = process.env.REQUIRED_FORM_REPORT ?? join(root, 'artifacts/required-form/report.json');
const fixture = 'tests/browser/required-form-fixture.html';
const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: { entries: [fixture] },
  server: { host: '127.0.0.1', port: 0 },
});
const results = [];
try {
  await server.listen();
  const url = `${server.resolvedUrls.local[0]}${fixture}`;
  for (const engine of engines) {
    let browser;
    const channel = engine === 'chromium' ? process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' : null;
    const result = { engine, channel, status: 'running', errors: [] };
    results.push(result);
    try {
      browser = await types[engine].launch({ headless: true, ...(channel !== null && channel !== 'chromium' ? { channel } : {}) });
      // Record the version the driver actually launched so evidence names a
      // concrete browser build, not only the requested channel.
      result.browserName = browser.browserType().name();
      result.browserVersion = browser.version();
      const page = await browser.newPage();
      page.on('pageerror', error => result.errors.push(error.message));
      await page.goto(url, { waitUntil: 'commit' });
      const organizer = page.getByRole('textbox', { name: '组织者', exact: true });
      await expect(organizer).toBeVisible({ timeout: 60_000 });
      // This form deliberately has no novalidate: host validation stays active.
      expect(await page.locator('form').evaluate(form => form.checkValidity())).toBe(true);
      for (const control of await page.locator('article input:not([type=range]), article textarea').all()) {
        await expect(control).toHaveAttribute('aria-required', 'true');
        expect(await control.evaluate(input => input.required)).toBe(false);
      }
      await page.getByRole('textbox', { name: 'Host text', exact: true }).press('Enter');
      await expect(page.getByLabel('Submissions', { exact: true })).toHaveText('1');
      await page.getByRole('button', { name: 'Host submit', exact: true }).click();
      await expect(page.getByLabel('Submissions', { exact: true })).toHaveText('2');
      await expect(page.getByLabel('Native invalid events', { exact: true })).toHaveText('0');

      await organizer.focus();
      await organizer.press('Tab');
      await expect(organizer).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('.local-input').first()).toContainText('This field is required');
      await organizer.fill('Ada');
      await organizer.blur();
      await expect(page.locator('article')).toContainText('Name: Ada.');
      await organizer.fill('');
      await organizer.blur();
      await expect(organizer).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('article')).toContainText('Name: Ada.');

      const notes = page.getByRole('textbox', { name: 'Notes', exact: true });
      await notes.focus();
      await notes.press('Tab');
      await expect(notes).toHaveAttribute('aria-invalid', 'true');
      const day = page.getByLabel('Day', { exact: true });
      await day.focus();
      await day.blur();
      await expect(day).toHaveAttribute('aria-invalid', 'true');
      expect(await page.locator('form').evaluate(form => form.checkValidity())).toBe(true);
      await page.getByRole('button', { name: 'Count increase', exact: true }).click();
      await expect(page.locator('article')).toContainText('Count: 1.');
      await expect(page.getByLabel('Submissions', { exact: true })).toHaveText('2');
      await page.getByRole('textbox', { name: 'Host text', exact: true }).press('Enter');
      await expect(page.getByLabel('Submissions', { exact: true })).toHaveText('3');

      await page.getByRole('textbox', { name: 'Host required', exact: true }).fill('');
      await page.getByRole('button', { name: 'Host submit', exact: true }).click();
      await expect(page.getByLabel('Submissions', { exact: true })).toHaveText('3');
      expect(await page.locator('form').evaluate(form => form.checkValidity())).toBe(false);
      expect(result.errors).toEqual([]);
      result.status = 'passed';
      console.log(`PASS ${engine}${channel ? ` (${channel})` : ''} ${result.browserVersion}: required components preserve local errors without blocking host Enter or submit; host constraints stay active`);
    } catch (error) {
      result.status = 'failed';
      result.failure = error.stack ?? String(error);
      console.error(`FAIL ${engine}${channel ? ` (${channel})` : ''}: ${result.failure}`);
    } finally { await browser?.close(); }
  }
} finally {
  await server.close();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(results, null, 2));
}
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
