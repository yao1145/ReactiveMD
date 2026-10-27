import { clickWorkbenchAction, replaceWorkbenchSource } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await context.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('artifacts', { recursive: true });

async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function noOverflow() {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

try {
  await page.goto(baseURL);
  await check('guide code uses one surface and copies literal source in both languages and themes', async () => {
    for (const language of ['en', 'zh']) {
      if (language === 'zh') await page.getByTestId('language-toggle').click();
      await page.getByRole('button', { name: language === 'en' ? 'User Guide' : '使用指南', exact: true }).click();
      const block = page.locator('.md-code-block').nth(1);
      const original = await block.locator('code').textContent();
      expect(original).toContain('{{');
      expect(original).toContain('<slider');
      await block.getByRole('button', { name: language === 'en' ? 'Copy code' : '复制代码', exact: true }).click();
      expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(original.replace(/\r\n/g, '\n'));
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
          const style = await block.locator('pre').evaluate(node => ({
            background: getComputedStyle(node).backgroundColor,
            color: getComputedStyle(node).color,
            cardColor: getComputedStyle(node.parentElement).color,
            cardBackground: getComputedStyle(node.parentElement).backgroundColor,
            toolbarBackground: getComputedStyle(node.parentElement.querySelector('.md-code-block-toolbar')).backgroundColor,
            margin: getComputedStyle(node).marginTop,
          }));
          expect(style.background).toBe('rgba(0, 0, 0, 0)');
          expect(style.color).toBe(style.cardColor);
          expect(style.cardBackground).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(11, 18, 32)');
          expect(style.toolbarBackground).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(9, 15, 28)');
          expect(style.margin).toBe('0px');
          await noOverflow();
        }
      }
    }
    await page.getByTestId('language-toggle').click();
    await page.getByRole('button', { name: 'Playground', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  });

  const editor = page.locator('#source-editor');
  const showSource = async () => {
    if (!await editor.isVisible()) await clickWorkbenchAction(page, 'Show source');
  };
  const documents = page.locator('.doc-select');
  const fixture = '# My estimate\n\n<slider bind="people" label="Guests" initial="3" min="1" max="20">\n\nTotal: {{ people * 100 }} USD.';
  let originalId;
  let duplicateId;
  await check('create and name a personal document, autosave, and reopen after reload', async () => {
    await page.getByRole('button', { name: 'My documents', exact: true }).click();
    await clickWorkbenchAction(page, 'New document');
    await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Workshop estimate');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(editor).toBeVisible();
    await replaceWorkbenchSource(page, fixture);
    await expect(page.locator('.doc-save-state')).toHaveText('Saved');
    originalId = await documents.inputValue();
    await page.reload();
    await showSource();
    await expect(documents).toHaveValue(originalId);
    await expect(editor).toHaveValue(fixture);
  });

  await check('rename and duplicate independently, and flush edits before switching', async () => {
    await clickWorkbenchAction(page, 'Rename');
    const rename = page.getByRole('form', { name: 'Rename document', exact: true });
    await rename.getByRole('textbox', { name: 'Document name', exact: true }).fill('My workshop');
    await rename.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(documents.locator('option:checked')).toHaveText('My workshop');
    await clickWorkbenchAction(page, 'Duplicate');
    await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Workshop alternative');
    await page.getByRole('button', { name: 'Create copy', exact: true }).click();
    duplicateId = await documents.inputValue();
    expect(duplicateId).not.toBe(originalId);
    await expect(editor).toHaveValue(fixture);
    await replaceWorkbenchSource(page, `${fixture}\n\nOnly in the copy.`);
    await documents.selectOption(originalId);
    await expect(editor).toHaveValue(fixture);
    await documents.selectOption(duplicateId);
    await expect(editor).toHaveValue(`${fixture}\n\nOnly in the copy.`);
    await replaceWorkbenchSource(page, `${fixture}\n\nSaved on pagehide.`);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();
    await showSource();
    await expect(editor).toHaveValue(`${fixture}\n\nSaved on pagehide.`);
  });

  await check('interface language preserves personal source, name, and selection', async () => {
    const source = await editor.inputValue();
    await page.getByTestId('language-toggle').click();
    await expect(editor).toHaveValue(source);
    await expect(documents).toHaveValue(duplicateId);
    await expect(documents.locator('option:checked')).toHaveText('Workshop alternative');
    await page.getByTestId('language-toggle').click();
    await expect(editor).toHaveValue(source);
  });

  await check('Markdown export uses the document name and exact current source', async () => {
    await clickWorkbenchAction(page, 'Export');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Download Markdown', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('Workshop alternative.reactive.md');
    const path = await download.path();
    expect(await readFile(path, 'utf8')).toBe(await editor.inputValue());
  });

  await check('storage failure reports unsaved data, preserves edits, and retries', async () => {
    await page.evaluate(() => {
      window.restoreDocumentStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'reactive-md:documents:v1') throw new DOMException('Storage full', 'QuotaExceededError');
        return window.restoreDocumentStorage.call(this, key, value);
      };
    });
    await replaceWorkbenchSource(page, '# Retained during storage failure');
    await expect(page.locator('.doc-save-state')).toHaveText('Not saved');
    await documents.selectOption(originalId);
    await expect(editor).toHaveValue(fixture);
    await documents.selectOption(duplicateId);
    await expect(editor).toHaveValue('# Retained during storage failure');
    await page.evaluate(() => { Storage.prototype.setItem = window.restoreDocumentStorage; });
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect(page.locator('.doc-save-state')).toHaveText('Saved');
    await page.reload();
    await showSource();
    await expect(editor).toHaveValue('# Retained during storage failure');
  });

  await check('HTML export uses the personal name and opens as a standalone document', async () => {
    await replaceWorkbenchSource(page, fixture);
    await expect(page.locator('.status-chip')).toContainText('Compiled');
    await expect(page.locator('.preview-stage')).toContainText('My estimate');
    await clickWorkbenchAction(page, 'Export');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /^Static HTML/ }).check();
    const ready = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export HTML', exact: true }).click();
    const download = await ready;
    expect(download.suggestedFilename()).toBe('Workshop alternative.html');
    const output = resolve('artifacts/personal-document.html');
    await download.saveAs(output);
    const exported = await context.newPage();
    try {
      await exported.goto(pathToFileURL(output).href);
      await expect(exported.getByRole('heading', { name: 'My estimate', exact: true })).toBeVisible();
      await expect(exported.locator('body')).toContainText('300 USD');
    } finally { await exported.close(); }
  });

  await check('examples stay separate, and copying an example and importing create independent documents', async () => {
    await page.getByRole('button', { name: 'Try examples', exact: true }).click();
    const examples = page.locator('#example-select');
    await expect(examples.locator('option')).toHaveCount(8);
    await examples.selectOption('functions');
    const exampleSource = await editor.inputValue();
    const options = page.locator('.workbench-options');
    await options.locator(':scope > summary').click();
    await page.getByRole('button', { name: 'Save copy', exact: true }).click();
    await expect(editor).toHaveValue(exampleSource);
    expect(await documents.inputValue()).not.toBe(duplicateId);
    await replaceWorkbenchSource(page, '# Independent example copy');
    const count = await documents.locator('option').count();
    await page.locator('.author-tools input[type=file]').setInputFiles({
      name: 'import.reactive.md', mimeType: 'text/markdown', buffer: Buffer.from('# Imported work\n\nIndependent source.'),
    });
    await expect(documents.locator('option')).toHaveCount(count + 1);
    await expect(editor).toHaveValue('# Imported work\n\nIndependent source.');
    await page.getByRole('button', { name: 'Try examples', exact: true }).click();
    await expect(examples).toHaveValue('functions');
    await expect(editor).toHaveValue(exampleSource);
    await page.getByRole('button', { name: 'My documents', exact: true }).click();
    await expect(editor).toHaveValue('# Imported work\n\nIndependent source.');
  });

  await check('compact controls and document forms fit desktop and phone screens', async () => {
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow();
      await clickWorkbenchAction(page, 'New document');
      await expect(page.getByRole('textbox', { name: 'Document name', exact: true })).toBeFocused();
      await noOverflow();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.locator('.workbench-options > summary')).toBeFocused();
      await page.screenshot({ path: `artifacts/playground-documents-${width}.png` });
    }
  });

  expect(errors).toEqual([]);
  await writeFile('artifacts/playground-library-report.json', JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
