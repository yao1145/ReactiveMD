import { createElement, type ReactElement, type ReactNode } from 'react';

/**
 * Safe native MathML rendering for local LaTeX.
 *
 * The renderer never interprets HTML, styles, macros, files or links from the
 * source. Unknown commands are shown as literal text, so a formula that cannot
 * be computed still remains readable. All source text passes through React as
 * text nodes.
 */

export interface LatexViewProps {
  source: string;
  display?: boolean;
}

type MathProps = Record<string, unknown> | null;

const element = (tag: string, props: MathProps, ...children: ReactNode[]): ReactElement =>
  (createElement as unknown as (
    type: string,
    props?: MathProps,
    ...children: ReactNode[]
  ) => ReactElement)(tag, props, ...children);

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

type TokenKind = 'number' | 'letter' | 'command' | 'punct' | 'newline' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  offset: number;
}

const SPECIAL_COMMANDS: Record<string, string> = {
  ' ': 'space', ',': 'thinspace', ':': 'medspace', ';': 'thickspace', '!': 'negthinspace',
  '{': 'lbrace', '}': 'rbrace', '|': 'vert', '%': 'percent', '&': 'amp',
  '#': 'hash', '_': 'underscore', '$': 'dollar',
};

const MAX_SOURCE = 50_000;
const MAX_TOKENS = 20_000;
const MAX_DEPTH = 120;
const MAX_FALLBACK = 2_000;

function boundedLiteral(source: string): string {
  return source.length > MAX_FALLBACK ? `${source.slice(0, MAX_FALLBACK)}…` : source;
}

function tokenize(source: string): Token[] {
  if (source.length > MAX_SOURCE) {
    throw new Error('Math source exceeds the length limit.');
  }
  const tokens: Token[] = [];
  const push = (token: Token): void => {
    if (tokens.length >= MAX_TOKENS) {
      throw new Error('Math input contains too many tokens.');
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
        push({ kind: 'command', value: 'backslash', offset: i });
        i += 1;
        continue;
      }
      const next = source[i + 1];
      if (next === '\\') {
        push({ kind: 'newline', value: '\\\\', offset: i });
        i += 2;
        continue;
      }
      if (/[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1;
        push({ kind: 'command', value: source.slice(i + 1, j), offset: i });
        i = j;
        continue;
      }
      const special = Object.hasOwn(SPECIAL_COMMANDS, next) ? SPECIAL_COMMANDS[next] : next;
      push({ kind: 'command', value: special, offset: i });
      i += 2;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const match = /^\d+(?:\.\d*)?/.exec(source.slice(i))!;
      push({ kind: 'number', value: match[0], offset: i });
      i += match[0].length;
      continue;
    }
    if (ch === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(i))!;
      push({ kind: 'number', value: match[0], offset: i });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      push({ kind: 'letter', value: ch, offset: i });
      i += 1;
      continue;
    }
    push({ kind: 'punct', value: ch, offset: i });
    i += 1;
  }
  push({ kind: 'eof', value: '', offset: source.length });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Symbol tables                                                       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

interface Stop {
  chars?: Set<string>;
  commands?: Set<string>;
  newline?: boolean;
}

class MathRenderer {
  private tokens: Token[];
  private pos = 0;
  private source: string;
  private depth = 0;

  constructor(source: string) {
    this.source = source;
    this.tokens = tokenize(source);
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      this.depth -= 1;
      throw new Error('Formula is nested too deeply.');
    }
  }

  private leave(): void {
    this.depth -= 1;
  }

  render(): ReactNode {
    const body = this.parseRow({});
    return body.length === 1 ? body[0] : element('mrow', null, ...body);
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

  private parseRow(stop: Stop): ReactNode[] {
    this.enter();
    try {
      const output: ReactNode[] = [];
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

  private parseAtom(): ReactNode {
    this.enter();
    try {
      return this.parseAtomBody();
    } finally {
      this.leave();
    }
  }

  private parseAtomBody(): ReactNode {
    const token = this.peek();
    let base: ReactNode;

    if (token.kind === 'number') {
      this.take();
      base = element('mn', null, token.value);
    } else if (token.kind === 'letter') {
      this.take();
      base = element('mi', null, token.value);
    } else if (token.kind === 'punct') {
      base = this.parsePunctuation(token);
    } else if (token.kind === 'newline') {
      this.take();
      base = element('mspace', { linebreak: 'newline' });
    } else if (token.kind === 'command') {
      base = this.parseCommand(token);
    } else {
      this.take();
      base = element('mtext', null, '');
    }

    return this.applyScripts(base);
  }

  private parsePunctuation(token: Token): ReactNode {
    this.take();
    if (token.value === '{') {
      this.pos -= 1;
      return this.parseBraceGroup();
    }
    if (token.value === '}' || token.value === '&' || token.value === '#') {
      return element('mo', null, token.value);
    }
    const fences = token.value === '(' || token.value === ')' || token.value === '['
      || token.value === ']' || token.value === '|';
    return element('mo', fences ? { fence: 'true', stretchy: 'true' } : null, token.value);
  }

  private parseCommand(token: Token): ReactNode {
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
      return close ?? element('mrow', null);
    }
    if (name === 'begin') {
      this.take();
      return this.parseEnvironment();
    }
    if (name === 'end') {
      this.take();
      this.readRawGroup();
      return element('mtext', null, '\\end');
    }
    if (name === 'text' || name === 'textrm' || name === 'mbox' || name === 'operatorname') {
      this.take();
      const raw = this.readRawGroup();
      return element('mtext', null, raw);
    }
    if (name === 'mathrm' || name === 'mathbf' || name === 'mathit' || name === 'mathsf') {
      this.take();
      const raw = this.readRawGroup();
      const variant = name === 'mathrm' ? 'normal' : name === 'mathbf' ? 'bold'
        : name === 'mathit' ? 'italic' : 'sans-serif';
      return element('mtext', { mathvariant: variant }, raw);
    }
    if (name === 'overline' || name === 'bar' || name === 'hat' || name === 'tilde'
      || name === 'vec' || name === 'dot' || name === 'ddot') {
      this.take();
      const base = this.parseRequiredArgument();
      const accent = name === 'overline' || name === 'bar' ? '¯'
        : name === 'hat' ? '^'
          : name === 'tilde' ? '~'
            : name === 'vec' ? '→'
              : name === 'dot' ? '˙' : '¨';
      return element('mover', { accent: 'true' }, base, element('mo', { stretchy: 'true' }, accent));
    }
    if (IGNORED_COMMANDS.has(name)) {
      this.take();
      return element('mrow', null);
    }
    if (Object.hasOwn(SPACES, name)) {
      this.take();
      return element('mspace', { width: SPACES[name] });
    }
    if (FUNCTIONS.has(name)) {
      this.take();
      return element('mo', { mathvariant: 'normal', form: 'prefix' }, name);
    }
    if (Object.hasOwn(GREEK, name)) {
      this.take();
      return element('mi', null, GREEK[name]);
    }
    if (Object.hasOwn(OPERATORS, name)) {
      this.take();
      const char = OPERATORS[name];
      const fences = char === '(' || char === ')' || char === '[' || char === ']'
        || char === '{' || char === '}' || char === '|' || char === '‖'
        || char === '⟨' || char === '⟩';
      return element('mo', fences ? { fence: 'true', stretchy: 'true' } : null, char);
    }

    this.take();
    return element('mtext', null, `\\${name}`);
  }

  private parseBraceGroup(): ReactNode {
    if (!this.atPunct('{')) return element('mrow', null);
    this.take();
    const body = this.parseRow({ chars: new Set(['}']) });
    if (this.atPunct('}')) this.take();
    return element('mrow', null, ...body);
  }

  private parseFraction(): ReactNode {
    const numerator = this.parseRequiredArgument();
    const denominator = this.parseRequiredArgument();
    return element('mfrac', null, numerator, denominator);
  }

  private parseRoot(): ReactNode {
    let index: ReactNode | null = null;
    if (this.atPunct('[')) {
      this.take();
      const body = this.parseRow({ chars: new Set([']']) });
      if (this.atPunct(']')) this.take();
      index = element('mrow', null, ...body);
    }
    const value = this.parseRequiredArgument();
    return index ? element('mroot', null, value, index) : element('msqrt', null, value);
  }

  private parseRequiredArgument(): ReactNode {
    if (this.atPunct('{')) return this.parseBraceGroup();
    return this.parseAtom();
  }

  private parseLeft(): ReactNode {
    const open = this.readDelimiter();
    const body = this.parseRow({ commands: new Set(['right']) });
    let close: ReactNode | null = null;
    if (this.atCommand('right')) {
      this.take();
      close = this.readDelimiter();
    }
    if (!open && !close) return element('mrow', null, ...body);
    return element('mrow', null, open, ...body, close);
  }

  private readDelimiter(): ReactNode | null {
    const token = this.peek();
    if (token.kind === 'punct') {
      if (token.value === '.') {
        this.take();
        return null;
      }
      if ('()[]|'.includes(token.value)) {
        this.take();
        return element('mo', { fence: 'true', stretchy: 'true' }, token.value);
      }
      return null;
    }
    if (token.kind === 'command') {
      const map: Record<string, string> = {
        lbrace: '{', rbrace: '}', lvert: '|', rvert: '|', vert: '|',
        lVert: '‖', rVert: '‖', Vert: '‖', langle: '⟨', rangle: '⟩',
      };
      const char = Object.hasOwn(map, token.value) ? map[token.value] : undefined;
      if (char) {
        this.take();
        return element('mo', { fence: 'true', stretchy: 'true' }, char);
      }
    }
    return null;
  }

  private parseEnvironment(): ReactNode {
    const name = this.readRawGroup().trim();
    if (name !== 'cases') {
      return element('mtext', null, `\\begin{${name}}`);
    }

    const rows: ReactNode[] = [];
    let guard = 0;
    while (!this.atCommand('end') && this.peek().kind !== 'eof' && guard < 500) {
      guard += 1;
      const cells: ReactNode[] = [];
      for (;;) {
        const body = this.parseRow({ chars: new Set(['&']), commands: new Set(['end']), newline: true });
        cells.push(element('mtd', { columnalign: 'left' }, ...body));
        if (!this.atPunct('&')) break;
        this.take();
      }
      rows.push(element('mtr', null, ...cells));

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
      this.readRawGroup();
    }

    const table = element('mtable', { columnalign: 'left', columnspacing: '1em' }, ...rows);
    return element(
      'mrow',
      null,
      element('mo', { fence: 'true', stretchy: 'true' }, '{'),
      table,
    );
  }

  private applyScripts(base: ReactNode): ReactNode {
    let sub: ReactNode | null = null;
    let sup: ReactNode | null = null;
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
    if (sub !== null && sup !== null) return element('msubsup', null, base, sub, sup);
    if (sup !== null) return element('msup', null, base, sup);
    return element('msub', null, base, sub);
  }

  private parseScriptArgument(): ReactNode {
    if (this.atPunct('{')) return this.parseBraceGroup();
    if (this.atPunct('+') || this.atPunct('-')) {
      const token = this.take();
      return element('mrow', null, element('mo', null, token.value), this.parseAtom());
    }
    return this.parseAtom();
  }

  private readRawGroup(): string {
    if (!this.atPunct('{')) return '';
    const open = this.take();
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
      return this.source.slice(open.offset + 1);
    }
    const close = this.tokens[index];
    this.pos = index + 1;
    return this.source.slice(open.offset + 1, close.offset);
  }
}

/* ------------------------------------------------------------------ */
/* Public component                                                    */
/* ------------------------------------------------------------------ */

export function LatexView({ source, display = false }: LatexViewProps): ReactElement {
  const literal = boundedLiteral(source);
  let body: ReactNode;
  if (source.length > MAX_SOURCE) {
    body = element('mtext', null, literal);
  } else {
    try {
      body = new MathRenderer(source).render();
    } catch {
      body = element('mtext', null, literal);
    }
  }
  const annotation = source.length > MAX_FALLBACK ? literal : source;
  return element(
    'math',
    {
      display: display ? 'block' : 'inline',
      className: display ? 'local-math local-math-block' : 'local-math',
      'aria-label': annotation,
    },
    element(
      'semantics',
      null,
      element('mrow', null, body),
      element('annotation', { encoding: 'application/x-tex' }, annotation),
    ),
  );
}
