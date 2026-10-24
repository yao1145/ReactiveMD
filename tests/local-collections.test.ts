import { describe, expect, it } from 'vitest';
import {
  LocalExpressionError,
  compileExpression,
  expressionValue,
  interpolate,
  localValueBudgetError,
} from '../src/local/expression';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_STRING_LENGTH,
  MAX_LOCAL_VALUE_CHARACTERS,
} from '../src/local/limits';
import type { LocalValue } from '../src/local';

function failure(run: () => unknown): LocalExpressionError {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalExpressionError) return error;
    throw error;
  }
  throw new Error('Expected a LocalExpressionError.');
}

function evaluate(source: string, env: Record<string, LocalValue> = {}): LocalValue {
  return compileExpression(source).evaluate(env);
}

describe('array literals', () => {
  it('evaluates homogeneous string and numeric literals', () => {
    expect(evaluate('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(evaluate("['a', 'b']")).toEqual(['a', 'b']);
    expect(evaluate('[]')).toEqual([]);
    expect(evaluate('[1 + 1, 2 * 3]')).toEqual([2, 6]);
    expect(evaluate('[n, n + 1]', { n: 4 })).toEqual([4, 5]);
  });

  it('infers array and number-array statically', () => {
    expect(compileExpression('[1, 2]').inferType({})).toBe('number-array');
    expect(compileExpression('[]').inferType({})).toBe('number-array');
    expect(compileExpression("['a', 'b']").inferType({})).toBe('array');
    expect(compileExpression('[n, m]').inferType({ n: 'number', m: 'number' })).toBe('number-array');
    expect(compileExpression('[n, m]').inferType({ n: 'string', m: 'string' })).toBe('array');
    expect(compileExpression('false ? 1 : 2').inferType({})).toBe('number');
  });

  it('rejects mixed, nested, boolean and null literals', () => {
    expect(failure(() => compileExpression("[1, 'a']").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('[true]').inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('[null]').inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('[[1]]').inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('[1, [2]]').inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('[1,]').inferType({})).code).toBe('expression-syntax');
  });

  it('collects element dependencies in source order', () => {
    expect(compileExpression('[a, b, a]').dependencies).toEqual(['a', 'b']);
    expect(compileExpression("[n, 'x']").dependencies).toEqual(['n']);
  });

  it('rejects values outside the shared array shape at runtime', () => {
    // `false ? 1 : null` infers number, but the evaluated member is null.
    const expression = compileExpression('[false ? 1 : null, 2]');
    expect(expression.inferType({})).toBe('number-array');
    expect(failure(() => expression.evaluate({})).code).toBe('expression-value');
  });

  it('returns fresh arrays so callers cannot mutate shared results', () => {
    const expression = compileExpression('[1, 2]');
    const first = expression.evaluate({});
    (first as number[]).push(3);
    expect(expression.evaluate({})).toEqual([1, 2]);
    expect(evaluate('[1, 2] == [1, 2]')).toBe(true);
    expect(evaluate('[1, 2] != [1, 3]')).toBe(true);
  });
});

describe('array indexing', () => {
  it('reads zero-based members and returns null out of range', () => {
    expect(evaluate('[10, 20, 30][1]')).toBe(20);
    expect(evaluate("['a', 'b'][0]")).toBe('a');
    expect(evaluate('[10][5]')).toBeNull();
    expect(evaluate('[10][-1]')).toBeNull();
    expect(evaluate('[10][-0]')).toBe(10);
    expect(evaluate('[10][0] == null')).toBe(false);
    expect(evaluate('[10][1] == null')).toBe(true);
  });

  it('supports environment arrays and numeric index expressions', () => {
    expect(evaluate('values[1]', { values: [10, 20, 30] })).toBe(20);
    expect(evaluate('names[i]', { names: ['a', 'b'], i: 1 })).toBe('b');
    const expression = compileExpression('values[i]');
    expect(expression.dependencies).toEqual(['values', 'i']);
    expect(expression.inferType({ values: 'number-array', i: 'number' })).toBe('number');
    expect(expression.inferType({ values: 'array', i: 'number' })).toBe('string');
    expect(evaluate('names[i] == null', { names: ['a'], i: 3 })).toBe(true);
  });

  it('follows the existing nullable convention for conditionals', () => {
    expect(compileExpression('true ? values[0] : null').inferType({ values: 'number-array' })).toBe('number');
    expect(compileExpression('true ? values[0] : null').inferType({ values: 'array' })).toBe('string');
  });

  it('requires a numeric, finite, safe-integer index', () => {
    expect(failure(() => evaluate('[1, 2][0.5]')).code).toBe('expression-index');
    expect(failure(() => evaluate('[1, 2][1e30]')).code).toBe('expression-index');
    expect(failure(() => evaluate('[1, 2][true]')).code).toBe('expression-type');
    expect(failure(() => evaluate("[1, 2]['0']")).code).toBe('expression-type');
    expect(failure(() => evaluate('1[0]')).code).toBe('expression-type');
    expect(failure(() => compileExpression("[1, 2]['0']").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('1[0]').inferType({})).code).toBe('expression-type');
  });

  it('short-circuits skipped index reads', () => {
    expect(evaluate('false && n[0] > 0', { n: 1 })).toBe(false);
    expect(evaluate('true || n[0] == 1', { n: 1 })).toBe(true);
    expect(evaluate('true ? 1 : n[0]', { n: 1 })).toBe(1);
  });

  it('rejects property access syntax', () => {
    expect(failure(() => compileExpression('a.b')).code).toBe('expression-property');
    expect(failure(() => compileExpression("a['b']").inferType({ a: 'array' })).code).toBe('expression-type');
  });

  it('enforces the shared depth budget for nested literals', () => {
    const nested = `${'['.repeat(120)}1${']'.repeat(120)}`;
    expect(failure(() => compileExpression(nested)).code).toBe('expression-budget');
  });
});

describe('collection functions', () => {
  it('extends len and contains while keeping string arrays compatible', () => {
    expect(evaluate('len([1, 2, 3])')).toBe(3);
    expect(evaluate('len([])')).toBe(0);
    expect(evaluate('len(names)', { names: ['a', 'b'] })).toBe(2);
    expect(compileExpression('len(values)').inferType({ values: 'number-array' })).toBe('number');
    expect(compileExpression("contains(names, 'b')").inferType({ names: 'array' })).toBe('boolean');
    expect(compileExpression('contains(values, 2)').inferType({ values: 'number-array' })).toBe('boolean');

    expect(evaluate('contains([1, 2, 3], 2)')).toBe(true);
    expect(evaluate('contains([1, 2, 3], 4)')).toBe(false);
    expect(evaluate("contains(['a', 'b'], 'b')")).toBe(true);
    expect(evaluate("contains(names, 'b')", { names: ['a', 'b'] })).toBe(true);

    expect(failure(() => compileExpression("contains([1, 2], '2')").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression("contains(['a'], 1)").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression("contains(1, 'a')").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('len(1)').inferType({})).code).toBe('expression-type');
  });

  it('validates members against actual runtime contents', () => {
    expect(evaluate("contains(empty, 'x')", { empty: [] })).toBe(false);
    expect(evaluate('contains(empty, 1)', { empty: [] })).toBe(false);
    expect(failure(() => evaluate("contains(values, 'a')", { values: [1, 2] })).code).toBe('expression-type');
    expect(failure(() => evaluate('contains(values, 1)', { values: ['a'] })).code).toBe('expression-type');
  });

  it('computes numeric aggregates with explicit empty semantics', () => {
    expect(evaluate('sum([1, 2, 3])')).toBe(6);
    expect(evaluate('sum([])')).toBe(0);
    expect(evaluate('average([10, 20, 30])')).toBe(20);
    expect(evaluate('average([])')).toBeNull();
    expect(evaluate('minOf([3, 1, 2])')).toBe(1);
    expect(evaluate('minOf([])')).toBeNull();
    expect(evaluate('maxOf([3, 1, 2])')).toBe(3);
    expect(evaluate('maxOf([])')).toBeNull();
    expect(evaluate('sum(values)', { values: [1.5, 2.5] })).toBe(4);
    expect(evaluate('average(values)', { values: [1.5, 2.5] })).toBe(2);
  });

  it('infers number for aggregates, including empty arguments', () => {
    expect(compileExpression('sum([1])').inferType({})).toBe('number');
    expect(compileExpression('average([])').inferType({})).toBe('number');
    expect(compileExpression('minOf([])').inferType({})).toBe('number');
    expect(compileExpression('maxOf([])').inferType({})).toBe('number');
    expect(compileExpression('true ? average([]) : null').inferType({})).toBe('number');
    expect(compileExpression('sum(values)').dependencies).toEqual(['values']);
  });

  it('rejects non-numeric arrays and non-finite results', () => {
    expect(failure(() => compileExpression("sum(['a'])").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression("average(names)").inferType({ names: 'array' })).code).toBe('expression-type');
    expect(failure(() => evaluate("sum(['a'])")).code).toBe('expression-type');
    expect(failure(() => evaluate("maxOf('x')")).code).toBe('expression-type');
    expect(failure(() => evaluate('sum([1e308, 1e308])')).code).toBe('expression-number');
    expect(failure(() => evaluate('average([1e308, 1e308])')).code).toBe('expression-number');
    expect(failure(() => evaluate('sum(values)', { values: [1, Number.NaN] })).code).toBe('expression-value');
    expect(failure(() => evaluate('sum(values)', { values: [1, Infinity] })).code).toBe('expression-value');
  });
});

describe('array shape and budgets', () => {
  it('keeps string-array budgets and accepts finite numeric arrays', () => {
    expect(localValueBudgetError(['a', 'b'])).toBeNull();
    expect(localValueBudgetError([1, 2, 3])).toBeNull();
    expect(localValueBudgetError([])).toBeNull();

    expect(localValueBudgetError([1, 'a'] as unknown as LocalValue)).toContain('all be strings');
    expect(localValueBudgetError([Number.NaN] as unknown as LocalValue)).toContain('finite numbers');
    expect(localValueBudgetError([true] as unknown as LocalValue)).toContain('strings or finite numbers');
    expect(localValueBudgetError([['a']] as unknown as LocalValue)).toContain('strings or finite numbers');

    const tooMany = Array.from({ length: MAX_LOCAL_ARRAY_LENGTH + 1 }, () => 1);
    expect(localValueBudgetError(tooMany)).toContain(`${MAX_LOCAL_ARRAY_LENGTH}-item`);
    const tooLong = 'x'.repeat(MAX_LOCAL_STRING_LENGTH + 1);
    expect(localValueBudgetError([tooLong])).toContain(`${MAX_LOCAL_STRING_LENGTH}-character`);
    const tooMuch = ['x'.repeat(60_000), 'x'.repeat(60_000)];
    expect(tooMuch.join('').length).toBeGreaterThan(MAX_LOCAL_VALUE_CHARACTERS);
    expect(localValueBudgetError(tooMuch)).toContain(`${MAX_LOCAL_VALUE_CHARACTERS}-character`);
  });

  it('enforces budgets when reading environment arrays', () => {
    const tooMany = Array.from({ length: MAX_LOCAL_ARRAY_LENGTH + 1 }, () => 1);
    expect(failure(() => evaluate('len(values)', { values: tooMany })).code).toBe('expression-budget');
    const tooLong = 'x'.repeat(MAX_LOCAL_STRING_LENGTH + 1);
    expect(failure(() => evaluate('len(values)', { values: [tooLong] })).code).toBe('expression-budget');
    expect(
      failure(() => evaluate('len(values)', { values: ['a', 1] as unknown as LocalValue })).code,
    ).toBe('expression-value');
  });

  it('allows empty external arrays under either array kind', () => {
    expect(compileExpression('len(empty)').inferType({ empty: 'array' })).toBe('number');
    expect(compileExpression('len(empty)').inferType({ empty: 'number-array' })).toBe('number');
    expect(compileExpression("contains(empty, 'x')").inferType({ empty: 'array' })).toBe('boolean');
    expect(compileExpression('contains(empty, 1)').inferType({ empty: 'number-array' })).toBe('boolean');
  });
});

describe('number arrays in templates', () => {
  it('keeps type-preserving interpolation but rejects direct text output', () => {
    expect(expressionValue('{{ [1, 2] }}', {})).toEqual([1, 2]);
    expect(expressionValue('{{ values }}', { values: [3, 4] })).toEqual([3, 4]);
    expect(failure(() => interpolate('{{ values }}', { values: [1, 2] })).code).toBe('expression-type');
    expect(failure(() => interpolate('count {{ values }}', { values: [1, 2] })).code).toBe('expression-type');
    expect(interpolate('count {{ len(values) }}', { values: [1, 2] })).toBe('count 2');
  });
});
