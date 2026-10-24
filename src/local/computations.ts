import {
  compileExpression,
  localValueBudgetError,
  LocalExpressionError,
  type LocalExpression,
} from './expression';
import type {
  LocalComputation,
  LocalValue,
  LocalValueKind,
} from './types';
import { MAX_LOCAL_DIAGNOSTICS } from './limits';

/**
 * Declarations are resolved in one bounded pass: every expression is compiled
 * once, the dependency graph is topologically ordered with an iterative Kahn
 * walk (no recursion over long chains), and types are inferred once per node.
 * `const` values are evaluated statically so authors see domain errors at
 * compile time; the runtime evaluates `computed` values once per revision.
 */

export interface ComputationInput {
  name: string;
  kind: 'computed' | 'const';
  /** Trimmed expression between `{{` and `}}`. */
  source: string;
  /** Absolute source offset of the expression, used for diagnostics. */
  expressionOffset: number;
  nodeId: string;
  range: { start: number; end: number };
}

export type ComputationReport = (code: string, message: string, start: number, end?: number) => void;

export interface ResolvedComputations {
  computations: Record<string, LocalComputation>;
  kinds: Record<string, LocalValueKind>;
  /** Dependency-safe order, excluding declarations that could not resolve. */
  order: string[];
  expressions: Map<string, LocalExpression>;
  constValues: Record<string, LocalValue>;
}

function expressionError(
  report: ComputationReport,
  error: unknown,
  base: number,
  code = 'local.expression',
): void {
  if (error instanceof LocalExpressionError) {
    report(
      `${code}.${error.code || 'invalid'}`,
      `Expression error: ${error.message}`,
      base + (Number.isFinite(error.offset) ? error.offset : 0),
    );
    return;
  }
  report(
    `${code}.invalid`,
    `Expression error: ${error instanceof Error ? error.message : String(error)}`,
    base,
  );
}

function normalizeError(error: unknown): LocalExpressionError {
  return error instanceof LocalExpressionError
    ? error
    : new LocalExpressionError('expression-eval', error instanceof Error ? error.message : String(error), 0);
}

interface Graph {
  order: string[];
  cyclic: string[];
}

/** Iterative Kahn walk; `depsOf` must only return names in `names`. */
function graphOrder(names: string[], depsOf: (name: string) => string[]): Graph {
  const present = new Set(names);
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const name of names) indegree.set(name, 0);
  for (const name of names) {
    for (const dependency of depsOf(name)) {
      if (!present.has(dependency)) continue;
      indegree.set(name, (indegree.get(name) ?? 0) + 1);
      const list = dependents.get(dependency);
      if (list) list.push(name);
      else dependents.set(dependency, [name]);
    }
  }
  const queue: string[] = [];
  for (const name of names) if ((indegree.get(name) ?? 0) === 0) queue.push(name);
  const order: string[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const name = queue[head];
    order.push(name);
    for (const dependent of dependents.get(name) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  const emitted = new Set(order);
  const cyclic = names.filter((name) => !emitted.has(name));
  return { order, cyclic };
}

/**
 * Topological order for metadata that has already been validated. The runtime
 * uses this to evaluate a hand-built document without trusting declaration
 * order; unresolved names are reported through `cyclic`.
 */
export function orderComputations(
  computations: Record<string, LocalComputation>,
): { order: string[]; cyclic: string[] } {
  const names = Object.keys(computations);
  const present = new Set(names);
  return graphOrder(names, (name) => {
    const meta = computations[name];
    return meta ? meta.dependencies.filter((dependency) => present.has(dependency)) : [];
  });
}

export function resolveComputationGraph(
  inputs: ComputationInput[],
  controls: Record<string, LocalValueKind>,
  report: ComputationReport,
): ResolvedComputations {
  const expressions = new Map<string, LocalExpression>();
  const dependencies = new Map<string, string[]>();
  const byName = new Map<string, ComputationInput>();
  const names: string[] = [];
  const failed = new Set<string>();

  for (const input of inputs) {
    if (byName.has(input.name)) {
      // The compiler rejects duplicates before resolution; keep the first.
      continue;
    }
    byName.set(input.name, input);
    names.push(input.name);
  }
  const present = new Set(names);

  for (const name of names) {
    const input = byName.get(name)!;
    let compiled: LocalExpression;
    try {
      compiled = compileExpression(input.source);
    } catch (error) {
      expressionError(report, error, input.expressionOffset);
      failed.add(name);
      continue;
    }
    expressions.set(name, compiled);
    dependencies.set(name, [...compiled.dependencies]);
  }

  // Unknown references are reported once, at the expression, before any type
  // inference so a missing name never turns into an opaque "unknown name".
  for (const name of names) {
    if (failed.has(name)) continue;
    for (const dependency of dependencies.get(name) ?? []) {
      if (present.has(dependency) || Object.hasOwn(controls, dependency)) continue;
      report(
        'local.computation.unknown',
        `Reference to undeclared parameter ${dependency} in computation "${name}".`,
        (byName.get(name)!.expressionOffset) + Math.max(0, byName.get(name)!.source.indexOf(dependency)),
      );
      failed.add(name);
      break;
    }
  }

  // `const` may only read other constants; reading a control or a computed
  // value is a static error. Mark direct violations first, then propagate to
  // constants that depend on an invalid constant (the indirect restriction).
  const invalidConst = new Set<string>();
  for (const name of names) {
    if (failed.has(name)) continue;
    const input = byName.get(name)!;
    if (input.kind !== 'const') continue;
    for (const dependency of dependencies.get(name) ?? []) {
      const dependencyKind = present.has(dependency) ? byName.get(dependency)!.kind : null;
      if (Object.hasOwn(controls, dependency)) {
        report(
          'local.computation.const',
          `Constant "${name}" cannot depend on control parameter "${dependency}".`,
          input.expressionOffset + Math.max(0, input.source.indexOf(dependency)),
        );
        invalidConst.add(name);
      } else if (dependencyKind === 'computed') {
        report(
          'local.computation.const',
          `Constant "${name}" cannot depend on computed value "${dependency}".`,
          input.expressionOffset + Math.max(0, input.source.indexOf(dependency)),
        );
        invalidConst.add(name);
      }
    }
  }

  const { order, cyclic } = graphOrder(names, (name) => dependencies.get(name) ?? []);
  if (cyclic.length > 0) {
    const remaining = new Set(cyclic);
    // Follow dependency edges once to locate an actual cycle. Every remaining
    // declaration is still marked unresolved so nothing depends on it.
    const path: string[] = [];
    const seen = new Map<string, number>();
    let current = cyclic[0];
    while (!seen.has(current)) {
      seen.set(current, path.length);
      path.push(current);
      const next = (dependencies.get(current) ?? []).find((dependency) => remaining.has(dependency));
      if (next === undefined) break;
      current = next;
    }
    const cycle = seen.has(current) ? path.slice(seen.get(current)!) : [cyclic[0]];
    const summary = cycle.slice(0, 12).join(' → ') + (cycle.length > 12 ? ' → …' : ` → ${cycle[0]}`);
    for (const name of cycle.slice(0, MAX_LOCAL_DIAGNOSTICS)) {
      const input = byName.get(name)!;
      report(
        'local.computation.cycle',
        `Computation "${name}" is part of a dependency cycle: ${summary}.`,
        input.range.start,
        input.range.end,
      );
    }
    for (const name of cyclic) failed.add(name);
  }

  for (const name of order) {
    if (failed.has(name)) continue;
    if (byName.get(name)!.kind !== 'const' || invalidConst.has(name)) continue;
    if ((dependencies.get(name) ?? []).some((dependency) => {
      if (!present.has(dependency)) return false;
      const dependencyInput = byName.get(dependency)!;
      return dependencyInput.kind === 'const' && invalidConst.has(dependency);
    })) {
      const input = byName.get(name)!;
      report(
        'local.computation.const',
        `Constant "${name}" indirectly depends on a value that is not a constant.`,
        input.expressionOffset,
      );
      invalidConst.add(name);
    }
  }

  const kinds: Record<string, LocalValueKind> = {};
  const typeEnv: Record<string, LocalValueKind> = { ...controls };
  for (const name of order) {
    if (failed.has(name)) continue;
    const input = byName.get(name)!;
    if ((dependencies.get(name) ?? []).some((dependency) => failed.has(dependency))) {
      failed.add(name);
      continue;
    }
    const compiled = expressions.get(name)!;
    try {
      const kind = compiled.inferType(typeEnv);
      kinds[name] = kind;
      typeEnv[name] = kind;
    } catch (error) {
      expressionError(report, error, input.expressionOffset);
      failed.add(name);
    }
  }

  // Constants are fully static; evaluate them once in dependency order so a
  // division by zero or an out-of-domain function is a compile diagnostic.
  const constValues: Record<string, LocalValue> = {};
  const constEnv: Record<string, LocalValue> = {};
  for (const name of order) {
    if (failed.has(name) || byName.get(name)!.kind !== 'const' || invalidConst.has(name)) continue;
    const input = byName.get(name)!;
    const compiled = expressions.get(name)!;
    try {
      const value = compiled.evaluate(constEnv);
      const budget = localValueBudgetError(value);
      if (budget) {
        report('local.computation.budget', `Constant "${name}": ${budget}`, input.expressionOffset);
        failed.add(name);
        continue;
      }
      constValues[name] = Array.isArray(value) ? value.slice() : value;
      constEnv[name] = constValues[name];
    } catch (error) {
      const normalized = normalizeError(error);
      report(
        'local.computation.expression',
        `Constant "${name}" cannot be evaluated: ${normalized.message}`,
        input.expressionOffset + (Number.isFinite(normalized.offset) ? normalized.offset : 0),
      );
      failed.add(name);
    }
  }

  const computations: Record<string, LocalComputation> = {};
  for (const name of names) {
    const input = byName.get(name)!;
    if (failed.has(name) || kinds[name] === undefined) continue;
    const meta: LocalComputation = {
      name,
      kind: input.kind,
      source: input.source,
      dependencies: [...(dependencies.get(name) ?? [])],
      type: kinds[name],
      nodeId: input.nodeId,
      range: { ...input.range },
    };
    if (input.kind === 'const' && Object.hasOwn(constValues, name)) {
      meta.value = constValues[name];
    }
    computations[name] = meta;
  }

  return { computations, kinds, order: order.filter((name) => !failed.has(name)), expressions, constValues };
}

export interface ComputationEvaluation {
  values: Record<string, LocalValue>;
  errors: Map<string, LocalExpressionError>;
}

/**
 * Evaluate `computed` declarations against a control snapshot. Constants are
 * supplied from their static values and are never recalculated. Failures are
 * recorded rather than thrown; later declarations see a getter that rethrows
 * the original error only when the failing name is actually read, which keeps
 * short-circuited branches and independent consumers working.
 */
export function evaluateComputations(
  computations: Record<string, LocalComputation>,
  order: string[],
  expressions: Map<string, LocalExpression>,
  controls: Record<string, LocalValue>,
  constValues: Record<string, LocalValue>,
): ComputationEvaluation {
  const values: Record<string, LocalValue> = {};
  const errors = new Map<string, LocalExpressionError>();
  const env: Record<string, LocalValue> = {};
  for (const [key, value] of Object.entries(controls)) env[key] = value;
  for (const [key, value] of Object.entries(constValues)) {
    values[key] = value;
    env[key] = value;
  }
  for (const name of order) {
    const meta = computations[name];
    if (!meta || meta.kind === 'const') continue;
    const compiled = expressions.get(name);
    if (!compiled) continue;
    try {
      const value = compiled.evaluate(env);
      const budget = localValueBudgetError(value);
      if (budget) throw new LocalExpressionError('expression-budget', budget, 0);
      values[name] = value;
      env[name] = value;
    } catch (error) {
      const normalized = normalizeError(error);
      errors.set(name, normalized);
      Object.defineProperty(env, name, {
        enumerable: true,
        configurable: true,
        get() {
          throw normalized;
        },
      });
    }
  }
  return { values, errors };
}

