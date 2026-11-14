/**
 * Author-visible character counting.
 *
 * Unicode code points are the unit authors see: `len()` in expressions,
 * `min-length`/`max-length` on text controls and initial-value checks all use
 * this function. Combining marks are not merged into grapheme clusters, and an
 * unpaired surrogate counts as one code point.
 *
 * Source offsets, line/column positions and defensive resource budgets remain
 * UTF-16 code units (see `limits.ts`); those are machine limits, not counts
 * authors compare against visible text.
 */
export function countLocalCodePoints(value: string): number {
  if (typeof value !== 'string') return 0;
  let count = 0;
  // for...of walks code points without allocating an intermediate array.
  for (const _character of value) count += 1;
  return count;
}

/**
 * Prefix of at most `end` UTF-16 code units that never ends in the middle of a
 * surrogate pair. Budgets for diagnostics and display text are counted in
 * code units, but the truncated text must remain well-formed Unicode, so a
 * trailing high surrogate is dropped instead of being left unpaired.
 */
export function localCodeUnitPrefix(value: string, end: number): string {
  const prefix = value.slice(0, Math.max(0, end));
  const last = prefix.charCodeAt(prefix.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix;
}
