import { LocalFunctionError, ensureStringBudget } from './formatting';
import { MAX_LOCAL_STRING_LENGTH } from './limits';
import { localDateTimestamp } from './dates';

/**
 * Deterministic string and calendar-date functions for the local expression
 * language. Strings use locale-independent Unicode case mapping. Dates are
 * strict `YYYY-MM-DD` calendar days interpreted at UTC midnight, so results do
 * not depend on the host time zone or daylight-saving transitions.
 */

function domain(message: string): never {
  throw new LocalFunctionError('expression-domain', message);
}

/* ------------------------------------------------------------------ */
/* Strings                                                             */
/* ------------------------------------------------------------------ */

export function trimText(text: string): string {
  return ensureStringBudget(text.trim(), 'trim result');
}

/** Unicode default lower-case mapping; not tailored to a locale. */
export function lowerText(text: string): string {
  return ensureStringBudget(text.toLowerCase(), 'lower result');
}

/** Unicode default upper-case mapping; not tailored to a locale. */
export function upperText(text: string): string {
  return ensureStringBudget(text.toUpperCase(), 'upper result');
}

export function startsWithText(text: string, search: string): boolean {
  return text.startsWith(search);
}

export function endsWithText(text: string, search: string): boolean {
  return text.endsWith(search);
}

/**
 * Replace every non-overlapping literal occurrence. There is no pattern or
 * replacement-template interpretation, so `$&` and friends stay literal.
 * The exact output size is counted before building any result.
 */
export function replaceLiteral(text: string, search: string, replacement: string): string {
  if (search.length === 0) domain('replace search text must not be empty.');

  const growth = replacement.length - search.length;
  if (growth > 0) {
    let matches = 0;
    let scan = 0;
    for (;;) {
      const index = text.indexOf(search, scan);
      if (index < 0) break;
      matches += 1;
      scan = index + search.length;
    }
    if (text.length + matches * growth > MAX_LOCAL_STRING_LENGTH) {
      throw new LocalFunctionError(
        'expression-budget',
        `replace result would exceed the ${MAX_LOCAL_STRING_LENGTH}-character limit.`,
      );
    }
  }

  let result = '';
  let cursor = 0;
  for (;;) {
    const index = text.indexOf(search, cursor);
    if (index < 0) break;
    result += text.slice(cursor, index);
    result += replacement;
    cursor = index + search.length;
  }
  result += text.slice(cursor);
  return ensureStringBudget(result, 'replace result');
}

function normalizeSliceIndex(index: number, length: number): number {
  if (index < 0) return Math.max(length + index, 0);
  return Math.min(index, length);
}

/**
 * Slice by Unicode code point, matching `len()` rather than UTF-16 units.
 * Negative indexes count from the end and out-of-range indexes are clamped.
 */
export function sliceCodePoints(text: string, start: number, end: number | undefined): string {
  if (!Number.isInteger(start)) domain('slice start must be an integer.');
  if (end !== undefined && !Number.isInteger(end)) domain('slice end must be an integer.');

  const codePoints = Array.from(text);
  const length = codePoints.length;
  const from = normalizeSliceIndex(start, length);
  const to = end === undefined ? length : normalizeSliceIndex(end, length);
  if (to <= from) return '';
  return ensureStringBudget(codePoints.slice(from, to).join(''), 'slice result');
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const MILLISECONDS_PER_DAY = 86_400_000;

const DIFF_UNITS: ReadonlyMap<string, number> = new Map([
  ['days', MILLISECONDS_PER_DAY],
  ['hours', 3_600_000],
  ['minutes', 60_000],
  ['seconds', 1_000],
  ['milliseconds', 1],
]);
const DIFF_UNIT_NAMES = 'days, hours, minutes, seconds or milliseconds';

/**
 * Parse a strict `YYYY-MM-DD` calendar date as UTC midnight. Years are accepted
 * in the range 0001-9999. `setUTCFullYear` is used so years 0001-0099 are not
 * mapped onto 1900-1999 by `Date.UTC`; calendar overflow (such as 29 February
 * in a common year) is rejected instead of rolling into the next month.
 */
function parseUtcDate(text: string): number {
  const timestamp = localDateTimestamp(text);
  if (timestamp === null) {
    throw new LocalFunctionError(
      'expression-domain',
      `Date "${text}" must be a valid YYYY-MM-DD calendar date in years 0001-9999.`,
    );
  }
  return timestamp;
}

/** Compare two calendar dates: -1 when `left` is earlier, 0 when equal, 1 later. */
export function compareDates(left: string, right: string): number {
  const a = parseUtcDate(left);
  const b = parseUtcDate(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Signed `left - right` difference in the requested unit. */
export function diffDates(left: string, right: string, unit = 'days'): number {
  const divisor = DIFF_UNITS.get(unit);
  if (divisor === undefined) domain(`dateDiff unit must be ${DIFF_UNIT_NAMES}.`);
  const a = parseUtcDate(left);
  const b = parseUtcDate(right);
  return (a - b) / divisor;
}
