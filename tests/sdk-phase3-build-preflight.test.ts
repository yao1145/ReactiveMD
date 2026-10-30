import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLocalConfig,
  defineLocalComponent,
  defineLocalTheme,
} from '../src/sdk';
import { localComponentDigest } from '../src/sdk/manifest';
import type { LocalComponentDefinition, LocalConfig } from '../src/sdk/types';
import {
  preflightLocalStandaloneBuild,
} from '../src/build';
import { createLocalStandaloneEntrySource } from '../src/build/entry';

const directories: string[] = [];
let hostCounter = 0;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'reactive-md-build-'));
  directories.push(directory);
  await mkdir(join(directory, 'styles'), { recursive: true });
  return directory;
}

function component(overrides: Partial<LocalComponentDefinition> = {}): LocalComponentDefinition {
  return defineLocalComponent({
    id: 'demo/rating',
    name: 'demo-rating',
    version: '1.0.0',
    protocol: 'reactive-md-component/v1',
    form: 'leaf',
    props: {},
    styles: ['demo/rating.css'],
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
    ...overrides,
  } as LocalComponentDefinition);
}

function configFor(
  definition: LocalComponentDefinition = component(),
  themes: LocalConfig['themes'] = [],
): LocalConfig {
  return createLocalConfig({ components: [definition], themes });
}

function configData(config: LocalConfig): unknown {
  return {
    protocol: config.protocol,
    key: config.key,
    presets: config.presets,
    components: config.components,
    themes: config.themes,
  };
}

function reactConfigData(config: LocalConfig): unknown {
  return {
    config: configData(config),
    components: config.components.map((definition) => ({
      definition,
      digest: localComponentDigest(definition),
    })),
  };
}

interface HostFixture {
  readonly config?: LocalConfig;
  readonly reactConfigConfig?: LocalConfig;
  readonly allowlist?: readonly string[];
  readonly resources?: readonly unknown[];
  readonly notices?: unknown;
  readonly omitRoot?: boolean;
  readonly omitAllowlist?: boolean;
  readonly staleConfigKey?: string;
}

async function writeHost(directory: string, fixture: HostFixture = {}): Promise<string> {
  const config = fixture.config ?? configFor();
  const reactConfigConfig = fixture.reactConfigConfig ?? config;
  const exportedConfig = fixture.staleConfigKey === undefined
    ? configData(config)
    : { ...(configData(config) as Record<string, unknown>), key: fixture.staleConfigKey };
  const lines = [
    `export const config = ${JSON.stringify(exportedConfig, null, 2)};`,
    `export const reactConfig = ${JSON.stringify(reactConfigData(reactConfigConfig), null, 2)};`,
    fixture.omitRoot ? '' : 'export const root = new URL("./", import.meta.url);',
    fixture.omitAllowlist ? '' : `export const allowlist = ${JSON.stringify(fixture.allowlist ?? ['styles'])};`,
    `export const resources = ${JSON.stringify(fixture.resources ?? [{ id: 'demo/rating.css', path: 'styles/main.css' }])};`,
    fixture.notices === undefined ? '' : `export const notices = ${JSON.stringify(fixture.notices)};`,
  ];
  const hostPath = join(directory, `host-${hostCounter++}.mjs`);
  await writeFile(hostPath, lines.filter(Boolean).join('\n'), 'utf8');
  return hostPath;
}

async function writeStyles(directory: string, files: Record<string, string>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const file = join(directory, 'styles', name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('standalone build preflight', () => {
  it('validates the host config, implementations, component CSS and determinism', async () => {
    const directory = await temporaryDirectory();
    const config = configFor();
    await writeStyles(directory, {
      'main.css': '@import "./child.css";\n.demo-rating { background: url("./pixel.png"); }',
      'child.css': '.child { color: red; }',
    });
    await writeFile(join(directory, 'styles', 'pixel.png'), PIXEL);
    const host = await writeHost(directory, { config });

    const first = await preflightLocalStandaloneBuild({ entry: host });
    const second = await preflightLocalStandaloneBuild({ entry: host });

    expect(first.ok).toBe(true);
    expect(first.configKey).toBe(config.key);
    expect(first.resources.map((resource) => resource.id)).toEqual(['demo/rating.css']);
    expect(first.resources[0]?.css).toContain('.child');
    expect(first.resources[0]?.css).toContain('data:image/png;base64,');
    expect(first.assets.map((asset) => asset.path)).toEqual([
      'styles/child.css',
      'styles/main.css',
      'styles/pixel.png',
    ]);
    expect(JSON.stringify(first.resources)).toBe(JSON.stringify(second.resources));
    expect(JSON.stringify(first.assets)).toBe(JSON.stringify(second.assets));
    expect(first.notices.text).toBe('');
  });

  it('collects component resources before themes in config order', async () => {
    const directory = await temporaryDirectory();
    const paper = defineLocalTheme({
      id: 'demo/paper',
      name: 'paper',
      version: '1.0.0',
      protocol: 'reactive-md-theme-1',
      css: [{ id: 'demo/paper.css', css: '[data-rmd-theme="paper"] { --ink: #26302d; }' }],
    });
    await writeStyles(directory, { 'main.css': '.demo-rating { color: var(--ink); }' });
    const host = await writeHost(directory, { config: configFor(component(), [paper]) });

    const preflight = await preflightLocalStandaloneBuild({ entry: host });

    expect(preflight.ok).toBe(true);
    expect(preflight.resources.map((resource) => [resource.id, resource.origin])).toEqual([
      ['demo/rating.css', 'component'],
      ['demo/paper.css', 'theme'],
    ]);
  });

  it('rejects remote, missing, escaped, cyclic and over-budget resources', async () => {
    const directory = await temporaryDirectory();
    const config = configFor();
    await writeStyles(directory, {
      'main.css': '@import "./cycle.css";\n.demo-rating { background: url(https://example.com/a.png); }',
      'cycle.css': '@import "./main.css";',
    });
    await writeFile(join(directory, 'outside.css'), '.outside { color: red; }');

    const remoteHost = await writeHost(directory, { config });
    const remote = await preflightLocalStandaloneBuild({ entry: remoteHost });
    expect(remote.ok).toBe(false);
    expect(remote.diagnostics.map((item) => item.code)).toContain('local.build.resource-remote');
    expect(remote.diagnostics.map((item) => item.code)).toContain('local.build.resource-cycle');

    const missingHost = await writeHost(directory, {
      config,
      resources: [{ id: 'demo/rating.css', path: 'styles/missing.css' }],
    });
    const missing = await preflightLocalStandaloneBuild({ entry: missingHost });
    expect(missing.diagnostics.map((item) => item.code)).toContain('local.build.resource-missing');

    const escapedHost = await writeHost(directory, {
      config,
      resources: [{ id: 'demo/rating.css', path: '../outside.css' }],
    });
    const escaped = await preflightLocalStandaloneBuild({ entry: escapedHost });
    expect(escaped.diagnostics.map((item) => item.code)).toContain('local.build.resource-traversal');

    const budgetHost = await writeHost(directory, { config });
    const budget = await preflightLocalStandaloneBuild({ entry: budgetHost, budgets: { maxFileBytes: 4 } });
    expect(budget.diagnostics.map((item) => item.code)).toContain('local.build.resource-budget');
  });

  it('reports missing component CSS, conflicting declarations and stale config keys', async () => {
    const directory = await temporaryDirectory();
    const config = configFor();
    const noStyles = await writeHost(directory, { config, resources: [] });
    const missing = await preflightLocalStandaloneBuild({ entry: noStyles });
    expect(missing.diagnostics.map((item) => item.code)).toContain('local.extension.resource-missing');

    await writeStyles(directory, { 'main.css': '.demo-rating { color: red; }' });
    const conflictHost = await writeHost(directory, { config });
    const conflict = await preflightLocalStandaloneBuild({
      entry: conflictHost,
      resources: [{ id: 'demo/rating.css', css: '.demo-rating { color: blue; }' }],
    });
    expect(conflict.diagnostics.map((item) => item.code)).toContain('local.build.resource-conflict');

    const staleHost = await writeHost(directory, { config, staleConfigKey: 'rmd-0000000000000000' });
    const stale = await preflightLocalStandaloneBuild({ entry: staleHost });
    expect(stale.diagnostics.map((item) => item.code)).toContain('local.build.config-key');
  });

  it('rejects mismatched React configs, missing implementations and unsupported capabilities', async () => {
    const directory = await temporaryDirectory();
    const definition = component();
    const config = configFor(definition);
    const other = createLocalConfig({});
    const mismatchHost = await writeHost(directory, { config, reactConfigConfig: other });
    const mismatch = await preflightLocalStandaloneBuild({ entry: mismatchHost });
    expect(mismatch.diagnostics.map((item) => item.code)).toContain('local.build.config');

    const offline = component({
      id: 'demo/offline',
      name: 'demo-offline',
      styles: [],
      capabilities: { interactive: true, static: true, ssr: false, offline: false },
    });
    const offlineHost = await writeHost(directory, { config: configFor(offline), resources: [] });
    const capability = await preflightLocalStandaloneBuild({ entry: offlineHost });
    expect(capability.diagnostics.map((item) => item.code)).toContain('local.extension.export-capability');
  });

  it('requires explicit root and allowlist exports', async () => {
    const directory = await temporaryDirectory();
    await writeStyles(directory, { 'main.css': '.demo-rating { color: red; }' });
    const missingRoot = await writeHost(directory, { omitRoot: true });
    const rootResult = await preflightLocalStandaloneBuild({ entry: missingRoot });
    expect(rootResult.diagnostics.map((item) => item.code)).toContain('local.build.host');

    const missingAllowlist = await writeHost(directory, { omitAllowlist: true });
    const allowlistResult = await preflightLocalStandaloneBuild({ entry: missingAllowlist });
    expect(allowlistResult.diagnostics.map((item) => item.code)).toContain('local.build.host');
  });

  it('deduplicates notices deterministically and reports conflicts', async () => {
    const directory = await temporaryDirectory();
    await writeStyles(directory, { 'main.css': '.demo-rating { color: red; }' });
    const notices = [
      { id: 'zeta', license: 'MIT' },
      { id: 'alpha', name: 'alpha', version: '1.0.0', text: 'Alpha notice' },
    ];
    const host = await writeHost(directory, { notices });
    const preflight = await preflightLocalStandaloneBuild({ entry: host });
    expect(preflight.ok).toBe(true);
    expect(preflight.notices.entries.map((entry) => entry.id)).toEqual(['alpha', 'zeta']);
    expect(preflight.notices.text).toContain('alpha (alpha 1.0.0)');

    const conflictHost = await writeHost(directory, {
      notices: [{ id: 'same', license: 'MIT' }, { id: 'same', license: 'Apache-2.0' }],
    });
    const conflict = await preflightLocalStandaloneBuild({ entry: conflictHost });
    expect(conflict.diagnostics.map((item) => item.code)).toContain('local.build.notice-conflict');
  });
});

describe('standalone entry', () => {
  it('bakes the config key and checks both host exports at runtime', () => {
    const source = createLocalStandaloneEntrySource('rmd-0123456789abcdef');
    expect(source).toContain('mountAll');
    expect(source).toContain('rmd-0123456789abcdef');
    expect(source).toContain('installed.key !== __reactiveMDExpectedConfigKey');
    expect(source).toContain('declared.key !== __reactiveMDExpectedConfigKey');
    expect(() => createLocalStandaloneEntrySource('not-a-key')).toThrow(TypeError);
  });
});
