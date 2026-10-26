import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'mpa' });
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  await mkdir('artifacts/markdown-compat', { recursive: true });
  for (const width of [1280, 375]) {
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${server.resolvedUrls.local[0]}tests/browser/markdown-fixture.html`);
      const document = page.locator('#primary article');
      await expect(document).toHaveCount(1);
      await expect(document).not.toHaveClass(/local-inactive/);
      await expect(document).toContainText('Array<T>，Map<string, number>，比较 x<y 成立。售价 $5、$10，或 $5 and $10。');
      await expect(document.locator('strong').filter({ hasText: '粗体' })).toHaveCount(1);
      await expect(document.locator('em').filter({ hasText: '斜体' })).toHaveCount(2);
      await expect(document.locator('del')).toHaveText('删除线');
      await expect(document.locator('u')).toHaveText('下划线');
      await expect(document.locator('mark')).toHaveText('高亮');
      await expect(document.locator('br')).toHaveCount(1);
      await expect(document.locator('.local-fallback')).toHaveCount(0);
      await expect(document.locator('math[display="inline"]')).toHaveCount(1);
      await expect(document.locator('math[display="block"]')).toHaveCount(1);
      await expect(document.locator('mfrac')).toBeVisible();
      await expect(document.locator('math[display="inline"] annotation')).toHaveText('\\frac{a}{b}');
      await expect(document.locator('sup a')).toHaveCount(4);
      const notes = document.locator('[role="doc-endnotes"]');
      await expect(notes).toBeVisible();
      await expect(notes.locator('ol > li')).toHaveCount(2);
      await expect(notes.locator('ol > li').first()).toContainText('加粗内容');
      await expect(notes).not.toContainText('不应显示的未引用定义');
      const firstRef = document.locator('sup a').first();
      await firstRef.focus();
      await expect(firstRef).toBeFocused();
      await firstRef.press('Enter');
      const target = await firstRef.getAttribute('href');
      await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toBe(target);
      const backlink = notes.locator('a[role="doc-backlink"]').first();
      await backlink.click();
      const returnTarget = await backlink.getAttribute('href');
      await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toBe(returnTarget);
      const linkProblems = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
        return {
          duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
          missingTargets: [...document.querySelectorAll('article sup a, article a[role="doc-backlink"]')]
            .map(link => link.getAttribute('href')).filter(href => href?.startsWith('#') && !document.getElementById(decodeURIComponent(href.slice(1)))),
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      assert.deepEqual(linkProblems, { duplicateIds: [], missingTargets: [], overflow: false });
      await document.getByRole('button', { name: '数量 增加', exact: true }).click();
      await expect(document).toContainText('当前数量：3。');
      assert.deepEqual(await page.evaluate(() => window.markdownDiagnostics), []);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `artifacts/markdown-compat/${width}-${colorScheme}.png`, fullPage: true });
      console.log(`PASS ${width}px ${colorScheme}: formatting, currency, footnote order/links, instance IDs, keyboard, controls and overflow`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
