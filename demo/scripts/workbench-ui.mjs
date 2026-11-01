import {expect} from '@playwright/test';
import {installEditorProbe,readEditorSource} from './editor-probe.mjs';

/** Open the workbench with a stable editor fixture, unless the URL selects one. */
export async function openWorkbench(page,value) {
  const url=new URL(value);url.searchParams.delete('editor');
  if (!url.searchParams.has('example')) await page.addInitScript(() => {
    if (!localStorage.getItem('reactive-md:selection')) localStorage.setItem('reactive-md:selection', 'pricing');
  });
  await page.goto(url.href);
  await installEditorProbe(page);
}

/** The old component examples now live under one feature-demo menu entry. */
export async function selectWorkbenchExample(page, id) {
  if (['pricing', 'functions', 'forms', 'statistics', 'layout', 'flow', 'tasks'].includes(id)) {
    const url = new URL(page.url());
    url.searchParams.set('example', id);
    await openWorkbench(page, url.href);
    await page.evaluate(() => {
      const url = new URL(location.href); url.searchParams.delete('example');
      history.replaceState(null, '', url.href);
    });
  } else {
    await page.locator('#example-select').selectOption(id);
  }
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
