/**
 * Shared defensive limits for source compilation, runtime values and visual work.
 *
 * Units matter:
 * - Source text, names, string values/templates, diagnostic text and JSON-ish
 *   lengths are UTF-16 code units (JavaScript `string.length`). These are
 *   allocation/CPU guards, not author-visible character counts.
 * - Author-visible `len()` text and text-control `min-length`/`max-length` use
 *   Unicode code points via `countLocalCodePoints`.
 * - Arrays and plot sample counts are element counts.
 *
 * Each limit is inclusive: a value equal to the limit is accepted, a larger
 * value is rejected. Limits are intentionally not configurable except for the
 * per-compilation syntax-node budget (`limits.maxSyntaxNodes`).
 */

/** Original source length for one compilation, in UTF-16 code units. */
export const MAX_LOCAL_DOCUMENT_LENGTH = 1_000_000;
/** Cumulative `LocalNode` constructions during one parse, including intermediates. */
export const DEFAULT_MAX_LOCAL_SYNTAX_NODES = 10_000;
/** One string value, attribute, template or concatenation result, in UTF-16 code units. */
export const MAX_LOCAL_STRING_LENGTH = 100_000;
/** Number of elements in one array value or selection. */
export const MAX_LOCAL_ARRAY_LENGTH = 10_000;
/** Sum of UTF-16 lengths of all string members in one array. */
export const MAX_LOCAL_VALUE_CHARACTERS = 100_000;
/** Diagnostics retained per parse/compile; new errors may displace warnings. */
export const MAX_LOCAL_DIAGNOSTICS = 100;
/** Displayed diagnostic message length, in UTF-16 code units. */
export const MAX_LOCAL_DIAGNOSTIC_LENGTH = 2_000;
/** Curves allowed in one `<plot>` component. */
export const MAX_LOCAL_PLOT_CURVES = 16;
/** Curve sample points requested across one document compilation. */
export const MAX_LOCAL_PLOT_POINTS = 20_000;
/** Shared node-visit budget for all plot sampling in one runtime revision. */
export const MAX_LOCAL_PLOT_STEPS = 2_000_000;
/** Email address guard, in UTF-16 code units; validated in linear time. */
export const MAX_LOCAL_EMAIL_LENGTH = 254;
export const MAX_LOCAL_VALIDATIONS = 100;
export const MAX_LOCAL_DATA_TABLE_ROWS = 1_000;
export const DEFAULT_LOCAL_DATA_TABLE_ROWS = 100;
export const MAX_LOCAL_DATA_TABLE_COLUMNS = 20;
export const MAX_LOCAL_DATA_DOCUMENT_ROWS = 2_000;
export const MAX_LOCAL_DATA_DOCUMENT_CELLS = 10_000;
/** Host component schemas accepted in one compilation. */
export const MAX_LOCAL_HOST_COMPONENTS = 32;
/** Host component and property name length, in UTF-16 code units. */
export const MAX_LOCAL_HOST_NAME_LENGTH = 128;
/** Host property RegExp source length, in UTF-16 code units. */
export const MAX_LOCAL_HOST_PATTERN_LENGTH = 512;
/** Allowed literals in one host enum property. */
export const MAX_LOCAL_HOST_ENUM_VALUES = 64;

/** Linear validation; the final dot must have text on both sides in the domain. */
export function isLocalEmail(value: string): boolean {
  if (value.length > MAX_LOCAL_EMAIL_LENGTH || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const dot = value.lastIndexOf('.');
  return dot > at + 1 && dot < value.length - 1;
}
