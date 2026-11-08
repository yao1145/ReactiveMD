import { LOCAL_SDK_VERSION } from '../sdk/version';

/**
 * Shared identity of the built-in default preset. Keeping the identity in one
 * plain-data module lets the minimal compiler validate preset references
 * without importing the preset implementation or its component table.
 */
export const DEFAULT_PRESET_ID = 'reactive-md/default';
export const DEFAULT_PRESET_VERSION = LOCAL_SDK_VERSION;
