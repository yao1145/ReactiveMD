/**
 * KaTeX-backed display for local LaTeX.
 *
 * This module owns the single rendering and diagnostic implementation used by
 * the React view (`math-view.tsx`) and by compile-time display diagnostics. It
 * stays React-free so the compiler can inspect formulas without importing the
 * renderer.
 *
 * Rendering never throws. The source is pre-scanned against resource budgets
 * and forbidden author commands, then typeset by KaTeX. Any failure falls back
 * to bounded literal text and produces a source-ranged issue, so "shown as
 * literal text" and "reported as a warning" stay in sync.
 */

import type { LocalDiagnosticParams } from './types';
import { renderLocalDiagnostic } from './diagnostics';
import katex from 'katex';
import 'katex/contrib/mhchem';

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

/** Result of typesetting one formula; `html === null` means literal fallback. */
export interface LocalMathDisplayRender {
  /** KaTeX `htmlAndMathml` markup, or `null` when the formula must fall back. */
  html: string | null;
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
/* Limits and forbidden constructs                                    */
/* ------------------------------------------------------------------ */

export const MAX_LOCAL_MATH_DISPLAY_SOURCE = 50_000;
export const MAX_LOCAL_MATH_DISPLAY_TOKENS = 20_000;
export const MAX_LOCAL_MATH_DISPLAY_DEPTH = 120;
export const MAX_LOCAL_MATH_DISPLAY_FALLBACK = 2_000;

const MAX_LOCAL_MATH_DISPLAY_ISSUES = 50;
const MAX_DISPLAY_NAME = 64;
const MAX_KATEX_EXPANSIONS = 1_000;
/** Cap user sizes such as `\rule{500em}{500em}`. */
const MAX_KATEX_SIZE = 20;

/**
 * Author macro definitions and HTML/URL/file access stay forbidden. KaTeX
 * either accepts or silently degrades some of these, so both the diagnostics
 * and the rendered output must reject them before typesetting.
 */
const FORBIDDEN_COMMANDS = new Set([
  // Macro definitions and global state.
  'def', 'gdef', 'edef', 'xdef', 'let', 'futurelet', 'global',
  'newcommand', 'renewcommand', 'providecommand',
  'newenvironment', 'renewenvironment',
  'csname', 'endcsname', 'expandafter', 'noexpand',
  'long', 'outer', 'protected',
  'catcode', 'makeatletter', 'makeatother',
  'chardef', 'mathchardef', 'countdef', 'dimendef', 'skipdef', 'toksdef',
  'newcount', 'newdimen', 'newskip', 'newtoks', 'newbox', 'newif',
  // HTML, URLs and files.
  'href', 'url', 'includegraphics',
  'htmlClass', 'htmlId', 'htmlStyle', 'htmlData',
  'input', 'include', 'includeonly',
  'openin', 'openout', 'read', 'write', 'immediate',
  'special', 'shipout',
]);

/**
 * Commands that consume a following argument. A long run of these without a
 * brace group (for example `\sqrt\sqrt\sqrt…`) nests in the parser even though
 * there are no braces, so it must share the nesting budget.
 */
const RECURSIVE_ARGUMENT_COMMANDS = new Set([
  'sqrt', 'frac', 'dfrac', 'tfrac', 'binom', 'dbinom', 'tbinom',
  'overline', 'underline', 'hat', 'tilde', 'vec', 'dot', 'ddot',
  'overrightarrow', 'overleftarrow', 'widehat', 'widetilde',
  'overbrace', 'underbrace', 'boxed', 'pmod', 'not',
  'overset', 'stackrel', 'underset',
  'xrightarrow', 'xleftarrow', 'xrightleftharpoons', 'xleftrightharpoons',
  'xleftrightarrow', 'mathchoice',
  'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathbb', 'mathcal', 'mathscr',
  'mathfrak', 'mathnormal', 'operatorname',
  'text', 'textrm', 'mbox', 'textbf', 'textit', 'textsf', 'texttt',
  'phantom', 'hphantom', 'vphantom', 'smash', 'llap', 'rlap',
  'raisebox', 'rule', 'kern', 'mkern', 'mskip', 'raise', 'lower',
  'color', 'textcolor', 'fcolorbox',
  'ce', 'pu',
]);

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

function boundedDisplayName(name: string): string {
  return name.length > MAX_DISPLAY_NAME ? `${name.slice(0, MAX_DISPLAY_NAME - 1)}…` : name;
}

/* ------------------------------------------------------------------ */
/* Pre-scan: token budget, brace depth and unusual constructs          */
/* ------------------------------------------------------------------ */

type TokenKind = 'number' | 'letter' | 'command' | 'punct' | 'newline' | 'eof';

interface ScanToken {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}

interface SourceRange {
  start: number;
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

/**
 * Tokenize for budgeting only. Comments and whitespace never become tokens, and
 * escaped braces stay commands, so they cannot inflate the nesting depth.
 */
function tokenize(source: string): ScanToken[] {
  const tokens: ScanToken[] = [];
  const push = (token: ScanToken): void => {
    if (tokens.length >= MAX_LOCAL_MATH_DISPLAY_TOKENS) {
      throw new MathDisplayBudget('tokens', MAX_LOCAL_MATH_DISPLAY_TOKENS, token.start);
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
        push({ kind: 'command', value: '\\', start: i, end: i + 1 });
        i += 1;
        continue;
      }
      const next = source[i + 1];
      if (next === '\\') {
        push({ kind: 'newline', value: '\\\\', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      if (/[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1;
        push({ kind: 'command', value: source.slice(i + 1, j), start: i, end: j });
        i = j;
        continue;
      }
      push({ kind: 'command', value: next, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const match = /^\d+(?:\.\d*)?/.exec(source.slice(i))!;
      push({ kind: 'number', value: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }
    if (ch === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(i))!;
      push({ kind: 'number', value: match[0], start: i, end: i + match[0].length });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      push({ kind: 'letter', value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    push({ kind: 'punct', value: ch, start: i, end: i + 1 });
    i += 1;
  }
  push({ kind: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}

interface EnvironmentNameGroup {
  name: string;
  groupEnd: number;
  terminated: boolean;
}

function readEnvironmentName(
  tokens: ScanToken[],
  source: string,
  index: number,
): EnvironmentNameGroup | null {
  const open = tokens[index];
  if (!open || open.kind !== 'punct' || open.value !== '{') return null;
  let depth = 1;
  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === 'eof') break;
    if (token.kind !== 'punct') continue;
    if (token.value === '{') {
      depth += 1;
    } else if (token.value === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          name: source.slice(open.end, token.start).trim(),
          groupEnd: token.end,
          terminated: true,
        };
      }
    }
  }
  return {
    name: source.slice(open.end).trim(),
    groupEnd: source.length,
    terminated: false,
  };
}

interface ScannedEnvironment {
  name: string;
  start: number;
  groupEnd: number;
}

interface ScanResult {
  issues: LocalMathDisplayIssue[];
  commands: Map<string, SourceRange[]>;
  environments: ScannedEnvironment[];
}

function scanSource(source: string): ScanResult {
  const tokens = tokenize(source);
  const issues: LocalMathDisplayIssue[] = [];
  const commands = new Map<string, SourceRange[]>();
  const environments: ScannedEnvironment[] = [];
  const openEnvironments: ScannedEnvironment[] = [];
  let braceDepth = 0;
  let delimiterDepth = 0;
  let recursiveRun = 0;
  let previousRecursive = false;

  const checkDepth = (offset: number): void => {
    if (braceDepth + delimiterDepth + openEnvironments.length + recursiveRun > MAX_LOCAL_MATH_DISPLAY_DEPTH) {
      throw new MathDisplayBudget('depth', MAX_LOCAL_MATH_DISPLAY_DEPTH, offset);
    }
  };

  const report = (
    reason: LocalMathDisplayIssueReason,
    messageKey: string,
    params: LocalDiagnosticParams | undefined,
    start: number,
    end: number,
  ): void => {
    if (issues.length >= MAX_LOCAL_MATH_DISPLAY_ISSUES) return;
    issues.push(makeIssue(source.length, reason, messageKey, params, start, end));
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === 'eof') break;

    if (token.kind === 'command') {
      const name = token.value;
      const ranges = commands.get(name);
      if (ranges) ranges.push({ start: token.start, end: token.end });
      else commands.set(name, [{ start: token.start, end: token.end }]);

      if (FORBIDDEN_COMMANDS.has(name)) {
        report(
          'unsupported-command',
          MATH_DISPLAY_MESSAGE_KEYS['unsupported-command'],
          { name: boundedDisplayName(name) },
          token.start,
          token.end,
        );
      }

      if (name === 'left') {
        delimiterDepth += 1;
        checkDepth(token.start);
      } else if (name === 'right') {
        delimiterDepth = Math.max(0, delimiterDepth - 1);
      }

      if (name === 'begin' || name === 'end') {
        const group = readEnvironmentName(tokens, source, index + 1);
        if (name === 'begin') {
          if (!group) {
            report(
              'syntax',
              MATH_DISPLAY_MESSAGE_KEYS['environment-missing-name'],
              undefined,
              token.start,
              token.end,
            );
          } else if (!group.terminated) {
            report(
              'syntax',
              MATH_DISPLAY_MESSAGE_KEYS['environment-unclosed'],
              { name: boundedDisplayName(group.name) || '?' },
              token.start,
              group.groupEnd,
            );
          } else if (!group.name) {
            report(
              'syntax',
              MATH_DISPLAY_MESSAGE_KEYS['environment-missing-name'],
              undefined,
              token.start,
              group.groupEnd,
            );
          } else {
            const environment = { name: group.name, start: token.start, groupEnd: group.groupEnd };
            environments.push(environment);
            openEnvironments.push(environment);
            checkDepth(token.start);
          }
        } else if (!group || !group.terminated || !group.name) {
          report(
            'syntax',
            MATH_DISPLAY_MESSAGE_KEYS['stray-end'],
            undefined,
            token.start,
            group?.groupEnd ?? token.end,
          );
        } else if (openEnvironments.length === 0) {
          report(
            'syntax',
            MATH_DISPLAY_MESSAGE_KEYS['stray-end'],
            undefined,
            token.start,
            group.groupEnd,
          );
        } else {
          const open = openEnvironments.pop()!;
          if (open.name !== group.name) {
            report(
              'syntax',
              MATH_DISPLAY_MESSAGE_KEYS.syntax,
              undefined,
              token.start,
              group.groupEnd,
            );
          }
        }
        // Keep scanning the name group: commands inside it are still executed
        // by KaTeX while it parses the environment argument.
        recursiveRun = 0;
        previousRecursive = false;
        continue;
      }

      if (RECURSIVE_ARGUMENT_COMMANDS.has(name)) {
        recursiveRun = previousRecursive ? recursiveRun + 1 : 1;
        checkDepth(token.start);
        previousRecursive = true;
      } else {
        recursiveRun = 0;
        previousRecursive = false;
      }
      continue;
    }

    if (token.kind === 'punct') {
      if (token.value === '{') {
        braceDepth += 1;
        checkDepth(token.start);
      } else if (token.value === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }
    recursiveRun = 0;
    previousRecursive = false;
  }

  for (const environment of openEnvironments) {
    report(
      'syntax',
      MATH_DISPLAY_MESSAGE_KEYS['environment-unclosed'],
      { name: boundedDisplayName(environment.name) },
      environment.start,
      environment.groupEnd,
    );
  }

  issues.sort((a, b) => a.start - b.start || a.end - b.end);
  return { issues, commands, environments };
}

/* ------------------------------------------------------------------ */
/* KaTeX error mapping                                                 */
/* ------------------------------------------------------------------ */

interface ErrorDetails {
  position?: number;
  length?: number;
  rawMessage?: string;
  message?: string;
}

function readErrorDetails(error: unknown): ErrorDetails {
  if (typeof error !== 'object' || error === null) return {};
  const value = error as Record<string, unknown>;
  const details: ErrorDetails = {};
  if (typeof value.position === 'number' && Number.isFinite(value.position)) details.position = value.position;
  if (typeof value.length === 'number' && Number.isFinite(value.length)) details.length = value.length;
  if (typeof value.rawMessage === 'string') details.rawMessage = value.rawMessage;
  if (typeof value.message === 'string') details.message = value.message;
  return details;
}

function rangeFromError(sourceLength: number, details: ErrorDetails): SourceRange {
  if (details.position !== undefined) {
    const length = details.length !== undefined && details.length > 0 ? details.length : 1;
    return clampRange(sourceLength, details.position, details.position + length);
  }
  return { start: 0, end: sourceLength };
}

function findCommandRange(
  scan: ScanResult,
  name: string,
  position?: number,
): SourceRange | null {
  const ranges = scan.commands.get(name);
  if (!ranges || ranges.length === 0) return null;
  if (position !== undefined) {
    const exact = ranges.find(range => range.start === position);
    if (exact) return exact;
    const after = ranges.find(range => range.start >= position);
    if (after) return after;
  }
  return ranges[0];
}

function findEnvironmentRange(
  scan: ScanResult,
  name: string,
  position?: number,
): SourceRange | null {
  let match: ScannedEnvironment | null = null;
  for (const environment of scan.environments) {
    if (environment.name !== name) continue;
    if (position === undefined || environment.start <= position) match = environment;
    else if (!match) match = environment;
  }
  return match ? { start: match.start, end: match.groupEnd } : null;
}

function issueFromRenderError(
  source: string,
  scan: ScanResult,
  error: unknown,
): LocalMathDisplayIssue {
  const details = readErrorDetails(error);
  const raw = details.rawMessage ?? details.message ?? '';

  const commandMatch = /Undefined control sequence: (\\\S+)/.exec(raw);
  if (commandMatch) {
    const name = boundedDisplayName(commandMatch[1].slice(1));
    const range = findCommandRange(scan, name, details.position)
      ?? rangeFromError(source.length, details);
    return makeIssue(
      source.length,
      'unsupported-command',
      MATH_DISPLAY_MESSAGE_KEYS['unsupported-command'],
      { name },
      range.start,
      range.end,
    );
  }

  const environmentMatch = /No such environment: (.+)$/.exec(raw);
  if (environmentMatch) {
    const name = boundedDisplayName(environmentMatch[1].trim());
    const range = findEnvironmentRange(scan, name, details.position)
      ?? rangeFromError(source.length, details);
    return makeIssue(
      source.length,
      'unsupported-environment',
      MATH_DISPLAY_MESSAGE_KEYS['unsupported-environment'],
      { name },
      range.start,
      range.end,
    );
  }

  if (/Too many expansions/i.test(raw)) {
    const range = rangeFromError(source.length, details);
    return budgetIssue(source.length, 'tokens', MAX_KATEX_EXPANSIONS, range.start, range.end);
  }

  const range = /\\tag works only in display/.test(raw)
    ? findCommandRange(scan, 'tag', details.position) ?? rangeFromError(source.length, details)
    : rangeFromError(source.length, details);
  return makeIssue(
    source.length,
    'syntax',
    MATH_DISPLAY_MESSAGE_KEYS.syntax,
    undefined,
    range.start,
    range.end,
  );
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
 * Typeset one formula body with KaTeX, using HTML plus hidden MathML.
 *
 * `html === null` means the caller must show bounded literal text; `issues`
 * then explains why. The pre-scan rejects author macros, HTML/URL/file access
 * and budget overruns before KaTeX runs. KaTeX itself runs with
 * `trust: false`, `throwOnError: true`, a bounded expansion count and a fresh
 * macro table for every formula.
 */
export function renderLocalMathDisplay(source: string, display = false): LocalMathDisplayRender {
  if (source.length > MAX_LOCAL_MATH_DISPLAY_SOURCE) {
    return {
      html: null,
      issues: [budgetIssue(source.length, 'source', MAX_LOCAL_MATH_DISPLAY_SOURCE, 0, source.length)],
    };
  }

  let scan: ScanResult;
  try {
    scan = scanSource(source);
  } catch (error) {
    if (error instanceof MathDisplayBudget) {
      return {
        html: null,
        issues: [budgetIssue(source.length, error.kind, error.limit, error.offset, error.offset + 1)],
      };
    }
    return {
      html: null,
      issues: [makeIssue(source.length, 'syntax', MATH_DISPLAY_MESSAGE_KEYS.syntax, undefined, 0, source.length)],
    };
  }

  if (scan.issues.length > 0) return { html: null, issues: scan.issues };

  try {
    const html = katex.renderToString(source, {
      displayMode: display,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      maxExpand: MAX_KATEX_EXPANSIONS,
      maxSize: MAX_KATEX_SIZE,
      macros: {},
    });
    return { html, issues: [] };
  } catch (error) {
    return { html: null, issues: [issueFromRenderError(source, scan, error)] };
  }
}

/**
 * Report every construct that the display renderer degrades to literal text.
 *
 * Offsets are relative to the formula body (`LocalNode.value`). Compute-only
 * limitations (for example `\int` in `<plot>`) are intentionally not reported:
 * they do not affect display.
 */
export function inspectLocalMathDisplay(source: string, display = true): LocalMathDisplayIssue[] {
  return renderLocalMathDisplay(source, display).issues;
}
