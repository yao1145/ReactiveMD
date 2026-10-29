import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { installEditorProbe } from './editor-probe.mjs';

const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts/source-navigation', { recursive: true });

// Public ranges address the raw document source. CodeMirror stores its document
// with LF endings, so tests must convert an expected raw offset to the CM view
// position exactly as SourceCoordinates does.
const pricingSource = readFileSync(new URL('../../examples/local/pricing.reactive.md', import.meta.url), 'utf8');
function toViewOffset(raw, offset) {
  let view = Math.max(0, Math.min(raw.length, offset));
  for (let index = 0; index < offset; index += 1) {
    if (raw[index] !== '\r') continue;
    view -= 1;
    if (raw[index + 1] === '\n') index += 1;
  }
  return view;
}
function rawSlice(raw, range) {
  return raw.slice(range.start, range.end).replace(/\r\n?/g, '\n');
}

async function selection(page) {
  await installEditorProbe(page);
  return page.evaluate(() => {
    const editor = document.querySelector('#source-editor');
    if (!editor) return {start: -1, end: -1, value: '', focused: false};
    const snapshot = window.rmdEditorProbe.snapshot(editor);
    return {start: snapshot.start, end: snapshot.end, value: snapshot.value.slice(snapshot.start, snapshot.end), focused: editor === document.activeElement || editor.contains(document.activeElement)};
  });
}

try {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Force a clean, known example so the raw-line-ending mapping is deterministic.
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await page.goto(`${baseURL}/?example=pricing`);
    const preview = page.locator('.pane-preview');
    await expect(preview).toBeVisible();

    const interpolation = preview.locator('.local-interpolation').first();
    await expect(interpolation).toBeVisible();
    const sourceRange = await interpolation.evaluate((node) => ({
      start: Number(node.dataset.rmdSourceStart),
      end: Number(node.dataset.rmdSourceEnd),
      type: node.dataset.rmdSourceType,
    }));
    expect(sourceRange.type).toBe('interpolation');
    await interpolation.click();

    // Preview-only layouts switch to a view where the editor is visible.
    await expect(page.locator('#source-editor')).toBeVisible();
    const expectedStart = toViewOffset(pricingSource, sourceRange.start);
    const expectedEnd = toViewOffset(pricingSource, sourceRange.end);
    await expect.poll(async () => (await selection(page)).start).toBe(expectedStart);
    const afterText = await selection(page);
    expect(afterText.end).toBe(expectedEnd);
    expect(afterText.value).toBe(rawSlice(pricingSource, sourceRange));
    expect(afterText.focused).toBe(true);

    // Clicking a control label targets the component tag, not its input.
    if (width === 1440) {
      const label = preview.locator('.local-slider label').first();
    const labelRange = await label.evaluate((node) => {
      const target = node.closest('[data-rmd-source-start]');
      return {
        start: Number(target?.dataset.rmdSourceStart),
        end: Number(target?.dataset.rmdSourceEnd),
      };
    });
    await label.click();
    await expect.poll(async () => (await selection(page)).start).toBe(toViewOffset(pricingSource, labelRange.start));
    const labelSelection = await selection(page);
    expect(labelSelection.value).toBe(rawSlice(pricingSource, labelRange));
    expect(labelSelection.value).toContain('<slider');
    expect(labelSelection.value).toContain('bind="seats"');

    // Dragging/filling the slider changes only the parameter.
    const before = await selection(page);
    await preview.locator('input[type="range"]').first().fill('7');
    await page.waitForTimeout(50);
    const after = await selection(page);
    expect(after.start).toBe(before.start);
    expect(after.end).toBe(before.end);
    await expect(preview.locator('.md-slider-value')).toHaveText('7');
    }

    expect(errors).toEqual([]);
    await page.screenshot({ path: `artifacts/source-navigation/${width}.png`, fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('source navigation browser check passed');
