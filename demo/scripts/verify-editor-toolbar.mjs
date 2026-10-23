import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
const failedResponses = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
    errors.push(message.text());
  }
});
page.on('response', (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
});

const visibleToolbarIds = (target) =>
  target.locator('[data-toolbar-id]').evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.dataset.toolbarId),
  );

const expectSameIds = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const startDevBold = async (editor) => {
  await editor.fill('# Test\n\nBody');
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(8, 12);
  });
};

try {
  await page.goto(baseURL);
  const toolbar = page.locator('.editor-toolbar');
  await expect(toolbar).toBeVisible();
  const editor = page.locator('#source-editor');
  const boldButton = page.getByRole('button', { name: 'Bold', exact: true });
  const listTrigger = page.locator('[data-toolbar-id="list"]');
  const insertTrigger = page.locator('[data-toolbar-id="insert"]');
  const headingTrigger = page.locator('[data-toolbar-id="heading"]');

  await page.getByRole('button', { name: 'Restore example', exact: true }).click();

  expectSameIds(
    await visibleToolbarIds(toolbar),
    ['heading', 'bold', 'italic', 'list', 'link', 'insert', 'components', 'undo', 'redo', 'download'],
    'Desktop persistent controls',
  );
  console.log('PASS reduced persistent control set');

  const frame = page.locator('.editor-frame');
  await expect(frame).toBeVisible();
  const frameBox = await frame.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  const shellBox = await page.locator('.editor-shell').boundingBox();
  if (
    !frameBox
    || !toolbarBox
    || !shellBox
    || Math.abs(toolbarBox.x - frameBox.x) > 2
    || Math.abs(toolbarBox.width - frameBox.width) > 3
    || Math.abs(toolbarBox.y + toolbarBox.height - shellBox.y) > 1
  ) {
    throw new Error(
      `Toolbar is not flush with the editor frame: ${JSON.stringify({ frameBox, toolbarBox, shellBox })}`,
    );
  }
  console.log('PASS toolbar and source share one frame');

  await startDevBold(editor);
  await boldButton.click();
  await expect.poll(() => editor.inputValue()).toBe('# Test\n\n**Body**');
  const boldSelection = await editor.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    focused: document.activeElement === element,
  }));
  if (boldSelection.start !== 10 || boldSelection.end !== 14 || !boldSelection.focused) {
    throw new Error(`Bold selection was not restored: ${JSON.stringify(boldSelection)}`);
  }
  await expect(boldButton).toHaveAttribute('aria-pressed', 'true');
  const tooltip = await boldButton.getAttribute('data-tooltip');
  if (tooltip !== 'Bold') throw new Error(`Missing tooltip on bold button: ${tooltip}`);
  console.log('PASS bold formatting, selection, focus and pressed state');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => editor.inputValue()).toBe('# Test\n\nBody');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => editor.inputValue()).toBe('# Test\n\n**Body**');
  await editor.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => editor.inputValue()).toBe('# Test\n\nBody');
  await page.keyboard.press('Control+y');
  await expect.poll(() => editor.inputValue()).toBe('# Test\n\n**Body**');
  console.log('PASS undo and redo via buttons and keyboard');

  await insertTrigger.click();
  const insertMenu = page.locator('.editor-toolbar-insert-menu');
  await expect(insertMenu).toBeVisible();
  if (await insertMenu.getByRole('menuitem').count() !== 8) {
    throw new Error('Insert menu does not expose all secondary actions');
  }
  await insertMenu.getByRole('menuitem', { name: 'Emoji', exact: true }).click();
  const emojiMenu = page.locator('.editor-toolbar-emoji-menu');
  await expect(emojiMenu).toBeVisible();
  await expect(emojiMenu.locator('.editor-toolbar-emoji').first()).toBeFocused();
  await emojiMenu.getByRole('menuitem', { name: 'Insert emoji 🚀' }).click();
  await expect.poll(() => editor.inputValue()).toContain('🚀');
  console.log('PASS insert menu and emoji insertion');

  await editor.evaluate((element) => {
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
  });
  await page.getByRole('button', { name: 'Insert native component', exact: true }).click();
  const nativeMenu = page.locator('.editor-toolbar-native-menu');
  await expect(nativeMenu).toBeVisible();
  await expect(nativeMenu.locator('.editor-toolbar-native-title')).toHaveText('Insert component');
  const groupCount = await nativeMenu.locator('.editor-toolbar-native-group').count();
  const itemCount = await nativeMenu.locator('.editor-toolbar-native-item').count();
  if (groupCount !== 5 || itemCount !== 25) {
    throw new Error(`Unexpected native catalog: ${groupCount} groups, ${itemCount} items`);
  }
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/editor-toolbar-components.png' });

  const search = page.getByRole('searchbox', { name: 'Search native components' });
  await expect(search).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(nativeMenu.getByRole('menuitem').first()).toBeFocused();
  await search.fill('slider');
  await expect(nativeMenu.locator('.editor-toolbar-native-item')).toHaveCount(1);
  await nativeMenu.getByRole('menuitem', { name: /Slider/ }).click();
  await expect.poll(() => editor.inputValue()).toContain('<slider bind="amount"');
  await expect(page.locator('.status-chip')).toContainText('Compiled');
  await expect(page.getByRole('slider', { name: 'Amount', exact: true })).toBeVisible();
  console.log('PASS native picker header, search, keyboard entry and insertion');

  await page.getByRole('button', { name: 'Insert native component', exact: true }).click();
  await expect(nativeMenu).toBeVisible();
  await nativeMenu.getByRole('button', { name: 'Close component panel' }).click();
  await expect(nativeMenu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Insert native component', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Insert native component', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(nativeMenu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Insert native component', exact: true })).toBeFocused();
  console.log('PASS picker close button and Escape restore trigger focus');

  await editor.fill('Title line\nBody');
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(0, 0);
  });
  await headingTrigger.focus();
  await page.keyboard.press('ArrowDown');
  const headingMenu = page.locator('.editor-toolbar-heading-menu');
  await expect(headingMenu).toBeVisible();
  await expect(headingMenu.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(headingMenu.getByRole('menuitemradio', { name: /Heading 1/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => editor.inputValue()).toBe('# Title line\nBody');
  await expect(headingTrigger).toHaveAttribute('aria-label', 'Heading level: Heading 1');
  await headingTrigger.click();
  await expect(
    page.getByRole('menuitemradio', { name: /Heading 1/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(headingTrigger.locator('.editor-toolbar-heading-label-full')).toBeVisible();
  await expect(headingTrigger.locator('.editor-toolbar-heading-label-compact')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(headingTrigger).toBeFocused();
  console.log('PASS heading menu, current level label and checked state');

  await headingTrigger.focus();
  await page.keyboard.press('ArrowRight');
  await expect(boldButton).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(headingTrigger).toBeFocused();
  console.log('PASS toolbar roving arrow and Home navigation');

  await editor.fill('**Bold**\n- Item');
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(3, 3);
  });
  await expect(boldButton).toHaveAttribute('aria-pressed', 'true');
  await editor.evaluate((element) => {
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
  });
  await expect(listTrigger).toHaveAttribute('aria-label', 'List: Bullet list');
  await expect(listTrigger).toHaveClass(/is-active/);
  console.log('PASS inline and list active states');

  await insertTrigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(insertMenu).toBeVisible();
  await expect(insertMenu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(insertMenu.getByRole('menuitem', { name: 'Emoji', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(insertTrigger).toBeFocused();
  console.log('PASS menu arrow and End navigation');

  await page.getByRole('button', { name: 'Restore example', exact: true }).click();
  await page.locator('.editor-frame').screenshot({ path: 'artifacts/editor-toolbar-desktop.png' });
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (pageOverflow) throw new Error('Desktop page overflows horizontally');

  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.editor-frame').screenshot({ path: 'artifacts/editor-toolbar-dark.png' });
  console.log('PASS desktop screenshots and dark theme');

  const tablet = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  tablet.setDefaultTimeout(10000);
  await tablet.goto(baseURL);
  const tabletToolbar = tablet.locator('.editor-toolbar');
  await expect(tabletToolbar).toBeVisible();
  expectSameIds(
    await visibleToolbarIds(tabletToolbar),
    ['heading', 'bold', 'italic', 'list', 'link', 'insert', 'components', 'more'],
    'Compact desktop controls',
  );
  const tabletRows = await tabletToolbar.locator('[data-toolbar-id]').evaluateAll((elements) =>
    new Set(
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => Math.round(element.getBoundingClientRect().top)),
    ).size,
  );
  if (tabletRows !== 1) throw new Error(`Compact desktop toolbar wraps onto ${tabletRows} rows`);
  const tabletHeading = tablet.locator('[data-toolbar-id="heading"]');
  await expect(tabletHeading.locator('.editor-toolbar-heading-label-full')).toHaveText('Heading 1');
  await expect(tabletHeading.locator('.editor-toolbar-heading-label-compact')).toBeHidden();
  const tabletMoreTrigger = tablet.locator('[data-toolbar-id="more"]');
  await tabletMoreTrigger.click();
  const tabletMoreMenu = tablet.locator('.editor-toolbar-more-menu');
  await expect(tabletMoreMenu).toBeVisible();
  await expect(tabletMoreMenu.getByRole('menuitem')).toHaveCount(3);
  await expect(tabletMoreMenu.getByRole('menuitem', { name: 'Link', exact: true })).toHaveCount(0);
  await tablet.waitForTimeout(180);
  await tablet.locator('.editor-frame').screenshot({ path: 'artifacts/editor-toolbar-1024.png' });
  await tablet.keyboard.press('Escape');
  await expect(tabletMoreTrigger).toBeFocused();
  await tablet.close();
  console.log('PASS 1024px compact history actions stay on one row');

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  mobile.setDefaultTimeout(10000);
  const mobileErrors = [];
  mobile.on('pageerror', (error) => mobileErrors.push(error.message));
  mobile.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await mobile.goto(baseURL);
  const mobileToolbar = mobile.locator('.editor-toolbar');
  await expect(mobileToolbar).toBeVisible();
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (mobileOverflow) throw new Error('Mobile page overflows horizontally');
  const mobileBox = await mobileToolbar.boundingBox();
  if (!mobileBox || mobileBox.width > 390) throw new Error(`Mobile toolbar width: ${mobileBox?.width}`);

  expectSameIds(
    await visibleToolbarIds(mobileToolbar),
    ['heading', 'bold', 'italic', 'list', 'insert', 'components', 'more'],
    'Mobile persistent controls',
  );

  const mobileHeading = mobile.locator('[data-toolbar-id="heading"]');
  const mobileHeadingBox = await mobileHeading.boundingBox();
  if (!mobileHeadingBox || mobileHeadingBox.width < 43.5) {
    throw new Error(`Mobile heading target is too narrow: ${JSON.stringify(mobileHeadingBox)}`);
  }
  await expect(mobileHeading.locator('.editor-toolbar-heading-label-full')).toBeHidden();
  await expect(mobileHeading.locator('.editor-toolbar-heading-label-compact')).toHaveText('H1');
  await expect(mobileHeading.locator('.editor-toolbar-heading-label-compact')).toBeVisible();
  await expect(mobileHeading.locator('.editor-toolbar-chevron')).toBeVisible();
  console.log('PASS mobile heading uses compact H1 label with a 44px target');

  const controlBoxes = await mobileToolbar.locator('[data-toolbar-id]').evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        id: element.dataset.toolbarId,
        top: Math.round(element.getBoundingClientRect().top),
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
      })),
  );
  if (new Set(controlBoxes.map((item) => item.top)).size !== 1) {
    throw new Error(`Mobile toolbar wraps onto multiple rows: ${JSON.stringify(controlBoxes)}`);
  }
  const undersized = controlBoxes.filter((item) => item.height < 43.5);
  if (undersized.length > 0) {
    throw new Error(`Touch targets below 44px: ${JSON.stringify(undersized)}`);
  }
  await mobileToolbar.screenshot({ path: 'artifacts/editor-toolbar-mobile.png' });
  console.log('PASS mobile single row with 44px touch targets');

  await mobile.getByRole('button', { name: 'Insert native component', exact: true }).click();
  const mobileNative = mobile.locator('.editor-toolbar-native-menu');
  await expect(mobileNative).toBeVisible();
  await expect(mobileNative.locator('.editor-toolbar-native-title')).toHaveText('Insert component');
  await mobile.waitForTimeout(180);
  const mobileClose = mobileNative.getByRole('button', { name: 'Close component panel' });
  const closeBox = await mobileClose.boundingBox();
  if (!closeBox || closeBox.height < 43.5) {
    throw new Error(`Mobile picker close target is too small: ${JSON.stringify(closeBox)}`);
  }
  const menuBox = await mobileNative.boundingBox();
  if (
    !menuBox
    || menuBox.x < 0
    || menuBox.x + menuBox.width > 391
    || menuBox.y < 0
    || menuBox.y + menuBox.height > 845
  ) {
    throw new Error(`Mobile menu overflows viewport: ${JSON.stringify(menuBox)}`);
  }
  await mobile.waitForTimeout(180);
  await mobile.screenshot({ path: 'artifacts/editor-toolbar-mobile-menu.png' });
  await mobileClose.click();
  await expect(mobileNative).toHaveCount(0);
  await expect(mobile.getByRole('button', { name: 'Insert native component', exact: true })).toBeFocused();
  console.log('PASS mobile picker header, close button and viewport fit');

  await mobile.getByRole('button', { name: 'More', exact: true }).click();
  const moreMenu = mobile.locator('.editor-toolbar-more-menu');
  await expect(moreMenu).toBeVisible();
  for (const name of ['Link', 'Undo', 'Redo', 'Download document']) {
    await expect(moreMenu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await mobile.keyboard.press('ArrowDown');
  await expect(moreMenu.getByRole('menuitem', { name: 'Link', exact: true })).toBeFocused();
  await mobile.keyboard.press('Escape');
  await expect(mobile.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  console.log('PASS mobile more menu and keyboard navigation');

  await mobile.locator('[data-toolbar-id="heading"]').click();
  await mobile.waitForTimeout(180);
  const headingBox = await mobile.locator('.editor-toolbar-heading-menu').boundingBox();
  if (
    !headingBox
    || headingBox.y < 0
    || headingBox.y + headingBox.height > 845
  ) {
    throw new Error(`Mobile heading menu overflows viewport: ${JSON.stringify(headingBox)}`);
  }
  await mobile.keyboard.press('Escape');
  await expect(mobile.locator('[data-toolbar-id="heading"]')).toBeFocused();

  await mobile.locator('[data-toolbar-id="insert"]').click();
  await expect(mobile.locator('.editor-toolbar-insert-menu')).toBeVisible();
  await mobile.keyboard.press('Escape');
  console.log('PASS mobile heading and insert menus stay inside the viewport');

  const chinese = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const chineseErrors = [];
  chinese.setDefaultTimeout(10000);
  chinese.on('pageerror', (error) => chineseErrors.push(error.message));
  await chinese.goto(baseURL);
  await chinese.getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
  const chineseToolbar = chinese.getByRole('toolbar', { name: '文档编辑工具栏', exact: true });
  await expect(chineseToolbar).toBeVisible();
  await expect(chinese.getByRole('button', { name: '加粗', exact: true })).toBeVisible();
  await expect(chinese.getByRole('button', { name: '斜体', exact: true })).toBeVisible();
  await expect(chinese.locator('[data-toolbar-id="insert"]')).toHaveAttribute('aria-label', '插入');
  await expect(chinese.locator('[data-toolbar-id="components"]'))
    .toHaveAttribute('aria-label', '插入原生组件');
  await chinese.locator('[data-toolbar-id="components"]').click();
  const chineseNative = chinese.locator('.editor-toolbar-native-menu');
  await expect(chineseNative).toBeVisible();
  await expect(chineseNative.locator('.editor-toolbar-native-title')).toHaveText('插入组件');
  await expect(chinese.getByPlaceholder('搜索组件、说明或关键词')).toBeVisible();
  await chinese.getByRole('button', { name: '关闭组件面板', exact: true }).click();
  await expect(chineseNative).toHaveCount(0);
  await chinese.close();
  if (chineseErrors.length) throw new Error(`Chinese page errors: ${JSON.stringify(chineseErrors)}`);
  console.log('PASS Chinese toolbar labels and component picker copy');

  if (errors.length || mobileErrors.length) {
    throw new Error(`Page errors: ${JSON.stringify([...errors, ...mobileErrors])}`);
  }
  if (failedResponses.length) {
    console.log(`WARN failed responses: ${JSON.stringify(failedResponses)}`);
  }
  console.log('ALL CHECKS PASSED');
} finally {
  await browser.close();
}
