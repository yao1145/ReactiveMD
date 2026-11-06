import { localJsonByteLength } from './manifest';
import { LOCAL_CONFIG_PROTOCOL, LOCAL_SDK_VERSION } from './version';
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
import type {
  LocalComponentDefinition,
  LocalConfig,
  LocalPresetReference,
} from './types';

/**
 * Semantic SDK-configuration reader for single compilation.
 *
 * This module validates the configuration data that affects compilation:
 * presets, component manifests and their dependency graph. It intentionally
 * imports neither `config.ts` nor any theme implementation, so a compiler that
 * installs no default preset can still accept a host configuration.
 *
 * Host theme assets stay opaque and are excluded from the semantic snapshot.
 * The host validates those assets before loading them.
 */

/**
 * Phase-one default preset identity, kept as protocol data rather than by
 * importing the preset implementation. Update it here if the default preset
 * identity changes; the standard compiler and this reader must agree for the
 * semantic key to stay compatible with `localComponentConfigKey`.
 */
export const DEFAULT_COMPILER_PRESET: LocalPresetReference = Object.freeze({
  id: 'reactive-md/default',
  version: LOCAL_SDK_VERSION,
});

export { componentConfigKey as compilerConfigKey };

/**
 * Validate configuration data for compilation. The caller-supplied `key` and
 * `registry` are ignored; both are rebuilt from the validated semantics.
 * `defaults` is the assembled built-in registry used for reserved names,
 * dependency identifiers and the returned registry order.
 */
export function readCompilerConfig(
  value: unknown,
  defaults: readonly LocalComponentDefinition[] = [],
): LocalConfig {
  if (!isPlainRecord(value)) fail('config', 'must be an object.');
  checkKeys(value, CONFIG_KEYS, 'config');
  if (value.protocol !== LOCAL_CONFIG_PROTOCOL) {
    fail('config.protocol', `must be "${LOCAL_CONFIG_PROTOCOL}".`);
  }
  const requestedPresets = readPresetReferences(value.presets, DEFAULT_COMPILER_PRESET);
  const presets = defaults.length > 0 ? requestedPresets : Object.freeze([]);
  const components = readComponents(value.components, defaults);
  const themes = Object.freeze([]);
  const serialized = { protocol: LOCAL_CONFIG_PROTOCOL, presets, components };
  if (localJsonByteLength(serialized) > MAX_LOCAL_SDK_CONFIG_BYTES) {
    fail('config', `serialized size exceeds the ${MAX_LOCAL_SDK_CONFIG_BYTES}-byte budget.`);
  }
  return Object.freeze({
    protocol: LOCAL_CONFIG_PROTOCOL,
    key: componentConfigKey(presets, components),
    presets,
    components,
    registry: Object.freeze([...defaults, ...components]),
    themes,
  });
}
