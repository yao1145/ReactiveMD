import {
  localLegacyV1Key,
  readLocalAssemblySnapshot,
  resolveLocalAssembly,
} from './assembly';
import { localJsonByteLength } from './manifest';
import { defineLocalPreset } from './preset-core';
import { CONFIG_KEYS, MAX_LOCAL_SDK_CONFIG_BYTES, checkKeys, fail, isPlainRecord, readComponents, readPresetReferences } from './config-validation';
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

function presetFor(defaults: readonly LocalComponentDefinition[]): LocalPresetPackage | undefined {
  if (defaults.length === 0) return undefined;
  const cached = presetCache.get(defaults);
  if (cached) return cached;
  const preset = defineLocalPreset({
    protocol: LOCAL_PRESET_PROTOCOL,
    id: DEFAULT_COMPILER_PRESET.id,
    version: DEFAULT_COMPILER_PRESET.version,
    components: defaults,
  });
  presetCache.set(defaults, preset);
  return preset;
}

function configFromAssembly(
  assembly: LocalAssemblySnapshot,
  defaults: readonly LocalComponentDefinition[],
  legacyKey?: string,
): LocalConfig {
  const resolved = resolveLocalAssembly(assembly, {
    ...(defaults.length > 0 ? { legacyDefaultPreset: DEFAULT_COMPILER_PRESET } : {}),
  });
  const legacyKeys = [
    ...resolved.legacyKeys,
    ...(legacyKey !== undefined && !resolved.legacyKeys.some((entry) => entry.key === legacyKey)
      ? [Object.freeze({ profile: 'reactive-md-config/v1', key: legacyKey })]
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
): LocalConfig {
  if (!isPlainRecord(value)) fail('config', 'must be an object.');
  checkKeys(value, CONFIG_KEYS, 'config');
  if (value.protocol === LOCAL_CONFIG_PROTOCOL_V2) {
    const assembly = readAssembly(value.assembly);
    const config = configFromAssembly(assembly, defaults);
    if (localJsonByteLength(assembly) > MAX_LOCAL_SDK_CONFIG_BYTES) {
      fail('config', `serialized size exceeds the ${MAX_LOCAL_SDK_CONFIG_BYTES}-byte budget.`);
    }
    return config;
  }
  if (value.protocol !== LOCAL_CONFIG_PROTOCOL) {
    fail('config.protocol', `must be "${LOCAL_CONFIG_PROTOCOL_V2}" (or legacy "${LOCAL_CONFIG_PROTOCOL}").`);
  }
  const requested = readPresetReferences(value.presets, DEFAULT_COMPILER_PRESET);
  const components = readComponents(value.components, defaults);
  if (components.some((component) => component.replaces !== undefined)) {
    fail('config', 'replaces is not supported by reactive-md-config/v1.');
  }
  const preset = presetFor(defaults);
  const assembly: LocalAssemblySnapshot = Object.freeze({
    protocol: LOCAL_ASSEMBLY_PROTOCOL,
    presets: Object.freeze(preset ? [preset] : []),
    components,
    replacementPolicy: 'forbid',
    themes: Object.freeze([]),
  });
  const legacyKey = defaults.length > 0
    ? localLegacyV1Key(
      { id: requested[0]?.id ?? DEFAULT_COMPILER_PRESET.id, version: requested[0]?.version ?? DEFAULT_COMPILER_PRESET.version },
      components,
    )
    : undefined;
  const config = configFromAssembly(assembly, defaults, legacyKey);
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
