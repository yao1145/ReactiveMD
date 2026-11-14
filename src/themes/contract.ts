/** Public styling contract, independent of the document theme-name protocol. */
export const LOCAL_STYLE_CONTRACT = 'reactive-md-styles-1' as const;

/** Earlier layers supply the baseline; later layers apply deliberate overrides. */
export const LOCAL_STYLE_LAYERS = Object.freeze([
  'rmd.reset',
  'rmd.defaults',
  'rmd.components',
  'rmd.themes',
  'rmd.overrides',
] as const);

export const LOCAL_THEME_STYLE_LAYER = 'rmd.themes' as const;

/** Declare before any resource so module evaluation order cannot reorder layers. */
export const LOCAL_STYLE_LAYER_ORDER = `@layer ${LOCAL_STYLE_LAYERS.join(', ')};`;
