import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts/source-navigation', { recursive: true });

async function selection(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('#source-editor');
    return {
      start: editor?.selectionStart ?? -1,
      end: editor?.selectionEnd ?? -1,
      value: editor?.value.slice(editor.selectionStart, editor.selectionEnd) ?? '',
      focused: document.activeElement === editor,
    };
  });
}

try {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseURL);
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
    await expect.poll(async () => (await selection(page)).start).toBe(sourceRange.start);
    const afterText = await selection(page);
    expect(afterText.end).toBe(sourceRange.end);
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
    await expect.poll(async () => (await selection(page)).start).toBe(labelRange.start);
    const labelSelection = await selection(page);
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
