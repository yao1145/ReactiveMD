import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const checks = [];
const errors = [];
const externalRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', request => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL).origin) externalRequests.push(request.url());
});

const preview = () => page.locator('.preview-stage');
const paragraph = (text) => preview().locator('p').filter({ hasText: text }).first();
const status = () => page.locator('.status-chip');
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS ' + name);
}

async function pick(id) {
  await page.getByLabel('示例', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: '恢复示例', exact: true }).click();
  if (id === 'diagnostics') {
    await expect(status()).toContainText('编译失败');
  } else {
    await expect(status()).toContainText('已编译');
    await expect(preview().locator('.local-document')).toBeVisible();
  }
}

try {
  await page.goto(baseURL);
  await expect(page.getByLabel('示例', { exact: true })).toHaveValue('pricing');
  await expect(page.getByRole('slider', { name: '人数', exact: true })).toBeVisible();
  await check('example picker exposes all twelve local documents', async () => {
    await expect(page.getByLabel('示例', { exact: true }).locator('option')).toHaveCount(12);
  });

  await check('default pricing example starts at 200 yuan', async () => {
    await expect(page.getByRole('slider', { name: '人数', exact: true })).toHaveValue('2');
    await expect(paragraph('每月合计：')).toContainText('200');
    await expect(status()).toContainText('已编译');
  });

  await check('annual billing, five seats and panel reset update the same bindings', async () => {
    await page.getByLabel('年度付款', { exact: true }).click();
    await expect(paragraph('每月合计：')).toContainText('160');
    const seats = page.getByRole('slider', { name: '人数', exact: true });
    await seats.focus();
    await seats.press('Home');
    for (let step = 0; step < 4; step++) await seats.press('ArrowRight');
    await expect(paragraph('每月合计：')).toContainText('400');
    await expect(preview().getByText('你选择了至少 5 人，可以继续切换付款方式比较费用。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /恢复默认/ }).click();
    await expect(paragraph('每月合计：')).toContainText('200');
    await expect(preview().getByText('你选择了至少 5 人，可以继续切换付款方式比较费用。', { exact: true })).not.toBeVisible();
  });

  await check('reload resets interaction state and keeps the selected source', async () => {
    await page.reload();
    await expect(page.getByLabel('示例', { exact: true })).toHaveValue('pricing');
    await expect(paragraph('每月合计：')).toContainText('200');
    await expect(page.getByRole('slider', { name: '人数', exact: true })).toHaveValue('2');
  });

  await check('source editing compiles local controls and expressions immediately', async () => {
    const editor = page.locator('#source-editor');
    await editor.fill('<slider bind="n" label="测试数值" initial="4" min="0" max="10">\n\n当前值：**{{ n * 2 }}**。');
    const slider = page.getByRole('slider', { name: '测试数值', exact: true });
    await expect(slider).toHaveValue('4');
    await expect(paragraph('当前值：')).toContainText('8');
    await slider.focus();
    await slider.press('End');
    await expect(paragraph('当前值：')).toContainText('20');
    await expect(status()).toContainText('已编译');
  });

  await check('invalid source deactivates the preview and diagnostics focus the editor', async () => {
    await page.locator('#source-editor').fill('<slider bind="n" label="测试数值" initial="20" min="0" max="10">');
    await expect(status()).toContainText('编译失败');
    await expect(preview().getByText('预览已停用', { exact: true })).toBeVisible();
    await expect(page.locator('.diagnostic-item').first()).toBeVisible();
    await page.locator('.diagnostic-item').first().click();
    await expect(page.locator('#source-editor')).toBeFocused();
    expect(await page.locator('#source-editor').evaluate((element) => element.selectionEnd > element.selectionStart)).toBe(true);
  });

  await check('script tags are diagnostics, not executable HTML', async () => {
    await page.locator('#source-editor').fill('<script>window.__localInjected=1</script>\n\n# 不应执行');
    await expect(status()).toContainText('编译失败');
    expect(await page.evaluate(() => window.__localInjected)).toBeUndefined();
  });

  const catalogue = [
    ['comparison', '放在一起，比较更清楚'],
    ['parameters', '边填写，边看结果'],
    ['checklist', '用清单组织体验过程'],
    ['charts', '图表跟着输入变化'],
    ['diagram', '让解释可以被探索'],
    ['catalog', '在文档里查找组件'],
    ['planning', '计划、计时和简单工具'],
    ['components', '用内容组织交互'],
    ['pricing', '方案计算器'],
    ['counter', '计数器'],
    ['gallery', '常用组件画廊'],
  ];
  for (const [id, title] of catalogue) {
    await check(`example ${id} renders its document heading`, async () => {
      await pick(id);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    });
  }

  await pick('parameters');
  await check('parameter fields, choices and conditional checklist stay in sync', async () => {
    await page.getByLabel('称呼', { exact: true }).fill('林同学');
    await expect(paragraph('称呼：')).toContainText('林同学');
    await preview().getByText('团队使用', { exact: true }).click();
    await expect(paragraph('使用方式：')).toContainText('团队使用');
    await page.getByLabel('显示准备清单', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '想清楚读者需要调整哪些参数', exact: true })).toBeVisible();
  });

  await pick('checklist');
  await check('checklist and enhanced table react locally', async () => {
    await page.getByRole('checkbox', { name: '调整参数并观察结果', exact: true }).check();
    await expect(paragraph('已完成')).toContainText('2 / 3');
    const table = page.getByRole('table', { name: '组件费用示例', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await preview().getByRole('searchbox').fill('视觉');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await preview().getByRole('searchbox').fill('不存在的组件');
    await expect(preview().getByText('没有匹配结果', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /恢复默认/ }).click();
    // This table is outside the checklist panel, so its query is preserved.
    await expect(table.locator('tbody tr')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: '调整参数并观察结果', exact: true })).not.toBeChecked();
    await preview().getByRole('searchbox').fill('');
    await expect(table.locator('tbody tr')).toHaveCount(3);
  });

  await pick('charts');
  await check('charts and plots render SVG and follow their inputs', async () => {
    await expect.poll(() => preview().locator('svg').count()).toBeGreaterThan(1);
    const before = await preview().locator('svg').evaluateAll((nodes) => nodes.map((node) => node.innerHTML).join(''));
    const rate = page.getByRole('slider', { name: '年利率（%）', exact: true });
    await rate.focus();
    await rate.press('Home');
    await expect.poll(async () => preview().locator('svg').evaluateAll((nodes) => nodes.map((node) => node.innerHTML).join('')))
      .not.toBe(before);
    await expect(preview().getByText('无法计算', { exact: false })).toHaveCount(0);
  });

  await pick('diagram');
  await check('diagram selection updates the document text', async () => {
    await preview().getByRole('button', { name: /^计算/ }).click();
    await expect(paragraph('当前环节：')).toContainText('计算');
  });

  await pick('catalog');
  await check('catalog search, empty state and reset stay inside the table', async () => {
    const table = page.getByRole('table', { name: '组件目录', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await preview().getByRole('searchbox').fill('视觉');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table).toContainText('chart');
    await preview().getByRole('searchbox').fill('没有这个组件');
    await expect(preview().getByText('没有匹配结果', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /恢复默认/ }).click();
    await expect(table.locator('tbody tr')).toHaveCount(4);
  });

  await pick('planning');
  await check('timeline and bill splitting calculate from controls', async () => {
    await expect(preview().getByText('整理参考', { exact: true })).toBeVisible();
    await expect(paragraph('每人支付')).toContainText('88');
    const tip = page.getByRole('slider', { name: '额外费用（%）', exact: true });
    await tip.focus();
    await tip.press('Home');
    await expect(paragraph('每人支付')).toContainText('80');
  });
  await check('timer starts, pauses and resets without auto-start', async () => {
    const timer = preview().getByRole('timer');
    await expect(timer).toHaveAttribute('aria-label', '剩余 60 秒');
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect.poll(async () => timer.getAttribute('aria-label')).not.toBe('剩余 60 秒');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const paused = await timer.getAttribute('aria-label');
    await page.waitForTimeout(1100);
    expect(await timer.getAttribute('aria-label')).toBe(paused);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(timer).toHaveAttribute('aria-label', '剩余 60 秒');
  });

  await pick('components');
  await check('style choice changes prose and tooltips are keyboard reachable', async () => {
    await preview().getByText('响应式绑定', { exact: true }).focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.getByLabel('详细', { exact: true }).click();
    await expect(preview().getByText('读者调整控件后，相关内容立即更新。', { exact: false })).toBeVisible();
  });

  await pick('gallery');
  await check('gallery fields, selects, toggles and conditional code remain separate', async () => {
    await page.getByLabel('称呼', { exact: true }).fill('小王');
    await expect(paragraph('你好，')).toContainText('小王');
    await page.getByLabel('年度付款（八折）', { exact: true }).click();
    await expect(paragraph('预估费用：')).toContainText('192');
    await page.getByLabel('方案', { exact: true }).selectOption('basic');
    await expect(paragraph('预估费用：')).toContainText('154');
    await expect(preview().locator('pre').filter({ hasText: '{{ example }}' })).toBeVisible();
  });
  await page.screenshot({ path: 'artifacts/local-desktop.png', fullPage: true });

  await pick('counter');
  await check('counter buttons share their binding with the prose', async () => {
    const increase = page.getByRole('button', { name: '当前数值 增加', exact: true });
    await increase.click({ clickCount: 3 });
    await expect(paragraph('正文也可以读取它：')).toContainText('3');
    const decrease = page.getByRole('button', { name: '当前数值 减少', exact: true });
    await decrease.click({ clickCount: 3 });
    await expect(paragraph('正文也可以读取它：')).toContainText('0');
    await expect(decrease).toBeDisabled();
    await page.getByRole('button', { name: '恢复初值', exact: true }).click();
    await expect(paragraph('正文也可以读取它：')).toContainText('0');
  });

  await pick('diagnostics');
  await check('diagnostic example reports every deliberate class and deactivates interaction', async () => {
    await expect(status()).toContainText('编译失败');
    await expect(preview().getByText('预览已停用', { exact: true })).toBeVisible();
    expect(await page.locator('.diagnostic-item').count()).toBeGreaterThanOrEqual(8);
    const text = await page.getByRole('region', { name: '编译与运行诊断', exact: true }).locator('.diagnostic-list').innerText();
    expect(text).toMatch(/seat/);
    expect(text).toMatch(/slidr|未知/);
    expect(text).toMatch(/on-click/);
    expect(text).toMatch(/missing/);
  });

  await check('theme and simple view change the real interface', async () => {
    await page.getByRole('button', { name: '深色主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '浅色主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: '简洁视图', exact: true }).click();
    await expect(page.getByRole('region', { name: '源码编辑器', exact: true })).toBeHidden();
    await expect(preview()).toBeVisible();
    await page.getByRole('button', { name: '显示源码', exact: true }).click();
    await expect(page.getByRole('region', { name: '源码编辑器', exact: true })).toBeVisible();
  });

  await pick('pricing');
  await page.setViewportSize({ width: 375, height: 900 });
  await check('375px layout fits and keeps the pricing controls usable', async () => {
    expect(await fits()).toBe(true);
    const seats = page.getByRole('slider', { name: '人数', exact: true });
    await seats.scrollIntoViewIfNeeded();
    await seats.focus();
    await seats.press('End');
    await page.getByLabel('年度付款', { exact: true }).click();
    await expect(paragraph('每月合计：')).toContainText('1600');
    expect(await fits()).toBe(true);
  });
  await page.screenshot({ path: 'artifacts/local-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1200, height: 900 });
  async function fixture(source) {
    await page.locator('#source-editor').fill(source);
    await expect(status()).toContainText('已编译');
    await expect(preview().locator('.local-document')).toBeVisible();
  }

  await check('numeric drafts, IME, shared bindings and hidden checklist state follow one reset', async () => {
    await fixture(`<panel title="草稿验证">
<number bind="n" label="数字框" initial="2" min="0" max="10">
<slider bind="n" label="同步滑块" min="0" max="10">
<input bind="user" label="称呼草稿" initial="seed">
<if when="{{ n > 4 }}">
<checklist bind="done" label="隐藏清单">
- [ ] 保留选择
</checklist>
</if>
</panel>

公开值：{{ n }}。称呼：{{ user }}。选择：{{ len(done) }}。`);
    const number = page.getByRole('textbox', { name: '数字框', exact: true });
    await number.fill('');
    await expect(paragraph('公开值：')).toContainText('公开值：2');
    await number.blur();
    await expect(number).toHaveAttribute('aria-invalid', 'true');
    await number.fill('6');
    await expect(page.getByRole('slider', { name: '同步滑块', exact: true })).toHaveValue('6');
    await page.getByRole('checkbox', { name: '保留选择', exact: true }).check();
    await number.fill('2');
    await number.fill('6');
    await expect(page.getByRole('checkbox', { name: '保留选择', exact: true })).toBeChecked();
    const input = page.getByRole('textbox', { name: '称呼草稿', exact: true });
    await input.dispatchEvent('compositionstart');
    await input.fill('中文');
    await expect(paragraph('公开值：')).toContainText('称呼：seed');
    await input.dispatchEvent('compositionend', { data: '中文' });
    await expect(paragraph('公开值：')).toContainText('称呼：中文');
    await page.getByRole('button', { name: /恢复默认/ }).click();
    await expect(number).toHaveValue('2');
    await expect(input).toHaveValue('seed');
    await expect(paragraph('公开值：')).toContainText('选择：0');
  });

  await check('local condition errors are visible and recover without affecting independent results', async () => {
    await fixture(`<slider bind="n" label="分母" initial="1" min="0" max="2">
<if when="{{ 1 / n > 0 }}">
正确分支
</if>

独立计算：{{ n + 2 }}。`);
    const slider = page.getByRole('slider', { name: '分母', exact: true });
    await slider.focus(); await slider.press('Home');
    await expect(preview().locator('.local-error')).toContainText('无法计算');
    await expect(paragraph('独立计算：')).toContainText('2');
    await slider.press('ArrowRight');
    await expect(preview().locator('.local-error')).toHaveCount(0);
    await expect(preview().getByText('正确分支', { exact: true })).toBeVisible();
  });

  await check('hiding a running timer pauses it and showing it preserves the paused value', async () => {
    await fixture(`<toggle bind="show" label="显示计时" initial="true">
<if when="{{ show }}">
<timer label="隐藏计时器" duration="3">
</if>`);
    const timer = preview().getByRole('timer', { includeHidden: true });
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect.poll(() => timer.innerText()).not.toBe('3 秒');
    await page.getByLabel('显示计时', { exact: true }).uncheck();
    await expect(timer).toBeHidden();
    await expect(preview().locator('.local-timer-status')).toContainText('已暂停');
    const paused = await timer.textContent();
    await page.waitForTimeout(1200);
    await page.getByLabel('显示计时', { exact: true }).check();
    await expect(timer).toHaveText(paused);
    await expect(preview().locator('.local-timer-status')).toContainText('已暂停');
  });

  await check('typed table sorting, pagination and panel reset preserve source order', async () => {
    await fixture(`<panel title="表格验证">
<table label="排序测试" page-size="2">
| 名称 | 价格 |
| --- | --- |
| B | 10 |
| A | 2 |
| C | 5 |
</table>
</panel>`);
    const table = page.getByRole('table', { name: '排序测试', exact: true });
    const rows = table.locator('tbody tr');
    const sort = table.getByRole('button', { name: /^价格/ });
    await sort.click();
    await expect(rows.first()).toContainText('A');
    await expect(rows.nth(1)).toContainText('C');
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('B');
    await sort.click();
    await expect(rows.first()).toContainText('B');
    await expect(rows.nth(1)).toContainText('C');
    await sort.click();
    await expect(rows.nth(1)).toContainText('A');
    await preview().getByRole('searchbox').fill('C');
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: /恢复默认/ }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('B');
    await expect(rows.nth(1)).toContainText('A');
  });

  await page.goto(baseURL + '/embed.html');
  await check('embedded local documents keep independent in-memory state', async () => {
    const first = page.getByRole('region', { name: '实例 A', exact: true });
    const second = page.getByRole('region', { name: '实例 B', exact: true });
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
    expect(duplicateIds).toEqual([]);
    await first.getByLabel('称呼', { exact: true }).fill('林同学');
    await expect(first).toContainText('林同学');
    await expect(second).toContainText('读者');
    await page.getByRole('button', { name: '重新挂载', exact: true }).click();
    await expect(first).toContainText('读者');
    await expect(second).toContainText('读者');
  });
  await page.screenshot({ path: 'artifacts/local-embed.png', fullPage: true });

  await check('no browser runtime exceptions', async () => expect(errors).toEqual([]));
  await check('local interactions make no unexpected external requests', async () => expect(externalRequests).toEqual([]));
  await writeFile('artifacts/local-browser-results.json', JSON.stringify({ baseURL, checks, errors, externalRequests }, null, 2));
} finally {
  await browser.close();
}

