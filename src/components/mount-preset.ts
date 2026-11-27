import { defineReactComponent, type LocalComponentRender } from '../react/component-api';
import { defineReactPreset } from '../react/package-core';
import type { LocalPresetPackage } from '../sdk/types';
import type { LocalStyleResource } from '../sdk/theme';
import { LOCAL_REACT_PRESET_PROTOCOL } from '../sdk/version';
import { defineLocalPreset } from '../sdk/preset-core';

export function mountOfficialPreset(
  preset: LocalPresetPackage,
  views: Readonly<Record<string, LocalComponentRender>>,
  resources: readonly LocalStyleResource[] = [],
) {
  return defineReactPreset({
    protocol: LOCAL_REACT_PRESET_PROTOCOL,
    preset,
    components: preset.components.map((definition) => defineReactComponent(definition, { render: views[definition.name] })),
    resources,
  });
}

/** Pair one pack manifest with its statically imported view and resources. */
export function mountOfficialComponent(
  pack: LocalPresetPackage, name: string, view: LocalComponentRender, resources: readonly LocalStyleResource[],
) {
  const definition = pack.components.find(component => component.name === name);
  if (!definition) throw new TypeError(`Unknown component ${name} in ${pack.id}.`);
  const preset = defineLocalPreset({ protocol: pack.protocol, id: `reactive-md/default-component-${name}`,
    version: pack.version, components: [definition] });
  return mountOfficialPreset(preset, { [name]: view }, resources);
}
