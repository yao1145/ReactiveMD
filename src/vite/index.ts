import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type ResolvedConfig } from 'vite';
import { buildLocalStandaloneBundle, LocalBuildError } from '../build';

export interface ReactiveMdViteOptions {
  /** Local module exporting `host = createReactHost(...)`. Relative to Vite root. */
  readonly extensions: string;
}

const HOST = 'virtual:reactive-md/host';
const BUNDLE = 'virtual:reactive-md/bundle';
const normalize = (file: string) => file.replaceAll('\\', '/');

function packageEntries(): string[] {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (metadata.name === 'reactive-md') return Object.entries(metadata.exports as Record<string, unknown>)
        .filter(([, value]) => value && typeof value === 'object' && 'import' in value)
        .map(([name]) => name === '.' ? 'reactive-md' : `reactive-md/${name.slice(2)}`);
    } catch { /* Continue to the installed package root. */ }
    directory = dirname(directory);
  }
  throw new Error('Cannot locate the installed reactive-md package exports.');
}

async function buildHost(config: ResolvedConfig, entry: string, watch: (file: string) => void) {
  const nodeBuild = await build({
    root: config.root, configFile: false, logLevel: 'warn', publicDir: false,
    ssr: { noExternal: true }, oxc: { jsx: { development: false } },
    plugins: [{
      name: 'reactive-md-node-host',
      resolveId(id) { return id === 'virtual:rmd-node-host' ? '\0rmd-node-host' : null; },
      load(id) {
        if (id !== '\0rmd-node-host') return null;
        return `import {host} from ${JSON.stringify(normalize(entry))};
export const {config,reactConfig,resources,notices}=host;
export const root=${JSON.stringify(config.root)};
export const allowlist=[root];`;
      },
      moduleParsed(info) { if (!info.id.startsWith('\0')) watch(normalize(info.id.split('?')[0])); },
    }],
    build: {
      write: false, ssr: true, minify: false,
      rolldownOptions: {
        input: 'virtual:rmd-node-host',
        external: [/^reactive-md(?:\/|$)/, /^react(?:\/|$)/, /^react-dom(?:\/|$)/],
        output: { format: 'es', codeSplitting: false },
      },
    },
  });
  if (Array.isArray(nodeBuild) || !('output' in nodeBuild)) throw new Error('Unexpected ReactiveMD host build output.');
  const chunks = nodeBuild.output.filter(item => item.type === 'chunk');
  if (chunks.length !== 1 || nodeBuild.output.length !== 1) throw new Error('The host must build to one ESM module with inline resources.');
  const code = chunks[0].code;
  const digest = createHash('sha256').update(code).digest('hex');
  const directory = join(config.root, '.reactive-md');
  await mkdir(directory, { recursive: true });
  const hostEntry = join(directory, `host-${digest}.mjs`);
  await writeFile(hostEntry, code);
  try {
    return await buildLocalStandaloneBundle({ entry: hostEntry });
  } catch (error) {
    if (error instanceof LocalBuildError && error.diagnostics.length > 0
      && error.diagnostics.every(item => item.code === 'local.extension.export-capability')) {
      return { error: error.message, diagnostics: error.diagnostics };
    }
    throw error;
  }
}

/** Optional Node-only adapter. Registration and code execution stay explicit. */
export function reactiveMd(options: ReactiveMdViteOptions): Plugin {
  if (!options || typeof options.extensions !== 'string' || !options.extensions.trim()
    || /^[a-z]+:\/\//i.test(options.extensions)) throw new TypeError('reactiveMd requires a local extensions module.');
  let config: ResolvedConfig;
  let entry: string;
  let pending: ReturnType<typeof buildHost> | undefined;
  const watched = new Set<string>();
  const bundle = () => pending ??= buildHost(config, entry, file => watched.add(file)).catch(error => { pending = undefined; throw error; });
  return {
    name: 'reactive-md',
    config() { return {
      optimizeDeps: { exclude: packageEntries(), include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'] },
      resolve: { dedupe: ['react', 'react-dom'] },
    }; },
    configResolved(value) { config = value; entry = resolve(config.root, options.extensions); watched.add(normalize(entry)); },
    resolveId(id) { return id === HOST || id === BUNDLE ? `\0${id}` : null; },
    async load(id) {
      if (id === `\0${HOST}`) {
        this.addWatchFile(entry);
        const styleId = createHash('sha256').update(entry).digest('hex').slice(0, 16);
        return `import * as extensions from ${JSON.stringify(normalize(entry))};
const {host}=extensions;
export {host,extensions}; export const {config,reactConfig,resources,css,notices}=host;
let style;
if(typeof document!=='undefined'){
 style=document.createElement('style');style.dataset.reactiveMdHost=${JSON.stringify(styleId)};
 style.textContent=host.css;document.head.append(style);
}
if(import.meta.hot)import.meta.hot.dispose(()=>style?.remove());`;
      }
      if (id !== `\0${BUNDLE}`) return null;
      const built = await bundle();
      for (const file of watched) this.addWatchFile(file);
      return `export default ${JSON.stringify(built)};`;
    },
    async generateBundle() {
      const built = await bundle();
      if ('error' in built) {
        this.emitFile({ type: 'asset', fileName: 'reactive-md-export.json', source: JSON.stringify(built, null, 2) });
      } else {
        const { script, ...metadata } = built;
        this.emitFile({ type: 'asset', fileName: 'reactive-md-standalone.js', source: script });
        this.emitFile({ type: 'asset', fileName: 'reactive-md-export.json', source: JSON.stringify({ ...metadata, scriptFile: 'reactive-md-standalone.js' }, null, 2) });
      }
    },
    watchChange(id) { if (watched.has(normalize(id))) pending = undefined; },
    handleHotUpdate(context) {
      if (!watched.has(normalize(context.file))) return;
      pending = undefined;
      for (const id of [HOST, BUNDLE]) {
        const module = context.server.moduleGraph.getModuleById(`\0${id}`);
        if (module) context.server.moduleGraph.invalidateModule(module);
      }
      context.server.ws.send({ type: 'full-reload' });
    },
  };
}

export default reactiveMd;
