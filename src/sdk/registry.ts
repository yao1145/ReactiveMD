import { DEFAULT_COMPONENT_DEFINITIONS, DEFAULT_COMPONENT_NAMES } from '../presets/default-components';
import type { LocalComponentSchema } from '../local/configuration/schema';
import type { LocalComponentDefinition, LocalConfig } from './types';
import { readLocalConfig } from './config';
import { componentSchemaFromDefinition } from './registry-core';

/** The 46 rendered/structural default manifests. */
export { DEFAULT_COMPONENT_DEFINITIONS, DEFAULT_COMPONENT_NAMES };
export { componentSchemaFromDefinition, localComponentSchema } from './registry-core';

function defaultRegistry(): readonly LocalComponentDefinition[] {
  return DEFAULT_COMPONENT_DEFINITIONS;
}

/**
 * Resolve the full validated component snapshot: the default preset followed by
 * instance-level external components. Builtins and extensions share one list.
 * A raw configuration cannot smuggle in invalid, duplicate or reserved
 * manifests through a forged `registry` field; the snapshot is rebuilt from
 * validated externally supplied components and cached per configuration.
 */
export function getLocalComponentRegistry(config?: LocalConfig): readonly LocalComponentDefinition[] {
  if (!config) return defaultRegistry();
  return readLocalConfig(config).registry;
}

/** Look up one definition by tag name in the resolved registry. */
export function getLocalComponentDefinition(name: string, config?: LocalConfig): LocalComponentDefinition | undefined {
  const registry = getLocalComponentRegistry(config);
  for (const definition of registry) {
    if (definition.name === name) return definition;
  }
  return undefined;
}

/** Name-keyed schema view of the resolved registry. */
export function localComponentSchemas(config?: LocalConfig): ReadonlyMap<string, LocalComponentSchema> {
  const map = new Map<string, LocalComponentSchema>();
  for (const definition of getLocalComponentRegistry(config)) {
    map.set(definition.name, componentSchemaFromDefinition(definition));
  }
  return map;
}
