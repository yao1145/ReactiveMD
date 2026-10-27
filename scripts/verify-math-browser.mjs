import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({configFile: false, server: {host: '127.0.0.1', port: 0}, appType: 'mpa'});
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({...channel === 'chromium' ? {} : {channel}, headless: true});
  await mkdir('artifacts/math-display', {recursive: true});
  for (const width of [1280, 375]) {
    const page = await browser.newPage({viewport: {width, height: 1100}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${server.resolvedUrls.local[0]}tests/browser/math-fixture.html`);
    await expect(page.locator('math')).toHaveCount(14);
    await expect(page.locator('mfrac').first()).toBeVisible();
    await expect(page.locator('munderover').first()).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.mathDiagnostics), []);
    const measurements = await page.evaluate(() => {
      const matrix = document.querySelector('math mtable mtable');
      const rows = [...matrix.querySelectorAll('mtr')].map(row => row.getBoundingClientRect());
      const cells = [...matrix.children[0].children].map(cell => cell.getBoundingClientRect());
      const arrow = document.querySelector('munderover');
      const [base, below, above] = [...arrow.children].map(node => node.getBoundingClientRect());
      const water = [...document.querySelectorAll('math')].find(node => node.getAttribute('aria-label').trim() === '\\ce{H2O}');
      const waterSub = water.querySelector('msub').getBoundingClientRect();
      const waterH = water.querySelector('mi').getBoundingClientRect();
      const isotope = document.querySelector('mmultiscripts');
      const nucleus = isotope.children[0].getBoundingClientRect();
      const atomic = isotope.children[2].getBoundingClientRect();
      const mass = isotope.children[3].getBoundingClientRect();
      const tag = document.querySelector('mtable[data-local-math-tag] mtd:last-child mtext').getBoundingClientRect();
      const taggedMath = document.querySelector('.local-math-tagged').getBoundingClientRect();
      const alignment = [...document.querySelectorAll('math')].find(node => node.getAttribute('aria-label').includes('begin{align}'));
      const alignedCells = [...alignment.querySelectorAll('mtd[columnalign="right"]')];
      const rightEdges = alignedCells.map(cell => cell.children[cell.children.length - 1].getBoundingClientRect().right);
      return {
        matrixRows: rows.length === 2 && rows[1].y > rows[0].y,
        matrixColumns: cells.length === 2 && cells[1].x > cells[0].x,
        arrowLabels: above.y < base.y && below.bottom > base.bottom,
        chemicalSubscript: waterSub.bottom > waterH.bottom,
        isotopePrescripts: atomic.right <= nucleus.x + 1 && mass.right <= nucleus.x + 1 && mass.y < atomic.y,
        rightAligned: Math.abs(rightEdges[0] - rightEdges[1]) < 1,
        tagAtRight: taggedMath.right - tag.right < 20,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert.deepEqual(measurements, {matrixRows: true, matrixColumns: true, arrowLabels: true, chemicalSubscript: true, isotopePrescripts: true, rightAligned: true, tagAtRight: true, overflow: false});
    assert.deepEqual(errors, []);
    await page.screenshot({path: `artifacts/math-display/${width}.png`, fullPage: true});
    await page.close();
    console.log(`MathML and mhchem: ${width}px passed.`);
  }
} finally {
  await browser?.close();
  await server.close();
}
