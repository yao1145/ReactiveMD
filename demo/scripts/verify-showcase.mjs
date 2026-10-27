import { clickWorkbenchAction } from './workbench-ui.mjs';
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
      await page.locator('#example-select').selectOption(id);
      await page.locator('.workbench-options').evaluate(node => { node.open = true; });
      await clickWorkbenchAction(page, t('Restore example', '恢复示例'));
      await page.locator('.workbench-options').evaluate(node => { node.open = false; });
      await expect(page.locator('.status-chip')).toContainText(t('Compiled', '已编译'));
      await expect(preview.locator('.local-document')).toBeVisible();
      await expect(preview.locator('.local-error')).toHaveCount(0);
      await expect(preview.locator('[data-local-validation="failed"]')).toHaveCount(0);
    };
    const slider = async (name, key) => {
      const control = preview.getByRole('slider', { name, exact: true });
      await control.focus(); await control.press(key); return control;
    };
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    try {
      await page.goto(baseURL);
      await check(`${language}: opens in presentation mode with seven distinct feature entries`, async () => {
        await expect(page.locator('#source-editor')).toBeHidden();
        const choices = await page.locator('#example-select option').evaluateAll(options => options.map(option => option.value));
        expect(choices.filter(id => ids.includes(id))).toEqual(ids);
        expect(choices).toContain('diagnostics');
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
        const savings = preview.getByRole('tabpanel', { name: t('Savings application', '应用：储蓄增长'), exact: true });
        await expect(savings).toContainText('232,643.24');
        await slider(t('Annual rate (%)', '年利率（%）'), 'Home');
        await expect(savings).toContainText('130,000.00');
        await expect(savings).toContainText(t('$0.00', '¥0.00'));
        await expect(preview.locator('.local-error')).toHaveCount(0);
        await page.screenshot({ path: `artifacts/showcase-${language}-functions.png`, fullPage: true });
      });

      await pick('forms');
      await check(`${language}: cross-field hints recover, tones follow spending and subjects generate rows`, async () => {
        const limit = preview.getByRole('textbox', { name: t('Spending limit', '费用上限'), exact: true });
        const deadline = preview.getByLabel(t('Registration deadline', '报名截止日期'), { exact: true });
        const failed = preview.locator('[data-local-validation="failed"]');
        await limit.fill('300'); await limit.blur();
        await expect(failed).toHaveCount(1);
        await expect(limit).toHaveAttribute('aria-invalid', 'true');
        await expect(preview.locator('.md-badge-warning')).toContainText('300.00');
        await deadline.fill('2026-11-02'); await deadline.blur();
        await expect(failed).toHaveCount(2);
        await expect(deadline).toHaveAttribute('aria-invalid', 'true');
        await deadline.fill('2026-10-25'); await deadline.blur();
        await limit.fill('500'); await limit.blur();
        await expect(failed).toHaveCount(0);
        await expect(limit).not.toHaveAttribute('aria-invalid', 'true');
        await expect(preview.locator('.md-badge-success')).toContainText('500.00');
        const table = preview.getByRole('table', { name: t('Subject preparation', '主题准备清单'), exact: true });
        await expect(table.locator('.local-data-table-empty')).toBeVisible();
        const subjects = preview.locator('.local-multi-select');
        await subjects.getByRole('checkbox', { name: t('Mathematics', '数学'), exact: true }).check();
        await subjects.getByRole('checkbox', { name: t('Chemistry', '化学'), exact: true }).check();
        await expect(table.locator('tbody tr')).toHaveCount(2);
        await expect(table).toContainText(t('Prepare materials and instructions', '准备材料与操作说明'));
        await preview.getByRole('checkbox', { name: t('Include a written step-by-step guide', '提供书面步骤说明'), exact: true }).check();
        await expect(table).toContainText(t('Written steps included', '附书面步骤'));
        await subjects.getByRole('checkbox', { name: t('Mathematics', '数学'), exact: true }).uncheck();
        await expect(table.locator('tbody tr')).toHaveCount(1);
        await expect(table).toContainText(t('Chemistry', '化学'));
        await page.screenshot({ path: `artifacts/showcase-${language}-forms.png`, fullPage: true });
      });

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
        await clickWorkbenchAction(page, t('Show source', '显示源码'));
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
        await expect(preview.locator('.md-badge-warning')).toContainText('101.4%');
        await expect(preview).toContainText(t('Average item $175.00', '每项平均 ¥175.00'));
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
      await check(`${language}: reading guidance changes before, on and after workshop day`, async () => {
        const date = preview.getByLabel(t('When are you reading?', '你在哪天阅读？'), { exact: true });
        await expect(preview.locator('.local-badge').first()).toHaveText(t('Before: prepare', '活动前：准备'));
        await date.fill('2026-11-01'); await date.blur();
        await expect(preview.locator('.local-badge').first()).toHaveText(t('Workshop day: explore', '活动当天：动手探索'));
        await date.fill('2026-11-03'); await date.blur();
        await expect(preview.locator('.local-badge').first()).toHaveText(t('After: reflect', '活动后：回顾'));
        await expect(preview).toContainText(t('The workshop was 2 days ago.', '活动已过去 2 天。'));
        await expect(preview.locator('.local-error')).toHaveCount(0);
      });
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
        const completed = preview.getByRole('table', { name: t('Completed preparation', '已完成的准备'), exact: true });
        await expect(completed.locator('tbody tr')).toHaveCount(3);
        await expect(preview.locator('.md-badge-success')).toContainText('100%');
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
        await expect(completed.locator('tbody tr')).toHaveCount(1);
        await expect(preview.locator('.local-counter-value')).toHaveText(count);
        await expect(preview.locator('.local-timer-value')).toHaveText(timer);
      });

      await check(`${language}: every tour fits phone, tablet and desktop widths in both modes`, async () => {
        for (const width of [375, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const id of ids) {
            await pick(id);
            if (width === 375) {
              await expect(page.locator('#example-select')).toBeVisible();
            }
            expect(await fits(), `${language} ${id} presentation at ${width}`).toBe(true);
            expect(await gridOverflows(preview), `${language} ${id} presentation grids at ${width}`).toEqual([]);
            if (width === 375 && id === 'forms') {
              const subjects = preview.locator('.local-multi-select');
              await subjects.getByRole('checkbox', { name: t('Chemistry', '化学'), exact: true }).check();
              await expect(preview.getByRole('table', { name: t('Subject preparation', '主题准备清单'), exact: true })).toContainText(t('Chemistry', '化学'));
              const limit = preview.getByRole('textbox', { name: t('Spending limit', '费用上限'), exact: true });
              await limit.fill('300'); await limit.blur();
              await expect(limit).toHaveAttribute('aria-invalid', 'true');
              expect(await fits(), `${language} populated table and hint at ${width}`).toBe(true);
              await page.screenshot({ path: `artifacts/showcase-${language}-forms-mobile.png`, fullPage: true });
              await limit.fill('500'); await limit.blur();
            }
            await clickWorkbenchAction(page, t('Show source', '显示源码'));
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
