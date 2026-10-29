import {textareaWorkbenchURL} from '../demo/scripts/workbench-ui.mjs';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preview } from 'vite';
import { clickWorkbenchAction, replaceWorkbenchSource } from '../demo/scripts/workbench-ui.mjs';

// Chromium keeps the full suite; Firefox and WebKit share this smaller gate.
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => !/^--browser=(chromium|firefox|webkit)(,(chromium|firefox|webkit))*$/.test(arg))) {
  throw new Error('Usage: node scripts/verify-browser-core.mjs [--browser=firefox,webkit]');
}
const engines = [...new Set((args[0]?.slice('--browser='.length) ?? process.env.PLAYWRIGHT_ENGINE ?? 'firefox,webkit').split(','))];
const browserTypes = { chromium, firefox, webkit };
if (engines.some(engine => !browserTypes[engine])) throw new Error(`Unknown browser: ${engines.join(',')}`);
const artifactRoot = join(root, 'artifacts/browser-core');
const report = { status: 'running', browsers: [], startedAt: new Date().toISOString() };
let server;

const source = `# Browser core

<slider bind="seats" label="Seats" initial="2" min="1" max="8">
<toggle bind="annual" label="Annual">
<input bind="guest" label="Guest" initial="Reader">
<date bind="day" label="Meeting date" initial="2026-11-01">
<computed name="total" value="{{ seats * (annual ? 80 : 100) }}">

Total: {{ total }} USD. Guest: {{ guest }}. Date: {{ day }}.

<if when="{{ seats >= 4 }}">
Group booking enabled.
</if>

<table label="Price list" page-size="2">
| Item | Price |
| --- | ---: |
| Workshop | {{ total }} |
| Notes | 20 |
| Materials | 50 |
</table>

<chart title="Costs">
| Category | Amount |
| --- | ---: |
| Workshop | {{ total }} |
| Notes | 20 |
</chart>

<diagram bind="step" initial="input" label="Core flow">
<node id="input" label="Input">Change parameters.</node>
<node id="compute" label="Compute">Read the result.</node>
<edge from="input" to="compute">
</diagram>

Selected step: {{ step }}.

\`\`\`markdown
<slider bind="literal" initial="2">
Literal: {{ seats }}
\`\`\`
`;

async function runCase(browser, engine, width, result, baseURL) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  const testCase = { width, checks: [], errors, externalRequests: external, status: 'running' };
  result.cases.push(testCase);
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL).origin) external.push(request.url());
  });
  const editor = page.locator('#source-editor');
  const stage = page.locator('.preview-stage');
  const documentSelect = page.locator('.doc-select');
  const edit = async text => {
    await page.locator('[data-editor-view-option="edit"]').click();
    await replaceWorkbenchSource(page, text);
    await expect(page.locator('.status-chip')).toContainText('Compiled');
  };
  const showPreview = () => page.locator('[data-editor-view-option="preview"]').click();
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const check = async (name, action) => {
    await action();
    testCase.checks.push(name);
    console.log(`PASS ${engine} ${width}px: ${name}`);
  };

  try {
    await page.goto(textareaWorkbenchURL(baseURL));
    await check('example navigation and reactive controls', async () => {
      await expect(page.locator('#example-select option')).toHaveCount(8);
      const people = stage.getByRole('slider', { name: 'People', exact: true });
      await expect(people).toHaveValue('2');
      await people.focus();
      await people.press('End');
      await expect(stage).toContainText('2000 USD');
      await stage.getByRole('checkbox', { name: 'Annual billing', exact: true }).check();
      await expect(stage).toContainText('1600 USD');
      await page.locator('#example-select').selectOption('forms');
      await expect(stage.getByRole('textbox', { name: 'Organizer', exact: true })).toBeVisible();
      await fits();
    });

    await check('create, name and edit a personal document', async () => {
      await page.getByRole('button', { name: 'My documents', exact: true }).click();
      await clickWorkbenchAction(page, 'New document');
      await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Core workflow');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(documentSelect.locator('option:checked')).toHaveText('Core workflow');
      await edit(source);
      await expect(page.locator('.doc-save-state')).toHaveText('Saved');
      await showPreview();
      await expect(stage).toContainText('Total: 200 USD. Guest: Reader. Date: 2026-11-01.');
    });

    await check('calculations, conditions, date input, tables, charts and diagrams', async () => {
      const seats = stage.getByRole('slider', { name: 'Seats', exact: true });
      await seats.focus();
      await seats.press('End');
      await stage.getByRole('checkbox', { name: 'Annual', exact: true }).check();
      await stage.getByRole('textbox', { name: 'Guest', exact: true }).fill('Ada');
      await stage.getByLabel('Meeting date', { exact: true }).fill('2026-11-03');
      await expect(stage).toContainText('Total: 640 USD. Guest: Ada. Date: 2026-11-03.');
      await expect(stage.getByText('Group booking enabled.', { exact: true })).toBeVisible();
      const table = stage.getByRole('table', { name: 'Price list', exact: true });
      await expect(table).toContainText('640');
      await table.getByRole('button', { name: /^Price/ }).click();
      await expect(table.locator('tbody tr').first()).toContainText('Notes');
      await expect(stage.locator('.local-visual-chart svg')).toBeVisible();
      await stage.getByRole('button', { name: 'Compute', exact: true }).click();
      await expect(stage).toContainText('Selected step: compute.');
      await expect(stage.locator('.md-code-block code')).toContainText('Literal: {{ seats }}');
      await fits();
    });

    await check('diagnostics recover after editing invalid source', async () => {
      await page.locator('[data-editor-view-option="edit"]').click();
      await replaceWorkbenchSource(page, `${source}\n{{ missing + }}`);
      await expect(page.locator('.status-chip')).toContainText('Compile failed');
      await expect(page.locator('.diagnostics-panel .diagnostic-item').first()).toBeVisible();
      await edit(source);
      await showPreview();
      await expect(stage.getByRole('heading', { name: 'Browser core', exact: true })).toBeVisible();
    });

    let originalId;
    let copyId;
    await check('autosave, reload, rename, independent duplicate and language switch', async () => {
      originalId = await documentSelect.inputValue();
      await expect(page.locator('.doc-save-state')).toHaveText('Saved');
      await page.reload();
      await expect(documentSelect).toHaveValue(originalId);
      await expect(editor).toHaveValue(source);
      await clickWorkbenchAction(page, 'Rename');
      const form = page.getByRole('form', { name: 'Rename document', exact: true });
      await form.getByRole('textbox', { name: 'Document name', exact: true }).fill('Core saved');
      await form.getByRole('button', { name: 'Rename', exact: true }).click();
      await clickWorkbenchAction(page, 'Duplicate');
      await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Core copy');
      await page.getByRole('button', { name: 'Create copy', exact: true }).click();
      copyId = await documentSelect.inputValue();
      expect(copyId).not.toBe(originalId);
      await edit(`${source}\nCopy only.`);
      await documentSelect.selectOption(originalId);
      await expect(editor).toHaveValue(source);
      await documentSelect.selectOption(copyId);
      await expect(editor).toHaveValue(`${source}\nCopy only.`);
      await page.getByTestId('language-toggle').click();
      await expect(editor).toHaveValue(`${source}\nCopy only.`);
      await expect(documentSelect.locator('option:checked')).toHaveText('Core copy');
      await page.getByTestId('language-toggle').click();
      await edit(source);
    });

    await check('Markdown and interactive HTML downloads reopen with working controls', async () => {
      // Linux WebKit sanitizes spaces in the suggested download name. The
      // document name, extension and downloaded content must still match.
      const downloadName = engine === 'webkit' && process.platform === 'linux' ? 'Core_copy' : 'Core copy';
      await clickWorkbenchAction(page, 'Export');
      const markdownReady = page.waitForEvent('download');
      await page.getByRole('dialog').getByRole('button', { name: 'Download Markdown', exact: true }).click();
      const markdown = await markdownReady;
      expect(markdown.suggestedFilename()).toBe(`${downloadName}.reactive.md`);
      expect(await readFile(await markdown.path(), 'utf8')).toBe(source);
      await clickWorkbenchAction(page, 'Export');
      const htmlReady = page.waitForEvent('download');
      await page.getByRole('dialog').getByRole('button', { name: 'Export HTML', exact: true }).click();
      const html = await htmlReady;
      expect(html.suggestedFilename()).toBe(`${downloadName}.html`);
      const output = join(artifactRoot, engine, `${width}-interactive.html`);
      await html.saveAs(output);
      const exported = await context.newPage();
      exported.on('pageerror', error => errors.push(`export: ${error.message}`));
      const exportRequests = [];
      await exported.route(/^https?:/, route => { exportRequests.push(route.request().url()); return route.abort(); });
      try {
        await exported.goto(pathToFileURL(output).href);
        await expect(exported.getByRole('heading', { name: 'Browser core', exact: true })).toBeVisible();
        await expect(exported.locator('body')).toContainText('Total: 200 USD.');
        await exported.getByRole('checkbox', { name: 'Annual', exact: true }).check();
        await expect(exported.locator('body')).toContainText('Total: 160 USD.');
        expect(exportRequests).toEqual([]);
      } finally { await exported.close(); }
    });

    await check('guide literals, white/light and dark code cards, keyboard menus and narrow layout', async () => {
      await page.getByTestId('language-toggle').click();
      await page.getByRole('button', { name: '使用指南', exact: true }).click();
      const code = page.locator('.guide-paper .md-code-block').nth(1);
      await expect(code.locator('code')).toContainText('{{');
      await expect(code).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await page.getByRole('button', { name: '深色主题', exact: true }).click();
      await expect(code).toHaveCSS('background-color', 'rgb(11, 18, 32)');
      await page.getByRole('button', { name: '浅色主题', exact: true }).click();
      await page.getByRole('button', { name: 'Playground', exact: true }).click();
      const tools = page.locator('.workbench-options');
      await tools.locator(':scope > summary').focus();
      await tools.locator(':scope > summary').press('Enter');
      await expect(tools).toHaveAttribute('open', '');
      await expect(tools.getByRole('button', { name: '导入', exact: true })).toBeVisible();
      await fits();
      await page.screenshot({ path: join(artifactRoot, engine, `${width}.png`) });
    });
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    testCase.status = 'passed';
  } catch (error) {
    testCase.status = 'failed';
    testCase.failure = error.stack ?? String(error);
    await page.screenshot({ path: join(artifactRoot, engine, `${width}-failed.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  let baseURL = process.env.DEMO_URL;
  if (!baseURL) {
    if (!existsSync(join(root, 'demo/dist/index.html'))) throw new Error('Build the demo first: npm run build:demo');
    server = await preview({ root: join(root, 'demo'), configFile: join(root, 'demo/vite.config.ts'), logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
    baseURL = server.resolvedUrls.local[0];
  }
  for (const engine of engines) {
    const result = { engine, status: 'running', cases: [] };
    report.browsers.push(result);
    let browser;
    await mkdir(join(artifactRoot, engine), { recursive: true });
    try {
      const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
      browser = await browserTypes[engine].launch({ headless: true, ...(engine === 'chromium' && channel !== 'chromium' ? { channel } : {}) });
      result.version = browser.version();
      for (const width of [1280, 375]) await runCase(browser, engine, width, result, baseURL);
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed';
      result.failure = error.stack ?? String(error);
      console.error(`FAIL ${engine}: ${result.failure}`);
    } finally {
      await browser?.close();
      await writeFile(join(artifactRoot, engine, 'report.json'), JSON.stringify(result, null, 2));
    }
  }
  report.status = report.browsers.every(result => result.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack ?? String(error);
  console.error(report.failure);
} finally {
  await server?.close();
  report.finishedAt = new Date().toISOString();
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(artifactRoot, 'report.json'), JSON.stringify(report, null, 2));
}
if (report.status !== 'passed') process.exitCode = 1;
