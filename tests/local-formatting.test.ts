import { describe, expect, it } from 'vitest';
import {
  LocalExpressionError,
  RESERVED_NAMES,
  compileExpression,
} from '../src/local/expression';
import type { LocalValue, LocalValueKind } from '../src/local/types';

function evaluate(source: string, env: Record<string, LocalValue> = {}): LocalValue {
  return compileExpression(source).evaluate(env);
}

function infer(source: string, env: Record<string, LocalValueKind> = {}): LocalValueKind {
  return compileExpression(source).inferType(env);
}

function failure(run: () => unknown): LocalExpressionError {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalExpressionError) return error;
    throw error;
  }
  throw new Error('Expected a LocalExpressionError.');
}

describe('formatting built-ins', () => {
  it('reserves the new function names', () => {
    for (const name of [
      'formatNumber', 'formatPercent', 'formatScientific', 'formatCurrency',
      'trim', 'lower', 'upper', 'startsWith', 'endsWith', 'replace', 'slice',
      'dateCompare', 'dateDiff',
    ]) {
      expect(RESERVED_NAMES.has(name)).toBe(true);
    }
  });

  it('formats fixed decimals with grouping, digits and explicit locales', () => {
    expect(evaluate('formatNumber(1234.567)')).toBe('1,234.57');
    expect(evaluate('formatNumber(1234.567, 0)')).toBe('1,235');
    expect(evaluate('formatNumber(-1234.567, 2)')).toBe('-1,234.57');
    expect(evaluate("formatNumber(1234.567, 2, 'en-US', false)")).toBe('1234.57');
    expect(evaluate("formatNumber(1234.5, 1, 'de-DE')")).toBe('1.234,5');
    expect(evaluate("formatNumber(1234.5, 1, 'ja-JP')")).toBe('1,234.5');
    expect(evaluate("formatNumber(1234.5, 1, 'zh-CN')")).toBe('1,234.5');
    expect(evaluate("formatNumber(0.5, 1, 'fr-FR')")).toBe('0,5');
    expect(infer('formatNumber(n)', { n: 'number' })).toBe('string');
    expect(infer('formatNumber(n)', { n: 'null' })).toBe('string');
  });

  it('rounds half away from zero like the explicit halfExpand option', () => {
    expect(evaluate('formatNumber(2.5, 0)')).toBe('3');
    expect(evaluate('formatNumber(-2.5, 0)')).toBe('-3');
    expect(evaluate('formatNumber(1.25, 1)')).toBe('1.3');
    expect(evaluate('formatNumber(-1.25, 1)')).toBe('-1.3');

    // Decimal halfExpand: the documented contract rounds the decimal form.
    expect(evaluate('formatNumber(1.005, 2)')).toBe('1.01');
    expect(evaluate('formatNumber(-1.005, 2)')).toBe('-1.01');
  });

  it('renders positive zero for both signed zeros and rounded-to-zero values', () => {
    expect(evaluate('formatNumber(0)')).toBe('0.00');
    expect(evaluate('formatNumber(-0)')).toBe('0.00');
    expect(evaluate('formatNumber(-0.001, 2)')).toBe('0.00');
    expect(evaluate('formatPercent(-0)')).toBe('0%');
    expect(evaluate('formatPercent(-0.00001)')).toBe('0%');
    expect(evaluate('formatScientific(-0)')).toBe('0.00E0');
    expect(evaluate('formatCurrency(-0)')).toBe('$0.00');
    expect(evaluate('formatCurrency(-0.001)')).toBe('$0.00');
  });

  it('formats percentages from ratios', () => {
    expect(evaluate('formatPercent(0.125)')).toBe('13%');
    expect(evaluate('formatPercent(0.125, 2)')).toBe('12.50%');
    expect(evaluate('formatPercent(0.1234, 2)')).toBe('12.34%');
    expect(evaluate('formatPercent(-0.125)')).toBe('-13%');
    expect(evaluate('formatPercent(1)')).toBe('100%');
    expect(infer('formatPercent(n)', { n: 'number' })).toBe('string');
  });

  it('formats scientific notation with fixed fraction digits', () => {
    expect(evaluate('formatScientific(1234.5)')).toBe('1.23E3');
    expect(evaluate('formatScientific(1234.5, 4)')).toBe('1.2345E3');
    expect(evaluate('formatScientific(0.001234)')).toBe('1.23E-3');
    expect(evaluate('formatScientific(-1234.5)')).toBe('-1.23E3');
    expect(infer('formatScientific(n)', { n: 'number' })).toBe('string');
  });

  it('formats currency with an explicit code, digit count and locale', () => {
    expect(evaluate('formatCurrency(1234.5)')).toBe('$1,234.50');
    expect(evaluate("formatCurrency(1234.5, 'JPY')")).toBe('¥1,234.50');
    expect(evaluate("formatCurrency(1234.5, 'JPY', 0)")).toBe('¥1,235');

    const euros = evaluate("formatCurrency(1234.5, 'EUR', 2, 'de-DE')");
    expect(euros).toContain('1.234,50');
    expect(euros).toContain('€');

    // Well-formed but unassigned three-letter codes are accepted by Intl.
    const unknown = evaluate("formatCurrency(1, 'XYZ')");
    expect(unknown).toContain('1.00');
    expect(infer('formatCurrency(n)', { n: 'number' })).toBe('string');
  });

  it('renders null formatting input as empty text after validating options', () => {
    expect(evaluate('formatNumber(null)')).toBe('');
    expect(evaluate('formatPercent(null)')).toBe('');
    expect(evaluate('formatScientific(null)')).toBe('');
    expect(evaluate('formatCurrency(null)')).toBe('');
    expect(evaluate("formatNumber(null, 2, 'de-DE', false)")).toBe('');
    expect(evaluate('formatCurrency(n)', { n: null })).toBe('');
    expect(failure(() => evaluate('formatNumber(null, 21)')).code).toBe('expression-domain');
  });

  it('rejects wrong static and runtime argument types', () => {
    expect(failure(() => evaluate("formatNumber('1')")).code).toBe('expression-type');
    expect(failure(() => evaluate("formatNumber(1, '2')")).code).toBe('expression-type');
    expect(failure(() => evaluate('formatNumber(1, 2, 3)')).code).toBe('expression-type');
    expect(failure(() => evaluate("formatNumber(1, 2, 'en-US', 1)")).code).toBe('expression-type');
    expect(failure(() => evaluate("formatCurrency(1, 'USD', '2')")).code).toBe('expression-type');
    expect(failure(() => evaluate('formatCurrency(1, 2)')).code).toBe('expression-type');

    expect(failure(() => infer("formatNumber('1')")).code).toBe('expression-type');
    expect(failure(() => infer("formatNumber(1, '2')")).code).toBe('expression-type');
    expect(failure(() => infer('formatNumber(1, 2, 3)')).code).toBe('expression-type');
    expect(failure(() => infer('formatNumber(1, 2, "en-US", 1)')).code).toBe('expression-type');
    expect(failure(() => infer('formatCurrency(1, 2)')).code).toBe('expression-type');

    expect(failure(() => compileExpression('formatNumber()')).code).toBe('expression-arity');
    expect(failure(() => compileExpression("formatCurrency(1, 'USD', 2, 'en-US', 3)")).code)
      .toBe('expression-arity');
  });

  it('rejects unsupported locales, currencies and digit ranges', () => {
    expect(failure(() => evaluate("formatNumber(1, 2, 'en-GB')")).code).toBe('expression-domain');
    expect(failure(() => evaluate("formatNumber(1, 2, 'en-us')")).code).toBe('expression-domain');
    expect(failure(() => evaluate("formatPercent(1, 2, '')")).code).toBe('expression-domain');
    expect(failure(() => evaluate('formatNumber(1, -1)')).code).toBe('expression-domain');
    expect(failure(() => evaluate('formatNumber(1, 21)')).code).toBe('expression-domain');
    expect(failure(() => evaluate('formatNumber(1, 1.5)')).code).toBe('expression-domain');
    expect(failure(() => evaluate("formatCurrency(1, 'usd')")).code).toBe('expression-domain');
    expect(failure(() => evaluate("formatCurrency(1, 'US')")).code).toBe('expression-domain');
    expect(failure(() => evaluate("formatCurrency(1, 'USDX')")).code).toBe('expression-domain');
    expect(failure(() => evaluate('formatScientific(1, 21)')).code).toBe('expression-domain');
  });
});

describe('string built-ins', () => {
  it('trims and applies locale-independent Unicode case mapping', () => {
    expect(evaluate("trim('  \\t hello \\n')")).toBe('hello');
    expect(evaluate("trim('')")).toBe('');
    expect(evaluate("lower('ÄÖÜ')")).toBe('äöü');
    expect(evaluate("upper('straße')")).toBe('STRASSE');
    expect(evaluate("upper('ß')")).toBe('SS');
    expect(evaluate("lower('İ')")).toBe(`i${String.fromCharCode(0x307)}`);
    expect(infer("trim(' x ')")).toBe('string');
    expect(failure(() => evaluate('trim(null)')).code).toBe('expression-type');
    expect(failure(() => evaluate('lower(null)')).code).toBe('expression-type');
    expect(failure(() => evaluate('upper(null)')).code).toBe('expression-type');
  });

  it('tests literal prefixes and suffixes', () => {
    expect(evaluate("startsWith('hello', 'he')")).toBe(true);
    expect(evaluate("startsWith('hello', '')")).toBe(true);
    expect(evaluate("startsWith('hello', 'lo')")).toBe(false);
    expect(evaluate("startsWith('😀abc', '😀')")).toBe(true);
    expect(evaluate("endsWith('hello', 'lo')")).toBe(true);
    expect(evaluate("endsWith('hello', '')")).toBe(true);
    expect(evaluate("endsWith('hello', 'he')")).toBe(false);
    expect(infer("startsWith('a', 'b')")).toBe('boolean');
    expect(failure(() => evaluate("startsWith(null, 'a')")).code).toBe('expression-type');
    expect(failure(() => evaluate("endsWith('a', null)")).code).toBe('expression-type');
  });

  it('replaces literal matches without regular expressions or templates', () => {
    expect(evaluate("replace('banana', 'na', 'NA')")).toBe('baNANA');
    expect(evaluate("replace('aaaa', 'aa', 'b')")).toBe('bb');
    expect(evaluate("replace('abc', 'b', '$&')")).toBe('a$&c');
    expect(evaluate("replace('abc', 'b', '')")).toBe('ac');
    expect(failure(() => evaluate("replace('abc', '', 'x')")).code).toBe('expression-domain');
    expect(failure(() => evaluate("replace(null, 'a', 'b')")).code).toBe('expression-type');
    expect(failure(() => evaluate("replace('a', null, 'b')")).code).toBe('expression-type');
    expect(failure(() => evaluate("replace('a', 'b', null)")).code).toBe('expression-type');
    expect(infer("replace('a', 'b', 'c')")).toBe('string');
  });

  it('rejects replace expansion before allocating beyond the string budget', () => {
    const sixtyThousand = 'x'.repeat(60_000);
    expect(failure(() => evaluate('replace(text, "x", "yy")', { text: sixtyThousand })).code)
      .toBe('expression-budget');
    expect(evaluate('replace(text, "x", "y")', { text: sixtyThousand })).toHaveLength(60_000);
  });

  it('slices by Unicode code point with clamped and negative indexes', () => {
    expect(evaluate("slice('abcdef', 1)")).toBe('bcdef');
    expect(evaluate("slice('abcdef', 1, 3)")).toBe('bc');
    expect(evaluate("slice('abcdef', -2)")).toBe('ef');
    expect(evaluate("slice('abcdef', 1, -1)")).toBe('bcde');
    expect(evaluate("slice('abcdef', -100, 100)")).toBe('abcdef');
    expect(evaluate("slice('abcdef', 3, 1)")).toBe('');
    expect(evaluate("slice('abcdef', 100)")).toBe('');
    expect(evaluate("slice('😀a😀b', 1, 3)")).toBe('a😀');
    expect(evaluate("slice('😀a😀b', -2)")).toBe('😀b');
    expect(infer("slice('abc', 0)")).toBe('string');
    expect(failure(() => evaluate("slice('abc', 1.5)")).code).toBe('expression-domain');
    expect(failure(() => evaluate("slice('abc', 0, 1.5)")).code).toBe('expression-domain');
    expect(failure(() => evaluate('slice(null, 0)')).code).toBe('expression-type');
    expect(failure(() => evaluate("slice('abc', '1')")).code).toBe('expression-type');
  });
});

describe('date built-ins', () => {
  it('compares strict calendar dates', () => {
    expect(evaluate("dateCompare('2024-02-29', '2024-02-28')")).toBe(1);
    expect(evaluate("dateCompare('2024-02-28', '2024-02-29')")).toBe(-1);
    expect(evaluate("dateCompare('2024-02-29', '2024-02-29')")).toBe(0);
    expect(evaluate("dateCompare('0001-01-01', '0002-01-01')")).toBe(-1);
    expect(infer("dateCompare('2024-01-01', '2024-01-02')")).toBe('number');
  });

  it('computes signed differences in UTC units', () => {
    expect(evaluate("dateDiff('2024-03-01', '2024-02-28')")).toBe(2);
    expect(evaluate("dateDiff('2024-03-01', '2024-02-28', 'days')")).toBe(2);
    expect(evaluate("dateDiff('2024-02-28', '2024-03-01')")).toBe(-2);
    expect(evaluate("dateDiff('2024-03-01', '2024-02-28', 'hours')")).toBe(48);
    expect(evaluate("dateDiff('2024-03-01', '2024-02-28', 'minutes')")).toBe(2880);
    expect(evaluate("dateDiff('2024-03-01', '2024-02-28', 'seconds')")).toBe(172800);
    expect(evaluate("dateDiff('2024-03-01', '2024-02-28', 'milliseconds')")).toBe(172800000);
    expect(evaluate("dateDiff('2025-01-01', '2024-01-01')")).toBe(366);
  });

  it('handles leap years and years below 100 without the Date.UTC offset', () => {
    expect(evaluate("dateDiff('0001-01-02', '0001-01-01')")).toBe(1);
    expect(evaluate("dateDiff('0100-01-01', '0099-12-31')")).toBe(1);
    expect(evaluate("dateDiff('0001-01-02', '0001-01-01')")).toBe(1);
    expect(evaluate("dateCompare('2024-02-29', '2023-02-28')")).toBe(1);
  });

  it('is independent of local daylight-saving transitions', () => {
    expect(evaluate("dateDiff('2024-03-11', '2024-03-10', 'hours')")).toBe(24);
    expect(evaluate("dateDiff('2024-03-10', '2024-03-11', 'hours')")).toBe(-24);
    expect(evaluate("dateDiff('2024-11-04', '2024-11-03', 'hours')")).toBe(24);
    expect(evaluate("dateDiff('2024-03-11', '2024-03-10', 'minutes')")).toBe(1440);
  });

  it('rejects empty, malformed, overflowing and non-string dates', () => {
    for (const source of [
      "dateCompare('', '2024-01-01')",
      "dateCompare('0000-01-01', '0001-01-01')",
      "dateCompare('2023-02-29', '2024-01-01')",
      "dateCompare('2024-02-30', '2024-01-01')",
      "dateCompare('2024-04-31', '2024-01-01')",
      "dateCompare('2024-13-01', '2024-01-01')",
      "dateCompare('2024-00-10', '2024-01-01')",
      "dateCompare('2024-01-00', '2024-01-01')",
      "dateCompare('2024-1-01', '2024-01-01')",
      "dateCompare('2024-01-01T00:00:00Z', '2024-01-01')",
      "dateCompare(' 2024-01-01', '2024-01-01')",
      "dateCompare('2024/01/01', '2024-01-01')",
      "dateCompare('20240101', '2024-01-01')",
    ]) {
      expect(failure(() => evaluate(source)).code).toBe('expression-domain');
    }

    expect(failure(() => evaluate("dateDiff('2024-01-01', '2024-01-01', 'weeks')")).code)
      .toBe('expression-domain');
    expect(failure(() => evaluate("dateDiff('2024-01-01', '2024-01-01', 'Days')")).code)
      .toBe('expression-domain');
    expect(failure(() => evaluate('dateCompare(1, 2)')).code).toBe('expression-type');
    expect(failure(() => evaluate('dateCompare(null, null)')).code).toBe('expression-type');
    expect(failure(() => evaluate('dateDiff(null, "2024-01-01")')).code).toBe('expression-type');
    expect(failure(() => evaluate("dateDiff('2024-01-01', '2024-01-01', 1)")).code)
      .toBe('expression-type');
    expect(failure(() => infer('dateDiff(a, b)', { a: 'number', b: 'string' })).code)
      .toBe('expression-type');
    expect(failure(() => infer('dateDiff(a, b, u)', { a: 'string', b: 'string', u: 'boolean' })).code)
      .toBe('expression-type');
  });

  it('keeps null invalid for the existing string and date parameters', () => {
    expect(failure(() => infer('trim(n)', { n: 'null' })).code).toBe('expression-type');
    expect(failure(() => infer('dateCompare(a, b)', { a: 'null', b: 'string' })).code)
      .toBe('expression-type');
  });
});

describe('existing rounding behaviour', () => {
  it('leaves round() with its original Math.round semantics', () => {
    expect(evaluate('round(2.5)')).toBe(3);
    expect(evaluate('round(-2.5)')).toBe(-2);
  });
});
