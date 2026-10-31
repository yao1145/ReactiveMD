import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLocalStandaloneBundle } from 'reactive-md/build';
import { compileLocal, createLocalRuntime, exportLocalState } from 'reactive-md';
import { createLocalShareableHtml } from 'reactive-md/export';
import { renderLocalStaticDocument } from 'reactive-md/react/server';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = await import(pathToFileURL(path.join(root, 'dist/node/entry.mjs')).href);
const cssUrl = import.meta.resolve('reactive-md/styles.css');
const css = await readFile(fileURLToPath(cssUrl), 'utf8');
const notices = [
  { id: 'example/game-2048', license: 'MIT', text: (await readFile(path.join(root, 'LICENSE'), 'utf8')) + '\n' + await readFile(path.join(root, 'NOTICES.md'), 'utf8') },
  { id: 'reactive-md/license', license: 'MIT', text: await readFile(new URL('../LICENSE', cssUrl), 'utf8') },
  { id: 'reactive-md/dependencies', text: await readFile(new URL('../THIRD_PARTY_NOTICES.md', cssUrl), 'utf8') },
  ...await Promise.all(['react', 'react-dom'].map(async name => ({ id: name, license: 'MIT',
    text: await readFile(new URL('./LICENSE', import.meta.resolve(name + '/package.json')), 'utf8') }))),
];
// Only this explicitly allowed host module supplies implementations and files.
const host = path.join(root, 'dist/build-host.mjs');
await writeFile(host, [
  "export {config,reactConfig} from './node/entry.mjs';",
  'export const root=' + JSON.stringify(root) + ';',
  "export const allowlist=['src'];",
  "export const resources=[{id:'example/game-2048.css',path:'src/component.css'}];",
  'export const notices=' + JSON.stringify(notices) + ';',
].join('\n'));
const bundle = await buildLocalStandaloneBundle({ entry: host });
const compiled = compileLocal(entry.source, { config: entry.config });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
const runtime = createLocalRuntime(compiled.document);
try {
  const rendered = renderLocalStaticDocument({ document: compiled.document, runtime, reactConfig: entry.reactConfig, resources: bundle.resources });
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  const options = { source: entry.source, document: compiled.document, config: entry.config,
    state: exportLocalState(runtime), staticMarkup: rendered.markup, css, title: '2048 component',
    bundle, resources: bundle.resources, notices: bundle.notices };
  await writeFile(path.join(root, 'dist/interactive.html'), createLocalShareableHtml({ ...options, mode: 'interactive' }));
  await writeFile(path.join(root, 'dist/static.html'), createLocalShareableHtml({ ...options, mode: 'static' }));
  await writeFile(path.join(root, 'dist/standalone.js'), bundle.script);
  await writeFile(path.join(root, 'dist/build-manifest.json'), JSON.stringify(bundle.manifest, null, 2));
} finally { runtime.dispose(); }
console.log('Built offline interactive/static HTML with local resources and notices.');
