import { createDefaultReactPreset } from '../components/default-preset';
import type { LocalConfig } from '../sdk/types';
import { createDeferredReactConfigWithDefaults, createReactConfigWithDefaults,
  type CreateDeferredLocalReactConfigOptions, type CreateLocalReactConfigOptions } from './sdk-core';

export * from './sdk-core';

export function createReactConfig(input: LocalConfig, options: CreateLocalReactConfigOptions) {
  return createReactConfigWithDefaults(input, options, createDefaultReactPreset().components);
}

export function createDeferredReactConfig(input: LocalConfig, options: CreateDeferredLocalReactConfigOptions) {
  return createDeferredReactConfigWithDefaults(input, options, createDefaultReactPreset().components);
}
