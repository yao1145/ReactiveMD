import { defineReactComponent, type LocalComponentRender } from '../react/component-api';
import { defineReactPreset } from '../react/package-core';
import type { LocalPresetPackage } from '../sdk/types';
import type { LocalStyleResource } from '../sdk/theme';
import { LOCAL_REACT_PRESET_PROTOCOL } from '../sdk/version';

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
