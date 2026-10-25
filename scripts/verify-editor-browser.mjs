import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// The fixture imports the published entry (`reactive-md/editor` and its CSS),
// not src/. It is served by a throwaway Vite server so the script needs no
// running dev server and never reuses another task's port.
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { exclude: ['reactive-md'] },
});

let browser;
const checks = [];

const SOURCE_A = [
  '# Editor A',
  '',
  '<slider bind="amount" label="Amount" min="0" max="10" />',
  '',
  'Value: {{ amount }}',
  '',
  'Plain paragraph for selection.',
].join('\n');
const SOURCE_B = ['# Editor B', '', 'Second instance stays independent.', '', '- list item'].join('\n');

try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const check = async (name, run) => {
    await run();
    checks.push(name);
    console.log(`PASS ${name}`);
  };

  const root = (id) => page.locator('.reactive-md-editor').filter({ has: page.locator(`#editor-${id}`) });
  const input = (id) => page.locator(`#editor-${id}`);
  const toolbar = (id) => root(id).locator('.editor-toolbar');
  const authoring = (id) => root(id).locator('.source-authoring');
  const setValue = async (id, value) => {
    await page.evaluate(([target, next]) => window.editorHarness.setValue(target, next), [id, value]);
    await expect(input(id)).toHaveValue(value);
  };
  const setCaret = async (id, start, end = start) => {
    await page.evaluate(([target, a, b]) => window.editorHarness.focusRange(target, a, b), [id, start, end]);
  };
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  await page.goto(`${server.resolvedUrls.local[0]}tests/browser/editor-fixture.html`);
  await expect(input('a')).toHaveValue(SOURCE_A);
  await expect(input('b')).toHaveValue(SOURCE_B);

  await check('package entry renders two controlled editors with unique ids and toolbar state', async () => {
    await expect(root('a')).toHaveCount(1);
    await expect(root('b')).toHaveCount(1);
    await expect(root('a')).toHaveAttribute('data-editor-theme', 'light');
    await expect(root('b')).toHaveAttribute('data-editor-theme', 'light');
    await expect(page.locator('.editor-frame')).toHaveCount(2);
    await expect(page.locator('.editor-toolbar')).toHaveCount(2);
    await expect(page.locator('.editor-gutter')).toHaveCount(2);
    await expect(page.locator('.author-highlight-content')).toHaveCount(2);
    await expect(authoring('a')).toBeVisible();
    await expect(authoring('b')).toBeVisible();

    const ids = await page.evaluate(() => {
      const controls = (scope) =>
        Array.from(scope.querySelectorAll('[aria-controls]'))
          .map((element) => element.getAttribute('aria-controls'))
          .filter(Boolean);
      const roots = Array.from(document.querySelectorAll('.reactive-md-editor'));
      return {
        a: controls(roots[0]),
        b: controls(roots[1]),
        textareas: Array.from(document.querySelectorAll('textarea')).map((element) => element.id),
      };
    });
    assert.deepEqual(ids.textareas.filter(Boolean).sort(), ['editor-a', 'editor-b']);
    assert.ok(ids.a.length > 0 && ids.b.length > 0, 'toolbar controls must reference menus');
    const shared = ids.a.filter((id) => ids.b.includes(id));
    assert.deepEqual(shared, [], `two instances share generated ids: ${shared.join(', ')}`);
    await expect(toolbar('a').getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    await expect(toolbar('b').getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
  });

  await check('real typing is controlled and undo/redo stay in one instance', async () => {
    const a = input('a');
    await a.click();
    await a.press('Control+End');
    await page.keyboard.type(' Typed.');
    await expect(a).toHaveValue(`${SOURCE_A} Typed.`);
    await expect(toolbar('a').locator('[data-toolbar-id="undo"]')).toBeEnabled();
    await expect(toolbar('b').locator('[data-toolbar-id="undo"]')).toBeDisabled();
    await expect(input('b')).toHaveValue(SOURCE_B);

    await toolbar('a').locator('[data-toolbar-id="undo"]').click();
    await expect(a).toHaveValue(SOURCE_A);
    await toolbar('a').locator('[data-toolbar-id="redo"]').click();
    await expect(a).toHaveValue(`${SOURCE_A} Typed.`);
    await setValue('a', SOURCE_A);
  });

  await check('selection API and toolbar formatting round-trip through undo and redo', async () => {
    const a = input('a');
    const start = SOURCE_A.indexOf('Plain');
    await page.evaluate(([from, to]) => window.editorHarness.focusRange('a', from, to), [start, start + 'Plain'.length]);
    await expect.poll(() => page.evaluate(() => window.editorHarness.getSelection('a'))).toEqual({
      start,
      end: start + 'Plain'.length,
    });
    const focused = await a.evaluate((element) => document.activeElement === element);
    assert.ok(focused, 'focus(selection) should focus the textarea');

    await page.evaluate(([from, to]) => window.editorHarness.selectRange('a', from, to), [start, start + 'Plain'.length]);
    await expect.poll(() => page.evaluate(() => window.editorHarness.getSelection('a'))).toEqual({
      start,
      end: start + 'Plain'.length,
    });

    await toolbar('a').getByRole('button', { name: 'Bold', exact: true }).click();
    await expect.poll(() => a.inputValue()).toContain('**Plain**');
    await page.keyboard.press('Control+z');
    await expect(a).toHaveValue(SOURCE_A);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => a.inputValue()).toContain('**Plain**');
    await setValue('a', SOURCE_A);
  });

  await check('Tab indents selected lines without deleting their contents', async () => {
    const value = 'first line\nsecond line';
    await setValue('a', value);
    await setCaret('a', 0, value.length);
    await input('a').press('Tab');
    await expect(input('a')).toHaveValue('  first line\n  second line');
    await input('a').press('Control+z');
    await expect(input('a')).toHaveValue(value);
    await setValue('a', SOURCE_A);
  });

  await check('external value replacement syncs text, highlight and host callback count', async () => {
    const before = await page.evaluate(() => window.editorHarness.changes('a'));
    const replacement = '# Replaced\n\nExternal text with <b>tag</b>.';
    await page.evaluate((value) => window.editorHarness.setValue('a', value), replacement);
    await expect(input('a')).toHaveValue(replacement);
    await expect(root('a').locator('.author-highlight-content')).toContainText('External text');
    const after = await page.evaluate(() => window.editorHarness.changes('a'));
    assert.equal(after, before, 'host-driven value updates must not call onChange');
    await expect(input('b')).toHaveValue(SOURCE_B);
    await setValue('a', SOURCE_A);
  });

  await check('documentKey selection resets history without touching the current text', async () => {
    const a = input('a');
    await a.click();
    await a.press('Control+End');
    await page.keyboard.type('!');
    await expect(a).toHaveValue(`${SOURCE_A}!`);
    await expect(toolbar('a').locator('[data-toolbar-id="undo"]')).toBeEnabled();

    await page.evaluate(() => window.editorHarness.setDocumentKey('document-a-second'));
    await page.waitForTimeout(100);
    await expect(a).toHaveValue(`${SOURCE_A}!`);
    await page.evaluate(() => window.editorHarness.undo('a'));
    await expect(a).toHaveValue(`${SOURCE_A}!`);
    await expect(toolbar('a').locator('[data-toolbar-id="undo"]')).toBeDisabled();

    await setValue('a', SOURCE_A);
    await page.evaluate(() => window.editorHarness.setDocumentKey('document-a'));
  });

  await check('completion opens, ignores an Enter during IME composition and applies normally', async () => {
    await setValue('a', 'Text\n\n<');
    await setCaret('a', 7);
    await page.keyboard.press('Control+Space');
    const list = authoring('a').getByRole('listbox', { name: 'Source suggestions', exact: true });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option').first()).toBeVisible();

    await input('a').evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    });
    await expect(root('a').locator('.editor-shell')).toHaveClass(/is-composing/);
    const composing = await input('a').evaluate((element) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      });
      element.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        value: element.value,
      };
    });
    assert.equal(composing.value, 'Text\n\n<', 'IME composition must not submit a suggestion');
    assert.equal(composing.prevented, false, 'IME Enter must keep its default behaviour');

    await input('a').evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    await expect(root('a').locator('.editor-shell')).not.toHaveClass(/is-composing/);
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);

    await setCaret('a', 7);
    await page.keyboard.press('Control+Space');
    await expect(list).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(list).toHaveCount(0);
    await expect.poll(() => input('a').inputValue()).not.toBe('Text\n\n<');
    await page.keyboard.press('Control+z');
    await expect(input('a')).toHaveValue('Text\n\n<');
    await setValue('a', SOURCE_A);
  });

  await check('authoring format and rename act on the source as single undo steps', async () => {
    const uneven = 'Text\n\n<slider bind="amount" label="Amount"   min="0"    max="10" />\n\nValue: {{ amount }}';
    await setValue('a', uneven);
    await authoring('a').locator('[data-authoring-action="format"]').click();
    await expect.poll(() => input('a').inputValue()).not.toBe(uneven);
    await input('a').press('Control+z');
    await expect(input('a')).toHaveValue(uneven);

    await authoring('a').locator('[data-binding-name="amount"]').click();
    const rename = authoring('a').locator('[data-authoring-action="rename-input"]');
    await rename.fill('total');
    await authoring('a').locator('[data-authoring-action="rename"]').click();
    await expect.poll(() => input('a').inputValue()).toContain('bind="total"');
    await expect.poll(() => input('a').inputValue()).toContain('{{ total }}');
    await input('a').press('Control+z');
    await expect(input('a')).toHaveValue(uneven);
    await setValue('a', SOURCE_A);
  });

  await check('readOnly and disabled block typing, commands and ref undo', async () => {
    const a = input('a');
    await page.evaluate(() => window.editorHarness.setReadOnly(true, 'a'));
    await expect(a).toHaveAttribute('readonly');
    const before = await a.inputValue();
    await a.focus();
    await page.keyboard.type('X');
    await page.evaluate(() => window.editorHarness.undo('a'));
    await toolbar('a').locator('[data-toolbar-id="bold"]').evaluate((button) => button.disabled || button.click());
    await expect(a).toHaveValue(before);

    await page.evaluate(() => window.editorHarness.setReadOnly(false, 'a'));
    await expect(a).not.toHaveAttribute('readonly');
    await page.evaluate(() => window.editorHarness.setDisabled(true, 'a'));
    await expect(a).toBeDisabled();
    await page.evaluate(() => window.editorHarness.undo('a'));
    await expect(a).toHaveValue(before);

    await page.evaluate(() => window.editorHarness.setDisabled(false, 'a'));
    await expect(a).toBeEnabled();
    await setValue('a', SOURCE_A);
  });

  await check('long source keeps line numbers and highlight scrolling in sync', async () => {
    const long = Array.from({ length: 120 }, (_, index) => `Line ${index + 1} of the long source`).join('\n');
    await setValue('a', long);
    await expect(root('a').locator('.gutter-line')).toHaveCount(120);
    await expect(root('a').locator('.author-highlight-content')).toHaveText(long);

    await input('a').evaluate((element) => { element.scrollTop = 420; });
    await expect.poll(() => input('a').evaluate((element) => {
      const rootElement = element.closest('.reactive-md-editor');
      const content = rootElement.querySelector('.author-highlight-content');
      const gutter = rootElement.querySelector('.editor-gutter');
      const matrix = new DOMMatrixReadOnly(getComputedStyle(content).transform);
      return {
        editor: Math.round(element.scrollTop),
        highlight: Math.round(-matrix.m42),
        gutter: Math.round(gutter.scrollTop),
      };
    })).toEqual({ editor: 420, highlight: 420, gutter: 420 });
    await page.evaluate(() => window.editorHarness.setDocumentKey('scroll-reset-a'));
    await expect.poll(() => input('a').evaluate((element) => element.scrollTop)).toBe(0);
    await expect.poll(() => root('a').locator('.editor-gutter').evaluate((element) => element.scrollTop)).toBe(0);
    await setValue('a', SOURCE_A);
  });

  await check('theme and locale stay per instance and the host page is untouched', async () => {
    const lightA = await root('a').evaluate((element) => getComputedStyle(element).color);
    const lightB = await root('b').evaluate((element) => getComputedStyle(element).color);
    await page.evaluate(() => window.editorHarness.setTheme('dark', 'a'));
    await expect(root('a')).toHaveAttribute('data-editor-theme', 'dark');
    await expect(root('b')).toHaveAttribute('data-editor-theme', 'light');
    const darkA = await root('a').evaluate((element) => getComputedStyle(element).color);
    const darkB = await root('b').evaluate((element) => getComputedStyle(element).color);
    assert.notEqual(darkA, lightA, 'dark theme should change the editor foreground');
    assert.equal(darkB, lightB, 'the other instance must keep its own theme');

    await page.evaluate(() => window.editorHarness.setLocale('zh', 'a'));
    await expect(root('a').getByRole('region', { name: '源码作者工具', exact: true })).toBeVisible();
    await expect(root('a').getByRole('button', { name: '补全', exact: true })).toBeVisible();
    await expect(root('b').getByRole('region', { name: 'Source authoring tools', exact: true })).toBeVisible();

    await expect(page.locator('#host-sentinel')).toHaveCSS('color', 'rgb(1, 2, 3)');
    await expect(page.locator('#host-button')).toHaveCSS('background-color', 'rgb(9, 9, 9)');
    await expect(page.locator('#host-button')).toHaveCSS('border-radius', '2px');
    await page.locator('#host-button').hover();
    await expect(page.locator('#host-button')).toHaveCSS('background-color', 'rgb(9, 9, 9)');

    await page.evaluate(() => window.editorHarness.setLocale('en', 'a'));
    await page.evaluate(() => window.editorHarness.setTheme('light', 'a'));
  });

  await check('toolbar export calls the host callback instead of downloading', async () => {
    const before = await page.evaluate(() => window.editorHarness.exports());
    await toolbar('a').locator('[data-toolbar-id="download"]').click();
    await expect.poll(() => page.evaluate(() => window.editorHarness.exports())).toBe(before + 1);
  });

  await check('desktop and 375px layouts avoid horizontal overflow and page errors', async () => {
    await mkdir('artifacts/editor', { recursive: true });
    assert.ok(await noOverflow(), 'desktop page overflows horizontally');
    await root('a').screenshot({ path: 'artifacts/editor/editor-desktop-light.png' });

    await page.evaluate(() => window.editorHarness.setTheme('dark', 'both'));
    await root('a').screenshot({ path: 'artifacts/editor/editor-desktop-dark.png' });

    await page.setViewportSize({ width: 375, height: 900 });
    await expect(input('a')).toBeVisible();
    await expect(input('b')).toBeVisible();
    assert.ok(await noOverflow(), '375px page overflows horizontally');
    const widths = await page.locator('.reactive-md-editor').evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
    assert.ok(widths.every((width) => width <= 376), `editor wider than the viewport: ${widths}`);
    const heights = await page.locator('.editor-toolbar').evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
    assert.ok(heights.every((height) => height > 0), `toolbar collapsed: ${heights}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await root('a').screenshot({ path: 'artifacts/editor/editor-375-dark.png' });
    await page.evaluate(() => window.editorHarness.setTheme('light', 'both'));
    await root('a').screenshot({ path: 'artifacts/editor/editor-375-light.png' });
    assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`);
  });

  console.log(`PASS ${checks.length} editor browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
