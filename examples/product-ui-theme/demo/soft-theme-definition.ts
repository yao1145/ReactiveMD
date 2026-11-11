/**
 * SOFT — plain registration metadata for the old default appearance.
 *
 * The look itself comes from the core baseline stylesheet, so this demo only
 * needs a definition to register. Kept local to the demo because the full
 * `soft` example package is no longer part of the repository.
 */
export const softThemeDefinition = Object.freeze({
  name: 'soft',
  protocol: 'reactive-md-theme-1' as const,
  colorSchemes: Object.freeze(['light', 'dark'] as const),
});
