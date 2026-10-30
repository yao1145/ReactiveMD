import { DEFAULT_COMPONENT_DEFINITIONS } from './default-components';
import { LOCAL_SDK_VERSION } from '../sdk/version';
import type { LocalComponentDefinition } from '../sdk/types';

/**
 * The default component preset. Its components are ordinary public SDK
 * manifests, validated by `defineLocalComponent` at construction. Language
 * declarations (`theme`, `computed`, `const`, `external`) remain kernel grammar
 * metadata and are not preset components.
 */
export interface LocalDefaultPreset {
  readonly id: string;
  readonly version: string;
  readonly components: readonly LocalComponentDefinition[];
}

export const defaultPreset: LocalDefaultPreset = Object.freeze({
  id: 'reactive-md/default',
  version: LOCAL_SDK_VERSION,
  components: DEFAULT_COMPONENT_DEFINITIONS,
});

export default defaultPreset;
