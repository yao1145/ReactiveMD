import { defineLocalPreset } from '../sdk/preset-core';
import { LOCAL_PRESET_PROTOCOL } from '../sdk/version';
import { DEFAULT_COMPONENT_DEFINITIONS } from './default-components';
import { DEFAULT_PRESET_VERSION } from './identity';

export function selectOfficialPreset(id: string, names: readonly string[], dependencies: readonly string[] = []) {
  const components = DEFAULT_COMPONENT_DEFINITIONS.filter((definition) => names.includes(definition.name));
  if (components.length !== names.length) throw new Error(`Invalid official component list for ${id}.`);
  return defineLocalPreset({
    id,
    version: DEFAULT_PRESET_VERSION,
    protocol: LOCAL_PRESET_PROTOCOL,
    components,
    dependencies: dependencies.map((id) => ({ id, version: DEFAULT_PRESET_VERSION })),
  });
}
