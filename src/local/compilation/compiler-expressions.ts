import type { CompileState } from './compiler-services';
import {
  expressionEnv,
  fullInterpolation,
  scanInterpolations,
  singleFullInterpolation,
  suggestName,
  typeName,
} from './compiler-values';
import { compileExpression, LocalExpressionError, type LocalExpression } from '../evaluation/expression/compile';
import type { LocalBinding, LocalDocument, LocalValue, LocalValueKind } from '../types';
import { walkLocalNodes } from '../source/source-context';
import { kernelRule, kernelRules, type KernelRule } from '../../contracts/component-kernel';
import { isKernelAnchorId, kernelNavigationIssues } from '../configuration/kernel-value-rules';
import { createHeadingAnchors } from '../parsing/heading-anchors';
import type { AttrMap, AttrState } from './compiler-structure';
import { MAX_LOCAL_DATA_TABLE_ROWS } from '../../contracts/limits';

export function validateExpressions(state: CompileState): void {
  const env = expressionEnv(state);
  const names = Object.keys(env);

  const expressionError = (error: unknown, base: number): void => {
    if (error instanceof LocalExpressionError) {
      state.report(
        `local.expression.${error.code || 'invalid'}`,
        `Expression error: ${error.message}`,
        base + (Number.isFinite(error.offset) ? error.offset : 0),
        undefined,
        { key: 'local.expression.error', params: {
          detail: error.message, code: error.code || 'invalid',
          near: state.source.slice(Math.max(base, base + error.offset - 16), base + error.offset + 24),
        } },
      );
      return;
    }
    state.report('local.expression.invalid', { key: 'local.expression.error', params: { detail: error instanceof Error ? error.message : String(error), code: 'invalid' } }, base, undefined);
  };

  const validate = (
    expression: string,
    base: number,
    expected: 'text' | 'number' | 'boolean' | 'string',
  ): LocalValueKind | null => {
    if (!expression.trim()) {
      state.report('local.expression.empty', { key: 'local.expression.empty' }, base, undefined);
      return null;
    }
    let compiled: LocalExpression | null = null;
    try {
      compiled = state.semantic?.expression(expression) ?? compileExpression(expression);
    } catch (error) {
      expressionError(error, base);
      return null;
    }
    if (!compiled) return null;
    let missing = false;
    for (const dependency of compiled.dependencies) {
      if (!Object.hasOwn(env, dependency)) {
        const suggestion = suggestName(dependency, names);
        state.report('local.binding.unknown', suggestion
            ? { key: 'local.binding.unknown.suggestion', params: { name: dependency, suggestion } }
            : { key: 'local.binding.unknown', params: { name: dependency } }, base + Math.max(0, expression.indexOf(dependency)), undefined);
        missing = true;
      }
    }
    if (missing) return null;
    let kind: LocalValueKind;
    try {
      kind = state.semantic ? state.semantic.infer(compiled,env) : compiled.inferType(env);
    } catch (error) {
      expressionError(error, base);
      return null;
    }
    if (expected === 'number' && kind !== 'number') {
      state.report('local.type', { key: 'local.type.number', params: { kind: typeName(kind) } }, base, undefined);
    } else if (expected === 'boolean' && kind !== 'boolean') {
      state.report('local.type', { key: 'local.type.boolean', params: { kind: typeName(kind) } }, base, undefined);
    } else if (expected === 'string' && kind !== 'string') {
      state.report('local.type', { key: 'local.type.string', params: { kind: typeName(kind) } }, base, undefined);
    } else if (expected === 'text' && (kind === 'array' || kind === 'number-array')) {
      state.report('local.type', { key: 'local.type.array' }, base, undefined);
    }
    return kind;
  };

    for (const node of walkLocalNodes(state.nodes)) {
      if (node.type === 'interpolation') {
        const raw = state.source.slice(node.range.start + 2, Math.max(node.range.start + 2, node.range.end - 2));
        const value = node.value ?? '';
        const leading = Math.max(0, raw.indexOf(value));
        const base = node.range.start + 2 + leading;
        state.expressionKinds.set(node.id, validate(value, base, 'text'));
      }
    }

  for (const entry of state.entries) {
    // Declaration values are expressions, not text templates; they are
    // validated by resolveComputations with their own dependency graph.
    if (entry.name === 'computed' || entry.name === 'const') continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const scoped = new Set<string>();
    const fullRequired = new Set<string>();
    for (const rule of kernelRules(entry.kernel)) {
      if (rule.kind === 'scoped-expressions') for (const name of rule.attributes) scoped.add(name);
      else if (rule.kind === 'row-values') {
        scoped.add(rule.rows);
        scoped.add(rule.key);
      } else if (rule.kind === 'validation-rule') scoped.add(rule.when);
      else if (rule.kind === 'require-full-interpolation') for (const name of rule.attributes) fullRequired.add(name);
    }
    for (const [name, info] of Object.entries(attrs)) {
      const prop = entry.kernel.props[name];
      if (!prop || prop.static) continue;
      // Row-scoped and rule attributes have their own environment and are
      // validated by validateDataTables / validateValidations.
      if (scoped.has(name)) continue;
      if (prop.kind === 'string') {
        if (entry.node.literalAttributes) continue;
        if (prop.dynamic) {
          // A full interpolation is a typed string expression; a literal is a
          // static fallback and has no expression to validate.
          if (info.dynamic) validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'string');
          continue;
        }
        const scanned = scanInterpolations(info.raw);
        for (const offset of scanned.unterminated) {
          state.report('local.interpolation', { key: 'local.interpolation.unclosed' }, info.offset + offset, undefined);
        }
        for (const segment of scanned.segments) {
          validate(segment.expression, info.offset + segment.start, 'text');
        }
        continue;
      }
      if (!info.dynamic) continue;
      if (prop.kind === 'number') {
        validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'number');
      } else if (prop.kind === 'boolean') {
        validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'boolean');
      } else if (prop.kind === 'enum') {
        validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'string');
      }
    }
    for (const name of fullRequired) {
      const info = attrs[name];
      if (entry.node.literalAttributes && entry.definition?.id === 'reactive-md/if'
        && name === 'when' && typeof info?.value === 'boolean') continue;
      if (info && !singleFullInterpolation(info.raw)) {
        state.report('local.attribute.interpolation', { key: 'local.attribute.interpolation', params: { name, component: entry.name } }, info.offset, undefined);
      }
    }
  }
}

/**
 * Validate static navigation targets after bindings are known: heading slugs
 * can depend on initial interpolation values, and explicit anchors must be
 * unique with each other and with heading targets.
 */
export function validateNavigation(
  state: CompileState,
  bindings: Record<string, LocalBinding>,
  initialState: Record<string, LocalValue>,
): void {
  const document: LocalDocument = {
    syntax: 'local', source: state.source, nodes: state.nodes, initialState, bindings,
    ...(Object.keys(state.computations).length ? { computations: state.computations } : {}),
  };
  const namespace = '__local_core_check__';
  // Ignore explicit anchors while assigning heading slugs so collisions are
  // rejected regardless of whether the explicit anchor appears first.
  const anchors = createHeadingAnchors(document, namespace, false);
  const headingSlugs = new Set<string>();
    for (const node of walkLocalNodes(state.nodes)) {
      if (node.type === 'heading') {
        const id = anchors.ids.get(node);
        if (id && id.startsWith(`${namespace}-`)) headingSlugs.add(id.slice(namespace.length + 1));
      }
    }

  const explicit = new Set<string>();
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'anchor');
    if (!rule) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const info = attrs[rule.id];
    if (!info) continue;
    const id = typeof info.value === 'string' ? info.value : '';
    if (!id || !isKernelAnchorId(id)) {
      state.report('local.anchor.id', { key: 'local.anchor.id', params: { id } }, info.offset, undefined);
      continue;
    }
    if (explicit.has(id)) {
      state.report('local.anchor.duplicate', { key: 'local.anchor.duplicate', params: { id } }, info.offset, undefined);
    } else {
      explicit.add(id);
    }
    if (headingSlugs.has(id)) {
      state.report('local.anchor.duplicate', { key: 'local.anchor.heading-collision', params: { id } }, info.offset, undefined);
    }
  }

  const targets: { name: string; target: string; offset: number }[] = [];
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'navigation');
    if (!rule) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const info = attrs[rule.target];
    if (!info) continue;
    targets.push({
      name: entry.name,
      target: typeof info.value === 'string' ? info.value : '',
      offset: info.offset,
    });
  }
  for (const issue of kernelNavigationIssues(targets, explicit, headingSlugs)) {
    state.report(
      issue.code,
      issue.message,
      issue.start,
      issue.end,
      { key: issue.key, ...(issue.params ? { params: issue.params } : {}) },
    );
  }
}

interface ScopedExpression {
  compiled: LocalExpression;
  /** Null when dependencies were missing or inference was not requested. */
  kind: LocalValueKind | null;
}

function reportExpressionError(state: CompileState, error: unknown, base: number): void {
  if (error instanceof LocalExpressionError) {
    state.report(
      `local.expression.${error.code || 'invalid'}`,
      `Expression error: ${error.message}`,
      base + (Number.isFinite(error.offset) ? error.offset : 0),
    );
    return;
  }
  state.report(
    'local.expression.invalid',
    `Expression error: ${error instanceof Error ? error.message : String(error)}`,
    base,
  );
}

/**
 * Compile one expression against a caller-provided type environment. Used by
 * the row scope of data tables and by validation rules; ordinary attributes
 * keep using the document environment in validateExpressions.
 */
export function validateScopedExpression(
  state: CompileState,
  expression: string,
  base: number,
  env: Record<string, LocalValueKind>,
  infer: boolean,
): ScopedExpression | null {
  if (!expression.trim()) {
    state.report('local.expression.empty', 'Interpolation expression cannot be empty.', base);
    return null;
  }
  let compiled: LocalExpression;
  try {
    compiled = state.semantic?.expression(expression) ?? compileExpression(expression);
  } catch (error) {
    reportExpressionError(state, error, base);
    return null;
  }
  const names = Object.keys(env);
  let missing = false;
  for (const dependency of compiled.dependencies) {
    if (!Object.hasOwn(env, dependency)) {
      const suggestion = suggestName(dependency, names);
      state.report(
        'local.binding.unknown',
        `Reference to undeclared parameter ${dependency}.${suggestion ? ` Did you mean ${suggestion}?` : ''}`,
        base + Math.max(0, expression.indexOf(dependency)),
      );
      missing = true;
    }
  }
  if (missing || !infer) return { compiled, kind: null };
  let kind: LocalValueKind;
  try {
    kind = state.semantic ? state.semantic.infer(compiled,env) : compiled.inferType(env);
  } catch (error) {
    reportExpressionError(state, error, base);
    return null;
  }
  return { compiled, kind };
}

/** Require a whole-value `{{ expression }}` attribute; returns its expression. */
export function fullExpressionAttribute(
  info: AttrState | undefined,
  code: string,
  component: string,
  attribute: string,
  state: CompileState,
): { expression: string; base: number } | null {
  if (!info) return null;
  const full = fullInterpolation(info.raw);
  if (!full) {
    state.report(
      code,
      `<${component}> ${attribute} must be exactly one {{ expression }} interpolation.`,
      info.offset,
      info.offset + info.raw.length,
    );
    return null;
  }
  if (!full.expression) {
    state.report('local.expression.empty', 'Interpolation expression cannot be empty.', info.offset + full.start);
    return null;
  }
  return { expression: full.expression, base: info.offset + full.start };
}

export function dataTableMaxRows(attrs: AttrMap, rule: Extract<KernelRule, { kind: 'data-table' }>): number {
  const info = attrs[rule.maxRows];
  const fallback = Math.min(rule.defaultMaxRows, MAX_LOCAL_DATA_TABLE_ROWS);
  if (
    info && !info.dynamic
    && typeof info.value === 'number'
    && Number.isInteger(info.value)
    && info.value > 0
    && info.value <= MAX_LOCAL_DATA_TABLE_ROWS
  ) return info.value;
  return fallback;
}
