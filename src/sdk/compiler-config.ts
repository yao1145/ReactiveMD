import {
  localLegacyV1Key,
  readLocalAssemblySnapshot,
  resolveLocalAssembly,
} from './assembly';
import {
  findLocalCompatProfile,
  localCompatProfiles,
} from './compat-profile';
import type { LocalCompatProfile } from './compat-profile';
import { localJsonByteLength } from './manifest';
import { defineLocalPreset } from './preset-core';
import { CONFIG_KEYS, MAX_LOCAL_SDK_CONFIG_BYTES, checkKeys, fail, isPlainRecord, readComponents, readPresetReferences, validateCompatProfileComponents } from './config-validation';
import { LOCAL_ASSEMBLY_PROTOCOL, LOCAL_CONFIG_PROTOCOL, LOCAL_CONFIG_PROTOCOL_V2, LOCAL_PRESET_PROTOCOL } from './version';
import { DEFAULT_PRESET_ID, DEFAULT_PRESET_VERSION } from '../presets/identity';
import type {
  LocalAssemblySnapshot,
  LocalComponentDefinition,
  LocalConfig,
  LocalPresetPackage,
} from './types';

/**
 * Semantic SDK-configuration reader for single compilation.
 *
 * This module validates the data that affects compilation: presets, component
 * manifests, replacements and their dependency graph. It intentionally imports
 * neither `config.ts` nor any theme implementation, so a compiler that installs
 * no default preset can still accept a host configuration.
 */

/**
 * Phase-one default preset identity, kept as protocol data rather than by
 * importing the preset implementation. The standard compiler and this reader
 * must agree for semantic keys to remain compatible.
 */
export const DEFAULT_COMPILER_PRESET = Object.freeze({
  id: DEFAULT_PRESET_ID,
  version: DEFAULT_PRESET_VERSION,
}) as { readonly id: string; readonly version: string };

const presetCache = new WeakMap<object, LocalPresetPackage>();
const keyCache = new WeakMap<object, string>();

function presetFor(
  defaults: readonly LocalComponentDefinition[],
  identity: { readonly id: string; readonly version: string } = DEFAULT_COMPILER_PRESET,
): LocalPresetPackage | undefined {
  if (defaults.length === 0) return undefined;
  const isDefaultIdentity = identity.id === DEFAULT_COMPILER_PRESET.id
    && identity.version === DEFAULT_COMPILER_PRESET.version;
  if (isDefaultIdentity) {
    const cached = presetCache.get(defaults);
    if (cached) return cached;
  }
  const preset = defineLocalPreset({
    protocol: LOCAL_PRESET_PROTOCOL,
    id: identity.id,
    version: identity.version,
    components: defaults,
  });
  if (isDefaultIdentity) presetCache.set(defaults, preset);
  return preset;
}

function configFromAssembly(
  assembly: LocalAssemblySnapshot,
  defaults: readonly LocalComponentDefinition[],
  profiles: readonly LocalCompatProfile[],
  legacyKey?: string,
  legacyKeyProfile = 'reactive-md-config/v1',
): LocalConfig {
  const resolved = resolveLocalAssembly(assembly, {
    legacyProfiles: defaults.length > 0 ? profiles : [],
  });
  const legacyKeys = [
    ...resolved.legacyKeys,
    ...(legacyKey !== undefined && !resolved.legacyKeys.some((entry) => entry.key === legacyKey)
      ? [Object.freeze({ profile: legacyKeyProfile, key: legacyKey })]
      : []),
  ];
  return Object.freeze({
    protocol: LOCAL_CONFIG_PROTOCOL_V2,
    assembly,
    key: resolved.key,
    presets: resolved.presets,
    components: resolved.components,
    replacements: resolved.replacements,
    registry: resolved.registry,
    themes: resolved.themes,
    legacyKeys: Object.freeze(legacyKeys),
  });
}

function readAssembly(input: unknown): LocalAssemblySnapshot {
  if (!isPlainRecord(input)) fail('assembly', 'must be an object.');
  checkKeys(input, new Set(['protocol', 'presets', 'components', 'replacementPolicy', 'themes']), 'assembly');
  if (input.protocol !== LOCAL_ASSEMBLY_PROTOCOL) {
    fail('assembly.protocol', `must be "${LOCAL_ASSEMBLY_PROTOCOL}".`);
  }
  return readLocalAssemblySnapshot(input);
}

/**
 * Validate configuration data for compilation. Caller-supplied derived fields
 * are ignored; they are rebuilt from the assembly.
 *
 * `defaults` is the assembled built-in registry used when reading a legacy v1
 * payload and when validating host component names. A v2 payload carries its
 * own assembly and does not depend on `defaults`.
 */
export function readCompilerConfig(
  value: unknown,
  defaults: readonly LocalComponentDefinition[] = [],
  additionalProfiles: readonly LocalCompatProfile[] = [],
): LocalConfig {
  const profiles = localCompatProfiles(additionalProfiles);
  if (!isPlainRecord(value)) fail('config', 'must be an object.');
  checkKeys(value, CONFIG_KEYS, 'config');
  if (value.protocol === LOCAL_CONFIG_PROTOCOL_V2) {
    const assembly = readAssembly(value.assembly);
    const config = configFromAssembly(assembly, defaults, profiles);
    if (localJsonByteLength(assembly) > MAX_LOCAL_SDK_CONFIG_BYTES) {
      fail('config', `serialized size exceeds the ${MAX_LOCAL_SDK_CONFIG_BYTES}-byte budget.`);
    }
    return config;
  }
  if (value.protocol !== LOCAL_CONFIG_PROTOCOL) {
    fail('config.protocol', `must be "${LOCAL_CONFIG_PROTOCOL_V2}" (or legacy "${LOCAL_CONFIG_PROTOCOL}").`);
  }
  const requested = readPresetReferences(value.presets, DEFAULT_COMPILER_PRESET, profiles);
  const selected = requested[0] ?? DEFAULT_COMPILER_PRESET;
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
  validateCompatProfileComponents(profile, defaults);
  const components = readComponents(value.components, defaults);
  if (components.some((component) => component.replaces !== undefined)) {
    fail('config', 'replaces is not supported by reactive-md-config/v1.');
  }
  const preset = presetFor(defaults, profile.preset);
  const assembly: LocalAssemblySnapshot = Object.freeze({
    protocol: LOCAL_ASSEMBLY_PROTOCOL,
    presets: Object.freeze(preset ? [preset] : []),
    components,
    replacementPolicy: 'forbid',
    themes: Object.freeze([]),
  });
  const legacyKey = defaults.length > 0
    ? localLegacyV1Key(profile.preset, components)
    : undefined;
  const config = configFromAssembly(assembly, defaults, profiles, legacyKey, legacyRule.profile);
  if (localJsonByteLength(assembly) > MAX_LOCAL_SDK_CONFIG_BYTES) {
    fail('config', `serialized size exceeds the ${MAX_LOCAL_SDK_CONFIG_BYTES}-byte budget.`);
  }
  return config;
}

/**
 * Default semantic key for one assembled compiler profile. This replaces the
 * old preset-reference hash so the standard compiler and SDK agree on v2 keys.
 */
export function compilerDefaultConfigKey(
  defaults: readonly LocalComponentDefinition[],
): string {
  const cached = keyCache.get(defaults);
  if (cached !== undefined) return cached;
  const preset = presetFor(defaults);
  const assembly: LocalAssemblySnapshot = Object.freeze({
    protocol: LOCAL_ASSEMBLY_PROTOCOL,
    presets: Object.freeze(preset ? [preset] : []),
    components: Object.freeze([]),
    replacementPolicy: 'forbid',
    themes: Object.freeze([]),
  });
  const key = resolveLocalAssembly(assembly).key;
  keyCache.set(defaults, key);
  return key;
}
