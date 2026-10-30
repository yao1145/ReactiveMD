import { LOCAL_HTML_NAMES } from '../local/html-names';
import { DEFAULT_COMPONENT_NAMES } from '../presets/default-components';
import defaultPreset from '../presets/default';
import { localHash } from './hash';
import {
  MAX_LOCAL_SDK_COMPONENTS,
  localComponentDigest,
  localJsonByteLength,
  readLocalComponentManifest,
} from './manifest';
import {
  LOCAL_CONFIG_PROTOCOL,
  type LocalComponentDefinition,
  type LocalConfig,
  type LocalConfigInput,
  type LocalPresetReference,
} from './types';
import { LOCAL_SDK_VERSION, localVersionSatisfies } from './version';
import { defineLocalTheme } from './theme';
import type { LocalThemeInput, LocalThemePackage } from './theme';

/** Identifiers the default preset contributes in phase one. */
export const DEFAULT_PRESET_ID = defaultPreset.id;
export const DEFAULT_PRESET_VERSION = defaultPreset.version;

/** Bounded theme/resource registration budgets for one configuration. */
export const MAX_LOCAL_SDK_THEMES = 16;
/** Aggregate serialized-size budget for one configuration, including theme CSS. */
export const MAX_LOCAL_SDK_CONFIG_BYTES = 16 * 1024 * 1024;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CONFIG_KEYS = new Set(['protocol', 'key', 'presets', 'components', 'registry', 'themes']);
const INPUT_KEYS = new Set(['presets', 'components', 'themes']);
const THEME_KEYS = new Set(['id', 'name', 'version', 'protocol', 'colorSchemes', 'css']);

/**
 * Configurations produced by this module are deeply frozen and already
 * validated. Remembering them by identity keeps per-block compile keys cheap
 * without ever trusting an arbitrary caller-supplied object.
 */
const trustedConfigs = new WeakSet<object>();

function fail(path: string, message: string): never {
  throw new Error(`Invalid local SDK config (${path}): ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) fail(path, `field "${key}" is not allowed.`);
    if (!allowed.has(key)) fail(path, `unknown field "${key}".`);
  }
}

/**
 * Revalidate a theme package through the theme owner's validator. This closes
 * the gap where hand-built config data could bypass CSS scoping, resource
 * safety and size checks. `defineLocalTheme` is idempotent for packages that
 * already carry a scope for their own name.
 */
function readThemePackage(value: unknown): LocalThemePackage {
  if (!isPlainRecord(value)) fail('themes', 'each theme must be an object.');
  checkKeys(value, THEME_KEYS, 'theme');
  try {
    return defineLocalTheme(value as unknown as LocalThemeInput);
  } catch (error) {
    fail('theme', error instanceof Error ? error.message : String(error));
  }
}

function defaultPresets(): readonly LocalPresetReference[] {
  return Object.freeze([Object.freeze({ id: DEFAULT_PRESET_ID, version: DEFAULT_PRESET_VERSION })]);
}

function readPresets(value: unknown): readonly LocalPresetReference[] {
  if (value === undefined) return defaultPresets();
  if (!Array.isArray(value)) fail('presets', 'must be an array.');
  if (value.length === 0) fail('presets', 'must select at least the default preset.');
  const seen = new Set<string>();
  const presets: LocalPresetReference[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    let id: string | undefined;
    let version: string | undefined;
    if (typeof entry === 'string') {
      id = entry;
    } else if (isPlainRecord(entry)) {
      if (entry.id === undefined || typeof entry.id !== 'string') fail(`presets[${index}].id`, 'must be a string.');
      id = entry.id;
      if (entry.version !== undefined) {
        if (typeof entry.version !== 'string') fail(`presets[${index}].version`, 'must be a string.');
        version = entry.version;
      }
    } else {
      fail(`presets[${index}]`, 'must be a preset id or preset reference.');
    }
    const normalized = id === 'default' ? DEFAULT_PRESET_ID : id;
    if (normalized !== DEFAULT_PRESET_ID) {
      fail(`presets[${index}]`, `unsupported preset "${id}"; phase one accepts only "${DEFAULT_PRESET_ID}".`);
    }
    if (version !== undefined && version !== DEFAULT_PRESET_VERSION) {
      fail(`presets[${index}].version`, `must be "${DEFAULT_PRESET_VERSION}".`);
    }
    if (seen.has(DEFAULT_PRESET_ID)) fail('presets', `"${DEFAULT_PRESET_ID}" is selected more than once.`);
    seen.add(DEFAULT_PRESET_ID);
    presets.push(Object.freeze({ id: DEFAULT_PRESET_ID, version: DEFAULT_PRESET_VERSION }));
  }
  return Object.freeze(presets);
}

function builtinIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const component of defaultPreset.components) {
    ids.add(component.name);
    ids.add(component.id);
  }
  return ids;
}

function validateDependencies(components: readonly LocalComponentDefinition[]): void {
  const byId = new Map(components.map((component) => [component.id, component]));
  const builtins = builtinIds();
  for (const component of components) {
    const kernelRange = component.requires?.kernel;
    if (kernelRange !== undefined && !localVersionSatisfies(LOCAL_SDK_VERSION, kernelRange)) {
      fail('requires', `component "${component.id}" requires kernel ${kernelRange}, but ${LOCAL_SDK_VERSION} is installed.`);
    }
    for (const dependency of component.dependencies ?? []) {
      const external = byId.get(dependency.id);
      const installed = external?.version ?? (builtins.has(dependency.id) ? LOCAL_SDK_VERSION : null);
      if (installed === null) {
        fail('dependencies', `component "${component.id}" requires missing component "${dependency.id}".`);
      }
      if (dependency.version !== undefined && !localVersionSatisfies(installed, dependency.version)) {
        fail(
          'dependencies',
          `component "${component.id}" requires "${dependency.id}" ${dependency.version}, but version ${installed} is installed.`,
        );
      }
    }
  }
  // Depth-first cycle detection over external manifests only.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: readonly string[]): void => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      fail('dependencies', `dependency cycle: ${[...path, id].join(' -> ')}.`);
    }
    state.set(id, 'visiting');
    const component = byId.get(id);
    for (const dependency of component?.dependencies ?? []) {
      if (byId.has(dependency.id)) visit(dependency.id, [...path, id]);
    }
    state.set(id, 'done');
  };
  for (const id of byId.keys()) visit(id, []);
}

function readComponents(value: unknown): readonly LocalComponentDefinition[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) fail('components', 'must be an array.');
  if (value.length > MAX_LOCAL_SDK_COMPONENTS) {
    fail('components', `accepts at most ${MAX_LOCAL_SDK_COMPONENTS} external components.`);
  }
  const reserved = new Set<string>([...DEFAULT_COMPONENT_NAMES, 'computed', 'const', 'external', ...LOCAL_HTML_NAMES].map((name) => name.toLowerCase()));
  reserved.add('theme');
  const ids = new Set(defaultPreset.components.map(component => component.id));
  const names = new Set<string>();
  const components: LocalComponentDefinition[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const component = readLocalComponentManifest(value[index]);
    if (reserved.has(component.name.toLowerCase())) {
      fail(`components[${index}]`, `name "${component.name}" conflicts with a built-in component, HTML tag or theme declaration.`);
    }
    if (ids.has(component.id)) fail('components', `component id "${component.id}" is declared more than once.`);
    if (names.has(component.name)) fail('components', `component name "${component.name}" is declared more than once.`);
    ids.add(component.id);
    names.add(component.name);
    components.push(component);
  }
  validateDependencies(components);
  return Object.freeze(components);
}

function readThemes(value: unknown): readonly LocalThemePackage[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) fail('themes', 'must be an array.');
  if (value.length > MAX_LOCAL_SDK_THEMES) fail('themes', `accepts at most ${MAX_LOCAL_SDK_THEMES} themes.`);
  const ids = new Set<string>();
  const names = new Set<string>();
  const themes: LocalThemePackage[] = [];
  for (const entry of value) {
    const theme = readThemePackage(entry);
    if (ids.has(theme.id)) fail('themes', `theme id "${theme.id}" is declared more than once.`);
    if (names.has(theme.name)) fail('themes', `theme name "${theme.name}" is declared more than once.`);
    ids.add(theme.id);
    names.add(theme.name);
    themes.push(theme);
  }
  return Object.freeze(themes);
}

function canonicalPresets(presets: readonly LocalPresetReference[]): unknown {
  return [...presets]
    .map((preset) => ({ id: preset.id, version: preset.version }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Semantic configuration digest. Component contracts are included through
 * their normalized digests; themes and authoring copy are deliberately
 * excluded so restyling or editor text changes never recreate a document
 * runtime or invalidate a compile.
 */
function configKey(
  presets: readonly LocalPresetReference[],
  components: readonly LocalComponentDefinition[],
): string {
  const canonical = JSON.stringify({
    protocol: LOCAL_CONFIG_PROTOCOL,
    presets: canonicalPresets(presets),
    components: [...components]
      .map((component) => ({ id: component.id, version: component.version, digest: localComponentDigest(component) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });
  return localHash(canonical);
}

function buildConfig(input: unknown, path: string): LocalConfig {
  if (!isPlainRecord(input)) fail(path, 'must be an object.');
  checkKeys(input, INPUT_KEYS, path);
  const presets = readPresets(input.presets);
  const components = readComponents(input.components);
  const themes = readThemes(input.themes);
  const serialized = { protocol: LOCAL_CONFIG_PROTOCOL, presets, components, themes };
  if (localJsonByteLength(serialized) > MAX_LOCAL_SDK_CONFIG_BYTES) {
    fail(path, `serialized size exceeds the ${MAX_LOCAL_SDK_CONFIG_BYTES}-byte budget.`);
  }
  const config: LocalConfig = Object.freeze({
    protocol: LOCAL_CONFIG_PROTOCOL,
    key: configKey(presets, components),
    presets,
    components,
    registry: Object.freeze([...defaultPreset.components, ...components]),
    themes,
  });
  trustedConfigs.add(config);
  return config;
}

/** Create an immutable, validated instance configuration. */
export function createLocalConfig(input: LocalConfigInput = {}): LocalConfig {
  return buildConfig(input, 'config');
}

/**
 * Revalidate arbitrary configuration data, including a Worker snapshot or a
 * hand-built payload. The supplied `key` is ignored and recomputed from the
 * validated contents.
 */
export function readLocalConfig(value: unknown): LocalConfig {
  if (typeof value === 'object' && value !== null && trustedConfigs.has(value)) {
    // Already validated and deeply frozen by this module.
    return value as LocalConfig;
  }
  if (!isPlainRecord(value)) fail('config', 'must be an object.');
  checkKeys(value, CONFIG_KEYS, 'config');
  if (value.protocol !== LOCAL_CONFIG_PROTOCOL) {
    fail('config.protocol', `must be "${LOCAL_CONFIG_PROTOCOL}".`);
  }
  return buildConfig(
    { presets: value.presets, components: value.components, themes: value.themes },
    'config',
  );
}

/** Cache/transport key that never throws; invalid payloads stay distinct. */
export function localConfigKey(value: unknown): string {
  if (typeof value === 'object' && value !== null && trustedConfigs.has(value)) {
    return (value as LocalConfig).key;
  }
  try {
    return readLocalConfig(value).key;
  } catch {
    try {
      return `invalid:${localHash(JSON.stringify(value))}`;
    } catch {
      return 'invalid';
    }
  }
}

/**
 * Worker-side copy. A valid configuration is revalidated into fresh frozen
 * data; an invalid one is passed through so the compiler can report it.
 */
export function snapshotLocalConfig(value: unknown): unknown {
  try {
    return readLocalConfig(value);
  } catch {
    return value;
  }
}
