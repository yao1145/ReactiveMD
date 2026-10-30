import type { Diagnostic } from '../local/types';
import { buildDiagnostic } from './diagnostics';
import { createLocalStandaloneEntrySource, VIRTUAL_HOST_ENTRY, VIRTUAL_HOST_MODULE } from './entry';
import { utf8ByteLength } from './digest';

/** Minimal Vite peer surface; Vite's own types never enter the public SDK. */
export interface LocalViteApi {
  build(config: unknown): Promise<unknown>;
}

export type LocalViteSource = LocalViteApi | (() => Promise<LocalViteApi>);

const MAX_SCRIPT_BYTES = 32 * 1024 * 1024;

const FORBIDDEN_SCRIPT_TOKENS: readonly (readonly [RegExp, string])[] = [
  [/\bimport\s*\.\s*meta\b/, 'import.meta'],
  [/\bimport\s*\(/, 'a dynamic import'],
  [/\bnew\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:Shared)?Worker\s*\(/, 'a Worker'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bnavigator\s*\.\s*serviceWorker\b/, 'a service worker'],
  [/(?<![.\w$])(?:fetch|XMLHttpRequest)\s*\([^)]*\)(?!\s*\{)/, 'a network request'],
  [/\b(?:window|self|globalThis)\s*\.\s*(?:fetch|XMLHttpRequest)\s*\(/, 'a network request'],
  [/(?:from|import)\s*\(?\s*["'](?:https?:)?\/\//, 'a remote module'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Load the optional Vite peer through a dynamic import, or accept an injected facade. */
export async function resolveLocalVite(
  source: LocalViteSource | undefined,
  diagnostics: Diagnostic[],
): Promise<LocalViteApi | null> {
  let candidate: LocalViteApi | undefined;
  try {
    candidate = typeof source === 'function' ? await source() : source;
  } catch (error) {
    diagnostics.push(buildDiagnostic('local.build.vite', `The Vite facade failed to load: ${messageOf(error)}`));
    return null;
  }
  if (candidate !== undefined) {
    if (!isRecord(candidate) || typeof candidate.build !== 'function') {
      diagnostics.push(buildDiagnostic('local.build.vite', 'The injected Vite facade must expose build(config).'));
      return null;
    }
    return candidate;
  }
  try {
    const specifier = 'vite';
    const module = await import(specifier) as { build?: unknown };
    if (typeof module.build !== 'function') {
      diagnostics.push(buildDiagnostic('local.build.vite', 'The installed Vite package does not export build().'));
      return null;
    }
    return module as unknown as LocalViteApi;
  } catch (error) {
    diagnostics.push(buildDiagnostic(
      'local.build.vite',
      `The optional Vite peer is required to build a standalone bundle: ${messageOf(error)}`,
    ));
    return null;
  }
}

function readSingleOutput(result: unknown, diagnostics: Diagnostic[]): Record<string, unknown> | null {
  let value = result;
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      diagnostics.push(buildDiagnostic(
        'local.build.script',
        `Vite produced ${value.length} build outputs; exactly one is required.`,
      ));
      return null;
    }
    value = value[0];
  }
  if (!isRecord(value) || !Array.isArray(value.output)) {
    diagnostics.push(buildDiagnostic('local.build.script', 'Vite did not return a completed single-output build.'));
    return null;
  }
  return value;
}

function validateOutput(output: Record<string, unknown>, diagnostics: Diagnostic[]): string | null {
  const files = output.output as unknown[];
  const chunks = files.filter((file) => isRecord(file) && file.type === 'chunk');
  const assets = files.filter((file) => isRecord(file) && file.type === 'asset');
  if (assets.length > 0) {
    const names = assets
      .map((asset) => (isRecord(asset) && typeof asset.fileName === 'string' ? asset.fileName : 'unnamed'))
      .slice(0, 8)
      .join(', ');
    diagnostics.push(buildDiagnostic(
      'local.build.script',
      `The standalone build emitted ${assets.length} asset(s) instead of one inline script (${names}). Pass CSS and files as explicit resources.`,
    ));
    return null;
  }
  if (chunks.length !== 1) {
    diagnostics.push(buildDiagnostic(
      'local.build.script',
      `The standalone build emitted ${chunks.length} chunks; exactly one is required.`,
    ));
    return null;
  }
  const chunk = chunks[0];
  if (!isRecord(chunk) || typeof chunk.code !== 'string') {
    diagnostics.push(buildDiagnostic('local.build.script', 'The standalone build did not return script text.'));
    return null;
  }
  for (const key of ['imports', 'dynamicImports', 'implicitlyLoadedBefore']) {
    const value = chunk[key];
    if (Array.isArray(value) && value.length > 0) {
      diagnostics.push(buildDiagnostic(
        'local.build.script',
        `The standalone script still contains ${key} (${value.length}); it is not self-contained.`,
      ));
      return null;
    }
  }
  const code = chunk.code;
  const bytes = utf8ByteLength(code);
  if (code.trim().length === 0) {
    diagnostics.push(buildDiagnostic('local.build.script', 'The standalone script is empty.'));
    return null;
  }
  if (bytes > MAX_SCRIPT_BYTES) {
    diagnostics.push(buildDiagnostic('local.build.script', `The standalone script exceeds the ${MAX_SCRIPT_BYTES}-byte budget.`));
    return null;
  }
  for (const [pattern, label] of FORBIDDEN_SCRIPT_TOKENS) {
    if (pattern.test(code)) {
      diagnostics.push(buildDiagnostic(
        'local.build.script',
        `The standalone script contains ${label}; offline bundles must not fetch code or resources at runtime.`,
      ));
      return null;
    }
  }
  return code;
}

export interface BuildStandaloneScriptInput {
  readonly root: string;
  readonly hostEntry: string;
  readonly configKey: string;
}

/** Bundle the explicit host entry into one IIFE script with no chunks or assets. */
export async function buildLocalStandaloneScript(
  input: BuildStandaloneScriptInput,
  vite: LocalViteApi,
  diagnostics: Diagnostic[],
): Promise<string | null> {
  const hostId = input.hostEntry.split('\\').join('/');
  const normalizeId = (id: string): string => id.split('?')[0].split('\\').join('/');
  const plugin = {
    name: 'reactive-md-standalone-host',
    enforce: 'pre',
    resolveId(id: string): string | null {
      if (id === VIRTUAL_HOST_ENTRY) return `\0${VIRTUAL_HOST_ENTRY}`;
      if (id === VIRTUAL_HOST_MODULE) return hostId;
      return null;
    },
    load(id: string): string | null {
      if (id === `\0${VIRTUAL_HOST_ENTRY}`) return createLocalStandaloneEntrySource(input.configKey);
      return null;
    },
    transform(code: string, id: string): { code: string; map: null } | null {
      // The installed kernel includes ELK's optional worker constructor, but
      // uses its in-process factory. Remove global worker support in this
      // target; extension modules must provide an offline implementation.
      const kernel = normalizeId(id).includes('/reactive-md/dist-library/')
        || normalizeId(id).includes('/ReactiveMD/dist-library/');
      if (!kernel && /\bnew\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:Shared)?Worker\s*\(/.test(code)) {
        throw new Error('Offline extension modules cannot construct a Worker: ' + id);
      }
      // An IIFE has no import.meta. Host modules commonly use
      // `new URL('./', import.meta.url)` for the Node-side resource root; that
      // export is not used by the runtime entry, so give it a harmless base.
      if (normalizeId(id) === hostId && code.includes('import.meta.url')) {
        return { code: code.split('import.meta.url').join(JSON.stringify('file:///reactive-md-host.mjs')), map: null };
      }
      return null;
    },
  };
  const config = {
    configFile: false,
    root: input.root,
    logLevel: 'silent',
    publicDir: false,
    appType: 'custom',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      Worker: 'undefined',
      SharedWorker: 'undefined',
      // An offline IIFE has no module URL; host modules often compute their
      // Node-side resource root from it, so give the bundle a stable base.
      'import.meta.url': JSON.stringify('file:///reactive-md-host.mjs'),
    },
    plugins: [plugin],
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      modulePreload: false,
      target: 'es2022',
      minify: 'oxc',
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: 0,
      rolldownOptions: {
        preserveEntrySignatures: 'strict',
        input: VIRTUAL_HOST_ENTRY,
        output: {
          format: 'iife',
          name: 'ReactiveMDStandaloneHost',
          entryFileNames: 'reactive-md-standalone-host.js',
        },
      },
    },
  };

  let result: unknown;
  try {
    result = await vite.build(config);
  } catch (error) {
    diagnostics.push(buildDiagnostic('local.build.vite', `The Vite build failed: ${messageOf(error)}`));
    return null;
  }
  const output = readSingleOutput(result, diagnostics);
  if (!output) return null;
  return validateOutput(output, diagnostics);
}
