import {
  BUILTIN_SET,
  CONSTANTS,
  FORBIDDEN_NAMES,
  LocalExpressionError,
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_PARSE_DEPTH,
  MAX_STRING_LENGTH,
  type BuiltinName,
} from './expression-values';
import type { LocalValue } from '../types';

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

type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

export type Ast =
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

export class Parser {
  private readonly tokens: Token[];
  private position = 0;
  private nodeCount = 0;
  private readonly dependencyNames: string[] = [];
  private readonly dependencySet = new Set<string>();
  private readonly dependencyStarts = new Map<string, number>();

  constructor(source: string) {
    this.tokens = lex(source);
  }

  get dependencies(): string[] {
    return this.dependencyNames;
  }

  /** Source offset of the first reference token for each dependency. */
  get dependencyOffsets(): ReadonlyMap<string, number> {
    return this.dependencyStarts;
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
        this.dependencyStarts.set(name, token.start);
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
