import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const outputDir = 'artifacts/visual-refinements';
await mkdir(outputDir, { recursive: true });

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5184';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (name, action) => { await action(); checks.push(name); console.log('PASS ' + name); };
const preview = page.locator('.preview-stage');
const source = String.raw`# Responsive formula

<panel title="Parameters">
<slider bind="amount" label="Amount" initial="2" min="0" max="10" color="#167875">
<range-slider label="Interval" bind-start="lo" bind-end="hi" initial-start="2" initial-end="8" min="0" max="10" color="#7c3aed">
<input bind="name" label="Name" initial="Reader">
<select bind="kind" label="Kind" initial="a">
<option value="a">Application</option>
<option value="b">Research</option>
</select>
</panel>

$$ y = \frac{123x^2 + 456x + 789}{1 + x^2} + \sin(2x) + \cos(3x) $$
`;

try {
  await page.goto(baseURL + '/?example=functions');
  await page.getByRole('button', { name: 'Show source', exact: true }).click();
  await page.locator('#source-editor').fill(source);
  await expect(preview.getByRole('heading', { name: 'Responsive formula', exact: true })).toBeVisible();
  // Use presentation mode to measure the same document at full and phone widths.
  await page.locator('.source-toggle').click();
  const math = preview.locator('math.local-math-block');
  await check('formulas retain the document body size on desktop and phone', async () => {
    const bodySize = await preview.locator('.local-document').evaluate(e => getComputedStyle(e).fontSize);
    await expect(math).toHaveCSS('font-size', bodySize);
    await page.setViewportSize({ width: 375, height: 900 });
    await expect(math).toHaveCSS('font-size', bodySize);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(math).toHaveCSS('font-size', bodySize);
  });
  await check('formulas use black in light mode and white in dark mode', async () => {
    await expect(math).toHaveCSS('color', 'rgb(0, 0, 0)');
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
    await expect(math).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.getByRole('button', { name: 'Light theme', exact: true }).click();
  });
  await check('author colors paint ordinary and dual slider tracks', async () => {
    // Chromium does not expose the range track through getComputedStyle.
    // Sample the rendered rail, away from the thumb, instead.
    const track = async slider => {
      const png = await slider.screenshot({ animations: 'disabled' });
      return page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return [...context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data].slice(0, 3);
      }, png.toString('base64'));
    };
    expect(await track(preview.getByRole('slider', { name: 'Amount', exact: true }))).toEqual([22, 120, 117]);
    expect(await track(preview.locator('.local-range-input').first())).toEqual([124, 58, 237]);
    const slider = preview.getByRole('slider', { name: 'Amount', exact: true });
    await slider.focus(); await slider.press('End'); await expect(slider).toHaveValue('10');
  });
  await check('text fields, select fields and buttons use bubble corners', async () => {
    for (const locator of [preview.getByRole('textbox', { name: 'Name', exact: true }), preview.getByRole('combobox', { name: 'Kind', exact: true }), preview.locator('.local-panel-reset')]) {
      expect(await locator.evaluate(e => {
        const css = getComputedStyle(e);
        return parseFloat(css.borderTopLeftRadius) >= e.getBoundingClientRect().height / 2;
      })).toBe(true);
    }
  });
  await check('savings cases keep expressions and conditions separate at every width and theme', async () => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(baseURL + '/?example=functions');
    await preview.getByRole('tab', { name: 'Savings application', exact: true }).click();
    const cases = preview.locator('.local-visual-plot-formula mtable').last();
    await expect(cases).toBeVisible();
    for (const width of [1440, 760, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ['light', 'dark']) {
        if (mode === 'dark') await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
        await expect.poll(async () => cases.evaluate(table => [...table.querySelectorAll('mtr')].every(row => {
          const [expression, condition] = row.children;
          const right = Math.max(...[...expression.querySelectorAll('*')].map(e => e.getBoundingClientRect().right));
          return right <= condition.getBoundingClientRect().left - 1;
        })), { message: `cases overlap at ${width}px ${mode}` }).toBe(true);
        if (width === 1440 || width === 375) {
          await cases.locator('..').locator('..').screenshot({
            path: `${outputDir}/cases-fixed-${width}-${mode}.png`,
            animations: 'disabled',
          });
        }
        if (mode === 'dark') await page.getByRole('button', { name: 'Light theme', exact: true }).click();
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await page.goto(baseURL + '/?example=statistics');
  await expect(preview.locator('.local-visual-chart-donut svg')).toBeVisible();
  await check('tables fill the container with balanced data columns and a narrow selection column', async () => {
    const table = preview.locator('table.local-visual-table').first();
    const sizes = await table.evaluate(e => ({ width: e.getBoundingClientRect().width, area: e.parentElement.clientWidth }));
    expect(Math.abs(sizes.width - sizes.area)).toBeLessThanOrEqual(1);
    const widths = await table.locator('thead th').evaluateAll(cells => cells.map(e => e.getBoundingClientRect().width));
    expect(widths[0]).toBeLessThan(64);
    expect(Math.max(...widths.slice(1)) / Math.min(...widths.slice(1))).toBeLessThan(1.5);
    await table.screenshot({ path: `${outputDir}/table-balanced.png`, animations: 'disabled' });
    await expect(table.getByRole('columnheader', { name: 'Actual', exact: true })).toHaveCSS('text-align', 'right');
  });
  await check('donut ring has a useful diameter with no page overflow', async () => {
    const ring = preview.locator('.local-visual-chart-donut svg');
    expect(await ring.evaluate(svg => {
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const paths = [...svg.querySelectorAll('path.local-visual-donut-slice')];
      const boxes = paths.map(e => e.getBBox());
      return (Math.max(...boxes.map(b => b.x + b.width)) - Math.min(...boxes.map(b => b.x))) * scale;
    })).toBeGreaterThanOrEqual(175);
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/visual-refinements-results.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(`${checks.length} checks, ${errors.length} errors`);
} finally { await browser.close(); }
