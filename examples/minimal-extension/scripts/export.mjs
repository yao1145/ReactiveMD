import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileLocal, createLocalRuntime, exportLocalState } from 'reactive-md';
import { buildLocalStandaloneBundle } from 'reactive-md/build';
import { createLocalShareableHtml } from 'reactive-md/export';
import { renderLocalStaticDocument } from 'reactive-md/react/server';

/**
 * Build one offline HTML file.
 *
 * `buildLocalStandaloneBundle` reads the host module below, bundles the
 * implementations into a single IIFE, seals it against the installed config and
 * returns the resources and notices. `createLocalShareableHtml` combines that
 * bundle with a strict SSR render and the exported runtime state.
 */
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = await import(pathToFileURL(path.join(root, 'dist', 'node', 'entry.mjs')).href);

const packageRoot = path.dirname(fileURLToPath(import.meta.resolve('reactive-md/package.json')));
const reactRoot = path.dirname(fileURLToPath(import.meta.resolve('react/package.json')));
const reactDomRoot = path.dirname(fileURLToPath(import.meta.resolve('react-dom/package.json')));
const notices = [
  { id: 'reactive-md', license: 'MIT', text: await readFile(path.join(packageRoot, 'LICENSE'), 'utf8') },
  { id: 'reactive-md/dependencies', text: await readFile(path.join(packageRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8') },
  { id: 'react', license: 'MIT', text: await readFile(path.join(reactRoot, 'LICENSE'), 'utf8') },
  { id: 'react-dom', license: 'MIT', text: await readFile(path.join(reactDomRoot, 'LICENSE'), 'utf8') },
];

// The host module is the only file the builder reads. `root` and `allowlist`
// bound every resource path; this template declares no CSS resources.
const host = path.join(root, 'dist', 'build-host.mjs');
await writeFile(host, [
  "export { config, reactConfig } from './node/entry.mjs';",
  `export const root = ${JSON.stringify(root)};`,
  "export const allowlist = ['src'];",
].join('\n'));

const bundle = await buildLocalStandaloneBundle({ entry: host, notices });
const css = await readFile(fileURLToPath(import.meta.resolve('reactive-md/styles.css')), 'utf8');
const compiled = compileLocal(entry.source, { config: entry.config });
if (!compiled.ok) throw new Error(`The sample did not compile: ${JSON.stringify(compiled.diagnostics)}`);

const runtime = createLocalRuntime(compiled.document);
try {
  const rendered = renderLocalStaticDocument({
    document: compiled.document,
    runtime,
    reactConfig: entry.reactConfig,
    resources: bundle.resources,
  });
  if (!rendered.ok) throw new Error(`SSR failed: ${JSON.stringify(rendered.diagnostics)}`);
  const html = createLocalShareableHtml({
    source: entry.source,
    document: compiled.document,
    config: entry.config,
    state: exportLocalState(runtime),
    staticMarkup: rendered.markup,
    css,
    title: 'Minimal extension',
    bundle,
    resources: bundle.resources,
    notices: bundle.notices,
    mode: 'interactive',
  });
  await writeFile(path.join(root, 'dist', 'interactive.html'), html);
  await writeFile(path.join(root, 'dist', 'build-manifest.json'), JSON.stringify(bundle.manifest, null, 2));
} finally {
  runtime.dispose();
}

console.log('Wrote dist/interactive.html and dist/build-manifest.json');
