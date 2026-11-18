import defaultPreset from '../presets/default';
import { createDefaultReactPreset } from '../components/default-preset';
import { LOCAL_REACT_PRESET_PROTOCOL } from '../sdk/types';
import { createReactHostWithBase, defineReactPreset, type LocalReactHostInput, type LocalReactPresetPackage } from './package-core';

export * from './package-core';

/** Default semantic preset paired with the built-in React implementation table. */
export const defaultReactPresetPackage: LocalReactPresetPackage = defineReactPreset({
  protocol: LOCAL_REACT_PRESET_PROTOCOL,
  preset: defaultPreset,
  components: createDefaultReactPreset().components,
});

export function createReactHost(input: LocalReactHostInput = {}) {
  return createReactHostWithBase(input, defaultReactPresetPackage);
}
