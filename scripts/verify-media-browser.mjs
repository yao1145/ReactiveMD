import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({configFile:false, appType:'mpa', server:{host:'127.0.0.1',port:0}, optimizeDeps:{exclude:['reactive-md']}});
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({...channel === 'chromium' ? {} : {channel}, headless:true});
  await mkdir('artifacts/media', {recursive:true});
  for (const width of [1280, 375]) for (const theme of ['light', 'dark']) {
    const locale = width === 375 ? 'zh' : 'en';
    const context = await browser.newContext({viewport:{width,height:900},permissions:['clipboard-read','clipboard-write']});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/fixture-image.svg', route => route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#dce8f5"/><circle cx="720" cy="140" r="60" fill="#f0bd62"/><path d="M0 640V500L300 160 560 500 740 310 960 560V640Z" fill="#397c75"/></svg>'}));
    await page.goto(`${server.resolvedUrls.local[0]}tests/browser/media-fixture.html?locale=${locale}&theme=${theme}`);
    const primary = page.locator('#primary article');
    const blocks = primary.locator('.md-code-block');
    await expect(blocks).toHaveCount(13);
    await expect(blocks.first().locator('code .hljs-keyword')).toContainText('const');
    await expect(blocks.nth(1).locator('code .hljs-keyword').first()).toHaveText('def');
    await expect(blocks.nth(2).locator('code [class*="hljs-"]').first()).toBeVisible();
    await expect(blocks.nth(3).locator('code')).toHaveText('<script>window.codeExecuted = true</script>');
    await expect(blocks.nth(3).locator('code script')).toHaveCount(0);
    await expect(blocks.nth(4).locator('code')).toHaveText('plain <text> & symbols');
    for (let index = 5; index < 13; index++) {
      await expect(blocks.nth(index).locator('code')).toHaveClass(/hljs/);
      await expect(blocks.nth(index).locator('code [class*="hljs-"]').first()).toBeVisible();
    }
    await expect(blocks.nth(12).locator('.md-code-block-language')).not.toHaveText(/^(Text|文本)$/);
    const tokenColors = await blocks.nth(7).locator('code').evaluate(code => ({
      base: getComputedStyle(code).color,
      keyword: getComputedStyle(code.querySelector('.hljs-keyword')).color,
    }));
    assert.notEqual(tokenColors.base, tokenColors.keyword);
    await primary.screenshot({path: `artifacts/media/${width}-${theme}-highlighting.png`});
    const detectedCopy = blocks.nth(12).getByRole('button');
    await detectedCopy.click();
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g,'\n'), await page.evaluate(() => window.mediaHarness.code));
    await expect(primary.locator('.md-inline-code')).toHaveText('const plain = true');
    assert.equal(await page.evaluate(() => window.codeExecuted), undefined);
    await expect(page.locator('#denied img')).toHaveCount(0);
    await expect(page.locator('#static .md-code-block button')).toHaveCount(0);
    await expect(page.locator('#static img').first()).not.toHaveAttribute('tabindex','0');

    const copy = blocks.first().getByRole('button');
    await copy.click();
    // Windows serializes clipboard line endings as CRLF.
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g,'\n'), await page.evaluate(() => window.mediaHarness.code));
    await expect(blocks.first()).toContainText(locale === 'zh' ? '已复制' : 'Copied');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {configurable:true,value:undefined});
      document.execCommand = () => { window.fallbackCopy = document.activeElement.value; return true; };
    });
    await copy.click();
    assert.equal(await page.evaluate(() => window.fallbackCopy), await page.evaluate(() => window.mediaHarness.code));
    await expect(copy).toBeFocused();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async () => { throw new Error('denied'); }}});
      document.execCommand = () => false;
    });
    await copy.click();
    await expect(blocks.first()).toContainText(locale === 'zh' ? /失败|无法|未能/ : /failed|unable|could not/i);
    await page.emulateMedia({media:'print'});
    await expect(copy).toBeHidden();
    await page.emulateMedia({media:'screen'});

    const image = primary.locator('img.md-image').first();
    await image.scrollIntoViewIfNeeded();
    await image.focus();
    await image.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toHaveAttribute('alt','Landscape illustration');
    await expect(dialog.getByRole('button')).toBeFocused();
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(d => d.contains(document.activeElement)), 'focus must stay in dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(image).toBeFocused();
    await image.press('Space');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button').click();
    await expect(dialog).toHaveCount(0);
    await image.click();
    await expect(dialog).toBeVisible();
    await page.screenshot({path:`artifacts/media/${width}-${theme}-zoom.png`});
    await page.mouse.click(3,3);
    await expect(dialog).toHaveCount(0);
    const linked = primary.locator('a:has(img)');
    await linked.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#.*destination/);
    await image.click();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.mediaHarness.setStatic(true));
    await expect(dialog).toHaveCount(0);
    await expect(image).not.toHaveAttribute('tabindex','0');
    await page.evaluate(() => window.mediaHarness.setStatic(false));
    await expect(image).toHaveAttribute('tabindex','0');
    await image.click();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.mediaHarness.replace());
    await expect(dialog).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await expect(page.locator('#host-sentinel')).toHaveCSS('color','rgb(1, 2, 3)');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${theme}: language highlighting, exact clipboard/error feedback, image keyboard/modal/link/focus, static mode and URL policy`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
