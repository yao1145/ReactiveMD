import {chromium, expect} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({...(channel === 'chromium' ? {} : {channel}), headless: true});
const errors = [];
const checks = [];
const output = 'artifacts/guide-examples';
await mkdir(output, {recursive: true});
try {
  for (const language of ['en', 'zh']) {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}, permissions: ['clipboard-read', 'clipboard-write']});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    if (language === 'zh') await page.getByTestId('language-toggle').click();
    await page.getByRole('button', {name: language === 'en' ? 'User Guide' : '使用指南', exact: true}).click();
    const guide = page.locator('.guide-paper');
    const code = guide.locator('.md-code-block');
    const examples = guide.locator('.guide-example');
    await expect(code).toHaveCount(20);
    await expect(examples).toHaveCount(20);
    expect(await guide.locator('.local-host-unavailable, .local-error, .local-compile-error').count()).toBe(0);
    await page.evaluate(() => scrollTo(0, 1600));
    await page.waitForTimeout(100);
    const toolbar = page.locator('.guide-toolbar');
    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox.y).toBeGreaterThanOrEqual(0);
    expect(toolbarBox.y).toBeLessThan(1);
    await expect(toolbar.getByRole('button', {name: language === 'en' ? 'Back to Playground' : '返回 Playground', exact: true})).toBeInViewport();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(100);
    const source = await readFile(new URL(`../../docs/guides/local-guide-${language === 'zh' ? 'ch' : 'en'}.md`, import.meta.url), 'utf8');
    const expected = [...source.matchAll(/```markdown\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]);
    for (let index = 0; index < 20; index++) {
      expect((await code.nth(index).locator('code').textContent()).replace(/\r\n/g, '\n')).toBe(expected[index].replace(/\r\n/g, '\n'));
    }
    await code.nth(0).getByRole('button', {name: language === 'en' ? 'Copy code' : '复制代码', exact: true}).click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(expected[0].replace(/\r\n/g, '\n'));
    const first = examples.nth(0);
    const next = examples.nth(1);
    const slider = first.getByRole('slider');
    await slider.focus();
    await slider.press('End');
    await expect(slider).toHaveValue('20');
    await expect(first).toContainText('2000');
    await expect(next.getByRole('slider')).toHaveValue('2');
    await first.getByRole('checkbox').click();
    await expect(first).toContainText('1600');
    await first.getByRole('button', {name: /Reset|恢复默认/}).click();
    await expect(slider).toHaveValue('2');
    await expect(first).toContainText('200');
    const plot = examples.nth(8);
    const curve = plot.locator('.local-visual-plot-line');
    const original = await curve.getAttribute('d');
    await plot.getByRole('slider').focus();
    await plot.getByRole('slider').press('End');
    await expect(curve).not.toHaveAttribute('d', original);
    const conditional = examples.nth(14);
    await expect(conditional.locator('.local-alert')).toBeHidden();
    await conditional.getByRole('textbox').fill('5');
    await conditional.getByRole('textbox').press('Tab');
    await expect(conditional.locator('.local-alert')).toBeVisible();
    for (const width of [1440, 375]) {
      await page.setViewportSize({width, height: 1000});
      if (width === 1440) {
        expect(await guide.locator(':scope > .local-document').evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(1100);
      }
      for (const theme of ['light', 'dark']) {
        const dark = language === 'en' ? 'Dark theme' : '深色主题';
        const light = language === 'en' ? 'Light theme' : '浅色主题';
        const button = page.getByRole('button', {name: theme === 'dark' ? dark : light, exact: true});
        if (await button.isVisible()) await button.click();
        await expect(slider).toHaveValue('2');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await first.scrollIntoViewIfNeeded();
        await page.screenshot({path: `${output}/${language}-${width}-${theme}.png`});
      }
    }
    checks.push(`${language}: 20 source/preview pairs, copy, independent state, price/toggle/reset, plot and conditional updates, desktop/mobile and both themes`);
    console.log(`PASS ${checks.at(-1)}`);
    await page.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
await writeFile(`${output}/report.json`, JSON.stringify({checks, errors}, null, 2));
