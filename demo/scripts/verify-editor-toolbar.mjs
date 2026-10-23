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

try {
  await page.goto(baseURL);
  const toolbar = page.locator('.editor-toolbar');
  await expect(toolbar).toBeVisible();
  const editor = page.locator('#source-editor');

  await page.getByRole('button', { name: '恢复示例', exact: true }).click();
  await editor.fill('# 测试\n\n正文内容');
  await editor.evaluate((element) => {
    element.focus();
    element.setSelectionRange(6, 10);
  });

  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await expect.poll(() => editor.inputValue()).toBe('# 测试\n\n**正文内容**');
  const boldSelection = await editor.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
    focused: document.activeElement === element,
  }));
  if (boldSelection.start !== 8 || boldSelection.end !== 12 || !boldSelection.focused) {
    throw new Error(`Bold selection was not restored: ${JSON.stringify(boldSelection)}`);
  }
  console.log('PASS bold formatting, selection and focus restore');

  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => editor.inputValue()).toBe('# 测试\n\n正文内容');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => editor.inputValue()).toBe('# 测试\n\n**正文内容**');
  await editor.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => editor.inputValue()).toBe('# 测试\n\n正文内容');
  await page.keyboard.press('Control+y');
  await expect.poll(() => editor.inputValue()).toBe('# 测试\n\n**正文内容**');
  console.log('PASS undo and redo via buttons and keyboard');

  await editor.evaluate((element) => {
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
  });
  await page.getByRole('button', { name: '插入原生组件', exact: true }).click();
  const nativeMenu = page.locator('.editor-toolbar-native-menu');
  await expect(nativeMenu).toBeVisible();
  const groupCount = await nativeMenu.locator('.editor-toolbar-native-group').count();
  const itemCount = await nativeMenu.locator('.editor-toolbar-native-item').count();
  if (groupCount !== 5 || itemCount !== 25) {
    throw new Error(`Unexpected native catalog: ${groupCount} groups, ${itemCount} items`);
  }
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/editor-toolbar-components.png' });

  const search = page.getByRole('searchbox', { name: '搜索原生组件' });
  await expect(search).toBeFocused();
  await search.fill('滑块');
  await expect(nativeMenu.locator('.editor-toolbar-native-item')).toHaveCount(1);
  await nativeMenu.getByRole('menuitem', { name: /滑块/ }).click();
  await expect.poll(() => editor.inputValue()).toContain('<slider bind="amount"');
  await expect(page.locator('.status-chip')).toContainText('已编译');
  await expect(page.getByRole('slider', { name: '数量', exact: true })).toBeVisible();
  console.log('PASS native component search and insertion');

  await page.getByRole('button', { name: '插入表情', exact: true }).click();
  await page.getByRole('menuitem', { name: '插入表情 🚀' }).click();
  await expect.poll(() => editor.inputValue()).toContain('🚀');
  console.log('PASS emoji insertion');

  await page.getByRole('button', { name: '标题', exact: true }).click();
  await page.getByRole('menuitem', { name: /标题 1/ }).click();
  console.log('PASS heading menu');

  await page.getByRole('button', { name: '插入原生组件', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.editor-toolbar-native-menu')).toHaveCount(0);
  await expect(editor).toBeFocused();
  console.log('PASS Escape closes the picker and restores editor focus');

  await toolbar.screenshot({ path: 'artifacts/editor-toolbar-desktop.png' });
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (pageOverflow) throw new Error('Desktop page overflows horizontally');

  await page.getByRole('button', { name: '深色主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toolbar.screenshot({ path: 'artifacts/editor-toolbar-dark.png' });
  console.log('PASS dark theme toolbar');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.setDefaultTimeout(10000);
  const mobileErrors = [];
  mobile.on('pageerror', (error) => mobileErrors.push(error.message));
  mobile.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await mobile.goto(baseURL);
  await expect(mobile.locator('.editor-toolbar')).toBeVisible();
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (mobileOverflow) throw new Error('Mobile page overflows horizontally');
  const mobileBox = await mobile.locator('.editor-toolbar').boundingBox();
  if (!mobileBox || mobileBox.width > 390) throw new Error(`Mobile toolbar width: ${mobileBox?.width}`);
  await mobile.locator('.editor-toolbar').screenshot({ path: 'artifacts/editor-toolbar-mobile.png' });
  await mobile.getByRole('button', { name: '插入原生组件', exact: true }).click();
  await expect(mobile.locator('.editor-toolbar-native-menu')).toBeVisible();
  await mobile.waitForTimeout(180);
  const menuBox = await mobile.locator('.editor-toolbar-native-menu').boundingBox();
  if (
    !menuBox
    || menuBox.x < 0
    || menuBox.x + menuBox.width > 391
    || menuBox.y < 0
    || menuBox.y + menuBox.height > 845
  ) {
    throw new Error(`Mobile menu overflows viewport: ${JSON.stringify(menuBox)}`);
  }
  await mobile.screenshot({ path: 'artifacts/editor-toolbar-mobile-menu.png' });

  await mobile.keyboard.press('Escape');
  await mobile.getByRole('button', { name: '标题', exact: true }).click();
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
  console.log('PASS mobile layout, bottom-sheet picker and upward menus');

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
