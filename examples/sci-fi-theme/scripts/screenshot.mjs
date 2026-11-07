import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const outDir = path.resolve(fileURLToPath(new URL('../screenshots/', import.meta.url)));
const config = path.join(root, 'examples/sci-fi-theme/vite.config.ts');
const vite = path.join(root, 'node_modules/vite/bin/vite.js');
const port = 4318;
const base = `http://127.0.0.1:${port}/`;

await mkdir(outDir, { recursive: true });

const server = spawn(process.execPath, [vite, 'preview', '--config', config, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += String(chunk); });
server.stderr.on('data', (chunk) => { serverLog += String(chunk); });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Preview server did not start.\n${serverLog}`);
}

const problems = [];
let browser;

try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.md-document .local-panel');
  await page.waitForSelector('.local-visual-chart');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const diagnostics = await page.locator('.sf-status').nth(4).locator('strong').innerText();
  if (diagnostics.trim() !== '00') problems.push(`renderer diagnostics: ${diagnostics.trim()}`);

  await page.screenshot({ path: path.join(outDir, 'overview-dark.png'), fullPage: true });

  await page.locator('[data-scheme="light"]').click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, 'overview-light.png'), fullPage: true });

  await page.locator('[data-scheme="dark"]').click();
  await page.waitForTimeout(250);

  await page.locator('.local-panel').first().screenshot({ path: path.join(outDir, 'panel-dark.png') });
  await page.locator('.local-visual-chart').first().screenshot({ path: path.join(outDir, 'chart-dark.png') });
  await page.locator('.md-table-scroll').first().screenshot({ path: path.join(outDir, 'table-dark.png') });
  await page.locator('.local-visual-table-scroll').first().screenshot({ path: path.join(outDir, 'enhanced-table-dark.png') });
  await page.locator('.local-visual-diagram').first().screenshot({ path: path.join(outDir, 'diagram-dark.png') });
  await page.locator('.local-tabs').first().screenshot({ path: path.join(outDir, 'navigation-dark.png') });

  const light = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await light.goto(base, { waitUntil: 'networkidle' });
  await light.waitForSelector('.md-document .local-panel');
  await light.locator('[data-scheme="light"]').click();
  await light.waitForTimeout(350);
  await light.locator('.local-panel').first().screenshot({ path: path.join(outDir, 'panel-light.png') });
  await light.locator('.local-visual-chart').first().screenshot({ path: path.join(outDir, 'chart-light.png') });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(base, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.md-document .local-panel');
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: path.join(outDir, 'mobile-dark.png'), fullPage: true });

  console.log(`Screenshots written to ${outDir}`);
  if (problems.length) {
    console.error('Runtime problems:');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  server.kill();
}
