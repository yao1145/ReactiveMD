/**
 * SOFT — plain registration metadata for the old default appearance.
 *
 * The look itself comes from the core baseline stylesheet. This package adds
 * no CSS resources; it only gives hosts a definition to register so documents
 * can select `<theme name="soft">`.
 *
 * Kept dependency-free so tooling and tests can import it without the SDK.
 */
export const softThemeDefinition = Object.freeze({
  name: 'soft',
  protocol: 'reactive-md-theme-1' as const,
  colorSchemes: Object.freeze(['light', 'dark'] as const),
});
