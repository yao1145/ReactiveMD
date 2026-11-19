import type { Ast, CallName, CaseBranch, Relation, When } from './latex';

type TokenKind = 'number' | 'letter' | 'command' | 'punct' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  offset: number;
}

/** LaTeX source, in UTF-16 code units, per formula. */
export const MAX_SOURCE = 50_000;

/** Tokens and AST nodes created while parsing one formula. */
const MAX_TOKENS = 20_000;

const MAX_NODES = 5_000;

/** Parser call depth for one formula. */
const MAX_DEPTH = 120;

/** Node visits (default per evaluation; a caller may supply a shared budget) and evaluation depth. */
export const MAX_EVAL_STEPS = 20_000;

export const MAX_EVAL_DEPTH = 1_000;

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

export function lex(source: string): Token[] {
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

    // Keep the original one-character offset while sharing \theta semantics.
    if (ch === 'θ') {
      push('command', 'theta', i);
      i += 1;
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

export class LatexParser {
  private tokens: Token[];
  private source: string;
  private pos = 0;
  private nodes = 0;
  private allowY: boolean;

  constructor(source: string, tokens: Token[], options: { allowY?: boolean } = {}) {
    this.source = source;
    this.tokens = tokens;
    this.allowY = options.allowY === true;
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

  /** Parses one equation into its two sides without deciding how it is plotted. */
  parseEquation(): { left: Ast; right: Ast } {
    if (this.peek().kind === 'eof') {
      throw new LatexError('latex-empty', 'Formula is empty.', 0);
    }
    const left = this.parseAdditive(0);
    const relation = this.peek();
    if (!(relation.kind === 'punct' && relation.value === '=')) {
      throw new LatexError('latex-relation', 'Plot formulas must be written as an equation.', relation.offset);
    }
    this.take();
    const right = this.parseAdditive(0);
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      throw new LatexError('latex-syntax', `Unexpected token "${this.raw(rest)}".`, rest.offset);
    }
    return { left, right };
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

  private parseAtom(depth: number, _suppressFunction: boolean): Ast {
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
    if (name === 'y' && !this.allowY) {
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
