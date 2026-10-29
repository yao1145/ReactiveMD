import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { openWorkbench, replaceWorkbenchSource } from './workbench-ui.mjs';
import { selectEditorRange } from './editor-probe.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = process.env.DEMO_URL ? null : await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server?.listen();
const baseURL = process.env.DEMO_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
await mkdir('artifacts/editor-interactions', { recursive: true });
const failures = [];
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(error); console.error(`FAIL ${name}: ${error.message}`); }
}

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.addInitScript(() => localStorage.clear());
    await openWorkbench(page, baseURL);
    const mode = name => page.locator(`[data-editor-view-option="${name}"]`);
    const editor = page.locator('#source-editor');
    await mode('edit').click();

    await check(`${width}px one Enter creates one preview line break`, async () => {
      await replaceWorkbenchSource(page, '11');
      await editor.press('ControlOrMeta+End');
      await editor.press('Enter');
      await page.keyboard.insertText('12');
      await editor.press('Enter');
      await page.keyboard.insertText('13');
      await mode(width === 1440 ? 'split' : 'preview').click();
      const paragraph = page.locator('.pane-preview .md-document p');
      await expect(paragraph).toHaveText('111213');
      await expect(paragraph.locator('br')).toHaveCount(2);
      const lines = await paragraph.locator('span').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      expect(lines[1]).toBeGreaterThan(lines[0]);
      expect(lines[2]).toBeGreaterThan(lines[1]);
    });

    await mode('edit').click();
    await replaceWorkbenchSource(page, '11\n12\n13\n\n21');
    for (const theme of ['light', 'dark']) {
      await check(`${width}px ${theme} selection stays visible on the active line`, async () => {
        if (await page.locator('.reactive-md-editor').getAttribute('data-editor-theme') !== theme) {
          await page.getByRole('button', { name: theme === 'dark' ? 'Dark theme' : 'Light theme', exact: true }).click();
        }
        for (const [start, end] of [[6, 7], [0, 7]]) {
          await selectEditorRange(page, start, end);
          await expect(editor).toBeFocused();
          await expect.poll(() => page.locator('.cm-activeLine').evaluateAll(nodes => nodes.every(node => {
            const color = getComputedStyle(node).backgroundColor;
            return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
          }))).toBe(true);
          await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
        }
        await page.locator('.cm-editor').screenshot({ path: `artifacts/editor-interactions/selection-${width}-${theme}.png` });
        await selectEditorRange(page, 7);
        await expect.poll(() => page.locator('.cm-activeLine').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      });
    }

    if (width === 1440) await check('split preview navigation scrolls only the source pane', async () => {
      const text = Array.from({ length: 400 }, (_, index) => `Paragraph ${index}: navigation target.`).join('\n\n');
      await replaceWorkbenchSource(page, text);
      await mode('split').click();
      const preview = page.locator('.editor-preview');
      await expect(preview.locator('.md-document p')).toHaveCount(400);
      await preview.evaluate(element => { element.scrollTop = element.scrollHeight * 0.7; });
      await page.evaluate(() => {
        const frame = document.querySelector('.editor-frame');
        window.scrollTo(0, window.scrollY + frame.getBoundingClientRect().top + 180);
      });
      // Let content-visibility settle and hit-test visible text. Measuring all
      // paragraphs would force skipped content to lay out and move the anchor.
      await page.waitForTimeout(150);
      const target = await preview.evaluate(element => {
        const bounds = element.getBoundingClientRect(), x = bounds.left + 60;
        for (let y = Math.max(40, bounds.top + 30); y < Math.min(innerHeight - 30, bounds.bottom - 30); y += 15) {
          const node = document.elementFromPoint(x, y)?.closest('p[data-rmd-source-start]');
          if (node && element.contains(node)) return { x, y, start: Number(node.dataset.rmdSourceStart), end: Number(node.dataset.rmdSourceEnd) };
        }
        throw new Error('No visible preview paragraph');
      });
      const before = await page.evaluate(() => ({ page: scrollY, preview: document.querySelector('.editor-preview').scrollTop }));
      await page.mouse.click(target.x, target.y);
      await expect(editor).toBeFocused();
      await expect.poll(() => editor.evaluate(element => window.rmdEditorProbe.selection(element))).toEqual({ start: target.start, end: target.end });
      for (let frame = 0; frame < 6; frame++) {
        await page.waitForTimeout(50);
        const after = await page.evaluate(() => ({ page: scrollY, preview: document.querySelector('.editor-preview').scrollTop }));
        expect(Math.abs(after.page - before.page), 'host page scroll').toBeLessThan(2);
        expect(Math.abs(after.preview - before.preview), 'preview scroll').toBeLessThan(2);
      }
      expect(await editor.evaluate(element => window.rmdEditorProbe.scrollElement(element).scrollTop)).toBeGreaterThan(0);
    });
    await check(`${width}px no page errors`, async () => expect(errors).toEqual([]));
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
if (failures.length) throw new AggregateError(failures, `${failures.length} editor interaction regressions`);
