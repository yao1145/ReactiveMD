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
  await mkdir('artifacts/html-compat/browser', { recursive: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}tests/browser/html-compat-fixture.html`);
    const outer = page.locator('.local-disclosure').first();
    await expect(outer.getByRole('button', { name: 'Read more', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(outer.locator('h2')).toHaveText('Nested heading');
    await expect(outer.locator('sub')).toHaveText('2');
    await expect(outer.locator('sup')).toHaveText('2');
    await outer.getByRole('button', { name: 'Count increase', exact: true }).click();
    await expect(outer).toContainText('Current: 3');
    const nestedTrigger = outer.getByRole('button', { name: 'Nested disclosure', exact: true });
    await nestedTrigger.focus();
    await nestedTrigger.press('Enter');
    await expect(nestedTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(outer.locator('strong').filter({ hasText: 'Markdown' })).toBeVisible();
    await expect(page.locator('pre')).toContainText('<script>window.bad = true</script> {{ count }}');

    const source = `# Literal Markdown
<p id="result">{{ unchanged }}</p>
<style>p { color: rgb(201, 11, 21) }</style>
<script>document.getElementById('result').textContent = 'Author JS ran';try{parent.document.body.dataset.htmlEscaped='yes'}catch(e){document.body.dataset.isolated='yes'}</script>
<dl><dt>Native term</dt><dd>Native definition</dd></dl>`;
    for (let mask = 1; mask < 8; mask++) {
      const options = { enableCss: Boolean(mask & 1), enableJavaScript: Boolean(mask & 2), enableExtendedHtml: Boolean(mask & 4) };
      await page.evaluate(({ source, options }) => window.setHtmlCase(source, options), { source, options });
      const frameElement = page.locator('iframe').first();
      await expect(frameElement).toBeVisible();
      const sandbox = await frameElement.getAttribute('sandbox');
      assert.equal(sandbox.includes('allow-same-origin'), false);
      assert.equal(sandbox.includes('allow-scripts'), options.enableJavaScript);
      const frame = page.frameLocator('iframe').first();
      await expect(frame.locator('body')).toContainText('# Literal Markdown');
      await expect(frame.locator('h1')).toHaveCount(0);
      await expect(frame.locator('#result')).toHaveText(options.enableJavaScript ? 'Author JS ran' : '{{ unchanged }}');
      await expect(frame.locator('dl')).toHaveCount(options.enableExtendedHtml ? 1 : 0);
      if (options.enableCss) await expect(frame.locator('#result')).toHaveCSS('color', 'rgb(201, 11, 21)');
      else await expect(frame.locator('#result')).not.toHaveCSS('color', 'rgb(201, 11, 21)');
      assert.equal(await page.locator('body').getAttribute('data-html-escaped'), null);
      if (options.enableJavaScript) await expect(frame.locator('body')).toHaveAttribute('data-isolated', 'yes');
    }

    const hostile = '<iframe srcdoc="&lt;script&gt;parent.document.body.dataset.nestedExecuted=\'yes\'&lt;/script&gt;"></iframe><p>Nested frame test</p>';
    await page.evaluate(source => window.setHtmlCase(source, { enableExtendedHtml: true }), hostile);
    await expect(page.frameLocator('iframe').first().locator('p')).toHaveText('Nested frame test');
    await expect.poll(async () => {
      const frame = await page.locator('iframe').first().contentFrame();
      return frame.locator('body').getAttribute('data-nested-executed');
    }).toBe(null);

    await page.evaluate(() => window.setHtmlCase('<body onload="document.querySelector(\'.proof\').textContent=\'Body event ran\'"><style>.proof{color:rgb(201,11,21)}</style><p class="proof">Waiting</p></body>', { enableCss: true, enableJavaScript: true }));
    const classFrame = page.frameLocator('iframe').first();
    await expect(classFrame.locator('.proof')).toHaveText('Body event ran');
    await expect(classFrame.locator('.proof')).toHaveCSS('color', 'rgb(201, 11, 21)');

    await page.evaluate(() => window.setHtmlCase('<p id="module">Waiting</p><script type="module">await Promise.resolve();document.getElementById("module").textContent="Module ran"</script><script type="application/json">{"key":"data"}</script>', { enableJavaScript: true }));
    await expect(page.frameLocator('iframe').first().locator('#module')).toHaveText('Module ran');

    // Fulfill locally: this checks native submission without contacting a service.
    await page.route('https://forms.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Submission accepted</p>' }));
    const hostUrl = page.url();
    await page.evaluate(() => window.setHtmlCase('<base href="https://forms.example.test/"><form action="/submit" method="get"><label for="field">Value</label><input id="field" name="value" value="accepted"><button>Submit</button></form>', { enableExtendedHtml: true }));
    const formFrame = page.frameLocator('iframe').first();
    await expect(formFrame.getByRole('textbox', { name: 'Value' })).toHaveValue('accepted');
    assert.equal(await formFrame.locator('form').evaluate(form => form.action), 'https://forms.example.test/submit');
    const requestReady = page.waitForRequest(request => request.url().startsWith('https://forms.example.test/submit'));
    await formFrame.getByRole('button', { name: 'Submit', exact: true }).click();
    assert.equal(new URL((await requestReady).url()).searchParams.get('value'), 'accepted');
    await expect(formFrame.locator('p')).toHaveText('Submission accepted');
    assert.equal(page.url(), hostUrl);

    let imageRequests = 0;
    await page.route('https://images.example.test/**', route => { imageRequests += 1; return route.abort(); });
    await page.evaluate(() => window.setHtmlCase('<div id="part"><p>Anchor body</p></div>\n\n<a href="#part">Jump</a>\n\n<span id="label">Label</span> <span aria-labelledby="label">Content</span>\n\n<img src="https://images.example.test/unapproved.png" alt="Unapproved">', {}, 2));
    await expect(page.locator('.local-document')).toHaveCount(2);
    for (const document of await page.locator('.local-document').all()) {
      const target = await document.locator('div[id]').getAttribute('id');
      await expect(document.getByRole('link', { name: 'Jump', exact: true })).toHaveAttribute('href', `#${target}`);
      const label = await document.locator('span[id]').getAttribute('id');
      await expect(document.locator('span[aria-labelledby]')).toHaveAttribute('aria-labelledby', label);
    }
    const ids = await page.locator('.local-document [id]').evaluateAll(nodes => nodes.map(node => node.id));
    assert.equal(new Set(ids).size, ids.length);
    await expect(page.locator('.local-document img')).toHaveCount(0);
    assert.equal(imageRequests, 0);

    await page.evaluate(() => window.setHtmlCase('<img src="https://images.example.test/approved.png" alt="Preview" width="120" height="80">'));
    const image = page.getByRole('button', { name: 'Preview', exact: true });
    await expect(image).toHaveAttribute('width', '120');
    await image.focus();
    await image.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Image preview: Preview', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(image).toBeFocused();

    await page.evaluate(() => window.setHtmlCase('## Back to ReactiveMD\n\n<counter label="Count">'));
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Back to ReactiveMD' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Count increase', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `artifacts/html-compat/browser/${width}.png`, fullPage: true });
    await page.close();
    console.log(`PASS ${width}px: P0 nesting, keyboard, bindings, 7 HTML option combinations, CSS classes, body events, isolated form/base, scoped IDs/IDREFs, image policy, frame isolation, mode reset and overflow`);
  }
} finally {
  await browser?.close();
  await server.close();
}
