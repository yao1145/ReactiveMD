import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import { renderLocalStaticDocument } from 'reactive-md/react/server';
import { collectLocalBuildResources, DEFAULT_LOCAL_BUILD_BUDGETS } from 'reactive-md/build';

/**
 * Build two artifacts:
 *  - dist/node/entry.mjs: SSR entry externalizing reactive-md and React.
 *  - dist/harness/harness.js: browser bundle mounting the same config.
 *
 * The harness page contains the SSR markup, so mount({ hydrate: true })
 * exercises hydration. All assets are local files.
 */
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'dist');
const external = [/^reactive-md(?:\/|$)/, /^react(?:\/|$)/, /^react-dom(?:\/|$)/];

await mkdir(dist, { recursive: true });

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  oxc: { jsx: { development: false } },
  build: {
    ssr: path.join(root, 'src/node-entry.ts'),
    outDir: path.join(dist, 'node'),
    emptyOutDir: true,
    rollupOptions: {
      external,
      output: { entryFileNames: 'entry.mjs', format: 'esm' },
    },
  },
});

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: path.join(dist, 'harness'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.join(root, 'src/harness.tsx'),
      formats: ['es'],
      fileName: () => 'harness.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true, assetFileNames: 'harness[extname]' },
    },
  },
});

const entry = await import(`${pathToFileURL(path.join(dist, 'node', 'entry.mjs')).href}?build=${Date.now()}`);
await writeFile(path.join(dist, 'node/manifest.mjs'),
  "import {defineLocalComponent} from 'reactive-md/sdk';\nexport const tetris=defineLocalComponent(" + JSON.stringify(entry.tetris) + ');\n');
const tsUrl = import.meta.resolve('typescript/package.json');
const tsPackage = JSON.parse(await readFile(fileURLToPath(tsUrl), 'utf8'));
const types = spawnSync(process.execPath, [fileURLToPath(new URL(tsPackage.bin.tsc, tsUrl)), '--project', 'tsconfig.json',
  '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', 'dist/types'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (types.status !== 0) throw new Error('Component package declaration generation failed.');
for (const name of await readdir(path.join(dist, 'types'))) {
  if (!name.endsWith('.d.ts')) continue;
  const file = path.join(dist, 'types', name);
  const declaration = await readFile(file, 'utf8');
  await writeFile(file, declaration.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,
    (whole, start, specifier, end) => /\.[cm]?js$/.test(specifier) ? whole : start + specifier + '.js' + end));
}
const collected = await collectLocalBuildResources({ config: entry.config, root,
  allowlist: [path.join(root, 'src')], budgets: DEFAULT_LOCAL_BUILD_BUDGETS,
  declared: [{ id: 'example/tetris.css', path: 'src/component.css' }] });
if (collected.diagnostics.length) throw new Error(JSON.stringify(collected.diagnostics));
await writeFile(path.join(dist, 'resources.json'), JSON.stringify(collected.resources));
const compiled = compileLocal(entry.source, { config: entry.config });
if (!compiled.ok) {
  throw new Error(`The sample did not compile: ${JSON.stringify(compiled.diagnostics)}`);
}
const runtime = createLocalRuntime(compiled.document);
const rendered = renderLocalStaticDocument({
  document: compiled.document,
  runtime,
  reactConfig: entry.reactConfig,
  resources: collected.resources,
  locale: 'en',
});
runtime.dispose();
if (!rendered.ok) {
  throw new Error(`SSR failed: ${JSON.stringify(rendered.diagnostics)}`);
}
if (/data-rmd-extension-error\s*=|local-sdk-unavailable/.test(rendered.markup)) {
  throw new Error('The SSR harness markup contains an unavailable component.');
}
if (!rendered.markup.includes('data-tetris-static')) {
  throw new Error('The SSR harness markup is missing the static tetris preview.');
}

const baseCss = await readFile(fileURLToPath(import.meta.resolve('reactive-md/styles.css')), 'utf8');
const notices = await readFile(path.join(root, 'NOTICES.md'), 'utf8');
const harnessScript = await readFile(path.join(dist, 'harness', 'harness.js'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reactive MD tetris component harness</title>
<style>${baseCss}
${collected.css}
</style>
</head>
<body class="reactive-md-export">
<div id="reactive-md-document" class="reactive-md-export-root">${rendered.markup}</div>
<template id="reactive-md-notices"><pre>${notices.replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[character])}</pre></template>
<script type="module">${harnessScript.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
await writeFile(path.join(dist, 'harness.html'), html);
await writeFile(path.join(dist, 'sample.reactive.md'), entry.source);
await writeFile(path.join(dist, 'build.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  configKey: entry.config.key,
  components: entry.config.components.map((item) => ({ id: item.id, version: item.version })),
}, null, 2));
console.log('Built dist/node/entry.mjs, dist/harness/harness.js and dist/harness.html');
await import('./build-export.mjs');
