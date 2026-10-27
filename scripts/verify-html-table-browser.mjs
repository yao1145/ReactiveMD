import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'mpa' });
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  await mkdir('artifacts/html-tables', { recursive: true });
  for (const width of [1280, 375]) for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${server.resolvedUrls.local[0]}tests/browser/html-table-fixture.html`);
    for (const id of ['interactive', 'static']) {
      const root = page.locator(`#${id}`);
      const tables = root.locator('table');
      await expect(tables).toHaveCount(6);
      const appearance = cell => cell.evaluate(el => {
        const style = getComputedStyle(el);
        return Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','paddingTop','paddingRight','paddingBottom','paddingLeft','borderBottomWidth','borderBottomColor','verticalAlign','textAlign'].map(key => [key, style[key]]));
      });
      const sameAppearance = async (a, b) => {
        // Wait for the initial light/dark color transitions to settle.
        await expect.poll(async () => JSON.stringify(await appearance(a)) === JSON.stringify(await appearance(b))).toBe(true);
      };
      await sameAppearance(tables.nth(0).locator('th').first(), tables.nth(1).locator('th').first());
      await sameAppearance(tables.nth(0).locator('td').first(), tables.nth(1).locator('td').first());
      await sameAppearance(tables.nth(0).locator('td').nth(1), tables.nth(1).locator('td').nth(1));
      const gap = index => root.locator('.local-visual-table-block').nth(index).evaluate(el => {
        const title = el.querySelector('figcaption') ?? el.querySelector('caption');
        const head = el.querySelector('thead') ?? el.querySelector('tbody');
        const text = document.createRange();
        text.selectNodeContents(title);
        return head.getBoundingClientRect().top - text.getBoundingClientRect().bottom;
      });
      const gaps = [await gap(0), await gap(1)];
      assert.ok(Math.abs(gaps[0] - gaps[1]) <= 1, `title-to-table spacing must match: ${gaps}`);
      await expect(tables.nth(2).locator('th[rowspan="2"]')).toHaveText('Item');
      await expect(tables.nth(2).locator('th[colspan="2"]')).toHaveText('Prices');
      await expect(tables.nth(2).locator('strong')).toHaveText('Rich text');
      await expect(tables.nth(2).locator('.katex-html')).toBeVisible();
      await expect(tables.nth(2).locator('.katex-mathml math')).toHaveCount(1);
      // Direct <tr> input is normalized to tbody, including its header row.
      await expect(tables.nth(1).locator('tbody')).toHaveCount(1);
      const widths = await tables.nth(1).evaluate(el => ({ table: el.getBoundingClientRect().width, parent: el.parentElement.getBoundingClientRect().width }));
      assert.ok(widths.table <= widths.parent + 1);
      if (width === 375) for (const index of [4, 5]) {
        const scroll = tables.nth(index).locator('..');
        assert.equal(await scroll.evaluate(el => el.scrollWidth > el.clientWidth), true);
        await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        assert.ok(await scroll.evaluate(el => el.scrollLeft) > 0);
      }
    }
    const live = page.locator('#interactive').getByRole('button', { name: 'Count increase', exact: true });
    await live.focus(); await live.press('Enter');
    await expect(page.locator('#interactive')).toContainText('Current: 3');
    await expect(page.locator('#static')).toContainText('Current: 2');
    assert.deepEqual(await page.evaluate(() => window.tableDiagnostics), []);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `artifacts/html-tables/${width}-${colorScheme}.png`, fullPage: true });
    await page.close();
    console.log(`PASS ${width}px ${colorScheme}: shared table appearance, merged cells, math, live controls, static rendering and overflow`);
  }
  const sourceFile = path.resolve('artifacts/html-tables/offline.reactive.md');
  await writeFile(sourceFile, '<table label="Markdown" searchable="false" sortable="false">\n| Name | Value |\n| --- | ---: |\n| A | 1 |\n</table>\n\n<table><caption>HTML</caption><tr><th colspan="2">Header</th></tr><tr><td>A</td><td>1</td></tr><tr><td colspan="2">\n<counter bind="count" label="Count" initial="2">\n\nValue: {{ count }}\n</td></tr></table>');
  for (const mode of ['interactive', 'static']) {
    const output = path.resolve(`artifacts/html-tables/export-${mode}.html`);
    execFileSync(process.execPath, ['bin/reactive-md.mjs', 'build', sourceFile, '-o', output, '--mode', mode, '--strict'], { encoding: 'utf8', stdio: 'pipe' });
    if (mode === 'static') assert.equal(/<script\b/.test(await readFile(output, 'utf8')), false);
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.goto(pathToFileURL(output).href);
    await expect(page.locator('table.local-visual-table')).toHaveCount(2);
    await expect(page.locator('th[colspan="2"]')).toHaveText('Header');
    await expect(page.locator('article')).toContainText('Value: 2');
    if (mode === 'interactive') {
      await page.getByRole('button', { name: 'Count increase', exact: true }).click();
      await expect(page.locator('article')).toContainText('Value: 3');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    await page.close();
    console.log(`PASS ${mode} export: native and Markdown tables open offline without errors or requests`);
  }
} finally { await browser?.close(); await server.close(); }
