import { openWorkbench, clickWorkbenchAction, replaceWorkbenchSource, readEditor, expectEditorSource } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
const artifacts = path.resolve('artifacts/image-assets');
await mkdir(artifacts, { recursive: true });
const errors = [];
const check = (name) => console.log(`PASS ${name}`);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await openWorkbench(page,baseURL);
  await clickWorkbenchAction(page, 'Show source');
  const editor = page.locator('#source-editor');
  const source = '# Image document\n\n<slider bind="people" label="People" initial="2" min="1" max="10">\n\nBefore AFTER';
  await replaceWorkbenchSource(page, source);
  // Keep the selector independent of surrounding workbench layout.
  const mainPanel = page.locator('.workbench-options .image-assets');
  const addPanel = page.locator('.image-assets-compact');
  const picker = addPanel.locator('input[type=file]');
  await expect(addPanel.getByRole('button', { name: 'Add images', exact: true })).toBeEnabled();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 12; canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#267b61'; ctx.fillRect(0, 0, 12, 8);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const image = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  await editor.focus();
  await editor.evaluate((el) => window.rmdEditorProbe.select(el,window.rmdEditorProbe.read(el).indexOf('AFTER'), window.rmdEditorProbe.read(el).indexOf('AFTER') + 5));
  await picker.setInputFiles(image);
  await expectEditorSource(editor,/Before \n\n!\[photo.png\]\(assets\/photo-[a-f\d]+\.png\)\n\n$/);
  await expect(mainPanel.locator('.image-asset-row')).toHaveCount(1);
  await expect(page.locator('.preview-stage .md-document img')).toHaveCount(1);
  await expect.poll(() => page.locator('.preview-stage .md-document img').first().evaluate(img => img.naturalWidth)).toBe(12);
  const inserted = await readEditor(editor);
  await editor.press('Control+z');
  await expectEditorSource(editor,source);
  await editor.press('Control+Shift+Z');
  await expectEditorSource(editor,inserted);
  check('file selection replaces the editor selection; preview, undo and redo work');

  await picker.setInputFiles([
    { ...image, name: 'valid.png' },
    { name: 'attack.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"/>') },
  ]);
  await expect(addPanel.getByRole('alert')).toContainText('SVG');
  await expect(mainPanel.locator('.image-asset-row')).toHaveCount(1);
  await expectEditorSource(editor,inserted);
  await picker.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(addPanel.getByRole('alert')).toContainText('8 MiB');
  await picker.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from([137,80,78,71,13,10,26,10]) });
  await expect(addPanel.getByRole('alert')).toContainText('cannot be decoded');
  check('invalid batches, oversized and truncated images leave source and resources unchanged');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async data => {
    const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, png);
  await editor.focus();
  await editor.press('Control+End');
  await editor.press('Control+v');
  await expect(mainPanel.locator('.image-asset-row')).toHaveCount(2);
  await expect(page.locator('.preview-stage .md-document img')).toHaveCount(2);
  check('native clipboard paste adds an image resource and Markdown reference');

  await replaceWorkbenchSource(page, `${await readEditor(editor)}\n\n![Local](images/local.png)`);
  await clickWorkbenchAction(page, /^Export/);
  const dialog = page.getByRole('dialog');
  const exportButton = dialog.getByRole('button', { name: 'Export HTML', exact: true });
  await expect(exportButton).toBeDisabled();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Choose image for images/local.png', exact: true }).click();
  await (await chooser).setFiles(image);
  await expect(exportButton).toBeEnabled();
  check('missing references can be filled in the export dialog without changing source');

  for (const mode of ['interactive', 'static']) {
    if (mode === 'static') {
      await clickWorkbenchAction(page, /^Export/);
      await dialog.getByRole('radio', { name: /^Static HTML/ }).check();
    }
    const downloadEvent = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadEvent;
    const output = path.join(artifacts, `images-${mode}.html`);
    await download.saveAs(output);
    if (mode === 'static') expect(/<script\b/.test(await readFile(output, 'utf8'))).toBe(false);
    const exported = await context.newPage();
    const requests = [];
    exported.on('pageerror', error => errors.push(error.message));
    exported.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await exported.goto(pathToFileURL(output).href);
    const imgs = exported.locator('img');
    await expect(imgs).toHaveCount(3);
    await expect.poll(() => imgs.evaluateAll(images => images.every(img => img.complete && img.naturalWidth === 12))).toBe(true);
    if (mode === 'interactive') {
      await exported.getByRole('slider', { name: 'People', exact: true }).fill('4');
      await expect(imgs).toHaveCount(3);
    }
    expect(requests).toEqual([]);
    await exported.close();
    check(`${mode} HTML opens from file:// with all images and zero network requests`);
  }

  await page.reload();
  await expect(mainPanel.locator('.image-asset-row')).toHaveCount(3);
  await expect(page.locator('.preview-stage .md-document img')).toHaveCount(3);
  check('draft image manifest and image preview survive refresh');

  const examples = page.locator('#example-select option');
  const selected = await page.locator('#example-select').inputValue();
  const other = await examples.evaluateAll((options, current) => options.map(option => option.value).find(value => value !== current), selected);
  await page.locator('#example-select').selectOption(other);
  await expect(mainPanel.locator('img')).toHaveCount(0);
  await page.locator('#example-select').selectOption(selected);
  await expect(mainPanel.locator('img')).toHaveCount(3);
  check('image manifests stay with their own document when switching examples');

  await clickWorkbenchAction(page, 'Remove images/local.png');
  await expect(mainPanel).toContainText('File needed');
  await clickWorkbenchAction(page, /^Export/);
  await expect(exportButton).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('removal keeps the reference visible and blocks an incomplete export');

  await page.setViewportSize({ width: 390, height: 844 });
  await addPanel.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(addPanel.getByRole('button', { name: 'Add images', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'mobile-images.png'), fullPage: false });
  const previewMode = await page.locator('[data-editor-view-option="preview"]').getAttribute('aria-pressed');
  if (previewMode === 'true') await clickWorkbenchAction(page, 'Show source');
  await clickWorkbenchAction(page, /^Export/);
  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.bringToFront();
  await dialog.getByRole('button', { name: 'Choose image for images/local.png', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'mobile-export.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByTestId('language-toggle').click();
  // Example drafts are language-specific. Give the Chinese draft an image
  // reference so its resource panel exists before checking its translation.
  await replaceWorkbenchSource(page, '# 图片文档\n\n![图片](images/local.png)');
  await expect(mainPanel).toContainText('文档图片');
  check('390px layout has no page overflow and image controls are localized');
  expect(errors).toEqual([]);
  await context.close();
} finally { await browser.close(); }
