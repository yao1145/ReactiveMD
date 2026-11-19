import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_STRING_LENGTH,
  MAX_LOCAL_VALUE_CHARACTERS,
} from '../../configuration/limits';
import {
  diagnosticEnglish,
  localDiagnosticDetails,
  type LocalDiagnosticDetails,
} from '../../configuration/diagnostics';
import type { LocalValue } from '../../types';

/**
 * The local-draft expression language.
 *
 * The parser produces an explicit AST. Evaluation never uses eval, Function or
 * the global object: only the provided environment and a fixed set of pure
 * functions are reachable. Numbers must stay finite, strings and arrays have a
 * budget, and every operator is type checked.
 */
export class LocalExpressionError extends Error {
  readonly offset: number;
  readonly code: string;

  constructor(code: string, message: string, offset = 0) {
    super(message);
    this.name = 'LocalExpressionError';
    this.code = code;
    this.offset = offset;
  }
}

const BUILTIN_FUNCTIONS = [
  'abs', 'sqrt', 'floor', 'ceil', 'round', 'min', 'max', 'pow',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log',
  'len', 'contains', 'clamp',
  'sum', 'average', 'minOf', 'maxOf',
  'formatNumber', 'formatPercent', 'formatScientific', 'formatCurrency',
  'trim', 'lower', 'upper', 'startsWith', 'endsWith', 'replace', 'slice',
  'dateCompare', 'dateDiff',
] as const;

export type BuiltinName = (typeof BUILTIN_FUNCTIONS)[number];

export const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_FUNCTIONS);

export const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
]);

export const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

export const VALID_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'null', 'array', 'number-array']);

/** Names that cannot be used as a document binding. */
export const RESERVED_NAMES = new Set<string>([
  ...BUILTIN_FUNCTIONS,
  'x', 'y', 'pi', 'e', 'true', 'false', 'null',
  ...FORBIDDEN_NAMES,
]);

/** Expression source, in UTF-16 code units, per expression. */
export const MAX_EXPRESSION_LENGTH = 4000;

/** Cumulative AST constructions and final AST depth, per expression. */
export const MAX_AST_NODES = 2000;

export const MAX_PARSE_DEPTH = 100;

export const MAX_AST_DEPTH = 200;

/** AST node visits and call depth, per evaluation; short-circuited branches are not visited. */
export const MAX_EVAL_STEPS = 10000;

export const MAX_EVAL_DEPTH = 250;

/** Shared value budgets. `MAX_STRING_LENGTH` also caps concatenation results (UTF-16). */
export const MAX_STRING_LENGTH = MAX_LOCAL_STRING_LENGTH;

interface ArrayValueProblem extends LocalDiagnosticDetails {
  code: 'expression-budget' | 'expression-value';
  message: string;
}

/**
 * Validate the shared array shape: `array` stays a string array, while
 * `number-array` holds finite numbers only. Mixed, nested, boolean and null
 * members are rejected. String arrays keep the per-member and total character
 * budgets; numeric arrays only need finite members.
 */
export function arrayValueProblem(value: readonly unknown[]): ArrayValueProblem | null {
  if (value.length > MAX_LOCAL_ARRAY_LENGTH) {
    return {
      code: 'expression-budget',
      ...localDiagnosticDetails('local.budget.value.array', { limit: MAX_LOCAL_ARRAY_LENGTH }),
      message: `Array exceeds the ${MAX_LOCAL_ARRAY_LENGTH}-item limit.`,
    };
  }
  let kind: 'string' | 'number' | null = null;
  let characters = 0;
  for (const item of value) {
    if (typeof item === 'string') {
      if (kind === 'number') {
        return {
          code: 'expression-value',
          key: 'error.array.homogeneous',
          message: 'Array elements must all be strings or all be numbers.',
        };
      }
      kind = 'string';
      if (item.length > MAX_LOCAL_STRING_LENGTH) {
        return {
          code: 'expression-budget',
          ...localDiagnosticDetails('local.budget.value.array-member', { limit: MAX_LOCAL_STRING_LENGTH }),
          message: `Array member exceeds the ${MAX_LOCAL_STRING_LENGTH}-character limit.`,
        };
      }
      characters += item.length;
      if (characters > MAX_LOCAL_VALUE_CHARACTERS) {
        return {
          code: 'expression-budget',
          ...localDiagnosticDetails('local.budget.value.array-contents', { limit: MAX_LOCAL_VALUE_CHARACTERS }),
          message: `Array contents exceed the ${MAX_LOCAL_VALUE_CHARACTERS}-character limit.`,
        };
      }
      continue;
    }
    if (typeof item === 'number') {
      if (kind === 'string') {
        return {
          code: 'expression-value',
          key: 'error.array.homogeneous',
          message: 'Array elements must all be strings or all be numbers.',
        };
      }
      kind = 'number';
      if (!Number.isFinite(item)) {
        return {
          code: 'expression-value',
          key: 'error.array.finite',
          message: 'Array members must be finite numbers.',
        };
      }
      continue;
    }
    return {
      code: 'expression-value',
      key: 'error.array.members',
      message: 'Array members must be strings or finite numbers.',
    };
  }
  return null;
}

/**
 * Allocation-free budget check for a value stored in the runtime or read from
 * an expression environment. Returns structured metadata, or null when the
 * value fits. These are defensive resource budgets: string lengths are UTF-16
 * code units (matching allocation cost), while author-visible text constraints
 * use `countLocalCodePoints`. `len()` keeps counting code points.
 */
export function localValueBudgetIssue(value: LocalValue): LocalDiagnosticDetails | null {
  if (typeof value === 'string') {
    return value.length > MAX_LOCAL_STRING_LENGTH
      ? localDiagnosticDetails('local.budget.value.string', { limit: MAX_LOCAL_STRING_LENGTH })
      : null;
  }
  if (Array.isArray(value)) {
    const problem = arrayValueProblem(value);
    return problem ? localDiagnosticDetails(problem.key, problem.params) : null;
  }
  return null;
}

/** English message form kept for existing callers and error construction. */
export function localValueBudgetError(value: LocalValue): string | null {
  const issue = localValueBudgetIssue(value);
  return issue ? diagnosticEnglish(issue) : null;
}
