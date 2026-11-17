import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createLocalComplianceReport,
  runLocalBehaviorCompliance,
  runLocalManifestCompliance,
} from 'reactive-md/testing';
import { runLocalReactCompliance } from 'reactive-md/testing/react';

/**
 * Node and SSR evidence. The browser suite is not part of this template, so
 * the report deliberately omits the offline capability and writes
 * `complete: false`. Run a browser suite before claiming offline behavior.
 */
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = await import(pathToFileURL(path.join(root, 'dist', 'node', 'entry.mjs')).href);

const behaviorSpec = {
  protocol: 'reactive-md-behavior-spec/v1',
  component: 'rating-card',
  source: '<rating-card bind="score" label="Score" max="5" initial="3">',
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
  staticMarkupIncludes: ['data-rating-card-static'],
  ssrMarkupIncludes: ['data-rating-card-static'],
};

const manifest = runLocalManifestCompliance(entry.ratingCard);
const behavior = runLocalBehaviorCompliance(behaviorSpec, entry.config);
const react = runLocalReactCompliance({
  config: entry.config,
  reactConfig: entry.reactConfig,
  component: 'rating-card',
  spec: reactSpec,
  locale: 'en',
});

const report = createLocalComplianceReport({
  config: entry.config,
  component: 'rating-card',
  suites: [manifest, behavior, react],
  capabilities: ['interactive', 'static', 'ssr'],
});

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist', 'compliance.json'), JSON.stringify({
  complete: false,
  offline: 'not executed: the browser suite is not part of this template',
  report,
}, null, 2));

console.log(`rating-card: passed=${report.summary.passed} failed=${report.summary.failed} skipped=${report.summary.skipped} unsupported=${report.summary.unsupported}`);
for (const evidence of report.capabilities) {
  console.log(`  ${evidence.capability}: ${evidence.status}`);
}
for (const diagnostic of report.diagnostics) {
  console.log(`  [${diagnostic.code}] ${diagnostic.message}`);
}

if (!report.ok) {
  console.error('Node/SSR compliance failed.');
  process.exit(1);
}
console.log('Node and SSR checks passed. Offline and browser evidence is not part of this run;');
console.log('see dist/interactive.html from `npm run export` and the component-package template for a browser suite.');
