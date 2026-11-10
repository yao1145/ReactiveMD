import defaultPreset from '../presets/default';
import {
  LOCAL_COMPAT_PROFILES,
  findLocalCompatProfile,
  localCompatProfiles,
} from './compat-profile';
import type { LocalCompatProfile } from './compat-profile';
import {
  localConfigFromAssembly,
  localLegacyV1Key,
  readLocalAssemblySnapshot,
  resolveLocalAssembly,
} from './assembly';
import { localHash } from './hash';
import { localJsonByteLength, readLocalComponentManifest } from './manifest';
import { readLocalPresetPackage } from './preset';
import { defineLocalTheme } from './theme';
import type { LocalThemeInput, LocalThemePackage } from './theme';
import {
  LOCAL_ASSEMBLY_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL_V2,
} from './version';
import type {
  LocalAssemblySnapshot,
  LocalConfig,
  LocalConfigInput,
  LocalPresetInput,
  LocalPresetPackage,
  LocalPresetReference,
} from './types';
import type { Diagnostic, LocalDocument } from '../local/contracts/types';
import {
  CONFIG_KEYS,
  MAX_LOCAL_SDK_CONFIG_BYTES,
  checkKeys,
  fail,
  isPlainRecord,
  readComponents,
  readPresetReferences,
  validateCompatProfileComponents,
} from './config-validation';

/** Identifiers the default preset contributes in phase one. */
export const DEFAULT_PRESET_ID = defaultPreset.id;
export const DEFAULT_PRESET_VERSION = defaultPreset.version;

const DEFAULT_PRESET_IDENTITY: LocalPresetReference = Object.freeze({
  id: DEFAULT_PRESET_ID,
  version: DEFAULT_PRESET_VERSION,
});

/** Bounded theme/resource registration budgets for one configuration. */
export const MAX_LOCAL_SDK_THEMES = 16;
/** Aggregate serialized-size budget for one configuration, including theme CSS. */
export { MAX_LOCAL_SDK_CONFIG_BYTES };

const INPUT_KEYS = new Set(['presets', 'components', 'replacements', 'themes']);

/**
 * Configurations produced by this module are deeply frozen and already
 * validated. Remembering them by identity keeps per-block compile keys cheap
 * without ever trusting an arbitrary caller-supplied object.
 */
const trustedConfigs = new WeakSet<object>();

function readThemePackage(value: unknown): LocalThemePackage {
  if (!isPlainRecord(value)) fail('themes', 'each theme must be an object.');
  checkKeys(value, new Set(['id', 'name', 'version', 'protocol', 'colorSchemes', 'css']), 'theme');
  try {
    return defineLocalTheme(value as unknown as LocalThemeInput);
  } catch (error) {
    fail('theme', error instanceof Error ? error.message : String(error));
  }
}

function readInputThemes(value: unknown): readonly LocalThemePackage[] {
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
  return Object.freeze(themes.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)));
}

function readPresetInput(value: unknown, index: number): LocalPresetPackage {
  if (typeof value === 'string') {
    if (value !== 'default' && value !== defaultPreset.id) {
      fail(`presets[${index}]`, `unsupported preset "${value}"; phase one accepts only the built-in default package.`);
    }
    return defaultPreset;
  }
  if (!isPlainRecord(value)) fail(`presets[${index}]`, 'must be a preset package, "default" or a preset reference.');
  if (value.protocol !== undefined || value.components !== undefined) {
    try {
      return readLocalPresetPackage(value);
    } catch (error) {
      fail(`presets[${index}]`, error instanceof Error ? error.message : String(error));
    }
  }
  const id = value.id;
  const version = value.version;
  if (typeof id !== 'string') fail(`presets[${index}].id`, 'must be a string.');
  if (typeof version !== 'string') fail(`presets[${index}].version`, 'must be a string.');
  const normalized = id === 'default' ? defaultPreset.id : id;
  if (normalized !== defaultPreset.id) {
    fail(`presets[${index}]`, `unsupported preset "${id}"; phase one accepts only "${defaultPreset.id}".`);
  }
  if (version !== defaultPreset.version) fail(`presets[${index}].version`, `must be "${defaultPreset.version}".`);
  return defaultPreset;
}

function readPresetInputs(value: unknown): readonly LocalPresetPackage[] {
  if (value === undefined) return Object.freeze([defaultPreset]);
  if (!Array.isArray(value)) fail('presets', 'must be an array.');
  const presets: LocalPresetPackage[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const preset = readPresetInput(value[index], index);
    if (seen.has(preset.id)) fail('presets', `preset "${preset.id}" is selected more than once.`);
    seen.add(preset.id);
    presets.push(preset);
  }
  return Object.freeze([...presets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

function readInputComponents(value: unknown): readonly ReturnType<typeof readLocalComponentManifest>[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) fail('components', 'must be an array.');
  const components = value.map((entry, index) => {
    try {
      return readLocalComponentManifest(entry);
    } catch (error) {
      fail(`components[${index}]`, error instanceof Error ? error.message : String(error));
    }
  });
  return Object.freeze(components.sort((left, right) => {
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    const leftReplacement = left.replaces === undefined ? 0 : 1;
    const rightReplacement = right.replaces === undefined ? 0 : 1;
    if (leftReplacement !== rightReplacement) return leftReplacement - rightReplacement;
    if (left.version !== right.version) return left.version < right.version ? -1 : 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  }));
}

function readReplacementPolicy(value: unknown): 'allow' | 'forbid' {
  if (value === undefined) return 'allow';
  if (value !== 'allow' && value !== 'forbid') fail('replacements', 'must be "allow" or "forbid".');
  return value;
}

function buildAssembly(input: unknown, path: string): LocalAssemblySnapshot {
  if (!isPlainRecord(input)) fail(path, 'must be an object.');
  checkKeys(input, INPUT_KEYS, path);
  const assembly: LocalAssemblySnapshot = Object.freeze({
    protocol: LOCAL_ASSEMBLY_PROTOCOL,
    presets: readPresetInputs(input.presets),
    components: readInputComponents(input.components),
    replacementPolicy: readReplacementPolicy(input.replacements),
    themes: readInputThemes(input.themes),
  });
  if (localJsonByteLength(assembly) > MAX_LOCAL_SDK_CONFIG_BYTES) {
    fail(path, `serialized size exceeds the ${MAX_LOCAL_SDK_CONFIG_BYTES}-byte budget.`);
  }
  return assembly;
}

function normalizeAssembly(assembly: LocalAssemblySnapshot): LocalAssemblySnapshot {
  return Object.freeze({
    ...assembly,
    presets: Object.freeze(assembly.presets.map((preset) => readLocalPresetPackage(preset))),
    themes: readInputThemes(assembly.themes),
  });
}

function buildConfigFromAssembly(assembly: LocalAssemblySnapshot): LocalConfig {
  const normalized = normalizeAssembly(assembly);
  const resolved = resolveLocalAssembly(normalized, {
    legacyProfiles: LOCAL_COMPAT_PROFILES,
  });
  const config = localConfigFromAssembly(normalized, resolved);
  trustedConfigs.add(config);
  return config;
}

/** Create an immutable, validated instance configuration. */
export function createLocalConfig(input: LocalConfigInput = {}): LocalConfig {
  return buildConfigFromAssembly(buildAssembly(input, 'config'));
}

let defaultComponentConfigKey: string | undefined;

/** Fingerprint of the manifests that the compiler actually used. */
export function localComponentConfigKey(config?: LocalConfig): string {
  return config === undefined
    ? defaultComponentConfigKey ??= createLocalConfig().key
    : readLocalConfig(config).key;
}

function legacyAliasKeys(config: LocalConfig): ReadonlySet<string> {
  return new Set(config.legacyKeys.map((entry) => entry.key));
}

/** Older compiled documents have no fingerprint and retain contract-based checks. */
export function validateLocalDocumentConfig(document: LocalDocument, config?: LocalConfig): Diagnostic[] {
  const installed = readLocalConfig(config ?? createLocalConfig());
  const documentKey = document.componentConfigKey;
  if (documentKey === undefined) return [];
  if (documentKey === installed.key || legacyAliasKeys(installed).has(documentKey)) return [];
  return [{ code: 'local.extension.config-mismatch', severity: 'error',
    message: 'The document compiler configuration differs from the installed renderer. Recompile with the same host.config used by host.reactConfig (including Worker requests).',
    range: { start: 0, end: 0 }, line: 1, column: 1 }];
}

/**
 * Build the semantic preset for a profile hit. The current built-in package is
 * reused only when the profile identity is the current default; otherwise the
 * profile identity names the same verified default semantics.
 */
function presetForCompatProfile(profile: LocalCompatProfile): LocalPresetPackage {
  if (profile.preset.id === defaultPreset.id && profile.preset.version === defaultPreset.version) {
    return defaultPreset;
  }
  return readLocalPresetPackage({
    ...defaultPreset,
    id: profile.preset.id,
    version: profile.preset.version,
  });
}

/**
 * Read a v1 configuration through a compatibility profile. v1 never carried
 * replacements or custom presets; both become migration errors instead of
 * being silently accepted.
 */
function readLegacyConfig(
  value: Record<string, unknown>,
  profiles: readonly LocalCompatProfile[],
): LocalConfig {
  const requested = readPresetReferences(value.presets, DEFAULT_PRESET_IDENTITY, profiles);
  const selected = requested[0] ?? DEFAULT_PRESET_IDENTITY;
  const profile = findLocalCompatProfile(selected, profiles);
  if (profile === undefined) {
    fail(
      'presets',
      `local.config.migration-unsupported: no compatibility profile matches preset "${selected.id}" ${selected.version}.`,
    );
  }
  const legacyRule = profile.legacyKeys[0];
  if (legacyRule === undefined) {
    fail(
      'presets',
      `local.config.migration-unsupported: profile "${profile.name}" has no legacy key mapping.`,
    );
  }
  validateCompatProfileComponents(profile, defaultPreset.components);
  const preset = presetForCompatProfile(profile);
  const components = readComponents(value.components, defaultPreset.components);
  if (components.some((component) => component.replaces !== undefined)) {
    fail('config', 'replaces is not supported by reactive-md-config/v1.');
  }
  const themes = readInputThemes(value.themes);
  const assembly: LocalAssemblySnapshot = Object.freeze({
    protocol: LOCAL_ASSEMBLY_PROTOCOL,
    presets: Object.freeze([preset]),
    components,
    replacementPolicy: 'forbid',
    themes,
  });
  const resolved = resolveLocalAssembly(assembly, { legacyProfiles: profiles });
  const legacyKey = localLegacyV1Key(profile.preset, resolved.components);
  const legacyKeys = [
    ...resolved.legacyKeys,
    ...(resolved.legacyKeys.some((entry) => entry.key === legacyKey)
      ? []
      : [Object.freeze({ profile: legacyRule.profile, key: legacyKey })]),
  ];
  const config = localConfigFromAssembly(assembly, resolved, legacyKeys);
  trustedConfigs.add(config);
  return config;
}

/**
 * Revalidate arbitrary configuration data, including a Worker snapshot or a
 * hand-built payload. Supplied derived fields are ignored and rebuilt from the
 * assembly snapshot.
 *
 * `additionalProfiles` extends the SDK-built-in compatibility table with
 * explicit data. It never infers a legacy identity from the current SDK
 * version.
 */
export function readLocalConfig(
  value: unknown,
  additionalProfiles: readonly LocalCompatProfile[] = [],
): LocalConfig {
  if (typeof value === 'object' && value !== null && trustedConfigs.has(value)) {
    return value as LocalConfig;
  }
  if (!isPlainRecord(value)) fail('config', 'must be an object.');
  checkKeys(value, CONFIG_KEYS, 'config');
  if (value.protocol === LOCAL_CONFIG_PROTOCOL) {
    return readLegacyConfig(value, localCompatProfiles(additionalProfiles));
  }
  if (value.protocol !== LOCAL_CONFIG_PROTOCOL_V2) {
    fail('config.protocol', `must be "${LOCAL_CONFIG_PROTOCOL_V2}" (or legacy "${LOCAL_CONFIG_PROTOCOL}").`);
  }
  const assembly = readLocalAssemblySnapshot(value.assembly);
  return buildConfigFromAssembly(assembly);
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

export type { LocalPresetInput };
