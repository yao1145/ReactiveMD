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

    await page.evaluate(() => window.setHtmlCase('<div align="center" data-proof="center">你好\n\n**Markdown** {{ count }}\n\n<counter bind="count" label="Aligned count" initial="2">\n\n<p align="right" data-proof="right">靠右</p>\n</div>\n\n<h2 align="justify" data-proof="justify">Justified heading</h2>'));
    await expect(page.locator('iframe')).toHaveCount(0);
    const centered = page.locator('[data-proof="center"]');
    await expect(centered).toHaveCSS('text-align', /center$/);
    await expect(centered).toContainText('你好');
    await expect(centered.locator('strong')).toHaveText('Markdown');
    await expect(page.locator('[data-proof="right"]')).toHaveCSS('text-align', /right$/);
    await expect(page.locator('[data-proof="justify"]')).toHaveCSS('text-align', 'justify');
    await centered.getByRole('button', { name: 'Aligned count increase', exact: true }).click();
    await expect(centered).toContainText('Markdown 3');
    // Verify actual text positioning as well as the alignment attribute.
    const textCentered = await centered.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.querySelector('p'));
      const text = range.getBoundingClientRect();
      const container = element.getBoundingClientRect();
      return Math.abs((text.left + text.right) / 2 - (container.left + container.right) / 2) < 2;
    });
    assert.equal(textCentered, true);

    const brokenTable = '<table><tr><td colspan="bad">**Literal** {{ missing }} <script>window.rawHtmlRan = true</script></td></tr></table>';
    const unsupported = '<meta name="description" content="{{ missing }}">';
    await page.evaluate(source => window.setHtmlCase(source), `${brokenTable}\n\n${unsupported}\n\n<counter bind="count" label="Surviving count" initial="2">\n\nCurrent: {{ count }}`);
    await expect(page.locator('.local-fallback').first()).toHaveText(brokenTable);
    await expect(page.locator('.local-fallback').nth(1)).toHaveText(unsupported);
    await expect(page.locator('table, script:not([type="module"])')).toHaveCount(0);
    await page.getByRole('button', {name: 'Surviving count increase', exact: true}).click();
    await expect(page.locator('article')).toContainText('Current: 3');
    assert.equal(await page.evaluate(() => window.rawHtmlRan), undefined);
    assert.equal(await page.evaluate(() => window.htmlFallbackDiagnostics.every(d => d.severity === 'warning')), true);
    await page.screenshot({path: `artifacts/html-compat/browser/${width}-source-fallback.png`});

    const nativeFragment = '<div unsupported="value">**Literal**\n{{ missing }} <script>window.rawHtmlRan = true</script></div>';
    await page.evaluate(source => window.setHtmlCase(source, {enableJavaScript: true}), `<p>Before</p>${nativeFragment}<p>After</p>`);
    const nativeFallback = page.frameLocator('iframe').first();
    await expect(nativeFallback.locator('body')).toContainText(nativeFragment);
    await expect(nativeFallback.locator('div, script')).toHaveCount(0);
    await expect(nativeFallback.locator('p')).toHaveText(['Before', 'After']);

    const failedDocument = '\n<p>Before</p>\n<script>window.rawHtmlRan = true</script>\n<p>After</p>';
    await page.evaluate(source => window.setHtmlCase(source, {enableJavaScript: true, limits: {maxSyntaxNodes: 1}}), failedDocument);
    await expect(page.locator('iframe')).toHaveCount(0);
    assert.equal(await page.locator('[data-html-fallback="document"] pre').textContent(), failedDocument);
    await expect.poll(() => page.evaluate(() => window.htmlFallbackDiagnostics.some(d => d.code === 'local.budget' && d.severity === 'error'))).toBe(true);
    assert.equal(await page.evaluate(() => window.rawHtmlRan), undefined);

    await page.evaluate(async source => {
      const {createStandaloneMount} = await import('/src/standalone/session.tsx');
      const host = document.createElement('div');
      host.id = 'native-source-mount';
      document.body.append(host);
      window.rawFallbackReports = [];
      const handle = createStandaloneMount(host,
        {source, compileOptions: {enableJavaScript: true, limits: {maxSyntaxNodes: 1}}},
        {onDiagnostics: diagnostics => window.rawFallbackReports.push(diagnostics)});
      window.cleanupRawMount = () => { handle.unmount(); host.remove(); };
    }, failedDocument);
    await expect(page.locator('#native-source-mount pre')).toBeVisible();
    assert.equal(await page.locator('#native-source-mount pre').textContent(), failedDocument);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.rawFallbackReports.at(-1).some(d => d.code === 'local.budget' && d.severity === 'error')), true);
    await page.evaluate(() => window.cleanupRawMount());

    await page.context().route('**/link-target-proof', route => route.fulfill({contentType: 'text/html', body: '<p>Target opened</p>'}));
    const links = '<a href="#destination" target="_self" rel="next">Same page</a> <a href="/link-target-proof" target="_blank" rel="nofollow">New page</a> <a href="/link-target-proof" target="reader" rel="help">Named frame</a><p id="destination">Destination</p>';
    await page.evaluate(source => window.setHtmlCase(source), links);
    const samePage = page.getByRole('link', {name: 'Same page', exact: true});
    await expect(samePage).toHaveAttribute('target', '_self');
    await expect(samePage).toHaveAttribute('rel', 'next');
    await samePage.click();
    await expect.poll(() => new URL(page.url()).hash).toMatch(/destination$/);
    const newPage = page.getByRole('link', {name: 'New page', exact: true});
    await expect(newPage).toHaveAttribute('rel', 'nofollow noopener noreferrer');
    const [popup] = await Promise.all([page.waitForEvent('popup'), newPage.click()]);
    await expect(popup.locator('p')).toHaveText('Target opened');
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.name = 'reader';
      frame.srcdoc = '<p>Before navigation</p>';
      document.body.append(frame);
    });
    await page.getByRole('link', {name: 'Named frame', exact: true}).click();
    await expect(page.frameLocator('iframe[name="reader"]').locator('p')).toHaveText('Target opened');
    await page.locator('iframe[name="reader"]').evaluate(frame => frame.remove());
    await page.evaluate(source => window.setHtmlCase(source, {enableCss: true}), links.replace('href="#destination"', 'href="/link-target-proof"'));
    const nativeLinks = page.frameLocator('iframe').first();
    await expect(nativeLinks.getByRole('link', {name: 'Same page', exact: true})).toHaveAttribute('target', '_self');
    await expect(nativeLinks.getByRole('link', {name: 'New page', exact: true})).toHaveAttribute('rel', 'nofollow noopener noreferrer');
    await nativeLinks.getByRole('link', {name: 'Same page', exact: true}).click();
    await expect(nativeLinks.locator('p')).toHaveText('Target opened');

    await page.evaluate(() => window.setHtmlCase('<div align="center">你好</div><p align="right">Native alignment</p>', { enableJavaScript: true }));
    await expect(page.frameLocator('iframe').first().locator('div')).toHaveCSS('text-align', /center$/);
    await expect(page.frameLocator('iframe').first().locator('p')).toHaveCSS('text-align', /right$/);

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
    console.log(`PASS ${width}px: P0 nesting, block alignment and text position, keyboard, bindings, 7 HTML option combinations, CSS classes, body events, isolated form/base, scoped IDs/IDREFs, image policy, frame isolation, mode reset and overflow`);
  }
} finally {
  await browser?.close();
  await server.close();
}
