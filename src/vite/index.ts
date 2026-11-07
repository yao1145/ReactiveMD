import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite';
import { buildLocalStandaloneBundle, LocalBuildError } from '../build';
import { discoverDirectories, type DirectoryDiscovery } from './discovery';
import {
  createDirectoryRegistration,
  discoveredThemes,
  discoveryMetadata,
  mergeDiscoveredAssets,
  type DirectoryRegistrationSource,
} from './registration';

/** Directory mode: discover `theme/` and `plugin/` entries relative to the Vite root. */
export interface ReactiveMdDirectoryOptions {
  /** Theme root relative to the Vite root. Defaults to `theme`. */
  readonly themeDir?: string;
  /** Package entry root relative to the Vite root. Defaults to `plugin`. */
  readonly pluginDir?: string;
}

/** Manual mode: one local module exporting `host = createReactHost(...)`. */
export interface ReactiveMdExtensionsOptions {
  /** Local module exporting `host = createReactHost(...)`. Relative to Vite root. */
  readonly extensions: string;
}

/**
 * Passing `extensions` selects manual registration. Omitting every option, or
 * passing only `themeDir`/`pluginDir`, enables directory registration.
 */
export type ReactiveMdViteOptions = ReactiveMdDirectoryOptions | ReactiveMdExtensionsOptions;

const HOST = 'virtual:reactive-md/host';
const BUNDLE = 'virtual:reactive-md/bundle';
const REGISTRATION = 'virtual:reactive-md/registration';
const RESOLVED = (id: string): string => `\0${id}`;
const PLUGIN_ENTRY = /^index\.(?:ts|tsx|js|jsx|mts|mjs)$/;
const normalize = (file: string): string => file.replaceAll('\\', '/');
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

type RegistrationMode =
  | { readonly kind: 'manual'; readonly entry: string }
  | { readonly kind: 'directories'; readonly themeDir?: string; readonly pluginDir?: string };

const OPTION_KEYS = new Set(['extensions', 'themeDir', 'pluginDir']);

function readLocalModule(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /^[a-z]+:\/\//i.test(value)) {
    throw new TypeError('reactiveMd requires a local extensions module.');
  }
  return value.trim();
}

function readRelativeDirectory(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`reactiveMd ${key} must be a non-empty directory path.`);
  }
  const path = value.trim();
  const normalized = normalize(path);
  if (/^[a-z]+:\/\//i.test(path) || isAbsolute(path) || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new TypeError(`reactiveMd ${key} must be a relative directory inside the Vite root.`);
  }
  return path;
}

/** Directory and manual options cannot be combined; nothing is guessed. */
function readOptions(value: unknown): RegistrationMode {
  if (value === undefined) return { kind: 'directories' };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('reactiveMd options must be an object.');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!OPTION_KEYS.has(key)) throw new TypeError(`reactiveMd does not accept the "${key}" option.`);
  }
  const hasExtensions = Object.hasOwn(record, 'extensions');
  const hasThemeDir = Object.hasOwn(record, 'themeDir');
  const hasPluginDir = Object.hasOwn(record, 'pluginDir');
  if (hasExtensions && (hasThemeDir || hasPluginDir)) {
    throw new TypeError('reactiveMd options cannot mix "extensions" with "themeDir" or "pluginDir".');
  }
  if (hasExtensions) return { kind: 'manual', entry: readLocalModule(record.extensions) };
  const directory: RegistrationMode = {
    kind: 'directories',
    ...(hasThemeDir ? { themeDir: readRelativeDirectory(record.themeDir, 'themeDir') } : {}),
    ...(hasPluginDir ? { pluginDir: readRelativeDirectory(record.pluginDir, 'pluginDir') } : {}),
  };
  return directory;
}

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

interface HostBuildSource {
  /** Manual registration module. */
  readonly entry?: string;
  /** Directory registration module generated from the current snapshot. */
  readonly registration?: DirectoryRegistrationSource;
}

async function buildHost(config: ResolvedConfig, source: HostBuildSource, watch: (file: string) => void) {
  const registration = source.registration;
  const nodeBuild = await build({
    root: config.root, configFile: false, logLevel: 'warn', publicDir: false,
    ssr: { noExternal: true }, oxc: { jsx: { development: false } },
    plugins: [{
      name: 'reactive-md-node-host',
      resolveId(id) {
        if (id === 'virtual:rmd-node-host') return '\0rmd-node-host';
        if (registration && id === REGISTRATION) return RESOLVED(REGISTRATION);
        return null;
      },
      load(id) {
        if (registration && id === RESOLVED(REGISTRATION)) return registration.code;
        if (id !== '\0rmd-node-host') return null;
        const entry = registration ? REGISTRATION : normalize(source.entry ?? '');
        return `import {host} from ${JSON.stringify(entry)};
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

interface DirectoryState {
  readonly discovery: DirectoryDiscovery;
  readonly registration: DirectoryRegistrationSource;
  readonly themeRoot: string;
  readonly pluginRoot: string;
  readonly files: ReadonlySet<string>;
}

function insidePath(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}/`);
}

/**
 * Optional Node-only adapter. Directory mode discovers `theme/` and `plugin/`
 * once per snapshot and generates one registration module; manual mode keeps
 * the explicit `extensions` entry. Registration and code execution stay
 * explicit on the consumer side.
 */
export function reactiveMd(options: ReactiveMdViteOptions = {}): Plugin {
  const mode = readOptions(options);
  let config: ResolvedConfig;
  let manualEntry: string | undefined;
  let themeOption: string | undefined;
  let pluginOption: string | undefined;
  let themeRoot = '';
  let pluginRoot = '';
  let state: DirectoryState | undefined;
  let knownFiles: ReadonlySet<string> = new Set();
  let generation = 0;
  let inflight: { readonly generation: number; readonly promise: Promise<DirectoryState> } | undefined;
  let pending: Promise<Awaited<ReturnType<typeof buildHost>>> | undefined;
  const watched = new Set<string>();

  if (mode.kind === 'directories') {
    themeOption = mode.themeDir;
    pluginOption = mode.pluginDir;
  }

  function invalidateAll(): void {
    generation += 1;
    state = undefined;
    inflight = undefined;
    pending = undefined;
  }

  async function loadSnapshot(): Promise<DirectoryState> {
    const discovery = await discoverDirectories(config.root, Object.freeze({
      ...(themeOption === undefined ? {} : { themeDir: themeOption }),
      ...(pluginOption === undefined ? {} : { pluginDir: pluginOption }),
    }));
    const registration = createDirectoryRegistration(discovery, createHash('sha256').update(config.root).digest('hex').slice(0, 16));
    const value: DirectoryState = Object.freeze({
      discovery,
      registration,
      themeRoot: resolve(config.root, themeOption ?? 'theme'),
      pluginRoot: resolve(config.root, pluginOption ?? 'plugin'),
      files: new Set(discovery.files.map(normalize)),
    });
    return value;
  }

  function snapshot(): Promise<DirectoryState> {
    if (state) return Promise.resolve(state);
    const current = generation;
    if (inflight?.generation === current) return inflight.promise;
    const promise = (async () => {
      const value = await loadSnapshot();
      if (current !== generation) return snapshot();
      state = value;
      knownFiles = value.files;
      return value;
    })();
    const record = { generation: current, promise };
    inflight = record;
    promise.finally(() => { if (inflight === record) inflight = undefined; }).catch(() => {});
    return promise;
  }

  /** `style` is a theme stylesheet/asset refresh; `structure` needs a reload. */
  function classify(file: string): 'style' | 'structure' | 'none' {
    if (mode.kind !== 'directories') return 'none';
    const target = normalize(file);
    const theme = normalize(themeRoot);
    const plugin = normalize(pluginRoot);
    if (insidePath(target, plugin)) {
      const name = target.slice(target.lastIndexOf('/') + 1);
      if (PLUGIN_ENTRY.test(name) || name === 'component.css') return 'structure';
      // Resources inlined while discovering a package need a fresh snapshot;
      // ordinary helper modules stay with the Vite dependency graph.
      return knownFiles.has(target) ? 'structure' : 'none';
    }
    if (insidePath(target, theme)) {
      return target.toLowerCase().endsWith('.json') ? 'structure' : 'style';
    }
    // Dependencies outside the owned roots have no known owner; rebuild the
    // snapshot and reload instead of guessing at a stylesheet-only update.
    return knownFiles.has(target) ? 'structure' : 'none';
  }

  function invalidateVirtualModules(server: ViteDevServer, ids: readonly string[]): void {
    for (const id of ids) {
      const module = server.moduleGraph.getModuleById(RESOLVED(id));
      if (module) server.moduleGraph.invalidateModule(module);
    }
  }

  function fullReload(server: ViteDevServer): void {
    invalidateAll();
    invalidateVirtualModules(server, [HOST, REGISTRATION, BUNDLE]);
    server.ws.send({ type: 'full-reload' });
  }

  /**
   * Re-run discovery and push the new theme packages to the page. The document
   * runtime keeps running; only the managed host stylesheet is replaced.
   */
  async function refreshThemeStyles(server: ViteDevServer): Promise<void> {
    invalidateAll();
    let current: DirectoryState;
    try {
      current = await snapshot();
    } catch (error) {
      server.config.logger.error(`[reactive-md] ${messageOf(error)}`);
      return;
    }
    server.watcher.add([...current.discovery.files]);
    invalidateVirtualModules(server, [HOST, REGISTRATION, BUNDLE]);
    server.ws.send({
      type: 'custom',
      event: 'reactive-md:themes',
      data: { themes: discoveredThemes(current.discovery), discovery: discoveryMetadata(current.discovery) },
    });
    const bundleModule = server.moduleGraph.getModuleById(RESOLVED(BUNDLE));
    if (bundleModule) await server.reloadModule(bundleModule);
  }

  async function bundle() {
    if (pending) return pending;
    const task = (async () => {
      if (mode.kind === 'manual') {
        return buildHost(config, { entry: manualEntry }, file => watched.add(file));
      }
      const current = await snapshot();
      for (const file of current.discovery.files) watched.add(normalize(file));
      const built = await buildHost(config, { registration: current.registration }, file => watched.add(file));
      return 'error' in built ? built : mergeDiscoveredAssets(built, current.discovery.assets);
    })();
    pending = task;
    task.catch(() => { if (pending === task) pending = undefined; });
    return task;
  }

  return {
    name: 'reactive-md',
    config() { return {
      optimizeDeps: { exclude: packageEntries(), include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'] },
      resolve: { dedupe: ['react', 'react-dom'] },
    }; },
    configResolved(value) {
      config = value;
      if (mode.kind === 'manual') {
        manualEntry = resolve(config.root, mode.entry);
        watched.add(normalize(manualEntry));
        return;
      }
      themeRoot = resolve(config.root, themeOption ?? 'theme');
      pluginRoot = resolve(config.root, pluginOption ?? 'plugin');
    },
    configureServer(server) {
      if (mode.kind !== 'directories') return;
      server.watcher.add([themeRoot, pluginRoot]);
      const onDirectory = (directory: string): void => {
        const target = normalize(directory);
        if (!insidePath(target, normalize(themeRoot)) && !insidePath(target, normalize(pluginRoot))) return;
        fullReload(server);
      };
      const onFile = (file: string): void => {
        const kind = classify(file);
        if (kind === 'structure' || (normalize(file).endsWith('/theme.css') && insidePath(normalize(file), normalize(themeRoot)))) fullReload(server);
        else if (kind === 'style') void refreshThemeStyles(server);
      };
      server.watcher.on('addDir', onDirectory);
      server.watcher.on('unlinkDir', onDirectory);
      // Vite 8 routes create/delete through `watchChange`, not the legacy
      // `handleHotUpdate` hook, so additions and removals are watched here.
      server.watcher.on('add', onFile);
      server.watcher.on('unlink', onFile);
      const cleanup = (): void => {
        server.watcher.off('addDir', onDirectory);
        server.watcher.off('unlinkDir', onDirectory);
        server.watcher.off('add', onFile);
        server.watcher.off('unlink', onFile);
      };
      server.httpServer?.once('close', cleanup);
      void snapshot().then((current) => {
        server.watcher.add([...current.discovery.directories, ...current.discovery.files]);
      }).catch(() => { /* The next load reports the discovery error. */ });
    },
    resolveId(id) {
      if (id === HOST || id === BUNDLE) return RESOLVED(id);
      return mode.kind === 'directories' && id === REGISTRATION ? RESOLVED(id) : null;
    },
    async load(id) {
      if (id === RESOLVED(HOST)) {
        if (mode.kind === 'manual') {
          this.addWatchFile(manualEntry as string);
          const styleId = createHash('sha256').update(manualEntry as string).digest('hex').slice(0, 16);
          return `import * as extensions from ${JSON.stringify(normalize(manualEntry as string))};
const {host}=extensions;
export {host,extensions}; export const {config,reactConfig,resources,css,notices}=host;
export const discovery=undefined;
let style;
if(typeof document!=='undefined'){
 style=document.createElement('style');style.dataset.reactiveMdHost=${JSON.stringify(styleId)};
 style.textContent=host.css;document.head.append(style);
}
if(import.meta.hot)import.meta.hot.dispose(()=>style?.remove());`;
        }
        const current = await snapshot();
        for (const file of current.discovery.files) if (existsSync(file)) this.addWatchFile(normalize(file));
        return `export { host, config, reactConfig, resources, css, notices, discovery, extensions } from ${JSON.stringify(REGISTRATION)};`;
      }
      if (mode.kind === 'directories' && id === RESOLVED(REGISTRATION)) {
        const current = await snapshot();
        for (const file of current.discovery.files) if (existsSync(file)) this.addWatchFile(normalize(file));
        return current.registration.code;
      }
      if (id !== RESOLVED(BUNDLE)) return null;
      const built = await bundle();
      for (const file of watched) if (existsSync(file)) this.addWatchFile(normalize(file));
      if (mode.kind === 'manual') return `export default ${JSON.stringify(built)};`;
      return `let bundle=${JSON.stringify(built)};
export {bundle as default};
if(import.meta.hot)import.meta.hot.accept(next=>{if(next)bundle=next.default;});`;
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
    watchChange(id) {
      const file = normalize(id);
      if (mode.kind === 'directories' && classify(file) !== 'none') invalidateAll();
      else if (watched.has(file)) pending = undefined;
    },
    async handleHotUpdate(context): Promise<void | []> {
      if (mode.kind === 'manual') {
        if (!watched.has(normalize(context.file))) return;
        pending = undefined;
        for (const id of [HOST, BUNDLE]) {
          const module = context.server.moduleGraph.getModuleById(RESOLVED(id));
          if (module) context.server.moduleGraph.invalidateModule(module);
        }
        context.server.ws.send({ type: 'full-reload' });
        return [];
      }
      const kind = classify(context.file);
      if (kind === 'none') return;
      if (kind === 'structure') {
        fullReload(context.server);
        return [];
      }
      await refreshThemeStyles(context.server);
      return [];
    },
  };
}

export default reactiveMd;
