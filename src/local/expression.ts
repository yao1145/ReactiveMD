import {
  averageNumberArray,
  maxNumberArray,
  minNumberArray,
  sumNumberArray,
} from './collection-functions';
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
import {
  LocalFunctionError,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatScientific,
} from './formatting';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_STRING_LENGTH,
  MAX_LOCAL_VALUE_CHARACTERS,
} from './limits';
import type { LocalValue, LocalValueKind } from './types';

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

export interface LocalExpression {
  readonly source: string;
  readonly dependencies: string[];
  evaluate(env: Record<string, LocalValue>): LocalValue;
  inferType(env: Record<string, LocalValueKind>): LocalValueKind;
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
type BuiltinName = (typeof BUILTIN_FUNCTIONS)[number];
const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_FUNCTIONS);

const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
]);

const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);
const VALID_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'null', 'array', 'number-array']);

/** Names that cannot be used as a document binding. */
export const RESERVED_NAMES = new Set<string>([
  ...BUILTIN_FUNCTIONS,
  'x', 'y', 'pi', 'e', 'true', 'false', 'null',
  ...FORBIDDEN_NAMES,
]);

const MAX_EXPRESSION_LENGTH = 4000;
const MAX_AST_NODES = 2000;
const MAX_PARSE_DEPTH = 100;
const MAX_AST_DEPTH = 200;
const MAX_EVAL_STEPS = 10000;
const MAX_EVAL_DEPTH = 250;
/** Shared budgets. `MAX_STRING_LENGTH` also caps concatenation results. */
const MAX_STRING_LENGTH = MAX_LOCAL_STRING_LENGTH;
const MAX_TEMPLATE_LENGTH = MAX_LOCAL_STRING_LENGTH;
const CACHE_LIMIT = 500;

interface ArrayValueProblem {
  code: 'expression-budget' | 'expression-value';
  message: string;
}

/**
 * Validate the shared array shape: `array` stays a string array, while
 * `number-array` holds finite numbers only. Mixed, nested, boolean and null
 * members are rejected. String arrays keep the per-member and total character
 * budgets; numeric arrays only need finite members.
 */
function arrayValueProblem(value: readonly unknown[]): ArrayValueProblem | null {
  if (value.length > MAX_LOCAL_ARRAY_LENGTH) {
    return {
      code: 'expression-budget',
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
          message: 'Array elements must all be strings or all be numbers.',
        };
      }
      kind = 'string';
      if (item.length > MAX_LOCAL_STRING_LENGTH) {
        return {
          code: 'expression-budget',
          message: `Array member exceeds the ${MAX_LOCAL_STRING_LENGTH}-character limit.`,
        };
      }
      characters += item.length;
      if (characters > MAX_LOCAL_VALUE_CHARACTERS) {
        return {
          code: 'expression-budget',
          message: `Array contents exceed the ${MAX_LOCAL_VALUE_CHARACTERS}-character limit.`,
        };
      }
      continue;
    }
    if (typeof item === 'number') {
      if (kind === 'string') {
        return {
          code: 'expression-value',
          message: 'Array elements must all be strings or all be numbers.',
        };
      }
      kind = 'number';
      if (!Number.isFinite(item)) {
        return {
          code: 'expression-value',
          message: 'Array members must be finite numbers.',
        };
      }
      continue;
    }
    return {
      code: 'expression-value',
      message: 'Array members must be strings or finite numbers.',
    };
  }
  return null;
}

/**
 * Allocation-free budget check for a value stored in the runtime or read from
 * an expression environment. Returns a short reason, or null when the value
 * fits. String lengths are UTF-16 code units, matching the existing
 * concatenation budget; `len()` keeps counting code points.
 */
export function localValueBudgetError(value: LocalValue): string | null {
  if (typeof value === 'string') {
    return value.length > MAX_LOCAL_STRING_LENGTH
      ? `String exceeds the ${MAX_LOCAL_STRING_LENGTH}-character limit.`
      : null;
  }
  if (Array.isArray(value)) {
    return arrayValueProblem(value)?.message ?? null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Lexer                                                               */
/* ------------------------------------------------------------------ */

type TokenKind = 'number' | 'string' | 'ident' | 'punct' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  number?: number;
}

const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if ((char >= '0' && char <= '9') || (char === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = NUMBER_PATTERN.exec(source.slice(i));
      if (!match) throw new LocalExpressionError('expression-syntax', 'Invalid number.', i);
      const raw = match[0];
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new LocalExpressionError('expression-number', `Number must be finite: ${raw}.`, i);
      }
      tokens.push({ kind: 'number', value: raw, start: i, number: value });
      i += raw.length;
      continue;
    }

    if (char === '"' || char === "'") {
      const start = i;
      const quote = char;
      let text = '';
      let j = i + 1;
      let closed = false;
      while (j < source.length) {
        const current = source[j];
        if (current === quote) {
          closed = true;
          j += 1;
          break;
        }
        if (current === '\n' || current === '\r') {
          throw new LocalExpressionError('expression-string', 'String literals cannot span lines.', start);
        }
        if (current === '\\') {
          const next = source[j + 1];
          if (next === undefined) break;
          switch (next) {
            case '\\': text += '\\'; break;
            case "'": text += "'"; break;
            case '"': text += '"'; break;
            case 'n': text += '\n'; break;
            case 't': text += '\t'; break;
            default:
              throw new LocalExpressionError('expression-string', `Unsupported escape \\${next}.`, j);
          }
          j += 2;
          continue;
        }
        text += current;
        j += 1;
      }
      if (!closed) {
        throw new LocalExpressionError('expression-string', 'Unterminated string literal.', start);
      }
      if (text.length > MAX_STRING_LENGTH) {
        throw new LocalExpressionError('expression-budget', 'String literal exceeds the length limit.', start);
      }
      tokens.push({ kind: 'string', value: text, start });
      i = j;
      continue;
    }

    if (IDENT_START.test(char)) {
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source[j])) j += 1;
      tokens.push({ kind: 'ident', value: source.slice(i, j), start: i });
      i = j;
      continue;
    }

    const two = source.slice(i, i + 2);
    if (source.startsWith('!==', i) || source.startsWith('===', i)) {
      throw new LocalExpressionError('expression-syntax', `Unsupported operator ${source.slice(i, i + 3)}.`, i);
    }
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ kind: 'punct', value: two, start: i });
      i += 2;
      continue;
    }
    if ('+-*/%()!<>?:,[]'.includes(char)) {
      tokens.push({ kind: 'punct', value: char, start: i });
      i += 1;
      continue;
    }
    if (char === '=') {
      throw new LocalExpressionError('expression-assignment', 'Assignments are not supported.', i);
    }
    if (char === '.') {
      throw new LocalExpressionError('expression-property', 'Property access is not supported.', i);
    }
    if (char === '&' || char === '|') {
      throw new LocalExpressionError('expression-syntax', `Use ${char}${char} for logical operations.`, i);
    }
    throw new LocalExpressionError('expression-syntax', `Unrecognized character "${char}".`, i);
  }
  tokens.push({ kind: 'eof', value: '', start: source.length });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* AST                                                                 */
/* ------------------------------------------------------------------ */

type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

type Ast =
  | { kind: 'literal'; value: LocalValue; start: number }
  | { kind: 'reference'; name: string; start: number }
  | { kind: 'unary'; operator: '-' | '+' | '!'; operand: Ast; start: number }
  | { kind: 'binary'; operator: BinaryOperator; left: Ast; right: Ast; start: number }
  | { kind: 'conditional'; test: Ast; consequent: Ast; alternate: Ast; start: number }
  | { kind: 'array'; elements: Ast[]; start: number }
  | { kind: 'index'; target: Ast; index: Ast; start: number }
  | { kind: 'call'; name: BuiltinName; args: Ast[]; start: number };

const ARITY: Readonly<Record<BuiltinName, readonly [number, number]>> = {
  abs: [1, 1], sqrt: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1],
  min: [1, Number.MAX_SAFE_INTEGER], max: [1, Number.MAX_SAFE_INTEGER],
  pow: [2, 2], sin: [1, 1], cos: [1, 1], tan: [1, 1],
  asin: [1, 1], acos: [1, 1], atan: [1, 1], exp: [1, 1], log: [1, 1],
  len: [1, 1], contains: [2, 2], clamp: [3, 3],
  sum: [1, 1], average: [1, 1], minOf: [1, 1], maxOf: [1, 1],
  formatNumber: [1, 4], formatPercent: [1, 3], formatScientific: [1, 3],
  formatCurrency: [1, 4],
  trim: [1, 1], lower: [1, 1], upper: [1, 1], startsWith: [2, 2],
  endsWith: [2, 2], replace: [3, 3], slice: [2, 3],
  dateCompare: [2, 2], dateDiff: [2, 3],
};

function astDepth(ast: Ast): number {
  let maximum = 0;
  const stack: { node: Ast; depth: number }[] = [{ node: ast, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > maximum) maximum = depth;
    switch (node.kind) {
      case 'unary':
        stack.push({ node: node.operand, depth: depth + 1 });
        break;
      case 'binary':
        stack.push({ node: node.left, depth: depth + 1 });
        stack.push({ node: node.right, depth: depth + 1 });
        break;
      case 'conditional':
        stack.push({ node: node.test, depth: depth + 1 });
        stack.push({ node: node.consequent, depth: depth + 1 });
        stack.push({ node: node.alternate, depth: depth + 1 });
        break;
      case 'call':
        for (const arg of node.args) stack.push({ node: arg, depth: depth + 1 });
        break;
      case 'array':
        for (const element of node.elements) stack.push({ node: element, depth: depth + 1 });
        break;
      case 'index':
        stack.push({ node: node.target, depth: depth + 1 });
        stack.push({ node: node.index, depth: depth + 1 });
        break;
      case 'literal':
      case 'reference':
        break;
    }
  }
  return maximum;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  private readonly tokens: Token[];
  private position = 0;
  private nodeCount = 0;
  private readonly dependencyNames: string[] = [];
  private readonly dependencySet = new Set<string>();

  constructor(source: string) {
    this.tokens = lex(source);
  }

  get dependencies(): string[] {
    return this.dependencyNames;
  }

  parse(): Ast {
    if (this.peek().kind === 'eof') {
      throw new LocalExpressionError('expression-empty', 'Expression is empty.', 0);
    }
    const ast = this.parseConditional(0);
    const token = this.peek();
    if (token.kind !== 'eof') {
      throw new LocalExpressionError('expression-syntax', `Unexpected content "${token.value}".`, token.start);
    }
    if (astDepth(ast) > MAX_AST_DEPTH) {
      throw new LocalExpressionError('expression-budget', 'Expression is nested too deeply.', ast.start);
    }
    return ast;
  }

  private peek(): Token {
    return this.tokens[this.position];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    this.position += 1;
    return token;
  }

  private isPunct(value: string): boolean {
    const token = this.peek();
    return token.kind === 'punct' && token.value === value;
  }

  private expect(value: string): Token {
    const token = this.peek();
    if (token.kind !== 'punct' || token.value !== value) {
      throw new LocalExpressionError('expression-syntax', `Missing "${value}".`, token.start);
    }
    return this.next();
  }

  private node(ast: Ast, depth: number, start: number): Ast {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_AST_NODES) {
      throw new LocalExpressionError('expression-budget', 'Expression is too complex.', start);
    }
    if (depth > MAX_PARSE_DEPTH) {
      throw new LocalExpressionError('expression-budget', 'Expression is nested too deeply.', start);
    }
    return ast;
  }

  private parseConditional(depth: number): Ast {
    const test = this.parseOr(depth);
    if (!this.isPunct('?')) return test;
    const start = test.start;
    this.next();
    const consequent = this.parseConditional(depth + 1);
    this.expect(':');
    const alternate = this.parseConditional(depth + 1);
    return this.node({ kind: 'conditional', test, consequent, alternate, start }, depth, start);
  }

  private parseOr(depth: number): Ast {
    let left = this.parseAnd(depth);
    while (this.isPunct('||')) {
      const start = left.start;
      this.next();
      const right = this.parseAnd(depth);
      left = this.node({ kind: 'binary', operator: '||', left, right, start }, depth, start);
    }
    return left;
  }

  private parseAnd(depth: number): Ast {
    let left = this.parseEquality(depth);
    while (this.isPunct('&&')) {
      const start = left.start;
      this.next();
      const right = this.parseEquality(depth);
      left = this.node({ kind: 'binary', operator: '&&', left, right, start }, depth, start);
    }
    return left;
  }

  private parseEquality(depth: number): Ast {
    let left = this.parseRelational(depth);
    while (this.isPunct('==') || this.isPunct('!=')) {
      const start = left.start;
      const operator = this.next().value as BinaryOperator;
      const right = this.parseRelational(depth);
      left = this.node({ kind: 'binary', operator, left, right, start }, depth, start);
    }
    return left;
  }

  private parseRelational(depth: number): Ast {
    let left = this.parseAdditive(depth);
    while (this.isPunct('<') || this.isPunct('<=') || this.isPunct('>') || this.isPunct('>=')) {
      const start = left.start;
      const operator = this.next().value as BinaryOperator;
      const right = this.parseAdditive(depth);
      left = this.node({ kind: 'binary', operator, left, right, start }, depth, start);
    }
    return left;
  }

  private parseAdditive(depth: number): Ast {
    let left = this.parseMultiplicative(depth);
    while (this.isPunct('+') || this.isPunct('-')) {
      const start = left.start;
      const operator = this.next().value as BinaryOperator;
      const right = this.parseMultiplicative(depth);
      left = this.node({ kind: 'binary', operator, left, right, start }, depth, start);
    }
    return left;
  }

  private parseMultiplicative(depth: number): Ast {
    let left = this.parseUnary(depth);
    while (this.isPunct('*') || this.isPunct('/') || this.isPunct('%')) {
      const start = left.start;
      const operator = this.next().value as BinaryOperator;
      const right = this.parseUnary(depth);
      left = this.node({ kind: 'binary', operator, left, right, start }, depth, start);
    }
    return left;
  }

  private parseUnary(depth: number): Ast {
    const token = this.peek();
    if (token.kind === 'punct' && (token.value === '-' || token.value === '+' || token.value === '!')) {
      this.next();
      const operand = this.parseUnary(depth + 1);
      return this.node(
        { kind: 'unary', operator: token.value as '-' | '+' | '!', operand, start: token.start },
        depth,
        token.start,
      );
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): Ast {
    let base = this.parseAtom(depth);
    while (this.isPunct('[')) {
      const start = base.start;
      this.next();
      const index = this.parseConditional(depth + 1);
      this.expect(']');
      base = this.node({ kind: 'index', target: base, index, start }, depth, start);
    }
    return base;
  }

  private parseAtom(depth: number): Ast {
    const token = this.peek();
    if (token.kind === 'number') {
      this.next();
      return this.node({ kind: 'literal', value: token.number as number, start: token.start }, depth, token.start);
    }
    if (token.kind === 'string') {
      this.next();
      return this.node({ kind: 'literal', value: token.value, start: token.start }, depth, token.start);
    }
    if (token.kind === 'ident') {
      this.next();
      const name = token.value;
      if (this.isPunct('(')) {
        if (!BUILTIN_SET.has(name)) {
          throw new LocalExpressionError('expression-unknown-function', `Unknown function "${name}".`, token.start);
        }
        this.next();
        const args: Ast[] = [];
        if (!this.isPunct(')')) {
          args.push(this.parseConditional(depth + 1));
          while (this.isPunct(',')) {
            this.next();
            args.push(this.parseConditional(depth + 1));
          }
        }
        this.expect(')');
        const [minimum, maximum] = ARITY[name as BuiltinName];
        if (args.length < minimum || args.length > maximum) {
          const expected = minimum === maximum
            ? `${minimum} ${minimum === 1 ? 'argument' : 'arguments'}`
            : minimum === 1
              ? 'at least one argument'
              : `${minimum}–${maximum} arguments`;
          throw new LocalExpressionError('expression-arity', `Function ${name} expects ${expected}.`, token.start);
        }
        return this.node({ kind: 'call', name: name as BuiltinName, args, start: token.start }, depth, token.start);
      }
      if (name === 'true' || name === 'false') {
        return this.node({ kind: 'literal', value: name === 'true', start: token.start }, depth, token.start);
      }
      if (name === 'null') {
        return this.node({ kind: 'literal', value: null, start: token.start }, depth, token.start);
      }
      const constant = CONSTANTS.get(name);
      if (constant !== undefined) {
        return this.node({ kind: 'literal', value: constant, start: token.start }, depth, token.start);
      }
      if (FORBIDDEN_NAMES.has(name)) {
        throw new LocalExpressionError('expression-forbidden-name', `Name "${name}" is not allowed.`, token.start);
      }
      if (BUILTIN_SET.has(name)) {
        throw new LocalExpressionError('expression-syntax', `Function ${name} must be called with parentheses.`, token.start);
      }
      if (!this.dependencySet.has(name)) {
        this.dependencySet.add(name);
        this.dependencyNames.push(name);
      }
      return this.node({ kind: 'reference', name, start: token.start }, depth, token.start);
    }
    if (token.kind === 'punct' && token.value === '(') {
      this.next();
      const inner = this.parseConditional(depth + 1);
      this.expect(')');
      return inner;
    }
    if (token.kind === 'punct' && token.value === '[') {
      this.next();
      const elements: Ast[] = [];
      if (!this.isPunct(']')) {
        elements.push(this.parseConditional(depth + 1));
        while (this.isPunct(',')) {
          this.next();
          elements.push(this.parseConditional(depth + 1));
        }
      }
      this.expect(']');
      return this.node({ kind: 'array', elements, start: token.start }, depth, token.start);
    }
    throw new LocalExpressionError('expression-syntax', 'Expected an expression.', token.start);
  }
}

/* ------------------------------------------------------------------ */
/* Static types                                                        */
/* ------------------------------------------------------------------ */

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

function literalKind(value: LocalValue): LocalValueKind {
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

function inferAst(ast: Ast, env: Record<string, LocalValueKind>): LocalValueKind {
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

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

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

function evalAst(ast: Ast, env: Record<string, LocalValue>): LocalValue {
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
          if (typeof value === 'string') return Array.from(value).length;
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

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const compilationCache = new Map<string, LocalExpression>();

export function compileExpression(source: string): LocalExpression {
  if (typeof source !== 'string') {
    throw new LocalExpressionError('expression-syntax', 'Expression must be a string.', 0);
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new LocalExpressionError('expression-budget', `Expression exceeds the ${MAX_EXPRESSION_LENGTH}-character limit.`, 0);
  }
  const cached = compilationCache.get(source);
  if (cached) return cached;

  const parser = new Parser(source);
  const ast = parser.parse();
  const dependencies = [...parser.dependencies];
  const expression: LocalExpression = Object.freeze({
    source,
    dependencies,
    evaluate(env: Record<string, LocalValue>): LocalValue {
      return evalAst(ast, env);
    },
    inferType(env: Record<string, LocalValueKind>): LocalValueKind {
      return inferAst(ast, env);
    },
  });

  if (compilationCache.size >= CACHE_LIMIT) {
    const oldest = compilationCache.keys().next().value;
    if (oldest !== undefined) compilationCache.delete(oldest);
  }
  compilationCache.set(source, expression);
  return expression;
}

/* ------------------------------------------------------------------ */
/* Interpolation                                                       */
/* ------------------------------------------------------------------ */

type TemplatePart =
  | { kind: 'text'; value: string }
  | { kind: 'expression'; source: string; start: number };

function splitTemplate(template: string): TemplatePart[] {
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', 'Interpolation template exceeds the length limit.', 0);
  }
  const parts: TemplatePart[] = [];
  let cursor = 0;
  for (;;) {
    const open = template.indexOf('{{', cursor);
    if (open < 0) {
      if (cursor < template.length) {
        parts.push({ kind: 'text', value: template.slice(cursor) });
      }
      break;
    }
    if (open > cursor) {
      parts.push({ kind: 'text', value: template.slice(cursor, open) });
    }
    let i = open + 2;
    let quote = '';
    let closed = false;
    while (i < template.length) {
      const char = template[i];
      if (quote !== '') {
        if (char === '\\') {
          i += 2;
          continue;
        }
        if (char === quote) quote = '';
        i += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        i += 1;
        continue;
      }
      if (char === '{' && template[i + 1] === '{') {
        throw new LocalExpressionError('expression-interpolation', 'Interpolations cannot be nested.', i);
      }
      if (char === '}' && template[i + 1] === '}') {
        closed = true;
        break;
      }
      i += 1;
    }
    if (!closed) {
      throw new LocalExpressionError('expression-interpolation', 'Interpolation is missing }}.', open);
    }
    const source = template.slice(open + 2, i);
    if (source.trim() === '') {
      throw new LocalExpressionError('expression-empty', 'Interpolation expression is empty.', open + 2);
    }
    parts.push({ kind: 'expression', source, start: open + 2 });
    cursor = i + 2;
  }
  return parts;
}

function compilePart(part: Extract<TemplatePart, { kind: 'expression' }>): LocalExpression {
  try {
    return compileExpression(part.source);
  } catch (error) {
    if (error instanceof LocalExpressionError) {
      throw new LocalExpressionError(error.code, error.message, part.start + error.offset);
    }
    throw error;
  }
}

function evaluatePart(
  expression: LocalExpression,
  env: Record<string, LocalValue>,
  offset: number,
): LocalValue {
  try {
    return expression.evaluate(env);
  } catch (error) {
    if (error instanceof LocalExpressionError) {
      throw new LocalExpressionError(error.code, error.message, offset + error.offset);
    }
    throw error;
  }
}

function renderScalar(value: LocalValue, offset: number): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new LocalExpressionError('expression-value', 'Cannot display a non-finite number.', offset);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    throw new LocalExpressionError('expression-type', 'Cannot insert an array as text; convert it with a function such as len first.', offset);
  }
  throw new LocalExpressionError('expression-type', 'Cannot display this value as text.', offset);
}

function renderParts(parts: TemplatePart[], env: Record<string, LocalValue>): string {
  const chunks: string[] = [];
  let length = 0;
  for (const part of parts) {
    let chunk: string;
    if (part.kind === 'text') {
      chunk = part.value;
    } else {
      const expression = compilePart(part);
      const value = evaluatePart(expression, env, part.start);
      chunk = renderScalar(value, part.start);
    }
    length += chunk.length;
    if (length > MAX_STRING_LENGTH) {
      throw new LocalExpressionError('expression-budget', 'Interpolation result exceeds the length limit.', 0);
    }
    chunks.push(chunk);
  }
  return chunks.join('');
}

/** Render a template to scalar text. Arrays are rejected rather than serialized. */
export function interpolate(template: string, env: Record<string, LocalValue>): string {
  if (typeof template !== 'string') {
    throw new LocalExpressionError('expression-interpolation', 'Interpolation template must be a string.', 0);
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', `Interpolation template exceeds the ${MAX_TEMPLATE_LENGTH}-character limit.`, 0);
  }
  if (!template.includes('{{')) return template;
  return renderParts(splitTemplate(template), env);
}

/**
 * Evaluate a template that is exactly one interpolation, preserving its type.
 * Mixed templates and plain text fall back to text rendering.
 */
export function expressionValue(template: string, env: Record<string, LocalValue>): LocalValue {
  if (typeof template !== 'string') {
    throw new LocalExpressionError('expression-interpolation', 'Interpolation template must be a string.', 0);
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', `Interpolation template exceeds the ${MAX_TEMPLATE_LENGTH}-character limit.`, 0);
  }
  if (!template.includes('{{')) return template;
  const parts = splitTemplate(template);
  const expressions = parts.filter((part) => part.kind === 'expression');
  if (expressions.length === 0) return template;

  const onlyWhitespaceAround = parts.every(
    (part) => part.kind === 'expression' || part.value.trim() === '',
  );
  if (expressions.length === 1 && onlyWhitespaceAround) {
    const part = expressions[0] as Extract<TemplatePart, { kind: 'expression' }>;
    const expression = compilePart(part);
    return evaluatePart(expression, env, part.start);
  }
  return renderParts(parts, env);
}
