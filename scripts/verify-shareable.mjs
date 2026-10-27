import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin', 'reactive-md.mjs');
const standalone = path.join(root, 'dist-standalone', 'reactive-md-standalone.js');
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';

const DOCUMENT_SOURCE = `# Shareable acceptance

<panel title="Settings" reset="true">
<input bind="name" label="Name" initial="Ada">
<slider bind="people" label="People" initial="2" min="1" max="20">
</panel>

Hello **{{ name }}**, {{ people }} people.

<if when="{{ people >= 5 }}">
The group is large enough.
</if>

![Pixel](media/pixel.png)

Inline math: $x^2 + \\frac{a}{b}$ and chemistry $\\ce{H2O}$.

$$\\Gamma=\\oint_{\\partial S}\\mathbf{v}\\times d\\mathbf{l}=\\iint_S\\omega\\,dA$$
`;

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function assertExit(result, expected, label) {
  assert.equal(
    result.code,
    expected,
    `${label} exited ${result.code}, expected ${expected}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
}

function fileUrl(file) {
  return pathToFileURL(file).href;
}

async function makeState(temp) {
  const core = await import(pathToFileURL(path.join(root, 'dist-library', 'reactive-md.js')).href);
  const compiled = core.compileLocal(DOCUMENT_SOURCE);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const runtime = core.createLocalRuntime(compiled.document);
  try {
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.type === 'component' && node.name === 'input') {
          runtime.set(node, 'Grace');
        }
        if (node.type === 'component' && node.name === 'slider') {
          runtime.set(node, 7);
        }
        if (node.children) walk(node.children);
      }
    };
    walk(compiled.document.nodes);
    const state = core.createLocalStateFile(compiled.document, runtime.snapshot().state, {
      name: 'shareable-verification',
      version: '1',
    });
    const file = path.join(temp, 'selection.state.json');
    await writeFile(file, core.serializeLocalState(state), 'utf8');
    return file;
  } finally {
    runtime.dispose();
  }
}

async function browserChecks(temp) {
  const browser = await chromium.launch({
    ...(channel === 'chromium' ? {} : { channel }),
    headless: true,
  });
  const checks = [];
  const errors = [];
  const consoleErrors = [];
  const network = [];

  const attach = (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) network.push(request.url());
    });
  };

  const check = async (name, action) => {
    await action();
    checks.push(name);
    console.log(`PASS ${name}`);
  };

  try {
    const interactive = path.join(temp, 'interactive.html');
    const dark = path.join(temp, 'dark.html');
    const shared = path.join(temp, 'shared.html');
    const staticFile = path.join(temp, 'static.html');

    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    attach(page);

    await check('interactive file:// hydrates without console errors', async () => {
      await page.goto(fileUrl(interactive));
      await page.locator('input').first().waitFor({ timeout: 15000 });
      await expect(page.locator('.local-document')).toHaveAttribute('data-render-mode', 'interactive');
      assert.equal(await page.locator('.local-slider .md-slider-value').innerText(), '2');
      const image = page.locator('img.md-image');
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    });

    await check('offline math includes KaTeX layout, accessible MathML and loaded fonts', async () => {
      await expect(page.locator('.local-math .katex-html')).toHaveCount(3);
      await expect(page.locator('.local-math .katex-mathml math')).toHaveCount(3);
      assert.equal(await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(font => font.family.includes('KaTeX_Main') && font.status === 'loaded')
          && [...document.fonts].some(font => font.family.includes('KaTeX_Math') && font.status === 'loaded');
      }), true);
    });

    await check('runtime updates expressions and conditional content', async () => {
      const slider = page.getByRole('slider', { name: 'People', exact: true });
      await slider.focus();
      await slider.press('End');
      await page.getByText('The group is large enough.', { exact: true }).waitFor();
      assert.match(await page.locator('.local-document').innerText(), /20 people/);
      await page.getByRole('button', { name: 'Reset Settings', exact: true }).click();
      await expect(page.locator('.local-slider .md-slider-value')).toHaveText('2');
    });

    await check('refresh restores the exported baseline', async () => {
      const slider = page.getByRole('slider', { name: 'People', exact: true });
      await slider.focus();
      await slider.press('End');
      await page.reload();
      await page.locator('input').first().waitFor();
      assert.equal(await page.locator('.local-slider .md-slider-value').innerText(), '2');
    });

    await check('print output hides controls, reveals current values and forces paper colors', async () => {
      await page.goto(fileUrl(dark));
      await page.locator('input').first().waitFor();
      const slider = page.getByRole('slider', { name: 'People', exact: true });
      await slider.focus();
      await slider.press('End');
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('.local-slider input').evaluate((element) => getComputedStyle(element).display), 'none');
      assert.notEqual(await page.locator('.local-print-value').first().evaluate((element) => getComputedStyle(element).display), 'none');
      const article = await page.locator('.local-document').evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      });
      assert.equal(article.background, 'rgb(255, 255, 255)');
      assert.notEqual(article.color, 'rgb(255, 255, 255)');
      await page.emulateMedia({ media: 'screen' });
    });

    await check('a shared state file is applied as the reset baseline', async () => {
      await page.goto(fileUrl(shared));
      await page.locator('input').first().waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Grace');
      assert.equal(await page.locator('.local-slider .md-slider-value').innerText(), '7');
      const slider = page.getByRole('slider', { name: 'People', exact: true });
      await slider.focus();
      await slider.press('End');
      await page.getByRole('button', { name: 'Reset Settings', exact: true }).click();
      await expect(page.locator('.local-slider .md-slider-value')).toHaveText('7');
      await page.reload();
      await page.locator('input').first().waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Grace');
    });

    await check('the interactive file has no external requests', async () => {
      assert.deepEqual(network, []);
    });

    await context.close();

    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJs.newPage();
    attach(noJsPage);
    await check('interactive HTML without JavaScript stays a readable static document', async () => {
      await noJsPage.goto(fileUrl(interactive));
      assert.equal(await noJsPage.locator('input').count(), 0);
      assert.equal(await noJsPage.locator('.local-static').count(), 1);
      assert.match(await noJsPage.locator('.local-document').innerText(), /Ada/);
      assert.match(await noJsPage.locator('.local-document').innerText(), /2 people/);
    });
    await check('static HTML without JavaScript has no controls or runtime payload', async () => {
      await noJsPage.goto(fileUrl(staticFile));
      assert.equal(await noJsPage.locator('input, button, select, textarea').count(), 0);
      assert.equal(await noJsPage.locator('.local-static').count(), 1);
      const html = await readFile(staticFile, 'utf8');
      assert.equal(/<script\b/.test(html), false);
      assert.equal(html.includes('application/reactive-md+json'), false);
      assert.match(await noJsPage.locator('.local-document').innerText(), /Ada/);
      await expect(noJsPage.locator('.local-math .katex-html')).toHaveCount(3);
      assert.equal(await noJsPage.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(font => font.family.includes('KaTeX_Main') && font.status === 'loaded');
      }), true);
    });
    await noJs.close();

    await check('Web Component and mount API work from one standalone file', async () => {
      const runtime = await readFile(standalone, 'utf8');
      const componentHtml = `<!doctype html><meta charset="utf-8">
<reactive-md-doc id="wc" locale="en"></reactive-md-doc>
<div id="manual"></div>
<script>${runtime.replace(/<\/script/gi, '<\\/script')}</script>
<script>
const wc = document.getElementById('wc');
window.__states = [];
wc.addEventListener('reactive-md-state-change', (event) => window.__states.push(event.detail.parameters));
wc.source = '<slider bind="n" label="Count" initial="2" min="0" max="10">\\n\\nValue: {{ n }}';
const handle = ReactiveMD.mount(document.getElementById('manual'), {
  source: '<input bind="name" label="Name" initial="Standalone">'
});
window.__handle = handle;
</script>`;
      const componentFile = path.join(temp, 'component.html');
      await writeFile(componentFile, componentHtml, 'utf8');
      const page2 = await browser.newPage();
      attach(page2);
      await page2.goto(fileUrl(componentFile));
      await page2.locator('reactive-md-doc input').waitFor({ timeout: 15000 });
      assert.equal(await page2.locator('reactive-md-doc input').inputValue(), '2');
      assert.equal(await page2.locator('#manual input').inputValue(), 'Standalone');
      const state = await page2.evaluate(() => window.__handle.getState());
      assert.equal(state.format, 'reactive-md-state/v1');
      assert.equal(state.parameters.name, 'Standalone');
      await page2.evaluate(() => window.__handle.unmount());
      assert.equal(await page2.locator('reactive-md-doc input').count(), 1);
      await page2.close();
    });

    assert.deepEqual(errors, [], `Browser page errors: ${errors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(network, [], `Unexpected network requests: ${network.join(' | ')}`);
    return { checks, errors, consoleErrors, network };
  } finally {
    await browser.close();
  }
}

async function securityChecks(temp) {
  const outside = path.join(temp, 'outside.png');
  await writeFile(outside, PIXEL);
  const media = path.join(temp, 'media');
  await mkdir(media, { recursive: true });

  const remoteDoc = path.join(temp, 'remote.reactive.md');
  await writeFile(remoteDoc, '![Remote](https://example.com/a.png)\n', 'utf8');
  assertExit(run(['build', remoteDoc, '-o', path.join(temp, 'remote.html')]), 5, 'remote image');

  const traversalDoc = path.join(temp, 'nested', 'traversal.reactive.md');
  await mkdir(path.dirname(traversalDoc), { recursive: true });
  await writeFile(traversalDoc, '![Escape](../outside.png)\n', 'utf8');
  assertExit(run(['build', traversalDoc, '-o', path.join(temp, 'traversal.html')]), 5, 'path traversal');

  const svgPath = path.join(media, 'vector.svg');
  await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  const svgDoc = path.join(temp, 'svg.reactive.md');
  await writeFile(svgDoc, '![Vector](media/vector.svg)\n', 'utf8');
  assertExit(run(['build', svgDoc, '-o', path.join(temp, 'svg.html')]), 5, 'svg image');

  const forgedPath = path.join(media, 'forged.png');
  await writeFile(forgedPath, 'not an image', 'utf8');
  const forgedDoc = path.join(temp, 'forged.reactive.md');
  await writeFile(forgedDoc, '![Forged](media/forged.png)\n', 'utf8');
  assertExit(run(['build', forgedDoc, '-o', path.join(temp, 'forged.html')]), 5, 'forged image');

  const sharedDoc = path.join(temp, 'mismatch.reactive.md');
  await writeFile(sharedDoc, '# Different\n', 'utf8');
  assertExit(run([
    'build', sharedDoc, '-o', path.join(temp, 'mismatch.html'),
    '--state-file', path.join(temp, 'selection.state.json'),
  ]), 3, 'state mismatch');

  const injectionDoc = path.join(temp, 'injection.reactive.md');
  await writeFile(
    injectionDoc,
    '# Injection\n\nLiteral `</script><script>window.__pwned = true</script>` text.\n',
    'utf8',
  );
  const injected = path.join(temp, 'injection.html');
  assertExit(run(['build', injectionDoc, '-o', injected]), 0, 'script-payload injection build');
  const injectedHtml = await readFile(injected, 'utf8');
  assert.ok(injectedHtml.includes('\\u003c/script'), 'Inline JSON must escape closing script tags');
  assert.ok(
    !injectedHtml.includes('</script><script>window.__pwned'),
    'Document text must not close the runtime script element',
  );

  const badDoc = path.join(temp, 'bad.reactive.md');
  await writeFile(badDoc, '<slider bind="n">\n', 'utf8');
  const lint = run(['lint', badDoc, '--json']);
  assertExit(lint, 1, 'lint invalid document');
  const report = JSON.parse(lint.stdout);
  assert.equal(report[0].ok, false);
  assert.ok(report[0].diagnostics.length > 0);
}

async function sizeBaseline() {
  const [js, css] = await Promise.all([
    readFile(standalone),
    readFile(path.join(root, 'dist-standalone', 'reactive-md-standalone.css')),
  ]);
  const sizes = {
    js: js.byteLength,
    jsGzip: gzipSync(js).byteLength,
    css: css.byteLength,
    cssGzip: gzipSync(css).byteLength,
  };
  console.log(`Standalone size: ${sizes.js} B (${sizes.jsGzip} B gzip), CSS ${sizes.css} B (${sizes.cssGzip} B gzip)`);
  // Includes ELK/highlighting, KaTeX + mhchem, and 20 inlined WOFF2 fonts.
  // The KaTeX migration measures about 2.88/0.87 MB JS and 0.45/0.28 MB CSS
  // (raw/gzip). Keep roughly 10% headroom for regressions.
  assert.ok(sizes.js <= 3 * 1024 * 1024, `Standalone JS grew beyond the 3 MiB alarm: ${sizes.js}`);
  assert.ok(sizes.jsGzip <= 950 * 1024, `Standalone JS gzip grew beyond the 950 KiB alarm: ${sizes.jsGzip}`);
  assert.ok(sizes.css <= 480 * 1024, `Standalone CSS grew beyond the 480 KiB alarm: ${sizes.css}`);
  assert.ok(sizes.cssGzip <= 300 * 1024, `Standalone CSS gzip grew beyond the 300 KiB alarm: ${sizes.cssGzip}`);
  return sizes;
}

let temp;
try {
  temp = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-shareable-'));
  const media = path.join(temp, 'media');
  await mkdir(media, { recursive: true });
  await writeFile(path.join(media, 'pixel.png'), PIXEL);
  const document = path.join(temp, 'acceptance.reactive.md');
  await writeFile(document, DOCUMENT_SOURCE, 'utf8');
  const stateFile = await makeState(temp);

  const interactive = path.join(temp, 'interactive.html');
  const staticFile = path.join(temp, 'static.html');
  const dark = path.join(temp, 'dark.html');
  const shared = path.join(temp, 'shared.html');
  const omit = path.join(temp, 'omit.html');

  assertExit(run(['build', document, '-o', interactive]), 0, 'interactive build');
  assertExit(run(['build', document, '-o', staticFile, '--mode', 'static']), 0, 'static build');
  assertExit(run(['build', document, '-o', dark, '--color-scheme', 'dark']), 0, 'dark build');
  assertExit(run(['build', document, '-o', shared, '--state-file', stateFile]), 0, 'state build');
  assertExit(run(['build', document, '-o', omit, '--assets', 'omit']), 0, 'omit build');

  const requiredDocument = path.join(temp, 'required.reactive.md');
  await writeFile(requiredDocument, [
    '<input bind="name" label="Name" required="true">',
    '<textarea bind="notes" label="Notes" required="true">',
    '<date bind="date" label="Date" required="true">',
  ].join('\n'), 'utf8');
  for (const mode of ['interactive', 'static']) {
    assertExit(run([
      'build', requiredDocument, '-o', path.join(temp, `required-${mode}.html`), '--mode', mode,
    ]), 0, `empty required defaults (${mode})`);
  }

  const interactiveHtml = await readFile(interactive, 'utf8');
  const staticHtml = await readFile(staticFile, 'utf8');
  const omitHtml = await readFile(omit, 'utf8');
  assert.match(interactiveHtml, /data-render-mode="static"/);
  assert.match(interactiveHtml, /application\/reactive-md\+json/);
  assert.match(interactiveHtml, /data:image\/png;base64,/);
  assert.ok(staticHtml.includes('data:image/png;base64,'));
  assert.equal(/<script\b/.test(staticHtml), false);
  assert.equal(staticHtml.includes('application/reactive-md+json'), false);
  assert.match(omitHtml, /Unsafe image rejected[\s\S]{0,80}Pixel/);

  await securityChecks(temp);
  const browser = await browserChecks(temp);
  const sizes = await sizeBaseline();
  if (process.env.SHAREABLE_RESULTS) {
    await mkdir(path.dirname(process.env.SHAREABLE_RESULTS), { recursive: true });
    await writeFile(process.env.SHAREABLE_RESULTS, JSON.stringify({
      checks: browser.checks,
      errors: browser.errors,
      consoleErrors: browser.consoleErrors,
      network: browser.network,
      sizes,
    }, null, 2));
  }
  console.log('PASS shareable export acceptance');
} finally {
  if (temp) {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('reactive-md-shareable-'));
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
