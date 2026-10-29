import {expect} from '@playwright/test';
import {installEditorProbe,readEditorSource} from './editor-probe.mjs';

/** Open the real workbench and attach the test-only CM6 adapter. */
export async function openWorkbench(page,value) {
  const url=new URL(value);url.searchParams.delete('editor');
  await page.goto(url.href);
  await installEditorProbe(page);
}

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
  await installEditorProbe(page);
  const editor = page.locator('#source-editor');
  await editor.click();
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+A');
  await page.keyboard.insertText(text.replace(/\r\n?/g,'\n'));
  await expect.poll(()=>readEditorSource(page)).toBe(text.replace(/\r\n?/g,'\n'));
}

export async function readEditor(locator) {
  await installEditorProbe(locator.page());
  return locator.evaluate(element=>window.rmdEditorProbe.read(element));
}
export async function fillEditor(locator,text) {await replaceWorkbenchSource(locator.page(),text);}
export async function expectEditorSource(locator,expected,negated=false) {
  const assertion=expect.poll(()=>readEditor(locator));
  const target=negated?assertion.not:assertion;
  if(expected instanceof RegExp)await target.toMatch(expected);else await target.toBe(expected.replace(/\r\n?/g,'\n'));
}
