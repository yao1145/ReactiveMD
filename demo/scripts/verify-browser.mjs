import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const checks = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(error.message));
async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS ' + name);
}
async function load(source) {
  const editor = page.locator('textarea').first();
  await editor.fill(source);
  await page.waitForTimeout(700);
}
async function fits() {
  return page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
}
function paragraph(text) {
  return page.locator('.md-document p').filter({ hasText: text }).first();
}

try {
  await page.goto(baseURL);
  await expect(page.getByRole('slider', { name: '人数' })).toBeVisible();
  await check('pricing starts at 200', async () => {
    await expect(paragraph('每月合计：')).toContainText('200');
  });
  await check('annual billing updates the computed total to 160', async () => {
    await page.getByLabel('年度付款', { exact: true }).click();
    await expect(paragraph('每月合计：')).toContainText('160');
  });
  await check('five seats show 400 and reveal conditional content', async () => {
    const slider = page.getByRole('slider', { name: '人数' });
    await slider.focus();
    await slider.press('Home');
    for (let i = 0; i < 4; i++) await slider.press('ArrowRight');
    await expect(paragraph('每月合计：')).toContainText('400');
    await expect(page.getByText('你选择了团队方案，可以继续比较年度付款价格。', { exact: true })).toBeVisible();
  });
  await check('reset restores values and hides the condition', async () => {
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    await expect(paragraph('每月合计：')).toContainText('200');
    await expect(page.getByText('你选择了团队方案，可以继续比较年度付款价格。', { exact: true })).toHaveCount(0);
  });
  await check('desktop layout has no horizontal overflow', async () => expect(await fits()).toBe(true));
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: true });

  await check('example selector opens the working component gallery', async () => {
    await page.getByLabel('示例', { exact: true }).selectOption('gallery');
    await expect(page.getByLabel('称呼', { exact: true })).toBeVisible();
    await page.getByLabel('称呼', { exact: true }).fill('小王');
    await expect(paragraph('当前称呼')).toContainText('小王');
    await page.getByLabel('方案', { exact: true }).selectOption('basic');
    await expect(page.getByLabel('数量（基础版）', { exact: true })).toBeVisible();
    await expect(paragraph('预估费用')).toContainText('192');
    await expect(page.locator('.md-document table')).toBeVisible();
    await expect(page.locator('.md-document .md-badge')).toHaveCount(2);
  });
  await page.screenshot({ path: 'artifacts/gallery.png', fullPage: true });

  await load(await readFile('../examples/counter.reactive.md', 'utf8'));
  await check('editing source creates a working counter', async () => {
    const add = page.getByRole('button', { name: '加一', exact: true });
    await expect(add).toBeVisible();
    await add.click({ clickCount: 3 });
    await expect(paragraph('当前数值：')).toContainText('3');
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(paragraph('当前数值：')).toContainText('0');
  });
  const controls = [
    '```reactive-md', 'version: "0.1"', 'state:', '  name: Ada', '  count: 2', '  plan: basic',
    'actions:', '  increment:', '    - set: count', '      value: "=count + 1"', '```', '',
    '# 控件验收', '', '::input{bind="name" label="姓名"}', '',
    '姓名值：:value{value="=name"}。', '',
    '::number{bind="count" label="数量" min="0" max="10"}', '',
    '数量值：:value{value="=count"}。', '',
    ':::select{bind="plan" label="版本"}', '::option[基础版]{value="basic"}',
    '::option[专业版]{value="pro"}', ':::', '', '版本值：:value{value="=plan"}。', '',
    '::button[增加数量]{on-click="increment" disabled="=count >= 10"}',
  ].join('\n');
  await load(controls);
  await check('text input and select update their bound values', async () => {
    await page.getByLabel('姓名', { exact: true }).fill('Lin');
    await expect(paragraph('姓名值：')).toContainText('Lin');
    await page.getByLabel('版本', { exact: true }).selectOption('pro');
    await expect(paragraph('版本值：')).toContainText('pro');
  });
  await check('empty number drafts preserve the last valid state', async () => {
    const number = page.getByLabel('数量', { exact: true });
    await number.fill('');
    await expect(paragraph('数量值：')).toContainText('2');
    await number.blur();
    await expect(paragraph('数量值：')).toContainText('2');
    await number.fill('10');
    await number.blur();
    await expect(paragraph('数量值：')).toContainText('10');
    await expect(page.getByRole('button', { name: '增加数量' })).toBeDisabled();
  });
  await check('IME composition is committed at compositionend', async () => {
    const input = page.getByLabel('姓名', { exact: true });
    await input.dispatchEvent('compositionstart');
    await input.fill('中文');
    await expect(paragraph('姓名值：')).toContainText('Lin');
    await input.dispatchEvent('compositionend');
    await expect(paragraph('姓名值：')).toContainText('中文');
  });

  await load('```reactive-md\nversion: "0.1"\ncomputed:\n  a: "=b + 1"\n  b: "=a + 1"\n```\n\n# 循环计算');
  await check('invalid edited source reports the error and deactivates old controls', async () => {
    await expect(page.getByRole('button', { name: '增加数量' })).toHaveCount(0);
    await expect(page.locator('.diag-message').filter({ hasText: /循环|circular|cycle/i }).first()).toBeVisible();
    const diagnostic = page.locator('.diagnostic-item').first();
    await diagnostic.click();
    await expect(page.locator('textarea').first()).toBeFocused();
    expect(await page.locator('textarea').evaluate(el => el.selectionEnd > el.selectionStart)).toBe(true);
    await page.getByRole('button', { name: '简洁视图', exact: true }).click();
    await page.locator('.diagnostic-item:visible').first().click();
    await expect(page.locator('textarea').first()).toBeFocused();
    expect(await page.locator('textarea').evaluate(el => el.selectionEnd > el.selectionStart)).toBe(true);
  });

  await load('```reactive-md\nversion: "0.1"\ndata:\n  payload: "<img src=x onerror=window.__rmdInjected=1>"\n```\n\n# 文本渲染\n\n:value{value="=data.payload"}\n\n<script>window.__rmdInjected=1</script>\n\n[危险链接](javascript:alert%281%29)');
  await check('dynamic strings and raw HTML remain text, and script URLs are rejected', async () => {
    await expect(page.locator('.md-document')).toContainText('<img src=x onerror=window.__rmdInjected=1>');
    await expect(page.locator('.md-document script, .md-document img')).toHaveCount(0);
    await expect(page.locator('.md-document a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__rmdInjected)).toBeUndefined();
  });

  await page.getByLabel('示例', { exact: true }).selectOption('pricing');
  await expect(page.getByRole('slider', { name: '人数' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  await check('375px mobile layout fits and retains working controls', async () => {
    expect(await fits()).toBe(true);
    const annual = page.getByLabel('年度付款', { exact: true });
    await annual.scrollIntoViewIfNeeded();
    await annual.click();
    await expect(paragraph('每月合计：')).toContainText('160');
  });
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
  await check('no browser runtime exceptions', async () => expect(errors).toEqual([]));
  await writeFile('artifacts/browser-results.json', JSON.stringify({ baseURL, checks, errors }, null, 2));
} finally {
  await browser.close();
}
