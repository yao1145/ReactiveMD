import type { LocalValue } from './types';

/**
 * Computable LaTeX for local plots.
 *
 * The parser builds an explicit AST; evaluation never uses eval/Function and
 * only reads the independent variable x plus numeric bindings from the
 * document. Unsupported structures (integrals, matrices, macros, ...) are
 * rejected at compile time with an offset into the LaTeX source.
 */

export class LatexError extends Error {
  readonly code: string;
  readonly offset: number;

  constructor(code: string, message: string, offset = 0) {
    super(message);
    this.name = 'LatexError';
    this.code = code;
    this.offset = offset;
  }
}

export interface LatexExpression {
  readonly source: string;
  dependencies: string[];
  evaluate(x: number, env: Record<string, LocalValue>, budget?: LatexEvaluationBudget): number;
}

/** Shared step budget used by samplePlot so the whole curve has one bound. */
export interface LatexEvaluationBudget {
  steps: number;
  limit: number;
}

export interface PlotPoint {
  x: number;
  y: number | null;
}

export interface PlotSample {
  points: PlotPoint[];
  endpoint: number | null;
}

/* ------------------------------------------------------------------ */
/* AST                                                                 */
/* ------------------------------------------------------------------ */

type Relation = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
type CallName = 'sin' | 'cos' | 'tan' | 'arcsin' | 'arccos' | 'arctan'
  | 'exp' | 'ln' | 'log' | 'min' | 'max' | 'sqrt';

interface When {
  op: Relation;
  left: Ast;
  right: Ast;
}

interface CaseBranch {
  value: Ast;
  when: When | null;
}

type Ast =
  | { kind: 'number'; value: number; offset: number }
  | { kind: 'constant'; value: 'pi' | 'e'; offset: number }
  | { kind: 'variable'; name: string; offset: number }
  | { kind: 'unary'; op: '-' | '+'; operand: Ast; offset: number }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Ast; right: Ast; offset: number }
  | { kind: 'abs'; value: Ast; offset: number }
  | { kind: 'call'; name: CallName; args: Ast[]; base: Ast | null; power: Ast | null; offset: number }
  | { kind: 'cases'; branches: CaseBranch[]; offset: number };

/* ------------------------------------------------------------------ */
/* Lexer                                                               */
/* ------------------------------------------------------------------ */

type TokenKind = 'number' | 'letter' | 'command' | 'punct' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  offset: number;
}

const MAX_SOURCE = 50_000;
const MAX_TOKENS = 20_000;
const MAX_NODES = 5_000;
const MAX_DEPTH = 120;
const MAX_EVAL_STEPS = 20_000;
const MAX_EVAL_DEPTH = 1_000;
const MAX_SAMPLES = 2_000;
const MAX_REFINE_DEPTH = 5;
const MIN_PLOT_STEPS = 1_000_000;

const SKIPPED_COMMANDS = new Set([
  'quad', 'qquad', 'enspace', 'thinspace', 'medspace', 'thickspace', 'negthinspace',
  'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'limits', 'nolimits',
]);

// Only these Greek names map to bindings; other Greek letters are display-only
// and parameters use \mathrm{name} instead.
const GREEK: Record<string, string> = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', theta: 'theta',
  omega: 'omega', lambda: 'lambda', mu: 'mu', sigma: 'sigma',
};

const FUNCTION_COMMANDS = new Set([
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan',
  'exp', 'ln', 'log', 'min', 'max',
]);

const COMMAND_ALIASES: Record<string, string> = {
  '{': 'lbrace', '}': 'rbrace', '|': 'vert', '%': 'percent',
  '&': 'amp', '#': 'hash', '_': 'underscore', '$': 'dollar',
};

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const push = (kind: TokenKind, value: string, offset: number) => {
    if (tokens.length >= MAX_TOKENS) {
      throw new LatexError('latex-budget', '数学输入包含过多记号。', offset);
    }
    tokens.push({ kind, value, offset });
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }

    if (ch === '%') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '\\') {
      if (i + 1 >= source.length) {
        throw new LatexError('latex-syntax', '数学公式以孤立的反斜杠结尾。', i);
      }
      const next = source[i + 1];
      if (next === '\\') {
        push('command', 'newline', i);
        i += 2;
        continue;
      }
      if (/[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1;
        const name = source.slice(i + 1, j);
        if (!SKIPPED_COMMANDS.has(name)) push('command', name, i);
        i = j;
        continue;
      }
      if (next === ' ' || next === ',' || next === ';' || next === ':' || next === '!') {
        i += 2;
        continue;
      }
      const alias = COMMAND_ALIASES[next];
      if (alias) {
        push('command', alias, i);
        i += 2;
        continue;
      }
      push('command', next, i);
      i += 2;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(i))!;
      push('number', match[0], i);
      i += match[0].length;
      continue;
    }
    if (ch === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(i))!;
      push('number', match[0], i);
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      push('letter', ch, i);
      i += 1;
      continue;
    }
    push('punct', ch, i);
    i += 1;
  }

  push('eof', '', source.length);
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

function isGreekCommand(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(GREEK, name);
}

function startsFactor(token: Token): boolean {
  switch (token.kind) {
    case 'number':
    case 'letter':
      return true;
    case 'punct':
      return token.value === '(' || token.value === '{' || token.value === '[' || token.value === '|';
    case 'command': {
      const name = token.value;
      if (FUNCTION_COMMANDS.has(name)) return true;
      if (isGreekCommand(name)) return true;
      return name === 'frac' || name === 'dfrac' || name === 'tfrac'
        || name === 'sqrt' || name === 'left' || name === 'pi'
        || name === 'mathrm' || name === 'begin' || name === 'lvert'
        || name === 'vert' || name === 'lbrace';
    }
    default:
      return false;
  }
}

function isRelationToken(token: Token): Relation | null {
  if (token.kind === 'punct') {
    if (token.value === '=') return 'eq';
    if (token.value === '<') return 'lt';
    if (token.value === '>') return 'gt';
    return null;
  }
  if (token.kind === 'command') {
    if (token.value === 'ne' || token.value === 'neq') return 'ne';
    if (token.value === 'le' || token.value === 'leq') return 'le';
    if (token.value === 'ge' || token.value === 'geq') return 'ge';
  }
  return null;
}

class LatexParser {
  private tokens: Token[];
  private source: string;
  private pos = 0;
  private nodes = 0;

  constructor(source: string, tokens: Token[]) {
    this.source = source;
    this.tokens = tokens;
  }

  parseDocument(): Ast {
    if (this.peek().kind === 'eof') {
      throw new LatexError('latex-empty', '数学公式为空。', 0);
    }
    // Plot formulas are written as "y = expression"; y is an output marker.
    if (this.atLetter('y') && this.atPunctAt(1, '=')) {
      this.pos += 2;
    }
    if (this.peek().kind === 'eof') {
      throw new LatexError('latex-empty', 'y 之后缺少表达式。', this.peek().offset);
    }
    const expression = this.parseAdditive(0);
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      if (isRelationToken(rest) || (rest.kind === 'punct' && rest.value === '=')) {
        throw new LatexError('latex-relation', '绘图只支持显式 y = f(x)，不支持其他方程。', rest.offset);
      }
      throw new LatexError('latex-syntax', `无法解析的记号 "${this.raw(rest)}"。`, rest.offset);
    }
    return expression;
  }

  /* -------------------------------------------------------------- */
  /* Token helpers                                                  */
  /* -------------------------------------------------------------- */

  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)];
  }

  private take(): Token {
    return this.tokens[this.pos++];
  }

  private atPunct(value: string): boolean {
    const token = this.peek();
    return token.kind === 'punct' && token.value === value;
  }

  private atPunctAt(ahead: number, value: string): boolean {
    const token = this.peek(ahead);
    return token.kind === 'punct' && token.value === value;
  }

  private atCommand(value: string): boolean {
    const token = this.peek();
    return token.kind === 'command' && token.value === value;
  }

  private atLetter(value: string): boolean {
    const token = this.peek();
    return token.kind === 'letter' && token.value === value;
  }

  private expectPunct(value: string): Token {
    const token = this.peek();
    if (token.kind !== 'punct' || token.value !== value) {
      throw new LatexError('latex-syntax', `缺少 "${value}"。`, token.offset);
    }
    return this.take();
  }

  private raw(token: Token): string {
    if (token.kind === 'eof') return '结尾';
    if (token.kind === 'command') return `\\${token.value}`;
    return this.source.slice(token.offset, token.offset + Math.max(1, token.value.length));
  }

  private make<T extends Ast>(node: T, offset: number, depth: number): T {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) {
      throw new LatexError('latex-budget', '数学公式过于复杂。', offset);
    }
    if (depth > MAX_DEPTH) {
      throw new LatexError('latex-budget', '数学公式嵌套过深。', offset);
    }
    return node;
  }

  /* -------------------------------------------------------------- */
  /* Expression grammar                                             */
  /* -------------------------------------------------------------- */

  private parseAdditive(depth: number): Ast {
    let left = this.parseMultiplicative(depth + 1, false);
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'punct' || (token.value !== '+' && token.value !== '-')) break;
      const op = this.take().value as '+' | '-';
      const right = this.parseMultiplicative(depth + 1, false);
      left = this.make({ kind: 'binary', op, left, right, offset: token.offset }, token.offset, depth);
    }
    return left;
  }

  private parseMultiplicative(depth: number, suppressFunction: boolean): Ast {
    let left = this.parseUnary(depth + 1, suppressFunction);
    for (;;) {
      const token = this.peek();
      if (token.kind === 'punct' && token.value === '/') {
        this.take();
        const right = this.parseUnary(depth + 1, suppressFunction);
        left = this.make({ kind: 'binary', op: '/', left, right, offset: token.offset }, token.offset, depth);
        continue;
      }
      if (token.kind === 'punct' && token.value === '*') {
        this.take();
        const right = this.parseUnary(depth + 1, suppressFunction);
        left = this.make({ kind: 'binary', op: '*', left, right, offset: token.offset }, token.offset, depth);
        continue;
      }
      if (token.kind === 'command' && (token.value === 'cdot' || token.value === 'times')) {
        this.take();
        const right = this.parseUnary(depth + 1, suppressFunction);
        left = this.make({ kind: 'binary', op: '*', left, right, offset: token.offset }, token.offset, depth);
        continue;
      }
      // Whitespace-separated factors are implicit multiplication: 2x, (a)(b),
      // a\sin x. A function argument stops before the next function command.
      if (suppressFunction && token.kind === 'command' && FUNCTION_COMMANDS.has(token.value)) break;
      if (!startsFactor(token)) break;
      const right = this.parseUnary(depth + 1, suppressFunction);
      left = this.make({ kind: 'binary', op: '*', left, right, offset: token.offset }, token.offset, depth);
    }
    return left;
  }

  private parseUnary(depth: number, suppressFunction: boolean): Ast {
    const token = this.peek();
    if (token.kind === 'punct' && (token.value === '+' || token.value === '-')) {
      this.take();
      const operand = this.parseUnary(depth + 1, suppressFunction);
      if (token.value === '+') return operand;
      return this.make({ kind: 'unary', op: '-', operand, offset: token.offset }, token.offset, depth);
    }
    return this.parsePower(depth, suppressFunction);
  }

  private parsePower(depth: number, suppressFunction: boolean): Ast {
    const base = this.parseAtom(depth + 1, suppressFunction);
    const token = this.peek();
    if (token.kind === 'punct' && token.value === '^') {
      this.take();
      const exponent = this.parseScriptArgument(depth + 1);
      return this.make({ kind: 'binary', op: '^', left: base, right: exponent, offset: token.offset }, token.offset, depth);
    }
    return base;
  }

  private parseScriptArgument(depth: number): Ast {
    if (this.atPunct('{')) return this.parseBraceGroup(depth + 1);
    if (this.atPunct('+') || this.atPunct('-')) {
      const token = this.take();
      const operand = this.parseUnary(depth + 1, false);
      if (token.value === '+') return operand;
      return this.make({ kind: 'unary', op: '-', operand, offset: token.offset }, token.offset, depth);
    }
    return this.parseUnary(depth + 1, false);
  }

  private parseAtom(depth: number, suppressFunction: boolean): Ast {
    const token = this.peek();

    if (token.kind === 'number') {
      this.take();
      const value = Number(token.value);
      if (!Number.isFinite(value)) {
        throw new LatexError('latex-number', `数字 "${token.value}" 不是有限数。`, token.offset);
      }
      return this.make({ kind: 'number', value, offset: token.offset }, token.offset, depth);
    }

    if (token.kind === 'letter') {
      this.take();
      return this.variable(token.value, token.offset, depth);
    }

    if (token.kind === 'punct') {
      if (token.value === '(') return this.parseParenthesized(depth);
      if (token.value === '{') return this.parseBraceGroup(depth);
      if (token.value === '[') return this.parseBracketGroup(depth);
      if (token.value === '|') return this.parsePlainAbs(depth, token.offset);
      throw new LatexError('latex-syntax', `无法从 "${token.value}" 开始表达式。`, token.offset);
    }

    if (token.kind === 'command') {
      const name = token.value;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        this.take();
        const numerator = this.parseArgument(depth + 1);
        const denominator = this.parseArgument(depth + 1);
        return this.make(
          { kind: 'binary', op: '/', left: numerator, right: denominator, offset: token.offset },
          token.offset,
          depth,
        );
      }
      if (name === 'sqrt') {
        this.take();
        let index: Ast | null = null;
        if (this.atPunct('[')) {
          this.take();
          index = this.parseAdditive(depth + 1);
          this.expectPunct(']');
        }
        const value = this.parseArgument(depth + 1);
        return this.make(
          { kind: 'call', name: 'sqrt', args: [value], base: index, power: null, offset: token.offset },
          token.offset,
          depth,
        );
      }
      if (name === 'left') return this.parseLeft(depth);
      if (FUNCTION_COMMANDS.has(name)) return this.parseFunction(name as CallName, depth);
      if (name === 'pi') {
        this.take();
        return this.make({ kind: 'constant', value: 'pi', offset: token.offset }, token.offset, depth);
      }
      if (isGreekCommand(name)) {
        this.take();
        return this.variable(GREEK[name], token.offset, depth);
      }
      if (name === 'mathrm') {
        this.take();
        const group = this.readRawGroup();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(group.raw)) {
          throw new LatexError('latex-name', '\\mathrm 中必须是合法参数名。', group.offset);
        }
        return this.variable(group.raw, token.offset, depth);
      }
      if (name === 'begin') return this.parseCases(depth);
      if (name === 'lvert' || name === 'vert') return this.parseCommandAbs(depth, token.offset);
      if (name === 'right') {
        throw new LatexError('latex-syntax', '\\right 缺少对应的 \\left。', token.offset);
      }
      if (name === 'text') {
        throw new LatexError('latex-unsupported', '\\text 只能用作分段函数的 otherwise 条件。', token.offset);
      }
      throw new LatexError('latex-unsupported', `不支持计算的命令 \\${name}。`, token.offset);
    }

    throw new LatexError('latex-syntax', '表达式不完整。', token.offset);
  }

  private parseArgument(depth: number): Ast {
    if (this.atPunct('{')) return this.parseBraceGroup(depth + 1);
    if (this.peek().kind === 'eof') {
      throw new LatexError('latex-syntax', '命令缺少参数。', this.peek().offset);
    }
    return this.parseUnary(depth + 1, false);
  }

  private parseParenthesized(depth: number): Ast {
    const open = this.expectPunct('(');
    if (this.atPunct(')')) {
      throw new LatexError('latex-syntax', '括号内缺少表达式。', open.offset);
    }
    const value = this.parseAdditive(depth + 1);
    this.expectPunct(')');
    return value;
  }

  private parseBraceGroup(depth: number): Ast {
    const open = this.expectPunct('{');
    if (this.atPunct('}')) {
      throw new LatexError('latex-syntax', '花括号内缺少表达式。', open.offset);
    }
    const value = this.parseAdditive(depth + 1);
    this.expectPunct('}');
    return value;
  }

  private parseBracketGroup(depth: number): Ast {
    const open = this.expectPunct('[');
    if (this.atPunct(']')) {
      throw new LatexError('latex-syntax', '方括号内缺少表达式。', open.offset);
    }
    const value = this.parseAdditive(depth + 1);
    this.expectPunct(']');
    return value;
  }

  private parsePlainAbs(depth: number, offset: number): Ast {
    this.take();
    if (this.atPunct('|')) {
      throw new LatexError('latex-syntax', '绝对值缺少内容。', offset);
    }
    const value = this.parseAdditive(depth + 1);
    if (this.atPunct('|')) {
      this.take();
    } else if (this.atCommand('rvert')) {
      this.take();
    } else {
      throw new LatexError('latex-syntax', '绝对值竖线没有配对。', offset);
    }
    return this.make({ kind: 'abs', value, offset }, offset, depth);
  }

  private parseCommandAbs(depth: number, offset: number): Ast {
    this.take();
    if (this.atCommand('rvert') || this.atCommand('vert') || this.atPunct('|')) {
      throw new LatexError('latex-syntax', '绝对值缺少内容。', offset);
    }
    const value = this.parseAdditive(depth + 1);
    if (this.atCommand('rvert') || this.atCommand('vert') || this.atPunct('|')) {
      this.take();
    } else {
      throw new LatexError('latex-syntax', '绝对值竖线没有配对。', offset);
    }
    return this.make({ kind: 'abs', value, offset }, offset, depth);
  }

  private parseLeft(depth: number): Ast {
    const leftToken = this.take();
    const open = this.readDelimiter();
    const value = this.parseAdditive(depth + 1);
    if (!this.atCommand('right')) {
      throw new LatexError('latex-syntax', '\\left 缺少对应的 \\right。', leftToken.offset);
    }
    this.take();
    const close = this.readDelimiter();
    if (open === '|' && close !== '|') {
      throw new LatexError('latex-syntax', '绝对值竖线没有配对。', leftToken.offset);
    }
    if (open === '|') {
      return this.make({ kind: 'abs', value, offset: leftToken.offset }, leftToken.offset, depth);
    }
    return value;
  }

  private readDelimiter(): string {
    const token = this.peek();
    if (token.kind === 'punct') {
      if (token.value === '(' || token.value === ')' || token.value === '[' || token.value === ']'
        || token.value === '|' || token.value === '.') {
        this.take();
        return token.value;
      }
    }
    if (token.kind === 'command') {
      if (token.value === 'lbrace' || token.value === 'rbrace'
        || token.value === 'lvert' || token.value === 'rvert'
        || token.value === 'vert' || token.value === 'Vert') {
        this.take();
        return token.value === 'lbrace' || token.value === 'rbrace'
          ? '{'
          : token.value === 'lvert' || token.value === 'rvert' || token.value === 'vert'
            ? '|'
            : 'Vert';
      }
    }
    throw new LatexError('latex-syntax', '\\left/\\right 后缺少定界符。', token.offset);
  }

  private variable(name: string, offset: number, depth: number): Ast {
    if (name === 'y') {
      throw new LatexError('latex-name', 'y 是绘图输出标记，不能出现在表达式中。', offset);
    }
    if (name === 'e' || name === 'pi') {
      return this.make({ kind: 'constant', value: name as 'e' | 'pi', offset }, offset, depth);
    }
    return this.make({ kind: 'variable', name, offset }, offset, depth);
  }

  private parseFunction(name: CallName, depth: number): Ast {
    const offset = this.take().offset;
    let base: Ast | null = null;
    let power: Ast | null = null;

    if (name === 'log' && this.atPunct('_')) {
      this.take();
      base = this.parseScriptArgument(depth + 1);
    }
    if (this.atPunct('^')) {
      this.take();
      power = this.parseScriptArgument(depth + 1);
    }

    const args: Ast[] = [];
    if ((name === 'min' || name === 'max') && this.atPunct('(')) {
      this.take();
      if (this.atPunct(')')) {
        throw new LatexError('latex-syntax', `\\${name} 至少需要一个参数。`, offset);
      }
      args.push(this.parseAdditive(depth + 1));
      while (this.atPunct(',')) {
        this.take();
        args.push(this.parseAdditive(depth + 1));
      }
      this.expectPunct(')');
    } else {
      args.push(this.parseFunctionArgument(depth + 1));
    }

    return this.make({ kind: 'call', name, args, base, power, offset }, offset, depth);
  }

  private parseFunctionArgument(depth: number): Ast {
    if (this.atPunct('(')) {
      this.take();
      const value = this.parseAdditive(depth + 1);
      this.expectPunct(')');
      return value;
    }
    return this.parseMultiplicative(depth + 1, true);
  }

  private parseCases(depth: number): Ast {
    const begin = this.take();
    const environment = this.readRawGroup();
    if (environment.raw.trim() !== 'cases') {
      throw new LatexError('latex-unsupported', `不支持的环境 "${environment.raw.trim()}"。`, environment.offset);
    }

    const branches: CaseBranch[] = [];
    while (!this.atCommand('end')) {
      if (this.peek().kind === 'eof') {
        throw new LatexError('latex-syntax', 'cases 环境缺少 \\end{cases}。', begin.offset);
      }
      if (this.atCommand('newline')) {
        this.take();
        continue;
      }
      const value = this.parseAdditive(depth + 1);
      // Cases rows conventionally write "value, & condition"; the comma is
      // punctuation, not part of the value.
      if (this.atPunct(',')) this.take();
      let when: When | null = null;
      if (this.atPunct('&')) {
        this.take();
        when = this.parseCaseCondition(depth + 1);
        if (this.atPunct(',')) this.take();
      }
      branches.push({ value, when });
      if (this.atCommand('newline')) {
        this.take();
        continue;
      }
      if (this.atCommand('end')) break;
      const token = this.peek();
      throw new LatexError('latex-syntax', `cases 分支后出现无法解析的 "${this.raw(token)}"。`, token.offset);
    }

    const end = this.take();
    const closing = this.readRawGroup();
    if (closing.raw.trim() !== 'cases') {
      throw new LatexError('latex-syntax', '\\begin{cases} 需要用 \\end{cases} 结束。', end.offset);
    }
    if (branches.length === 0) {
      throw new LatexError('latex-syntax', 'cases 环境没有分支。', begin.offset);
    }
    return this.make({ kind: 'cases', branches, offset: begin.offset }, begin.offset, depth);
  }

  private parseCaseCondition(depth: number): When | null {
    if (this.atCommand('text')) {
      const token = this.take();
      const group = this.readRawGroup();
      if (group.raw.trim() !== 'otherwise') {
        throw new LatexError('latex-unsupported', `不支持的分段条件文本 "${group.raw.trim()}"。`, token.offset);
      }
      return null;
    }

    const left = this.parseAdditive(depth + 1);
    const token = this.peek();
    const op = isRelationToken(token);
    if (!op) {
      throw new LatexError('latex-syntax', '分段条件需要一次比较。', token.offset);
    }
    this.take();
    const right = this.parseAdditive(depth + 1);
    return { op, left, right };
  }

  private readRawGroup(): { raw: string; offset: number } {
    const open = this.expectPunct('{');
    let nesting = 1;
    let index = this.pos;
    for (; index < this.tokens.length; index += 1) {
      const token = this.tokens[index];
      if (token.kind === 'eof') break;
      if (token.kind !== 'punct') continue;
      if (token.value === '{') nesting += 1;
      else if (token.value === '}') {
        nesting -= 1;
        if (nesting === 0) break;
      }
    }
    if (index >= this.tokens.length || this.tokens[index].kind === 'eof') {
      throw new LatexError('latex-syntax', '花括号没有闭合。', open.offset);
    }
    const close = this.tokens[index];
    this.pos = index + 1;
    return { raw: this.source.slice(open.offset + 1, close.offset), offset: open.offset + 1 };
  }
}

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

function collectDependencies(node: Ast, out: Set<string>): void {
  switch (node.kind) {
    case 'variable':
      if (node.name !== 'x') out.add(node.name);
      return;
    case 'number':
    case 'constant':
      return;
    case 'unary':
      collectDependencies(node.operand, out);
      return;
    case 'binary':
      collectDependencies(node.left, out);
      collectDependencies(node.right, out);
      return;
    case 'abs':
      collectDependencies(node.value, out);
      return;
    case 'call':
      if (node.base) collectDependencies(node.base, out);
      if (node.power) collectDependencies(node.power, out);
      for (const arg of node.args) collectDependencies(arg, out);
      return;
    case 'cases':
      for (const branch of node.branches) {
        collectDependencies(branch.value, out);
        if (branch.when) {
          collectDependencies(branch.when.left, out);
          collectDependencies(branch.when.right, out);
        }
      }
      return;
  }
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

interface Evaluation {
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
  if (!Number.isFinite(value)) fail('latex-number', '计算结果不是有限数。', offset);
  return value;
}

function readVariable(name: string, state: Evaluation, offset: number): number {
  if (name === 'x') return state.x;
  const value = state.env[name];
  if (value === undefined && !Object.prototype.hasOwnProperty.call(state.env, name)) {
    fail('latex-variable', `未声明的参数 "${name}"。`, offset);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('latex-type', `参数 "${name}" 必须是有限数字。`, offset);
  }
  return value;
}

function power(base: number, exponent: number, offset: number): number {
  if (base === 0 && exponent < 0) {
    fail('latex-divide-by-zero', '零的负数次幂没有定义。', offset);
  }
  if (base < 0 && !Number.isInteger(exponent)) {
    fail('latex-domain', '负数底数的非整数次幂不是实数。', offset);
  }
  return finite(Math.pow(base, exponent), offset);
}

function root(value: number, index: number | null, offset: number): number {
  const degree = index ?? 2;
  if (!Number.isFinite(degree) || degree <= 0) {
    fail('latex-domain', '根指数必须是正数。', offset);
  }
  if (value < 0) {
    if (!Number.isInteger(degree) || degree % 2 === 0) {
      fail('latex-domain', '负数没有实数的偶数次根。', offset);
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
        fail('latex-domain', 'tan 在该点没有定义。', node.offset);
      }
      value = Math.tan(args[0]);
      break;
    case 'arcsin':
      if (args[0] < -1 || args[0] > 1) fail('latex-domain', 'arcsin 的参数必须在 [-1, 1] 内。', node.offset);
      value = Math.asin(args[0]);
      break;
    case 'arccos':
      if (args[0] < -1 || args[0] > 1) fail('latex-domain', 'arccos 的参数必须在 [-1, 1] 内。', node.offset);
      value = Math.acos(args[0]);
      break;
    case 'arctan': value = Math.atan(args[0]); break;
    case 'exp': value = Math.exp(args[0]); break;
    case 'ln':
      if (args[0] <= 0) fail('latex-domain', 'ln 的参数必须大于零。', node.offset);
      value = Math.log(args[0]);
      break;
    case 'log': {
      const base = node.base ? evaluateAst(node.base, state) : 10;
      if (base <= 0 || base === 1) fail('latex-domain', '对数的底数必须大于零且不等于 1。', node.offset);
      if (args[0] <= 0) fail('latex-domain', '对数的参数必须大于零。', node.offset);
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
      fail('latex-unsupported', '不支持的函数。', node.offset);
  }

  if (node.power) {
    value = power(value, evaluateAst(node.power, state), node.offset);
  }
  return finite(value, node.offset);
}

function evaluateAst(node: Ast, state: Evaluation): number {
  const offset = node.offset;
  state.steps += 1;
  state.depth += 1;
  try {
    if (state.steps > state.limit) {
      fail('latex-budget', '数学计算超过执行预算。', offset);
    }
    if (state.depth > MAX_EVAL_DEPTH) {
      fail('latex-budget', '数学计算嵌套过深。', offset);
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
          if (right === 0) fail('latex-divide-by-zero', '除数为零。', node.offset);
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
      fail('latex-undefined', '没有命中的分段分支。', node.offset);
    }
  }
  fail('latex-unsupported', '无法计算的数学结构。', offset);
  } finally {
    state.depth -= 1;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const cache = new Map<string, LatexExpression>();

export function compileLatex(source: string): LatexExpression {
  if (typeof source !== 'string') {
    throw new LatexError('latex-syntax', '数学源码必须是字符串。', 0);
  }
  if (source.length > MAX_SOURCE) {
    throw new LatexError('latex-budget', '数学公式超过长度上限。', MAX_SOURCE);
  }

  const cached = cache.get(source);
  if (cached) return cached;

  const ast = new LatexParser(source, lex(source)).parseDocument();
  const found = new Set<string>();
  collectDependencies(ast, found);
  const dependencies = [...found];

  const expression: LatexExpression = {
    source,
    dependencies,
    evaluate(x: number, env: Record<string, LocalValue>, budget?: LatexEvaluationBudget): number {
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        throw new LatexError('latex-variable', '绘图自变量 x 必须是有限数字。', 0);
      }
      const state: Evaluation = {
        x,
        env: env ?? {},
        steps: budget?.steps ?? 0,
        limit: budget?.limit ?? MAX_EVAL_STEPS,
        depth: 0,
      };
      try {
        return evaluateAst(ast, state);
      } finally {
        if (budget) budget.steps = state.steps;
      }
    },
  };

  if (cache.size >= 512) cache.clear();
  cache.set(source, expression);
  return expression;
}

function safeValue(
  expression: LatexExpression,
  x: number,
  env: Record<string, LocalValue>,
  budget?: LatexEvaluationBudget,
): number | null {
  try {
    return expression.evaluate(x, env, budget);
  } catch (error) {
    if (error instanceof LatexError) {
      if (error.code === 'latex-budget') throw error;
      return null;
    }
    throw error;
  }
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Bounded subdivision inside one sample interval. A genuine singularity makes
 * the local slope grow without bound as the interval is refined; a smooth
 * curve, even a steep or offset one, converges. The check therefore compares
 * the finest slope with an early refinement level and the plot-wide typical
 * slope, never with the distance to zero.
 */
function refinementDetectsBreak(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  globalSlope: number,
  valueAt: (x: number) => number | null,
): boolean {
  const width = x1 - x0;
  if (!(width > 0)) return false;

  let levelTwoSlope = 0;
  let finalSlope = 0;
  for (let depth = 1; depth <= MAX_REFINE_DEPTH; depth += 1) {
    const count = 1 << depth;
    const dx = width / count;
    let previousY = y0;
    let maxSlope = 0;
    for (let k = 1; k <= count; k += 1) {
      const x = k === count ? x1 : x0 + k * dx;
      const y = k === count ? y1 : valueAt(x);
      if (y === null) return true;
      const slope = Math.abs(y - previousY) / dx;
      if (slope > maxSlope) maxSlope = slope;
      previousY = y;
    }
    if (depth === 2) levelTwoSlope = maxSlope;
    finalSlope = maxSlope;
  }

  return finalSlope > Math.max(levelTwoSlope * 6, globalSlope * 12, 1e-9);
}

/**
 * Samples y(x) across [min, max]. Undefined points and the sample after a
 * detected break become null so a renderer cannot join the two sides of an
 * asymptote. The array always has exactly `samples` points.
 *
 * The optional final budget is shared by every curve/plot in a document. Each
 * evaluation is limited by whatever remains of both that shared budget and the
 * per-curve budget, and a `latex-budget` error aborts the whole sampling pass.
 */
export function samplePlot(
  expression: LatexExpression,
  env: Record<string, LocalValue>,
  min: number,
  max: number,
  samples = 200,
  sharedBudget?: LatexEvaluationBudget,
): PlotSample {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new LatexError('latex-plot-range', '绘图的 min/max 必须是有限数字。', 0);
  }
  if (!(min < max)) {
    throw new LatexError('latex-plot-range', '绘图的 min 必须小于 max。', 0);
  }
  if (!Number.isInteger(samples) || samples < 2 || samples > MAX_SAMPLES) {
    throw new LatexError('latex-plot-samples', `采样数必须是 2 到 ${MAX_SAMPLES} 之间的整数。`, 0);
  }

  // Each curve keeps its own hard budget, while an optional caller-provided
  // budget is shared by every curve and every plot in the document. A single
  // evaluation receives whatever remains of both, so neither limit can be
  // bypassed by handing out a fresh budget per sample.
  const localBudget: LatexEvaluationBudget = {
    steps: 0,
    limit: Math.max(MIN_PLOT_STEPS, samples * 1024),
  };

  const sampleValue = (x: number): number | null => {
    const localRemaining = localBudget.limit - localBudget.steps;
    // A malformed external budget fails closed (zero remaining) rather than
    // becoming an unlimited NaN or Infinity comparison.
    const sharedRemaining = sharedBudget
      ? Number.isFinite(sharedBudget.limit) && Number.isFinite(sharedBudget.steps)
        ? sharedBudget.limit - sharedBudget.steps
        : 0
      : Number.POSITIVE_INFINITY;
    const evaluation: LatexEvaluationBudget = {
      steps: 0,
      limit: Math.max(0, Math.min(localRemaining, sharedRemaining)),
    };
    try {
      return safeValue(expression, x, env, evaluation);
    } finally {
      localBudget.steps += evaluation.steps;
      if (sharedBudget) {
        sharedBudget.steps = Number.isFinite(sharedBudget.steps)
          ? sharedBudget.steps + evaluation.steps
          : evaluation.steps;
      }
    }
  };

  const step = (max - min) / (samples - 1);
  const raw: PlotPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const x = i === samples - 1 ? max : min + i * step;
    raw.push({ x, y: sampleValue(x) });
  }

  const magnitudes = raw
    .map((point) => point.y)
    .filter((value): value is number => value !== null)
    .map((value) => Math.abs(value));
  const spikeLimit = Math.max(1e-9, medianOf(magnitudes) * 8);

  // A sample that lands exactly on a floating-point asymptote (tan of pi/2)
  // can be finite but astronomically larger than both neighbours. Treat such
  // isolated spikes as undefined rather than drawing a needle.
  for (let i = 1; i < raw.length - 1; i += 1) {
    const previous = raw[i - 1].y;
    const current = raw[i].y;
    const following = raw[i + 1].y;
    if (previous === null || current === null || following === null) continue;
    const neighbourMax = Math.max(1, Math.abs(previous), Math.abs(following));
    if (Math.abs(current) > neighbourMax * 100 && Math.abs(current) > spikeLimit) {
      raw[i] = { x: raw[i].x, y: null };
    }
  }

  const lastIndex = raw.length - 1;
  let endpoint = raw[lastIndex].y;
  const beforeEnd = lastIndex > 0 ? raw[lastIndex - 1].y : null;
  if (endpoint !== null && beforeEnd !== null
    && Math.abs(endpoint) > Math.max(1, Math.abs(beforeEnd)) * 100
    && Math.abs(endpoint) > spikeLimit) {
    endpoint = null;
    raw[lastIndex] = { x: raw[lastIndex].x, y: null };
  }

  // Offset-invariant scales for deciding whether an interval needs a closer
  // look: adjacent value changes and adjacent slopes.
  const deltas: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < raw.length - 1; i += 1) {
    const left = raw[i];
    const right = raw[i + 1];
    if (left.y === null || right.y === null) continue;
    const delta = Math.abs(right.y - left.y);
    deltas.push(delta);
    const dx = right.x - left.x;
    if (dx > 0) slopes.push(delta / dx);
  }
  const globalDelta = medianOf(deltas);
  const globalSlope = medianOf(slopes);

  // Keep exactly `samples` points so every curve shares x positions; a break
  // is represented by turning the post-break sample null.
  for (let i = 0; i < raw.length - 1; i += 1) {
    const point = raw[i];
    const next = raw[i + 1];
    const y1 = point.y;
    const y2 = next.y;
    if (y1 === null || y2 === null) continue;

    const cutNext = () => {
      raw[i + 1] = { x: next.x, y: null };
    };

    const midX = point.x + (next.x - point.x) / 2;
    const midY = sampleValue(midX);
    if (midY === null) {
      cutNext();
      continue;
    }

    const gap = Math.abs(y2 - y1);
    const deviation = Math.abs(midY - (y1 + y2) / 2);
    const interesting = deviation > Math.max(gap * 0.25, globalDelta * 0.4, 1e-9)
      || gap > Math.max(globalDelta * 16, 1e-9);
    if (!interesting) continue;

    const singular = refinementDetectsBreak(
      point.x,
      y1,
      next.x,
      y2,
      globalSlope,
      (x) => sampleValue(x),
    );
    if (singular) cutNext();
  }

  return { points: raw, endpoint };
}
