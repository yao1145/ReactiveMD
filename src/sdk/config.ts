import defaultPreset from '../presets/default';
import { localHash } from './hash';
import { localJsonByteLength } from './manifest';
import {
  LOCAL_CONFIG_PROTOCOL,
  type LocalConfig,
  type LocalConfigInput,
  type LocalPresetReference,
} from './types';
import {
  CONFIG_KEYS,
  MAX_LOCAL_SDK_CONFIG_BYTES,
  checkKeys,
  componentConfigKey,
  fail,
  isPlainRecord,
  readComponents,
  readPresetReferences,
} from './config-validation';
import { defineLocalTheme } from './theme';
import type { LocalThemeInput, LocalThemePackage } from './theme';
import type { Diagnostic, LocalDocument } from '../local/contracts/types';

/** Identifiers the default preset contributes in phase one. */
export const DEFAULT_PRESET_ID = defaultPreset.id;
export const DEFAULT_PRESET_VERSION = defaultPreset.version;

/** Single frozen identity shared by every validated preset reference. */
const DEFAULT_PRESET_IDENTITY: LocalPresetReference = Object.freeze({
  id: DEFAULT_PRESET_ID,
  version: DEFAULT_PRESET_VERSION,
});

/** Bounded theme/resource registration budgets for one configuration. */
export const MAX_LOCAL_SDK_THEMES = 16;
/** Aggregate serialized-size budget for one configuration, including theme CSS. */
export { MAX_LOCAL_SDK_CONFIG_BYTES };

const INPUT_KEYS = new Set(['presets', 'components', 'themes']);
const THEME_KEYS = new Set(['id', 'name', 'version', 'protocol', 'colorSchemes', 'css']);

/**
 * Configurations produced by this module are deeply frozen and already
 * validated. Remembering them by identity keeps per-block compile keys cheap
 * without ever trusting an arbitrary caller-supplied object.
 */
const trustedConfigs = new WeakSet<object>();

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

function buildConfig(input: unknown, path: string): LocalConfig {
  if (!isPlainRecord(input)) fail(path, 'must be an object.');
  checkKeys(input, INPUT_KEYS, path);
  const presets = readPresetReferences(input.presets, DEFAULT_PRESET_IDENTITY);
  const components = readComponents(input.components, defaultPreset.components);
  const themes = readThemes(input.themes);
  const serialized = { protocol: LOCAL_CONFIG_PROTOCOL, presets, components, themes };
  if (localJsonByteLength(serialized) > MAX_LOCAL_SDK_CONFIG_BYTES) {
    fail(path, `serialized size exceeds the ${MAX_LOCAL_SDK_CONFIG_BYTES}-byte budget.`);
  }
  const config: LocalConfig = Object.freeze({
    protocol: LOCAL_CONFIG_PROTOCOL,
    key: componentConfigKey(presets, components),
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

let defaultComponentConfigKey: string | undefined;

/** Fingerprint of the manifests that the compiler actually used. */
export function localComponentConfigKey(config?: LocalConfig): string {
  return config === undefined
    ? defaultComponentConfigKey ??= createLocalConfig().key
    : readLocalConfig(config).key;
}

/** Older compiled documents have no fingerprint and retain contract-based checks. */
export function validateLocalDocumentConfig(document: LocalDocument, config?: LocalConfig): Diagnostic[] {
  if (document.componentConfigKey === undefined || document.componentConfigKey === localComponentConfigKey(config)) return [];
  return [{ code: 'local.extension.config-mismatch', severity: 'error',
    message: 'The document compiler configuration differs from the installed renderer. Recompile with the same host.config used by host.reactConfig (including Worker requests).',
    range: { start: 0, end: 0 }, line: 1, column: 1 }];
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
