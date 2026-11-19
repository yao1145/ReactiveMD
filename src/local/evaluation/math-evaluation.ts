import type { LocalValue } from '../types';
import type { Ast, When } from './math';
import { LatexError, MAX_EVAL_DEPTH } from './math-syntax';

export interface Evaluation {
  x: number;
  env: Record<string, LocalValue>;
  steps: number;
  limit: number;
  depth: number;
}

function fail(code: string, message: string, offset: number): never {
  throw new LatexError(code, message, offset);
}

function finite(value: number, offset: number): number {
  if (!Number.isFinite(value)) fail('latex-number', 'Result is not finite.', offset);
  return value;
}

function readVariable(name: string, state: Evaluation, offset: number): number {
  if (name === 'x') return state.x;
  const value = state.env[name];
  if (value === undefined && !Object.prototype.hasOwnProperty.call(state.env, name)) {
    fail('latex-variable', `Parameter "${name}" is not declared.`, offset);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('latex-type', `Parameter "${name}" must be a finite number.`, offset);
  }
  return value;
}

function power(base: number, exponent: number, offset: number): number {
  if (base === 0 && exponent < 0) {
    fail('latex-divide-by-zero', 'Negative powers of zero are undefined.', offset);
  }
  if (base < 0 && !Number.isInteger(exponent)) {
    fail('latex-domain', 'A negative base with a non-integer exponent is not real.', offset);
  }
  return finite(Math.pow(base, exponent), offset);
}

function root(value: number, index: number | null, offset: number): number {
  const degree = index ?? 2;
  if (!Number.isFinite(degree) || degree <= 0) {
    fail('latex-domain', 'Root index must be positive.', offset);
  }
  if (value < 0) {
    if (!Number.isInteger(degree) || degree % 2 === 0) {
      fail('latex-domain', 'A negative number has no real even root.', offset);
    }
    const result = degree === 3 ? -Math.cbrt(-value) : -Math.pow(-value, 1 / degree);
    return finite(result, offset);
  }
  return finite(Math.pow(value, 1 / degree), offset);
}

function compare(when: When, state: Evaluation): boolean {
  const left = evaluateAst(when.left, state);
  const right = evaluateAst(when.right, state);
  switch (when.op) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'lt': return left < right;
    case 'le': return left <= right;
    case 'gt': return left > right;
    case 'ge': return left >= right;
    default: return false;
  }
}

function evaluateCall(node: Extract<Ast, { kind: 'call' }>, state: Evaluation): number {
  const args = node.args.map((arg) => evaluateAst(arg, state));

  let value = 0;
  switch (node.name) {
    case 'sin': value = Math.sin(args[0]); break;
    case 'cos': value = Math.cos(args[0]); break;
    case 'tan':
      if (Math.abs(Math.cos(args[0])) < 1e-15) {
        fail('latex-domain', 'tan is undefined at this point.', node.offset);
      }
      value = Math.tan(args[0]);
      break;
    case 'arcsin':
      if (args[0] < -1 || args[0] > 1) fail('latex-domain', 'arcsin argument must be in [-1, 1].', node.offset);
      value = Math.asin(args[0]);
      break;
    case 'arccos':
      if (args[0] < -1 || args[0] > 1) fail('latex-domain', 'arccos argument must be in [-1, 1].', node.offset);
      value = Math.acos(args[0]);
      break;
    case 'arctan': value = Math.atan(args[0]); break;
    case 'exp': value = Math.exp(args[0]); break;
    case 'ln':
      if (args[0] <= 0) fail('latex-domain', 'ln argument must be positive.', node.offset);
      value = Math.log(args[0]);
      break;
    case 'log': {
      const base = node.base ? evaluateAst(node.base, state) : 10;
      if (base <= 0 || base === 1) fail('latex-domain', 'Logarithm base must be positive and not equal to 1.', node.offset);
      if (args[0] <= 0) fail('latex-domain', 'Logarithm argument must be positive.', node.offset);
      value = Math.log(args[0]) / Math.log(base);
      break;
    }
    case 'min':
      value = Math.min(...args);
      break;
    case 'max':
      value = Math.max(...args);
      break;
    case 'sqrt':
      value = root(args[0], node.base ? evaluateAst(node.base, state) : null, node.offset);
      break;
    default:
      fail('latex-unsupported', 'Unsupported function.', node.offset);
  }

  if (node.power) {
    value = power(value, evaluateAst(node.power, state), node.offset);
  }
  return finite(value, node.offset);
}

export function evaluateAst(node: Ast, state: Evaluation): number {
  const offset = node.offset;
  state.steps += 1;
  state.depth += 1;
  try {
    if (state.steps > state.limit) {
      fail('latex-budget', 'Math evaluation exceeded its budget.', offset);
    }
    if (state.depth > MAX_EVAL_DEPTH) {
      fail('latex-budget', 'Math evaluation is nested too deeply.', offset);
    }

    switch (node.kind) {
    case 'number':
      return node.value;
    case 'constant':
      return node.value === 'pi' ? Math.PI : Math.E;
    case 'variable':
      return readVariable(node.name, state, node.offset);
    case 'unary': {
      const value = evaluateAst(node.operand, state);
      return node.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluateAst(node.left, state);
      const right = evaluateAst(node.right, state);
      switch (node.op) {
        case '+': return finite(left + right, node.offset);
        case '-': return finite(left - right, node.offset);
        case '*': return finite(left * right, node.offset);
        case '/':
          if (right === 0) fail('latex-divide-by-zero', 'Division by zero.', node.offset);
          return finite(left / right, node.offset);
        case '^': return power(left, right, node.offset);
      }
      break;
    }
    case 'abs':
      return finite(Math.abs(evaluateAst(node.value, state)), node.offset);
    case 'call':
      return evaluateCall(node, state);
    case 'cases': {
      for (const branch of node.branches) {
        if (branch.when === null || compare(branch.when, state)) {
          return evaluateAst(branch.value, state);
        }
      }
      fail('latex-undefined', 'No piecewise branch matched.', node.offset);
    }
  }
  fail('latex-unsupported', 'Cannot compute this math structure.', offset);
  } finally {
    state.depth -= 1;
  }
}
