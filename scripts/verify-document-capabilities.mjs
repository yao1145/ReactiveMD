import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const policy = (enableCss, enableJavaScript, enableExtendedHtml) => ({ enableCss, enableJavaScript, enableExtendedHtml });
const fixture = 'tests/fixtures/document-capabilities-browser.html';
const server = await createServer({
  configFile: false,
  optimizeDeps: {
    entries: [fixture],
    include: ['@jitl/quickjs-singlefile-browser-release-sync', 'quickjs-emscripten-core'],
  },
  server: { host: '127.0.0.1', port: 0, watch: null },
});
const scratch = await mkdtemp(join(tmpdir(), 'rmd-capabilities-'));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage();
  const url = server.resolvedUrls.local[0];
  page.on('pageerror', error => console.error(error.message));
  await page.goto(new URL(fixture, url).href);
  await page.waitForFunction(() => window.rmdCapabilities);

  async function value(scope, expected) {
    try {
      await page.locator(scope).getByText(`People: ${expected}`, { exact: true }).waitFor({ timeout: 12_000 });
    } catch (error) {
      console.error(await page.evaluate(() => ({ diagnostics: window.rmdCapabilities?.diagnostics, text: document.body.textContent?.slice(0, 500) })));
      throw error;
    }
    assert.equal(await page.locator(scope).getByRole('slider').getAttribute('aria-valuenow'), String(expected));
  }

  for (let index = 0; index < 8; index++) {
    const options = policy(Boolean(index & 1), Boolean(index & 2), Boolean(index & 4));
    await page.evaluate(([options, key]) => window.rmdCapabilities.render(options, key), [options, String(index)]);
    const initial = options.enableJavaScript ? 10 : 2;
    await value('#root', initial);
    const headingColor = await page.getByRole('heading', { name: 'People' }).evaluate(node => getComputedStyle(node).color);
    assert.equal(headingColor === 'rgb(36, 84, 154)', options.enableCss);
    const inline = await page.locator('.local-slider').evaluate(node => node.style.maxWidth);
    assert.equal(inline, options.enableCss ? '24rem' : '');
    if (options.enableCss) {
      assert.equal(await page.locator('.local-slider').evaluate(node => getComputedStyle(node).marginLeft), '3px');
    }
    assert.equal(await page.locator('#root iframe').count() > 0, options.enableExtendedHtml);
    if (options.enableExtendedHtml) {
      assert.equal(await page.locator('#root dl').getByText('Example term').count(), 1);
      await page.waitForFunction(() => Array.from(document.querySelectorAll('iframe[srcdoc]'))
        .some(frame => frame.getAttribute('srcdoc').includes('Embedded example')));
    } else {
      assert.match(await page.locator('[data-local-fallback]').first().textContent(), /<iframe/);
    }
    const slider = page.getByRole('slider');
    for (let step = initial; step < 12; step++) await slider.press('ArrowRight');
    await value('#root', 12);
  }

  // This rerender uses the existing public source view and its live runtime.
  await page.evaluate(options => window.rmdCapabilities.render(options, '7'), policy(false, false, true));
  await page.locator('[data-rmd-author-css]').waitFor({ state: 'detached' });
  await value('#root', 12);
  await page.evaluate(options => window.rmdCapabilities.render(options, '7'), policy(false, false, false));
  await page.locator('#root iframe').waitFor({ state: 'detached' });
  await value('#root', 12);

  await page.evaluate((options) => {
    const Worker = window.Worker;
    const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage');
    window.Worker = new Proxy(Worker, {
      construct(ctor, args) {
        const instance = Reflect.construct(ctor, args);
        const terminate = instance.terminate.bind(instance);
        instance.terminate = () => {
          window.rmdRevocationObserved = true;
          terminate();
        };
        Object.defineProperty(instance, 'onmessage', { set(listener) {
          descriptor.set.call(instance, event => {
            if (event.data.kind === 'request' && event.data.request.operation === 'set') {
              window.rmdReplyAfterRevoke = () => listener.call(instance, event);
              return;
            }
            listener.call(instance, event);
          });
        }});
        return instance;
      },
    });
    window.rmdRestoreWorker = () => { window.Worker = Worker; };
    window.rmdCapabilities.render(options, 'late-write');
  }, policy(false, true, false));
  await page.waitForFunction(() => window.rmdReplyAfterRevoke);
  for (let step = 2; step < 12; step++) await page.getByRole('slider').press('ArrowRight');
  await value('#root', 12);
  await page.evaluate(options => window.rmdCapabilities.render(options, 'late-write'), policy(false, false, false));
  await page.waitForFunction(() => window.rmdRevocationObserved === true);
  await value('#root', 12);
  await page.evaluate(() => {
    window.rmdReplyAfterRevoke();
    window.rmdRestoreWorker();
  });
  await value('#root', 12);

  await page.evaluate(() => {
    const Worker = window.Worker;
    window.Worker = new Proxy(Worker, {
      construct(ctor, args) {
        const worker = Reflect.construct(ctor, args);
        worker.addEventListener('message', ({ data }) => {
          if (data.kind === 'request') window.rmdPausedRequestObserved = true;
        });
        return worker;
      },
    });
    window.rmdRestoreWorker = () => { window.Worker = Worker; };
    window.rmdCapabilities.pausedView(true);
  });
  await page.waitForFunction(() => window.rmdPausedRequestObserved);
  await value('#paused-view', 2);
  await page.evaluate(() => {
    window.rmdRestoreWorker();
    window.rmdCapabilities.pausedView(false);
  });
  await value('#paused-view', 10);

  await page.evaluate(() => window.rmdCapabilities.twoViews(true));
  await value('#allowed', 10);
  await value('#denied', 2);
  await page.evaluate(() => window.rmdCapabilities.twoViews(false));
  await page.locator('#allowed').getByRole('slider').press('ArrowRight');
  await value('#allowed', 11);
  await value('#denied', 2);

  await page.evaluate(() => window.rmdCapabilities.actions(true));
  const increments = page.getByRole('button', { name: 'First increase' });
  // Wait for initialization to register the handler, using a neutral reset
  // between retries so a mount that cannot initialize never satisfies this.
  await increments.waitFor();
  await page.waitForFunction(() => !window.rmdCapabilities.diagnostics.some(message => message.includes('worker')));
  let claimed = false;
  for (let attempt = 0; attempt < 20 && !claimed; attempt++) {
    await increments.click();
    try {
      await page.getByText('Counters: 4 and 5', { exact: true }).waitFor({ timeout: 300 });
      claimed = true;
    } catch {
      await page.getByRole('group', { name: 'First' }).getByRole('button', { name: 'Reset' }).click();
    }
  }
  assert.equal(claimed, true, 'only the claimed action should run, once');
  await page.getByRole('button', { name: 'Second increase' }).click();
  await page.getByText('Counters: 4 and 6', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'First decrease' }).click();
  await page.getByText('Counters: 3 and 6', { exact: true }).waitFor();
  await page.evaluate(() => window.rmdCapabilities.actions(true, 'add'));
  await page.getByRole('button', { name: 'Third increase' }).waitFor();
  await increments.click();
  await page.getByText('Counters: 5 and 6', { exact: true }).waitFor();
  await page.evaluate(() => window.rmdCapabilities.actions(true, 'remove'));
  await page.getByRole('button', { name: 'Third increase' }).waitFor({ state: 'detached' });
  await increments.click();
  await page.getByText('Counters: 6 and 6', { exact: true }).waitFor();
  await page.evaluate(() => window.rmdCapabilities.actions(true, 'restore'));
  await page.getByText('Original action restored.', { exact: true }).waitFor();
  await increments.click();
  await page.getByText('Counters: 8 and 6', { exact: true }).waitFor();
  await page.evaluate(() => window.rmdCapabilities.actions(false));
  await increments.click();
  await page.getByText('Counters: 9 and 6', { exact: true }).waitFor();

  await page.evaluate(() => window.rmdCapabilities.nested());
  const nested = page.getByRole('heading', { name: 'Inner' });
  await nested.waitFor();
  const computed = await nested.evaluate(node => {
    const style = getComputedStyle(node);
    return { custom: style.getPropertyValue('--outer-accent').trim(), background: style.backgroundColor };
  });
  assert.deepEqual(computed, { custom: 'violet', background: 'rgba(0, 0, 0, 0)' });
  const nestedRoot = page.locator('#nested-document article');
  assert.equal(await nestedRoot.evaluate(node => getComputedStyle(node).color), 'rgb(21, 44, 79)');
  assert.equal(await nestedRoot.evaluate(node => getComputedStyle(node).fontFamily), 'monospace');

  for (const mode of ['static', 'interactive']) {
    const options = policy(true, true, true);
    const html = await page.evaluate(([options, mode]) => window.rmdCapabilities.exportHtml(options, 7, mode), [options, mode]);
    const file = join(scratch, `${mode}.html`);
    await writeFile(file, html);
    const reopened = await browser.newPage({ offline: true });
    const errors = [];
    reopened.on('pageerror', error => errors.push(error.message));
    try {
      await reopened.goto(pathToFileURL(file).href);
      await reopened.getByText(`People: ${mode === 'interactive' ? 10 : 7}`, { exact: true }).waitFor({ timeout: 12_000 });
      if (mode === 'interactive') {
        await reopened.getByRole('slider').press('ArrowRight');
        await reopened.getByText('People: 11', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      assert.equal(await reopened.locator('iframe').count() > 0, true);
      assert.equal(await reopened.getByText('Example term', { exact: true }).count(), 1);
      assert.equal(await reopened.locator('.local-slider').evaluate(element => getComputedStyle(element).marginLeft), '3px');
    } finally {
      await reopened.close();
    }
  }
  for (const nativeCss of [false, true]) {
    const file = join(scratch, nativeCss ? 'legacy-css.html' : 'legacy-rmd.html');
    await writeFile(file, await page.evaluate(nativeCss => window.rmdCapabilities.legacyExport(nativeCss), nativeCss));
    const reopened = await browser.newPage({ offline: true });
    try {
      await reopened.goto(pathToFileURL(file).href);
      if (nativeCss) {
        await reopened.locator('iframe.reactive-md-native-frame').waitFor();
        await reopened.frameLocator('iframe.reactive-md-native-frame').getByText('Legacy content', { exact: true }).waitFor();
        assert.equal(await reopened.getByRole('slider').count(), 0);
      } else {
        await reopened.getByText('People: 7', { exact: true }).waitFor();
        assert.equal(await reopened.locator('iframe').count(), 0);
      }
    } finally {
      await reopened.close();
    }
  }
  console.log('Verified eight capability combinations, public React state, mount grants, actions, CSS inheritance and offline HTML exports.');
} finally {
  await browser?.close();
  await server.close();
  await Promise.all(['static.html', 'interactive.html', 'legacy-css.html', 'legacy-rmd.html']
    .map(name => unlink(join(scratch, name)).catch(() => {})));
  await rmdir(scratch);
}
