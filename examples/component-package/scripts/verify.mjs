import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createLocalComplianceReport,
  runLocalBehaviorCompliance,
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

const behaviorSpec = {
  protocol: 'reactive-md-behavior-spec/v1',
  component: 'rating',
  source: '<rating bind="score" label="Score" max="5" initial="3">',
  writes: [
    { id: 'increment', value: 4, accepted: true, expect: { score: 4 } },
    { id: 'at-max', value: 5, accepted: true, expect: { score: 5 } },
    { id: 'over-max', value: 6, accepted: false },
    { id: 'wrong-type', value: 'four', accepted: false },
  ],
};

const reactSpec = {
  protocol: 'reactive-md-react-spec/v1',
  source: entry.source,
  staticMarkupIncludes: ['data-rating-static', 'data-note'],
  ssrMarkupIncludes: ['data-rating-static', 'data-note'],
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

const interactiveUrl = pathToFileURL(path.join(root, 'dist/interactive.html')).href;

const browserSpec = {
  protocol: 'reactive-md-browser-spec/v1',
  url: interactiveUrl,
  offline: true,
  timeoutMs: 5000,
  unmountExpression: '(() => { const host = globalThis.ReactiveMDStandaloneHost; if (!host || typeof host.unmountReactiveMD !== "function") return false; host.unmountReactiveMD(); return true; })()',
  expectedErrors: ['rating exploded during render', 'The above error occurred'],
  cases: [
    { id: 'ready', phase: 'hydration', kind: 'wait', selector: '[data-rating]' },
    { id: 'rating-visible', phase: 'hydration', kind: 'visible', selector: '[data-rating]', expected: true },
    { id: 'rating-value', phase: 'hydration', kind: 'text', selector: '[data-rating-value]', expected: '3' },
    { id: 'note-visible', phase: 'hydration', kind: 'visible', selector: '[data-note]', expected: true },

    { id: 'mounted-value', phase: 'mount', kind: 'text', selector: '[data-rating-value]', expected: '3' },
    { id: 'mounted-note-title', phase: 'mount', kind: 'text', selector: '[data-note-title]', expected: 'Notes' },

    { id: 'increment', phase: 'edit', kind: 'click', selector: '[data-rating-up]' },
    { id: 'edited', phase: 'edit', kind: 'text', selector: '[data-rating-value]', expected: '4' },
    { id: 'note-reacted', phase: 'edit', kind: 'text', selector: '[data-note] p strong', expected: '4' },
    { id: 'invalid', phase: 'edit', kind: 'click', selector: '[data-rating-invalid]' },
    { id: 'invalid-rejected', phase: 'edit', kind: 'text', selector: '[data-rating-value]', expected: '4' },

    { id: 'hide', phase: 'hide-show', kind: 'evaluate', expression: toggleCheckbox('Show rating'), expected: true },
    { id: 'hidden', phase: 'hide-show', kind: 'visible', selector: '[data-rating]', expected: false },
    { id: 'show', phase: 'hide-show', kind: 'evaluate', expression: toggleCheckbox('Show rating'), expected: true },
    { id: 'shown', phase: 'hide-show', kind: 'visible', selector: '[data-rating]', expected: true },

    { id: 'disable', phase: 'disabled', kind: 'evaluate', expression: toggleCheckbox('Lock rating'), expected: true },
    { id: 'disabled', phase: 'disabled', kind: 'enabled', selector: '[data-rating-up]', expected: false },
    { id: 'enable', phase: 'disabled', kind: 'evaluate', expression: toggleCheckbox('Lock rating'), expected: true },
    { id: 'enabled', phase: 'disabled', kind: 'enabled', selector: '[data-rating-up]', expected: true },

    { id: 'change', phase: 'reset', kind: 'click', selector: '[data-rating-up]' },
    { id: 'reset', phase: 'reset', kind: 'click', selector: '[data-rating-reset]' },
    { id: 'restored', phase: 'reset', kind: 'text', selector: '[data-rating-value]', expected: '3' },

    { id: 'break', phase: 'descendant-error', kind: 'isolation', trigger: '[data-rating-break]', placeholder: '[data-local-host-reason="error"]', survivor: '[data-note]' },

    { id: 'unmount', phase: 'unmount', kind: 'unmount' },
    { id: 'unmounted', phase: 'unmount', kind: 'count', selector: '[data-rating]', expected: 0 },
    { id: 'cleared', phase: 'unmount', kind: 'evaluate', expression: '(() => { const target = document.getElementById("reactive-md-document"); return !!target && target.childElementCount === 0; })()', expected: true },
  ],
};

/**
 * Note-owned lifecycle evidence. The note contains the rating control, so
 * every phase targets the note or the rating instance nested inside it. This
 * spec must never be shared with the rating report: a passed note report means
 * the note's own visibility, title, child reactivity, disabled context, reset,
 * descendant error isolation and unmount were observed.
 */
const noteSpec = {
  protocol: 'reactive-md-browser-spec/v1',
  url: interactiveUrl,
  offline: true,
  timeoutMs: 5000,
  unmountExpression: '(() => { const host = globalThis.ReactiveMDStandaloneHost; if (!host || typeof host.unmountReactiveMD !== "function") return false; host.unmountReactiveMD(); return true; })()',
  expectedErrors: ['rating exploded during render', 'The above error occurred'],
  cases: [
    { id: 'ready', phase: 'hydration', kind: 'wait', selector: '[data-note]' },
    { id: 'note-visible', phase: 'hydration', kind: 'visible', selector: '[data-note]', expected: true },
    { id: 'note-title', phase: 'hydration', kind: 'text', selector: '[data-note-title]', expected: 'Notes' },
    { id: 'child-value', phase: 'hydration', kind: 'text', selector: '[data-note] [data-rating-value]', expected: '3' },
    { id: 'note-enabled', phase: 'hydration', kind: 'attribute', selector: '[data-note]', name: 'data-note-disabled', expected: 'false' },

    { id: 'mounted-title', phase: 'mount', kind: 'text', selector: '[data-note-title]', expected: 'Notes' },
    { id: 'mounted-child', phase: 'mount', kind: 'text', selector: '[data-note] [data-rating-value]', expected: '3' },

    { id: 'increment-child', phase: 'edit', kind: 'click', selector: '[data-note] [data-rating-up]' },
    { id: 'child-reacted', phase: 'edit', kind: 'text', selector: '[data-note] [data-rating-value]', expected: '4' },
    { id: 'note-content-reacted', phase: 'edit', kind: 'text', selector: '[data-note] p strong', expected: '4' },

    { id: 'hide', phase: 'hide-show', kind: 'evaluate', expression: toggleCheckbox('Show rating'), expected: true },
    { id: 'hidden', phase: 'hide-show', kind: 'visible', selector: '[data-note]', expected: false },
    { id: 'show', phase: 'hide-show', kind: 'evaluate', expression: toggleCheckbox('Show rating'), expected: true },
    { id: 'shown', phase: 'hide-show', kind: 'visible', selector: '[data-note]', expected: true },

    { id: 'disable', phase: 'disabled', kind: 'evaluate', expression: toggleCheckbox('Lock rating'), expected: true },
    { id: 'note-disabled', phase: 'disabled', kind: 'attribute', selector: '[data-note]', name: 'data-note-disabled', expected: 'true' },
    { id: 'child-disabled', phase: 'disabled', kind: 'enabled', selector: '[data-note] [data-rating-up]', expected: false },
    { id: 'enable', phase: 'disabled', kind: 'evaluate', expression: toggleCheckbox('Lock rating'), expected: true },
    { id: 'note-reenabled', phase: 'disabled', kind: 'attribute', selector: '[data-note]', name: 'data-note-disabled', expected: 'false' },
    { id: 'child-enabled', phase: 'disabled', kind: 'enabled', selector: '[data-note] [data-rating-up]', expected: true },

    { id: 'change', phase: 'reset', kind: 'click', selector: '[data-note] [data-rating-up]' },
    { id: 'reset', phase: 'reset', kind: 'click', selector: '[data-note] [data-rating-reset]' },
    { id: 'restored', phase: 'reset', kind: 'text', selector: '[data-note] [data-rating-value]', expected: '3' },

    { id: 'break-child', phase: 'descendant-error', kind: 'isolation', trigger: '[data-note] [data-rating-break]', placeholder: '[data-note] [data-local-host-reason="error"]', survivor: '[data-note]' },

    { id: 'unmount', phase: 'unmount', kind: 'unmount' },
    { id: 'unmounted', phase: 'unmount', kind: 'count', selector: '[data-note]', expected: 0 },
    { id: 'cleared', phase: 'unmount', kind: 'evaluate', expression: '(() => { const target = document.getElementById("reactive-md-document"); return !!target && target.childElementCount === 0; })()', expected: true },
  ],
};

const ratingManifest = runLocalManifestCompliance(entry.rating);
const noteManifest = runLocalManifestCompliance(entry.note);
const behavior = runLocalBehaviorCompliance(behaviorSpec, entry.config);
const react = runLocalReactCompliance({
  config: entry.config,
  reactConfig: entry.reactConfig,
  resources,
  component: 'rating',
  spec: reactSpec,
  locale: 'en',
});

const suites = [ratingManifest, behavior, react];
let browser = null;
let noteBrowser = null;
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
      component: 'rating',
    });
    suites.push(browser);
    noteBrowser = await runLocalBrowserCompliance({ driver, spec: noteSpec, config: entry.config, component: 'note' });
    browserStatus = 'executed';
  } finally {
    await browserInstance.close();
  }
}

const capabilities = withBrowser
  ? ['interactive', 'static', 'ssr', 'offline']
  : ['interactive', 'static', 'ssr'];
const noteReact = runLocalReactCompliance({ config: entry.config, reactConfig: entry.reactConfig,
  resources,
  component: 'note', spec: { protocol: 'reactive-md-react-spec/v1', source: entry.source,
    staticMarkupIncludes: ['data-note'], ssrMarkupIncludes: ['data-note'] } });
const ratingReport = createLocalComplianceReport({
  config: entry.config,
  component: 'rating',
  suites,
  capabilities,
});
const noteReport = createLocalComplianceReport({
  config: entry.config,
  component: 'note',
  suites: [noteManifest, noteReact, ...(noteBrowser ? [noteBrowser] : [])],
  capabilities: withBrowser ? ['interactive', 'static', 'ssr', 'offline'] : ['static', 'ssr'],
});
const complete = withBrowser && ratingReport.complete && noteReport.complete;

await writeFile(path.join(root, 'dist', 'compliance.json'), JSON.stringify({
  complete,
  browser: browserStatus,
  rating: ratingReport,
  note: noteReport,
}, null, 2));

for (const report of [ratingReport, noteReport]) {
  const name = report.component ? report.component.name : 'unknown';
  console.log(`${name}: passed=${report.summary.passed} failed=${report.summary.failed} skipped=${report.summary.skipped} unsupported=${report.summary.unsupported}`);
  for (const evidence of report.capabilities) {
    console.log(`  ${evidence.capability}: ${evidence.status}${evidence.reason ? ` (${evidence.reason})` : ''}`);
  }
  for (const diagnostic of report.diagnostics) {
    console.log(`  [${diagnostic.code}] ${diagnostic.message}`);
  }
}

if (!ratingReport.ok || !noteReport.ok || (withBrowser && !complete)) {
  console.error('Compliance failed.');
  process.exit(1);
}
if (!withBrowser) {
  console.log('Node and SSR checks passed. Offline and browser lifecycle evidence was not executed.');
  console.log('Run `npm test` for full compliance including browser evidence.');
  process.exit(0);
}
console.log('Full compliance passed, including offline browser lifecycle evidence.');
