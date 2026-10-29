import { fillEditor, openWorkbench, clickWorkbenchAction, expectEditorSource } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { article } from '../../scripts/benchmark-large-documents.mjs';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5184';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
const checks = [];
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15_000);
page.on('pageerror', error => errors.push(error.message));
const editor = page.locator('#source-editor');
const fillSource = source => fillEditor(editor,source);
const preview = page.locator('.preview-stage');
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
try {
  await openWorkbench(page,baseURL);
  await clickWorkbenchAction(page, 'Show source');
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await check('editing keeps the last preview while compilation is pending', async () => {
    await fillSource('# Compiled document\n\nOld preview.');
    await expect(preview).toContainText('Old preview.');
    await fillSource(article(300) + '\n\nLatest preview.');
    await expect(page.locator('.status-chip')).toContainText('Compiling');
    await expect(preview).toContainText('Old preview.');
    await fillSource('# Latest document\n\nNewest preview.');
    await expect(preview).toContainText('Newest preview.');
    await expect(preview).not.toContainText('Latest preview.');
  });
  await check('latest diagnostics match current source after invalid input', async () => {
    await fillSource('<slider bind="n" label="N" initial="99" min="0" max="10">');
    await expect(page.locator('.status-chip')).toContainText('Compile failed');
    await expect(preview.getByRole('heading', { name: 'Preview disabled' })).toBeVisible();
    await fillSource('# Recovered\n\nValid source.');
    await expect(preview).toContainText('Valid source.');
    await expect(page.locator('.status-chip')).toContainText('Compiled');
  });
  await check('switching examples discards old work and flushes each source separately', async () => {
    await fillSource(article(300) + '\n\nSaved pricing edit.');
    await page.locator('#example-select').selectOption('forms');
    await clickWorkbenchAction(page, 'Restore example');
    await expect(page.locator('.status-chip')).toContainText('Compiled');
    await expect(preview).not.toContainText('Saved pricing edit.');
    await fillSource('# Counter edit\n\nSaved counter edit.');
    await page.locator('#example-select').selectOption('pricing');
    await expectEditorSource(editor,article(300) + '\n\nSaved pricing edit.');
    await page.locator('#example-select').selectOption('forms');
    await expectEditorSource(editor,'# Counter edit\n\nSaved counter edit.');
    await page.reload();
    await clickWorkbenchAction(page, 'Show source');
    await expectEditorSource(editor,'# Counter edit\n\nSaved counter edit.');
    await expect(preview).toContainText('Saved counter edit.');
  });
  await check('unavailable Worker still compiles and edits', async () => {
    const fallback = await browser.newPage();
    fallback.on('pageerror', error => errors.push(error.message));
    await fallback.addInitScript(() => { window.Worker = undefined; });
    try {
      await openWorkbench(fallback,baseURL);
      await clickWorkbenchAction(fallback, 'Show source');
      await expect(fallback.locator('.status-chip')).toContainText('Compiled');
      await fillEditor(fallback.locator('#source-editor'),'# Fallback\n\nWorking without Worker.');
      await expect(fallback.locator('.preview-stage')).toContainText('Working without Worker.');
    } finally { await fallback.close(); }
  });
  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/editing.png', fullPage: true });
  await writeFile('artifacts/editing-checks.json', JSON.stringify({ baseURL, checks, errors }, null, 2));
} finally { await browser.close(); }
