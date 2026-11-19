import {
  arrayValueProblem,
  LocalExpressionError,
  localValueBudgetError,
  MAX_EVAL_DEPTH,
  MAX_EVAL_STEPS,
  MAX_STRING_LENGTH,
} from './expression-values';
import type { LocalValue } from '../types';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatScientific,
  LocalFunctionError,
} from './formatting';
import type { Ast } from './expression-syntax';
import { literalKind } from './expression-inference';
import { countLocalCodePoints } from '../source/source-context';
import { averageNumberArray, maxNumberArray, minNumberArray, sumNumberArray } from './collection-functions';
import {
  compareDates,
  diffDates,
  endsWithText,
  lowerText,
  replaceLiteral,
  sliceCodePoints,
  startsWithText,
  trimText,
  upperText,
} from './data-functions';

interface Budget {
  steps: number;
}

function fail(message: string, offset: number, code = 'expression-eval'): never {
  throw new LocalExpressionError(code, message, offset);
}

function checkEnv(env: Record<string, LocalValue>): void {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new LocalExpressionError('expression-value', 'Expression environment must be an object.', 0);
  }
}

function checkValue(value: unknown, name: string, offset: number): LocalValue {
  if (value === null) return null;
  if (typeof value === 'string') {
    const budget = localValueBudgetError(value);
    if (budget) {
      throw new LocalExpressionError('expression-budget', `Variable "${name}": ${budget}`, offset);
    }
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new LocalExpressionError('expression-value', `Variable "${name}" must be a finite number.`, offset);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const problem = arrayValueProblem(value);
    if (problem) {
      throw new LocalExpressionError(problem.code, `Variable "${name}": ${problem.message}`, offset);
    }
    return value as LocalValue;
  }
  throw new LocalExpressionError('expression-value', `Variable "${name}" has an invalid value type.`, offset);
}

function readVariable(env: Record<string, LocalValue>, name: string, offset: number): LocalValue {
  checkEnv(env);
  if (!Object.prototype.hasOwnProperty.call(env, name)) {
    fail(`Variable "${name}" is not declared.`, offset, 'expression-unknown-name');
  }
  return checkValue(env[name], name, offset);
}

function requireNumber(value: LocalValue, offset: number, message = 'Expected a number'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${message}.`, offset, 'expression-type');
  }
  return value;
}

function requireBoolean(value: LocalValue, offset: number, message = 'Expected a boolean'): boolean {
  if (typeof value !== 'boolean') fail(`${message}.`, offset, 'expression-type');
  return value;
}

function requireString(value: LocalValue, offset: number, message = 'Expected a string'): string {
  if (typeof value !== 'string') fail(`${message}.`, offset, 'expression-type');
  return value;
}

/** Numeric aggregates accept only homogeneous, finite numeric arrays. */
function requireNumberArray(value: LocalValue, offset: number, message: string): number[] {
  if (!Array.isArray(value)) fail(`${message}.`, offset, 'expression-type');
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      fail(`${message}.`, offset, 'expression-type');
    }
  }
  return value as number[];
}

/** Array-literal results share the environment array shape rules. */
function arrayLiteralValue(elements: LocalValue[], offset: number): LocalValue {
  const problem = arrayValueProblem(elements);
  if (problem) fail(problem.message, offset, problem.code);
  return elements as string[] | number[];
}

/**
 * Run a formatting or data helper and translate its failure into an expression
 * error at the call site. The helpers do not know source offsets.
 */
function runLocalFunction<T>(offset: number, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof LocalFunctionError) {
      throw new LocalExpressionError(error.code, error.message, offset);
    }
    throw error;
  }
}

function finiteResult(value: number, offset: number): number {
  if (Number.isNaN(value)) fail('The result is undefined.', offset, 'expression-domain');
  if (!Number.isFinite(value)) fail('The result is not a finite number.', offset, 'expression-number');
  return value;
}

function compareStrings(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const ac = a[i].codePointAt(0) as number;
    const bc = b[i].codePointAt(0) as number;
    if (ac !== bc) return ac < bc ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function deepEqual(left: LocalValue, right: LocalValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }
  return false;
}

export function evalAst(ast: Ast, env: Record<string, LocalValue>): LocalValue {
  return evalNode(ast, env, { steps: 0 }, 1);
}

function evalNode(
  ast: Ast,
  env: Record<string, LocalValue>,
  budget: Budget,
  depth: number,
): LocalValue {
  budget.steps += 1;
  if (budget.steps > MAX_EVAL_STEPS) {
    fail('Expression evaluation exceeded the step limit.', ast.start, 'expression-budget');
  }
  if (depth > MAX_EVAL_DEPTH) {
    fail('Expression evaluation is nested too deeply.', ast.start, 'expression-budget');
  }

  switch (ast.kind) {
    case 'literal':
      return ast.value;
    case 'reference':
      return readVariable(env, ast.name, ast.start);
    case 'unary': {
      const value = evalNode(ast.operand, env, budget, depth + 1);
      if (ast.operator === '!') {
        return !requireBoolean(value, ast.start, 'Logical not requires a boolean');
      }
      const number = requireNumber(value, ast.start, `Unary ${ast.operator} requires a number`);
      return finiteResult(ast.operator === '-' ? -number : number, ast.start);
    }
    case 'binary': {
      if (ast.operator === '&&' || ast.operator === '||') {
        const left = requireBoolean(
          evalNode(ast.left, env, budget, depth + 1),
          ast.start,
          'Logical operators require booleans',
        );
        if (ast.operator === '&&' && !left) return false;
        if (ast.operator === '||' && left) return true;
        return requireBoolean(
          evalNode(ast.right, env, budget, depth + 1),
          ast.start,
          'Logical operators require booleans',
        );
      }

      const left = evalNode(ast.left, env, budget, depth + 1);
      const right = evalNode(ast.right, env, budget, depth + 1);
      switch (ast.operator) {
        case '+':
          if (typeof left === 'number' && typeof right === 'number') {
            return finiteResult(left + right, ast.start);
          }
          if (typeof left === 'string' && typeof right === 'string') {
            const value = left + right;
            if (value.length > MAX_STRING_LENGTH) {
              fail('String result exceeds the length limit.', ast.start, 'expression-budget');
            }
            return value;
          }
          fail('Operator "+" requires two numbers or two strings.', ast.start, 'expression-type');
        case '-':
        case '*':
        case '/':
        case '%': {
          const a = requireNumber(left, ast.start, `Operator "${ast.operator}" requires a number`);
          const b = requireNumber(right, ast.start, `Operator "${ast.operator}" requires a number`);
          if ((ast.operator === '/' || ast.operator === '%') && b === 0) {
            fail('Division by zero.', ast.start, 'expression-divide-by-zero');
          }
          const value =
            ast.operator === '-' ? a - b :
            ast.operator === '*' ? a * b :
            ast.operator === '/' ? a / b :
            a % b;
          return finiteResult(value, ast.start);
        }
        case '==':
        case '!=': {
          const leftKind = literalKind(left);
          const rightKind = literalKind(right);
          if (leftKind !== rightKind && leftKind !== 'null' && rightKind !== 'null') {
            fail('Equality comparison requires matching types.', ast.start, 'expression-type');
          }
          const equal = deepEqual(left, right);
          return ast.operator === '==' ? equal : !equal;
        }
        case '<':
        case '<=':
        case '>':
        case '>=': {
          let comparison: number;
          if (typeof left === 'number' && typeof right === 'number') {
            comparison = left === right ? 0 : left < right ? -1 : 1;
          } else if (typeof left === 'string' && typeof right === 'string') {
            comparison = compareStrings(left, right);
          } else {
            fail(`Comparison operator "${ast.operator}" requires two numbers or two strings.`, ast.start, 'expression-type');
          }
          if (ast.operator === '<') return comparison < 0;
          if (ast.operator === '<=') return comparison <= 0;
          if (ast.operator === '>') return comparison > 0;
          return comparison >= 0;
        }
      }
      break;
    }
    case 'conditional': {
      const test = requireBoolean(
        evalNode(ast.test, env, budget, depth + 1),
        ast.start,
        'Conditional test must be a boolean',
      );
      return evalNode(test ? ast.consequent : ast.alternate, env, budget, depth + 1);
    }
    case 'array': {
      const elements: LocalValue[] = [];
      for (const element of ast.elements) {
        elements.push(evalNode(element, env, budget, depth + 1));
      }
      return arrayLiteralValue(elements, ast.start);
    }
    case 'index': {
      const target = evalNode(ast.target, env, budget, depth + 1);
      const index = requireNumber(
        evalNode(ast.index, env, budget, depth + 1),
        ast.start,
        'Array index must be a number',
      );
      if (!Number.isSafeInteger(index)) {
        fail('Array index must be a finite integer.', ast.start, 'expression-index');
      }
      if (!Array.isArray(target)) {
        fail('Index access requires an array.', ast.start, 'expression-type');
      }
      if (index < 0 || index >= target.length) return null;
      return target[index];
    }
    case 'call': {
      const args = ast.args.map((arg) => evalNode(arg, env, budget, depth + 1));
      switch (ast.name) {
        case 'abs':
        case 'sqrt':
        case 'floor':
        case 'ceil':
        case 'round':
        case 'sin':
        case 'cos':
        case 'tan':
        case 'asin':
        case 'acos':
        case 'atan':
        case 'exp':
        case 'log': {
          const value = requireNumber(args[0], ast.start, `Function ${ast.name} requires a number`);
          if (ast.name === 'sqrt' && value < 0) fail('sqrt requires a non-negative argument.', ast.start, 'expression-domain');
          if (ast.name === 'log' && value <= 0) fail('log requires a positive argument.', ast.start, 'expression-domain');
          if ((ast.name === 'asin' || ast.name === 'acos') && (value < -1 || value > 1)) {
            fail(`${ast.name} requires an argument between -1 and 1.`, ast.start, 'expression-domain');
          }
          let result: number;
          switch (ast.name) {
            case 'abs': result = Math.abs(value); break;
            case 'sqrt': result = Math.sqrt(value); break;
            case 'floor': result = Math.floor(value); break;
            case 'ceil': result = Math.ceil(value); break;
            case 'round': result = Math.round(value); break;
            case 'sin': result = Math.sin(value); break;
            case 'cos': result = Math.cos(value); break;
            case 'tan': result = Math.tan(value); break;
            case 'asin': result = Math.asin(value); break;
            case 'acos': result = Math.acos(value); break;
            case 'atan': result = Math.atan(value); break;
            case 'exp': result = Math.exp(value); break;
            default: result = Math.log(value); break;
          }
          return finiteResult(result, ast.start);
        }
        case 'min':
        case 'max': {
          let result = requireNumber(args[0], ast.start, `Function ${ast.name} requires a number`);
          for (let i = 1; i < args.length; i += 1) {
            const value = requireNumber(args[i], ast.start, `Function ${ast.name} requires a number`);
            result = ast.name === 'min' ? Math.min(result, value) : Math.max(result, value);
          }
          return finiteResult(result, ast.start);
        }
        case 'pow': {
          const base = requireNumber(args[0], ast.start, 'Function pow requires a number');
          const exponent = requireNumber(args[1], ast.start, 'Function pow requires a number');
          return finiteResult(Math.pow(base, exponent), ast.start);
        }
        case 'clamp': {
          const value = requireNumber(args[0], ast.start, 'Function clamp requires a number');
          const lower = requireNumber(args[1], ast.start, 'Function clamp requires a number');
          const upper = requireNumber(args[2], ast.start, 'Function clamp requires a number');
          if (lower > upper) fail('clamp lower bound cannot exceed upper bound.', ast.start, 'expression-domain');
          return finiteResult(Math.min(upper, Math.max(lower, value)), ast.start);
        }
        case 'len': {
          const value = args[0];
          if (typeof value === 'string') return countLocalCodePoints(value);
          if (Array.isArray(value)) return value.length;
          fail('Function len requires a string or array.', ast.start, 'expression-type');
        }
        case 'contains': {
          const haystack = args[0];
          const needle = args[1];
          if (typeof haystack === 'string') {
            return haystack.includes(
              requireString(needle, ast.start, 'Function contains requires a string member'),
            );
          }
          if (Array.isArray(haystack)) {
            if (typeof needle === 'string') {
              for (const item of haystack) {
                if (typeof item !== 'string') {
                  fail('Function contains requires a string member for a string array.', ast.start, 'expression-type');
                }
              }
              return (haystack as string[]).includes(needle);
            }
            if (typeof needle === 'number' && Number.isFinite(needle)) {
              for (const item of haystack) {
                if (typeof item !== 'number') {
                  fail('Function contains requires a numeric member for a numeric array.', ast.start, 'expression-type');
                }
              }
              return (haystack as number[]).includes(needle);
            }
            fail('Function contains requires a string or numeric member.', ast.start, 'expression-type');
          }
          fail('Function contains requires a string or array.', ast.start, 'expression-type');
        }
        case 'sum': {
          const values = requireNumberArray(args[0], ast.start, 'Function sum requires a numeric array');
          return runLocalFunction(ast.start, () => sumNumberArray(values));
        }
        case 'average': {
          const values = requireNumberArray(args[0], ast.start, 'Function average requires a numeric array');
          return runLocalFunction(ast.start, () => averageNumberArray(values));
        }
        case 'minOf': {
          const values = requireNumberArray(args[0], ast.start, 'Function minOf requires a numeric array');
          return runLocalFunction(ast.start, () => minNumberArray(values));
        }
        case 'maxOf': {
          const values = requireNumberArray(args[0], ast.start, 'Function maxOf requires a numeric array');
          return runLocalFunction(ast.start, () => maxNumberArray(values));
        }
        case 'formatNumber': {
          const value = args[0] === null
            ? null
            : requireNumber(args[0], ast.start, 'Function formatNumber requires a number or null');
          const digits = args[1] === undefined
            ? 2
            : requireNumber(args[1], ast.start, 'Function formatNumber requires numeric fraction digits');
          const locale = args[2] === undefined
            ? 'en-US'
            : requireString(args[2], ast.start, 'Function formatNumber requires a string locale');
          const grouping = args[3] === undefined
            ? true
            : requireBoolean(args[3], ast.start, 'Function formatNumber requires a boolean grouping flag');
          return runLocalFunction(ast.start, () => formatNumber(value, digits, locale, grouping));
        }
        case 'formatPercent': {
          const value = args[0] === null
            ? null
            : requireNumber(args[0], ast.start, 'Function formatPercent requires a number or null');
          const digits = args[1] === undefined
            ? 0
            : requireNumber(args[1], ast.start, 'Function formatPercent requires numeric fraction digits');
          const locale = args[2] === undefined
            ? 'en-US'
            : requireString(args[2], ast.start, 'Function formatPercent requires a string locale');
          return runLocalFunction(ast.start, () => formatPercent(value, digits, locale));
        }
        case 'formatScientific': {
          const value = args[0] === null
            ? null
            : requireNumber(args[0], ast.start, 'Function formatScientific requires a number or null');
          const digits = args[1] === undefined
            ? 2
            : requireNumber(args[1], ast.start, 'Function formatScientific requires numeric fraction digits');
          const locale = args[2] === undefined
            ? 'en-US'
            : requireString(args[2], ast.start, 'Function formatScientific requires a string locale');
          return runLocalFunction(ast.start, () => formatScientific(value, digits, locale));
        }
        case 'formatCurrency': {
          const value = args[0] === null
            ? null
            : requireNumber(args[0], ast.start, 'Function formatCurrency requires a number or null');
          const currency = args[1] === undefined
            ? 'USD'
            : requireString(args[1], ast.start, 'Function formatCurrency requires a string currency code');
          const digits = args[2] === undefined
            ? 2
            : requireNumber(args[2], ast.start, 'Function formatCurrency requires numeric fraction digits');
          const locale = args[3] === undefined
            ? 'en-US'
            : requireString(args[3], ast.start, 'Function formatCurrency requires a string locale');
          return runLocalFunction(ast.start, () => formatCurrency(value, currency, digits, locale));
        }
        case 'trim':
          return runLocalFunction(ast.start, () =>
            trimText(requireString(args[0], ast.start, 'Function trim requires a string')));
        case 'lower':
          return runLocalFunction(ast.start, () =>
            lowerText(requireString(args[0], ast.start, 'Function lower requires a string')));
        case 'upper':
          return runLocalFunction(ast.start, () =>
            upperText(requireString(args[0], ast.start, 'Function upper requires a string')));
        case 'startsWith':
          return runLocalFunction(ast.start, () =>
            startsWithText(
              requireString(args[0], ast.start, 'Function startsWith requires a string'),
              requireString(args[1], ast.start, 'Function startsWith requires a string search value'),
            ));
        case 'endsWith':
          return runLocalFunction(ast.start, () =>
            endsWithText(
              requireString(args[0], ast.start, 'Function endsWith requires a string'),
              requireString(args[1], ast.start, 'Function endsWith requires a string search value'),
            ));
        case 'replace': {
          const text = requireString(args[0], ast.start, 'Function replace requires a string');
          const search = requireString(args[1], ast.start, 'Function replace requires a string search value');
          const replacement = requireString(args[2], ast.start, 'Function replace requires a string replacement');
          return runLocalFunction(ast.start, () => replaceLiteral(text, search, replacement));
        }
        case 'slice': {
          const text = requireString(args[0], ast.start, 'Function slice requires a string');
          const start = requireNumber(args[1], ast.start, 'Function slice requires a numeric start index');
          const end = args[2] === undefined
            ? undefined
            : requireNumber(args[2], ast.start, 'Function slice requires a numeric end index');
          return runLocalFunction(ast.start, () => sliceCodePoints(text, start, end));
        }
        case 'dateCompare': {
          const left = requireString(args[0], ast.start, 'Function dateCompare requires a date string');
          const right = requireString(args[1], ast.start, 'Function dateCompare requires a date string');
          return runLocalFunction(ast.start, () => compareDates(left, right));
        }
        case 'dateDiff': {
          const left = requireString(args[0], ast.start, 'Function dateDiff requires a date string');
          const right = requireString(args[1], ast.start, 'Function dateDiff requires a date string');
          const unit = args[2] === undefined
            ? 'days'
            : requireString(args[2], ast.start, 'Function dateDiff requires a string unit');
          return runLocalFunction(ast.start, () => diffDates(left, right, unit));
        }
      }
      break;
    }
  }
  throw new LocalExpressionError('expression-eval', 'Unsupported expression.', 0);
}
