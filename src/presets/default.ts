import { defineLocalPreset } from '../sdk/preset-core';
import { LOCAL_PRESET_PROTOCOL } from '../sdk/version';
import type { LocalPresetPackage } from '../sdk/types';
import { DEFAULT_COMPONENT_DEFINITIONS } from './default-components';
import { DEFAULT_PRESET_ID, DEFAULT_PRESET_VERSION } from './identity';

/**
 * The default component preset. Its components are ordinary public SDK
 * manifests, validated by `defineLocalComponent` at construction. Language
 * declarations (`theme`, `computed`, `const`, `external`) remain kernel grammar
 * metadata and are not preset components.
 */
export interface LocalDefaultPreset extends LocalPresetPackage {}

export const defaultPreset: LocalDefaultPreset = defineLocalPreset({
  protocol: LOCAL_PRESET_PROTOCOL,
  id: DEFAULT_PRESET_ID,
  version: DEFAULT_PRESET_VERSION,
  components: DEFAULT_COMPONENT_DEFINITIONS,
});

export default defaultPreset;
