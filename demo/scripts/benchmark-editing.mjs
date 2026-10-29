import { textareaWorkbenchURL } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { article } from '../../scripts/benchmark-large-documents.mjs';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5184';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(textareaWorkbenchURL(baseURL));
  const editor = page.getByRole('textbox', { name: 'Reactive MD source', exact: true });
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  const sections = Number(process.env.EDITING_SECTIONS ?? 300);
  const source = article(sections) + '\n\nEdit marker: BASE';
  await editor.evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, source);
  await expect(page.locator('.preview-stage')).toContainText('Edit marker: BASE');
  await editor.focus();
  await editor.press('Control+End');
  await page.evaluate(() => {
    window.editingProbe = { inputToFrame: [], longTasks: [] };
    const probe = window.editingProbe;
    document.querySelector('#source-editor').addEventListener('input', () => {
      const start = performance.now();
      requestAnimationFrame(() => probe.inputToFrame.push(performance.now() - start));
    }, { capture: true });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' });
    }
  });
  const started = Date.now();
  await editor.pressSequentially('abcdefghij', { delay: 20 });
  const typingWallMs = Date.now() - started;
  await expect(page.locator('.preview-stage')).toContainText('Edit marker: BASEabcdefghij');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(() => window.editingProbe);
  result.inputToFrame.sort((a, b) => a - b);
  const report = {
    baseURL, generatedAt: new Date().toISOString(), sections, characters: source.length, keystrokes: 10,
    typingWallMs, inputToFrameMedianMs: result.inputToFrame[Math.floor(result.inputToFrame.length / 2)],
    inputToFrameMaxMs: Math.max(...result.inputToFrame), ...result, errors,
    methodology: 'Ten Playwright keystrokes 20ms apart. Capturing input listener measures delay to next requestAnimationFrame (not completed paint). Long tasks include final preview rendering. Observations, not cross-machine thresholds.',
  };
  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await writeFile(process.env.EDITING_REPORT ?? 'artifacts/benchmark-editing.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
