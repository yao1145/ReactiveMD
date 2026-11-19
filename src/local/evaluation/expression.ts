import type { LocalValue, LocalValueKind } from '../types';
import { MAX_LOCAL_STRING_LENGTH } from '../configuration/limits';
import { LocalExpressionError, MAX_EXPRESSION_LENGTH, MAX_STRING_LENGTH } from './expression-values';
import { Parser } from './expression-syntax';
import { evalAst } from './expression-evaluation';
import { inferAst } from './expression-inference';

export interface LocalExpression {
  readonly source: string;
  readonly dependencies: string[];
  evaluate(env: Record<string, LocalValue>): LocalValue;
  inferType(env: Record<string, LocalValueKind>): LocalValueKind;
}

const MAX_TEMPLATE_LENGTH = MAX_LOCAL_STRING_LENGTH;

/** Compiled-expression cache entries per runtime instance. */
const CACHE_LIMIT = 500;

const compilationCache = new Map<string, LocalExpression>();

const dependencyOffsetTable = new WeakMap<LocalExpression, ReadonlyMap<string, number>>();

/**
 * Offset, relative to `expression.source`, of the first reference token that
 * reads `name`. Unlike a text search it never lands inside a string literal.
 * Returns `undefined` for names that are not dependencies or for expressions
 * not created by `compileExpression`. Internal; not part of the package API.
 */
export function expressionDependencyOffset(expression: LocalExpression, name: string): number | undefined {
  return dependencyOffsetTable.get(expression)?.get(name);
}

export function compileExpression(source: string): LocalExpression {
  if (typeof source !== 'string') {
    throw new LocalExpressionError('expression-syntax', 'Expression must be a string.', 0);
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new LocalExpressionError('expression-budget', `Expression exceeds the ${MAX_EXPRESSION_LENGTH}-character limit.`, 0);
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
  dependencyOffsetTable.set(expression, parser.dependencyOffsets);
  compilationCache.set(source, expression);
  return expression;
}

type TemplatePart =
  | { kind: 'text'; value: string }
  | { kind: 'expression'; source: string; start: number };

function splitTemplate(template: string): TemplatePart[] {
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', 'Interpolation template exceeds the length limit.', 0);
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
        throw new LocalExpressionError('expression-interpolation', 'Interpolations cannot be nested.', i);
      }
      if (char === '}' && template[i + 1] === '}') {
        closed = true;
        break;
      }
      i += 1;
    }
    if (!closed) {
      throw new LocalExpressionError('expression-interpolation', 'Interpolation is missing }}.', open);
    }
    const source = template.slice(open + 2, i);
    if (source.trim() === '') {
      throw new LocalExpressionError('expression-empty', 'Interpolation expression is empty.', open + 2);
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
      throw new LocalExpressionError('expression-value', 'Cannot display a non-finite number.', offset);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    throw new LocalExpressionError('expression-type', 'Cannot insert an array as text; convert it with a function such as len first.', offset);
  }
  throw new LocalExpressionError('expression-type', 'Cannot display this value as text.', offset);
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
      throw new LocalExpressionError('expression-budget', 'Interpolation result exceeds the length limit.', 0);
    }
    chunks.push(chunk);
  }
  return chunks.join('');
}

/** Render a template to scalar text. Arrays are rejected rather than serialized. */
export function interpolate(template: string, env: Record<string, LocalValue>): string {
  if (typeof template !== 'string') {
    throw new LocalExpressionError('expression-interpolation', 'Interpolation template must be a string.', 0);
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', `Interpolation template exceeds the ${MAX_TEMPLATE_LENGTH}-character limit.`, 0);
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
    throw new LocalExpressionError('expression-interpolation', 'Interpolation template must be a string.', 0);
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new LocalExpressionError('expression-budget', `Interpolation template exceeds the ${MAX_TEMPLATE_LENGTH}-character limit.`, 0);
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

/**
 * Binding keys read by the `{{ }}` expressions of a template, deduplicated in
 * first-occurrence order. Malformed templates or expressions throw; callers
 * that only need a static scan treat a throw as undecidable.
 */
export function templateDependencies(template: string): string[] {
  if (typeof template !== 'string') {
    throw new LocalExpressionError('expression-interpolation', 'Interpolation template must be a string.', 0);
  }
  const dependencies = new Set<string>();
  for (const part of splitTemplate(template)) {
    if (part.kind !== 'expression') continue;
    for (const name of compilePart(part).dependencies) dependencies.add(name);
  }
  return [...dependencies];
}

export { LocalExpressionError, BUILTIN_SET, CONSTANTS, FORBIDDEN_NAMES, VALID_KINDS, RESERVED_NAMES, MAX_AST_NODES, MAX_PARSE_DEPTH, MAX_AST_DEPTH, MAX_EVAL_STEPS, MAX_EVAL_DEPTH, MAX_STRING_LENGTH, arrayValueProblem, localValueBudgetIssue, localValueBudgetError } from "./expression-values";
export type { BuiltinName } from "./expression-values";
