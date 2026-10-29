import { textareaWorkbenchURL, clickWorkbenchAction, replaceWorkbenchSource } from './workbench-ui.mjs';
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
  const marker = `Browser check revision ${++revision}`;
  await replaceWorkbenchSource(page, `${source}\n\n${marker}`);
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await expect(preview).toContainText(marker);
}

async function maxSlider(name) {
  const slider = preview.getByRole('slider', { name, exact: true });
  await slider.focus();
  await slider.press('End');
  return slider;
}

async function trialStateCheckbox() {
  const options = page.locator('.workbench-options');
  if (!await options.evaluate(element => element.open)) await options.locator(':scope > summary').click();
  return options.getByRole('checkbox', {name: 'Keep trial state', exact: true});
}

const trialSource = `<panel title="Trial parameters">
<slider bind="count" label="Trial count" initial="2" min="0" max="10">
<input bind="name" label="Trial name" initial="Reader">
<toggle bind="annual" label="Trial annual billing">
</panel>

Trial result: {{ count * 2 }}; {{ name }}; {{ annual }}.`;

try {
  await page.goto(textareaWorkbenchURL(baseURL));
  await clickWorkbenchAction(page, 'Show source');
  await page.locator('.workbench-options').evaluate(node => { node.open = true; });
  await expect(page.locator('.status-chip')).toContainText('Compiled');

  await check('peer block titles share a scale and nested content stays readable on desktop and mobile', async () => {
    await edit(`# Typography hierarchy

## Document section

Body copy.

<panel title="AAA">
<slider bind="size" label="Parameter label" initial="2" min="0" max="10">

<grid columns="2">
<card title="Nested card">
Nested body copy.

<panel title="Deeper panel">
Deep body copy.
</panel>
</card>
<card title="Side-by-side card">
<plot min="0" max="12.56" label="Nested curve" x-label="x" y-label="Displacement">
$$ y = x $$
</plot>
</card>
</grid>
</panel>

<plot min="0" max="12.56" label="AAA" x-label="x" y-label="Displacement">
$$ y = x $$
</plot>

<grid columns="2">
<card title="Peer card">Card body copy.</card>
<card title="Another peer card">Card body copy.</card>
</grid>

<tabs label="Peer tabs">
<tab label="Tab label">
<card title="Card inside tab">Tab body copy.</card>
</tab>
</tabs>

<accordion label="Peer accordion">
<disclosure label="A longer question title that needs to wrap naturally on narrow screens to check heading line height and content bounds" open>
Collapsed body copy.
</disclosure>
</accordion>

<alert title="Peer alert">Alert body copy.</alert>

<table label="Peer table">
| Name | Value |
| --- | ---: |
| Data | 2 |
</table>

<chart title="Peer chart">
| Name | Value |
| --- | ---: |
| Data | 2 |
</chart>

<timeline title="Peer timeline">
| Task | Start | Duration |
| --- | ---: | ---: |
| Prepare | 0 | 10 |
</timeline>

<diagram label="Peer diagram">
<node id="start" label="Start">Node body copy.</node>
</diagram>`);
    await expect(page.locator('.status-chip')).toHaveText(/Compiled · \d+ ms/);
    const article = preview.locator('.local-document');
    const titleSelector = '.local-panel-title, .md-card-title, .local-tabs-label, .local-accordion-label, .local-disclosure-trigger, .local-alert-title, .local-visual-title';
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator(`[data-editor-view-option="${width < 600 ? 'preview' : 'split'}"]`).click();
      await expect(article).toBeVisible();
      for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
        const sizes = await article.locator(titleSelector).evaluateAll(nodes => nodes.map(node => {
          const css = getComputedStyle(node);
          return { title: node.textContent.trim(), size: css.fontSize, weight: css.fontWeight, leading: css.lineHeight };
        }));
        expect(sizes).toHaveLength(17);
        for (const title of sizes) {
          const nested = /Nested|Deeper|Side-by-side|inside tab|longer question/.test(title.title);
          expect(title, JSON.stringify({ width, theme, title })).toMatchObject({
            size: nested ? '16px' : '18px', weight: '600', leading: nested ? '24px' : '27px',
          });
        }
        const bodySizes = await article.locator('p').evaluateAll(nodes => nodes
          .filter(node => /body copy/i.test(node.textContent) && !node.closest('.local-visual'))
          .map(node => getComputedStyle(node).fontSize));
        expect(bodySizes.length).toBeGreaterThan(5);
        expect(new Set(bodySizes)).toEqual(new Set(['16px']));
        await expect(article.locator('.local-tab')).toHaveCSS('font-size', '14px');
        await expect(article.locator('.md-label')).toHaveCSS('font-size', '14px');
        await expect(article.locator('.md-slider-value')).toHaveCSS('font-size', '16px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await mkdir('artifacts', { recursive: true });
        await article.screenshot({ path: `artifacts/block-typography-${width}-${theme}.png` });
      }
    }
    await page.locator('html').evaluate(node => node.setAttribute('data-theme', 'light'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('[data-editor-view-option="split"]').click();
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
    await edit(`<slider bind="n" label="Heading parameter" initial="2" min="0" max="10">

[View dynamic heading](#current-2)

## Current {{ n }}`);
    const heading = preview.getByRole('heading', { level: 2 });
    const initialId = await heading.getAttribute('id');
    const href = await preview.getByRole('link', { name: 'View dynamic heading' }).getAttribute('href');
    await maxSlider('Heading parameter');
    await expect(heading).toHaveText('Current 10');
    await expect(heading).toHaveAttribute('id', initialId);
    await expect(preview.getByRole('link', { name: 'View dynamic heading' })).toHaveAttribute('href', href);
    expect(decodeURIComponent(href.slice(1))).toBe(initialId);
  });

  await check('prose and formula edits preserve the latest named numeric, text and boolean values', async () => {
    await edit(trialSource);
    await expect(await trialStateCheckbox()).toBeChecked();
    await maxSlider('Trial count');
    await preview.getByRole('textbox', { name: 'Trial name', exact: true }).fill('Alex');
    await preview.getByRole('checkbox', { name: 'Trial annual billing', exact: true }).check();
    await edit(trialSource.replace('count * 2', 'count * 3') + '\n\nAdditional note.');
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('10');
    await expect(preview.getByRole('textbox', { name: 'Trial name', exact: true })).toHaveValue('Alex');
    await expect(preview.getByRole('checkbox', { name: 'Trial annual billing', exact: true })).toBeChecked();
    await expect(preview).toContainText('Trial result: 30; Alex; true');
  });

  await check('a temporary compilation error keeps the previous trial values for recovery', async () => {
    await replaceWorkbenchSource(page, trialSource + '\n\n<panel>');
    await expect(page.locator('.status-chip')).toContainText('Compile failed');
    await expect(preview.getByRole('heading', { name: 'Preview disabled' })).toBeVisible();
    await edit(trialSource + '\n\nSyntax recovered.');
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('10');
    await expect(preview.getByRole('textbox', { name: 'Trial name', exact: true })).toHaveValue('Alex');
  });

  await check('changed initial values and tighter constraints reset incompatible trial values', async () => {
    await edit(trialSource.replace('max="10"', 'max="5"'));
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('2');
    await maxSlider('Trial count');
    await edit(trialSource.replace('initial="2"', 'initial="3"'));
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('3');
  });

  await check('opting out resets values on editing and rerun restores current document defaults', async () => {
    await (await trialStateCheckbox()).uncheck();
    await maxSlider('Trial count');
    await edit(trialSource);
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('2');
    await (await trialStateCheckbox()).check();
    await maxSlider('Trial count');
    await page.getByRole('button', { name: 'Run again', exact: true }).click();
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('2');
  });

  await check('importing identical source starts a fresh trial session', async () => {
    await edit(trialSource);
    await maxSlider('Trial count');
    const identicalSource = await editor.inputValue();
    await page.locator('.author-tools input[type="file"]').setInputFiles({
      name: 'trial.reactive.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(identicalSource),
    });
    await expect(editor).toHaveValue(identicalSource);
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('2');
  });

  await check('reload and switching examples keep trial sessions isolated', async () => {
    await maxSlider('Trial count');
    await page.reload();
    if (!await editor.isVisible()) await clickWorkbenchAction(page, 'Show source');
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('2');
    await maxSlider('Trial count');
    await page.getByRole('button', { name: 'Try examples', exact: true }).click();
    await page.locator('#example-select').selectOption('forms');
    await page.locator('.workbench-options').evaluate(node => { node.open = true; });
    await clickWorkbenchAction(page, 'Restore example');
    await edit(trialSource);
    await expect(preview.getByRole('slider', { name: 'Trial count', exact: true })).toHaveValue('2');
  });

  await check('guide navigation uses library-generated anchors', async () => {
    await page.getByRole('button', { name: 'User Guide', exact: true }).click();
    const guide = page.locator('.guide-paper .local-document');
    await expect(guide.getByRole('heading', { name: 'Reactive MD beginner guide', level: 1 })).toBeVisible();
    const broken = await guide.evaluate(article => [...article.querySelectorAll('a[href^="#"]')].flatMap(link => {
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = document.getElementById(id);
      return target && article.contains(target) ? [] : [link.textContent];
    }));
    expect(broken).toEqual([]);
  });

  await page.goto(textareaWorkbenchURL(baseURL + '/embed.html'));
  await check('identical embedded documents use separate IDs and target their own headings', async () => {
    const first = page.getByRole('region', { name: 'Instance A', exact: true });
    const second = page.getByRole('region', { name: 'Instance B', exact: true });
    for (const region of [first, second]) {
      const heading = region.getByRole('heading', { name: 'Local parameters', level: 2, exact: true });
      const id = await heading.getAttribute('id');
      const link = region.getByRole('link', { name: 'Jump to local parameters', exact: true });
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
