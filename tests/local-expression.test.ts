import { describe, expect, it } from 'vitest';
import {
  LocalExpressionError,
  RESERVED_NAMES,
  compileExpression,
  expressionValue,
  interpolate,
} from '../src/local/expression';

function failure(run: () => unknown): LocalExpressionError {
  try {
    run();
  } catch (error) {
    if (error instanceof LocalExpressionError) return error;
    throw error;
  }
  throw new Error('Expected a LocalExpressionError.');
}

describe('expression parser and evaluator', () => {
  it('follows precedence and associativity', () => {
    expect(compileExpression('1 + 2 * 3 - 4 / 2 + -3 + +4').evaluate({})).toBe(6);
    expect(compileExpression('2 * 3 % 4').evaluate({})).toBe(2);
    expect(compileExpression('false ? 1 : true ? 2 : 3').evaluate({})).toBe(2);
    expect(compileExpression('!(1 < 2) || 2 == 2 && true').evaluate({})).toBe(true);
    expect(compileExpression('pow(2, 3) + pi').evaluate({})).toBeCloseTo(8 + Math.PI);
    expect(compileExpression('e').evaluate({})).toBeCloseTo(Math.E);
  });

  it('requires compatible static types', () => {
    expect(compileExpression("'a' + 'b'").inferType({})).toBe('string');
    expect(compileExpression('1 + 2').inferType({})).toBe('number');
    expect(compileExpression('1 < 2').inferType({})).toBe('boolean');
    expect(compileExpression("true ? 'x' : null").inferType({})).toBe('string');
    expect(compileExpression('null').inferType({})).toBe('null');

    expect(failure(() => compileExpression("'1' + 2").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression("'2' < 2").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('1 && true').inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('!1').inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression("true ? 1 : 'x'").inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression("1 == '1'").inferType({})).code).toBe('expression-type');
  });

  it('collects dependencies in source order and checks them at inference time', () => {
    const expression = compileExpression('a + b * 2 + a');
    expect(expression.dependencies).toEqual(['a', 'b']);
    expect(expression.inferType({ a: 'number', b: 'number' })).toBe('number');
    expect(failure(() => expression.inferType({ a: 'number' })).code).toBe('expression-unknown-name');
    expect(failure(() => expression.evaluate({ a: 1 })).code).toBe('expression-unknown-name');
    expect(compileExpression('true ? a : b').dependencies).toEqual(['a', 'b']);
  });

  it('short-circuits logical and conditional branches', () => {
    expect(compileExpression('false && (1 / 0 > 0)').evaluate({})).toBe(false);
    expect(compileExpression('true || (1 / 0 > 0)').evaluate({})).toBe(true);
    expect(compileExpression('true ? 1 : 1 / 0').evaluate({})).toBe(1);
    expect(compileExpression('false ? 1 / 0 : 2').evaluate({})).toBe(2);
  });

  it('reports runtime type, domain and numeric errors', () => {
    const divide = failure(() => compileExpression('n / 0').evaluate({ n: 1 }));
    expect(divide.code).toBe('expression-divide-by-zero');
    const modulo = failure(() => compileExpression('n % 0').evaluate({ n: 1 }));
    expect(modulo.code).toBe('expression-divide-by-zero');
    expect(failure(() => compileExpression('sqrt(-1)').evaluate({})).code).toBe('expression-domain');
    expect(failure(() => compileExpression('log(0)').evaluate({})).code).toBe('expression-domain');
    expect(failure(() => compileExpression('asin(2)').evaluate({})).code).toBe('expression-domain');
    expect(failure(() => compileExpression('exp(1000)').evaluate({})).code).toBe('expression-number');
    expect(failure(() => compileExpression('clamp(1, 5, 2)').evaluate({})).code).toBe('expression-domain');
    expect(failure(() => compileExpression('a + 1').evaluate({ a: '1' })).code).toBe('expression-type');
    expect(failure(() => compileExpression('a').evaluate({ a: Number.NaN })).code).toBe('expression-value');
    expect(compileExpression('1 / 0').inferType({})).toBe('number');
    expect(compileExpression('sqrt(-1)').inferType({})).toBe('number');
  });

  it('implements the built-in functions', () => {
    expect(compileExpression('min(3, 1, 2)').evaluate({})).toBe(1);
    expect(compileExpression('max(3, 1, 2)').evaluate({})).toBe(3);
    expect(compileExpression('round(2.5)').evaluate({})).toBe(3);
    expect(compileExpression('round(-2.5)').evaluate({})).toBe(-2);
    expect(compileExpression('floor(-1.2)').evaluate({})).toBe(-2);
    expect(compileExpression('ceil(-1.2)').evaluate({})).toBe(-1);
    expect(compileExpression('clamp(5, 0, 3)').evaluate({})).toBe(3);
    expect(compileExpression("contains('abcd', 'bc')").evaluate({})).toBe(true);
    expect(compileExpression("contains(done, 'item-2')").evaluate({ done: ['item-1', 'item-2'] })).toBe(true);
    expect(compileExpression("contains(done, 'item-3')").evaluate({ done: ['item-1'] })).toBe(false);
    expect(compileExpression("len('😀a')").evaluate({})).toBe(2);
    expect(compileExpression('len(done)').evaluate({ done: ['a', 'b'] })).toBe(2);
    expect(compileExpression('log(e)').evaluate({})).toBeCloseTo(1);

    expect(compileExpression('len(done)').inferType({ done: 'array' })).toBe('number');
    expect(compileExpression("contains(done, 'x')").inferType({ done: 'array' })).toBe('boolean');
    expect(failure(() => compileExpression('len(1)').inferType({})).code).toBe('expression-type');
    expect(failure(() => compileExpression('contains(done, 1)').inferType({ done: 'array' })).code).toBe('expression-type');
    expect(failure(() => compileExpression('pow(1)').inferType({})).code).toBe('expression-arity');
    expect(failure(() => compileExpression('missing(1)').inferType({})).code).toBe('expression-unknown-function');
  });

  it('handles string escapes and code-point comparison', () => {
    expect(compileExpression('"line\\n\\t\\"quoted\\" \\\\"').evaluate({})).toBe('line\n\t"quoted" \\');
    expect(compileExpression("'a\\'b'").evaluate({})).toBe("a'b");
    expect(compileExpression("'A' < 'a'").evaluate({})).toBe(true);
    expect(compileExpression("'10' < '9'").evaluate({})).toBe(true);
    expect(failure(() => compileExpression("'a\\qb'")).code).toBe('expression-string');
    expect(failure(() => compileExpression("'a")).code).toBe('expression-string');
  });

  it('compares arrays structurally and allows null equality', () => {
    const env = { a: ['x', 'y'], b: ['x', 'y'], c: ['x'] };
    expect(compileExpression('a == b').evaluate(env)).toBe(true);
    expect(compileExpression('a != c').evaluate(env)).toBe(true);
    expect(compileExpression('null == null').evaluate({})).toBe(true);
    expect(compileExpression('null == null').inferType({})).toBe('boolean');
  });

  it('rejects forbidden names and enforces budgets', () => {
    expect(failure(() => compileExpression('__proto__')).code).toBe('expression-forbidden-name');
    expect(failure(() => compileExpression('constructor')).code).toBe('expression-forbidden-name');
    expect(failure(() => compileExpression('len')).code).toBe('expression-syntax');
    expect(failure(() => compileExpression('1 = 2')).code).toBe('expression-assignment');
    expect(failure(() => compileExpression('a.b')).code).toBe('expression-property');
    expect(failure(() => compileExpression('1 & 2')).code).toBe('expression-syntax');
    expect(failure(() => compileExpression('')).code).toBe('expression-empty');
    expect(failure(() => compileExpression('1'.repeat(4001))).code).toBe('expression-budget');
    expect(failure(() => compileExpression(`${'('.repeat(120)}1${')'.repeat(120)}`)).code).toBe('expression-budget');
    expect(failure(() => compileExpression(Array.from({ length: 250 }, () => '1').join('+'))).code)
      .toBe('expression-budget');
    const syntax = failure(() => compileExpression('1 + @'));
    expect(syntax.code).toBe('expression-syntax');
    expect(syntax.offset).toBe(4);
  });

  it('reserves binding and built-in names', () => {
    for (const name of ['x', 'y', 'pi', 'e', 'true', 'false', 'null', 'len', 'contains', 'clamp']) {
      expect(RESERVED_NAMES.has(name)).toBe(true);
    }
    expect(RESERVED_NAMES.has('people')).toBe(false);
  });
});

describe('interpolation', () => {
  const env = { people: 3, annual: true, done: ['item-1'], empty: null, name: 'Ada' };

  it('renders scalars in mixed text', () => {
    expect(interpolate('人数：{{ people }}，年度：{{ annual }}。', env)).toBe('人数：3，年度：true。');
    expect(interpolate('{{ people * 2 }} 元', env)).toBe('6 元');
    expect(interpolate('{{ empty }}', env)).toBe('');
    expect(interpolate('{{ name }} / {{ len(done) }} 项', env)).toBe('Ada / 1 项');
    expect(interpolate('普通文本', env)).toBe('普通文本');
    expect(interpolate('{{ "a}}b" }}', env)).toBe('a}}b');
  });

  it('rejects arrays in text output', () => {
    expect(failure(() => interpolate('{{ done }}', env)).code).toBe('expression-type');
  });

  it('preserves the type of a whole interpolation', () => {
    expect(expressionValue('{{ people * 2 }}', env)).toBe(6);
    expect(expressionValue(' {{ people * 2 }} ', env)).toBe(6);
    expect(expressionValue('{{ annual }}', env)).toBe(true);
    expect(expressionValue('{{ empty }}', env)).toBe(null);
    expect(expressionValue('{{ done }}', env)).toEqual(['item-1']);
    expect(expressionValue('{{ name }} 先生', env)).toBe('Ada 先生');
    expect(expressionValue('no interpolation', env)).toBe('no interpolation');
  });

  it('reports template and expression offsets', () => {
    const missing = failure(() => interpolate('x {{ missing }}', {}));
    expect(missing.code).toBe('expression-unknown-name');
    expect(missing.offset).toBe(5);
    expect(failure(() => interpolate('x {{ 1 +', {})).code).toBe('expression-interpolation');
    expect(failure(() => interpolate('{{  }}', {})).code).toBe('expression-empty');
    expect(failure(() => interpolate('{{ {{ people }} }}', env)).code).toBe('expression-interpolation');
  });
});
