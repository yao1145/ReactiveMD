import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// The fixture imports the package's `react/minimal` subpath, which resolves to
// `dist-library`. Fail early instead of launching a browser against a partial
// build.
const root = fileURLToPath(new URL('..', import.meta.url));
for (const file of ['dist-library/reactive-md-react-minimal.js', 'dist-library/reactive-md.css']) {
  assert.ok(existsSync(join(root, file)), `Missing ${file}; run npm run build:lib first.`);
}

const server = await createServer({
  root,
  configFile: false,
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { exclude: ['reactive-md', 'reactive-md/react/minimal'] },
});
let browser;
try {
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tests/browser/streaming-source-fixture.html`);

  const documentRoot = page.locator('#document');
  const article = documentRoot.locator('article');
  const renders = async () => Number(await page.locator('#renders').textContent());
  const probe = async () => page.evaluate(() => window.streamingProbe);

  // 1. An unfinished component/interpolation snapshot stays readable, static
  // and free of fatal errors. The provisional damage travels only on the
  // transient channel.
  await expect(article).toHaveAttribute('data-render-mode', 'static');
  await expect(article.locator('[data-local-fallback]').first()).toContainText('<panel');
  await expect(article).toContainText('Amount:');
  await expect(article.locator('.local-inactive')).toHaveCount(0);
  await expect(documentRoot.locator('.local-number input')).toHaveCount(0);
  await expect(page.locator('#transient-calls')).toHaveText('1');
  await expect(page.locator('#transient-last')).toContainText('local.tag.unclosed');
  const initialRenders = await renders();
  assert.ok(initialRenders >= 2, `StrictMode replays the first render; saw ${initialRenders}`);
  let observed = await probe();
  assert.ok(observed.transientCodes[0].includes('local.tag.unclosed'), JSON.stringify(observed.transientCodes));
  assert.ok(observed.diagnosticsCalls >= 1, 'onDiagnostics must still run');
  assert.ok(observed.diagnosticsCodes.every((codes) => !codes.includes('local.tag.unclosed')),
    `transient codes leaked into onDiagnostics: ${JSON.stringify(observed.diagnosticsCodes)}`);
  console.log('PASS streaming snapshot renders a readable static fallback and reports transient diagnostics separately');

  // 2. The completed snapshot restores interaction and retracts the provisional
  // report exactly once.
  await page.evaluate(() => window.streamingHarness.finish());
  await expect(article).toHaveAttribute('data-render-mode', 'interactive');
  const amount = documentRoot.getByLabel('Amount', { exact: true });
  await expect(amount).toHaveValue('2');
  await expect(article.locator('.local-interpolation').first()).toHaveText('2');
  await expect(page.locator('#transient-calls')).toHaveText('2');
  await expect(page.locator('#transient-last')).toHaveText('none');
  const finalRenders = await renders();
  assert.ok(finalRenders > initialRenders, `phase transition re-rendered ${initialRenders} -> ${finalRenders}`);
  await amount.fill('7');
  await amount.blur();
  await expect(article.locator('.local-interpolation').first()).toHaveText('7');
  await expect(page.locator('#parameters')).toContainText('"amount":7');
  observed = await probe();
  assert.deepEqual(observed.transientCodes, [['local.tag.unclosed'], []]);
  console.log('PASS final snapshot restores interaction, retracts transient diagnostics once and publishes the typed value');

  // 3. A later streaming round keeps the runtime value while the document is
  // read-only again.
  await page.evaluate(() => window.streamingHarness.extend());
  await expect(page.locator('#phase')).toHaveText('streaming');
  await expect(article).toHaveAttribute('data-render-mode', 'static');
  await expect(article.locator('.local-number .local-static-value')).toHaveText('7');
  await expect(article.locator('.local-interpolation').first()).toHaveText('7');
  await expect(article.locator('[data-local-fallback]').last()).toContainText('Still writing');
  await expect(page.locator('#transient-calls')).toHaveText('3');
  await expect(page.locator('#transient-last')).toContainText('local.tag.unclosed');
  console.log('PASS a live streaming transition preserves the control value in static mode');

  // 4. Cancellation: an older streaming snapshot is delivered after the newer
  // final snapshot. The host discards it; the finished document and its value
  // stay untouched and no extra render or callback occurs.
  await page.evaluate(() => window.streamingHarness.queueStale());
  await page.evaluate(() => window.streamingHarness.finishExtended());
  await expect(page.locator('#phase')).toHaveText('final');
  await expect(article).toHaveAttribute('data-render-mode', 'interactive');
  await expect(documentRoot.getByLabel('Amount', { exact: true })).toHaveValue('7');
  await expect(article.locator('.local-interpolation').first()).toHaveText('7');
  await expect(article).toContainText('Finished');
  await expect(page.locator('#transient-calls')).toHaveText('4');
  await expect(page.locator('#transient-last')).toHaveText('none');
  const settledRenders = await renders();
  await expect(page.locator('#stale')).toHaveText('1');
  assert.equal(await renders(), settledRenders, 'a discarded late snapshot must not re-render the document');
  await expect(documentRoot.getByLabel('Amount', { exact: true })).toHaveValue('7');
  await expect(page.locator('#transient-calls')).toHaveText('4');
  observed = await probe();
  assert.equal(observed.transientCodes.length, 4);
  assert.deepEqual(observed.transientCodes[0], ['local.tag.unclosed']);
  assert.deepEqual(observed.transientCodes[1], []);
  assert.ok(observed.transientCodes[2].length > 0, 'the extended streaming snapshot must report provisional diagnostics');
  assert.deepEqual(observed.transientCodes[3], []);
  const transientSeen = new Set(observed.transientCodes.flat());
  assert.ok(transientSeen.size > 0);
  assert.ok(observed.diagnosticsCodes.every((codes) => codes.every((code) => !transientSeen.has(code))),
    `transient codes leaked into onDiagnostics: ${JSON.stringify(observed.diagnosticsCodes)}`);
  console.log('PASS the newer final snapshot survives a late streaming snapshot without extra work');

  // 5. Replacing both source and documentId adopts a fresh runtime: the old
  // value does not migrate and the new document renders its own initial value.
  await page.evaluate(() => window.streamingHarness.replace());
  await expect(page.locator('#doc')).toHaveText('second');
  await expect(article).toHaveAttribute('data-render-mode', 'interactive');
  await expect(documentRoot.getByLabel('Revised amount', { exact: true })).toHaveValue('1');
  await expect(article.locator('.local-interpolation').first()).toHaveText('1');
  await expect(documentRoot.getByLabel('Amount', { exact: true })).toHaveCount(0);
  await expect(page.locator('#transient-calls')).toHaveText('4');
  console.log('PASS a new documentId and source replace the runtime without leaking the old value');

  // 6. Unmount releases the document and leaves the callback probes untouched.
  const beforeUnmount = await probe();
  await page.evaluate(() => window.streamingHarness.unmount());
  await expect(documentRoot.locator('article')).toHaveCount(0);
  await page.waitForTimeout(120);
  const afterUnmount = await probe();
  assert.equal(afterUnmount.transientCalls, beforeUnmount.transientCalls);
  assert.equal(afterUnmount.diagnosticsCalls, beforeUnmount.diagnosticsCalls);
  assert.equal(afterUnmount.visible, false);
  assert.deepEqual(errors, []);
  console.log(`PASS unmount cleanup is quiet after ${afterUnmount.renders} StrictMode renders`);
  console.log('PASS streaming source browser acceptance');
} finally {
  await browser?.close();
  await server.close();
}