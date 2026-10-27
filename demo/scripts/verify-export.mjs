import { clickWorkbenchAction } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const artifacts = path.resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const checks = [];
const errors = [];

const check = async (name, action) => {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
};

try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.getByRole('slider', { name: 'People', exact: true }).waitFor();
  const slider = page.getByRole('slider', { name: 'People', exact: true });
  await slider.focus();
  for (let index = 0; index < 4; index += 1) await slider.press('ArrowRight');
  await clickWorkbenchAction(page, 'Show source');
  await clickWorkbenchAction(page, /^Export/);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();

  await check('dialog reports the changed parameter and enables the current baseline', async () => {
    await expect(dialog).toContainText('1 of 2 public parameters differ');
    const current = dialog.getByRole('radio', { name: /Current preview state/ });
    await expect(current).toBeEnabled();
    await current.check();
    await expect(dialog.locator('.export-output')).toContainText('current preview state');
  });

  const stateDownloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save current state', exact: true }).click();
  const stateDownload = await stateDownloadPromise;
  const statePath = path.join(artifacts, 'demo-export.state.json');
  await stateDownload.saveAs(statePath);

  await check('downloaded state file stores only the selected public values', async () => {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state.format).toBe('reactive-md-state/v1');
    expect(state.parameters).toEqual({ annual: false, seats: 6 });
    expect(Object.keys(state.parameters).some((name) => name.startsWith('@'))).toBe(false);
  });

  const htmlDownloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export HTML', exact: true }).click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlPath = path.join(artifacts, 'demo-export.html');
  await htmlDownload.saveAs(htmlPath);
  await expect(dialog).toBeHidden();

  await check('downloaded HTML is a self-contained current-state document', async () => {
    const html = await readFile(htmlPath, 'utf8');
    expect(html).toContain('application/reactive-md+json');
    expect(html).toContain('data-reactive-md-auto');
    expect(html).not.toContain('<link rel="stylesheet"');
    const exported = await context.newPage();
    const exportedErrors = [];
    const network = [];
    exported.on('pageerror', (error) => exportedErrors.push(error.message));
    exported.on('request', (request) => {
      if (/^https?:/i.test(request.url())) network.push(request.url());
    });
    await exported.goto(pathToFileURL(htmlPath).href);
    await exported.locator('input').first().waitFor();
    await expect(exported.locator('.local-slider .md-slider-value')).toHaveText('6');
    await expect(exported.locator('.local-document')).toContainText('Current headcount: 6');
    expect(exportedErrors).toEqual([]);
    expect(network).toEqual([]);
    await exported.close();
  });

  await check('static output can be downloaded without a runtime', async () => {
    await clickWorkbenchAction(page, /^Export/);
    const reopened = page.getByRole('dialog');
    await reopened.waitFor();
    await reopened.getByRole('radio', { name: /^Static HTML/ }).check();
    await reopened.getByRole('radio', { name: /Current preview state/ }).check();
    const downloadPromise = page.waitForEvent('download');
    await reopened.getByRole('button', { name: 'Export HTML', exact: true }).click();
    const download = await downloadPromise;
    const staticPath = path.join(artifacts, 'demo-export-static.html');
    await download.saveAs(staticPath);
    const html = await readFile(staticPath, 'utf8');
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toContain('application/reactive-md+json');
    const staticPage = await context.newPage();
    await staticPage.goto(pathToFileURL(staticPath).href);
    await expect(staticPage.locator('.local-static')).toHaveCount(1);
    await expect(staticPage.locator('.local-document')).toContainText('Current headcount: 6');
    await staticPage.close();
  });

  await writeFile(path.join(artifacts, 'demo-export-results.json'), JSON.stringify({
    baseURL, checks, errors,
  }, null, 2));
  expect(errors).toEqual([]);
  await context.close();
} finally {
  await browser.close();
  for (const name of ['demo-export.state.json', 'demo-export.html', 'demo-export-static.html']) {
    await rm(path.join(artifacts, name), { force: true });
  }
}
