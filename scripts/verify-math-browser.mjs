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
    await expect(page.locator('.local-math .katex-html')).toHaveCount(20);
    await expect(page.locator('.local-math .katex-mathml math')).toHaveCount(20);
    await expect(page.locator('.katex-html .mfrac').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(await page.evaluate(() => window.mathDiagnostics), []);
    const measurements = await page.evaluate(() => {
      const formulas = [...document.querySelectorAll('.local-math')];
      const formula = source => formulas.find(node => node.querySelector('annotation')?.textContent.trim() === source);
      const visual = node => node.querySelector('.katex-html');
      const leaf = (node, text) => [...node.querySelectorAll('span')].find(span => !span.children.length
        && span.textContent === text && getComputedStyle(span).color !== 'rgba(0, 0, 0, 0)');
      const matrix = document.querySelector('.katex-html .mtable .mtable');
      const one = leaf(matrix, '1').getBoundingClientRect();
      const two = leaf(matrix, '2').getBoundingClientRect();
      const three = leaf(matrix, '3').getBoundingClientRect();
      const water = visual(formula('\\ce{H2O}'));
      const waterSub = leaf(water, '2').getBoundingClientRect();
      const waterH = leaf(water, 'H').getBoundingClientRect();
      const isotope = visual(formula('\\ce{^{14}_{6}C}'));
      const nucleus = leaf(isotope, 'C').getBoundingClientRect();
      const atomic = leaf(isotope, '6').getBoundingClientRect();
      const mass = leaf(isotope, '14').getBoundingClientRect();
      const taggedMath = formula('E=mc^2\\tag{1}');
      const tag = taggedMath.querySelector('.katex-tag').getBoundingClientRect();
      const alignment = visual(formulas.find(node => node.querySelector('annotation')?.textContent.includes('begin{align}')));
      const alignedCells = [...alignment.querySelector('.col-align-r > .vlist-t > .vlist-r > .vlist').children];
      const rightEdges = alignedCells.map(cell => cell.lastElementChild.getBoundingClientRect().right);
      const wide = formulas.at(-1).closest('.local-math-display');
      const wideVisual = visual(formulas.at(-1));
      const wideTag = wideVisual.querySelector('.katex-tag').getBoundingClientRect();
      const wideEnd = [...wideVisual.querySelectorAll('.katex-base')].at(-1).getBoundingClientRect();
      return {
        mathFontLoaded: [...document.fonts].some(font => font.family.includes('KaTeX_Main') && font.status === 'loaded'),
        matrixRows: three.y > one.y,
        matrixColumns: two.x > one.x,
        chemicalSubscript: waterSub.bottom > waterH.bottom,
        isotopePrescripts: atomic.right <= nucleus.x + 1 && mass.right <= nucleus.x + 1 && mass.y < atomic.y,
        rightAligned: Math.abs(rightEdges[0] - rightEdges[1]) < 1,
        tagAtRight: taggedMath.getBoundingClientRect().right - tag.right < 20,
        wideFormulaScrolls: wide.scrollWidth > wide.clientWidth && getComputedStyle(wide).overflowX === 'auto',
        wideTagDoesNotOverlap: wideTag.left >= wideEnd.right + 8,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert.deepEqual(measurements, {mathFontLoaded: true, matrixRows: true, matrixColumns: true, chemicalSubscript: true, isotopePrescripts: true, rightAligned: true, tagAtRight: true, wideFormulaScrolls: true, wideTagDoesNotOverlap: true, overflow: false});
    const wide = page.locator('.local-math-display').last();
    assert.ok(await wide.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      return element.scrollLeft > 0;
    }));
    await page.emulateMedia({colorScheme: 'dark'});
    await expect(page.locator('.md-document')).toHaveAttribute('data-color-scheme', 'dark');
    await page.screenshot({path: `artifacts/math-display/${width}-dark.png`, fullPage: true});
    if (width === 1280) {
      await page.locator('.local-math-display').first().screenshot({path: 'artifacts/math-display/circulation-dark.png'});
    }
    await page.emulateMedia({colorScheme: 'light', media: 'print'});
    await expect(page.locator('.local-math .katex-html').first()).toBeVisible();
    await page.emulateMedia({media: 'screen'});
    assert.deepEqual(errors, []);
    await page.screenshot({path: `artifacts/math-display/${width}.png`, fullPage: true});
    await page.close();
    console.log(`KaTeX, MathML, fonts and mhchem: ${width}px passed.`);
  }
} finally {
  await browser?.close();
  await server.close();
}
