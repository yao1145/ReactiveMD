import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
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
  if (id === 'pricing') {
    await page.locator('[data-example-id="pricing"]').click();
    await page.getByRole('button', { name: 'Restore example', exact: true }).click();
  } else if (id === 'gallery' || id === 'diagnostics') {
    await page.getByLabel('Reference', { exact: true }).selectOption(id);
    await page.getByRole('button', { name: 'Restore example', exact: true }).click();
  } else {
    // Retain the original component regressions alongside the new feature tours.
    const source = await readFile(new URL(`../../examples/local/${id}.reactive.md`, import.meta.url), 'utf8');
    await page.locator('#source-editor').fill(source);
  }
  if (id === 'diagnostics') {
    await expect(status()).toContainText('Compile failed');
  } else {
    await expect(status()).toContainText('Compiled');
    await expect(preview().locator('.local-document')).toBeVisible();
  }
}

try {
  await page.goto(baseURL);
  await expect(page.locator('[data-example-id="pricing"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Show source', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'People', exact: true })).toBeVisible();
  await check('library styles preserve host elements with common class names', async () => {
    // A separate document excludes the playground's own diagnostic styles.
    const styleProbe = await browser.newPage();
    try {
      await styleProbe.setContent('<!doctype html><html><head><style>span { outline: 3px solid rgb(23,45,67); }</style></head><body></body></html>');
      await styleProbe.addStyleTag({ content: await readFile(new URL('../../dist-library/reactive-md.css', import.meta.url), 'utf8') });
      const differences = await styleProbe.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'color:rgb(23,45,67);font-size:19px;line-height:1.4';
      document.body.append(host);
      try {
        const probes = [
          ['field-error', 'span', ['display', 'color', 'fontSize', 'lineHeight']],
          ['component-error', 'span', ['display', 'backgroundColor', 'padding', 'borderRadius']],
          ['diag-link', 'button', ['marginLeft', 'padding', 'borderWidth', 'backgroundColor']],
          ['gap-sm', 'div', ['gap']],
          ['gap-lg', 'div', ['gap']],
          ['data-chart-mark', 'span', ['outlineStyle', 'outlineWidth']],
        ];
        return probes.flatMap(([className, tagName, properties]) => {
          const baseline = document.createElement(tagName);
          const probe = document.createElement(tagName);
          baseline.textContent = probe.textContent = 'Host content';
          if (className === 'data-chart-mark') probe.setAttribute('data-chart-mark', '');
          else probe.className = className;
          host.append(baseline, probe);
          const expected = getComputedStyle(baseline);
          const actual = getComputedStyle(probe);
          return properties.filter(key => expected[key] !== actual[key]).map(key => ({
            className, property: key, expected: expected[key], actual: actual[key],
          }));
        });
      } finally { host.remove(); }
      });
      expect(differences).toEqual([]);
    } finally { await styleProbe.close(); }
  });
  await check('feature navigation separates seven tours from reference and debugging', async () => {
    await expect(page.locator('[data-example-id]')).toHaveCount(7);
    await expect(page.getByLabel('Reference', { exact: true }).locator('option')).toHaveCount(3);
  });

  await check('default pricing example starts at 200 USD', async () => {
    await expect(page.getByRole('slider', { name: 'People', exact: true })).toHaveValue('2');
    await expect(paragraph('Monthly total:')).toContainText('200');
    await expect(status()).toContainText('Compiled');
  });

  await check('annual billing, five seats and panel reset update the same bindings', async () => {
    await page.getByLabel('Annual billing', { exact: true }).click();
    await expect(paragraph('Monthly total:')).toContainText('160');
    const seats = page.getByRole('slider', { name: 'People', exact: true });
    await seats.focus();
    await seats.press('Home');
    for (let step = 0; step < 4; step++) await seats.press('ArrowRight');
    await expect(paragraph('Monthly total:')).toContainText('400');
    await expect(preview().getByText('You selected at least 5 people. Switch the billing cycle to compare costs.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Reset/ }).click();
    await expect(paragraph('Monthly total:')).toContainText('200');
    await expect(preview().getByText('You selected at least 5 people. Switch the billing cycle to compare costs.', { exact: true })).not.toBeVisible();
  });

  await check('reload resets interaction state and keeps the selected source', async () => {
    await page.reload();
    await expect(page.locator('[data-example-id="pricing"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(paragraph('Monthly total:')).toContainText('200');
    await expect(page.getByRole('slider', { name: 'People', exact: true })).toHaveValue('2');
  });

  await check('source editing compiles local controls and expressions immediately', async () => {
    await page.getByRole('button', { name: 'Show source', exact: true }).click();
    const editor = page.locator('#source-editor');
    await editor.fill('<slider bind="n" label="Test value" initial="4" min="0" max="10">\n\nCurrent value: **{{ n * 2 }}**.');
    const slider = page.getByRole('slider', { name: 'Test value', exact: true });
    await expect(slider).toHaveValue('4');
    await expect(paragraph('Current value:')).toContainText('8');
    await slider.focus();
    await slider.press('End');
    await expect(paragraph('Current value:')).toContainText('20');
    await expect(status()).toContainText('Compiled');
  });

  await check('invalid source deactivates the preview and diagnostics focus the editor', async () => {
    await page.locator('#source-editor').fill('<slider bind="n" label="Test value" initial="20" min="0" max="10">');
    await expect(status()).toContainText('Compile failed');
    await expect(preview().getByText('Preview disabled', { exact: true })).toBeVisible();
    await expect(page.locator('.diagnostic-item').first()).toBeVisible();
    await page.locator('.diagnostic-item').first().click();
    await expect(page.locator('#source-editor')).toBeFocused();
    expect(await page.locator('#source-editor').evaluate((element) => element.selectionEnd > element.selectionStart)).toBe(true);
  });

  await check('script tags are inert fallback text, not executable HTML', async () => {
    // Unsupported tags are preserved as fallback content and reported as warnings.
    await page.locator('#source-editor').fill('<script>window.__localInjected=1</script>\n\n# Should not run');
    await expect(status()).toContainText('Compiled');
    await expect(preview().locator('.local-fallback')).toContainText('window.__localInjected=1');
    expect(await preview().locator('script').count()).toBe(0);
    expect(await page.evaluate(() => window.__localInjected)).toBeUndefined();
  });

  const catalogue = [
    ['comparison', 'Side by side, easier to compare'],
    ['parameters', 'Fill it in, watch the result'],
    ['checklist', 'Organize a walkthrough with a checklist'],
    ['charts', 'Charts follow their inputs'],
    ['diagram', 'Make explanations explorable'],
    ['catalog', 'Find components in the document'],
    ['planning', 'Planning, timing and simple tools'],
    ['components', 'Organize interactions with content'],
    ['pricing', 'Plan calculator'],
    ['counter', 'Counter'],
    ['gallery', 'Common component gallery'],
  ];
  for (const [id, title] of catalogue) {
    await check(`example ${id} renders its document heading`, async () => {
      await pick(id);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    });
  }

  await pick('parameters');
  await check('parameter fields, choices and conditional checklist stay in sync', async () => {
    await page.getByLabel('Name', { exact: true }).fill('Alex');
    await expect(paragraph('Name:')).toContainText('Alex');
    await preview().getByText('Team use', { exact: true }).click();
    await expect(paragraph('Usage:')).toContainText('Team use');
    await page.getByLabel('Show the preparation checklist', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Decide which parameters readers need to adjust', exact: true })).toBeVisible();
  });

  await pick('checklist');
  await check('checklist and enhanced table react locally', async () => {
    await page.getByRole('checkbox', { name: 'Adjust parameters and watch the results', exact: true }).check();
    await expect(paragraph('Done:')).toContainText('2 / 3');
    const table = page.getByRole('table', { name: 'Component price examples', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await preview().getByRole('searchbox').fill('visual');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await preview().getByRole('searchbox').fill('nonexistent component');
    await expect(preview().getByText('No matching results', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Reset/ }).click();
    // This table is outside the checklist panel, so its query is preserved.
    await expect(table.locator('tbody tr')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Adjust parameters and watch the results', exact: true })).not.toBeChecked();
    await preview().getByRole('searchbox').fill('');
    await expect(table.locator('tbody tr')).toHaveCount(3);
  });

  await pick('charts');
  await check('charts and plots render SVG and follow their inputs', async () => {
    await expect.poll(() => preview().locator('svg').count()).toBeGreaterThan(1);
    const before = await preview().locator('svg').evaluateAll((nodes) => nodes.map((node) => node.innerHTML).join(''));
    const rate = page.getByRole('slider', { name: 'Annual rate (%)', exact: true });
    await rate.focus();
    await rate.press('Home');
    await expect.poll(async () => preview().locator('svg').evaluateAll((nodes) => nodes.map((node) => node.innerHTML).join('')))
      .not.toBe(before);
    await expect(preview().getByText('Cannot compute', { exact: false })).toHaveCount(0);
  });
  await check('charts and plots hide the removed data table toggle', async () => {
    await expect(preview().getByText('View data table', { exact: true })).toHaveCount(0);
    await expect(preview().locator('details summary', { hasText: 'View data table' })).toHaveCount(0);
  });
  await page.screenshot({ path: 'artifacts/local-charts.png', fullPage: true });

  await pick('diagram');
  await check('diagram selection updates the document text', async () => {
    await preview().getByRole('button', { name: /^Compute$/ }).click();
    await expect(paragraph('Current step:')).toContainText('Compute');
  });

  await pick('catalog');
  await check('catalog search, empty state and reset stay inside the table', async () => {
    const table = page.getByRole('table', { name: 'Component catalog', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(4);
    await preview().getByRole('searchbox').fill('visual');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table).toContainText('chart');
    await preview().getByRole('searchbox').fill('No such component');
    await expect(preview().getByText('No matching results', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Reset/ }).click();
    await expect(table.locator('tbody tr')).toHaveCount(4);
  });

  await pick('planning');
  await check('timeline and bill splitting calculate from controls', async () => {
    await expect(preview().getByText('Assemble references', { exact: true })).toBeVisible();
    await expect(paragraph('Each person pays')).toContainText('88');
    const tip = page.getByRole('slider', { name: 'Extra charge (%)', exact: true });
    await tip.focus();
    await tip.press('Home');
    await expect(paragraph('Each person pays')).toContainText('80');
  });
  await check('timer starts, pauses and resets without auto-start', async () => {
    const timer = preview().getByRole('timer');
    await expect(timer).toHaveAttribute('aria-label', '60 seconds remaining');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect.poll(async () => timer.getAttribute('aria-label')).not.toBe('60 seconds remaining');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const paused = await timer.getAttribute('aria-label');
    await page.waitForTimeout(1100);
    expect(await timer.getAttribute('aria-label')).toBe(paused);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(timer).toHaveAttribute('aria-label', '60 seconds remaining');
  });

  await pick('components');
  await check('style choice changes prose and tooltips are keyboard reachable', async () => {
    await preview().getByText('reactive bindings', { exact: true }).focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.getByLabel('Detailed', { exact: true }).click();
    await expect(preview().getByText('When readers adjust a control, the related content updates immediately.', { exact: false })).toBeVisible();
  });

  await pick('gallery');
  await check('gallery fields, selects, toggles and conditional code remain separate', async () => {
    await page.getByLabel('Name', { exact: true }).fill('Sam');
    await expect(paragraph('Hello,')).toContainText('Sam');
    await page.getByLabel('Annual billing (20% off)', { exact: true }).click();
    await expect(paragraph('Estimated cost:')).toContainText('192');
    await page.getByLabel('Plan', { exact: true }).selectOption('basic');
    await expect(paragraph('Estimated cost:')).toContainText('154');
    await expect(preview().locator('pre').filter({ hasText: '{{ example }}' })).toBeVisible();
  });
  await page.screenshot({ path: 'artifacts/local-desktop.png', fullPage: true });

  await pick('counter');
  await check('counter buttons share their binding with the prose', async () => {
    const increase = page.getByRole('button', { name: 'Current value increase', exact: true });
    await increase.click({ clickCount: 3 });
    await expect(paragraph('The prose can read it too:')).toContainText('3');
    const decrease = page.getByRole('button', { name: 'Current value decrease', exact: true });
    await decrease.click({ clickCount: 3 });
    await expect(paragraph('The prose can read it too:')).toContainText('0');
    await expect(decrease).toBeDisabled();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(paragraph('The prose can read it too:')).toContainText('0');
  });

  await pick('diagnostics');
  await check('diagnostic example reports every deliberate class and deactivates interaction', async () => {
    await expect(status()).toContainText('Compile failed');
    await expect(preview().getByText('Preview disabled', { exact: true })).toBeVisible();
    expect(await page.locator('.diagnostic-item').count()).toBeGreaterThanOrEqual(8);
    const text = await page.getByRole('region', { name: 'Compile and runtime diagnostics', exact: true }).locator('.diagnostic-list').innerText();
    expect(text).toMatch(/seat/);
    expect(text).toMatch(/slidr|Unknown/);
    expect(text).toMatch(/on-click/);
    expect(text).toMatch(/missing/);
  });

  await check('theme and simple view change the real interface', async () => {
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Light theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Presentation mode', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Source editor', exact: true })).toBeHidden();
    await expect(preview()).toBeVisible();
    await page.getByRole('button', { name: 'Show source', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Source editor', exact: true })).toBeVisible();
  });

  await pick('pricing');
  await page.setViewportSize({ width: 375, height: 900 });
  await check('375px layout fits and keeps the pricing controls usable', async () => {
    expect(await fits()).toBe(true);
    const seats = page.getByRole('slider', { name: 'People', exact: true });
    await seats.scrollIntoViewIfNeeded();
    await seats.focus();
    await seats.press('End');
    await page.getByLabel('Annual billing', { exact: true }).click();
    await expect(paragraph('Monthly total:')).toContainText('1600');
    expect(await fits()).toBe(true);
  });
  await page.screenshot({ path: 'artifacts/local-mobile.png', fullPage: true });

  await page.setViewportSize({ width: 1200, height: 900 });
  async function fixture(source) {
    await page.locator('#source-editor').fill(source);
    await expect(status()).toContainText('Compiled');
    await expect(preview().locator('.local-document')).toBeVisible();
  }

  await check('numeric drafts, IME, shared bindings and hidden checklist state follow one reset', async () => {
    await fixture(`<panel title="Draft validation">
<number bind="n" label="Number field" initial="2" min="0" max="10">
<slider bind="n" label="Synchronized slider" min="0" max="10">
<input bind="user" label="Name draft" initial="seed">
<if when="{{ n > 4 }}">
<checklist bind="done" label="Hidden checklist">
- [ ] Keep selection
</checklist>
</if>
</panel>

Public value: {{ n }}. Name: {{ user }}. Selection: {{ len(done) }}.`);
    const number = page.getByRole('textbox', { name: 'Number field', exact: true });
    await number.fill('');
    await expect(paragraph('Public value:')).toContainText('Public value: 2');
    await number.blur();
    await expect(number).toHaveAttribute('aria-invalid', 'true');
    await number.fill('6');
    await expect(page.getByRole('slider', { name: 'Synchronized slider', exact: true })).toHaveValue('6');
    await page.getByRole('checkbox', { name: 'Keep selection', exact: true }).check();
    await number.fill('2');
    await number.fill('6');
    await expect(page.getByRole('checkbox', { name: 'Keep selection', exact: true })).toBeChecked();
    const input = page.getByRole('textbox', { name: 'Name draft', exact: true });
    await input.dispatchEvent('compositionstart');
    await input.fill('中文');
    await expect(paragraph('Public value:')).toContainText('Name: seed');
    await input.dispatchEvent('compositionend', { data: '中文' });
    await expect(paragraph('Public value:')).toContainText('Name: 中文');
    await page.getByRole('button', { name: /^Reset/ }).click();
    await expect(number).toHaveValue('2');
    await expect(input).toHaveValue('seed');
    await expect(paragraph('Public value:')).toContainText('Selection: 0');
  });

  await check('local condition errors are visible and recover without affecting independent results', async () => {
    await fixture(`<slider bind="n" label="Denominator" initial="1" min="0" max="2">
<if when="{{ 1 / n > 0 }}">
Correct branch
</if>

Independent calculation: {{ n + 2 }}.`);
    const slider = page.getByRole('slider', { name: 'Denominator', exact: true });
    await slider.focus(); await slider.press('Home');
    await expect(preview().locator('.local-error')).toContainText('Cannot compute');
    await expect(paragraph('Independent calculation:')).toContainText('2');
    await slider.press('ArrowRight');
    await expect(preview().locator('.local-error')).toHaveCount(0);
    await expect(preview().getByText('Correct branch', { exact: true })).toBeVisible();
  });

  await check('hiding a running timer pauses it and showing it preserves the paused value', async () => {
    await fixture(`<toggle bind="show" label="Show timer" initial="true">
<if when="{{ show }}">
<timer label="Hidden timer" duration="3">
</if>`);
    const timer = preview().getByRole('timer', { includeHidden: true });
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect.poll(() => timer.innerText()).not.toBe('3 seconds');
    await page.getByLabel('Show timer', { exact: true }).uncheck();
    await expect(timer).toBeHidden();
    await expect(preview().locator('.local-timer-status')).toContainText('Paused');
    const paused = await timer.textContent();
    await page.waitForTimeout(1200);
    await page.getByLabel('Show timer', { exact: true }).check();
    await expect(timer).toHaveText(paused);
    await expect(preview().locator('.local-timer-status')).toContainText('Paused');
  });

  await check('typed table sorting, pagination and panel reset preserve source order', async () => {
    await fixture(`<panel title="Table validation">
<table label="Sort test" page-size="2">
| Name | Price |
| --- | --- |
| B | 10 |
| A | 2 |
| C | 5 |
</table>
</panel>`);
    const table = page.getByRole('table', { name: 'Sort test', exact: true });
    const rows = table.locator('tbody tr');
    const sort = table.getByRole('button', { name: /^Price/ });
    await sort.click();
    await expect(rows.first()).toContainText('A');
    await expect(rows.nth(1)).toContainText('C');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('B');
    await sort.click();
    await expect(rows.first()).toContainText('B');
    await expect(rows.nth(1)).toContainText('C');
    await sort.click();
    await expect(rows.nth(1)).toContainText('A');
    await preview().getByRole('searchbox').fill('C');
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: /^Reset/ }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('B');
    await expect(rows.nth(1)).toContainText('A');
  });

  await page.goto(baseURL + '/embed.html');
  await check('embedded local documents keep independent in-memory state', async () => {
    const first = page.getByRole('region', { name: 'Instance A', exact: true });
    const second = page.getByRole('region', { name: 'Instance B', exact: true });
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
    expect(duplicateIds).toEqual([]);
    await first.getByLabel('Name', { exact: true }).fill('Sam');
    await expect(first).toContainText('Sam');
    await expect(second).toContainText('Reader');
    await page.getByRole('button', { name: 'Remount', exact: true }).click();
    await expect(first).toContainText('Reader');
    await expect(second).toContainText('Reader');
  });
  await page.screenshot({ path: 'artifacts/local-embed.png', fullPage: true });

  await check('language toggle localizes playground, guide and survives reload', async () => {
    // A fresh context keeps the saved language out of the English checks above.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const localized = await context.newPage();
      localized.setDefaultTimeout(10000);
      localized.on('pageerror', (error) => errors.push(`language toggle: ${error.message}`));
      localized.on('request', (request) => {
        if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL).origin) {
          externalRequests.push(request.url());
        }
      });

      await localized.goto(baseURL);
      await localized.getByRole('button', { name: 'Show source', exact: true }).click();
      await expect(localized.locator('html')).toHaveAttribute('lang', 'en');
      await expect(localized).toHaveTitle('Reactive MD · Interactive Document Lab');
      await expect(localized.locator('[data-example-id="pricing"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(localized.locator('[data-example-id="pricing"]')).toHaveText('Quick start');
      await expect(localized.locator('#source-editor')).toHaveValue(/# Plan calculator/);
      await expect(localized.locator('.preview-stage').getByRole('heading', { name: 'Plan calculator', level: 1 }))
        .toBeVisible();

      await localized.getByTestId('language-toggle').click();
      await expect(localized.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(localized).toHaveTitle('Reactive MD · 交互文档实验室');
      await expect(localized.locator('[data-example-id="pricing"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(localized.locator('[data-example-id="pricing"]')).toHaveText('快速体验');
      await expect(localized.locator('#source-editor')).toHaveValue(/# 方案计算器/);
      await expect(localized.locator('.preview-stage').getByRole('heading', { name: '方案计算器', level: 1 }))
        .toBeVisible();
      await expect(localized.getByRole('button', { name: '你的方案 恢复默认', exact: true })).toBeVisible();
      await expect(localized.getByRole('toolbar', { name: '文档编辑工具栏', exact: true })).toBeVisible();
      await expect(localized.locator('.status-chip')).toContainText('已编译');
      await expect(localized.getByRole('button', { name: '切换到英文', exact: true })).toBeVisible();

      await localized.getByRole('button', { name: '使用指南', exact: true }).click();
      await expect(localized.locator('.guide-paper').getByRole('heading', {
        name: 'Reactive MD 新用户指南',
        level: 1,
      })).toBeVisible();
      await localized.getByRole('button', { name: '返回 Playground', exact: true }).click();
      await expect(localized.getByRole('toolbar', { name: '文档编辑工具栏', exact: true })).toBeVisible();

      await localized.reload();
      await localized.getByRole('button', { name: '显示源码', exact: true }).click();
      await expect(localized.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(localized).toHaveTitle('Reactive MD · 交互文档实验室');
      await expect(localized.locator('[data-example-id="pricing"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(localized.locator('#source-editor')).toHaveValue(/# 方案计算器/);
      await expect(localized.getByRole('button', { name: '切换到英文', exact: true })).toBeVisible();
      await expect(localized.getByRole('button', { name: '你的方案 恢复默认', exact: true })).toBeVisible();

      await localized.getByRole('button', { name: '切换到英文', exact: true }).click();
      await expect(localized.locator('html')).toHaveAttribute('lang', 'en');
      await expect(localized).toHaveTitle('Reactive MD · Interactive Document Lab');
      await expect(localized.locator('[data-example-id="pricing"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(localized.locator('[data-example-id="pricing"]')).toHaveText('Quick start');
      await expect(localized.locator('#source-editor')).toHaveValue(/# Plan calculator/);
      await expect(localized.locator('.preview-stage').getByRole('heading', { name: 'Plan calculator', level: 1 }))
        .toBeVisible();
      await expect(localized.getByRole('button', { name: 'Switch to Chinese', exact: true })).toBeVisible();
      await expect(localized.getByRole('toolbar', { name: 'Document editing toolbar', exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  await check('no browser runtime exceptions', async () => expect(errors).toEqual([]));
  await check('local interactions make no unexpected external requests', async () => expect(externalRequests).toEqual([]));
  await writeFile('artifacts/local-browser-results.json', JSON.stringify({ baseURL, checks, errors, externalRequests }, null, 2));
} finally {
  await browser.close();
}
