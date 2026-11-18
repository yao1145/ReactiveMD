import { createDefaultReactPreset } from '../components/default-preset';
import type { LocalConfig } from '../sdk/types';
import { createReactConfigWithDefaults, type CreateLocalReactConfigOptions } from './sdk-core';

export * from './sdk-core';

export function createReactConfig(input: LocalConfig, options: CreateLocalReactConfigOptions) {
  return createReactConfigWithDefaults(input, options, createDefaultReactPreset().components);
}
