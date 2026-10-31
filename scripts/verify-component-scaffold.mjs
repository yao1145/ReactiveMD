import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, preview } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:component-scaffold after building the SDK.');
const artifacts = path.join(root, 'artifacts/sdk-ease');
await mkdir(artifacts, { recursive: true });
const consumer = await mkdtemp(path.join(artifacts, 'installed-consumer-'));
const checks = [];
function run(args, cwd = root, capture = false) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Failed: ${args.join(' ')}`);
  return result.stdout;
}
const [packed] = JSON.parse(run([npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', consumer], root, true));
const tarball = path.join(consumer, packed.filename);
await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
// Install the SDK artifact itself; the fixture shares existing React/Vite/test
// tooling from its parent, without installing a second SDK or using TS aliases.
run([npmCli, 'install', '--prefix', consumer, '--ignore-scripts', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund', '--offline', tarball]);
const installed = path.join(consumer, 'node_modules/reactive-md');
const project = path.join(consumer, 'my-note');
run([path.join(installed, 'bin/reactive-md.mjs'), 'init', 'component', project, '--name', 'my-note', '--id', 'acme/my-note',
  '--form', 'container', '--props', JSON.stringify({ label: { kind: 'string', default: 'Note' } }), '--yes']);
const snippets = await Promise.all(['ch', 'en'].map(async lang => {
  const guide = await readFile(path.join(root, `docs/development/component-development-${lang}.md`), 'utf8');
  const snippet = guide.match(/```tsx\r?\n([\s\S]*?)\r?\n```/)?.[1];
  assert.ok(snippet, 'Quick-start JSX example is missing.');
  return snippet;
}));
assert.equal(snippets[0], snippets[1], 'Translated guides must exercise the same runnable example.');
await writeFile(path.join(project, 'src/my-note.tsx'), snippets[0]);
run([npmCli, 'run', 'typecheck'], project);
run([npmCli, 'test'], project);
run([npmCli, 'run', 'build:preview'], project);
checks.push('installed SDK CLI, guide JSX, declarations, package build and Node/SSR compliance');

const dist = path.join(project, 'main/dist');
const metadata = JSON.parse(await readFile(path.join(dist, 'reactive-md-export.json'), 'utf8'));
assert.ok(!metadata.error, JSON.stringify(metadata));
const script = await readFile(path.join(dist, metadata.scriptFile), 'utf8');
assert.ok(script.length > 0);
const core = await import(pathToFileURL(path.join(installed, 'dist-library/reactive-md.js')));
const serverApi = await import(pathToFileURL(path.join(installed, 'dist-library/reactive-md-react-server.js')));
const exportApi = await import(pathToFileURL(path.join(installed, 'dist-library/reactive-md-export.js')));
const { host } = await import(pathToFileURL(path.join(project, 'dist/node/host.js')));
const source = await readFile(path.join(project, 'main/sample.reactive.md'), 'utf8');
const compiled = core.compileLocal(source, host.compileOptions);
assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
const runtime = core.createLocalRuntime(compiled.document);
const css = await readFile(path.join(installed, 'dist-library/reactive-md.css'), 'utf8');
try {
  const rendered = serverApi.renderLocalStaticDocument({ document: compiled.document, runtime, reactConfig: host.reactConfig, resources: host.resources });
  assert.ok(rendered.ok, JSON.stringify(rendered.diagnostics));
  for (const mode of ['interactive', 'static']) {
    await writeFile(path.join(consumer, `${mode}.html`), exportApi.createLocalShareableHtml({
      source, document: compiled.document, config: host.config, state: core.exportLocalState(runtime),
      staticMarkup: rendered.markup, css, mode, title: 'Installed component quick start',
      resources: host.resources, bundle: { ...metadata, script },
    }));
  }
} finally { runtime.dispose(); }
checks.push('automatic standalone runtime and manifest restore into public offline HTML');

const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
const config = { configFile: path.join(project, 'vite.config.ts'),
  preview: { host: '127.0.0.1', port: 5189, strictPort: true }, server: { host: '127.0.0.1', port: 5189, strictPort: true } };
const errors = [];
let status = 'failed';
try {
  let server = await preview(config);
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('[data-my-note]').waitFor();
    assert.equal(await page.locator('[data-my-note]').evaluate(node => getComputedStyle(node).paddingTop), '12px');
    assert.equal(await page.locator('style[data-reactive-md-host]').count(), 1);
    await page.getByRole('button', { name: 'Note', exact: true }).click();
    assert.equal(await page.locator('[data-my-note] p').count(), 0);
    await page.close();
    checks.push('production preview loads component CSS and handles local interaction');
  } finally { await new Promise(resolve => { server.httpServer.close(resolve); server.httpServer.closeAllConnections(); }); }

  for (const mode of ['interactive', 'static']) {
    const context = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(pathToFileURL(path.join(consumer, `${mode}.html`)).href);
      await page.locator('[data-my-note]').waitFor();
      if (mode === 'interactive') {
        await page.getByRole('button', { name: 'Note', exact: true }).click();
        assert.equal(await page.locator('[data-my-note] p').count(), 0);
      } else assert.equal(await page.locator('[data-my-note] button').count(), 0);
      assert.deepEqual(requests, []);
    } finally { await context.close(); }
    checks.push(`${mode} HTML restores offline with no HTTP requests`);
  }

  server = await createServer(config);
  await server.listen();
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('[data-my-note]').waitFor();
    await writeFile(path.join(project, 'src/my-note.tsx'), snippets[0].replace('padding: 12px', 'padding: 18px'));
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-my-note]');
      return node && getComputedStyle(node).paddingTop === '18px';
    });
    await page.close();
    checks.push('development host reloads source and replaces styles without manual injection');
  } finally { await server.close(); }
  assert.deepEqual(errors, []);
  status = 'passed';
} finally {
  await browser.close();
  await writeFile(path.join(artifacts, 'scaffold-verification.json'), JSON.stringify({
    status, consumer, tarball, integrity: packed.integrity, checks, errors,
  }, null, 2));
}
console.log(`PASS ${checks.length} installed scaffold checks`);
