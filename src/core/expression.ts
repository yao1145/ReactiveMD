import type { Json, StateValue } from './types';

/**
 * Reactive MD v0.1 expression language.
 *
 * The parser produces a small, explicit AST. Evaluation never touches eval,
 * Function or the global object; only the declared state, computed values,
 * data object and a fixed list of pure functions are reachable.
 */

export type ExprType =
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'any' }
  | { kind: 'array'; element: ExprType }
  | { kind: 'object'; fields: Record<string, ExprType> };

export interface TypeEnv {
  values: Record<string, ExprType>;
  data: ExprType;
  resources?: ExprType;
  /** Scope-local names (each item/index, action event). */
  locals?: Record<string, ExprType>;
}

export class ExpressionError extends Error {
  code: string;
  offset: number;

  constructor(code: string, message: string, offset = 0) {
    super(message);
    this.name = 'ExpressionError';
    this.code = code;
    this.offset = offset;
  }
}

export type Expr =
  | { kind: 'literal'; value: Json; start: number }
  | { kind: 'ref'; path: string[]; start: number }
  | { kind: 'unary'; op: '-' | '!'; expr: Expr; start: number }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; start: number }
  | { kind: 'conditional'; test: Expr; consequent: Expr; alternate: Expr; start: number }
  | { kind: 'call'; name: string; args: Expr[]; start: number };

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

export const BUILTIN_FUNCTIONS = [
  'min', 'max', 'round', 'len', 'contains',
  'abs', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'log', 'exp', 'floor', 'ceil', 'clamp',
  'range', 'sum', 'avg', 'at', 'slice', 'concat', 'pluck', 'where', 'sort', 'random',
] as const;
export const RESERVED_NAMES = new Set<string>(['data', 'resources', 'event', ...BUILTIN_FUNCTIONS]);
export const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const MAX_EXPRESSION_LENGTH = 4000;
const MAX_AST_NODES = 2000;
const MAX_PARSE_DEPTH = 100;
const MAX_EVAL_STEPS = 10000;
const MAX_EVAL_DEPTH = 100;
const MAX_STRING_LENGTH = 100000;
const MAX_ARRAY_LENGTH = 10000;

/* ------------------------------------------------------------------ */
/* Lexer                                                               */
/* ------------------------------------------------------------------ */

type TokenType = 'number' | 'string' | 'ident' | 'punct' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  start: number;
  numberValue?: number;
  stringValue?: string;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function lex(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      if (!match) {
        throw new ExpressionError('expression-syntax', `Invalid number at offset ${i}.`, i);
      }
      const raw = match[0];
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new ExpressionError('expression-number', `Number is not finite: ${raw}.`, i);
      }
      tokens.push({ type: 'number', value: raw, numberValue: value, start: i });
      i += raw.length;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let start = i;
      let j = i + 1;
      let out = '';
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === quote) {
          closed = true;
          j += 1;
          break;
        }
        if (c === '\\') {
          const next = text[j + 1];
          if (next === undefined) break;
          switch (next) {
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'v': out += '\v'; break;
            case '0': out += '\0'; break;
            case '\\': out += '\\'; break;
            case '"': out += '"'; break;
            case "'": out += "'"; break;
            case '/': out += '/'; break;
            case 'u': {
              const hex = text.slice(j + 2, j + 6);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                throw new ExpressionError('expression-string', 'Invalid unicode escape.', j);
              }
              out += String.fromCharCode(parseInt(hex, 16));
              j += 4;
              break;
            }
            default:
              throw new ExpressionError('expression-string', `Invalid escape \\${next}.`, j);
          }
          j += 2;
          continue;
        }
        if (c === '\n' || c === '\r') {
          throw new ExpressionError('expression-string', 'Unterminated string literal.', start);
        }
        out += c;
        j += 1;
      }
      if (!closed) {
        throw new ExpressionError('expression-string', 'Unterminated string literal.', start);
      }
      if (out.length > MAX_STRING_LENGTH) {
        throw new ExpressionError('expression-budget', 'String literal is too large.', start);
      }
      tokens.push({ type: 'string', value: out, stringValue: out, start });
      i = j;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENT_PART.test(text[j])) j += 1;
      tokens.push({ type: 'ident', value: text.slice(i, j), start: i });
      i = j;
      continue;
    }

    const two = text.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ type: 'punct', value: two, start: i });
      i += 2;
      continue;
    }
    if (two === '!==') {
      throw new ExpressionError('expression-syntax', `Unsupported operator ${two}.`, i);
    }
    if ('+-*/%()!<>?:,.'.includes(ch)) {
      if (ch === '=' && text[i + 1] === '=') {
        tokens.push({ type: 'punct', value: '==', start: i });
        i += 2;
        continue;
      }
      tokens.push({ type: 'punct', value: ch, start: i });
      i += 1;
      continue;
    }
    if (ch === '=') {
      throw new ExpressionError('expression-assignment', 'Assignment is not allowed in expressions.', i);
    }
    throw new ExpressionError('expression-syntax', `Unexpected character "${ch}".`, i);
  }

  tokens.push({ type: 'eof', value: '', start: text.length });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  private tokens: Token[];
  private pos = 0;
  private nodeCount = 0;

  constructor(text: string) {
    this.tokens = lex(text);
  }

  parse(): Expr {
    if (this.peek().type === 'eof') {
      throw new ExpressionError('expression-empty', 'Expression is empty.', 0);
    }
    const node = this.parseConditional(0);
    const token = this.peek();
    if (token.type !== 'eof') {
      throw new ExpressionError('expression-syntax', `Unexpected token "${token.value}".`, token.start);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private expect(value: string): Token {
    const token = this.peek();
    if (token.type !== 'punct' || token.value !== value) {
      throw new ExpressionError('expression-syntax', `Expected "${value}".`, token.start);
    }
    return this.next();
  }

  private node(node: Expr, depth: number): Expr {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_AST_NODES) {
      throw new ExpressionError('expression-budget', 'Expression is too complex.', node.start);
    }
    if (depth > MAX_PARSE_DEPTH) {
      throw new ExpressionError('expression-budget', 'Expression nesting is too deep.', node.start);
    }
    return node;
  }

  private parseConditional(depth: number): Expr {
    const test = this.parseOr(depth + 1);
    if (this.isPunct('?')) {
      const start = test.start;
      this.next();
      const consequent = this.parseConditional(depth + 1);
      this.expect(':');
      const alternate = this.parseConditional(depth + 1);
      return this.node({ kind: 'conditional', test, consequent, alternate, start }, depth);
    }
    return test;
  }

  private parseOr(depth: number): Expr {
    let left = this.parseAnd(depth + 1);
    while (this.isPunct('||')) {
      const start = left.start;
      this.next();
      const right = this.parseAnd(depth + 1);
      left = this.node({ kind: 'binary', op: '||', left, right, start }, depth);
    }
    return left;
  }

  private parseAnd(depth: number): Expr {
    let left = this.parseEquality(depth + 1);
    while (this.isPunct('&&')) {
      const start = left.start;
      this.next();
      const right = this.parseEquality(depth + 1);
      left = this.node({ kind: 'binary', op: '&&', left, right, start }, depth);
    }
    return left;
  }

  private parseEquality(depth: number): Expr {
    let left = this.parseRelational(depth + 1);
    while (this.isPunct('==') || this.isPunct('!=')) {
      const start = left.start;
      const op = this.next().value as BinaryOp;
      const right = this.parseRelational(depth + 1);
      left = this.node({ kind: 'binary', op, left, right, start }, depth);
    }
    return left;
  }

  private parseRelational(depth: number): Expr {
    let left = this.parseAdditive(depth + 1);
    while (
      this.isPunct('<') || this.isPunct('<=') ||
      this.isPunct('>') || this.isPunct('>=')
    ) {
      const start = left.start;
      const op = this.next().value as BinaryOp;
      const right = this.parseAdditive(depth + 1);
      left = this.node({ kind: 'binary', op, left, right, start }, depth);
    }
    return left;
  }

  private parseAdditive(depth: number): Expr {
    let left = this.parseMultiplicative(depth + 1);
    while (this.isPunct('+') || this.isPunct('-')) {
      const start = left.start;
      const op = this.next().value as BinaryOp;
      const right = this.parseMultiplicative(depth + 1);
      left = this.node({ kind: 'binary', op, left, right, start }, depth);
    }
    return left;
  }

  private parseMultiplicative(depth: number): Expr {
    let left = this.parseUnary(depth + 1);
    while (this.isPunct('*') || this.isPunct('/') || this.isPunct('%')) {
      const start = left.start;
      const op = this.next().value as BinaryOp;
      const right = this.parseUnary(depth + 1);
      left = this.node({ kind: 'binary', op, left, right, start }, depth);
    }
    return left;
  }

  private parseUnary(depth: number): Expr {
    const token = this.peek();
    if (token.type === 'punct' && (token.value === '-' || token.value === '!')) {
      this.next();
      const expr = this.parseUnary(depth + 1);
      return this.node({ kind: 'unary', op: token.value as '-' | '!', expr, start: token.start }, depth);
    }
    return this.parsePostfix(depth);
  }

  private parsePostfix(depth: number): Expr {
    const primary = this.parsePrimary(depth);
    if (primary.kind !== 'ref') return primary;

    const path = [...primary.path];
    while (this.isPunct('.')) {
      this.next();
      const token = this.next();
      if (token.type !== 'ident') {
        throw new ExpressionError('expression-syntax', 'Expected a property name after ".".', token.start);
      }
      path.push(token.value);
    }
    if (path.length === primary.path.length) return primary;
    for (const segment of path) {
      if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
        throw new ExpressionError(
          'expression-forbidden-path',
          `Property path "${segment}" is not allowed.`,
          primary.start,
        );
      }
    }
    return this.node({ kind: 'ref', path, start: primary.start }, depth);
  }

  private parsePrimary(depth: number): Expr {
    const token = this.peek();
    if (token.type === 'number') {
      this.next();
      return this.node({ kind: 'literal', value: token.numberValue as number, start: token.start }, depth);
    }
    if (token.type === 'string') {
      this.next();
      return this.node({ kind: 'literal', value: token.stringValue as string, start: token.start }, depth);
    }
    if (token.type === 'ident') {
      this.next();
      if (token.value === 'true' || token.value === 'false') {
        return this.node({ kind: 'literal', value: token.value === 'true', start: token.start }, depth);
      }
      if (token.value === 'null') {
        return this.node({ kind: 'literal', value: null, start: token.start }, depth);
      }
      if (FORBIDDEN_PATH_SEGMENTS.has(token.value)) {
        throw new ExpressionError(
          'expression-forbidden-path',
          `Identifier "${token.value}" is not allowed.`,
          token.start,
        );
      }
      if (this.isPunct('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.isPunct(')')) {
          args.push(this.parseConditional(depth + 1));
          while (this.isPunct(',')) {
            this.next();
            args.push(this.parseConditional(depth + 1));
          }
        }
        this.expect(')');
        return this.node({ kind: 'call', name: token.value, args, start: token.start }, depth);
      }
      return this.node({ kind: 'ref', path: [token.value], start: token.start }, depth);
    }
    if (token.type === 'punct' && token.value === '(') {
      this.next();
      const expr = this.parseConditional(depth + 1);
      this.expect(')');
      return expr;
    }
    throw new ExpressionError('expression-syntax', 'Expected an expression.', token.start);
  }

  private isPunct(value: string): boolean {
    const token = this.peek();
    return token.type === 'punct' && token.value === value;
  }
}

const astCache = new Map<string, Expr>();

export function parseExpression(text: string): Expr {
  const cached = astCache.get(text);
  if (cached) return cached;
  if (text.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError('expression-budget', 'Expression is too long.', MAX_EXPRESSION_LENGTH);
  }
  const ast = new Parser(text).parse();
  astCache.set(text, ast);
  return ast;
}

/* ------------------------------------------------------------------ */
/* Static analysis                                                     */
/* ------------------------------------------------------------------ */

export interface Reference {
  root: string;
  path: string[];
  start: number;
}

export function collectReferences(ast: Expr, out: Reference[] = []): Reference[] {
  switch (ast.kind) {
    case 'ref':
      out.push({ root: ast.path[0], path: ast.path.slice(1), start: ast.start });
      break;
    case 'unary':
      collectReferences(ast.expr, out);
      break;
    case 'binary':
      collectReferences(ast.left, out);
      collectReferences(ast.right, out);
      break;
    case 'conditional':
      collectReferences(ast.test, out);
      collectReferences(ast.consequent, out);
      collectReferences(ast.alternate, out);
      break;
    case 'call':
      for (const arg of ast.args) collectReferences(arg, out);
      break;
    case 'literal':
      break;
  }
  return out;
}

export function collectDependencies(ast: Expr): string[] {
  const names = new Set<string>();
  for (const ref of collectReferences(ast)) {
    if (ref.root !== 'data' && ref.root !== 'resources') names.add(ref.root);
  }
  return [...names];
}

export function jsonToExprType(value: Json): ExprType {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value)) {
    let element: ExprType = { kind: 'any' };
    for (let i = 0; i < value.length; i += 1) {
      const current = jsonToExprType(value[i]);
      if (i === 0) element = current;
      else {
        const unified = unifyTypes(element, current);
        element = unified ?? { kind: 'any' };
      }
    }
    return { kind: 'array', element };
  }
  const fields: Record<string, ExprType> = {};
  for (const key of Object.keys(value)) {
    fields[key] = jsonToExprType(value[key]);
  }
  return { kind: 'object', fields };
}

export function typeName(type: ExprType): string {
  switch (type.kind) {
    case 'array': return `array<${typeName(type.element)}>`;
    case 'object': return 'object';
    default: return type.kind;
  }
}

export function unifyTypes(a: ExprType, b: ExprType): ExprType | null {
  if (a.kind === 'any') return b;
  if (b.kind === 'any') return a;
  if (typeName(a) === typeName(b) && a.kind === b.kind) {
    if (a.kind === 'array' && b.kind === 'array') {
      const element = unifyTypes(a.element, b.element);
      return element ? { kind: 'array', element } : null;
    }
    return a;
  }
  if (a.kind === 'null') return b;
  if (b.kind === 'null') return a;
  return null;
}

function resolveRootPath(rootType: ExprType, path: string[], start: number, rootLabel: string): ExprType {
  let current = rootType;
  let walked = '';
  for (const segment of path) {
    walked = walked ? `${walked}.${segment}` : segment;
    if (current.kind === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current.fields, segment)) {
        throw new ExpressionError(
          'expression-missing-field',
          `${rootLabel.charAt(0).toUpperCase()}${rootLabel.slice(1)} path "${rootLabel}.${walked}" does not exist.`,
          start,
        );
      }
      current = current.fields[segment];
      continue;
    }
    if (current.kind === 'array') {
      throw new ExpressionError(
        'expression-invalid-path',
        `Cannot read field "${segment}" from an array in "${rootLabel}.${walked}".`,
        start,
      );
    }
    if (current.kind === 'null') {
      throw new ExpressionError(
        'expression-null-path',
        `Cannot read "${segment}" from null in "${rootLabel}.${walked}".`,
        start,
      );
    }
    if (current.kind === 'any') return { kind: 'any' };
    throw new ExpressionError(
      'expression-invalid-path',
      `Cannot read "${segment}" from ${typeName(current)} in "${rootLabel}.${walked}".`,
      start,
    );
  }
  return current;
}

function requireType(actual: ExprType, expected: ExprType, offset: number, message: string): void {
  if (actual.kind === 'any') return;
  if (actual.kind !== expected.kind) {
    throw new ExpressionError(
      'expression-type',
      `${message} Expected ${typeName(expected)}, got ${typeName(actual)}.`,
      offset,
    );
  }
}

function requireNumber(actual: ExprType, offset: number, message: string): void {
  if (actual.kind !== 'number' && actual.kind !== 'any') {
    throw new ExpressionError(
      'expression-type',
      `${message} Expected number, got ${typeName(actual)}.`,
      offset,
    );
  }
}

export function inferType(ast: Expr, env: TypeEnv): ExprType {
  switch (ast.kind) {
    case 'literal':
      return jsonToExprType(ast.value);
    case 'ref': {
      const root = ast.path[0];
      if (root === 'data') {
        return resolveRootPath(env.data, ast.path.slice(1), ast.start, 'data');
      }
      if (root === 'resources') {
        return resolveRootPath(
          env.resources ?? { kind: 'object', fields: {} },
          ast.path.slice(1),
          ast.start,
          'resources',
        );
      }
      const localType = env.locals ? env.locals[root] : undefined;
      if (localType) return resolveRootPath(localType, ast.path.slice(1), ast.start, root);
      const type = env.values[root];
      if (!type) {
        throw new ExpressionError(
          'expression-unknown-name',
          `Unknown name "${root}".`,
          ast.start,
        );
      }
      return resolveRootPath(type, ast.path.slice(1), ast.start, root);
    }
    case 'unary': {
      const inner = inferType(ast.expr, env);
      if (ast.op === '-') {
        requireNumber(inner, ast.start, 'Unary minus requires a number.');
        return { kind: 'number' };
      }
      requireType(inner, { kind: 'boolean' }, ast.start, 'Logical not requires a boolean.');
      return { kind: 'boolean' };
    }
    case 'binary': {
      const left = inferType(ast.left, env);
      const right = inferType(ast.right, env);
      switch (ast.op) {
        case '+': {
          if (left.kind === 'string' && right.kind === 'string') return { kind: 'string' };
          if (left.kind === 'number' && right.kind === 'number') return { kind: 'number' };
          if (left.kind === 'any' || right.kind === 'any') {
            return left.kind === 'string' || right.kind === 'string'
              ? { kind: 'string' }
              : { kind: 'number' };
          }
          throw new ExpressionError(
            'expression-type',
            `Operator "+" requires two numbers or two strings, got ${typeName(left)} and ${typeName(right)}.`,
            ast.start,
          );
        }
        case '-':
        case '*':
        case '/':
        case '%':
          requireNumber(left, ast.start, `Operator "${ast.op}" requires numbers.`);
          requireNumber(right, ast.start, `Operator "${ast.op}" requires numbers.`);
          return { kind: 'number' };
        case '<':
        case '<=':
        case '>':
        case '>=': {
          if (left.kind === 'any' || right.kind === 'any') return { kind: 'boolean' };
          if (left.kind === right.kind && (left.kind === 'number' || left.kind === 'string')) {
            return { kind: 'boolean' };
          }
          throw new ExpressionError(
            'expression-type',
            `Comparison "${ast.op}" requires two numbers or two strings, got ${typeName(left)} and ${typeName(right)}.`,
            ast.start,
          );
        }
        case '==':
        case '!=':
          return { kind: 'boolean' };
        case '&&':
        case '||':
          requireType(left, { kind: 'boolean' }, ast.start, 'Logical operators require booleans.');
          requireType(right, { kind: 'boolean' }, ast.start, 'Logical operators require booleans.');
          return { kind: 'boolean' };
      }
      break;
    }
    case 'conditional': {
      const test = inferType(ast.test, env);
      requireType(test, { kind: 'boolean' }, ast.start, 'Conditional test must be a boolean.');
      const consequent = inferType(ast.consequent, env);
      const alternate = inferType(ast.alternate, env);
      const unified = unifyTypes(consequent, alternate);
      if (!unified) {
        throw new ExpressionError(
          'expression-type',
          `Conditional branches must have the same type or one null, got ${typeName(consequent)} and ${typeName(alternate)}.`,
          ast.start,
        );
      }
      return unified;
    }
    case 'call': {
      const name = ast.name;
      if (!(BUILTIN_FUNCTIONS as readonly string[]).includes(name)) {
        throw new ExpressionError(
          'expression-unknown-function',
          `Unknown function "${name}".`,
          ast.start,
        );
      }
      const args = ast.args.map((arg) => inferType(arg, env));
      switch (name) {
        case 'min':
        case 'max': {
          if (args.length < 1) {
            throw new ExpressionError('expression-arity', `${name} requires at least one argument.`, ast.start);
          }
          for (const arg of args) requireNumber(arg, ast.start, `${name} requires numbers.`);
          return { kind: 'number' };
        }
        case 'round':
        case 'abs':
        case 'sqrt':
        case 'sin':
        case 'cos':
        case 'tan':
        case 'log':
        case 'exp':
        case 'floor':
        case 'ceil': {
          if (args.length !== 1) {
            throw new ExpressionError('expression-arity', `${name} requires exactly one argument.`, ast.start);
          }
          requireNumber(args[0], ast.start, `${name} requires a number.`);
          return { kind: 'number' };
        }
        case 'pow': {
          if (args.length !== 2) {
            throw new ExpressionError('expression-arity', `${name} requires exactly two arguments.`, ast.start);
          }
          requireNumber(args[0], ast.start, `${name} requires numbers.`);
          requireNumber(args[1], ast.start, `${name} requires numbers.`);
          return { kind: 'number' };
        }
        case 'clamp': {
          if (args.length !== 3) {
            throw new ExpressionError('expression-arity', 'clamp requires exactly three arguments.', ast.start);
          }
          for (const arg of args) requireNumber(arg, ast.start, 'clamp requires numbers.');
          return { kind: 'number' };
        }
        case 'random': {
          if (args.length !== 2) {
            throw new ExpressionError('expression-arity', 'random requires seed and index.', ast.start);
          }
          requireNumber(args[0], ast.start, 'random requires numeric seeds.');
          requireNumber(args[1], ast.start, 'random requires a numeric index.');
          return { kind: 'number' };
        }
        case 'len': {
          if (args.length !== 1) {
            throw new ExpressionError('expression-arity', 'len requires exactly one argument.', ast.start);
          }
          if (args[0].kind !== 'string' && args[0].kind !== 'array' && args[0].kind !== 'any') {
            throw new ExpressionError(
              'expression-type',
              `len requires a string or array, got ${typeName(args[0])}.`,
              ast.start,
            );
          }
          return { kind: 'number' };
        }
        case 'contains': {
          if (args.length !== 2) {
            throw new ExpressionError('expression-arity', 'contains requires exactly two arguments.', ast.start);
          }
          const [haystack, needle] = args;
          if (haystack.kind === 'string') {
            requireType(needle, { kind: 'string' }, ast.start, 'String contains requires a string needle.');
            return { kind: 'boolean' };
          }
          if (haystack.kind === 'array') {
            if (
              needle.kind !== 'any' &&
              haystack.element.kind !== 'any' &&
              needle.kind !== haystack.element.kind
            ) {
              throw new ExpressionError(
                'expression-type',
                `contains needle ${typeName(needle)} does not match array element ${typeName(haystack.element)}.`,
                ast.start,
              );
            }
            return { kind: 'boolean' };
          }
          if (haystack.kind === 'any') return { kind: 'boolean' };
          throw new ExpressionError(
            'expression-type',
            `contains requires a string or array, got ${typeName(haystack)}.`,
            ast.start,
          );
        }
        case 'range': {
          if (args.length < 2 || args.length > 3) {
            throw new ExpressionError('expression-arity', 'range requires start, end and an optional step.', ast.start);
          }
          for (const arg of args) requireNumber(arg, ast.start, 'range requires numbers.');
          return { kind: 'array', element: { kind: 'number' } };
        }
        case 'sum':
        case 'avg': {
          if (args.length < 1 || args.length > 2) {
            throw new ExpressionError('expression-arity', `${name} requires an array and an optional field.`, ast.start);
          }
          if (args[0].kind !== 'array' && args[0].kind !== 'any') {
            throw new ExpressionError('expression-type', `${name} requires an array, got ${typeName(args[0])}.`, ast.start);
          }
          if (args[1] && args[1].kind !== 'string' && args[1].kind !== 'any') {
            throw new ExpressionError('expression-type', `${name} field must be a string.`, ast.start);
          }
          return { kind: 'number' };
        }
        case 'at': {
          if (args.length !== 2) {
            throw new ExpressionError('expression-arity', 'at requires an array and an index.', ast.start);
          }
          if (args[0].kind !== 'array' && args[0].kind !== 'any') {
            throw new ExpressionError('expression-type', `at requires an array, got ${typeName(args[0])}.`, ast.start);
          }
          requireNumber(args[1], ast.start, 'at requires a numeric index.');
          if (args[0].kind === 'array') {
            return args[0].element;
          }
          return { kind: 'any' };
        }
        case 'slice': {
          if (args.length < 2 || args.length > 3) {
            throw new ExpressionError('expression-arity', 'slice requires a value, a start and an optional end.', ast.start);
          }
          if (args[0].kind === 'string') return { kind: 'string' };
          if (args[0].kind === 'array') {
            requireNumber(args[1], ast.start, 'slice indices must be numbers.');
            if (args[2]) requireNumber(args[2], ast.start, 'slice indices must be numbers.');
            return args[0];
          }
          if (args[0].kind === 'any') return { kind: 'any' };
          throw new ExpressionError('expression-type', `slice requires a string or array, got ${typeName(args[0])}.`, ast.start);
        }
        case 'concat': {
          if (args.length !== 2) {
            throw new ExpressionError('expression-arity', 'concat requires exactly two arguments.', ast.start);
          }
          if (args[0].kind === 'string' && args[1].kind === 'string') return { kind: 'string' };
          if (args[0].kind === 'any' || args[1].kind === 'any') return { kind: 'array', element: { kind: 'any' } };
          if (args[0].kind !== 'array' || args[1].kind !== 'array') {
            throw new ExpressionError('expression-type', 'concat requires two arrays or two strings.', ast.start);
          }
          return { kind: 'array', element: unifyTypes(args[0].element, args[1].element) ?? { kind: 'any' } };
        }
        case 'pluck': {
          if (args.length !== 2) {
            throw new ExpressionError('expression-arity', 'pluck requires an array and a field.', ast.start);
          }
          if (args[0].kind !== 'array' && args[0].kind !== 'any') {
            throw new ExpressionError('expression-type', `pluck requires an array, got ${typeName(args[0])}.`, ast.start);
          }
          if (args[1].kind !== 'string' && args[1].kind !== 'any') {
            throw new ExpressionError('expression-type', 'pluck field must be a string.', ast.start);
          }
          return { kind: 'array', element: { kind: 'any' } };
        }
        case 'where': {
          if (args.length < 2 || args.length > 3) {
            throw new ExpressionError('expression-arity', 'where requires an array, a field and an optional value.', ast.start);
          }
          if (args[0].kind !== 'array' && args[0].kind !== 'any') {
            throw new ExpressionError('expression-type', `where requires an array, got ${typeName(args[0])}.`, ast.start);
          }
          if (args[1].kind !== 'string' && args[1].kind !== 'any') {
            throw new ExpressionError('expression-type', 'where field must be a string.', ast.start);
          }
          return args[0].kind === 'array' ? args[0] : { kind: 'array', element: { kind: 'any' } };
        }
        case 'sort': {
          if (args.length < 1 || args.length > 3) {
            throw new ExpressionError('expression-arity', 'sort requires an array, an optional field and direction.', ast.start);
          }
          if (args[0].kind !== 'array' && args[0].kind !== 'any') {
            throw new ExpressionError('expression-type', `sort requires an array, got ${typeName(args[0])}.`, ast.start);
          }
          if (args[1] && args[1].kind !== 'string' && args[1].kind !== 'any') {
            throw new ExpressionError('expression-type', 'sort field must be a string.', ast.start);
          }
          if (args[2] && args[2].kind !== 'string' && args[2].kind !== 'any') {
            throw new ExpressionError('expression-type', 'sort direction must be a string.', ast.start);
          }
          return args[0].kind === 'array' ? args[0] : { kind: 'array', element: { kind: 'any' } };
        }
      }
      break;
    }
  }
  throw new ExpressionError('expression-type', 'Unsupported expression.', ast.start);
}

export type ExpectedType = 'string' | 'number' | 'boolean' | 'value' | 'json' | 'array' | 'object';

export function checkExpectedType(type: ExprType, expected: ExpectedType, offset: number): void {
  if (type.kind === 'any') return;
  switch (expected) {
    case 'string':
      if (type.kind !== 'string') {
        throw new ExpressionError('expression-type', `Expected string, got ${typeName(type)}.`, offset);
      }
      return;
    case 'number':
      if (type.kind !== 'number') {
        throw new ExpressionError('expression-type', `Expected number, got ${typeName(type)}.`, offset);
      }
      return;
    case 'boolean':
      if (type.kind !== 'boolean') {
        throw new ExpressionError('expression-type', `Expected boolean, got ${typeName(type)}.`, offset);
      }
      return;
    case 'value':
      if (!['string', 'number', 'boolean', 'null', 'any'].includes(type.kind)) {
        throw new ExpressionError(
          'expression-type',
          `A value component accepts a scalar or null, got ${typeName(type)}.`,
          offset,
        );
      }
      return;
    case 'json':
      return;
    case 'array':
      if (type.kind !== 'array') {
        throw new ExpressionError('expression-type', `Expected an array, got ${typeName(type)}.`, offset);
      }
      return;
    case 'object':
      if (type.kind !== 'object') {
        throw new ExpressionError('expression-type', `Expected an object, got ${typeName(type)}.`, offset);
      }
      return;
  }
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export interface EvalContext {
  state: Readonly<Record<string, StateValue>>;
  computed: Readonly<Record<string, Json>>;
  data: Json;
  /** Runtime resources keyed by hosting action name. */
  resources?: Readonly<Record<string, Json>>;
  /** each-scope locals and action event values. */
  locals?: Readonly<Record<string, Json>>;
}

interface Budget {
  steps: number;
  depth: number;
}

function fail(message: string, offset: number, code = 'expression-eval'): never {
  throw new ExpressionError(code, message, offset);
}

function own<T extends object>(object: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function readPath(ctx: EvalContext, path: string[], offset: number): Json {
  const root = path[0];
  let current: Json;
  if (root === 'data') {
    current = ctx.data;
  } else if (root === 'resources') {
    current = (ctx.resources ?? {}) as unknown as Json;
  } else if (ctx.locals && own(ctx.locals, root)) {
    current = ctx.locals[root];
  } else if (own(ctx.state, root)) {
    current = ctx.state[root] as Json;
  } else if (own(ctx.computed, root)) {
    current = ctx.computed[root];
  } else {
    fail(`Unknown name "${root}".`, offset, 'expression-unknown-name');
  }

  for (let i = 1; i < path.length; i += 1) {
    const segment = path[i];
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      fail(`Property path "${segment}" is not allowed.`, offset, 'expression-forbidden-path');
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      fail(`Cannot read property "${segment}" from a non-object value.`, offset, 'expression-missing-field');
    }
    if (!own(current, segment)) {
      fail(`Missing field "${path.slice(0, i + 1).join('.')}".`, offset, 'expression-missing-field');
    }
    current = (current as Record<string, Json>)[segment];
  }
  return current;
}

function isJsonScalar(value: Json): value is null | boolean | number | string {
  return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!own(b, key) || !deepEqual((a as Record<string, Json>)[key], (b as Record<string, Json>)[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function compareStrings(a: string, b: string): number {
  const ai = Array.from(a);
  const bi = Array.from(b);
  const length = Math.min(ai.length, bi.length);
  for (let i = 0; i < length; i += 1) {
    const ac = ai[i].codePointAt(0) as number;
    const bc = bi[i].codePointAt(0) as number;
    if (ac !== bc) return ac < bc ? -1 : 1;
  }
  if (ai.length === bi.length) return 0;
  return ai.length < bi.length ? -1 : 1;
}

function numberResult(value: number, offset: number): number {
  if (!Number.isFinite(value)) fail('Numeric result is not finite.', offset, 'expression-number');
  return value;
}

function arrayResult<T extends Json>(value: T[], offset: number): T[] {
  if (value.length > MAX_ARRAY_LENGTH) {
    fail(`Array result exceeds the limit of ${MAX_ARRAY_LENGTH} items.`, offset, 'expression-budget');
  }
  return value;
}

function requireArray(value: Json, offset: number, name: string): Json[] {
  if (!Array.isArray(value)) fail(`${name} requires an array.`, offset, 'expression-type');
  if (value.length > MAX_ARRAY_LENGTH) {
    fail(`${name} array exceeds the limit of ${MAX_ARRAY_LENGTH} items.`, offset, 'expression-budget');
  }
  return value;
}

function requireIndex(value: Json, offset: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail('Expected an integer index.', offset, 'expression-type');
  }
  return value;
}

function fieldValue(element: Json, field: string, offset: number): Json {
  if (element === null || typeof element !== 'object' || Array.isArray(element)) {
    fail(`Cannot read field "${field}" from a non-object item.`, offset, 'expression-type');
  }
  if (!Object.prototype.hasOwnProperty.call(element, field)) {
    fail(`Item has no field "${field}".`, offset, 'expression-missing-field');
  }
  return (element as Record<string, Json>)[field];
}

function compareJson(a: Json, b: Json, offset: number): number {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') return compareStrings(a, b);
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  fail('Sort values must be numbers, strings or booleans of the same type.', offset, 'expression-type');
}

/** Deterministic, replayable pseudo-random number in [0, 1). */
function seededRandom(seed: number, index: number): number {
  let hash = Math.imul(Math.trunc(seed) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  hash = (hash ^ Math.imul(Math.trunc(index) + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function evalNode(ast: Expr, ctx: EvalContext, budget: Budget): Json {
  budget.steps += 1;
  if (budget.steps > MAX_EVAL_STEPS) {
    fail('Expression evaluation exceeded its step budget.', ast.start, 'expression-budget');
  }

  switch (ast.kind) {
    case 'literal':
      return ast.value;
    case 'ref':
      return readPath(ctx, ast.path, ast.start);
    case 'unary': {
      const value = evalNode(ast.expr, ctx, budget);
      if (ast.op === '!') {
        if (typeof value !== 'boolean') fail('Logical not requires a boolean.', ast.start, 'expression-type');
        return !value;
      }
      if (typeof value !== 'number') fail('Unary minus requires a number.', ast.start, 'expression-type');
      return numberResult(-value, ast.start);
    }
    case 'binary': {
      if (ast.op === '&&' || ast.op === '||') {
        const left = evalNode(ast.left, ctx, budget);
        if (typeof left !== 'boolean') fail('Logical operators require booleans.', ast.start, 'expression-type');
        if (ast.op === '&&' && !left) return false;
        if (ast.op === '||' && left) return true;
        const right = evalNode(ast.right, ctx, budget);
        if (typeof right !== 'boolean') fail('Logical operators require booleans.', ast.start, 'expression-type');
        return right;
      }
      const left = evalNode(ast.left, ctx, budget);
      const right = evalNode(ast.right, ctx, budget);
      switch (ast.op) {
        case '+':
          if (typeof left === 'number' && typeof right === 'number') {
            return numberResult(left + right, ast.start);
          }
          if (typeof left === 'string' && typeof right === 'string') {
            const text = left + right;
            if (text.length > MAX_STRING_LENGTH) fail('String result is too large.', ast.start, 'expression-budget');
            return text;
          }
          fail('Operator "+" requires two numbers or two strings.', ast.start, 'expression-type');
          break;
        case '-':
        case '*':
        case '/':
        case '%': {
          if (typeof left !== 'number' || typeof right !== 'number') {
            fail(`Operator "${ast.op}" requires numbers.`, ast.start, 'expression-type');
          }
          if ((ast.op === '/' || ast.op === '%') && right === 0) {
            fail('Division by zero.', ast.start, 'expression-divide-by-zero');
          }
          const result =
            ast.op === '-' ? left - right :
            ast.op === '*' ? left * right :
            ast.op === '/' ? left / right :
            left % right;
          return numberResult(result, ast.start);
        }
        case '==':
          return deepEqual(left, right);
        case '!=':
          return !deepEqual(left, right);
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
            fail(`Comparison "${ast.op}" requires two numbers or two strings.`, ast.start, 'expression-type');
          }
          if (ast.op === '<') return comparison < 0;
          if (ast.op === '<=') return comparison <= 0;
          if (ast.op === '>') return comparison > 0;
          return comparison >= 0;
        }
      }
      break;
    }
    case 'conditional': {
      const test = evalNode(ast.test, ctx, budget);
      if (typeof test !== 'boolean') fail('Conditional test must be a boolean.', ast.start, 'expression-type');
      return evalNode(test ? ast.consequent : ast.alternate, ctx, budget);
    }
    case 'call': {
      const args = ast.args.map((arg) => evalNode(arg, ctx, budget));
      switch (ast.name) {
        case 'min':
        case 'max': {
          if (args.length === 0) fail(`${ast.name} requires at least one argument.`, ast.start, 'expression-arity');
          for (const arg of args) {
            if (typeof arg !== 'number') fail(`${ast.name} requires numbers.`, ast.start, 'expression-type');
          }
          return ast.name === 'min'
            ? Math.min(...(args as number[]))
            : Math.max(...(args as number[]));
        }
        case 'round': {
          if (args.length !== 1 || typeof args[0] !== 'number') {
            fail('round requires one number.', ast.start, 'expression-type');
          }
          return numberResult(Math.round(args[0] as number), ast.start);
        }
        case 'abs':
        case 'sqrt':
        case 'sin':
        case 'cos':
        case 'tan':
        case 'log':
        case 'exp':
        case 'floor':
        case 'ceil': {
          if (args.length !== 1 || typeof args[0] !== 'number') {
            fail(`${ast.name} requires one number.`, ast.start, 'expression-type');
          }
          const value = args[0] as number;
          let result: number;
          switch (ast.name) {
            case 'abs': result = Math.abs(value); break;
            case 'sqrt': result = Math.sqrt(value); break;
            case 'sin': result = Math.sin(value); break;
            case 'cos': result = Math.cos(value); break;
            case 'tan': result = Math.tan(value); break;
            case 'log': result = Math.log(value); break;
            case 'exp': result = Math.exp(value); break;
            case 'floor': result = Math.floor(value); break;
            default: result = Math.ceil(value); break;
          }
          return numberResult(result, ast.start);
        }
        case 'pow': {
          if (args.length !== 2 || typeof args[0] !== 'number' || typeof args[1] !== 'number') {
            fail('pow requires two numbers.', ast.start, 'expression-type');
          }
          return numberResult(Math.pow(args[0] as number, args[1] as number), ast.start);
        }
        case 'clamp': {
          if (
            args.length !== 3 ||
            typeof args[0] !== 'number' ||
            typeof args[1] !== 'number' ||
            typeof args[2] !== 'number'
          ) {
            fail('clamp requires three numbers.', ast.start, 'expression-type');
          }
          const [value, lower, upper] = args as number[];
          if (lower > upper) fail('clamp requires min <= max.', ast.start, 'expression-type');
          return numberResult(Math.min(upper, Math.max(lower, value)), ast.start);
        }
        case 'random': {
          if (args.length !== 2 || typeof args[0] !== 'number' || typeof args[1] !== 'number') {
            fail('random requires numeric seed and index.', ast.start, 'expression-type');
          }
          return seededRandom(args[0] as number, args[1] as number);
        }
        case 'len': {
          if (args.length !== 1) fail('len requires one argument.', ast.start, 'expression-arity');
          const value = args[0];
          if (typeof value === 'string') return Array.from(value).length;
          if (Array.isArray(value)) return value.length;
          fail('len requires a string or array.', ast.start, 'expression-type');
          break;
        }
        case 'contains': {
          if (args.length !== 2) fail('contains requires two arguments.', ast.start, 'expression-arity');
          const [haystack, needle] = args;
          if (typeof haystack === 'string') {
            if (typeof needle !== 'string') fail('contains requires a string needle.', ast.start, 'expression-type');
            return haystack.includes(needle as string);
          }
          if (Array.isArray(haystack)) {
            if (!isJsonScalar(needle)) {
              fail('contains requires a scalar needle for arrays.', ast.start, 'expression-type');
            }
            return haystack.some((item) => deepEqual(item, needle));
          }
          fail('contains requires a string or array.', ast.start, 'expression-type');
          break;
        }
        case 'range': {
          if (args.length < 2 || args.length > 3) fail('range requires start, end and an optional step.', ast.start, 'expression-arity');
          for (const arg of args) {
            if (typeof arg !== 'number' || !Number.isFinite(arg)) {
              fail('range requires numbers.', ast.start, 'expression-type');
            }
          }
          const start = args[0] as number;
          const end = args[1] as number;
          const step = (args.length === 3 ? args[2] : 1) as number;
          if (step === 0) fail('range step cannot be zero.', ast.start, 'expression-divide-by-zero');
          const count = Math.max(0, Math.ceil((end - start) / step));
          if (count > MAX_ARRAY_LENGTH) {
            fail(`range would produce more than ${MAX_ARRAY_LENGTH} items.`, ast.start, 'expression-budget');
          }
          const out: Json[] = [];
          for (let i = 0; i < count; i += 1) {
            out.push(numberResult(start + i * step, ast.start));
          }
          return out;
        }
        case 'sum':
        case 'avg': {
          if (args.length < 1 || args.length > 2) fail(`${ast.name} requires an array and an optional field.`, ast.start, 'expression-arity');
          const values = requireArray(args[0], ast.start, ast.name);
          const field = args[1];
          if (field !== undefined && typeof field !== 'string') {
            fail(`${ast.name} field must be a string.`, ast.start, 'expression-type');
          }
          let total = 0;
          for (const item of values) {
            const value = field === undefined ? item : fieldValue(item, field as string, ast.start);
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              fail(`${ast.name} requires numeric values.`, ast.start, 'expression-type');
            }
            total += value;
          }
          const result = ast.name === 'sum' ? total : values.length === 0 ? 0 : total / values.length;
          return numberResult(result, ast.start);
        }
        case 'at': {
          if (args.length !== 2) fail('at requires an array and an index.', ast.start, 'expression-arity');
          const values = requireArray(args[0], ast.start, 'at');
          const index = requireIndex(args[1], ast.start);
          if (index < 0 || index >= values.length) return null;
          return values[index];
        }
        case 'slice': {
          if (args.length < 2 || args.length > 3) fail('slice requires a value, a start and an optional end.', ast.start, 'expression-arity');
          const start = requireIndex(args[1], ast.start);
          const end = args[2] === undefined ? undefined : requireIndex(args[2], ast.start);
          if (typeof args[0] === 'string') {
            return Array.from(args[0]).slice(start, end).join('');
          }
          const values = requireArray(args[0], ast.start, 'slice');
          return arrayResult(values.slice(start, end), ast.start);
        }
        case 'concat': {
          if (args.length !== 2) fail('concat requires two arguments.', ast.start, 'expression-arity');
          if (typeof args[0] === 'string' && typeof args[1] === 'string') {
            const text = args[0] + args[1];
            if (text.length > MAX_STRING_LENGTH) fail('String result is too large.', ast.start, 'expression-budget');
            return text;
          }
          const left = requireArray(args[0], ast.start, 'concat');
          const right = requireArray(args[1], ast.start, 'concat');
          return arrayResult([...left, ...right], ast.start);
        }
        case 'pluck': {
          if (args.length !== 2) fail('pluck requires an array and a field.', ast.start, 'expression-arity');
          const values = requireArray(args[0], ast.start, 'pluck');
          if (typeof args[1] !== 'string') fail('pluck field must be a string.', ast.start, 'expression-type');
          return arrayResult(values.map((item) => fieldValue(item, args[1] as string, ast.start)), ast.start);
        }
        case 'where': {
          if (args.length < 2 || args.length > 3) fail('where requires an array, a field and an optional value.', ast.start, 'expression-arity');
          const values = requireArray(args[0], ast.start, 'where');
          if (typeof args[1] !== 'string') fail('where field must be a string.', ast.start, 'expression-type');
          const field = args[1] as string;
          const expected = args[2];
          const keep = values.filter((item) => {
            const value = fieldValue(item, field, ast.start);
            if (args.length === 3) return deepEqual(value, expected);
            return Boolean(value);
          });
          return arrayResult(keep, ast.start);
        }
        case 'sort': {
          if (args.length < 1 || args.length > 3) fail('sort requires an array, an optional field and direction.', ast.start, 'expression-arity');
          const values = requireArray(args[0], ast.start, 'sort');
          if (args[1] !== undefined && typeof args[1] !== 'string') {
            fail('sort field must be a string.', ast.start, 'expression-type');
          }
          if (args[2] !== undefined && args[2] !== 'asc' && args[2] !== 'desc') {
            fail('sort direction must be "asc" or "desc".', ast.start, 'expression-type');
          }
          const field = args[1] as string | undefined;
          const direction = (args[2] as string | undefined) ?? 'asc';
          const sorted = values.map((item, position) => ({ item, position }));
          sorted.sort((a, b) => {
            const left = field === undefined ? a.item : fieldValue(a.item, field, ast.start);
            const right = field === undefined ? b.item : fieldValue(b.item, field, ast.start);
            const comparison = compareJson(left, right, ast.start);
            return (direction === 'desc' ? -comparison : comparison) || a.position - b.position;
          });
          return arrayResult(sorted.map((entry) => entry.item), ast.start);
        }
        default:
          fail(`Unknown function "${ast.name}".`, ast.start, 'expression-unknown-function');
      }
      break;
    }
  }
  throw new ExpressionError('expression-eval', 'Unsupported expression.', ast.start);
}

function astDepth(ast: Expr): number {
  switch (ast.kind) {
    case 'literal':
    case 'ref':
      return 1;
    case 'unary':
      return 1 + astDepth(ast.expr);
    case 'binary':
      return 1 + Math.max(astDepth(ast.left), astDepth(ast.right));
    case 'conditional':
      return 1 + Math.max(astDepth(ast.test), astDepth(ast.consequent), astDepth(ast.alternate));
    case 'call':
      return 1 + ast.args.reduce((max, arg) => Math.max(max, astDepth(arg)), 0);
    default:
      return 1;
  }
}

export function evaluateAst(ast: Expr, ctx: EvalContext): Json {
  if (astDepth(ast) > MAX_EVAL_DEPTH) {
    fail('Expression nesting is too deep.', ast.start, 'expression-budget');
  }
  return evalNode(ast, ctx, { steps: 0, depth: 0 });
}

/** Evaluate an expression string (without the leading "="). */
export function evaluateExpression(expression: string, ctx: EvalContext): Json {
  return evaluateAst(parseExpression(expression), ctx);
}

export function isBuiltinFunction(name: string): boolean {
  return (BUILTIN_FUNCTIONS as readonly string[]).includes(name);
}
