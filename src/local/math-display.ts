/**
 * Pure-TypeScript MathML parser for local LaTeX display.
 *
 * This module owns the single parsing implementation used by the React view
 * (`math-view.tsx`) and by display diagnostics. It must stay React-free so the
 * compiler can inspect formulas without importing the renderer.
 *
 * Parsing never throws: unsupported constructs are represented as literal
 * MathML text, and the same constructs are reported as source-ranged issues.
 * That keeps "rendered as literal text" and "reported as a warning" in sync.
 */

import type { LocalDiagnosticParams } from './types';
import { renderLocalDiagnostic } from './diagnostics';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type LocalMathDisplayIssueReason =
  | 'unsupported-command'
  | 'unsupported-environment'
  | 'budget'
  | 'syntax';

/** One display-compatibility issue; offsets are relative to the formula body. */
export interface LocalMathDisplayIssue {
  /** Inclusive UTF-16 offset into the formula body. */
  start: number;
  /** Exclusive UTF-16 offset into the formula body. */
  end: number;
  reason: LocalMathDisplayIssueReason;
  /** English message for the issue (localize with `messageKey`/`params`). */
  message: string;
  /** Coarse machine code reported on `Diagnostic.code`. */
  code: string;
  /** Template key registered in `diagnostics.ts`. */
  messageKey: string;
  params?: LocalDiagnosticParams;
}

/** Lightweight MathML tree consumed by the React view. */
export interface MathNode {
  tag: string;
  attrs?: Readonly<Record<string, string>>;
  text?: string;
  children?: MathNode[];
}

export interface LocalMathDisplayParse {
  /** `null` means the whole formula must be shown as bounded literal text. */
  node: MathNode | null;
  issues: LocalMathDisplayIssue[];
}

/** Diagnostic code emitted for every display-compatibility issue. */
export const MATH_DISPLAY_DIAGNOSTIC_CODE = 'local.math.display';

export const MATH_DISPLAY_MESSAGE_KEYS = {
  'unsupported-command': 'local.math.display.unsupported-command',
  'unsupported-environment': 'local.math.display.unsupported-environment',
  budget: 'local.math.display.budget',
  'stray-end': 'local.math.display.stray-end',
  'environment-unclosed': 'local.math.display.environment-unclosed',
  'environment-missing-name': 'local.math.display.environment-missing-name',
  syntax: 'local.math.display.syntax',
} as const;

/* ------------------------------------------------------------------ */
/* Limits and support tables                                           */
/* ------------------------------------------------------------------ */

export const MAX_LOCAL_MATH_DISPLAY_SOURCE = 50_000;
export const MAX_LOCAL_MATH_DISPLAY_TOKENS = 20_000;
export const MAX_LOCAL_MATH_DISPLAY_DEPTH = 120;
export const MAX_LOCAL_MATH_DISPLAY_FALLBACK = 2_000;
const MAX_LOCAL_MATH_DISPLAY_ISSUES = 50;
const MAX_DISPLAY_NAME = 64;

const SPECIAL_COMMANDS: Record<string, string> = {
  ' ': 'space', ',': 'thinspace', ':': 'medspace', ';': 'thickspace', '!': 'negthinspace',
  '{': 'lbrace', '}': 'rbrace', '|': 'vert', '%': 'percent', '&': 'amp',
  '#': 'hash', '_': 'underscore', '$': 'dollar',
};

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const OPERATORS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  lt: '<', gt: '>', approx: '≈', equiv: '≡', sim: '∼', propto: '∝',
  infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏',
  int: '∫', iint: '∬', oint: '∮',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃',
  subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩',
  emptyset: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  angle: '∠', perp: '⊥', parallel: '∥', degree: '°', prime: '′',
  ldots: '…', cdots: '⋯', dots: '…', langle: '⟨', rangle: '⟩',
  lbrace: '{', rbrace: '}', vert: '|', lvert: '|', rvert: '|',
  lVert: '‖', rVert: '‖', backslash: '\\', percent: '%', amp: '&',
  hash: '#', underscore: '_', dollar: '$', colon: ':',
};

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'exp', 'ln', 'log',
  'min', 'max', 'lim', 'det', 'sup', 'inf', 'arg', 'gcd',
]);

const SPACES: Record<string, string> = {
  space: '0.25em', thinspace: '0.167em', medspace: '0.222em', thickspace: '0.278em',
  negthinspace: '-0.167em', quad: '1em', qquad: '2em', enspace: '0.5em',
};

const IGNORED_COMMANDS = new Set([
  'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'limits', 'nolimits',
]);

const TEXT_COMMANDS = new Set(['text', 'textrm', 'mbox', 'operatorname']);

const VARIANT_COMMANDS: Record<string, string> = {
  mathrm: 'normal', mathbf: 'bold', mathit: 'italic', mathsf: 'sans-serif',
};

const ACCENT_COMMANDS: Record<string, string> = {
  overline: '¯', bar: '¯', hat: '^', tilde: '~', vec: '→', dot: '˙', ddot: '¨',
};

const DELIMITER_COMMANDS: Record<string, string> = {
  lbrace: '{', rbrace: '}', lvert: '|', rvert: '|', vert: '|',
  lVert: '‖', rVert: '‖', Vert: '‖', langle: '⟨', rangle: '⟩',
};

const SUPPORTED_ENVIRONMENTS = new Set(['cases']);

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

type TokenKind = 'number' | 'letter' | 'command' | 'punct' | 'newline' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  offset: number;
  end: number;
}

class MathDisplayBudget extends Error {
  readonly kind: 'source' | 'tokens' | 'depth';
  readonly limit: number;
  readonly offset: number;

  constructor(kind: 'source' | 'tokens' | 'depth', limit: number, offset: number) {
    super('Formula exceeds a display resource budget.');
    this.kind = kind;
    this.limit = limit;
    this.offset = offset;
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const push = (token: Token): void => {
    if (tokens.length >= MAX_LOCAL_MATH_DISPLAY_TOKENS) {
      throw new MathDisplayBudget('tokens', MAX_LOCAL_MATH_DISPLAY_TOKENS, token.offset);
    }
    tokens.push(token);
  };
  let i = 0;
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
        push({ kind: 'command', value: 'backslash', offset: i, end: i + 1 });
        i += 1;
        continue;
      }
      const next = source[i + 1];
      if (next === '\\') {
        push({ kind: 'newline', value: '\\\\', offset: i, end: i + 2 });
        i += 2;
        continue;
      }
      if (/[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1;
        push({ kind: 'command', value: source.slice(i + 1, j), offset: i, end: j });
        i = j;
        continue;
      }
      const special = Object.hasOwn(SPECIAL_COMMANDS, next) ? SPECIAL_COMMANDS[next] : next;
      push({ kind: 'command', value: special, offset: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const match = /^\d+(?:\.\d*)?/.exec(source.slice(i))!;
      push({ kind: 'number', value: match[0], offset: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }
    if (ch === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(i))!;
      push({ kind: 'number', value: match[0], offset: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      push({ kind: 'letter', value: ch, offset: i, end: i + 1 });
      i += 1;
      continue;
    }
    push({ kind: 'punct', value: ch, offset: i, end: i + 1 });
    i += 1;
  }
  push({ kind: 'eof', value: '', offset: source.length, end: source.length });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Issue construction                                                  */
/* ------------------------------------------------------------------ */

function clampRange(sourceLength: number, start: number, end: number): { start: number; end: number } {
  const safeStart = Math.max(0, Math.min(sourceLength, start));
  let safeEnd = Math.max(safeStart, Math.min(sourceLength, end));
  if (safeEnd === safeStart && sourceLength > 0) {
    if (safeStart < sourceLength) safeEnd = safeStart + 1;
    else return { start: sourceLength - 1, end: sourceLength };
  }
  return { start: safeStart, end: safeEnd };
}

function makeIssue(
  sourceLength: number,
  reason: LocalMathDisplayIssueReason,
  messageKey: string,
  params: LocalDiagnosticParams | undefined,
  start: number,
  end: number,
): LocalMathDisplayIssue {
  const range = clampRange(sourceLength, start, end);
  const message = renderLocalDiagnostic(messageKey, 'en', params);
  return {
    ...range,
    reason,
    message: message || messageKey,
    code: MATH_DISPLAY_DIAGNOSTIC_CODE,
    messageKey,
    ...(params ? { params } : {}),
  };
}

function boundedDisplayName(name: string): string {
  return name.length > MAX_DISPLAY_NAME ? `${name.slice(0, MAX_DISPLAY_NAME - 1)}…` : name;
}

function budgetIssue(
  sourceLength: number,
  kind: 'source' | 'tokens' | 'depth',
  limit: number,
  start: number,
  end: number,
): LocalMathDisplayIssue {
  return makeIssue(
    sourceLength,
    'budget',
    MATH_DISPLAY_MESSAGE_KEYS.budget,
    { limit, kind },
    start,
    end,
  );
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

interface Stop {
  chars?: Set<string>;
  commands?: Set<string>;
  newline?: boolean;
}

interface RawGroup {
  text: string;
  present: boolean;
  terminated: boolean;
  start: number;
  end: number;
}

interface NodeOptions {
  attrs?: Record<string, string>;
  text?: string;
  children?: MathNode[];
}

function makeNode(tag: string, options: NodeOptions = {}): MathNode {
  const result: MathNode = { tag };
  if (options.attrs) result.attrs = options.attrs;
  if (options.text !== undefined) result.text = options.text;
  if (options.children && options.children.length > 0) result.children = options.children;
  return result;
}

function moNode(text: string, attrs?: Record<string, string>): MathNode {
  return makeNode('mo', attrs ? { attrs, text } : { text });
}

class MathDisplayParser {
  readonly issues: LocalMathDisplayIssue[] = [];

  private tokens: Token[];
  private pos = 0;
  private readonly source: string;
  private depth = 0;

  constructor(source: string) {
    this.source = source;
    this.tokens = tokenize(source);
  }

  parse(): MathNode {
    const body = this.parseRow({});
    return body.length === 1 ? body[0] : makeNode('mrow', { children: body });
  }

  private report(
    reason: LocalMathDisplayIssueReason,
    messageKey: string,
    params: LocalDiagnosticParams | undefined,
    start: number,
    end: number,
  ): void {
    if (this.issues.length >= MAX_LOCAL_MATH_DISPLAY_ISSUES) return;
    this.issues.push(makeIssue(this.source.length, reason, messageKey, params, start, end));
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_LOCAL_MATH_DISPLAY_DEPTH) {
      this.depth -= 1;
      throw new MathDisplayBudget('depth', MAX_LOCAL_MATH_DISPLAY_DEPTH, this.peek().offset);
    }
  }

  private leave(): void {
    this.depth -= 1;
  }

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

  private atCommand(value: string): boolean {
    const token = this.peek();
    return token.kind === 'command' && token.value === value;
  }

  private parseRow(stop: Stop): MathNode[] {
    this.enter();
    try {
      const output: MathNode[] = [];
      for (;;) {
        const token = this.peek();
        if (token.kind === 'eof') break;
        if (token.kind === 'punct' && stop.chars?.has(token.value)) break;
        if (token.kind === 'command' && stop.commands?.has(token.value)) break;
        if (token.kind === 'newline' && stop.newline) break;
        output.push(this.parseAtom());
      }
      return output;
    } finally {
      this.leave();
    }
  }

  private parseAtom(): MathNode {
    this.enter();
    try {
      return this.parseAtomBody();
    } finally {
      this.leave();
    }
  }

  private parseAtomBody(): MathNode {
    const token = this.peek();
    let base: MathNode;

    if (token.kind === 'number') {
      this.take();
      base = makeNode('mn', { text: token.value });
    } else if (token.kind === 'letter') {
      this.take();
      base = makeNode('mi', { text: token.value });
    } else if (token.kind === 'punct') {
      base = this.parsePunctuation(token);
    } else if (token.kind === 'newline') {
      this.take();
      base = makeNode('mspace', { attrs: { linebreak: 'newline' } });
    } else if (token.kind === 'command') {
      base = this.parseCommand(token);
    } else {
      this.take();
      base = makeNode('mtext', { text: '' });
    }

    return this.applyScripts(base);
  }

  private parsePunctuation(token: Token): MathNode {
    this.take();
    if (token.value === '{') {
      this.pos -= 1;
      return this.parseBraceGroup();
    }
    if (token.value === '}' || token.value === '&' || token.value === '#') {
      return moNode(token.value);
    }
    const fences = token.value === '(' || token.value === ')' || token.value === '['
      || token.value === ']' || token.value === '|';
    return moNode(token.value, fences ? { fence: 'true', stretchy: 'true' } : undefined);
  }

  private parseCommand(token: Token): MathNode {
    const name = token.value;
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      this.take();
      return this.parseFraction();
    }
    if (name === 'sqrt') {
      this.take();
      return this.parseRoot();
    }
    if (name === 'left') {
      this.take();
      return this.parseLeft();
    }
    if (name === 'right') {
      this.take();
      const close = this.readDelimiter();
      return close ?? makeNode('mrow');
    }
    if (name === 'begin') {
      this.take();
      return this.parseEnvironment(token);
    }
    if (name === 'end') {
      this.take();
      const group = this.readRawGroupInfo();
      const end = group.present ? group.end : token.end;
      this.report('syntax', MATH_DISPLAY_MESSAGE_KEYS['stray-end'], undefined, token.offset, end);
      return makeNode('mtext', { text: '\\end' });
    }
    if (TEXT_COMMANDS.has(name)) {
      this.take();
      const raw = this.readRawGroupInfo();
      return makeNode('mtext', { text: raw.text });
    }
    if (Object.hasOwn(VARIANT_COMMANDS, name)) {
      this.take();
      const raw = this.readRawGroupInfo();
      return makeNode('mtext', { attrs: { mathvariant: VARIANT_COMMANDS[name] }, text: raw.text });
    }
    if (Object.hasOwn(ACCENT_COMMANDS, name)) {
      this.take();
      const base = this.parseRequiredArgument();
      const accent = ACCENT_COMMANDS[name];
      return makeNode('mover', {
        attrs: { accent: 'true' },
        children: [base, moNode(accent, { stretchy: 'true' })],
      });
    }
    if (IGNORED_COMMANDS.has(name)) {
      this.take();
      return makeNode('mrow');
    }
    if (Object.hasOwn(SPACES, name)) {
      this.take();
      return makeNode('mspace', { attrs: { width: SPACES[name] } });
    }
    if (FUNCTIONS.has(name)) {
      this.take();
      return moNode(name, { mathvariant: 'normal', form: 'prefix' });
    }
    if (Object.hasOwn(GREEK, name)) {
      this.take();
      return makeNode('mi', { text: GREEK[name] });
    }
    if (Object.hasOwn(OPERATORS, name)) {
      this.take();
      const char = OPERATORS[name];
      const fences = char === '(' || char === ')' || char === '[' || char === ']'
        || char === '{' || char === '}' || char === '|' || char === '‖'
        || char === '⟨' || char === '⟩';
      return moNode(char, fences ? { fence: 'true', stretchy: 'true' } : undefined);
    }

    this.take();
    this.report(
      'unsupported-command',
      MATH_DISPLAY_MESSAGE_KEYS['unsupported-command'],
      { name: boundedDisplayName(name) },
      token.offset,
      token.end,
    );
    return makeNode('mtext', { text: `\\${name}` });
  }

  private parseBraceGroup(): MathNode {
    if (!this.atPunct('{')) return makeNode('mrow');
    this.take();
    const body = this.parseRow({ chars: new Set(['}']) });
    if (this.atPunct('}')) this.take();
    return makeNode('mrow', { children: body });
  }

  private parseFraction(): MathNode {
    const numerator = this.parseRequiredArgument();
    const denominator = this.parseRequiredArgument();
    return makeNode('mfrac', { children: [numerator, denominator] });
  }

  private parseRoot(): MathNode {
    let index: MathNode | null = null;
    if (this.atPunct('[')) {
      this.take();
      const body = this.parseRow({ chars: new Set([']']) });
      if (this.atPunct(']')) this.take();
      index = makeNode('mrow', { children: body });
    }
    const value = this.parseRequiredArgument();
    return index ? makeNode('mroot', { children: [value, index] }) : makeNode('msqrt', { children: [value] });
  }

  private parseRequiredArgument(): MathNode {
    if (this.atPunct('{')) return this.parseBraceGroup();
    return this.parseAtom();
  }

  private parseLeft(): MathNode {
    const open = this.readDelimiter();
    const body = this.parseRow({ commands: new Set(['right']) });
    let close: MathNode | null = null;
    if (this.atCommand('right')) {
      this.take();
      close = this.readDelimiter();
    }
    if (!open && !close) return makeNode('mrow', { children: body });
    return makeNode('mrow', { children: [open, ...body, close].filter((node): node is MathNode => node !== null) });
  }

  private readDelimiter(): MathNode | null {
    const token = this.peek();
    if (token.kind === 'punct') {
      if (token.value === '.') {
        this.take();
        return null;
      }
      if ('()[]|'.includes(token.value)) {
        this.take();
        return moNode(token.value, { fence: 'true', stretchy: 'true' });
      }
      return null;
    }
    if (token.kind === 'command') {
      const char = Object.hasOwn(DELIMITER_COMMANDS, token.value) ? DELIMITER_COMMANDS[token.value] : undefined;
      if (char) {
        this.take();
        return moNode(char, { fence: 'true', stretchy: 'true' });
      }
    }
    return null;
  }

  private parseEnvironment(beginToken: Token): MathNode {
    const group = this.readRawGroupInfo();
    if (!group.present) {
      this.report(
        'syntax',
        MATH_DISPLAY_MESSAGE_KEYS['environment-missing-name'],
        undefined,
        beginToken.offset,
        beginToken.end,
      );
      return makeNode('mtext', { text: '\\begin{}' });
    }

    const name = group.text.trim();
    if (!group.terminated) {
      this.report(
        'syntax',
        MATH_DISPLAY_MESSAGE_KEYS['environment-unclosed'],
        { name: boundedDisplayName(name) || '?' },
        beginToken.offset,
        group.end,
      );
      return makeNode('mtext', { text: `\\begin{${name}}` });
    }

    if (name === '') {
      this.report(
        'syntax',
        MATH_DISPLAY_MESSAGE_KEYS['environment-missing-name'],
        undefined,
        beginToken.offset,
        group.end,
      );
      return makeNode('mtext', { text: '\\begin{}' });
    }

    if (!SUPPORTED_ENVIRONMENTS.has(name)) {
      this.report(
        'unsupported-environment',
        MATH_DISPLAY_MESSAGE_KEYS['unsupported-environment'],
        { name: boundedDisplayName(name) || '?' },
        beginToken.offset,
        group.end,
      );
      return makeNode('mtext', { text: `\\begin{${name}}` });
    }

    const rows: MathNode[] = [];
    let guard = 0;
    while (!this.atCommand('end') && this.peek().kind !== 'eof' && guard < 500) {
      guard += 1;
      const cells: MathNode[] = [];
      for (;;) {
        const body = this.parseRow({ chars: new Set(['&']), commands: new Set(['end']), newline: true });
        cells.push(makeNode('mtd', { attrs: { columnalign: 'left' }, children: body }));
        if (!this.atPunct('&')) break;
        this.take();
      }
      rows.push(makeNode('mtr', { children: cells }));

      if (this.peek().kind === 'newline') {
        this.take();
        continue;
      }
      if (this.atCommand('end')) break;
      if (this.peek().kind === 'eof') break;
      this.take();
    }
    if (this.atCommand('end')) {
      this.take();
      this.readRawGroupInfo();
    }

    const table = makeNode('mtable', {
      attrs: { columnalign: 'left', columnspacing: '1em' },
      children: rows,
    });
    return makeNode('mrow', {
      children: [
        moNode('{', { fence: 'true', stretchy: 'true' }),
        table,
      ],
    });
  }

  private applyScripts(base: MathNode): MathNode {
    let sub: MathNode | null = null;
    let sup: MathNode | null = null;
    let changed = false;
    for (;;) {
      if (this.atPunct('^')) {
        this.take();
        sup = this.parseScriptArgument();
        changed = true;
        continue;
      }
      if (this.atPunct('_')) {
        this.take();
        sub = this.parseScriptArgument();
        changed = true;
        continue;
      }
      break;
    }
    if (!changed) return base;
    if (sub !== null && sup !== null) return makeNode('msubsup', { children: [base, sub, sup] });
    if (sup !== null) return makeNode('msup', { children: [base, sup] });
    return makeNode('msub', { children: [base, sub!] });
  }

  private parseScriptArgument(): MathNode {
    if (this.atPunct('{')) return this.parseBraceGroup();
    if (this.atPunct('+') || this.atPunct('-')) {
      const token = this.take();
      return makeNode('mrow', { children: [moNode(token.value), this.parseAtom()] });
    }
    return this.parseAtom();
  }

  private readRawGroupInfo(): RawGroup {
    const open = this.peek();
    if (!this.atPunct('{')) {
      return { text: '', present: false, terminated: false, start: open.offset, end: open.offset };
    }
    this.take();
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
      this.pos = index;
      return {
        text: this.source.slice(open.offset + 1),
        present: true,
        terminated: false,
        start: open.offset,
        end: this.source.length,
      };
    }
    const close = this.tokens[index];
    this.pos = index + 1;
    return {
      text: this.source.slice(open.offset + 1, close.offset),
      present: true,
      terminated: true,
      start: open.offset,
      end: close.end,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Bounded literal text used when the whole formula cannot be rendered. */
export function boundedLocalMathLiteral(source: string): string {
  return source.length > MAX_LOCAL_MATH_DISPLAY_FALLBACK
    ? `${source.slice(0, MAX_LOCAL_MATH_DISPLAY_FALLBACK)}…`
    : source;
}

/**
 * Parse the formula body once for both rendering and diagnostics.
 *
 * `node === null` means the renderer must fall back to bounded literal text;
 * `issues` then contains exactly one budget or syntax issue.
 */
export function parseLocalMathDisplay(source: string): LocalMathDisplayParse {
  if (source.length > MAX_LOCAL_MATH_DISPLAY_SOURCE) {
    return {
      node: null,
      issues: [budgetIssue(source.length, 'source', MAX_LOCAL_MATH_DISPLAY_SOURCE, 0, source.length)],
    };
  }
  try {
    const parser = new MathDisplayParser(source);
    return { node: parser.parse(), issues: parser.issues };
  } catch (error) {
    if (error instanceof MathDisplayBudget) {
      return {
        node: null,
        issues: [budgetIssue(source.length, error.kind, error.limit, error.offset, error.offset + 1)],
      };
    }
    return {
      node: null,
      issues: [
        makeIssue(source.length, 'syntax', MATH_DISPLAY_MESSAGE_KEYS.syntax, undefined, 0, source.length),
      ],
    };
  }
}

/**
 * Report every construct that the display renderer degrades to literal text.
 *
 * Offsets are relative to the formula body (`LocalNode.value`). Compute-only
 * limitations (for example `\int` in `<plot>`) are intentionally not reported:
 * they do not affect display.
 */
export function inspectLocalMathDisplay(source: string): LocalMathDisplayIssue[] {
  return parseLocalMathDisplay(source).issues;
}
