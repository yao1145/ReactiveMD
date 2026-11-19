import type { LocalValue, LocalValueKind } from '../../types';
import { LocalExpressionError, VALID_KINDS } from './values';
import type { Ast } from './syntax';

function kindName(kind: LocalValueKind): string {
  switch (kind) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': return 'array';
    case 'number-array': return 'number array';
  }
}

export function literalKind(value: LocalValue): LocalValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function typeError(message: string, offset: number): never {
  throw new LocalExpressionError('expression-type', message, offset);
}

function requireKind(actual: LocalValueKind, expected: LocalValueKind, offset: number, message: string): void {
  if (actual !== expected) {
    typeError(`${message}, got ${kindName(actual)}.`, offset);
  }
}

function unifyKinds(left: LocalValueKind, right: LocalValueKind): LocalValueKind | null {
  if (left === right) return left;
  if (left === 'null') return right;
  if (right === 'null') return left;
  return null;
}

export function inferAst(ast: Ast, env: Record<string, LocalValueKind>): LocalValueKind {
  switch (ast.kind) {
    case 'literal':
      return literalKind(ast.value);
    case 'reference': {
      if (env === null || typeof env !== 'object' || !Object.prototype.hasOwnProperty.call(env, ast.name)) {
        throw new LocalExpressionError('expression-unknown-name', `Variable "${ast.name}" is not declared.`, ast.start);
      }
      const kind = env[ast.name];
      if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
        throw new LocalExpressionError('expression-value', `Variable "${ast.name}" has an invalid type.`, ast.start);
      }
      return kind;
    }
    case 'unary': {
      const operand = inferAst(ast.operand, env);
      if (ast.operator === '!') {
        requireKind(operand, 'boolean', ast.start, 'Logical not requires a boolean');
        return 'boolean';
      }
      requireKind(operand, 'number', ast.start, `Unary ${ast.operator} requires a number`);
      return 'number';
    }
    case 'binary': {
      const left = inferAst(ast.left, env);
      const right = inferAst(ast.right, env);
      switch (ast.operator) {
        case '+':
          if (left === 'number' && right === 'number') return 'number';
          if (left === 'string' && right === 'string') return 'string';
          return typeError(
            `Operator "+" requires two numbers or two strings, got ${kindName(left)} and ${kindName(right)}.`,
            ast.start,
          );
        case '-':
        case '*':
        case '/':
        case '%':
          requireKind(left, 'number', ast.start, `Operator "${ast.operator}" requires a number`);
          requireKind(right, 'number', ast.start, `Operator "${ast.operator}" requires a number`);
          return 'number';
        case '<':
        case '<=':
        case '>':
        case '>=':
          if (!((left === 'number' && right === 'number') || (left === 'string' && right === 'string'))) {
            return typeError(
              `Comparison operator "${ast.operator}" requires two numbers or two strings, got ${kindName(left)} and ${kindName(right)}.`,
              ast.start,
            );
          }
          return 'boolean';
        case '==':
        case '!=':
          if (left !== right && left !== 'null' && right !== 'null') {
            return typeError(`Equality comparison requires matching types, got ${kindName(left)} and ${kindName(right)}.`, ast.start);
          }
          return 'boolean';
        case '&&':
        case '||':
          requireKind(left, 'boolean', ast.start, 'Logical operators require booleans');
          requireKind(right, 'boolean', ast.start, 'Logical operators require booleans');
          return 'boolean';
      }
      break;
    }
    case 'array': {
      if (ast.elements.length === 0) return 'number-array';
      let elementKind: LocalValueKind | null = null;
      for (const element of ast.elements) {
        const kind = inferAst(element, env);
        if (kind !== 'string' && kind !== 'number') {
          return typeError(
            `Array literals require string or number elements, got ${kindName(kind)}.`,
            element.start,
          );
        }
        if (elementKind === null) elementKind = kind;
        else if (elementKind !== kind) {
          return typeError(
            `Array literals require elements of one type, got ${kindName(elementKind)} and ${kindName(kind)}.`,
            element.start,
          );
        }
      }
      return elementKind === 'string' ? 'array' : 'number-array';
    }
    case 'index': {
      const target = inferAst(ast.target, env);
      requireKind(inferAst(ast.index, env), 'number', ast.start, 'Array index must be a number');
      if (target === 'array') return 'string';
      if (target === 'number-array') return 'number';
      return typeError(`Index access requires an array, got ${kindName(target)}.`, ast.start);
    }
    case 'conditional': {
      requireKind(inferAst(ast.test, env), 'boolean', ast.start, 'Conditional test must be a boolean');
      const consequent = inferAst(ast.consequent, env);
      const alternate = inferAst(ast.alternate, env);
      // A direct empty literal can adopt a string-array sibling's element
      // kind, while [] on its own retains the numeric-array default.
      if (
        (consequent === 'array' && ast.alternate.kind === 'array' && ast.alternate.elements.length === 0)
        || (alternate === 'array' && ast.consequent.kind === 'array' && ast.consequent.elements.length === 0)
      ) return 'array';
      const unified = unifyKinds(consequent, alternate);
      if (unified === null) {
        return typeError(
          `Conditional branches must have matching types or one null, got ${kindName(consequent)} and ${kindName(alternate)}.`,
          ast.start,
        );
      }
      return unified;
    }
    case 'call': {
      const args = ast.args.map((arg) => inferAst(arg, env));
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
        case 'log':
          requireKind(args[0], 'number', ast.start, `Function ${ast.name} requires a number`);
          return 'number';
        case 'min':
        case 'max':
        case 'pow':
        case 'clamp':
          for (const arg of args) requireKind(arg, 'number', ast.start, `Function ${ast.name} requires a number`);
          return 'number';
        case 'len':
          if (args[0] !== 'string' && args[0] !== 'array' && args[0] !== 'number-array') {
            typeError(`Function len requires a string or array, got ${kindName(args[0])}.`, ast.start);
          }
          return 'number';
        case 'contains':
          if (args[0] === 'number-array') {
            requireKind(args[1], 'number', ast.start, 'Function contains requires a numeric member');
            return 'boolean';
          }
          if (args[0] === 'string' || args[0] === 'array') {
            requireKind(args[1], 'string', ast.start, 'Function contains requires a string member');
            return 'boolean';
          }
          typeError(`Function contains requires a string or array, got ${kindName(args[0])}.`, ast.start);
          break;
        case 'sum':
        case 'average':
        case 'minOf':
        case 'maxOf':
          requireKind(args[0], 'number-array', ast.start, `Function ${ast.name} requires a numeric array`);
          return 'number';
        case 'formatNumber':
        case 'formatPercent':
        case 'formatScientific': {
          if (args[0] !== 'number' && args[0] !== 'null') {
            typeError(`Function ${ast.name} requires a number or null, got ${kindName(args[0])}.`, ast.start);
          }
          if (args[1] !== undefined) {
            requireKind(args[1], 'number', ast.start, `Function ${ast.name} requires numeric fraction digits`);
          }
          if (args[2] !== undefined) {
            requireKind(args[2], 'string', ast.start, `Function ${ast.name} requires a string locale`);
          }
          if (ast.name === 'formatNumber' && args[3] !== undefined) {
            requireKind(args[3], 'boolean', ast.start, 'Function formatNumber requires a boolean grouping flag');
          }
          return 'string';
        }
        case 'formatCurrency': {
          if (args[0] !== 'number' && args[0] !== 'null') {
            typeError(`Function formatCurrency requires a number or null, got ${kindName(args[0])}.`, ast.start);
          }
          if (args[1] !== undefined) {
            requireKind(args[1], 'string', ast.start, 'Function formatCurrency requires a string currency code');
          }
          if (args[2] !== undefined) {
            requireKind(args[2], 'number', ast.start, 'Function formatCurrency requires numeric fraction digits');
          }
          if (args[3] !== undefined) {
            requireKind(args[3], 'string', ast.start, 'Function formatCurrency requires a string locale');
          }
          return 'string';
        }
        case 'trim':
        case 'lower':
        case 'upper':
          requireKind(args[0], 'string', ast.start, `Function ${ast.name} requires a string`);
          return 'string';
        case 'startsWith':
        case 'endsWith':
          requireKind(args[0], 'string', ast.start, `Function ${ast.name} requires a string`);
          requireKind(args[1], 'string', ast.start, `Function ${ast.name} requires a string search value`);
          return 'boolean';
        case 'replace':
          requireKind(args[0], 'string', ast.start, 'Function replace requires a string');
          requireKind(args[1], 'string', ast.start, 'Function replace requires a string search value');
          requireKind(args[2], 'string', ast.start, 'Function replace requires a string replacement');
          return 'string';
        case 'slice':
          requireKind(args[0], 'string', ast.start, 'Function slice requires a string');
          requireKind(args[1], 'number', ast.start, 'Function slice requires a numeric start index');
          if (args[2] !== undefined) {
            requireKind(args[2], 'number', ast.start, 'Function slice requires a numeric end index');
          }
          return 'string';
        case 'dateCompare':
          requireKind(args[0], 'string', ast.start, 'Function dateCompare requires a date string');
          requireKind(args[1], 'string', ast.start, 'Function dateCompare requires a date string');
          return 'number';
        case 'dateDiff':
          requireKind(args[0], 'string', ast.start, 'Function dateDiff requires a date string');
          requireKind(args[1], 'string', ast.start, 'Function dateDiff requires a date string');
          if (args[2] !== undefined) {
            requireKind(args[2], 'string', ast.start, 'Function dateDiff requires a string unit');
          }
          return 'number';
      }
      break;
    }
  }
  throw new LocalExpressionError('expression-type', 'Unsupported expression.', 0);
}
