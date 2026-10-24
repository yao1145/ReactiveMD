import type { LocalValue, SourceRange } from './types';

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

/** LaTeX source, in UTF-16 code units, per formula. */
const MAX_SOURCE = 50_000;
/** Tokens and AST nodes created while parsing one formula. */
const MAX_TOKENS = 20_000;
const MAX_NODES = 5_000;
/** Parser call depth for one formula. */
const MAX_DEPTH = 120;
/** Node visits (default per evaluation; a caller may supply a shared budget) and evaluation depth. */
const MAX_EVAL_STEPS = 20_000;
const MAX_EVAL_DEPTH = 1_000;
/** Sample points per curve, including endpoints. */
const MAX_SAMPLES = 2_000;
const MAX_REFINE_DEPTH = 5;
/** Minimum node-visit allowance for one curve sampling call. */
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
      throw new LatexError('latex-budget', 'Math input contains too many tokens.', offset);
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
        throw new LatexError('latex-syntax', 'Formula ends with a lone backslash.', i);
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
      throw new LatexError('latex-empty', 'Formula is empty.', 0);
    }
    // Plot formulas are written as "y = expression"; y is an output marker.
    if (this.atLetter('y') && this.atPunctAt(1, '=')) {
      this.pos += 2;
    }
    if (this.peek().kind === 'eof') {
      throw new LatexError('latex-empty', 'Missing expression after y.', this.peek().offset);
    }
    const expression = this.parseAdditive(0);
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      if (isRelationToken(rest) || (rest.kind === 'punct' && rest.value === '=')) {
        throw new LatexError('latex-relation', 'Plots support only explicit y = f(x) equations.', rest.offset);
      }
      throw new LatexError('latex-syntax', `Unexpected token "${this.raw(rest)}".`, rest.offset);
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
      throw new LatexError('latex-syntax', `Missing "${value}".`, token.offset);
    }
    return this.take();
  }

  private raw(token: Token): string {
    if (token.kind === 'eof') return 'end of input';
    if (token.kind === 'command') return `\\${token.value}`;
    return this.source.slice(token.offset, token.offset + Math.max(1, token.value.length));
  }

  private make<T extends Ast>(node: T, offset: number, depth: number): T {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) {
      throw new LatexError('latex-budget', 'Formula is too complex.', offset);
    }
    if (depth > MAX_DEPTH) {
      throw new LatexError('latex-budget', 'Formula is nested too deeply.', offset);
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
        throw new LatexError('latex-number', `Number "${token.value}" is not finite.`, token.offset);
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
      throw new LatexError('latex-syntax', `Cannot start an expression with "${token.value}".`, token.offset);
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
          throw new LatexError('latex-name', '\\mathrm requires a valid parameter name.', group.offset);
        }
        return this.variable(group.raw, token.offset, depth);
      }
      if (name === 'begin') return this.parseCases(depth);
      if (name === 'lvert' || name === 'vert') return this.parseCommandAbs(depth, token.offset);
      if (name === 'right') {
        throw new LatexError('latex-syntax', '\\right has no matching \\left.', token.offset);
      }
      if (name === 'text') {
        throw new LatexError('latex-unsupported', '\\text is only allowed as the otherwise condition of a piecewise function.', token.offset);
      }
      throw new LatexError('latex-unsupported', `Command \\${name} is not supported for computation.`, token.offset);
    }

    throw new LatexError('latex-syntax', 'Expression is incomplete.', token.offset);
  }

  private parseArgument(depth: number): Ast {
    if (this.atPunct('{')) return this.parseBraceGroup(depth + 1);
    if (this.peek().kind === 'eof') {
      throw new LatexError('latex-syntax', 'Command is missing an argument.', this.peek().offset);
    }
    return this.parseUnary(depth + 1, false);
  }

  private parseParenthesized(depth: number): Ast {
    const open = this.expectPunct('(');
    if (this.atPunct(')')) {
      throw new LatexError('latex-syntax', 'Missing expression inside parentheses.', open.offset);
    }
    const value = this.parseAdditive(depth + 1);
    this.expectPunct(')');
    return value;
  }

  private parseBraceGroup(depth: number): Ast {
    const open = this.expectPunct('{');
    if (this.atPunct('}')) {
      throw new LatexError('latex-syntax', 'Missing expression inside braces.', open.offset);
    }
    const value = this.parseAdditive(depth + 1);
    this.expectPunct('}');
    return value;
  }

  private parseBracketGroup(depth: number): Ast {
    const open = this.expectPunct('[');
    if (this.atPunct(']')) {
      throw new LatexError('latex-syntax', 'Missing expression inside brackets.', open.offset);
    }
    const value = this.parseAdditive(depth + 1);
    this.expectPunct(']');
    return value;
  }

  private parsePlainAbs(depth: number, offset: number): Ast {
    this.take();
    if (this.atPunct('|')) {
      throw new LatexError('latex-syntax', 'Absolute value is missing its contents.', offset);
    }
    const value = this.parseAdditive(depth + 1);
    if (this.atPunct('|')) {
      this.take();
    } else if (this.atCommand('rvert')) {
      this.take();
    } else {
      throw new LatexError('latex-syntax', 'Unpaired absolute value bar.', offset);
    }
    return this.make({ kind: 'abs', value, offset }, offset, depth);
  }

  private parseCommandAbs(depth: number, offset: number): Ast {
    this.take();
    if (this.atCommand('rvert') || this.atCommand('vert') || this.atPunct('|')) {
      throw new LatexError('latex-syntax', 'Absolute value is missing its contents.', offset);
    }
    const value = this.parseAdditive(depth + 1);
    if (this.atCommand('rvert') || this.atCommand('vert') || this.atPunct('|')) {
      this.take();
    } else {
      throw new LatexError('latex-syntax', 'Unpaired absolute value bar.', offset);
    }
    return this.make({ kind: 'abs', value, offset }, offset, depth);
  }

  private parseLeft(depth: number): Ast {
    const leftToken = this.take();
    const open = this.readDelimiter();
    const value = this.parseAdditive(depth + 1);
    if (!this.atCommand('right')) {
      throw new LatexError('latex-syntax', '\\left has no matching \\right.', leftToken.offset);
    }
    this.take();
    const close = this.readDelimiter();
    if (open === '|' && close !== '|') {
      throw new LatexError('latex-syntax', 'Unpaired absolute value bar.', leftToken.offset);
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
    throw new LatexError('latex-syntax', 'Missing delimiter after \\left/\\right.', token.offset);
  }

  private variable(name: string, offset: number, depth: number): Ast {
    if (name === 'y') {
      throw new LatexError('latex-name', 'y is the plot output marker and cannot appear in the expression.', offset);
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
        throw new LatexError('latex-syntax', `\\${name} requires at least one argument.`, offset);
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
      throw new LatexError('latex-unsupported', `Environment "${environment.raw.trim()}" is not supported.`, environment.offset);
    }

    const branches: CaseBranch[] = [];
    while (!this.atCommand('end')) {
      if (this.peek().kind === 'eof') {
        throw new LatexError('latex-syntax', 'cases environment is missing \\end{cases}.', begin.offset);
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
      throw new LatexError('latex-syntax', `Unexpected "${this.raw(token)}" after a cases branch.`, token.offset);
    }

    const end = this.take();
    const closing = this.readRawGroup();
    if (closing.raw.trim() !== 'cases') {
      throw new LatexError('latex-syntax', '\\begin{cases} must be closed with \\end{cases}.', end.offset);
    }
    if (branches.length === 0) {
      throw new LatexError('latex-syntax', 'cases environment has no branches.', begin.offset);
    }
    return this.make({ kind: 'cases', branches, offset: begin.offset }, begin.offset, depth);
  }

  private parseCaseCondition(depth: number): When | null {
    if (this.atCommand('text')) {
      const token = this.take();
      const group = this.readRawGroup();
      if (group.raw.trim() !== 'otherwise') {
        throw new LatexError('latex-unsupported', `Unsupported piecewise condition text "${group.raw.trim()}".`, token.offset);
      }
      return null;
    }

    const left = this.parseAdditive(depth + 1);
    const token = this.peek();
    const op = isRelationToken(token);
    if (!op) {
      throw new LatexError('latex-syntax', 'Piecewise condition requires one comparison.', token.offset);
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
      throw new LatexError('latex-syntax', 'Unclosed brace.', open.offset);
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

/** Internal authoring support: only AST variable nodes represent plot reads. */
export function localLatexReferences(source: string): { name: string; range: SourceRange }[] {
  // Apply the same source and syntax budgets as evaluation before traversing.
  compileLatex(source);
  const ast = new LatexParser(source, lex(source)).parseDocument();
  const references: { name: string; range: SourceRange }[] = [];
  const visit = (node: Ast): void => {
    switch (node.kind) {
      case 'variable': {
        if (node.name === 'x' || node.name === 'y') return;
        const start = node.offset;
        let end = start + 1;
        if (source.startsWith('\\mathrm', start)) end = source.indexOf('}', start) + 1;
        else if (source[start] === '\\') end = start + 1 + node.name.length;
        references.push({ name: node.name, range: { start, end } });
        return;
      }
      case 'unary': visit(node.operand); return;
      case 'binary': visit(node.left); visit(node.right); return;
      case 'abs': visit(node.value); return;
      case 'call':
        if (node.base) visit(node.base);
        if (node.power) visit(node.power);
        node.args.forEach(visit);
        return;
      case 'cases':
        for (const branch of node.branches) {
          visit(branch.value);
          if (branch.when) { visit(branch.when.left); visit(branch.when.right); }
        }
        return;
      case 'number': case 'constant': return;
    }
  };
  visit(ast);
  return references.sort((a, b) => a.range.start - b.range.start);
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

function evaluateAst(node: Ast, state: Evaluation): number {
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

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

const cache = new Map<string, LatexExpression>();

export function compileLatex(source: string): LatexExpression {
  if (typeof source !== 'string') {
    throw new LatexError('latex-syntax', 'Math source must be a string.', 0);
  }
  if (source.length > MAX_SOURCE) {
    throw new LatexError('latex-budget', 'Formula exceeds the length limit.', MAX_SOURCE);
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
        throw new LatexError('latex-variable', 'Plot input x must be a finite number.', 0);
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
    throw new LatexError('latex-plot-range', 'Plot min/max must be finite numbers.', 0);
  }
  if (!(min < max)) {
    throw new LatexError('latex-plot-range', 'Plot min must be less than max.', 0);
  }
  if (!Number.isInteger(samples) || samples < 2 || samples > MAX_SAMPLES) {
    throw new LatexError('latex-plot-samples', `Sample count must be an integer between 2 and ${MAX_SAMPLES}.`, 0);
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
