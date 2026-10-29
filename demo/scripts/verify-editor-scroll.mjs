import { openWorkbench, clickWorkbenchAction, fillEditor, expectEditorSource } from './workbench-ui.mjs';
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
    await openWorkbench(page,baseURL);
    await clickWorkbenchAction(page, 'Show source');
    const editor = page.locator('#source-editor');
    const position = () => editor.evaluate((element) => ({
      page: window.scrollY,
      editor: window.rmdEditorProbe.scrollElement(element).scrollTop,
    }));
    const stable = async (before, label, preserveEditor = true) => {
      await expect(editor).toBeFocused();
      // Sample across frames: a later selection/compilation effect must not
      // undo a correct initial restoration.
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(50);
        const after = await position();
        expect(Math.abs(after.page - before.page), `${width}px ${label}: page scroll`).toBeLessThan(2);
        if (preserveEditor) expect(Math.abs(after.editor - before.editor), `${width}px ${label}: editor scroll`).toBeLessThan(2);
      }
      if (!preserveEditor) {
        // Native CM history reveals its restored selection. An offscreen caret
        // may legitimately move the editor scroller without moving the page.
        const visible = await editor.evaluate(element => {
          const view = window.rmdEditorProbe.view(element);
          const caret = view.coordsAtPos(view.state.selection.main.head);
          const bounds = view.scrollDOM.getBoundingClientRect();
          return caret && caret.top >= bounds.top - 2 && caret.bottom <= bounds.bottom + 2;
        });
        expect(visible, `${width}px ${label}: restored caret is visible`).toBe(true);
      }
    };
    const prepare = async (selected = false) => {
      await fillEditor(editor,source);
      await editor.evaluate((element, selected) => {
        element.focus();
        window.rmdEditorProbe.select(element,150, selected ? 156 : 150);
        window.rmdEditorProbe.scrollElement(element).scrollTop = 100;
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
      await expectEditorSource(editor,source,true);
      await stable(before, item);
      // The collapsed caret or placeholder selection belongs to the insertion,
      // rather than the temporary end-of-document caret.
      const selection = await editor.evaluate((element) => ({ start: window.rmdEditorProbe.selection(element).start, end: window.rmdEditorProbe.selection(element).end }));
      expect(selection.start).toBeLessThan(500);
      expect(selection.end).toBeLessThan(500);
      await editor.press('Control+z');
      await expectEditorSource(editor,source);
      await stable(before, `${item} undo`, false);
      await editor.press('Control+Shift+Z');
      await expectEditorSource(editor,source,true);
      await stable(before, `${item} redo`, false);
    }
    for (const name of ['Bold', 'Italic']) {
      const before = await prepare(true);
      await page.getByRole('button', { name, exact: true }).click();
      await expectEditorSource(editor,source,true);
      await stable(before, name);
    }
    const beforeTab = await prepare();
    await editor.press('Tab');
    const lineStart = source.lastIndexOf('\n', 149) + 1;
    await expectEditorSource(editor,`${source.slice(0, lineStart)}  ${source.slice(lineStart)}`);
    await stable(beforeTab, 'Tab', false);
    expect(errors).toEqual([]);
    await page.close();
    console.log(`PASS ${width}px toolbar preserves scroll; native history and Tab reveal the caret without moving the page`);
  }
} finally {
  await browser.close();
}
