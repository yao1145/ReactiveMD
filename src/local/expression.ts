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
] as const;
type BuiltinName = (typeof BUILTIN_FUNCTIONS)[number];
const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_FUNCTIONS);

const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
]);

const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);
const VALID_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'null', 'array']);

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
const MAX_ARRAY_LENGTH = MAX_LOCAL_ARRAY_LENGTH;
const MAX_TEMPLATE_LENGTH = MAX_LOCAL_STRING_LENGTH;
const CACHE_LIMIT = 500;

/**
 * Allocation-free budget check for a value stored in the runtime or read from
 * an expression environment. Returns a short reason, or null when the value
 * fits. String lengths are UTF-16 code units, matching the existing
 * concatenation budget; `len()` keeps counting code points.
 */
export function localValueBudgetError(value: LocalValue): string | null {
  if (typeof value === 'string') {
    return value.length > MAX_LOCAL_STRING_LENGTH
      ? `字符串超过 ${MAX_LOCAL_STRING_LENGTH} 字符上限。`
      : null;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_LOCAL_ARRAY_LENGTH) {
      return `数组超过 ${MAX_LOCAL_ARRAY_LENGTH} 项上限。`;
    }
    let characters = 0;
    for (const item of value) {
      if (typeof item !== 'string') continue;
      if (item.length > MAX_LOCAL_STRING_LENGTH) {
        return `数组成员超过 ${MAX_LOCAL_STRING_LENGTH} 字符上限。`;
      }
      characters += item.length;
      if (characters > MAX_LOCAL_VALUE_CHARACTERS) {
        return `数组内容超过 ${MAX_LOCAL_VALUE_CHARACTERS} 字符上限。`;
      }
    }
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
      if (!match) throw new LocalExpressionError('expression-syntax', '无效的数字。', i);
      const raw = match[0];
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new LocalExpressionError('expression-number', `数字必须是有限值：${raw}。`, i);
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
          throw new LocalExpressionError('expression-string', '字符串字面量不能跨行。', start);
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
              throw new LocalExpressionError('expression-string', `不支持的转义 \\${next}。`, j);
          }
          j += 2;
          continue;
        }
        text += current;
        j += 1;
      }
      if (!closed) {
        throw new LocalExpressionError('expression-string', '字符串缺少结束引号。', start);
      }
      if (text.length > MAX_STRING_LENGTH) {
        throw new LocalExpressionError('expression-budget', '字符串字面量超过长度上限。', start);
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
      throw new LocalExpressionError('expression-syntax', `不支持运算符 ${source.slice(i, i + 3)}。`, i);
    }
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ kind: 'punct', value: two, start: i });
      i += 2;
      continue;
    }
    if ('+-*/%()!<>?:,'.includes(char)) {
      tokens.push({ kind: 'punct', value: char, start: i });
      i += 1;
      continue;
    }
    if (char === '=') {
      throw new LocalExpressionError('expression-assignment', '表达式不支持赋值。', i);
    }
    if (char === '.') {
      throw new LocalExpressionError('expression-property', '表达式不支持属性访问。', i);
    }
    if (char === '&' || char === '|') {
      throw new LocalExpressionError('expression-syntax', `逻辑运算请使用 ${char}${char}。`, i);
    }
    throw new LocalExpressionError('expression-syntax', `无法识别的字符 "${char}"。`, i);
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
  | { kind: 'call'; name: BuiltinName; args: Ast[]; start: number };

const ARITY: Readonly<Record<BuiltinName, readonly [number, number]>> = {
  abs: [1, 1], sqrt: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1],
  min: [1, Number.MAX_SAFE_INTEGER], max: [1, Number.MAX_SAFE_INTEGER],
  pow: [2, 2], sin: [1, 1], cos: [1, 1], tan: [1, 1],
  asin: [1, 1], acos: [1, 1], atan: [1, 1], exp: [1, 1], log: [1, 1],
  len: [1, 1], contains: [2, 2], clamp: [3, 3],
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
      throw new LocalExpressionError('expression-empty', '表达式为空。', 0);
    }
    const ast = this.parseConditional(0);
    const token = this.peek();
    if (token.kind !== 'eof') {
      throw new LocalExpressionError('expression-syntax', `意外的内容 "${token.value}"。`, token.start);
    }
    if (astDepth(ast) > MAX_AST_DEPTH) {
      throw new LocalExpressionError('expression-budget', '表达式嵌套过深。', ast.start);
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
      throw new LocalExpressionError('expression-syntax', `缺少 "${value}"。`, token.start);
    }
    return this.next();
  }

  private node(ast: Ast, depth: number, start: number): Ast {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_AST_NODES) {
      throw new LocalExpressionError('expression-budget', '表达式过于复杂。', start);
    }
    if (depth > MAX_PARSE_DEPTH) {
      throw new LocalExpressionError('expression-budget', '表达式嵌套过深。', start);
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
          throw new LocalExpressionError('expression-unknown-function', `未知函数 "${name}"。`, token.start);
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
          const expected = minimum === maximum ? `${minimum}` : minimum === 1 ? '至少 1' : `${minimum}–${maximum}`;
          throw new LocalExpressionError('expression-arity', `函数 ${name} 需要 ${expected} 个参数。`, token.start);
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
        throw new LocalExpressionError('expression-forbidden-name', `名称 "${name}" 不可用。`, token.start);
      }
      if (BUILTIN_SET.has(name)) {
        throw new LocalExpressionError('expression-syntax', `函数 ${name} 必须使用括号调用。`, token.start);
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
    throw new LocalExpressionError('expression-syntax', '需要一个表达式。', token.start);
  }
}

/* ------------------------------------------------------------------ */
/* Static types                                                        */
/* ------------------------------------------------------------------ */

function kindName(kind: LocalValueKind): string {
  switch (kind) {
    case 'string': return '字符串';
    case 'number': return '数字';
    case 'boolean': return '布尔值';
    case 'null': return 'null';
    case 'array': return '数组';
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
    typeError(`${message}，实际为${kindName(actual)}。`, offset);
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
        throw new LocalExpressionError('expression-unknown-name', `未声明的变量 "${ast.name}"。`, ast.start);
      }
      const kind = env[ast.name];
      if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
        throw new LocalExpressionError('expression-value', `变量 "${ast.name}" 的类型无效。`, ast.start);
      }
      return kind;
    }
    case 'unary': {
      const operand = inferAst(ast.operand, env);
      if (ast.operator === '!') {
        requireKind(operand, 'boolean', ast.start, '逻辑非需要布尔值');
        return 'boolean';
      }
      requireKind(operand, 'number', ast.start, `一元 ${ast.operator} 需要数字`);
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
            `运算符 "+" 需要两个数字或两个字符串，实际为${kindName(left)}和${kindName(right)}。`,
            ast.start,
          );
        case '-':
        case '*':
        case '/':
        case '%':
          requireKind(left, 'number', ast.start, `运算符 "${ast.operator}" 需要数字`);
          requireKind(right, 'number', ast.start, `运算符 "${ast.operator}" 需要数字`);
          return 'number';
        case '<':
        case '<=':
        case '>':
        case '>=':
          if (!((left === 'number' && right === 'number') || (left === 'string' && right === 'string'))) {
            return typeError(
              `比较运算符 "${ast.operator}" 需要两个数字或两个字符串，实际为${kindName(left)}和${kindName(right)}。`,
              ast.start,
            );
          }
          return 'boolean';
        case '==':
        case '!=':
          if (left !== right && left !== 'null' && right !== 'null') {
            return typeError(`相等比较两侧类型必须一致，实际为${kindName(left)}和${kindName(right)}。`, ast.start);
          }
          return 'boolean';
        case '&&':
        case '||':
          requireKind(left, 'boolean', ast.start, '逻辑运算需要布尔值');
          requireKind(right, 'boolean', ast.start, '逻辑运算需要布尔值');
          return 'boolean';
      }
      break;
    }
    case 'conditional': {
      requireKind(inferAst(ast.test, env), 'boolean', ast.start, '条件表达式的条件必须是布尔值');
      const consequent = inferAst(ast.consequent, env);
      const alternate = inferAst(ast.alternate, env);
      const unified = unifyKinds(consequent, alternate);
      if (unified === null) {
        return typeError(
          `条件表达式的两个分支类型必须一致或有一个为 null，实际为${kindName(consequent)}和${kindName(alternate)}。`,
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
          requireKind(args[0], 'number', ast.start, `函数 ${ast.name} 需要数字`);
          return 'number';
        case 'min':
        case 'max':
        case 'pow':
        case 'clamp':
          for (const arg of args) requireKind(arg, 'number', ast.start, `函数 ${ast.name} 需要数字`);
          return 'number';
        case 'len':
          if (args[0] !== 'string' && args[0] !== 'array') {
            typeError(`函数 len 需要字符串或数组，实际为${kindName(args[0])}。`, ast.start);
          }
          return 'number';
        case 'contains':
          if (args[0] !== 'string' && args[0] !== 'array') {
            typeError(`函数 contains 需要字符串或数组，实际为${kindName(args[0])}。`, ast.start);
          }
          requireKind(args[1], 'string', ast.start, '函数 contains 的成员需要字符串');
          return 'boolean';
      }
      break;
    }
  }
  throw new LocalExpressionError('expression-type', '不支持的表达式。', 0);
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
    throw new LocalExpressionError('expression-value', '表达式环境必须是对象。', 0);
  }
}

function checkValue(value: unknown, name: string, offset: number): LocalValue {
  if (value === null) return null;
  if (typeof value === 'string') {
    const budget = localValueBudgetError(value);
    if (budget) {
      throw new LocalExpressionError('expression-budget', `变量 "${name}" 的${budget}`, offset);
    }
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new LocalExpressionError('expression-value', `变量 "${name}" 必须是有限数字。`, offset);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new LocalExpressionError('expression-budget', `变量 "${name}" 的数组超过长度上限。`, offset);
    }
    for (const item of value) {
      if (typeof item !== 'string') {
        throw new LocalExpressionError('expression-value', `变量 "${name}" 的数组元素必须是字符串。`, offset);
      }
    }
    const budget = localValueBudgetError(value as string[]);
    if (budget) {
      throw new LocalExpressionError('expression-budget', `变量 "${name}" 的${budget}`, offset);
    }
    return value as string[];
  }
  throw new LocalExpressionError('expression-value', `变量 "${name}" 的值类型无效。`, offset);
}

function readVariable(env: Record<string, LocalValue>, name: string, offset: number): LocalValue {
  checkEnv(env);
  if (!Object.prototype.hasOwnProperty.call(env, name)) {
    fail(`未声明的变量 "${name}"。`, offset, 'expression-unknown-name');
  }
  return checkValue(env[name], name, offset);
}

function requireNumber(value: LocalValue, offset: number, message = '需要数字'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${message}。`, offset, 'expression-type');
  }
  return value;
}

function requireBoolean(value: LocalValue, offset: number, message = '需要布尔值'): boolean {
  if (typeof value !== 'boolean') fail(`${message}。`, offset, 'expression-type');
  return value;
}

function requireString(value: LocalValue, offset: number, message = '需要字符串'): string {
  if (typeof value !== 'string') fail(`${message}。`, offset, 'expression-type');
  return value;
}

function finiteResult(value: number, offset: number): number {
  if (Number.isNaN(value)) fail('数学结果无定义。', offset, 'expression-domain');
  if (!Number.isFinite(value)) fail('数学结果不是有限数字。', offset, 'expression-number');
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
    fail('表达式求值超过步数上限。', ast.start, 'expression-budget');
  }
  if (depth > MAX_EVAL_DEPTH) {
    fail('表达式求值嵌套过深。', ast.start, 'expression-budget');
  }

  switch (ast.kind) {
    case 'literal':
      return ast.value;
    case 'reference':
      return readVariable(env, ast.name, ast.start);
    case 'unary': {
      const value = evalNode(ast.operand, env, budget, depth + 1);
      if (ast.operator === '!') {
        return !requireBoolean(value, ast.start, '逻辑非需要布尔值');
      }
      const number = requireNumber(value, ast.start, `一元 ${ast.operator} 需要数字`);
      return finiteResult(ast.operator === '-' ? -number : number, ast.start);
    }
    case 'binary': {
      if (ast.operator === '&&' || ast.operator === '||') {
        const left = requireBoolean(
          evalNode(ast.left, env, budget, depth + 1),
          ast.start,
          '逻辑运算需要布尔值',
        );
        if (ast.operator === '&&' && !left) return false;
        if (ast.operator === '||' && left) return true;
        return requireBoolean(
          evalNode(ast.right, env, budget, depth + 1),
          ast.start,
          '逻辑运算需要布尔值',
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
              fail('字符串结果超过长度上限。', ast.start, 'expression-budget');
            }
            return value;
          }
          fail('运算符 "+" 需要两个数字或两个字符串。', ast.start, 'expression-type');
        case '-':
        case '*':
        case '/':
        case '%': {
          const a = requireNumber(left, ast.start, `运算符 "${ast.operator}" 需要数字`);
          const b = requireNumber(right, ast.start, `运算符 "${ast.operator}" 需要数字`);
          if ((ast.operator === '/' || ast.operator === '%') && b === 0) {
            fail('除数不能为零。', ast.start, 'expression-divide-by-zero');
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
            fail('相等比较两侧类型必须一致。', ast.start, 'expression-type');
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
            fail(`比较运算符 "${ast.operator}" 需要两个数字或两个字符串。`, ast.start, 'expression-type');
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
        '条件表达式的条件必须是布尔值',
      );
      return evalNode(test ? ast.consequent : ast.alternate, env, budget, depth + 1);
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
          const value = requireNumber(args[0], ast.start, `函数 ${ast.name} 需要数字`);
          if (ast.name === 'sqrt' && value < 0) fail('sqrt 的参数不能为负数。', ast.start, 'expression-domain');
          if (ast.name === 'log' && value <= 0) fail('log 的参数必须大于零。', ast.start, 'expression-domain');
          if ((ast.name === 'asin' || ast.name === 'acos') && (value < -1 || value > 1)) {
            fail(`${ast.name} 的参数必须在 -1 到 1 之间。`, ast.start, 'expression-domain');
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
          let result = requireNumber(args[0], ast.start, `函数 ${ast.name} 需要数字`);
          for (let i = 1; i < args.length; i += 1) {
            const value = requireNumber(args[i], ast.start, `函数 ${ast.name} 需要数字`);
            result = ast.name === 'min' ? Math.min(result, value) : Math.max(result, value);
          }
          return finiteResult(result, ast.start);
        }
        case 'pow': {
          const base = requireNumber(args[0], ast.start, '函数 pow 需要数字');
          const exponent = requireNumber(args[1], ast.start, '函数 pow 需要数字');
          return finiteResult(Math.pow(base, exponent), ast.start);
        }
        case 'clamp': {
          const value = requireNumber(args[0], ast.start, '函数 clamp 需要数字');
          const lower = requireNumber(args[1], ast.start, '函数 clamp 需要数字');
          const upper = requireNumber(args[2], ast.start, '函数 clamp 需要数字');
          if (lower > upper) fail('clamp 的下界不能大于上界。', ast.start, 'expression-domain');
          return finiteResult(Math.min(upper, Math.max(lower, value)), ast.start);
        }
        case 'len': {
          const value = args[0];
          if (typeof value === 'string') return Array.from(value).length;
          if (Array.isArray(value)) return value.length;
          fail('函数 len 需要字符串或数组。', ast.start, 'expression-type');
        }
        case 'contains': {
          const haystack = args[0];
          const needle = requireString(args[1], ast.start, '函数 contains 的成员需要字符串');
          if (typeof haystack === 'string') return haystack.includes(needle);
          if (Array.isArray(haystack)) return haystack.includes(needle);
          fail('函数 contains 需要字符串或数组。', ast.start, 'expression-type');
        }
      }
      break;
    }
  }
  throw new LocalExpressionError('expression-eval', '不支持的表达式。', 0);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const compilationCache = new Map<string, LocalExpression>();

export function compileExpression(source: string): LocalExpression {
  if (typeof source !== 'string') {
    throw new LocalExpressionError('expression-syntax', '表达式必须是字符串。', 0);
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new LocalExpressionError('expression-budget', `表达式超过 ${MAX_EXPRESSION_LENGTH} 字符上限。`, 0);
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
    throw new LocalExpressionError('expression-budget', '插值模板超过长度上限。', 0);
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
        throw new LocalExpressionError('expression-interpolation', '插值中不能嵌套另一个插值。', i);
      }
      if (char === '}' && template[i + 1] === '}') {
        closed = true;
        break;
      }
      i += 1;
    }
    if (!closed) {
      throw new LocalExpressionError('expression-interpolation', '插值缺少 }}。', open);
    }
    const source = template.slice(open + 2, i);
    if (source.trim() === '') {
      throw new LocalExpressionError('expression-empty', '插值表达式为空。', open + 2);
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
      throw new LocalExpressionError('expression-value', '无法显示非有限数字。', offset);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    throw new LocalExpressionError('expression-type', '数组不能直接插入文本，请先用 len 等函数转换。', offset);
  }
  throw new LocalExpressionError('expression-type', '无法把该值显示为文本。', offset);
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
      throw new LocalExpressionError('expression-budget', '插值结果超过长度上限。', 0);
    }
    chunks.push(chunk);
  }
  return chunks.join('');
}

/** Render a template to scalar text. Arrays are rejected rather than serialized. */
export function interpolate(template: string, env: Record<string, LocalValue>): string {
  if (typeof template !== 'string') {
    throw new LocalExpressionError('expression-interpolation', '插值模板必须是字符串。', 0);
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', `插值模板超过 ${MAX_TEMPLATE_LENGTH} 字符上限。`, 0);
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
    throw new LocalExpressionError('expression-interpolation', '插值模板必须是字符串。', 0);
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', `插值模板超过 ${MAX_TEMPLATE_LENGTH} 字符上限。`, 0);
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
