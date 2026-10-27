import {expect} from '@playwright/test';

/** Actions kept behind More options in the compact workbench. */
export async function clickWorkbenchAction(page, name) {
  const options = page.locator('.workbench-options');
  const button = options.getByRole('button', {name, exact: typeof name === 'string'});
  if (!await button.isVisible()) {
    if (!await options.evaluate(element => element.open)) await options.locator(':scope > summary').click();
  }
  await button.click();
}
/** Replace source through native input after the editor's layout settles. */
export async function replaceWorkbenchSource(page, text) {
  const editor = page.locator('#source-editor');
  await editor.click();
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
  await expect(editor).toHaveValue(text);
  await expect.poll(() => page.locator('.author-highlight-content').textContent()).toBe(text);
}
