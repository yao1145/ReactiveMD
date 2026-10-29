import { textareaWorkbenchURL, clickWorkbenchAction } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const source = Array.from({ length: 150 }, (_, i) => `Paragraph ${i}: editor scroll regression.`).join('\n\n');

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(textareaWorkbenchURL(baseURL));
    await clickWorkbenchAction(page, 'Show source');
    const editor = page.locator('#source-editor');
    const position = () => editor.evaluate((element) => ({
      page: window.scrollY,
      editor: element.scrollTop,
      gutter: document.querySelector('.editor-gutter').scrollTop,
      highlight: -new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.author-highlight-content')).transform).m42,
    }));
    const stable = async (before, label) => {
      await expect(editor).toBeFocused();
      // Sample across frames: a later selection/compilation effect must not
      // undo a correct initial restoration.
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(50);
        const after = await position();
        expect(Math.abs(after.page - before.page), `${width}px ${label}: page scroll`).toBeLessThan(2);
        expect(Math.abs(after.editor - before.editor), `${width}px ${label}: editor scroll`).toBeLessThan(2);
        expect(Math.abs(after.gutter - after.editor), `${width}px ${label}: gutter sync`).toBeLessThan(2);
        expect(Math.abs(after.highlight - after.editor), `${width}px ${label}: highlight sync`).toBeLessThan(2);
      }
    };
    const prepare = async (selected = false) => {
      await editor.fill(source);
      await expect(page.locator('.author-highlight-content')).toHaveText(source);
      await editor.evaluate((element, selected) => {
        element.focus();
        element.setSelectionRange(150, selected ? 156 : 150);
        element.scrollTop = 100;
        document.querySelector('.editor-toolbar').scrollIntoView({ block: 'start' });
        window.scrollBy(0, -160);
      }, selected);
      await page.waitForTimeout(100);
      return position();
    };
    for (const item of ['Image', 'Table', 'Code block']) {
      const before = await prepare();
      await page.locator('[data-toolbar-id="insert"]').click();
      const menuItem = page.locator('.editor-toolbar-insert-menu').getByRole('menuitem', { name: item, exact: true });
      await expect(menuItem).toBeVisible();
      // Click the visible item as a user does. Locator.click() scrolls the
      // popover's ancestors first, which would change the page in the test.
      await page.waitForTimeout(200);
      const box = await menuItem.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThan(900);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(editor).not.toHaveValue(source);
      await stable(before, item);
      // The collapsed caret or placeholder selection belongs to the insertion,
      // rather than the temporary end-of-document caret.
      const selection = await editor.evaluate((element) => ({ start: element.selectionStart, end: element.selectionEnd }));
      expect(selection.start).toBeLessThan(500);
      expect(selection.end).toBeLessThan(500);
      await editor.press('Control+z');
      await expect(editor).toHaveValue(source);
      await stable(before, `${item} undo`);
      await editor.press('Control+Shift+z');
      await expect(editor).not.toHaveValue(source);
      await stable(before, `${item} redo`);
    }
    for (const name of ['Bold', 'Italic']) {
      const before = await prepare(true);
      await page.getByRole('button', { name, exact: true }).click();
      await expect(editor).not.toHaveValue(source);
      await stable(before, name);
    }
    const beforeTab = await prepare();
    await editor.press('Tab');
    await expect(editor).toHaveValue(`${source.slice(0, 150)}  ${source.slice(150)}`);
    await stable(beforeTab, 'Tab');
    expect(errors).toEqual([]);
    await page.close();
    console.log(`PASS ${width}px insertion, selection, undo/redo, formatting and Tab preserve page/editor scroll`);
  }
} finally {
  await browser.close();
}
