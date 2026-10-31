import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createLocalComplianceReport,
  runLocalManifestCompliance,
} from 'reactive-md/testing';
import { runLocalReactCompliance } from 'reactive-md/testing/react';
import {
  createPlaywrightBrowserDriver,
  runLocalBrowserCompliance,
} from 'reactive-md/testing/browser';

/**
 * Compliance entry point.
 *
 * `npm test` runs Node, SSR and browser checks and fails if any declared
 * capability lacks executed evidence. `npm run test:node` deliberately omits
 * the browser suite and says so; it never reports offline as passed.
 */
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const withBrowser = !process.argv.includes('--no-browser');
const entry = await import(pathToFileURL(path.join(root, 'dist/node/entry.mjs')).href);
const resources = JSON.parse(await readFile(path.join(root, 'dist/resources.json'), 'utf8'));

const reactSpec = {
  protocol: 'reactive-md-react-spec/v1',
  source: entry.source,
  staticMarkupIncludes: ['data-game-2048-static', 'data-game-2048-board'],
  ssrMarkupIncludes: ['data-game-2048-static', 'data-game-2048-board'],
  error: {
    source: entry.source,
    config: entry.config,
    reactConfig: entry.brokenReactConfig,
    code: 'local.extension.ssr-render',
  },
};

const toggleCheckbox = (label) => `(() => {
  const labels = [...document.querySelectorAll('label')];
  const match = labels.find((item) => (item.textContent || '').includes(${JSON.stringify(label)}));
  if (!match) return false;
  const input = match.querySelector('input[type="checkbox"]');
  if (!input) return false;
  input.click();
  return true;
})()`;

// Pick a direction that is guaranteed to change the deterministic opening
// position, so the browser suite never depends on a lucky seed.
const opening = entry.createGameState({ size: 4, seed: 7, target: 2048 });
const directions = ['left', 'right', 'up', 'down'];
const workingDirection = directions.find((direction) => entry.move(opening, direction) !== opening);
if (!workingDirection) throw new Error('The sample opening has no legal move.');
const moveButton = `[data-game-2048-${workingDirection}]`;

const interactiveUrl = pathToFileURL(path.join(root, 'dist/interactive.html')).href;

const browserSpec = {
  protocol: 'reactive-md-browser-spec/v1',
  url: interactiveUrl,
  offline: true,
  timeoutMs: 5000,
  unmountExpression: '(() => { const host = globalThis.ReactiveMDStandaloneHost; if (!host || typeof host.unmountReactiveMD !== "function") return false; host.unmountReactiveMD(); return true; })()',
  expectedErrors: ['2048 exploded during render', 'The above error occurred'],
  cases: [
    { id: 'ready', phase: 'hydration', kind: 'wait', selector: '[data-game-2048]' },
    { id: 'visible', phase: 'hydration', kind: 'visible', selector: '[data-game-2048]', expected: true },
    { id: 'status', phase: 'hydration', kind: 'text', selector: '[data-game-2048-status]', expected: 'Playing' },
    { id: 'score', phase: 'hydration', kind: 'text', selector: '[data-game-2048-score]', expected: '0' },

    { id: 'mounted-status', phase: 'mount', kind: 'text', selector: '[data-game-2048-status]', expected: 'Playing' },
    { id: 'mounted-cells', phase: 'mount', kind: 'count', selector: '[data-game-2048-board] .rmd-2048-cell', expected: 16 },
    { id: 'mounted-tiles', phase: 'mount', kind: 'count', selector: '[data-game-2048-cell]:not([data-value="0"])', expected: 2 },
    { id: 'mounted-state', phase: 'mount', kind: 'attribute', selector: '[data-game-2048]', name: 'data-state', expected: 'playing' },

    { id: 'move', phase: 'edit', kind: 'click', selector: moveButton },
    { id: 'moved', phase: 'edit', kind: 'text', selector: '[data-game-2048-moves]', expected: '1' },
    { id: 'moved-attribute', phase: 'edit', kind: 'attribute', selector: '[data-game-2048]', name: 'data-moves', expected: '1' },

    { id: 'hide', phase: 'hide-show', kind: 'evaluate', expression: toggleCheckbox('Show 2048'), expected: true },
    { id: 'hidden', phase: 'hide-show', kind: 'visible', selector: '[data-game-2048]', expected: false },
    { id: 'show', phase: 'hide-show', kind: 'evaluate', expression: toggleCheckbox('Show 2048'), expected: true },
    { id: 'shown', phase: 'hide-show', kind: 'visible', selector: '[data-game-2048]', expected: true },

    { id: 'lock', phase: 'disabled', kind: 'evaluate', expression: toggleCheckbox('Lock 2048'), expected: true },
    { id: 'locked', phase: 'disabled', kind: 'enabled', selector: moveButton, expected: false },
    { id: 'unlock', phase: 'disabled', kind: 'evaluate', expression: toggleCheckbox('Lock 2048'), expected: true },
    { id: 'unlocked', phase: 'disabled', kind: 'enabled', selector: moveButton, expected: true },

    { id: 'reset', phase: 'reset', kind: 'click', selector: '[data-game-2048-reset]' },
    { id: 'restored-moves', phase: 'reset', kind: 'text', selector: '[data-game-2048-moves]', expected: '0' },
    { id: 'restored-score', phase: 'reset', kind: 'text', selector: '[data-game-2048-score]', expected: '0' },
    { id: 'restored-tiles', phase: 'reset', kind: 'count', selector: '[data-game-2048-cell]:not([data-value="0"])', expected: 2 },

    { id: 'debug', phase: 'descendant-error', kind: 'evaluate', expression: toggleCheckbox('Debug 2048'), expected: true },
    { id: 'isolation', phase: 'descendant-error', kind: 'isolation', trigger: '[data-game-2048-break]', placeholder: '[data-local-host-reason="error"]', survivor: '.local-card' },

    { id: 'unmount', phase: 'unmount', kind: 'unmount' },
    { id: 'unmounted', phase: 'unmount', kind: 'count', selector: '[data-game-2048]', expected: 0 },
    { id: 'cleared', phase: 'unmount', kind: 'evaluate', expression: '(() => { const target = document.getElementById("reactive-md-document"); return !!target && target.childElementCount === 0; })()', expected: true },
  ],
};

const manifest = runLocalManifestCompliance(entry.game2048);
const react = runLocalReactCompliance({
  config: entry.config,
  reactConfig: entry.reactConfig,
  resources,
  component: 'game-2048',
  spec: reactSpec,
  locale: 'en',
});

const suites = [manifest, react];
let browser = null;
let browserStatus = 'skipped';
if (withBrowser) {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch (error) {
    console.error('Browser evidence is required but @playwright/test could not be loaded.');
    console.error(String(error && error.message ? error.message : error));
    await writeFile(path.join(root, 'dist', 'compliance.json'), JSON.stringify({
      ok: false, browser: 'unavailable', reason: 'Playwright is required for full compliance.',
    }, null, 2));
    process.exit(1);
  }
  const browserInstance = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browserInstance.newContext({
      offline: true,
      viewport: { width: 1280, height: 900 },
    });
    const driver = createPlaywrightBrowserDriver(context);
    browser = await runLocalBrowserCompliance({
      driver,
      spec: browserSpec,
      config: entry.config,
      component: 'game-2048',
    });
    suites.push(browser);
    browserStatus = 'executed';
  } finally {
    await browserInstance.close();
  }
}

const report = createLocalComplianceReport({
  config: entry.config,
  component: 'game-2048',
  suites,
  capabilities: withBrowser ? undefined : ['static', 'ssr'],
});

await writeFile(path.join(root, 'dist', 'compliance.json'), JSON.stringify({
  complete: report.complete,
  browser: browserStatus,
  report,
}, null, 2));

console.log(`2048: passed=${report.summary.passed} failed=${report.summary.failed} skipped=${report.summary.skipped} unsupported=${report.summary.unsupported}`);
for (const evidence of report.capabilities) {
  console.log(`  ${evidence.capability}: ${evidence.status}${evidence.reason ? ` (${evidence.reason})` : ''}`);
}
for (const diagnostic of report.diagnostics) {
  console.log(`  [${diagnostic.code}] ${diagnostic.message}`);
}

if (!report.ok || (withBrowser && !report.complete)) {
  console.error('Compliance failed.');
  process.exit(1);
}
if (!withBrowser) {
  console.log('Node and SSR checks passed. Offline and browser lifecycle evidence was not executed.');
  console.log('Run `npm test` for full compliance including browser evidence.');
  process.exit(0);
}
console.log('Full compliance passed, including offline browser lifecycle evidence.');
