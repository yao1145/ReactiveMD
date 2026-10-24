import { MAX_LOCAL_STRING_LENGTH } from './limits';

/**
 * Deterministic number formatting for the local expression language.
 *
 * Every formatter receives an explicit supported locale and explicit
 * `Intl.NumberFormat` options. It never falls back to the host default locale,
 * and half-way values round away from zero (`halfExpand`). Helpers raise
 * `LocalFunctionError` without a source offset; the evaluator converts these
 * to `LocalExpressionError` at the call site.
 */
export class LocalFunctionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LocalFunctionError';
    this.code = code;
  }
}

export const SUPPORTED_LOCALES: readonly string[] = ['en-US', 'zh-CN', 'de-DE', 'fr-FR', 'ja-JP'];
const SUPPORTED_LOCALE_SET: ReadonlySet<string> = new Set(SUPPORTED_LOCALES);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_FRACTION_DIGITS = 20;

/**
 * `roundingMode` is part of ECMA-402 but was added after the ES2022 type
 * library this package targets, so it is declared explicitly here.
 */
type FormatOptions = Intl.NumberFormatOptions & { roundingMode: 'halfExpand' };

function domain(message: string): never {
  throw new LocalFunctionError('expression-domain', message);
}

/** Enforce the shared string budget for a formatting or data result. */
export function ensureStringBudget(value: string, label: string): string {
  if (value.length > MAX_LOCAL_STRING_LENGTH) {
    throw new LocalFunctionError(
      'expression-budget',
      `${label} exceeds the ${MAX_LOCAL_STRING_LENGTH}-character limit.`,
    );
  }
  return value;
}

/** Restrict locales to the explicitly supported set; no host fallback. */
export function requireLocale(locale: string): string {
  if (!SUPPORTED_LOCALE_SET.has(locale)) {
    domain(`Unsupported locale "${locale}"; expected one of ${SUPPORTED_LOCALES.join(', ')}.`);
  }
  return locale;
}

function requireDigits(digits: number, label: string): number {
  if (!Number.isInteger(digits) || digits < 0 || digits > MAX_FRACTION_DIGITS) {
    domain(`${label} digits must be an integer from 0 to ${MAX_FRACTION_DIGITS}.`);
  }
  return digits;
}

/** Keep numbers finite. */
function finiteNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new LocalFunctionError('expression-number', 'Value must be a finite number.');
  }
  return value;
}

/** Render both signed zeros as positive zero. */
function normalizeSignedZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * A negative value that rounds to zero at the requested fraction digits must
 * not keep a minus sign (`-0.001` with two digits renders `0.00`).
 */
function normalizeFixed(value: number, digits: number): number {
  const number = finiteNumber(value);
  if (number === 0) return 0;
  return Math.abs(number) < 0.5 * 10 ** -digits ? 0 : number;
}

/** Percent formatting rounds `value * 100`, so the midpoint shifts by two digits. */
function normalizePercent(value: number, digits: number): number {
  const number = finiteNumber(value);
  if (number === 0) return 0;
  return Math.abs(number) < 0.5 * 10 ** -(digits + 2) ? 0 : number;
}

function formatWith(
  locale: string,
  options: FormatOptions,
  value: number,
  label: string,
  failureMessage: string,
): string {
  let formatter: Intl.NumberFormat | undefined;
  try {
    formatter = new Intl.NumberFormat(locale, options);
  } catch {
    formatter = undefined;
  }
  if (formatter === undefined) domain(failureMessage);
  return ensureStringBudget(formatter.format(value), label);
}

/**
 * Fixed-point decimal text with optional digit grouping.
 * `value === null` renders an empty string after the options are validated.
 */
export function formatNumber(
  value: number | null,
  digits = 2,
  locale = 'en-US',
  grouping = true,
): string {
  const validLocale = requireLocale(locale);
  const validDigits = requireDigits(digits, 'formatNumber');
  if (typeof grouping !== 'boolean') domain('formatNumber grouping must be a boolean.');
  if (value === null) return '';
  return formatWith(
    validLocale,
    {
      useGrouping: grouping,
      minimumFractionDigits: validDigits,
      maximumFractionDigits: validDigits,
      roundingMode: 'halfExpand',
    },
    normalizeFixed(value, validDigits),
    'Formatted number',
    `Cannot format a number for locale "${validLocale}".`,
  );
}

/**
 * Percent text for a ratio: `0.125` with zero digits renders `13%`.
 * `value === null` renders an empty string after the options are validated.
 */
export function formatPercent(value: number | null, digits = 0, locale = 'en-US'): string {
  const validLocale = requireLocale(locale);
  const validDigits = requireDigits(digits, 'formatPercent');
  if (value === null) return '';
  return formatWith(
    validLocale,
    {
      style: 'percent',
      minimumFractionDigits: validDigits,
      maximumFractionDigits: validDigits,
      roundingMode: 'halfExpand',
    },
    normalizePercent(value, validDigits),
    'Formatted percentage',
    `Cannot format a percentage for locale "${validLocale}".`,
  );
}

/**
 * Scientific-notation text with a fixed number of fraction digits.
 * `value === null` renders an empty string after the options are validated.
 */
export function formatScientific(value: number | null, digits = 2, locale = 'en-US'): string {
  const validLocale = requireLocale(locale);
  const validDigits = requireDigits(digits, 'formatScientific');
  if (value === null) return '';
  return formatWith(
    validLocale,
    {
      notation: 'scientific',
      minimumFractionDigits: validDigits,
      maximumFractionDigits: validDigits,
      roundingMode: 'halfExpand',
    },
    normalizeSignedZero(finiteNumber(value)),
    'Formatted number',
    `Cannot format a number for locale "${validLocale}".`,
  );
}

/**
 * Currency text. `currency` must be an uppercase three-letter code. Codes that
 * Intl accepts are allowed even when they are not assigned to a real currency;
 * Intl then displays the code itself. The explicit `digits` override applies to
 * every currency, including currencies such as JPY whose default is zero.
 * `value === null` renders an empty string after the options are validated.
 */
export function formatCurrency(
  value: number | null,
  currency = 'USD',
  digits = 2,
  locale = 'en-US',
): string {
  const validLocale = requireLocale(locale);
  if (!CURRENCY_PATTERN.test(currency)) {
    domain(`Currency "${currency}" must be a three-letter uppercase code such as "USD".`);
  }
  const validDigits = requireDigits(digits, 'formatCurrency');
  if (value === null) return '';
  return formatWith(
    validLocale,
    {
      style: 'currency',
      currency,
      minimumFractionDigits: validDigits,
      maximumFractionDigits: validDigits,
      roundingMode: 'halfExpand',
    },
    normalizeFixed(value, validDigits),
    'Formatted currency',
    `Currency code "${currency}" is not accepted by Intl.`,
  );
}
