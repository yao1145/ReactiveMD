/**
 * Default preset descriptor. Phase one supports exactly this preset; the
 * component schemas it implies remain the compiler's built-in table so no
 * React or browser dependency enters the preset entry.
 */
export const defaultPreset = Object.freeze({
  id: 'reactive-md/default',
  version: '0.6.1',
} as const);

export default defaultPreset;
