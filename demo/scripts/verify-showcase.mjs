import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { gridOverflows } from './grid-layout-assertions.mjs';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const checks = [], errors = [], externalRequests = [];
const ids = ['pricing', 'functions', 'forms', 'statistics', 'layout', 'flow', 'tasks'];

async function check(name, action) {
  await action(); checks.push(name); console.log('PASS ' + name);
}

try {
  for (const language of ['en', 'zh']) {
    const t = (en, zh) => language === 'en' ? en : zh;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((language) => localStorage.setItem('reactive-md:language', language), language);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL).origin) externalRequests.push(request.url());
    });
    const preview = page.locator('.preview-stage');
    const pick = async (id) => {
      if (!await page.locator(`[data-example-id="${id}"]`).isVisible()) {
        await page.locator('.showcase-menu-toggle').click();
      }
      await page.locator(`[data-example-id="${id}"]`).click();
      await page.getByRole('button', { name: t('Restore example', '恢复示例'), exact: true }).click();
      await expect(page.locator('.status-chip')).toContainText(t('Compiled', '已编译'));
      await expect(preview.locator('.local-document')).toBeVisible();
    };
    const slider = async (name, key) => {
      const control = preview.getByRole('slider', { name, exact: true });
      await control.focus(); await control.press(key); return control;
    };
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    try {
      await page.goto(baseURL);
      await check(`${language}: opens in presentation mode with seven distinct feature entries`, async () => {
        await expect(page.locator('.pane-editor')).toBeHidden();
        expect(await page.locator('[data-example-id]').evaluateAll((buttons) => buttons.map((button) => button.dataset.exampleId))).toEqual(ids);
        await expect(preview.getByRole('slider', { name: t('People', '人数'), exact: true })).toHaveValue('2');
      });

      await pick('functions');
      await check(`${language}: amplitude changes the actual curve and flat-wave explanation`, async () => {
        const line = preview.locator('.local-visual-plot').first().locator('path').first();
        const original = await line.getAttribute('d');
        await slider(t('Amplitude', '振幅'), 'Home');
        await expect(line).not.toHaveAttribute('d', original);
        await expect(preview.getByText(t('The wave is flat', '波形已变为直线'), { exact: true })).toBeVisible();
        await slider(t('Amplitude', '振幅'), 'End');
        await expect(preview.getByText(t('The wave is flat', '波形已变为直线'), { exact: true })).toBeHidden();
      });
      await check(`${language}: tabs expose piecewise and savings plots with live parameters`, async () => {
        await preview.getByRole('tab', { name: t('Piecewise function', '分段函数'), exact: true }).click();
        await expect(preview.getByText(t('Linear meets quadratic', '直线与抛物线衔接'), { exact: true })).toBeVisible();
        await preview.getByRole('tab', { name: t('Savings application', '应用：储蓄增长'), exact: true }).click();
        await slider(t('Annual rate (%)', '年利率（%）'), 'Home');
        await expect(preview.locator('.local-error')).toHaveCount(0);
        await page.screenshot({ path: `artifacts/showcase-${language}-functions.png`, fullPage: true });
      });

      await pick('forms');
      await check(`${language}: a complete form change updates name, conditional notes and estimate`, async () => {
        await preview.getByRole('textbox', { name: t('Organizer', '组织者'), exact: true }).fill('Lin');
        await preview.getByRole('radio', { name: t('Online', '线上'), exact: true }).check();
        const people = await slider(t('Participants', '参与人数'), 'Home');
        for (let index = 1; index < 6; index++) await people.press('ArrowRight');
        await preview.getByLabel(t('Include a materials kit (20 per person)', '增加材料包（每人 20 元）'), { exact: true }).check();
        const summary = preview.locator('.local-card').filter({ has: page.getByRole('heading', { name: t('Your workshop at a glance', '你的活动方案'), exact: true }) });
        await expect(summary).toContainText('Lin');
        await expect(summary).toContainText('480');
        await expect(preview.getByText(t('Prepare the call', '线上准备'), { exact: true })).toBeVisible();
        await page.getByRole('button', { name: t('Show source', '显示源码'), exact: true }).click();
        await expect(page.locator('#source-editor')).toBeVisible();
        await expect(summary).toContainText('480');
        await page.getByRole('button', { name: t('Presentation mode', '演示模式'), exact: true }).click();
        await expect(summary).toContainText('480');
        await preview.getByRole('button', { name: t('Reset Workshop details', '活动配置 恢复默认'), exact: true }).click();
        await expect(summary).toContainText('320');
        await expect(summary).toContainText('Alex');
        await page.screenshot({ path: `artifacts/showcase-${language}-forms.png`, fullPage: true });
      });

      await pick('statistics');
      await check(`${language}: one expense updates total, table, bars and the budget warning`, async () => {
        const total = preview.locator('.local-card').filter({ has: page.getByRole('heading', { name: t('Total spent', '费用合计'), exact: true }) }).last();
        await expect(total).toContainText('620');
        const chart = preview.locator('.local-visual-chart').first();
        const before = await chart.locator('svg').innerHTML();
        const visual = preview.getByRole('textbox', { name: t('Visual expense', '视觉费用'), exact: true });
        await visual.fill('300'); await visual.blur();
        await expect(total).toContainText('690');
        await expect.poll(() => chart.locator('svg').innerHTML()).not.toBe(before);
        const table = preview.getByRole('table', { name: t('Expense details', '费用明细'), exact: true });
        await expect(table).toContainText('300');
        await visual.fill('310'); await visual.blur();
        await expect(total).toContainText('700');
        await expect(preview.getByText(t('Over budget', '费用已超出预算'), { exact: true })).toBeVisible();
      });
      await check(`${language}: table search, numeric sorting and paging keep their scope`, async () => {
        const table = preview.getByRole('table', { name: t('Expense details', '费用明细'), exact: true });
        await preview.getByRole('button', { name: t('Next', '下一页'), exact: true }).click();
        await expect(table).toContainText(t('Testing', '测试'));
        await preview.getByRole('searchbox').fill(t('Visual', '视觉'));
        await expect(table.locator('tbody tr')).toHaveCount(1);
        await expect(table).toContainText('310');
        await preview.getByRole('searchbox').fill('no such category');
        await expect(preview.getByText(t('No matching results', '没有匹配结果'), { exact: true })).toBeVisible();
        await preview.getByRole('searchbox').fill('');
        await table.getByRole('button', { name: new RegExp(t('Actual', '实际')) }).click();
        await expect(table.locator('tbody tr').first()).toContainText(t('Testing', '测试'));
        await preview.getByRole('tab', { name: t('Budget and actual', '预算与实际'), exact: true }).click();
        await expect(preview.locator('.local-visual-chart-scatter')).toBeVisible();
        await preview.getByRole('tab', { name: t('Share of expenses', '费用占比'), exact: true }).click();
        await expect(preview.locator('.local-visual-chart-donut')).toBeVisible();
        await page.screenshot({ path: `artifacts/showcase-${language}-statistics.png`, fullPage: true });
      });

      await pick('layout');
      await check(`${language}: reading roles, keyboard tabs and disclosures reveal useful content`, async () => {
        const role = preview.getByRole('tab', { name: t('Participant', '参与者'), exact: true });
        await role.focus(); await role.press('ArrowRight');
        await expect(preview.getByRole('heading', { name: t('Guide the exploration', '引导一次探索'), exact: true })).toBeVisible();
        await preview.getByRole('button', { name: t('How do these layouts work together?', '这些布局如何搭配？'), exact: true }).click();
        await expect(preview.getByText(t('Cards compare related ideas, tabs separate reading contexts, and disclosures keep optional details within reach.', '卡片用于比较相关信息，标签页区分阅读情境，折叠内容保留随时可查的补充细节。'), { exact: true })).toBeVisible();
        await preview.getByRole('button', { name: t('Show the key source', '展开关键源码'), exact: true }).click();
        await expect(preview.locator('pre')).toBeVisible();
      });

      await pick('flow');
      await check(`${language}: diagram selection and changing values explain the same calculation`, async () => {
        const headcount = await slider(t('Headcount', '人数'), 'Home');
        for (let index = 1; index < 6; index++) await headcount.press('ArrowRight');
        const nodes = preview.locator('[data-diagram-node]');
        await nodes.nth(1).click();
        await expect(preview).toContainText('6 × 80 = 480');
        await nodes.nth(1).press('ArrowRight');
        await expect(nodes.nth(2)).toBeFocused();
        await nodes.nth(2).press('Enter');
        await expect(nodes.nth(2)).toHaveAttribute('aria-pressed', 'true');
        await expect(preview.getByText(t('The document now explains the result', '文档呈现计算结果'), { exact: true })).toBeVisible();
      });

      await pick('tasks');
      await check(`${language}: readiness, counter and timer follow their own reset scopes`, async () => {
        const checkboxes = preview.getByRole('checkbox');
        await checkboxes.nth(1).check(); await checkboxes.nth(2).check();
        await expect(preview.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
        await expect(preview.getByText(t('Ready to share', '可以开始分享了'), { exact: true })).toBeVisible();
        await preview.locator('.local-counter').getByRole('button').nth(1).click();
        await expect(preview.locator('.local-counter-value')).toHaveText('1');
        await preview.getByRole('button', { name: t('Start', '开始'), exact: true }).click();
        await expect(preview.getByRole('button', { name: t('Pause', '暂停'), exact: true })).toBeVisible();
        await preview.getByRole('button', { name: t('Pause', '暂停'), exact: true }).click();
        const count = await preview.locator('.local-counter-value').textContent();
        const timer = await preview.locator('.local-timer-value').textContent();
        await preview.getByRole('button', { name: t('Reset Workshop readiness', '活动准备进度 恢复默认'), exact: true }).click();
        await expect(preview.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33.33333333333333');
        await expect(preview.locator('.local-counter-value')).toHaveText(count);
        await expect(preview.locator('.local-timer-value')).toHaveText(timer);
      });

      await check(`${language}: every tour fits phone, tablet and desktop widths in both modes`, async () => {
        for (const width of [375, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const id of ids) {
            await pick(id);
            if (width === 375) {
              await expect(page.locator('.showcase-links')).toBeHidden();
              await expect(page.locator('.showcase-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
            }
            expect(await fits(), `${language} ${id} presentation at ${width}`).toBe(true);
            expect(await gridOverflows(preview), `${language} ${id} presentation grids at ${width}`).toEqual([]);
            await page.getByRole('button', { name: t('Show source', '显示源码'), exact: true }).click();
            expect(await fits(), `${language} ${id} editing at ${width}`).toBe(true);
            expect(await gridOverflows(preview), `${language} ${id} editing grids at ${width}`).toEqual([]);
            await page.getByRole('button', { name: t('Presentation mode', '演示模式'), exact: true }).click();
          }
          if (width === 375) await page.screenshot({ path: `artifacts/showcase-${language}-mobile.png`, fullPage: true });
        }
      });

      await check(`${language}: debugging opens the editor and returning to a tour recovers`, async () => {
        await page.locator('#example-select').selectOption('diagnostics');
        await expect(page.locator('.pane-editor')).toBeVisible();
        await expect(page.locator('.status-chip')).toContainText(t('Compile failed', '编译失败'));
        await expect(page.locator('.diagnostic-item').first()).toBeVisible();
        await page.reload();
        await expect(page.locator('.pane-editor')).toBeVisible();
        await expect(page.locator('.status-chip')).toContainText(t('Compile failed', '编译失败'));
        await pick('forms');
        await expect(preview.getByRole('textbox', { name: t('Organizer', '组织者'), exact: true })).toBeVisible();
      });
    } finally { await context.close(); }
  }
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  await writeFile('artifacts/showcase-results.json', JSON.stringify({ baseURL, checks, errors, externalRequests }, null, 2));
} finally { await browser.close(); }
