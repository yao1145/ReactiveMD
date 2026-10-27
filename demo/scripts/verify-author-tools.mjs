import { clickWorkbenchAction, replaceWorkbenchSource } from './workbench-ui.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
    errors.push(message.text());
  }
});

const fixture = [
  '# Authoring',
  '',
  '<slider bind="amount" label="Amount" min="0" max="10" step="1" />',
  '',
  'Value: {{ amount }}',
  '',
  '```text',
  'amount stays literal here',
  '```',
  '',
  'Math: $$ y = x^2 $$',
].join('\n');

const selectCaret = async (editor, offset) => {
  await editor.evaluate((element, position) => {
    element.focus();
    element.setSelectionRange(position, position);
    element.dispatchEvent(new Event('select', { bubbles: true }));
  }, offset);
};

const horizontalOverflow = (target) =>
  target.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

try {
  // Regression: the highlight layer renders before its sibling textarea, so its
  // scroll listener must still bind on the first commit. Scrolling before any
  // source edit used to leave the code frozen while the gutter and caret moved.
  const initial = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const initialSource = '# Long draft\n\n' + Array.from(
    { length: 120 },
    (_, index) => `Line ${index + 1} <bind name="v${index}" value="${index}" /> text text text`,
  ).join('\n');
  await initial.addInitScript((source) => {
    localStorage.setItem('reactive-md:language', 'en');
    localStorage.setItem('reactive-md:selection', 'pricing');
    localStorage.setItem('reactive-md:local:source:pricing', source);
  }, initialSource);
  await initial.goto(baseURL);
  await clickWorkbenchAction(initial, 'Show source');
  const initialEditor = initial.locator('#source-editor');
  await expect(initialEditor).toBeVisible();
  await initialEditor.hover();
  await initial.mouse.wheel(0, 500);
  await expect.poll(() => initial.evaluate(() => {
    const textarea = document.querySelector('#source-editor');
    const content = document.querySelector('.author-highlight-content');
    const matrix = new DOMMatrix(getComputedStyle(content).transform);
    return Math.round(textarea.scrollTop) > 0
      && Math.round(textarea.scrollTop) === Math.round(-matrix.m42);
  })).toBe(true);
  await initial.close();
  console.log('PASS highlight follows scrolling before the first edit');

  await page.goto(baseURL);
  await clickWorkbenchAction(page, 'Show source');

  const panel = page.getByRole('region', { name: 'Source authoring tools', exact: true });
  await expect(panel).toBeVisible();
  const editor = page.locator('#source-editor');
  const highlight = page.locator('.author-highlight');

  await replaceWorkbenchSource(page, fixture);
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await expect(page.locator('.author-token-tag').first()).toBeVisible();
  await expect(page.locator('.author-token-attribute').first()).toBeVisible();
  await expect(page.locator('.author-token-binding').first()).toBeVisible();
  console.log('PASS highlight layer renders tag, attribute and binding tokens');

  const colours = await page.evaluate(() => {
    const layer = document.querySelector('.author-highlight');
    const token = document.querySelector('.author-token-tag');
    return {
      layer: layer ? getComputedStyle(layer).color : '',
      token: token ? getComputedStyle(token).color : '',
    };
  });
  if (!colours.layer || !colours.token || colours.layer === colours.token) {
    throw new Error(`Syntax tokens are not coloured: ${JSON.stringify(colours)}`);
  }
  console.log('PASS syntax tokens use their own colour');

  const geometry = await page.evaluate(() => {
    const editorElement = document.querySelector('#source-editor');
    const layer = document.querySelector('.author-highlight');
    if (!editorElement || !layer) return null;
    const a = editorElement.getBoundingClientRect();
    const b = layer.getBoundingClientRect();
    const styles = getComputedStyle(editorElement);
    return {
      dx: Math.abs(a.x - b.x),
      dy: Math.abs(a.y - b.y),
      dw: Math.abs(a.width - b.width),
      dh: Math.abs(a.height - b.height),
      fontSize: styles.fontSize,
      lineHeight: styles.lineHeight,
      layerFontSize: getComputedStyle(layer).fontSize,
      layerLineHeight: getComputedStyle(layer).lineHeight,
    };
  });
  if (
    !geometry
    || geometry.dx > 2
    || geometry.dy > 2
    || geometry.dw > 2
    || geometry.dh > 2
    || geometry.fontSize !== geometry.layerFontSize
    || geometry.lineHeight !== geometry.layerLineHeight
  ) {
    throw new Error(`Highlight layer is not aligned with the textarea: ${JSON.stringify(geometry)}`);
  }
  console.log('PASS highlight geometry and text metrics match the textarea');

  // Long sources exercise real scrolling. The highlight must follow the
  // textarea's native scroll position on its own: no synthetic scroll event,
  // and the overlay moves through a transform rather than its own scrollTop.
  await replaceWorkbenchSource(page,
    Array.from({ length: 80 }, (_, index) => `Line ${index + 1} <bind name="value${index}" value="${index}" />`).join('\n'),
  );
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await editor.evaluate((element) => { element.scrollTop = 400; });
  await expect.poll(() => page.evaluate(() => {
    const textarea = document.querySelector('#source-editor');
    const content = document.querySelector('.author-highlight-content');
    const matrix = new DOMMatrix(getComputedStyle(content).transform);
    return {
      editor: Math.round(textarea.scrollTop),
      highlight: Math.round(-matrix.m42),
    };
  })).toEqual({ editor: 400, highlight: 400 });
  await editor.hover();
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => {
    const textarea = document.querySelector('#source-editor');
    const content = document.querySelector('.author-highlight-content');
    const matrix = new DOMMatrix(getComputedStyle(content).transform);
    return Math.round(textarea.scrollTop) > 400
      && Math.round(textarea.scrollTop) === Math.round(-matrix.m42);
  })).toBe(true);
  console.log('PASS highlight scrolling follows native textarea scrolling');

  await replaceWorkbenchSource(page, fixture);
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await editor.evaluate((element) => { element.scrollTop = 0; });

  await editor.evaluate((element) => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await expect(page.locator('.editor-shell')).toHaveClass(/is-composing/);
  await expect(highlight).toBeHidden();
  await editor.evaluate((element) => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect(highlight).toBeVisible();
  await expect(page.locator('.editor-shell')).not.toHaveClass(/is-composing/);
  console.log('PASS IME composition temporarily reveals the native text');

  const declaration = fixture.indexOf('amount');
  await selectCaret(editor, declaration + 2);
  const caretInfo = panel.locator('[data-binding-caret="amount"]');
  await expect(caretInfo).toBeVisible();
  await expect(caretInfo).toContainText('amount');
  await expect(caretInfo).toContainText('Type: Number');
  await expect(caretInfo).toContainText('1 declaration');
  await expect(caretInfo).toContainText('1 reference');
  console.log('PASS caret binding type, declarations and references');

  const referenceButton = panel.locator('[data-binding-location="reference"]').first();
  await expect(referenceButton).toBeVisible();
  const referenceStart = Number(await referenceButton.getAttribute('data-start'));
  await referenceButton.click();
  await expect.poll(() => editor.evaluate((element) => element.selectionStart)).toBe(referenceStart);
  console.log('PASS reference location moves the caret to the reference');

  const renameInput = panel.locator('[data-authoring-action="rename-input"]');
  await panel.locator('[data-binding-name="amount"]').click();
  await renameInput.fill('total');
  await panel.locator('[data-authoring-action="rename"]').click();
  await expect.poll(() => editor.inputValue()).toContain('<slider bind="total"');
  await expect.poll(() => editor.inputValue()).toContain('Value: {{ total }}');
  await expect.poll(() => editor.inputValue()).toContain('amount stays literal here');
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await editor.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => editor.inputValue()).toBe(fixture);
  console.log('PASS rename updates declarations and references, protects code, and undoes in one step');

  const uneven = 'Text\n\n<slider bind="amount" label="Amount"   min="0"    max="10" />\n\nValue: {{ amount }}';
  await replaceWorkbenchSource(page, uneven);
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await panel.locator('[data-authoring-action="format"]').click();
  const formatted = await editor.inputValue();
  if (formatted === uneven) throw new Error('Format did not tidy a deliberately uneven tag');
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await expect(page.locator('.local-slider, input[type="range"]').first()).toBeVisible();
  await editor.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => editor.inputValue()).toBe(uneven);
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  console.log('PASS format keeps preview alive and undoes in one step');

  await replaceWorkbenchSource(page, 'Text\n\n<');
  await selectCaret(editor, 7);
  await panel.locator('[data-authoring-action="suggest"]').click();
  const list = panel.getByRole('listbox', { name: 'Source suggestions', exact: true });
  await expect(list).toBeVisible();
  await expect(list.getByRole('option').first()).toBeVisible();
  await expect(list.getByRole('option').first().locator('.authoring-kind')).toHaveText('Tag');
  const suggestions = await list.getByRole('option').count();
  if (suggestions === 0) throw new Error('No tag suggestions after an opening angle bracket');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect.poll(() => editor.inputValue()).not.toBe('Text\n\n<');
  await page.keyboard.press('Control+z');
  await expect.poll(() => editor.inputValue()).toBe('Text\n\n<');
  console.log('PASS completion button, arrow keys, Enter and single-step undo');

  await selectCaret(editor, 7);
  await page.keyboard.press('Control+Space');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(editor).toBeFocused();
  console.log('PASS Ctrl+Space opens and Escape closes completion without moving focus');

  await clickWorkbenchAction(page, 'Restore example');
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(highlight).toBeVisible();
  await page.locator('.editor-frame').screenshot({ path: 'artifacts/author-tools-dark.png' });
  await panel.screenshot({ path: 'artifacts/author-tools-panel-dark.png' });
  console.log('PASS dark theme keeps visible highlighting and tools');

  const desktopOverflow = await horizontalOverflow(page);
  if (desktopOverflow) throw new Error('Desktop page overflows horizontally');

  await page.getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
  const chinesePanel = page.getByRole('region', { name: '源码作者工具', exact: true });
  await expect(chinesePanel).toBeVisible();
  await expect(chinesePanel.getByRole('button', { name: '补全', exact: true })).toBeVisible();
  await expect(chinesePanel.getByRole('button', { name: '格式化', exact: true })).toBeVisible();
  await expect(chinesePanel.locator('[data-authoring-action="rename-input"]')).toBeVisible();
  console.log('PASS Chinese authoring copy');

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  mobile.setDefaultTimeout(15000);
  const mobileErrors = [];
  mobile.on('pageerror', (error) => mobileErrors.push(error.message));
  await mobile.goto(baseURL);
  await clickWorkbenchAction(mobile, 'Show source');
  const mobilePanel = mobile.getByRole('region', { name: 'Source authoring tools', exact: true });
  await expect(mobilePanel).toBeVisible();
  await expect(mobile.locator('.author-highlight')).toBeVisible();

  if (await horizontalOverflow(mobile)) throw new Error('375px page overflows horizontally');
  const controls = await mobilePanel.locator('button, input').evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        height: element.getBoundingClientRect().height,
        action: element.getAttribute('data-authoring-action')
          ?? element.getAttribute('data-binding-name')
          ?? element.tagName,
      })),
  );
  const undersized = controls.filter((item) => item.height < 43.5);
  if (undersized.length > 0) {
    throw new Error(`Authoring controls below 44px on mobile: ${JSON.stringify(undersized)}`);
  }

  const mobileEditor = mobile.locator('#source-editor');
  await selectCaret(mobileEditor, 0);
  await mobilePanel.locator('[data-authoring-action="suggest"]').click();
  const mobileList = mobilePanel.getByRole('listbox', { name: 'Source suggestions', exact: true });
  await expect(mobileList).toBeVisible();
  if (await horizontalOverflow(mobile)) throw new Error('Completion overflows the 375px viewport');
  const mobileListBox = await mobileList.boundingBox();
  if (!mobileListBox || mobileListBox.x < 0 || mobileListBox.x + mobileListBox.width > 376) {
    throw new Error(`Completion list is not inside the mobile viewport: ${JSON.stringify(mobileListBox)}`);
  }
  await mobilePanel.screenshot({ path: 'artifacts/author-tools-mobile.png' });
  await mobile.keyboard.press('Escape');
  await expect(mobileList).toHaveCount(0);
  console.log('PASS 375px layout, 44px controls and in-viewport completion');

  if (errors.length || mobileErrors.length) {
    throw new Error(`Page errors: ${JSON.stringify([...errors, ...mobileErrors])}`);
  }
  console.log('ALL CHECKS PASSED');
} finally {
  await browser.close();
}
