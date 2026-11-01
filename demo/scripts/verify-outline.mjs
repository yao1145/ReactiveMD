import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openWorkbench, replaceWorkbenchSource } from './workbench-ui.mjs';

const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const baseURL = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
await mkdir('artifacts/outline', { recursive: true });
const prose = Array.from({ length: 16 }, (_, index) => `Paragraph ${index + 1}: A document section with enough content to scroll.`).join('\n\n');
const source = `# Project\n\n## Demo updates\n\n### Deployment\n\n${prose}\n\n### Validation\n\n${prose}\n\n## npm release\n\n### Preparation\n\n${prose}\n\n### Acceptance\n\n${prose}\n\n\`\`\`md\n# Not a heading\n\`\`\``;

async function jumpWithoutPageScroll(page, button) {
  await button.evaluate(element => element.focus({ preventScroll: true }));
  const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.keyboard.press('Enter');
  for (let frame = 0; frame < 8; frame++) {
    const after = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve({ x: scrollX, y: scrollY }))));
    expect(Math.abs(after.x - before.x), 'Outline navigation must preserve page horizontal scroll').toBeLessThan(2);
    expect(Math.abs(after.y - before.y), 'Outline navigation must preserve page vertical scroll').toBeLessThan(2);
  }
}

try {
  for (const width of [1440, 390, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.clear(); });
    await openWorkbench(page, baseURL);
    const bar = page.locator('.editor-status-bar');
    const mode = name => bar.getByRole('button', { name, exact: true });
    const toggle = page.locator('#outline-toggle');
    const outline = page.locator('#document-outline');
    const stage = page.locator('.preview-stage');
    await expect(toggle).toHaveAttribute('aria-expanded', String(width >= 1100));
    await mode('Edit').click();
    await replaceWorkbenchSource(page, source);
    await expect(stage).toHaveAttribute('aria-busy', 'false');
    if (width < 1100) await toggle.click();
    await expect(outline).toBeVisible();
    await expect(outline.locator('.outline-link')).toHaveCount(7);
    await expect(outline).not.toContainText('Not a heading');
    await outline.getByRole('button', { name: 'Collapse Demo updates', exact: true }).click();
    await expect(outline.getByRole('button', { name: 'Deployment', exact: true })).toBeHidden();
    const expand = outline.getByRole('button', { name: 'Expand Demo updates', exact: true });
    await expand.focus();
    await page.keyboard.press('Enter');
    await expect(outline.getByRole('button', { name: 'Deployment', exact: true })).toBeVisible();

    // Editing selects the exact source heading, including headings below the viewport.
    await page.evaluate(() => window.scrollTo(0, 80));
    await jumpWithoutPageScroll(page, outline.getByRole('button', { name: 'Preparation', exact: true }));
    await expect.poll(() => page.locator('#source-editor').evaluate(element => {
      const state = window.rmdEditorProbe.snapshot(element);
      return state.value.slice(state.start, state.end);
    })).toBe('### Preparation');
    if (width < 1100) await expect(outline).toBeHidden();

    // Preview navigation scrolls the preview and leaves source mode unchanged.
    await mode('Preview').click();
    if (width < 1100) await toggle.click();
    await jumpWithoutPageScroll(page, outline.getByRole('button', { name: 'Validation', exact: true }));
    await expect(mode('Preview')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.pane-preview h3', { hasText: 'Validation' })).toBeFocused();
    if (width < 1100) await toggle.click();
    await expect(outline.getByRole('button', { name: 'Validation', exact: true })).toHaveAttribute('aria-current', 'location');
    await page.locator('.editor-preview').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(outline.getByRole('button', { name: 'Acceptance', exact: true })).toHaveAttribute('aria-current', 'location');
    if (width > 600) {
      await mode('Split').click();
      await jumpWithoutPageScroll(page, outline.getByRole('button', { name: 'Deployment', exact: true }));
      await expect.poll(() => page.locator('#source-editor').evaluate(element => {
        const state = window.rmdEditorProbe.snapshot(element);
        return state.value.slice(state.start, state.end);
      })).toBe('### Deployment');
      const visibleHeading = await page.locator('.pane-preview h3', { hasText: 'Deployment' }).boundingBox();
      const preview = await page.locator('.editor-preview').boundingBox();
      expect(visibleHeading.y).toBeGreaterThanOrEqual(preview.y - 1);
      expect(visibleHeading.y).toBeLessThan(preview.y + preview.height);
    }

    // Editing prose preserves collapsed branches; changing a title updates the outline.
    await mode('Edit').click();
    await outline.getByRole('button', { name: 'Collapse Demo updates', exact: true }).click();
    await replaceWorkbenchSource(page, source.replace('# Project', 'Intro\n\n# Project'));
    await expect(stage).toHaveAttribute('aria-busy', 'false');
    await expect(outline.getByRole('button', { name: 'Expand Demo updates', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await replaceWorkbenchSource(page, source.replace('## npm release', '## Revised release'));
    await expect(outline.getByRole('button', { name: 'Revised release', exact: true })).toBeVisible();
    await expect(outline.getByRole('button', { name: 'npm release', exact: true })).toHaveCount(0);

    await outline.getByRole('button', { name: 'Close outline', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(outline).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await replaceWorkbenchSource(page, 'No headings here.');
    await expect(outline).toContainText('No headings yet');

    // Duplicate titles still point to their own source positions.
    const duplicateSource = '# Same\n\n## Same\n\n## Same';
    await replaceWorkbenchSource(page, duplicateSource);
    await expect(stage).toHaveAttribute('aria-busy', 'false');
    const duplicates = outline.locator('.outline-link');
    await expect(duplicates).toHaveCount(3);
    await duplicates.last().click();
    await expect.poll(() => page.locator('#source-editor').evaluate(element => window.rmdEditorProbe.snapshot(element).start)).toBe(duplicateSource.lastIndexOf('## Same'));
    if (width < 1100) await toggle.click();

    await replaceWorkbenchSource(page, source);
    await expect(stage).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
    await expect(toggle).toHaveText('大纲');
    await expect(outline.getByRole('button', { name: '关闭大纲', exact: true })).toBeVisible();
    await replaceWorkbenchSource(page, source.replace('Project', 'ReactiveMD 项目约定').replace('Demo updates', 'Demo 网站更新')
      .replace('Deployment', '部署位置').replace('Validation', '构建与最小化验证').replace('npm release', 'npm 发布')
      .replace('Preparation', '版本与发布准备').replace('Acceptance', '发布后验收'));
    await expect(stage).toHaveAttribute('aria-busy', 'false');
    if (width > 600) await bar.getByRole('button', { name: '并排', exact: true }).click();
    else await bar.getByRole('button', { name: '预览', exact: true }).click();
    await outline.getByRole('button', { name: 'ReactiveMD 项目约定', exact: true }).click();
    if (width < 1100) await toggle.click();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: '深色主题', exact: true }).click();
      await outline.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `artifacts/outline/${width}-${theme}.png` });
    }
    expect(errors).toEqual([]);
    console.log(`PASS ${width}px: hierarchy, keyboard folding, source/preview navigation, active section, live updates, empty/duplicate headings, languages, themes and layout`);
    await page.close();
  }
} finally {
  await browser.close();
}
