import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: { entries: ['scripts/fixtures/control-draft/fixture.html'] },
  server: { host: '127.0.0.1', port: 0 },
});
const results = [];
try {
  await server.listen();
  const url = `${server.resolvedUrls.local[0]}scripts/fixtures/control-draft/fixture.html`;
  let browser;
  const result = { engine: 'chromium', status: 'running', errors: [] };
  results.push(result);
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
    const page = await browser.newPage();
    page.on('pageerror', error => result.errors.push(error.message));
    await page.goto(url);

    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Ada');

    // A focused field keeps the reader's draft while the bound value changes.
    await name.focus();
    await name.fill('Local');
    await page.evaluate(() => window.runtime.setParameter('name', 'External'));
    await expect(page.locator('article')).toContainText('Name: External.');
    await expect(name).toHaveValue('Local');
    await name.blur();

    // IME composition updates the draft only; compositionend writes it.
    await name.focus();
    await name.fill('');
    await page.evaluate(() => document.activeElement?.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    ));
    await name.fill('李');
    assert.equal(await page.evaluate(() => window.runtime.getParameter('name')), '');
    await page.evaluate(() => document.activeElement?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '李' }),
    ));
    await expect.poll(() => page.evaluate(() => window.runtime.getParameter('name'))).toBe('李');

    const notes = page.getByRole('textbox', { name: 'Notes', exact: true });
    await notes.focus();
    await notes.fill('Local notes');
    await page.evaluate(() => window.runtime.setParameter('notes', 'External notes'));
    await expect(notes).toHaveValue('Local notes');
    await notes.fill('');
    await notes.dispatchEvent('compositionstart');
    await notes.fill('笔记');
    assert.equal(await page.evaluate(() => window.runtime.getParameter('notes')), '');
    await notes.dispatchEvent('compositionend', { data: '笔记' });
    await expect.poll(() => page.evaluate(() => window.runtime.getParameter('notes'))).toBe('笔记');

    // A partial number stays unwritten and reports on blur.
    const count = page.getByRole('textbox', { name: 'Count', exact: true });
    await count.focus();
    await count.fill('-');
    await expect.poll(() => page.evaluate(() => window.runtime.getParameter('count'))).toBe(2);
    await count.blur();
    await expect(page.locator('.local-number')).toContainText('Enter a valid number');
    await expect.poll(() => page.evaluate(() => window.runtime.getParameter('count'))).toBe(2);
    await count.fill('5');
    await expect(page.locator('article')).toContainText('Count: 5.');
    await count.dispatchEvent('compositionstart');
    await count.fill('7');
    assert.equal(await page.evaluate(() => window.runtime.getParameter('count')), 5);
    await count.dispatchEvent('compositionend', { data: '7' });
    await expect.poll(() => page.evaluate(() => window.runtime.getParameter('count'))).toBe(7);

    // Reset restores the draft and clears the field error.
    const code = page.getByRole('textbox', { name: 'Code', exact: true });
    const codeField = page.locator('.local-panel .local-input');
    await code.focus();
    await code.fill('abcd');
    await code.blur();
    await expect(codeField).toContainText('At most 3 characters');
    await page.getByRole('button', { name: 'Reset Draft', exact: true }).click();
    await expect(code).toHaveValue('ok');
    await expect(codeField).not.toContainText('At most 3 characters');
    await expect(page.locator('article')).toContainText('Code: ok.');

    assert.deepEqual(result.errors, []);
    result.status = 'passed';
    console.log('PASS control drafts: focused external update, IME composition, invalid number blur and panel reset');
  } catch (error) {
    result.status = 'failed';
    result.failure = error.stack ?? String(error);
    console.error(`FAIL control drafts: ${result.failure}`);
  } finally {
    await browser?.close();
  }
} finally {
  await server.close();
  await mkdir(join(root, 'artifacts/control-draft'), { recursive: true });
  await writeFile(join(root, 'artifacts/control-draft/report.json'), JSON.stringify(results, null, 2));
}
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
