import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const doc = () => page.locator('.md-document');
const paragraph = text => doc().locator('p').filter({ hasText: text }).first();
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function pick(id) {
  await page.getByLabel('示例', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: '恢复示例', exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.locator('.status-chip')).toContainText('已编译');
  await expect(page.locator('.component-error')).toHaveCount(0);
}

try {
  await page.goto(baseURL);
  await expect(page.getByLabel('示例', { exact: true })).toBeVisible();
  await check('manifest exposes all 44 components, excluding maps and games', async () => {
    await page.getByRole('button', { name: '组件清单', exact: true }).click();
    const manifest = JSON.parse(await page.locator('.manifest-dialog pre').innerText());
    expect(manifest).toHaveLength(44);
    expect(manifest.some(item => ['map', 'game'].includes(item.name))).toBe(false);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await pick('comparison');
  await check('comparison cards update together and tabs support keyboard navigation', async () => {
    await expect(doc().locator('.advanced-stat-value').first()).toContainText('100');
    await page.getByLabel('按年付款，享受八折', { exact: true }).check();
    await expect(doc().locator('.advanced-stat-value').first()).toContainText('80');
    const first = page.getByRole('tab', { name: '功能比较', exact: true });
    await first.focus();
    await first.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '选购建议', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: '选购建议' })).toBeVisible();
  });
  await check('disclosures reveal their actual content', async () => {
    await page.getByRole('button', { name: '费用如何计算？', exact: true }).click();
    await expect(page.getByRole('region', { name: '费用如何计算？' })).toBeVisible();
  });

  await pick('forms');
  await check('required fields and an invalid email block form submission', async () => {
    await expect(page.getByRole('button', { name: '提交预约', exact: true })).toBeDisabled();
    await page.getByLabel('确认以上内容可以用于本次交流', { exact: true }).check();
    await page.getByRole('button', { name: '提交预约', exact: true }).click();
    await expect(doc()).not.toContainText('已记录本地提交');
    await page.getByLabel('姓名', { exact: true }).fill('林同学');
    await page.getByLabel('邮箱', { exact: true }).fill('invalid-email');
    await page.getByRole('textbox', { name: '想实现什么交互？', exact: true }).fill('交互文档与表单');
    await page.getByRole('button', { name: '提交预约', exact: true }).click();
    await expect(doc()).not.toContainText('已记录本地提交');
  });
  await check('valid form values, choices and dates produce a local submission', async () => {
    await page.getByLabel('邮箱', { exact: true }).fill('lin@example.com');
    await page.getByRole('radio', { name: '团队使用', exact: true }).click();
    await page.getByLabel(/希望交流的日期/).fill('2026-10-25');
    await page.getByRole('button', { name: '提交预约', exact: true }).click();
    await expect(doc()).toContainText('已记录本地提交');
    await expect(doc()).toContainText('林同学');
    await expect(doc()).toContainText('2026-10-25');
  });

  await pick('collections');
  await check('each row dispatches its own index and collection changes stay reactive', async () => {
    await expect(paragraph('当前任务数：')).toContainText('2');
    await page.getByRole('button', { name: '移除任务', exact: true }).first().click();
    await expect(paragraph('当前任务数：')).toContainText('1');
    await expect(doc()).not.toContainText('设计文档');
    await page.getByRole('button', { name: '添加复核任务', exact: true }).click();
    await expect(paragraph('当前任务数：')).toContainText('2');
    await expect(page.getByRole('button', { name: '添加复核任务', exact: true })).toBeDisabled();
    await expect(doc()).toContainText('复核交互');
  });
  await check('checklist writes an array and updates progress', async () => {
    await page.getByLabel('读懂源文档', { exact: true }).check();
    const progress = page.getByRole('progressbar', { name: '完成进度', exact: true });
    expect(Number(await progress.getAttribute('aria-valuenow'))).toBeCloseTo(100 / 3);
  });
  await check('data table really paginates, sorts numbers and filters rows', async () => {
    const table = page.getByRole('table', { name: '组件费用示例', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.advanced-pager-status')).toContainText('2 / 2');
    await table.getByRole('button', { name: 'price', exact: true }).click();
    await expect(table.locator('tbody tr').first().locator('td').last()).toHaveText('20');
    await page.getByRole('searchbox', { name: '搜索', exact: true }).fill('视觉');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.locator('tbody tr').first().locator('td').last()).toHaveText('65');
  });

  await pick('charts');
  await check('charts render actual SVG data and legends control visible series', async () => {
    const chart = page.getByRole('figure', { name: '实际费用与预算', exact: true });
    const before = await chart.locator('svg [role="button"]').count();
    expect(before).toBeGreaterThan(0);
    await chart.getByRole('button', { name: 'spent', exact: true }).click();
    expect(await chart.locator('svg [role="button"]').count()).toBeLessThan(before);
    await chart.getByRole('button', { name: 'spent', exact: true }).click();
    await chart.locator('svg [role="button"]').first().focus();
    await expect(chart.locator('.visual-readout')).toBeVisible();
  });
  await check('savings inputs recalculate both the result and sampled curve', async () => {
    const stat = doc().locator('.advanced-stat-value').first();
    const beforeAmount = await stat.innerText();
    const path = doc().locator('.visual-plot-line').first();
    const beforePath = await path.getAttribute('d');
    await page.getByRole('slider', { name: '年利率（%）', exact: true }).press('End');
    await expect(stat).not.toHaveText(beforeAmount);
    await expect.poll(() => path.getAttribute('d')).not.toBe(beforePath);
    expect(await fits()).toBe(true);
    expect(await doc().locator('.visual-plot svg').evaluate(svg => {
      const view = svg.viewBox.baseVal;
      return [...svg.querySelectorAll('.visual-axis-label')].every(label => {
        const box = label.getBBox();
        return box.x >= view.x && box.x + box.width <= view.x + view.width;
      });
    })).toBe(true);
  });
  await page.screenshot({ path: 'artifacts/intelligent-desktop.png', fullPage: true });

  await pick('diagram');
  await check('diagram selection writes the selected node to document state', async () => {
    const diagram = page.getByRole('figure', { name: '响应式状态流', exact: true });
    await diagram.getByRole('button', { name: /^计算/ }).click();
    await expect(paragraph('当前环节：')).toContainText('compute');
    await expect(diagram).toContainText('依赖图只重算受影响的计算值');
  });
  await check('changing frequency changes the interactive explanation curve', async () => {
    const path = doc().locator('.visual-plot-line').first();
    const before = await path.getAttribute('d');
    await page.getByRole('slider', { name: '频率', exact: true }).press('End');
    await expect.poll(() => path.getAttribute('d')).not.toBe(before);
  });
  await check('line and area chart kinds render negative data', async () => {
    const custom = '```reactive-md\nversion: "0.2"\ndata:\n  rows: [{label: A, value: -2}, {label: B, value: 4}, {label: C, value: 1}]\n```\n\n# 图表类型\n\n::chart{data="=data.rows" kind="line" label="折线图"}\n\n::chart{data="=data.rows" kind="area" label="面积图"}';
    await page.locator('textarea').first().fill(custom);
    await expect(page.getByRole('figure', { name: '折线图', exact: true })).toBeVisible();
    await expect(page.getByRole('figure', { name: '面积图', exact: true })).toBeVisible();
    await expect(page.locator('.component-error, .visual-error')).toHaveCount(0);
  });

  await pick('async');
  await check('host service exposes pending and actual filtered results', async () => {
    await page.getByLabel('组件关键词', { exact: true }).fill('图表');
    await page.getByRole('button', { name: '查询目录', exact: true }).click();
    await expect(paragraph('查询状态：')).toContainText('pending');
    await expect(paragraph('查询状态：')).toContainText('success');
    const table = page.getByRole('table', { name: '查询结果', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table).toContainText('图表');
  });
  await check('a user can cancel an outstanding host request', async () => {
    await page.getByRole('button', { name: '查询目录', exact: true }).click();
    await page.getByRole('button', { name: '取消请求', exact: true }).click();
    await expect(paragraph('查询状态：')).toContainText('idle');
    await page.waitForTimeout(750);
    await expect(paragraph('查询状态：')).toContainText('idle');
  });
  await check('host failures are visible and a later query can recover', async () => {
    await page.getByLabel('组件关键词', { exact: true }).fill('error');
    await page.getByRole('button', { name: '查询目录', exact: true }).click();
    await expect(paragraph('查询状态：')).toContainText('error');
    await expect(doc()).toContainText('示例服务异常');
    await page.getByLabel('组件关键词', { exact: true }).fill('表单');
    await page.getByRole('button', { name: '查询目录', exact: true }).click();
    await expect(paragraph('查询状态：')).toContainText('success');
  });

  await pick('planning');
  await check('timeline uses all plan steps and bill splitting reacts to inputs', async () => {
    await expect(page.locator('.visual-timeline').locator('li')).toHaveCount(4);
    const amount = await page.locator('.advanced-stat-value').innerText();
    await page.getByRole('slider', { name: '分账人数', exact: true }).press('End');
    await expect(page.locator('.advanced-stat-value')).not.toHaveText(amount);
  });
  await check('timer starts, pauses, and resets without an automatic start', async () => {
    const timer = page.getByRole('timer');
    await expect(timer).toHaveText('60s');
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(timer).toHaveText('59s', { timeout: 2200 });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const paused = await timer.innerText();
    await page.waitForTimeout(1200);
    await expect(timer).toHaveText(paused);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(timer).toHaveText('60s');
  });

  await pick('components');
  await check('images, focusable tooltips, radio inputs and list actions work', async () => {
    const image = page.getByRole('img', { name: '输入、计算与视图通过箭头连接', exact: true });
    await expect(image).toBeVisible();
    expect(await image.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
    await doc().getByText('响应式绑定', { exact: true }).focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await doc().getByText('响应式绑定', { exact: true }).press('Escape');
    await page.getByRole('radio', { name: '详细', exact: true }).check();
    await page.getByRole('button', { name: /^写下关系/ }).click();
    await expect(paragraph('已选主题：')).toContainText('compute');
  });

  await pick('counter');
  await check('document source and state survive a browser refresh', async () => {
    await page.getByRole('button', { name: '加一', exact: true }).click({ clickCount: 2 });
    await expect(paragraph('当前数值：')).toContainText('2');
    await page.reload();
    await expect(paragraph('当前数值：')).toContainText('2');
    await expect(page.getByLabel('示例', { exact: true })).toHaveValue('counter');
  });
  await check('streamed document prefixes preserve the user count', async () => {
    await page.getByRole('button', { name: '流式播放', exact: true }).click();
    await expect(page.getByRole('button', { name: '流式播放', exact: true })).toBeVisible();
    await expect(paragraph('当前数值：')).toContainText('2');
    await expect(page.locator('.component-error')).toHaveCount(0);
  });
  await check('format, export and import pass through the real compiler', async () => {
    await page.getByRole('button', { name: '格式化', exact: true }).click();
    await expect(page.locator('.status-chip')).toContainText('已编译');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出文档', exact: true }).click();
    const download = await downloaded;
    await download.saveAs('artifacts/exported.reactive.md');
    expect(await readFile('artifacts/exported.reactive.md', 'utf8')).toBe(await page.locator('textarea').first().inputValue());
    const imported = (await readFile('../examples/counter.reactive.md', 'utf8')).replace('# 计数器', '# 导入的文档');
    await page.locator('input[type="file"]').setInputFiles({ name: 'custom.reactive.md', mimeType: 'text/markdown', buffer: Buffer.from(imported) });
    await expect(doc().locator('h1')).toHaveText('导入的文档');
  });
  await check('theme and simple view change the actual interface', async () => {
    await page.getByRole('button', { name: '深色主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '简洁视图', exact: true }).click();
    await expect(page.getByRole('region', { name: '源码编辑器', exact: true })).toBeHidden();
    await expect(doc()).toBeVisible();
    await pick('charts');
    const labelContrast = await page.locator('.md-label').first().evaluate(label => {
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255)
          .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(label).color);
      const background = luminance(getComputedStyle(document.querySelector('.workbench')).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(labelContrast).toBeGreaterThanOrEqual(4.5);
  });
  await pick('charts');
  await page.screenshot({ path: 'artifacts/intelligent-dark.png', fullPage: true });
  await page.getByRole('button', { name: '浅色主题', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await check('every full example fits a 375px screen', async () => {
    for (const id of ['comparison', 'forms', 'collections', 'charts', 'diagram', 'async', 'planning', 'components']) {
      await pick(id);
      expect(await fits(), id + ' overflow').toBe(true);
    }
  });
  await pick('comparison');
  await page.screenshot({ path: 'artifacts/intelligent-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(baseURL + '/embed.html');
  await check('React StrictMode embedding isolates instances and renders host extensions', async () => {
    const saved = page.getByRole('region', { name: '持久化实例', exact: true });
    const memory = page.getByRole('region', { name: '独立内存实例', exact: true });
    await saved.getByRole('button', { name: '加一', exact: true }).click();
    await expect(saved).toContainText('当前数值：1');
    await expect(memory).toContainText('当前数值：0');
    await expect(saved).toContainText('宿主组件已同步更新');
    await page.reload();
    await expect(saved).toContainText('当前数值：1');
    await expect(memory).toContainText('当前数值：0');
    await page.getByRole('button', { name: '重新挂载', exact: true }).click();
    await expect(saved).toContainText('当前数值：1');
    await expect(memory).toContainText('当前数值：0');
  });
  await page.screenshot({ path: 'artifacts/intelligent-embed.png', fullPage: true });
  await check('no runtime exceptions across all features', async () => expect(errors).toEqual([]));
  await writeFile('artifacts/intelligent-results.json', JSON.stringify({ baseURL, checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'artifacts/intelligent-failure.png', fullPage: true });
  await writeFile('artifacts/intelligent-failure.txt', await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
