import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { gridOverflows } from './grid-layout-assertions.mjs';
import { clickWorkbenchAction } from './workbench-ui.mjs';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const errors = [], checks = [];
await mkdir('artifacts', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('reactive-md:language', 'zh'));
  await page.goto(baseURL);
  await page.locator('#example-select').selectOption('statistics');
  await clickWorkbenchAction(page, '显示源码');
  const preview = page.locator('.preview-stage');
  await expect(preview.getByRole('heading', { name: '一份预算，多种观察方式', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/grid-statistics-editing.png', fullPage: true });
  expect(await gridOverflows(preview), 'statistics grids must fit their immediate containers in the editor').toEqual([]);
  checks.push('statistics editor reproduction');

  for (const width of [1920, 1440, 1200, 1024, 980, 800, 768, 621, 620, 480, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ['editing', 'presentation']) {
      if (mode === 'presentation') await clickWorkbenchAction(page, '演示模式');
      expect(await gridOverflows(preview), `statistics ${mode} at ${width}px`).toEqual([]);
      if (width === 1200 || width === 768) await page.screenshot({ path: `artifacts/grid-statistics-${mode}-${width}.png`, fullPage: true });
      checks.push(`statistics ${mode} at ${width}px`);
    }
    await clickWorkbenchAction(page, '显示源码');
  }

  // A wide viewport with a small host is the important case for embedded documents.
  const cards = (count, body = 'A small content card.') => Array.from({ length: count }, (_, index) => `<card title="Card ${index + 1}">${body}</card>`).join('\n');
  const nested = `<grid columns="2">${cards(2, `<grid columns="3">${cards(3)}</grid>`)}</grid>`;
  const source = '# Container layout regression\n\n' + [1, 2, 3, 4].map((columns) => `<grid columns="${columns}">${cards(4)}</grid>`).join('\n\n') + '\n\n' + nested;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('[data-editor-view-option="split"]')).toHaveAttribute('aria-pressed', 'true');
  const editor = page.locator('#source-editor');
  await editor.focus();
  await expect(editor).toBeFocused();
  await editor.fill(source);
  await expect(editor).toHaveValue(source);
  await expect(preview.getByRole('heading', { name: 'Container layout regression', exact: true })).toBeVisible();
  await clickWorkbenchAction(page, '演示模式');
  for (const width of [200, 240, 320, 430, 451, 452, 480, 600, 700, 720, 960, 1200]) {
    await preview.evaluate((element, width) => {
      element.style.width = `${width}px`;
      element.style.maxWidth = 'none';
      element.querySelector('.local-document').style.maxWidth = 'none';
    }, width);
    expect(await gridOverflows(preview), `embedded grids at ${width}px host width`).toEqual([]);
    const columns = await preview.locator('.local-document > .local-grid').evaluateAll((grids) => grids.slice(0, 4).map((grid) => {
      const style = getComputedStyle(grid);
      return style.gridTemplateColumns.split(/\s+/).length;
    }));
    if (width === 1200) expect(columns, 'wide hosts retain the requested one to four columns').toEqual([1, 2, 3, 4]);
    if (width <= 430) expect(columns, 'narrow hosts stack every requested column count').toEqual([1, 1, 1, 1]);
    checks.push(`embedded columns 1–4 and nested grids at ${width}px`);
  }
  expect(errors).toEqual([]);
  await writeFile('artifacts/grid-layout-results.json', JSON.stringify({ baseURL, checks, errors }, null, 2));
  console.log(`PASS ${checks.length} container layout checks`);
} finally { await browser.close(); }
