import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

let server;
let browser;
try {
  const baseURL = process.env.DEMO_URL ?? await (async () => {
    server = await preview({ root: resolve('demo'), configFile: resolve('demo/vite.config.ts'), preview: { host: '127.0.0.1', port: 0 } });
    return server.resolvedUrls.local[0];
  })();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  await mkdir('artifacts/html-compat/browser', { recursive: true });
  for (const width of [1280, 375]) {
    for (const language of ['en', 'zh']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: language === 'zh' ? 'dark' : 'light' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(language => {
        if (window === window.top) localStorage.setItem('reactive-md:language', language);
      }, language);
      await page.goto(baseURL);
      await page.locator('.author-tools-menu > summary').click();
      const controls = page.locator('.html-compat');
      await expect(controls).toBeVisible();
      if (language === 'zh') await page.getByRole('button', { name: '深色主题', exact: true }).click();
      await expect(controls.locator('input[type=checkbox]')).toHaveCount(3);
      for (const input of await controls.locator('input').all()) await expect(input).not.toBeChecked();
      await expect(controls).not.toHaveAttribute('open', '');
      await controls.locator('summary').focus();
      await controls.locator('summary').press('Enter');
      await page.getByRole('button', { name: language === 'zh' ? '显示源码' : 'Show source', exact: true }).click();
      const source = '<base href="https://forms.example.test/"><p id="proof">Native HTML</p><style>p{color:rgb(201,11,21)}</style><script>document.getElementById("proof").textContent="Author JS ran"</script><dl><dt>Term</dt><dd>Definition</dd></dl><form action="/submit"><label>Value<input name="value" value="accepted"></label><button>Submit</button></form>';
      await page.locator('#source-editor').fill(source);
      const css = controls.locator('[data-html-option=enableCss]');
      const js = controls.locator('[data-html-option=enableJavaScript]');
      const extended = controls.locator('[data-html-option=enableExtendedHtml]');
      await css.focus();
      await css.press('Space');
      await expect(controls.locator('[data-html-mode=native]')).toBeVisible();
      let frame = page.frameLocator('.preview-stage iframe');
      await expect(frame.locator('#proof')).toHaveText('Native HTML');
      await expect(frame.locator('#proof')).toHaveCSS('color', 'rgb(201, 11, 21)');
      await js.check();
      await expect(frame.locator('#proof')).toHaveText('Author JS ran');
      await css.uncheck();
      await expect(frame.locator('#proof')).not.toHaveCSS('color', 'rgb(201, 11, 21)');
      await js.uncheck();
      await expect(page.locator('.preview-stage iframe')).toHaveCount(0);
      await expect(controls.locator('[data-html-mode=reactive]')).toBeVisible();
      await extended.check();
      await expect(frame.locator('dl')).toContainText('Definition');
      await js.check();
      await expect(frame.locator('#proof')).toHaveText('Author JS ran');
      await page.getByRole('button', { name: language === 'zh' ? '导出文档…' : 'Export document…', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const downloadReady = page.waitForEvent('download');
      await dialog.getByRole('button', { name: language === 'zh' ? '导出 HTML' : 'Export HTML', exact: true }).click();
      const download = await downloadReady;
      const output = resolve(`artifacts/html-compat/browser/export-${width}-${language}.html`);
      await download.saveAs(output);
      const html = await readFile(output, 'utf8');
      assert.match(html, /compileOptions/);
      assert.match(html, /enableJavaScript/);
      const exported = await browser.newPage();
      await exported.route('https://forms.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Submission accepted</p>' }));
      await exported.goto(pathToFileURL(output).href);
      await expect(exported.frameLocator('iframe').locator('#proof')).toHaveText('Author JS ran');
      const submitted = exported.waitForRequest(request => request.url().startsWith('https://forms.example.test/submit'));
      await exported.frameLocator('iframe').getByRole('button', { name: 'Submit', exact: true }).click();
      assert.equal(new URL((await submitted).url()).searchParams.get('value'), 'accepted');
      await expect(exported.frameLocator('iframe').locator('p')).toHaveText('Submission accepted');
      await exported.close();
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await controls.screenshot({ path: `artifacts/html-compat/browser/demo-${width}-${language}.png` });
      await page.reload();
      await expect(page.locator('.preview-stage iframe')).toHaveCount(0);
      for (const input of await controls.locator('input').all()) await expect(input).not.toBeChecked();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS Demo ${width}px ${language}: defaults, keyboard, capabilities, mode reset, file export, refresh reset and overflow`);
    }
  }
} finally {
  await browser?.close();
  await server?.close();
}
