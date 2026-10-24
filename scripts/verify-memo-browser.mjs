import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const harnessRoot = fileURLToPath(new URL('./verify-memo-browser/', import.meta.url));
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * The page returns already-normalized markup: ids and id-reference attributes
 * are stripped, live form-control state is written back into the serialization,
 * and attributes are sorted (React's attribute insertion order reflects update
 * history, not UI). Everything else is compared byte for byte here.
 */
function firstDifference(a, b) {
  const limit = Math.min(a.length, b.length);
  for (let offset = 0; offset < limit; offset += 1) {
    if (a[offset] !== b[offset]) return offset;
  }
  return a.length === b.length ? -1 : limit;
}

function excerpt(value, offset) {
  return JSON.stringify(value.slice(offset, offset + 400));
}

async function main() {
  const server = await createServer({
    configFile: false,
    root: harnessRoot,
    plugins: [react()],
    optimizeDeps: { exclude: ['reactive-md', 'reactive-md/react'] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [projectRoot] } },
    logLevel: 'error',
  });

  let browser;
  let failed = false;
  try {
    await server.listen();
    const baseURL = server.resolvedUrls?.local?.[0] ?? null;
    assert.ok(baseURL, 'Vite dev server did not report a local URL');
    browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
      colorScheme: 'light',
    });
    page.setDefaultTimeout(180_000);

    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });

    await page.goto(new URL('index.html', baseURL).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.memoVerify?.ready === true);
    const result = await page.evaluate(() => window.memoVerify.run());

    assert.equal(
      result.statesEqual,
      true,
      'runtime state after replay differs from view A; the write sequence was not reproduced',
    );

    const normalizedA = result.htmlA;
    const normalizedB = result.htmlB;
    const offset = firstDifference(normalizedA, normalizedB);

    console.log(`source: ${result.sourceCharacters} characters, ${result.steps} steps`);
    console.log(
      `operations: set=${result.operations.set} no-op=${result.operations.noop} ` +
        `reset=${result.operations.reset} locale=${result.operations.locale} tab=${result.operations.tab}`,
    );
    console.log(
      `final locale: ${result.finalLocale}; final revision: ${result.finalRevision}; state equal: ${result.statesEqual}`,
    );
    console.log(
      `latency (median / p95 over 30 writes): z=${result.latency.z.medianMs}ms / ${result.latency.z.p95Ms}ms, ` +
        `n=${result.latency.n.medianMs}ms / ${result.latency.n.p95Ms}ms`,
    );
    console.log(`normalized markup: A=${normalizedA.length} chars, B=${normalizedB.length} chars`);

    if (offset !== -1) {
      failed = true;
      console.error(`FAIL memo equivalence: first difference at normalized offset ${offset}`);
      console.error(`--- A (offset ${offset}) ---`);
      console.error(excerpt(normalizedA, offset));
      console.error(`--- B (offset ${offset}) ---`);
      console.error(excerpt(normalizedB, offset));
    } else {
      console.log(`PASS memo equivalence: A and B markup match byte for byte (${normalizedA.length} chars)`);
    }

    if (browserErrors.length > 0) {
      failed = true;
      console.error(`FAIL browser errors (${browserErrors.length}):`);
      for (const error of browserErrors) console.error(`  ${error}`);
    } else {
      console.log('PASS zero console errors and page errors');
    }
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    await browser?.close();
    await server.close();
  }

  if (failed) process.exitCode = 1;
}

await main();
