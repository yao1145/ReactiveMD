import type { LocalValue, SourceRange } from '../types';
import { LatexError, LatexParser, lex, MAX_EVAL_STEPS, MAX_SOURCE } from './math-syntax';
import { evaluateAst, type Evaluation } from './math-evaluation';

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
  /** Parameter value for parametric curves; absent for explicit and implicit curves. */
  t?: number;
  /** Angle in radians for polar curves. */
  theta?: number;
}

export interface PlotSample {
  points: PlotPoint[];
  endpoint: number | null;
}

/** A point on an implicit contour; both coordinates are defined. */
export interface PlotSegmentPoint {
  x: number;
  y: number;
}

/** One formula block inside a plot, ready for sampling. */
export type PlotFormulaKind = 'explicit' | 'parametric' | 'polar' | 'implicit';

export interface CompiledPlotFormula {
  kind: PlotFormulaKind;
  source: string;
  /** Explicit y(x), parametric x(t), polar r(theta), or implicit F(x, y). */
  expression: LatexExpression;
  /** Parametric y(t); null for the other kinds. */
  yExpression: LatexExpression | null;
  /** Document parameters only; each curve's independent variables are removed. */
  dependencies: string[];
}

export type Relation = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';

export type CallName = 'sin' | 'cos' | 'tan' | 'arcsin' | 'arccos' | 'arctan'
  | 'exp' | 'ln' | 'log' | 'min' | 'max' | 'sqrt';

export interface When {
  op: Relation;
  left: Ast;
  right: Ast;
}

export interface CaseBranch {
  value: Ast;
  when: When | null;
}

export type Ast =
  | { kind: 'number'; value: number; offset: number }
  | { kind: 'constant'; value: 'pi' | 'e'; offset: number }
  | { kind: 'variable'; name: string; offset: number }
  | { kind: 'unary'; op: '-' | '+'; operand: Ast; offset: number }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Ast; right: Ast; offset: number }
  | { kind: 'abs'; value: Ast; offset: number }
  | { kind: 'call'; name: CallName; args: Ast[]; base: Ast | null; power: Ast | null; offset: number }
  | { kind: 'cases'; branches: CaseBranch[]; offset: number };

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

function collectAstReferences(
  source: string,
  ast: Ast,
  baseOffset: number,
  skip: ReadonlySet<string>,
): { name: string; range: SourceRange }[] {
  const references: { name: string; range: SourceRange }[] = [];
  const visit = (node: Ast): void => {
    switch (node.kind) {
      case 'variable': {
        if (skip.has(node.name)) return;
        const start = baseOffset + node.offset;
        let end = start + 1;
        if (source.startsWith('\\mathrm', node.offset)) end = baseOffset + source.indexOf('}', node.offset) + 1;
        else if (source[node.offset] === '\\') end = start + 1 + node.name.length;
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
  return references;
}

/** Internal authoring support: only AST variable nodes represent plot reads. */
export function localLatexReferences(source: string): { name: string; range: SourceRange }[] {
  // Apply the same source and syntax budgets as evaluation before traversing.
  const trimmed = source.trim();
  const leading = source.length - source.trimStart().length;

  if (plotFormulaKind(trimmed) === 'polar') {
    compilePlotFormula(trimmed);
    const { right } = new LatexParser(trimmed, lex(trimmed), { allowY: true }).parseEquation();
    return collectAstReferences(trimmed, right, leading, new Set(['theta']))
      .sort((a, b) => a.range.start - b.range.start);
  }

  const parametric = readParametricCases(trimmed);
  if (parametric) {
    const skip = new Set(['x', 'y', 't']);
    const references: { name: string; range: SourceRange }[] = [];
    for (const branch of [
      { text: parametric.x, offset: parametric.xOffset },
      { text: parametric.y, offset: parametric.yOffset },
    ]) {
      compileLatex(branch.text);
      const ast = new LatexParser(branch.text, lex(branch.text)).parseDocument();
      references.push(...collectAstReferences(branch.text, ast, leading + branch.offset, skip));
    }
    return references.sort((a, b) => a.range.start - b.range.start);
  }

  try {
    const ast = new LatexParser(source, lex(source)).parseDocument();
    return collectAstReferences(source, ast, 0, new Set(['x', 'y']))
      .sort((a, b) => a.range.start - b.range.start);
  } catch (explicitError) {
    try {
      const equation = new LatexParser(source, lex(source), { allowY: true }).parseEquation();
      const skip = new Set(['x', 'y']);
      const references = [
        ...collectAstReferences(source, equation.left, 0, skip),
        ...collectAstReferences(source, equation.right, 0, skip),
      ];
      return references.sort((a, b) => a.range.start - b.range.start);
    } catch {
      throw explicitError;
    }
  }
}

const cache = new Map<string, LatexExpression>();

function buildExpression(source: string, ast: Ast, dependencies: string[]): LatexExpression {
  return {
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
}

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
  const expression = buildExpression(source, ast, [...found]);

  if (cache.size >= 512) cache.clear();
  cache.set(source, expression);
  return expression;
}

function astContainsVariable(node: Ast, name: string): boolean {
  switch (node.kind) {
    case 'variable':
      return node.name === name;
    case 'number':
    case 'constant':
      return false;
    case 'unary':
      return astContainsVariable(node.operand, name);
    case 'binary':
      return astContainsVariable(node.left, name) || astContainsVariable(node.right, name);
    case 'abs':
      return astContainsVariable(node.value, name);
    case 'call':
      return (node.base !== null && astContainsVariable(node.base, name))
        || (node.power !== null && astContainsVariable(node.power, name))
        || node.args.some((arg) => astContainsVariable(arg, name));
    case 'cases':
      return node.branches.some((branch) =>
        astContainsVariable(branch.value, name)
        || (branch.when !== null
          && (astContainsVariable(branch.when.left, name) || astContainsVariable(branch.when.right, name))));
  }
}

function isVariableNode(node: Ast, name: string): boolean {
  return node.kind === 'variable' && node.name === name;
}

/** Finds an "=" outside braces and nested groups. */
function topLevelEquals(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '{') depth += 1;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (character === '=' && depth === 0) return index;
  }
  return -1;
}

/** Splits a cases body on top-level LaTeX row breaks (`\\`). */
function splitCasesRows(body: string, bodyOffset: number): { text: string; offset: number }[] {
  const rows: { text: string; offset: number }[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number): void => {
    const raw = body.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) rows.push({ text, offset: bodyOffset + start + leading });
  };
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '{') depth += 1;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (character === '\\' && body[index + 1] === '\\' && depth === 0) {
      push(index);
      start = index + 2;
      index += 1;
    }
  }
  push(body.length);
  return rows;
}

interface ParametricCases {
  x: string;
  y: string;
  xOffset: number;
  yOffset: number;
}

function readParametricCases(source: string): ParametricCases | null {
  const match = /^\\begin\{cases\}([\s\S]*)\\end\{cases\}$/u.exec(source);
  if (!match) return null;
  const bodyOffset = match.index + '\\begin{cases}'.length;
  const rows = splitCasesRows(match[1], bodyOffset);
  if (rows.length !== 2) return null;
  let x: { text: string; offset: number } | null = null;
  let y: { text: string; offset: number } | null = null;
  for (const row of rows) {
    const equals = topLevelEquals(row.text);
    if (equals < 0) return null;
    const left = row.text.slice(0, equals).trim();
    const rightRaw = row.text.slice(equals + 1);
    const leading = rightRaw.length - rightRaw.trimStart().length;
    const right = rightRaw.trim();
    if (!right) return null;
    const offset = row.offset + equals + 1 + leading;
    if (left === 'x' && x === null) x = { text: right, offset };
    else if (left === 'y' && y === null) y = { text: right, offset };
    else return null;
  }
  return x !== null && y !== null
    ? { x: x.text, y: y.text, xOffset: x.offset, yOffset: y.offset }
    : null;
}

/** Cheap classification used before compiling and sampling a plot block. */
export function plotFormulaKind(source: string): PlotFormulaKind | null {
  const text = source.trim();
  if (!text) return null;
  if (/^\\begin\{cases\}/u.test(text)) return 'parametric';
  const equals = topLevelEquals(text);
  if (equals < 0) return null;
  if (text.slice(0, equals).trim() === 'r') return 'polar';
  if (text.slice(0, equals).trim() !== 'y') return 'implicit';
  try {
    const parser = new LatexParser(text, lex(text), { allowY: true });
    const { right } = parser.parseEquation();
    return astContainsVariable(right, 'y') ? 'implicit' : 'explicit';
  } catch {
    return 'explicit';
  }
}

/**
 * Classifies one plot formula block.
 *
 * - `y = f(x)` is an explicit curve.
 * - `\begin{cases} x = f(t) \\ y = g(t) \end{cases}` is a parametric curve.
 * - `r = f(\theta)` is a polar curve, with theta local to the curve.
 * - Any other equation in x and y is implicit and traced as `left - right = 0`.
 */
export function compilePlotFormula(source: string): CompiledPlotFormula {
  if (typeof source !== 'string') {
    throw new LatexError('latex-syntax', 'Math source must be a string.', 0);
  }
  if (source.length > MAX_SOURCE) {
    throw new LatexError('latex-budget', 'Formula exceeds the length limit.', MAX_SOURCE);
  }
  const text = source.trim();
  if (!text) throw new LatexError('latex-empty', 'Formula is empty.', 0);

  const parametric = readParametricCases(text);
  if (parametric) {
    const usesX = (branch: string) =>
      lex(branch).some((token) => token.kind === 'letter' && token.value === 'x');
    if (usesX(parametric.x) || usesX(parametric.y)) {
      throw new LatexError('latex-variable', 'Parametric formulas use t and cannot read x.', 0);
    }
    const xExpression = compileLatex(parametric.x);
    const yExpression = compileLatex(parametric.y);
    const dependencies = new Set<string>();
    for (const name of [...xExpression.dependencies, ...yExpression.dependencies]) {
      if (name === 't' || name === 'x' || name === 'y') continue;
      dependencies.add(name);
    }
    return {
      kind: 'parametric',
      source: text,
      expression: xExpression,
      yExpression,
      dependencies: [...dependencies],
    };
  }

  const parser = new LatexParser(text, lex(text), { allowY: true });
  const { left, right } = parser.parseEquation();
  if (isVariableNode(left, 'r') && plotFormulaKind(text) === 'polar') {
    for (const name of ['x', 'y', 'r']) {
      if (astContainsVariable(right, name)) {
        throw new LatexError('latex-variable', `Polar formulas use theta and cannot read ${name}.`, right.offset);
      }
    }
    const found = new Set<string>();
    collectDependencies(right, found);
    found.delete('theta');
    return {
      kind: 'polar',
      source: text,
      expression: buildExpression(text, right, [...found]),
      yExpression: null,
      dependencies: [...found],
    };
  }
  if (isVariableNode(left, 'y') && !astContainsVariable(right, 'y')) {
    const expression = compileLatex(text);
    return {
      kind: 'explicit',
      source: text,
      expression,
      yExpression: null,
      dependencies: expression.dependencies,
    };
  }

  const ast: Ast = { kind: 'binary', op: '-', left, right, offset: left.offset };
  const found = new Set<string>();
  collectDependencies(ast, found);
  found.delete('x');
  found.delete('y');
  return {
    kind: 'implicit',
    source: text,
    expression: buildExpression(text, ast, [...found]),
    yExpression: null,
    dependencies: [...found],
  };
}

/** Upper bound for the per-axis grid used to trace an implicit equation. */
export const MAX_IMPLICIT_GRID = 100;

/** Minimum grid resolution; smaller `samples` values are raised to this. */
export const MIN_IMPLICIT_GRID = 32;

/** Grid cells per axis for an implicit curve at a given plot sample count. */
export function implicitGridSize(samples: number): number {
  return Math.max(MIN_IMPLICIT_GRID, Math.min(MAX_IMPLICIT_GRID, Math.floor(samples)));
}

export { LatexError } from './math-syntax';
