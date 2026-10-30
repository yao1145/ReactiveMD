import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  createLocalConfig,
  defineLocalComponent,
} from '../src/sdk';
import { localComponentDigest } from '../src/sdk/manifest';
import type { LocalConfig } from '../src/sdk/types';
import {
  buildLocalStandaloneBundle,
  LocalBuildError,
  type LocalViteApi,
} from '../src/build';
import { sha256 } from '../src/build/digest';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const definition = defineLocalComponent({
  id: 'demo/rating',
  name: 'demo-rating',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {},
  styles: ['demo/rating.css'],
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
});

const config = createLocalConfig({ components: [definition] });

function configData(value: LocalConfig): unknown {
  return {
    protocol: value.protocol,
    key: value.key,
    presets: value.presets,
    components: value.components,
    themes: value.themes,
  };
}

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'reactive-md-vite-'));
  directories.push(directory);
  await mkdir(join(directory, 'styles'), { recursive: true });
  const packageDirectory = join(directory, 'node_modules', 'reactive-md');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
    name: 'reactive-md',
    version: '0.0.0-test',
    type: 'module',
    main: './standalone.mjs',
    module: './standalone.mjs',
    exports: { './standalone': './standalone.mjs', '.': './standalone.mjs' },
  }), 'utf8');
  await writeFile(join(packageDirectory, 'standalone.mjs'), [
    'export function mountAll(root, options) {',
    '  globalThis.__reactiveMDMounted = options;',
    '  return [];',
    '}',
  ].join('\n'), 'utf8');
  const host = join(directory, 'host.mjs');
  await writeFile(host, [
    `export const config = ${JSON.stringify(configData(config))};`,
    `export const reactConfig = ${JSON.stringify({
      config: configData(config),
      components: config.components.map((item) => ({ definition: item, digest: localComponentDigest(item) })),
    })};`,
    'export const root = new URL("./", import.meta.url);',
    'export const allowlist = ["styles"];',
    'export const resources = [{ id: "demo/rating.css", css: ".demo-rating { color: red; }" }];',
  ].join('\n'), 'utf8');
  return host;
}

function fakeVite(output: unknown): LocalViteApi {
  return { build: async () => output };
}

function chunk(code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'chunk', fileName: 'reactive-md-standalone-host.js', isEntry: true, code, imports: [], dynamicImports: [], ...extra };
}

async function buildError(options: Parameters<typeof buildLocalStandaloneBundle>[0]): Promise<LocalBuildError> {
  try {
    await buildLocalStandaloneBundle(options);
  } catch (error) {
    if (error instanceof LocalBuildError) return error;
    throw error;
  }
  throw new Error('Expected the build to fail.');
}

describe('standalone build with the real Vite peer', () => {
  it('bundles one inline IIFE and mounts through the public standalone API', async () => {
    const host = await fixture();
    const bundle = await buildLocalStandaloneBundle({ entry: host });

    expect(bundle.script.length).toBeGreaterThan(0);
    expect(bundle.configKey).toBe(config.key);
    expect(bundle.extensions.components).toEqual([{
      id: definition.id,
      name: definition.name,
      version: definition.version,
      digest: localComponentDigest(definition),
    }]);
    expect(bundle.resources.map((resource) => resource.id)).toEqual(['demo/rating.css']);
    expect(bundle.manifest.script.digest).toBe(sha256(bundle.script));
    expect(bundle.manifest.script.bytes).toBe(Buffer.byteLength(bundle.script, 'utf8'));
    expect(bundle.manifest.components).toEqual(bundle.extensions.components);

    const sandbox: Record<string, unknown> = {
      document: { readyState: 'complete', getElementById: () => null },
      console: { error: () => {} },
      queueMicrotask: (callback: () => void) => callback(),
      URL,
    };
    runInNewContext(bundle.script, sandbox);
    const mounted = sandbox.__reactiveMDMounted as { reactConfig?: { config?: { key?: string } } } | undefined;
    expect(mounted?.reactConfig?.config?.key).toBe(config.key);
    const hostApi = sandbox.ReactiveMDStandaloneHost as { unmountReactiveMD?: () => void };
    expect(typeof hostApi.unmountReactiveMD).toBe('function');
    expect(() => hostApi.unmountReactiveMD!()).not.toThrow();
  }, 60_000);

  it('accepts an injected single-chunk facade', async () => {
    const host = await fixture();
    const bundle = await buildLocalStandaloneBundle({
      entry: host,
      vite: fakeVite({ output: [chunk('(function(){})()')] }),
    });
    expect(bundle.script).toBe('(function(){})()');
  });

  it('accepts local parser fetch methods without treating them as network calls', async () => {
    const host = await fixture();
    const script = 'class Parser { fetch() { return "token"; } parse() { return this.fetch(); } } new Parser().parse();';
    const bundle = await buildLocalStandaloneBundle({ entry: host, vite: fakeVite({ output: [chunk(script)] }) });
    expect(bundle.script).toBe(script);
  });
});

describe('standalone script rejection', () => {
  it('rejects assets, multiple chunks, imports, dynamic imports, workers and network calls', async () => {
    const host = await fixture();
    const asset = await buildError({
      entry: host,
      vite: fakeVite({ output: [chunk('(function(){})()'), { type: 'asset', fileName: 'style.css' }] }),
    });
    expect(asset.diagnostics.map((item) => item.code)).toContain('local.build.script');

    const chunks = await buildError({
      entry: host,
      vite: fakeVite({ output: [{ output: [chunk('a')] }, { output: [chunk('b')] }] }),
    });
    expect(chunks.diagnostics.map((item) => item.code)).toContain('local.build.script');

    const imported = await buildError({
      entry: host,
      vite: fakeVite({ output: [chunk('(function(){})()', { imports: ['external'] })] }),
    });
    expect(imported.diagnostics.map((item) => item.code)).toContain('local.build.script');

    const dynamic = await buildError({
      entry: host,
      vite: fakeVite({ output: [chunk('(function(){})()', { dynamicImports: ['remote'] })] }),
    });
    expect(dynamic.diagnostics.map((item) => item.code)).toContain('local.build.script');

    const worker = await buildError({
      entry: host,
      vite: fakeVite({ output: [chunk('new Worker("worker.js")')] }),
    });
    expect(worker.diagnostics.map((item) => item.code)).toContain('local.build.script');

    const network = await buildError({
      entry: host,
      vite: fakeVite({ output: [chunk('fetch("https://example.com/data.json")')] }),
    });
    expect(network.diagnostics.map((item) => item.code)).toContain('local.build.script');
  });

  it('reports Vite failures and invalid facades', async () => {
    const host = await fixture();
    const thrown = await buildError({
      entry: host,
      vite: { build: async () => { throw new Error('rolldown exploded'); } },
    });
    expect(thrown.diagnostics.map((item) => item.code)).toContain('local.build.vite');

    const invalid = await buildError({
      entry: host,
      vite: {} as LocalViteApi,
    });
    expect(invalid.diagnostics.map((item) => item.code)).toContain('local.build.vite');
  });
});
