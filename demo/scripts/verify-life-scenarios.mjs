import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { gridOverflows } from './grid-layout-assertions.mjs';

const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts/life-scenarios', { recursive: true });
try {
  for (const language of ['en', 'zh']) {
    const t = (en, zh) => language === 'en' ? en : zh;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(language => localStorage.setItem('reactive-md:language', language), language);
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL).origin) requests.push(request.url());
    });
    await page.goto(baseURL);
    const menu = page.locator('#example-select');
    const preview = page.locator('.preview-stage');
    const ready = async () => {
      await expect(page.locator('.status-chip')).toContainText(t('Compiled', '已编译'));
      await expect(preview.locator('.local-error')).toHaveCount(0);
    };
    const pick = async id => { await menu.selectOption(id); await ready(); };
    await expect(menu).toHaveValue('classroom');
    expect(await menu.locator('option').evaluateAll(items => items.map(item => item.value)))
      .toEqual(['classroom', 'proposal', 'survey', 'blog', 'features', 'diagnostics', 'games']);
    expect(await menu.locator('option').allTextContents()).toEqual(t(
      ['Classroom', 'Proposal', 'Survey', 'Blog', 'Feature demo', 'Diagnostics', 'Games'],
      ['课堂教学', '方案展示', '活动调研', '博客长文', '功能演示', '调试示例', '小游戏']));
    await expect(page.locator('#feature-example-select')).toHaveCount(0);
    await ready();
    await expect(preview.locator('.local-visual-plot')).toBeVisible();
    const partialSum = preview.locator('.local-visual-plot path').nth(1);
    const originalCurve = await partialSum.getAttribute('d');
    await preview.getByRole('slider', { name: t('Nonzero terms N', '保留的非零项数 N'), exact: true }).fill('8');
    await expect(partialSum).not.toHaveAttribute('d', originalCurve);
    await preview.getByRole('slider', { name: t('Observation point x', '观察位置 x'), exact: true }).fill('0');
    await expect(preview).toContainText('0.0000');
    await preview.getByRole('slider', { name: t('Harmonic number n', '谐波编号 n'), exact: true }).fill('2');
    await expect(preview).toContainText('0.000000');
    await expect(preview.locator('.katex-error')).toHaveCount(0);

    await pick('proposal');
    await expect(preview).toContainText('4,356.00');
    await preview.getByRole('checkbox', { name: t('Use refurbished shelves', '采用翻新书架'), exact: true }).check();
    await expect(preview).toContainText('4,092.00');
    const budget = preview.getByRole('textbox', { name: t('Available budget (CNY)', '可用预算（元）'), exact: true });
    await budget.fill('4000'); await budget.blur();
    await expect(preview.getByText(t('Reduce the initial scope', '需要缩小采购范围'), { exact: true })).toBeVisible();
    await expect(preview).toContainText('92.00');

    await pick('survey');
    await preview.getByRole('textbox', { name: t('What should we call you?', '怎么称呼你'), exact: true }).fill('River');
    await preview.getByRole('checkbox', { name: t('Organise a set of phone photos', '用手机整理一组照片'), exact: true }).check();
    await preview.getByRole('checkbox', { name: t('Finish a short personal essay', '写完一篇生活小记'), exact: true }).check();
    await preview.getByRole('radio', { name: t('Discuss a question of my own', '带着自己的问题交流'), exact: true }).check();
    await expect(preview.getByRole('table', { name: t('Your preparation list', '你的内容准备单'), exact: true }).locator('tbody tr')).toHaveCount(2);
    const summary = preview.locator('.local-card').filter({ has: page.getByRole('heading', { name: t('My learning session preferences', '我的共学意向'), exact: true }) });
    await expect(summary).toContainText('River');
    await expect(summary).toContainText('120');

    await pick('blog');
    await preview.getByRole('radio', { name: t('Brushing dirt off the clothes', '扑掉衣上的泥土'), exact: true }).click();
    await expect(preview.getByRole('heading', { name: t('The oranges have finally arrived', '他终于把橘子送到了'), exact: true })).toBeVisible();
    await preview.getByRole('textbox', { name: t('My reading note', '我的阅读旁注'), exact: true }).fill('I remembered a small gesture.');
    await expect(preview.locator('.local-card').last()).toContainText('I remembered a small gesture.');
    expect(await preview.locator('h2').count()).toBeGreaterThanOrEqual(5);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const id of ['classroom', 'proposal', 'survey', 'blog', 'features', 'games']) {
        await pick(id);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language} ${id} ${width}px`).toBe(true);
        expect(await gridOverflows(preview), `${language} ${id} grids ${width}px`).toEqual([]);
        const outline = await page.locator('#document-outline').boundingBox();
        const pane = await page.locator('#source-pane').boundingBox();
        if (width >= 1100) expect(pane.x).toBeGreaterThanOrEqual(outline.x + outline.width);
        else expect(pane.y).toBeGreaterThanOrEqual(outline.y + outline.height);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `artifacts/life-scenarios/${language}-${id}-${width}.png` });
      }
    }
    await pick('features');
    await expect(page.locator('#feature-example-select')).toHaveCount(0);
    expect(await preview.locator('h2').count()).toBeGreaterThanOrEqual(6);
    await preview.getByRole('slider', { name: t('Amplitude', '振幅'), exact: true }).fill('0');
    await expect(preview.getByText(t('The wave is flat', '波形已变为直线'), { exact: true })).toBeVisible();
    await preview.getByRole('slider', { name: t('Participants', '参与人数'), exact: true }).fill('6');
    await expect(preview).toContainText('480.00');
    await expect(preview.locator('.local-error')).toHaveCount(0);
    await expect(menu).toHaveValue('features');
    await expect(preview.getByRole('slider', { name: t('Amplitude', '振幅'), exact: true })).toBeVisible();
    await page.reload();
    await expect(menu).toHaveValue('features');
    await expect(page.locator('#feature-example-select')).toHaveCount(0);
    await pick('games');
    await expect(preview.locator('[data-tetris]')).toBeVisible();
    await expect(preview.locator('[data-game-2048]')).toBeVisible();
    const moves = Number(await preview.locator('[data-game-2048]').getAttribute('data-moves'));
    await preview.locator('[data-tetris-drop]').click();
    expect(Number(await preview.locator('[data-game-2048]').getAttribute('data-moves'))).toBe(moves);
    await preview.getByRole('checkbox', { name: t('Lock tetris', '锁定俄罗斯方块'), exact: true }).check();
    await expect(preview.locator('[data-tetris-drop]')).toBeDisabled();
    await expect(preview.locator('[data-game-2048-left]')).toBeEnabled();
    await pick('blog');
    await expect(page.locator('#feature-example-select')).toHaveCount(0);
    await page.getByTestId('language-toggle').click();
    await expect(menu).toHaveValue('blog');
    await expect(page.locator('.status-chip')).toContainText(t('已编译', 'Compiled'));
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    console.log(`PASS ${language}: default classroom, live lesson/proposal/survey/blog, desktop/mobile layout, consolidated features, reload and language switch`);
    await context.close();
  }
} finally { await browser.close(); }
