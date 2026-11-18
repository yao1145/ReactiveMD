/**
 * Lightweight leaf-tag syntax shared by both compiler assemblies.
 *
 * The complete default preset contributes these tags with `form: 'leaf'`. A
 * minimal assembly deliberately does not import that preset: its semantic
 * manifests, expression ranges and authoring copy stay out of the light
 * compiler graph. The parser still has to tell an official leaf tag that the
 * selected preset did not mount from an ordinary unknown tag. Without that
 * distinction `<counter>` reads as a line-leading unknown container with no
 * closing tag and fails the whole document, while the same minimal config in
 * the standard assembly keeps it literal with one `local.component.unknown`
 * diagnostic.
 *
 * This module is plain data. Keep it free of preset, SDK, theme, React and
 * authoring imports so both entries can share it.
 */

/** Official leaf tags of the complete default preset, in alphabetical order. */
export const OFFICIAL_LEAF_TAGS: readonly string[] = Object.freeze([
  'anchor',
  'checkbox',
  'column',
  'coordinate',
  'counter',
  'date',
  'edge',
  'input',
  'number',
  'progress',
  'range-slider',
  'slider',
  'textarea',
  'timer',
  'toggle',
  'validation',
]);

/**
 * Official leaf tags the active registry does not mount. An explicitly selected
 * minimal preset asks for this set; callers keep their existing behavior for a
 * bare assembly, the complete preset and `hostComponents`.
 */
export function unmountedOfficialLeafTags(
  isMounted: (name: string) => boolean,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const tag of OFFICIAL_LEAF_TAGS) {
    if (!isMounted(tag)) names.add(tag);
  }
  return names;
}
