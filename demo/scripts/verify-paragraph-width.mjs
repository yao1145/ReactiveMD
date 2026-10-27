import {chromium, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {replaceWorkbenchSource} from './workbench-ui.mjs';

const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({...(channel === 'chromium' ? {} : {channel}), headless: true});
const output = 'artifacts/paragraph-width';
await mkdir(output, {recursive: true});
const errors = [];
const measurements = [];
const paragraph = 'Adjust the headcount and billing cycle to compare the average monthly cost. Each person costs 100 USD per month, and annual billing takes 20% off.';
const source = `${paragraph.repeat(8)}\n\n${'这是用于检查正文宽度的连续中文段落，文字应按照实际文档宽度自然换行。'.repeat(12)}\n\n${'LongUnbrokenText'.repeat(50)}`;
try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.DEMO_URL ?? 'http://127.0.0.1:5173');
  await page.locator('[data-editor-view-option="edit"]').click();
  await replaceWorkbenchSource(page, source);
  await page.locator('[data-editor-view-option="preview"]').click();
  const text = page.locator('.preview-stage .local-document > p');
  await expect(text).toHaveCount(3);
  for (const width of [1920, 1440, 375]) {
    await page.setViewportSize({width, height: 1080});
    const sizes = await text.evaluateAll(nodes => nodes.map(node => {
      const parent = node.parentElement;
      const style = getComputedStyle(parent);
      return {
        paragraph: node.getBoundingClientRect().width,
        container: parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        maxWidth: getComputedStyle(node).maxWidth,
      };
    }));
    measurements.push({width, sizes});
    await page.screenshot({path: `${output}/${width}.png`});
    console.log(JSON.stringify({width, sizes}));
    for (const size of sizes) expect(Math.abs(size.paragraph - size.container)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
  console.log('PASS paragraphs use the full document width on wide desktop, desktop and mobile');
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({measurements, errors}, null, 2));
  await browser.close();
}
