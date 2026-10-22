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
const fillSource = source => editor.evaluate((element, value) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}, source);
const preview = page.locator('.preview-stage');
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
try {
  await page.goto(baseURL);
  await expect(page.locator('.status-chip')).toContainText('已编译');
  await check('editing keeps the last preview while compilation is pending', async () => {
    await fillSource('# 已编译的文档\n\nOld preview.');
    await expect(preview).toContainText('Old preview.');
    await fillSource(article(300) + '\n\nLatest preview.');
    await expect(page.locator('.status-chip')).toContainText('编译中');
    await expect(preview).toContainText('Old preview.');
    await fillSource('# 最新文档\n\nNewest preview.');
    await expect(preview).toContainText('Newest preview.');
    await expect(preview).not.toContainText('Latest preview.');
  });
  await check('latest diagnostics match current source after invalid input', async () => {
    await fillSource('<slider bind="n" label="N" initial="99" min="0" max="10">');
    await expect(page.locator('.status-chip')).toContainText('编译失败');
    await expect(preview.getByRole('heading', { name: '预览已停用' })).toBeVisible();
    await fillSource('# 已恢复\n\nValid source.');
    await expect(preview).toContainText('Valid source.');
    await expect(page.locator('.status-chip')).toContainText('已编译');
  });
  await check('switching examples discards old work and flushes each source separately', async () => {
    await fillSource(article(300) + '\n\nSaved pricing edit.');
    await page.getByLabel('示例', { exact: true }).selectOption('counter');
    await page.getByRole('button', { name: '恢复示例', exact: true }).click();
    await expect(page.locator('.status-chip')).toContainText('已编译');
    await expect(preview).not.toContainText('Saved pricing edit.');
    await fillSource('# 计数器修改\n\nSaved counter edit.');
    await page.getByLabel('示例', { exact: true }).selectOption('pricing');
    await expect(editor).toHaveValue(article(300) + '\n\nSaved pricing edit.');
    await page.getByLabel('示例', { exact: true }).selectOption('counter');
    await expect(editor).toHaveValue('# 计数器修改\n\nSaved counter edit.');
    await page.reload();
    await expect(editor).toHaveValue('# 计数器修改\n\nSaved counter edit.');
    await expect(preview).toContainText('Saved counter edit.');
  });
  await check('unavailable Worker still compiles and edits', async () => {
    const fallback = await browser.newPage();
    fallback.on('pageerror', error => errors.push(error.message));
    await fallback.addInitScript(() => { window.Worker = undefined; });
    try {
      await fallback.goto(baseURL);
      await expect(fallback.locator('.status-chip')).toContainText('已编译');
      await fallback.locator('#source-editor').fill('# Fallback\n\nWorking without Worker.', { force: true });
      await expect(fallback.locator('.preview-stage')).toContainText('Working without Worker.');
    } finally { await fallback.close(); }
  });
  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/editing.png', fullPage: true });
  await writeFile('artifacts/editing-checks.json', JSON.stringify({ baseURL, checks, errors }, null, 2));
} finally { await browser.close(); }
