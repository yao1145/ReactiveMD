import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(10_000);
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const preview = page.locator('.preview-stage');
const editor = page.locator('#source-editor');
let revision = 0;

async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS ' + name);
}

async function edit(source) {
  const marker = `浏览器检查版本 ${++revision}`;
  await editor.fill(`${source}\n\n${marker}`);
  await expect(page.locator('.status-chip')).toContainText('已编译');
  await expect(preview).toContainText(marker);
}

async function maxSlider(name) {
  const slider = preview.getByRole('slider', { name, exact: true });
  await slider.focus();
  await slider.press('End');
  return slider;
}

const trialSource = `<panel title="试算参数">
<slider bind="count" label="试算人数" initial="2" min="0" max="10">
<input bind="name" label="试算称呼" initial="读者">
<toggle bind="annual" label="试算年付">
</panel>

试算结果：{{ count * 2 }}；{{ name }}；{{ annual }}。`;

try {
  await page.goto(baseURL);
  await expect(page.locator('.status-chip')).toContainText('已编译');

  await check('peer block titles share a scale and nested content stays readable on desktop and mobile', async () => {
    await edit(`# 排版层级

## 文档章节

正文说明。

<panel title="AAA">
<slider bind="size" label="参数标签" initial="2" min="0" max="10">

<grid columns="2">
<card title="嵌套卡片">
嵌套正文。

<panel title="更深的面板">
深层正文。
</panel>
</card>
<card title="并排卡片">
<plot min="0" max="12.56" label="嵌套曲线" x-label="x" y-label="位移">
$$ y = x $$
</plot>
</card>
</grid>
</panel>

<plot min="0" max="12.56" label="AAA" x-label="x" y-label="位移">
$$ y = x $$
</plot>

<grid columns="2">
<card title="同级卡片">卡片正文。</card>
<card title="同级另一张卡片">卡片正文。</card>
</grid>

<tabs label="同级选项卡">
<tab label="选项标签">
<card title="选项内卡片">选项正文。</card>
</tab>
</tabs>

<accordion label="同级折叠组">
<disclosure label="这是一个需要在窄屏下自然换行的较长问题标题，用来检查标题行高和内容边界" open>
折叠正文。
</disclosure>
</accordion>

<alert title="同级提示">提示正文。</alert>

<table label="同级表格">
| 名称 | 数值 |
| --- | ---: |
| 数据 | 2 |
</table>

<chart title="同级图表">
| 名称 | 数值 |
| --- | ---: |
| 数据 | 2 |
</chart>

<timeline title="同级时间轴">
| 事项 | 开始 | 时长 |
| --- | ---: | ---: |
| 准备 | 0 | 10 |
</timeline>

<diagram label="同级图解">
<node id="start" label="开始">节点正文。</node>
</diagram>`);
    await expect(page.locator('.status-chip')).toHaveText(/已编译 · \d+ ms/);
    const article = preview.locator('.local-document');
    const titleSelector = '.local-panel-title, .md-card-title, .local-tabs-label, .local-accordion-label, .local-disclosure-trigger, .local-alert-title, .local-visual-title';
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
        const sizes = await article.locator(titleSelector).evaluateAll(nodes => nodes.map(node => {
          const css = getComputedStyle(node);
          return { title: node.textContent.trim(), size: css.fontSize, weight: css.fontWeight, leading: css.lineHeight };
        }));
        expect(sizes).toHaveLength(17);
        for (const title of sizes) {
          const nested = /嵌套|更深|并排|选项内|较长问题/.test(title.title);
          expect(title, JSON.stringify({ width, theme, title })).toMatchObject({
            size: nested ? '16px' : '18px', weight: '600', leading: nested ? '24px' : '27px',
          });
        }
        const bodySizes = await article.locator('p').evaluateAll(nodes => nodes
          .filter(node => /正文/.test(node.textContent) && !node.closest('.local-visual'))
          .map(node => getComputedStyle(node).fontSize));
        expect(bodySizes.length).toBeGreaterThan(5);
        expect(new Set(bodySizes)).toEqual(new Set(['16px']));
        await expect(article.locator('.local-tab')).toHaveCSS('font-size', '14px');
        await expect(article.locator('.md-label')).toHaveCSS('font-size', '14px');
        await expect(article.locator('.md-slider-value')).toHaveCSS('font-size', '12.5px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await mkdir('artifacts', { recursive: true });
        await article.screenshot({ path: `artifacts/block-typography-${width}-${theme}.png` });
      }
    }
    await page.locator('html').evaluate(node => node.setAttribute('data-theme', 'light'));
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await check('Markdown TOC resolves Chinese, encoded, formatted and duplicate headings', async () => {
    await edit(`[中文目录](#参数说明) · [编码目录](#%E5%8F%82%E6%95%B0%E8%AF%B4%E6%98%8E) · [第二节](#参数说明-1) · [标题碰撞](#参数说明-1-1) · [English](#hello-world)

## 参数说明

第一节。

## 参数说明

第二节。

## 参数说明-1

第三节。

## Hello **World**`);
    const ids = await preview.locator('h2').evaluateAll(nodes => nodes.map(node => node.id));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    for (const [label, index] of [['中文目录', 0], ['编码目录', 0], ['第二节', 1], ['标题碰撞', 2], ['English', 3]]) {
      const link = preview.getByRole('link', { name: label, exact: true });
      const href = await link.getAttribute('href');
      expect(decodeURIComponent(href.slice(1))).toBe(ids[index]);
      await link.click();
      expect(decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(ids[index]);
    }
  });

  await check('dynamic heading IDs and TOC links stay stable while parameters change', async () => {
    await edit(`<slider bind="n" label="标题参数" initial="2" min="0" max="10">

[查看动态标题](#当前-2)

## 当前 {{ n }}`);
    const heading = preview.getByRole('heading', { level: 2 });
    const initialId = await heading.getAttribute('id');
    const href = await preview.getByRole('link', { name: '查看动态标题' }).getAttribute('href');
    await maxSlider('标题参数');
    await expect(heading).toHaveText('当前 10');
    await expect(heading).toHaveAttribute('id', initialId);
    await expect(preview.getByRole('link', { name: '查看动态标题' })).toHaveAttribute('href', href);
    expect(decodeURIComponent(href.slice(1))).toBe(initialId);
  });

  await check('prose and formula edits preserve the latest named numeric, text and boolean values', async () => {
    await edit(trialSource);
    await expect(page.getByRole('checkbox', { name: '保留试算状态', exact: true })).toBeChecked();
    await maxSlider('试算人数');
    await preview.getByRole('textbox', { name: '试算称呼', exact: true }).fill('林同学');
    await preview.getByRole('checkbox', { name: '试算年付', exact: true }).check();
    await edit(trialSource.replace('count * 2', 'count * 3') + '\n\n补充说明。');
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('10');
    await expect(preview.getByRole('textbox', { name: '试算称呼', exact: true })).toHaveValue('林同学');
    await expect(preview.getByRole('checkbox', { name: '试算年付', exact: true })).toBeChecked();
    await expect(preview).toContainText('试算结果：30；林同学；true');
  });

  await check('a temporary compilation error keeps the previous trial values for recovery', async () => {
    await editor.fill(trialSource + '\n\n<panel>');
    await expect(page.locator('.status-chip')).toContainText('编译失败');
    await expect(preview.getByRole('heading', { name: '预览已停用' })).toBeVisible();
    await edit(trialSource + '\n\n语法已恢复。');
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('10');
    await expect(preview.getByRole('textbox', { name: '试算称呼', exact: true })).toHaveValue('林同学');
  });

  await check('changed initial values and tighter constraints reset incompatible trial values', async () => {
    await edit(trialSource.replace('max="10"', 'max="5"'));
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('2');
    await maxSlider('试算人数');
    await edit(trialSource.replace('initial="2"', 'initial="3"'));
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('3');
  });

  await check('opting out resets values on editing and rerun restores current document defaults', async () => {
    await page.getByRole('checkbox', { name: '保留试算状态', exact: true }).uncheck();
    await maxSlider('试算人数');
    await edit(trialSource);
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('2');
    await page.getByRole('checkbox', { name: '保留试算状态', exact: true }).check();
    await maxSlider('试算人数');
    await page.getByRole('button', { name: '重新运行', exact: true }).click();
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('2');
  });

  await check('importing identical source starts a fresh trial session', async () => {
    await edit(trialSource);
    await maxSlider('试算人数');
    const identicalSource = await editor.inputValue();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'trial.reactive.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(identicalSource),
    });
    await expect(editor).toHaveValue(identicalSource);
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('2');
  });

  await check('reload and switching examples keep trial sessions isolated', async () => {
    await maxSlider('试算人数');
    await page.reload();
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('2');
    await maxSlider('试算人数');
    await page.getByLabel('示例', { exact: true }).selectOption('counter');
    await page.getByRole('button', { name: '恢复示例', exact: true }).click();
    await edit(trialSource);
    await expect(preview.getByRole('slider', { name: '试算人数', exact: true })).toHaveValue('2');
  });

  await check('guide navigation uses library-generated anchors', async () => {
    await page.getByRole('button', { name: '使用指南', exact: true }).click();
    const guide = page.locator('.guide-paper .local-document');
    const broken = await guide.evaluate(article => [...article.querySelectorAll('a[href^="#"]')].flatMap(link => {
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = document.getElementById(id);
      return target && article.contains(target) ? [] : [link.textContent];
    }));
    expect(broken).toEqual([]);
  });

  await page.goto(baseURL + '/embed.html');
  await check('identical embedded documents use separate IDs and target their own headings', async () => {
    const first = page.getByRole('region', { name: '实例 A', exact: true });
    const second = page.getByRole('region', { name: '实例 B', exact: true });
    for (const region of [first, second]) {
      const heading = region.getByRole('heading', { name: '本地参数', level: 2, exact: true });
      const id = await heading.getAttribute('id');
      const link = region.getByRole('link', { name: '跳到本地参数', exact: true });
      expect(decodeURIComponent((await link.getAttribute('href')).slice(1))).toBe(id);
      await link.click();
      expect(decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(id);
    }
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/document-usability-results.json', JSON.stringify({ baseURL, checks, errors }, null, 2));
} finally {
  await browser.close();
}
