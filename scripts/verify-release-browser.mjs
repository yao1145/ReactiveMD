import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

/**
 * Release combination check.
 *
 * One document exercises declarations, computed values, a collection-driven
 * table, a Markdown table, validation, state baselines and reset. The CLI builds
 * it into interactive and static HTML; a Vite page mounts the same source and
 * state through the standalone bundle and through the React renderer so their
 * semantics are compared directly.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin', 'reactive-md.mjs');
const fixture = path.join(root, 'tests', 'browser', 'release-document.reactive.md');
const source = await readFile(fixture, 'utf8');
const baseline = JSON.parse(await readFile(path.join(root, 'tests', 'browser', 'release-baseline.json'), 'utf8'));
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function assertExit(result, expected, label) {
  assert.equal(
    result.code,
    expected,
    `${label} exited ${result.code}, expected ${expected}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const fileUrl = (file) => pathToFileURL(file).href;

async function makeState(temp) {
  const core = await import(pathToFileURL(path.join(root, 'dist-library', 'reactive-md.js')).href);
  const compiled = core.compileLocal(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const runtime = core.createLocalRuntime(compiled.document);
  try {
    assert.deepEqual(runtime.setParameters(baseline), []);
    const file = core.createLocalStateFile(compiled.document, runtime.getParameters(), {
      name: 'release-browser',
      version: '1',
    });
    assert.deepEqual(Object.keys(file.parameters).sort(), ['owner', 'quantity', 'subjects']);
    assert.ok(!Object.keys(file.parameters).some(name => name.startsWith('@')));
    const statePath = path.join(temp, 'release.state.json');
    await writeFile(statePath, core.serializeLocalState(file), 'utf8');
    return statePath;
  } finally {
    runtime.dispose();
  }
}

function payloadFrom(html) {
  const match = html.match(/<script type="application\/reactive-md\+json"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match, 'Interactive HTML is missing the auto-mount payload');
  return JSON.parse(match[1]);
}

async function staticChecks(temp, staticPath, interactivePath, initialPath) {
  const interactiveHtml = await readFile(interactivePath, 'utf8');
  const staticHtml = await readFile(staticPath, 'utf8');
  const initialHtml = await readFile(initialPath, 'utf8');

  assert.ok(interactiveHtml.includes('data-reactive-md-auto'), 'Interactive HTML needs the auto-mount script');
  assert.match(interactiveHtml, /data-render-mode="static"/, 'Interactive HTML needs static-first markup');
  assert.doesNotMatch(staticHtml, /<script\b/, 'Static HTML must not contain a runtime script');
  assert.ok(!staticHtml.includes('application/reactive-md+json'), 'Static HTML must not contain an auto-mount payload');

  const payload = payloadFrom(interactiveHtml);
  assert.equal(payload.source, source, 'The payload must carry the exact document source');
  assert.deepEqual(payload.state.parameters, baseline, 'The payload must carry the selected public state');
  assert.ok(!Object.keys(payload.state.parameters).some(name => name.startsWith('@')), 'Payload state must be public only');
  assert.ok(interactiveHtml.includes('$75.00'), 'Interactive markup must render the state baseline total');
  assert.ok(staticHtml.includes('$75.00'), 'Static markup must render the state baseline total');
  assert.ok(interactiveHtml.includes('physics') && interactiveHtml.includes('chemistry'), 'Interactive markup needs collection rows');
  assert.ok(staticHtml.includes('physics') && staticHtml.includes('chemistry'), 'Static markup needs collection rows');
  assert.ok(initialHtml.includes('$25.00'), 'A build without a state file must use document defaults');
  assert.ok(!initialHtml.includes('$75.00'), 'A build without a state file must not inherit another baseline');
  for (const html of [interactiveHtml, staticHtml]) {
    assert.match(html, /data-local-validation="passed"/, 'Baseline validation must pass in the rendered markup');
    assert.doesNotMatch(html, /data-local-validation="(?:failed|error)"/);
  }

  const overLimit = path.join(temp, 'release-over-limit.json');
  const core = await import(pathToFileURL(path.join(root, 'dist-library', 'reactive-md.js')).href);
  const compiled = core.compileLocal(source);
  assert.equal(compiled.ok, true);
  const file = core.createLocalStateFile(compiled.document, { ...baseline, quantity: 10 }, {
    name: 'release-browser',
    version: '1',
  });
  await writeFile(overLimit, core.serializeLocalState(file), 'utf8');
  const overPath = path.join(temp, 'release-over-limit.html');
  assertExit(run(['build', fixture, '-o', overPath, '--state-file', overLimit]), 0, 'over-limit build');
  const overHtml = await readFile(overPath, 'utf8');
  assert.match(overHtml, /data-local-validation="failed"/, 'Validation must reach exported HTML');

  const lint = run(['lint', '--json', fixture]);
  assertExit(lint, 0, 'release fixture lint');
  const report = JSON.parse(lint.stdout);
  assert.equal(report[0].ok, true);
  assert.deepEqual(report[0].diagnostics, []);
}

async function fileChecks(temp, interactivePath, staticPath) {
  const errors = [];
  const consoleErrors = [];
  const network = [];

  const browser = await chromium.launch({
    ...(channel === 'chromium' ? {} : { channel }),
    headless: true,
  });
  const attach = (page) => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', request => {
      if (/^https?:/i.test(request.url())) network.push(request.url());
    });
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
    try {
      const page = await context.newPage();
      attach(page);
      await page.goto(fileUrl(interactivePath));
      const quantity = page.getByLabel('Quantity', { exact: true });
      await quantity.waitFor({ timeout: 15000 });
      assert.equal(await quantity.inputValue(), '6');
      assert.equal(await page.getByLabel('Owner', { exact: true }).inputValue(), 'Grace');
      assert.equal(await page.getByRole('checkbox', { name: 'Physics', exact: true }).isChecked(), true);
      assert.equal(await page.getByRole('checkbox', { name: 'Chemistry', exact: true }).isChecked(), true);
      assert.equal(await page.getByRole('checkbox', { name: 'Mathematics', exact: true }).isChecked(), false);
      assert.match(await page.locator('.local-document').innerText(), /\$75\.00/);
      assert.equal(await page.getByRole('table', { name: 'Release subjects', exact: true }).locator('tbody tr').count(), 2);
      assert.equal(await page.getByRole('table', { name: 'Release table', exact: true }).locator('tbody tr').count(), 2);

      await quantity.fill('10');
      await quantity.blur();
      await page.getByText('Total $125.00 exceeds the limit.', { exact: true }).first().waitFor();
      assert.match(await page.locator('.local-document').innerText(), /Selected subjects: 2/);
      assert.equal(
        await page.getByRole('table', { name: 'Release subjects', exact: true }).locator('tbody tr').count(),
        2,
      );

      await page.getByRole('checkbox', { name: 'Mathematics', exact: true }).check();
      assert.equal(
        await page.getByRole('table', { name: 'Release subjects', exact: true }).locator('tbody tr').count(),
        3,
      );
      assert.match(await page.locator('.local-document').innerText(), /Selected subjects: 3/);

      await page.getByRole('button', { name: 'Reset Release settings', exact: true }).click();
      await expect(quantity).toHaveValue('6');
      assert.equal(await page.getByRole('checkbox', { name: 'Mathematics', exact: true }).isChecked(), false);
      assert.equal(await page.getByRole('checkbox', { name: 'Physics', exact: true }).isChecked(), true);
      await page.waitForFunction(() => !document.body.innerText.includes('exceeds the limit'));

      await page.reload();
      await page.getByLabel('Quantity', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '6');
      assert.match(await page.locator('.local-document').innerText(), /\$75\.00/);
    } finally {
      await context.close();
    }

    const noJs = await browser.newContext({ javaScriptEnabled: false });
    try {
      const noJsPage = await noJs.newPage();
      attach(noJsPage);
      await noJsPage.goto(fileUrl(interactivePath));
      assert.equal(await noJsPage.locator('.local-static').count(), 1);
      assert.match(await noJsPage.locator('.local-document').innerText(), /\$75\.00/);

      await noJsPage.goto(fileUrl(staticPath));
      assert.equal(await noJsPage.locator('input, button, select, textarea').count(), 0);
      assert.equal(await noJsPage.locator('.local-static').count(), 1);
      assert.match(await noJsPage.locator('.local-document').innerText(), /\$75\.00/);
      assert.match(await noJsPage.locator('.local-document').innerText(), /physics/);
    } finally {
      await noJs.close();
    }

    assert.deepEqual(errors, [], `Browser page errors: ${errors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(network, [], `Unexpected network requests: ${network.join(' | ')}`);
  } finally {
    await browser.close();
  }
}

async function equivalenceChecks() {
  const server = await createServer({
    configFile: false,
    root,
    plugins: [react()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    logLevel: 'error',
  });
  let browser;
  let page;
  const errors = [];
  try {
    await server.listen();
    const baseURL = server.resolvedUrls?.local?.[0];
    assert.ok(baseURL, 'Vite dev server did not report a local URL');
    browser = await chromium.launch({
      ...(channel === 'chromium' ? {} : { channel }),
      headless: true,
    });
    page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(new URL('tests/browser/release-equivalence.html', baseURL).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.releaseHarness?.ready === true);

    const standalone = page.locator('#standalone');
    const reactView = page.locator('#react');
    const scopes = [standalone, reactView];
    const read = async (scope) => normalize(await scope.locator('.local-document').innerText());

    for (const scope of scopes) {
      await scope.getByLabel('Quantity', { exact: true }).waitFor();
      assert.equal(await scope.getByLabel('Quantity', { exact: true }).inputValue(), '6');
      assert.equal(await scope.getByLabel('Owner', { exact: true }).inputValue(), 'Grace');
      assert.equal(await scope.getByRole('checkbox', { name: 'Physics', exact: true }).isChecked(), true);
      assert.equal(await scope.getByRole('checkbox', { name: 'Chemistry', exact: true }).isChecked(), true);
      assert.equal(await scope.getByRole('table', { name: 'Release subjects', exact: true }).locator('tbody tr').count(), 2);
    }
    const ids = await page.locator('[id]').evaluateAll(elements => elements.map(element => element.id));
    assert.equal(new Set(ids).size, ids.length, 'Standalone and host React roots must have distinct control and heading IDs');
    assert.equal(await read(standalone), await read(reactView), 'Initial standalone and React documents must match');

    for (const scope of scopes) {
      await scope.getByLabel('Quantity', { exact: true }).fill('10');
      await scope.getByLabel('Quantity', { exact: true }).blur();
      await scope.getByText('Total $125.00 exceeds the limit.', { exact: true }).first().waitFor();
    }
    assert.equal(await read(standalone), await read(reactView), 'Validation markup must match');

    for (const scope of scopes) {
      await scope.getByRole('checkbox', { name: 'Mathematics', exact: true }).check();
      await scope.getByRole('table', { name: 'Release subjects', exact: true })
        .locator('tbody tr').nth(2).waitFor();
    }
    assert.equal(await read(standalone), await read(reactView), 'Collection table markup must match');

    const exported = await page.evaluate(() => {
      const standaloneState = window.releaseHarness.standalone.getState();
      const reactState = window.releaseHarness.exportReact();
      window.releaseHarness.importState(reactState);
      return { standaloneState, reactState };
    });
    assert.deepEqual(exported.standaloneState.parameters, exported.reactState.parameters);
    assert.deepEqual(exported.reactState.parameters, {
      owner: 'Grace',
      quantity: 10,
      subjects: ['mathematics', 'physics', 'chemistry'],
    });
    assert.equal(
      await page.locator('#imported .local-document').getByLabel('Quantity', { exact: true }).inputValue(),
      '10',
    );
    assert.match(await page.locator('#imported .local-document').innerText(), /\$125\.00/);

    for (const scope of scopes) {
      await scope.getByRole('button', { name: 'Reset Release settings', exact: true }).click();
      await expect(scope.getByLabel('Quantity', { exact: true })).toHaveValue('6');
      assert.equal(await scope.getByRole('checkbox', { name: 'Mathematics', exact: true }).isChecked(), false);
      assert.equal(
        await scope.getByRole('table', { name: 'Release subjects', exact: true }).locator('tbody tr').count(),
        2,
      );
      assert.doesNotMatch(await read(scope), /exceeds the limit/);
    }
    assert.equal(await read(standalone), await read(reactView), 'Reset must return both runtimes to the shared baseline');

    assert.deepEqual(errors, [], `Equivalence page errors: ${errors.join(' | ')}`);
  } catch (error) {
    await mkdir(path.join(root, 'artifacts'), { recursive: true });
    await page?.screenshot({ path: path.join(root, 'artifacts', 'release-equivalence-failure.png'), fullPage: true }).catch(() => {});
    throw new Error(`${error.message}\nEquivalence browser errors: ${errors.join(' | ')}`, { cause: error });
  } finally {
    await browser?.close();
    await server.close();
  }
}

let temp;
try {
  temp = await mkdtemp(path.join(os.tmpdir(), 'reactive-md-release-'));
  await mkdir(temp, { recursive: true });
  const statePath = await makeState(temp);

  const interactivePath = path.join(temp, 'release-interactive.html');
  const staticPath = path.join(temp, 'release-static.html');
  const initialPath = path.join(temp, 'release-initial.html');

  assertExit(run(['build', fixture, '-o', interactivePath, '--state-file', statePath]), 0, 'interactive release build');
  assertExit(run(['build', fixture, '-o', staticPath, '--state-file', statePath, '--mode', 'static']), 0, 'static release build');
  assertExit(run(['build', fixture, '-o', initialPath]), 0, 'default release build');

  await staticChecks(temp, staticPath, interactivePath, initialPath);
  await fileChecks(temp, interactivePath, staticPath);
  await equivalenceChecks();
  console.log('PASS release combination: computed values, collections, tables, validation, state baselines, reset, CLI HTML and standalone/React equivalence');
} finally {
  if (temp) {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('reactive-md-release-'));
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
