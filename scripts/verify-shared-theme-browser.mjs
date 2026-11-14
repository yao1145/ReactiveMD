import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, optimizeDeps: { entries: ['tests/browser/shared-theme-fixture.html'] }, server: { host: '127.0.0.1', port: 0 }, appType: 'mpa' });
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tests/browser/shared-theme-fixture.html`);
  await expect(page.locator('#baseline article')).toBeVisible();
  const firstLayer = await page.evaluate(() => Array.from(document.styleSheets)
    .flatMap(sheet => Array.from(sheet.cssRules))
    .find(rule => /^@layer\s+rmd[.\s,]/.test(rule.cssText))?.cssText.split('{', 1)[0]);
  assert.match(firstLayer ?? '', /^@layer\s+rmd\.reset\s*,\s*rmd\.defaults\s*,\s*rmd\.components\s*,\s*rmd\.themes\s*,\s*rmd\.overrides\s*;/);
  console.log('PASS public layer order precedes independently loaded component modules');
  await expect(page.locator('#shaped article')).toHaveCSS('--layer-probe', 'blue');
  console.log('PASS SDK normalization preserves authored sublayer cascade');
  const properties = async selector => (typeof selector === 'string' ? page.locator(selector) : selector).evaluate(element => {
    const css = getComputedStyle(element);
    return ['color', 'background-color', 'font-family', 'font-size', 'border-radius', 'box-shadow'].map(name => css.getPropertyValue(name));
  });
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => window.sharedThemeHarness.scheme(mode), mode);
    await expect(page.locator('#empty article')).toHaveAttribute('data-color-scheme', mode);
    assert.deepEqual(await properties('#baseline article'), await properties('#empty article'));
    const baseSlider = page.locator('#baseline').getByRole('slider', { name: 'Level', exact: true });
    const emptySlider = page.locator('#empty').getByRole('slider', { name: 'Level', exact: true });
    assert.deepEqual(await properties(baseSlider), await properties(emptySlider));
    await expect(baseSlider).toBeVisible();
    await expect(emptySlider).toBeVisible();
    await expect(page.locator('#empty .local-visual-chart-bar .rmd-chart-svg')).toBeVisible();
    await expect(page.locator('#empty .local-visual-chart-line .rmd-chart-svg')).toBeVisible();
    await expect(page.locator('#static .local-visual-chart-bar svg')).toBeVisible();
    await expect(page.locator('#static .local-visual-chart-line svg')).toBeVisible();
    await expect(page.locator('#static .local-visual-diagram svg')).toBeVisible();
    await expect(page.locator('#static [role="slider"]')).toHaveCount(0);
    console.log(`PASS ${mode}: empty theme inherits complete default baseline`);
  }
  const styledLine = page.locator('#shaped .local-visual-chart-line [data-rmd-part="line"][data-series="0"]');
  await expect(styledLine).toHaveCSS('stroke-width', /^(?:6px|calc\(6px\))$/);
  await page.locator('#shaped .local-visual-chart-line').getByRole('button', { name: 'Alpha', exact: true }).hover();
  await expect(styledLine).toHaveCSS('stroke-width', /^(?:6px|calc\(6px\))$/);
  await expect(page.locator('#shaped .local-visual-chart-line [data-rmd-part="line"][data-series="1"]')).toHaveCSS('opacity', '0.22');
  await expect(page.locator('#shaped [data-rmd-part="bar"]').first()).toHaveCSS('rx', '0px');
  await page.mouse.move(0, 0);
  console.log('PASS chart parts and variables control shape and keep highlighted lines at least as thick');
  const shaped = page.locator('#shaped').getByRole('slider', { name: 'Level', exact: true });
  await expect(shaped).toHaveCSS('--rmd-slider-thumb-width', '16px');
  await expect(shaped).toHaveCSS('--rmd-slider-thumb-height', '28px');
  await expect(shaped).toHaveCSS('--rmd-slider-thumb-radius', '2px');
  for (const [property, expected] of [['width', 16], ['height', 28], ['border-radius', 2]]) {
    // CSS used dimensions can round to fractional layout units under zoom/DPR.
    await expect.poll(() => shaped.evaluate((element, name) => parseFloat(getComputedStyle(element).getPropertyValue(name)), property)).toBeCloseTo(expected, 1);
  }
  await shaped.focus();
  await page.keyboard.press('End');
  await expect(shaped).toHaveAttribute('aria-valuenow', '10');
  const track = page.locator('#shaped [data-rmd-component="slider"]').first().locator('[data-rmd-part="track"]');
  await expect.poll(async () => {
    const thumb = await shaped.boundingBox();
    const rail = await track.boundingBox();
    assert.ok(thumb && rail);
    return Math.abs(thumb.x + thumb.width / 2 - rail.x - rail.width);
  }).toBeLessThan(2);
  await page.keyboard.press('Home');
  await expect(shaped).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(async () => {
    const thumb = await shaped.boundingBox();
    const rail = await track.boundingBox();
    assert.ok(thumb && rail);
    return Math.abs(thumb.x + thumb.width / 2 - rail.x);
  }).toBeLessThan(2);
  const startThumb = await shaped.boundingBox();
  const trackBox = await track.boundingBox();
  assert.ok(startThumb && trackBox);
  await page.mouse.move(startThumb.x + startThumb.width / 2, startThumb.y + startThumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(trackBox.x + trackBox.width, trackBox.y + trackBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(shaped).toHaveAttribute('aria-valuenow', '10');
  await expect(page.locator('#empty').getByRole('slider', { name: 'Level', exact: true })).toHaveAttribute('aria-valuenow', '3');
  console.log('PASS component variables control rectangular thumb and preserve pointer/keyboard geometry');
  const choice = page.locator('#empty').getByRole('combobox', { name: 'Choice', exact: true });
  await choice.click();
  const menu = page.locator('#empty').getByRole('listbox');
  await expect(menu).toBeVisible();
  assert.equal(await menu.evaluate(node => node.closest('[data-rmd-theme]')?.getAttribute('data-rmd-theme')), 'empty');
  await menu.getByRole('option', { name: 'B', exact: true }).click();
  await expect(choice).toContainText('B');
  await page.locator('#empty .local-date button[aria-haspopup="dialog"]').click();
  await expect(page.locator('#empty').getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#empty').getByRole('dialog')).toHaveCount(0);
  const node = page.locator('#empty [data-diagram-node][aria-label="Start"]');
  await node.focus();
  await expect(page.locator('#empty')).toContainText('Start description');
  await expect(node).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(node).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#empty article').evaluate(node => node.setAttribute('data-rmd-density', 'compact'));
  await expect(choice).toHaveCSS('min-height', '32px');
  await page.locator('#empty article').evaluate(node => node.removeAttribute('data-rmd-density'));
  console.log('PASS shared select/date interactions, scoped floating menus and explicit density');
  await page.locator('#empty').getByRole('button', { name: 'Count increase', exact: true }).click();
  await expect(page.locator('#empty')).toContainText('Count value: 3');
  await page.evaluate(() => window.sharedThemeHarness.registered(false));
  await expect(page.locator('#empty article')).toHaveAttribute('data-rmd-theme', 'default');
  await expect(page.locator('#empty')).toContainText('Count value: 3');
  await page.evaluate(() => window.sharedThemeHarness.registered(true));
  await expect(page.locator('#empty article')).toHaveAttribute('data-rmd-theme', 'empty');
  await expect(page.locator('#empty')).toContainText('Count value: 3');
  console.log('PASS fallback and recovery retain component state');
  await page.setViewportSize({ width: 375, height: 900 });
  const shapedControl = page.locator('#shaped [data-rmd-component="slider"]').first().locator('[data-rmd-part="control"]');
  const hitArea = await shaped.evaluate(element => {
    const css = getComputedStyle(element, '::after');
    return { width: parseFloat(css.width), height: parseFloat(css.height) };
  });
  assert.ok(hitArea.width >= 43.9 && hitArea.height >= 43.9, `minimum hit area: ${JSON.stringify(hitArea)}`);
  await shapedControl.scrollIntoViewIfNeeded();
  const controlBox = await shapedControl.boundingBox();
  assert.ok(controlBox);
  await shapedControl.click({ position: { x: controlBox.width - 40, y: controlBox.height / 2 } });
  await expect(shaped).toHaveAttribute('aria-valuenow', '10');
  await shaped.focus();
  await page.keyboard.press('Home');
  await shapedControl.click({ position: { x: 40, y: controlBox.height / 2 } });
  await expect(shaped).toHaveAttribute('aria-valuenow', '0');
  await shaped.focus();
  await page.keyboard.press('End');
  console.log('PASS 44px pointer targets remain usable inside both narrow-screen endpoints');
  await mkdir('artifacts/theme-refactor', { recursive: true });
  await page.locator('#shaped').screenshot({ path: 'artifacts/theme-refactor/shaped-dark-375.png' });
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll('body *')).map(node => {
      const rect = node.getBoundingClientRect();
      const css = getComputedStyle(node);
      return { tag: node.tagName, class: node.getAttribute('class'), width: rect.width, right: rect.right, overflow: css.overflowX };
    }).filter(node => node.right > innerWidth + 1).slice(0, 15),
  }));
  assert.ok(overflow.width <= overflow.viewport + 1, JSON.stringify(overflow));
  assert.deepEqual(errors, []);
  console.log('PASS 375px layout, static view and same-page isolation');
} finally {
  await browser?.close();
  await server.close();
}
