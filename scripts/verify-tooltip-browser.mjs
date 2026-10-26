import { chromium, firefox, webkit, expect } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const engines = (process.env.PLAYWRIGHT_ENGINE ?? 'chromium,firefox,webkit').split(',');
const types = { chromium, firefox, webkit };
if (engines.some(engine => !types[engine])) throw new Error('Unknown PLAYWRIGHT_ENGINE');
const server = process.env.TOOLTIP_URL ? null : await createServer({
  root, configFile: false,
  optimizeDeps: { entries: ['tests/browser/tooltip-fixture.html'] },
  server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.tasks/**', '**/artifacts/**'] } },
});
const results = [];
const output = join(root, 'artifacts/tooltip');
async function withTimeout(task, label) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after 15 seconds`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
await mkdir(output, { recursive: true });
try {
  await server?.listen();
  const fixtureURL = process.env.TOOLTIP_URL ?? `${server.resolvedUrls.local[0]}tests/browser/tooltip-fixture.html`;
  for (const engine of engines) {
    let browser;
    const result = { engine, status: 'running', checks: [], errors: [] };
    results.push(result);
    try {
      const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
      console.log(`LAUNCH ${engine}`);
      browser = await types[engine].launch({ headless: true, ...(engine === 'chromium' && channel !== 'chromium' ? { channel } : {}) });
      for (const width of [1280, 375]) {
        const page = await withTimeout(browser.newPage({ viewport: { width, height: 900 } }), `${engine} page creation`);
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => result.errors.push(error.message));
        for (const theme of ['light', 'dark']) {
          console.log(`CHECK ${engine} ${width}px ${theme}`);
          await page.goto(`${fixtureURL}?theme=${theme}`);
          for (const position of ['middle', 'left', 'right', 'long']) {
            const wrapper = page.locator(`.${position} .local-tooltip`);
            const trigger = wrapper.locator('.local-tooltip-trigger');
            const bubble = wrapper.locator('[role=tooltip]');
            await trigger.focus();
            await expect(bubble).toHaveClass(/is-visible/);
            const expectedBackground = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(27, 27, 29)';
            await expect(bubble).toHaveCSS('background-color', expectedBackground);
            await expect(bubble).toHaveCSS('color', theme === 'light' ? 'rgb(35, 35, 35)' : 'rgb(236, 235, 231)');
            await expect.poll(async () => {
              const rect = await bubble.boundingBox();
              return rect && rect.x >= 7 && rect.x + rect.width <= width - 7;
            }).toBe(true);
            const rect = await bubble.boundingBox();
            if (position !== 'long') expect(rect.width).toBeGreaterThan(rect.height * 2);
            expect(rect.width).toBeLessThanOrEqual(Math.min(282, width - 16));
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            expect(await bubble.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
            await trigger.press('Escape');
            await expect(bubble).not.toHaveClass(/is-visible/);
            await page.mouse.move(0, 0);
            await trigger.hover();
            await expect(bubble).toHaveClass(/is-visible/);
            result.checks.push(`${width}px ${theme} ${position}`);
            if (position === 'middle') {
              const clip = await bubble.boundingBox();
              await page.screenshot({ path: join(output, `${engine}-${width}-${theme}.png`), clip, timeout: 5000 });
            }
            await page.mouse.move(0, 0);
            await trigger.blur();
          }
          await expect(page.locator('.static [role=note]')).toHaveCSS('position', 'static');
          await expect(page.locator('.static [role=note]')).toHaveCSS('border-top-width', '0px');
        }
        await page.close();
      }
      expect(result.errors).toEqual([]);
      result.status = 'passed';
      console.log(`PASS ${engine}: ${result.checks.length} tooltip layouts; light/dark, horizontal text, edge clamping, wrapping, keyboard, hover and static notes`);
    } catch (error) {
      result.status = 'failed';
      result.failure = error.stack ?? String(error);
      console.error(`FAIL ${engine}: ${result.failure}`);
    } finally { await browser?.close(); }
  }
} finally {
  await server?.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(results, null, 2));
}
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
