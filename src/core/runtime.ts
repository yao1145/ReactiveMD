import type {
  ActionStep,
  BindingConstraint,
  CompiledDocument,
  Diagnostic,
  Json,
  ResourceSnapshot,
  Runtime,
  RuntimeOptions,
  RuntimeSnapshot,
  StateValue,
  ValueSource,
} from './types';
import {
  ExpressionError,
  collectDependencies,
  evaluateAst,
  parseExpression,
} from './expression';
import { collectDynamicProps, type DynamicPropInfo } from './schema';
import { getDocumentMeta, makeDiagnostic, type DocumentMeta } from './metadata';

const DEFAULT_RANGE = { start: 0, end: 0 };
const MAX_JSON_DEPTH = 200;

/* ------------------------------------------------------------------ */
/* Small JSON helpers                                                  */
/* ------------------------------------------------------------------ */

export function cloneJson<T extends Json>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) out[key] = cloneJson(item as Json);
    return out as unknown as T;
  }
  return value;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as any)) deepFreeze(item);
  }
  return value;
}

export function jsonEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!jsonEqual((a as Record<string, Json>)[key], (b as Record<string, Json>)[key])) return false;
    }
    return true;
  }
  return false;
}

export function isJsonValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (depth > MAX_JSON_DEPTH) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isJsonValue(item, depth + 1, seen)) return false;
    }
    seen.delete(value);
    return true;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const item of Object.values(value as Record<string, unknown>)) {
    if (!isJsonValue(item, depth + 1, seen)) return false;
  }
  seen.delete(value);
  return true;
}

function stateKindOf(value: StateValue): 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value as 'string' | 'number' | 'boolean';
}

function typeOfValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function acceptsStateValue(initialKind: string, value: Json): boolean {
  if (initialKind === 'null') return true;
  return stateKindOf(value) === initialKind;
}

function freezeRecord<T>(record: Record<string, T>): Readonly<Record<string, T>> {
  return Object.freeze({ ...record });
}

/* ------------------------------------------------------------------ */
/* Constraint validation                                               */
/* ------------------------------------------------------------------ */

function stepMatches(value: number, base: number, step: number): boolean {
  if (!(step > 0)) return false;
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) <= 1e-9;
}

export function checkBindingValue(
  constraint: BindingConstraint,
  value: unknown,
): string | null {
  if (!isJsonValue(value)) return 'Binding value must be a JSON value.';
  switch (constraint.type) {
    case 'string':
      if (typeof value !== 'string') return `State "${constraint.state}" expects string, got ${typeOfValue(value)}.`;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `State "${constraint.state}" expects a finite number, got ${typeOfValue(value)}.`;
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `State "${constraint.state}" expects boolean, got ${typeOfValue(value)}.`;
      break;
    case 'null':
      if (value !== null) return `State "${constraint.state}" expects null, got ${typeOfValue(value)}.`;
      break;
    case 'array':
      if (!Array.isArray(value)) return `State "${constraint.state}" expects an array, got ${typeOfValue(value)}.`;
      break;
    case 'object':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return `State "${constraint.state}" expects an object, got ${typeOfValue(value)}.`;
      }
      break;
  }
  if (constraint.type === 'number' && typeof value === 'number') {
    if (constraint.min !== undefined && value < constraint.min) {
      return `Value ${value} is below the minimum ${constraint.min} for "${constraint.state}".`;
    }
    if (constraint.max !== undefined && value > constraint.max) {
      return `Value ${value} is above the maximum ${constraint.max} for "${constraint.state}".`;
    }
    if (constraint.step !== undefined) {
      const base = constraint.min ?? 0;
      if (!stepMatches(value, base, constraint.step)) {
        return `Value ${value} is not on the step ${constraint.step} (from ${base}) for "${constraint.state}".`;
      }
    }
  }
  if (constraint.options && typeof value === 'string' && !constraint.options.includes(value)) {
    return `Value "${value}" is not one of the allowed options for "${constraint.state}".`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Runtime preparation                                                 */
/* ------------------------------------------------------------------ */

interface DependencyInfo {
  computedOrder: string[];
  dependents: Map<string, Set<string>>;
  computedDeps: Map<string, string[]>;
}

function buildDependencies(document: CompiledDocument): DependencyInfo {
  const names = Object.keys(document.computed);
  const nameSet = new Set(names);
  const computedDeps = new Map<string, string[]>();
  const dependents = new Map<string, Set<string>>();

  for (const name of names) {
    let deps: string[] = [];
    try {
      deps = collectDependencies(parseExpression(document.computed[name]));
    } catch {
      deps = [];
    }
    computedDeps.set(name, deps);
    for (const dep of deps) {
      if (!nameSet.has(dep)) continue;
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep)!.add(name);
    }
  }

  const order = document.computedOrder.filter((name) => nameSet.has(name));
  const seen = new Set(order);
  for (const name of names) {
    if (seen.has(name)) continue;
    order.push(name);
    seen.add(name);
  }

  return { computedOrder: order, dependents, computedDeps };
}

function hostActionNames(document: CompiledDocument): string[] {
  const names: string[] = [];
  for (const [name, steps] of Object.entries(document.actions)) {
    if (steps.length === 1 && 'call' in steps[0]) names.push(name);
  }
  return names;
}

function idleResource(): ResourceSnapshot {
  const resource: ResourceSnapshot = { status: 'idle', data: null, error: null, requestId: 0 };
  return Object.freeze(resource);
}

function initialResources(document: CompiledDocument): Record<string, ResourceSnapshot> {
  const resources: Record<string, ResourceSnapshot> = {};
  for (const name of hostActionNames(document)) resources[name] = idleResource();
  return resources;
}

interface InitialEvaluation {
  state: Record<string, StateValue>;
  computed: Record<string, Json>;
  diagnostics: Diagnostic[];
}

function expressionRange(
  meta: DocumentMeta | undefined,
  range: { start: number; end: number } | undefined,
  offset: number,
): { start: number; end: number } {
  if (!range) return DEFAULT_RANGE;
  const start = Math.max(range.start, Math.min(range.start + Math.max(0, offset), range.end));
  return { start, end: Math.max(start, Math.min(range.end, start + 1)) };
}

function resourcesForEval(
  resources: Readonly<Record<string, ResourceSnapshot>>,
): Record<string, Json> {
  return resources as unknown as Record<string, Json>;
}

function evaluateValueSource(
  source: ValueSource,
  state: Readonly<Record<string, StateValue>>,
  computed: Readonly<Record<string, Json>>,
  data: Json,
  resources: Readonly<Record<string, ResourceSnapshot>>,
  locals?: Record<string, Json>,
): Json {
  if (source.kind === 'literal') return cloneJson(source.value);
  return evaluateAst(parseExpression(source.expression), {
    state,
    computed,
    data,
    resources: resourcesForEval(resources),
    locals,
  });
}

function evaluateComputedValue(
  name: string,
  state: Record<string, StateValue>,
  computed: Record<string, Json>,
  document: CompiledDocument,
  data: Json,
  resources: Readonly<Record<string, ResourceSnapshot>>,
): Json {
  const expression = document.computed[name];
  return evaluateAst(parseExpression(expression), {
    state,
    computed,
    data,
    resources: resourcesForEval(resources),
  });
}

function evaluateComputed(
  document: CompiledDocument,
  deps: DependencyInfo,
  state: Record<string, StateValue>,
  data: Json,
  resources: Readonly<Record<string, ResourceSnapshot>>,
  meta: DocumentMeta | undefined,
): { computed: Record<string, Json>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const computed: Record<string, Json> = {};
  for (const name of deps.computedOrder) {
    const range = meta?.computedRanges.get(name);
    try {
      computed[name] = deepFreeze(cloneJson(
        evaluateComputedValue(name, state, computed, document, data, resources),
      ));
    } catch (error) {
      const exprError = error as ExpressionError;
      diagnostics.push(makeDiagnostic(
        document.source,
        exprError.code ?? 'computed-eval',
        `Computed "${name}" failed: ${exprError.message}`,
        expressionRange(meta, range, exprError.offset ?? 0),
      ));
      computed[name] = null;
    }
  }
  return { computed, diagnostics };
}

function checkPropertyValue(info: DynamicPropInfo, value: Json): string | null {
  switch (info.expected) {
    case 'string':
      return typeof value === 'string' ? null : `must be a string, got ${typeOfValue(value)}.`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `must be a finite number, got ${typeOfValue(value)}.`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `must be a boolean, got ${typeOfValue(value)}.`;
    case 'value': {
      if (!['string', 'number', 'boolean', 'null'].includes(typeOfValue(value))) {
        return `must be a scalar or null, got ${typeOfValue(value)}.`;
      }
      const formatSource = info.node.props?.format;
      const format = formatSource && formatSource.kind === 'literal' ? formatSource.value : 'text';
      if ((format === 'number' || format === 'currency') && typeof value !== 'number') {
        return `must be a number when format is "${String(format)}", got ${typeOfValue(value)}.`;
      }
      return null;
    }
    case 'json':
      return isJsonValue(value) ? null : 'must be a JSON value.';
    case 'array':
      return Array.isArray(value) ? null : `must be an array, got ${typeOfValue(value)}.`;
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? null
        : `must be an object, got ${typeOfValue(value)}.`;
  }
  return null;
}

function validateDynamicProps(
  document: CompiledDocument,
  state: Readonly<Record<string, StateValue>>,
  computed: Readonly<Record<string, Json>>,
  data: Json,
  resources: Readonly<Record<string, ResourceSnapshot>>,
): Diagnostic[] {
  const meta = getDocumentMeta(document);
  const diagnostics: Diagnostic[] = [];
  const dynamicProps = collectDynamicProps(document.nodes, document.componentSchemas);

  for (const info of dynamicProps) {
    if (info.localNames.length > 0) continue;
    const source = info.node.props?.[info.prop];
    if (!source || source.kind !== 'expression') continue;
    const range = meta?.propRanges.get(`${info.componentId}:${info.prop}`);
    let value: Json;
    try {
      value = evaluateValueSource(source, state, computed, data, resources);
    } catch (error) {
      const exprError = error as ExpressionError;
      diagnostics.push(makeDiagnostic(
        document.source,
        exprError.code ?? 'property-eval',
        `Property "${info.prop}" of <${info.componentName}> failed: ${exprError.message}`,
        expressionRange(meta, range, exprError.offset ?? 0),
      ));
      continue;
    }

    const problem = checkPropertyValue(info, value);
    if (problem) {
      diagnostics.push(makeDiagnostic(
        document.source,
        'property-type',
        `Property "${info.prop}" of <${info.componentName}> ${problem}`,
        range ?? meta?.rootRange ?? DEFAULT_RANGE,
      ));
    }
  }

  return diagnostics;
}

function evaluateInitial(document: CompiledDocument, restore?: Record<string, Json> | null): InitialEvaluation {
  const meta = getDocumentMeta(document);
  const deps = buildDependencies(document);
  const data = deepFreeze(cloneJson(document.data));
  const resources = initialResources(document);

  const state: Record<string, StateValue> = {};
  for (const [name, value] of Object.entries(document.initialState)) {
    state[name] = deepFreeze(cloneJson(value));
  }
  if (restore) {
    for (const [name, value] of Object.entries(restore)) {
      if (Object.prototype.hasOwnProperty.call(document.initialState, name)) {
        state[name] = deepFreeze(cloneJson(value));
      }
    }
  }

  const result = evaluateComputed(document, deps, state, data, resources, meta);
  const diagnostics = [...result.diagnostics];
  diagnostics.push(...validateDynamicProps(document, state, result.computed, data, resources));
  return { state, computed: result.computed, diagnostics };
}

export function validateDocumentState(document: CompiledDocument): Diagnostic[] {
  return evaluateInitial(document).diagnostics;
}

export class RuntimeInitializationError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(`Invalid document initial state: ${diagnostics[0]?.message ?? 'unknown error'}`);
    this.name = 'RuntimeInitializationError';
    this.diagnostics = diagnostics;
  }
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

interface Subscription {
  names: Set<string>;
  listener: () => void;
}

interface PendingRequest {
  requestId: number;
  controller: AbortController;
}

export function createRuntime(document: CompiledDocument, options: RuntimeOptions = {}): Runtime {
  const meta = getDocumentMeta(document);
  const source = document.source;
  const data = deepFreeze(cloneJson(document.data));
  const deps = buildDependencies(document);

  const initialKinds: Record<string, string> = {};
  for (const [name, value] of Object.entries(document.initialState)) {
    initialKinds[name] = stateKindOf(value);
  }

  // Validate a restore snapshot before adopting it.
  const restoreDiagnostics: Diagnostic[] = [];
  const restore = options.initialState;
  if (restore !== undefined) {
    if (!isJsonValue(restore) || restore === null || typeof restore !== 'object' || Array.isArray(restore)) {
      restoreDiagnostics.push(makeDiagnostic(
        source,
        'initial-state-shape',
        'The initial state must be a JSON object keyed by state name.',
        meta?.rootRange ?? DEFAULT_RANGE,
      ));
    } else {
      for (const [name, value] of Object.entries(restore)) {
        if (!Object.prototype.hasOwnProperty.call(document.initialState, name)) {
          restoreDiagnostics.push(makeDiagnostic(
            source,
            'initial-state-unknown',
            `The initial state contains unknown state "${name}".`,
            meta?.rootRange ?? DEFAULT_RANGE,
          ));
          continue;
        }
        if (!isJsonValue(value)) {
          restoreDiagnostics.push(makeDiagnostic(
            source,
            'initial-state-type',
            `The initial value of "${name}" is not a JSON value.`,
            meta?.rootRange ?? DEFAULT_RANGE,
          ));
          continue;
        }
        if (!acceptsStateValue(initialKinds[name], value)) {
          restoreDiagnostics.push(makeDiagnostic(
            source,
            'initial-state-type',
            `The initial value of "${name}" must be ${initialKinds[name]}, got ${typeOfValue(value)}.`,
            meta?.rootRange ?? DEFAULT_RANGE,
          ));
        }
      }
      if (restoreDiagnostics.length === 0) {
        for (const constraint of document.bindings) {
          const restored = Object.prototype.hasOwnProperty.call(restore, constraint.state)
            ? (restore as Record<string, Json>)[constraint.state]
            : document.initialState[constraint.state];
          const problem = checkBindingValue(constraint, restored);
          if (problem) {
            restoreDiagnostics.push(makeDiagnostic(
              source,
              'initial-state-constraint',
              problem,
              constraint.range,
            ));
          }
        }
      }
    }
    if (restoreDiagnostics.length > 0) throw new RuntimeInitializationError(restoreDiagnostics);
  }

  const initial = evaluateInitial(document, restore ?? null);
  if (initial.diagnostics.length > 0) throw new RuntimeInitializationError(initial.diagnostics);

  let state: Record<string, StateValue> = { ...initial.state };
  let computed: Record<string, Json> = { ...initial.computed };
  let resources: Record<string, ResourceSnapshot> = { ...initialResources(document) };
  let revision = 0;
  let disposed = false;
  const subscriptions = new Set<Subscription>();
  const pending = new Map<string, PendingRequest>();
  let requestCounter = 0;

  Object.freeze(state);
  Object.freeze(computed);
    resources = Object.freeze({ ...resources }) as unknown as Record<string, ResourceSnapshot>;

  let snapshot: RuntimeSnapshot = Object.freeze({
    revision,
    state: freezeRecord(state),
    computed: freezeRecord(computed),
    resources: freezeRecord(resources),
  }) as RuntimeSnapshot;

  function assertActive(): void {
    if (disposed) throw new Error('Reactive MD runtime has been disposed.');
  }

  function diag(code: string, message: string, range = meta?.rootRange ?? DEFAULT_RANGE): Diagnostic {
    return makeDiagnostic(source, code, message, range);
  }

  function validateConstraintsFor(
    candidate: Record<string, StateValue>,
    changedStates: Set<string>,
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const constraint of document.bindings) {
      if (!changedStates.has(constraint.state)) continue;
      const problem = checkBindingValue(constraint, candidate[constraint.state]);
      if (problem) {
        diagnostics.push(diag('binding-constraint', problem, constraint.range));
      }
    }
    return diagnostics;
  }

  function recomputeComputed(
    candidateState: Record<string, StateValue>,
    changedNames: Set<string>,
  ): { computed: Record<string, Json>; changed: Set<string>; affected: Set<string> } {
    const affected = new Set<string>();
    const queue: string[] = [];

    for (const [name, names] of deps.computedDeps) {
      if (names.some((dependency) => changedNames.has(dependency))) {
        affected.add(name);
        queue.push(name);
      }
    }
    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = deps.dependents.get(current);
      if (!dependents) continue;
      for (const dependent of dependents) {
        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
      }
    }

    if (affected.size === 0) {
      return { computed, changed: new Set(), affected };
    }

    const nextComputed: Record<string, Json> = { ...computed };
    const changed = new Set<string>();

    for (const name of deps.computedOrder) {
      if (!affected.has(name)) continue;
      const value = deepFreeze(cloneJson(
        evaluateComputedValue(name, candidateState, nextComputed, document, data, resources),
      ));
      if (!jsonEqual(value, nextComputed[name])) {
        nextComputed[name] = value;
        changed.add(name);
      }
    }

    return { computed: nextComputed, changed, affected };
  }

  function makeSnapshot(
    nextState: Record<string, StateValue>,
    nextComputed: Record<string, Json>,
    nextResources: Record<string, ResourceSnapshot>,
  ): RuntimeSnapshot {
    return Object.freeze({
      revision,
      state: freezeRecord(nextState),
      computed: freezeRecord(nextComputed),
      resources: freezeRecord(nextResources),
    }) as RuntimeSnapshot;
  }

  function commit(nextState: Record<string, StateValue>, nextComputed: Record<string, Json>, changed: Set<string>): void {
    for (const value of Object.values(nextState)) deepFreeze(value);
    for (const value of Object.values(nextComputed)) deepFreeze(value);
    state = Object.freeze({ ...nextState }) as unknown as Record<string, StateValue>;
    computed = Object.freeze({ ...nextComputed }) as unknown as Record<string, Json>;
    revision += 1;
    snapshot = makeSnapshot(state, computed, resources);
    notify(changed);
  }

  function resourceNames(actionName: string): Set<string> {
    return new Set([`resources.${actionName}`, actionName]);
  }

  /** Recomputed values may read resources, so refresh them when a resource changes. */
  function refreshComputedForResources(): Set<string> {
    const result = evaluateComputed(document, deps, state, data, resources, meta);
    if (result.diagnostics.length > 0) return new Set();
    const changed = new Set<string>();
    for (const [name, value] of Object.entries(result.computed)) {
      if (!jsonEqual(value, computed[name])) changed.add(name);
    }
    if (changed.size > 0) {
      computed = Object.freeze({ ...result.computed }) as unknown as Record<string, Json>;
    }
    return changed;
  }

  function updateResource(actionName: string, patch: Partial<ResourceSnapshot>): void {
    if (disposed) return;
    const current = resources[actionName] ?? idleResource();
    const next: ResourceSnapshot = { ...current, ...patch };
    Object.freeze(next);
    resources = Object.freeze({ ...resources, [actionName]: next }) as unknown as Record<string, ResourceSnapshot>;
    const computedChanged = refreshComputedForResources();
    revision += 1;
    snapshot = makeSnapshot(state, computed, resources);
    const changed = resourceNames(actionName);
    for (const name of computedChanged) changed.add(name);
    notify(changed);
  }

  function notify(changed: Set<string>): void {
    for (const subscription of [...subscriptions]) {
      if (!subscriptions.has(subscription)) continue;
      let relevant = subscription.names.has('*');
      if (!relevant && changed.has('*')) relevant = true;
      if (!relevant) {
        for (const name of subscription.names) {
          if (changed.has(name)) {
            relevant = true;
            break;
          }
          if (name === 'resources' && [...changed].some((entry) => entry.startsWith('resources.'))) {
            relevant = true;
            break;
          }
        }
      }
      if (!relevant) continue;
      try {
        subscription.listener();
      } catch {
        // A listener must not break the document or other subscribers.
      }
    }
  }

  function prepareState(
    candidateState: Record<string, StateValue>,
    changedStates: Set<string>,
    range: { start: number; end: number },
  ):
    | { ok: true; state: Record<string, StateValue>; computed: Record<string, Json>; changed: Set<string> }
    | { ok: false; diagnostics: Diagnostic[] } {
    const constraintDiagnostics = validateConstraintsFor(candidateState, changedStates);
    if (constraintDiagnostics.length > 0) return { ok: false, diagnostics: constraintDiagnostics };

    let recomputed: ReturnType<typeof recomputeComputed>;
    try {
      recomputed = recomputeComputed(candidateState, changedStates);
    } catch (error) {
      const exprError = error as ExpressionError;
      return {
        ok: false,
        diagnostics: [diag(
          exprError.code ?? 'computed-eval',
          `Computed update failed: ${exprError.message}`,
          range,
        )],
      };
    }

    const propDiagnostics = validateDynamicProps(document, candidateState, recomputed.computed, data, resources);
    if (propDiagnostics.length > 0) return { ok: false, diagnostics: propDiagnostics };

    const changed = new Set<string>(changedStates);
    for (const name of recomputed.changed) changed.add(name);
    return { ok: true, state: candidateState, computed: recomputed.computed, changed };
  }

  function writeBinding(
    componentId: string,
    value: StateValue,
    _locals?: Record<string, Json>,
  ): ReturnType<Runtime['writeBinding']> {
    assertActive();
    const constraint = document.bindings.find((binding) => binding.componentId === componentId);
    if (!constraint) {
      return {
        ok: false,
        diagnostics: [diag(
          'binding-not-found',
          `Component "${componentId}" has no state binding.`,
          meta?.nodeById.get(componentId)?.range,
        )],
      };
    }

    const problem = checkBindingValue(constraint, value);
    if (problem) {
      return { ok: false, diagnostics: [diag('binding-invalid', problem, constraint.range)] };
    }

    if (jsonEqual(state[constraint.state], value)) {
      return { ok: true, revision };
    }

    const candidate: Record<string, StateValue> = {
      ...state,
      [constraint.state]: deepFreeze(cloneJson(value)),
    };
    const prepared = prepareState(candidate, new Set([constraint.state]), constraint.range);
    if (!prepared.ok) return prepared;
    commit(prepared.state, prepared.computed, prepared.changed);
    return { ok: true, revision };
  }

  function evaluateSource(source: ValueSource, locals?: Record<string, Json>): Json {
    if (source.kind === 'literal') return cloneJson(source.value);
    return evaluateAst(parseExpression(source.expression), {
      state,
      computed,
      data,
      resources: resourcesForEval(resources),
      locals,
    });
  }

  function dispatch(actionName: string, locals?: Record<string, Json>): ReturnType<Runtime['dispatch']> {
    assertActive();
    const steps = document.actions[actionName];
    if (!steps) {
      return {
        ok: false,
        diagnostics: [diag('action-not-found', `Unknown action "${actionName}".`)],
      };
    }
    if (steps.some((step) => 'call' in step)) {
      return {
        ok: false,
        diagnostics: [diag(
          'action-async',
          `Action "${actionName}" is a host action; use dispatchAsync.`,
        )],
      };
    }

    const actionRange = meta?.actionRanges.get(actionName) ?? meta?.rootRange ?? DEFAULT_RANGE;
    const candidate: Record<string, StateValue> = { ...state };
    const targets = new Set<string>();
    const changedStates = new Set<string>();
    const diagnostics: Diagnostic[] = [];

    const evaluateStep = (value: ValueSource): Json => evaluateSource(value, locals);

    // All right-hand sides read the pre-transaction snapshot.
    for (const step of steps) {
      if ('set' in step) {
        const target = step.set;
        if (targets.has(target)) {
          diagnostics.push(diag('action-duplicate-target', `Action "${actionName}" writes "${target}" more than once.`, step.range));
          continue;
        }
        targets.add(target);
        if (!Object.prototype.hasOwnProperty.call(document.initialState, target)) {
          diagnostics.push(diag('action-invalid-target', `Action "${actionName}" cannot write to "${target}"; it is not a state value.`, step.range));
          continue;
        }
        let value: Json;
        try {
          value = evaluateStep(step.value);
        } catch (error) {
          const exprError = error as ExpressionError;
          diagnostics.push(diag(
            exprError.code ?? 'action-expression',
            `Action "${actionName}" failed: ${exprError.message}`,
            actionRange,
          ));
          continue;
        }
        if (!isJsonValue(value) || !acceptsStateValue(initialKinds[target], value)) {
          diagnostics.push(diag(
            'action-type',
            `Action "${actionName}" produced ${typeOfValue(value)} for ${initialKinds[target]} state "${target}".`,
            step.range,
          ));
          continue;
        }
        candidate[target] = deepFreeze(cloneJson(value));
        continue;
      }

      if ('reset' in step) {
        for (const target of step.reset) {
          if (targets.has(target)) {
            diagnostics.push(diag('action-duplicate-target', `Action "${actionName}" writes "${target}" more than once.`, step.range));
            continue;
          }
          targets.add(target);
          if (!Object.prototype.hasOwnProperty.call(document.initialState, target)) {
            diagnostics.push(diag('action-invalid-target', `Action "${actionName}" cannot reset "${target}"; it is not a state value.`, step.range));
            continue;
          }
          candidate[target] = deepFreeze(cloneJson(document.initialState[target]));
        }
        continue;
      }

      const target = 'append' in step ? step.append : 'remove' in step ? step.remove : 'update' in step ? step.update : null;
      if (target === null) continue;
      if (targets.has(target)) {
        diagnostics.push(diag('action-duplicate-target', `Action "${actionName}" writes "${target}" more than once.`, step.range));
        continue;
      }
      targets.add(target);
      if (!Object.prototype.hasOwnProperty.call(document.initialState, target)) {
        diagnostics.push(diag('action-invalid-target', `Action "${actionName}" cannot write to "${target}"; it is not a state value.`, step.range));
        continue;
      }
      const current = state[target];
      if (!Array.isArray(current)) {
        diagnostics.push(diag(
          'action-type',
          `Action "${actionName}" cannot use collection operations on "${target}" because it is ${stateKindOf(current)}, not array.`,
          step.range,
        ));
        continue;
      }

      try {
        if ('append' in step) {
          const value = evaluateStep(step.value);
          if (!isJsonValue(value)) {
            diagnostics.push(diag('action-value', `Action "${actionName}" produced a non-JSON value.`, step.range));
            continue;
          }
          candidate[target] = deepFreeze([...current, cloneJson(value)]);
          continue;
        }

        if (!('at' in step)) continue;
        const rawIndex = evaluateStep(step.at);
        if (typeof rawIndex !== 'number' || !Number.isInteger(rawIndex)) {
          diagnostics.push(diag('action-index', `Action "${actionName}" requires an integer index for "${target}".`, step.range));
          continue;
        }
        if (rawIndex < 0 || rawIndex >= current.length) {
          diagnostics.push(diag('action-index', `Action "${actionName}" index ${rawIndex} is out of range for "${target}".`, step.range));
          continue;
        }
        if ('remove' in step) {
          const next = [...current];
          next.splice(rawIndex, 1);
          candidate[target] = deepFreeze(next);
          continue;
        }
        const value = evaluateStep(step.value);
        if (!isJsonValue(value)) {
          diagnostics.push(diag('action-value', `Action "${actionName}" produced a non-JSON value.`, step.range));
          continue;
        }
        const next = [...current];
        next[rawIndex] = cloneJson(value);
        candidate[target] = deepFreeze(next);
      } catch (error) {
        const exprError = error as ExpressionError;
        diagnostics.push(diag(
          exprError.code ?? 'action-expression',
          `Action "${actionName}" failed: ${exprError.message}`,
          actionRange,
        ));
      }
    }

    if (diagnostics.length > 0) return { ok: false, diagnostics };

    for (const target of targets) {
      if (!jsonEqual(candidate[target], state[target])) changedStates.add(target);
    }
    if (changedStates.size === 0) return { ok: true, revision };

    const prepared = prepareState(candidate, changedStates, actionRange);
    if (!prepared.ok) return prepared;
    commit(prepared.state, prepared.computed, prepared.changed);
    return { ok: true, revision };
  }

  async function dispatchAsync(actionName: string, locals?: Record<string, Json>): Promise<ReturnType<Runtime['dispatch']>> {
    assertActive();
    const steps = document.actions[actionName];
    if (!steps) {
      return {
        ok: false,
        diagnostics: [diag('action-not-found', `Unknown action "${actionName}".`)],
      };
    }
    const first = steps[0];
    if (steps.length !== 1 || !('call' in first)) {
      return dispatch(actionName, locals);
    }

    const step = first;
    const capability = options.capabilities?.[step.call];

    // latest-wins: cancel any older request for this action before starting.
    const previous = pending.get(actionName);
    if (previous) {
      pending.delete(actionName);
      previous.controller.abort();
    }

    requestCounter += 1;
    const requestId = requestCounter;
    const controller = new AbortController();
    const request: PendingRequest = { requestId, controller };
    pending.set(actionName, request);
    updateResource(actionName, { status: 'pending', data: null, error: null, requestId });

    let input: Record<string, Json>;
    try {
      input = {};
      for (const [name, value] of Object.entries(step.input)) {
        Object.defineProperty(input, name, {
          value: evaluateSource(value, locals),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    } catch (error) {
      const exprError = error as ExpressionError;
      if (pending.get(actionName) === request) {
        pending.delete(actionName);
        updateResource(actionName, {
          status: 'error',
          data: null,
          error: exprError.message,
          requestId,
        });
      }
      return {
        ok: false,
        diagnostics: [diag(
          exprError.code ?? 'action-input',
          `Action "${actionName}" input failed: ${exprError.message}`,
        )],
      };
    }

    if (!capability) {
      if (pending.get(actionName) === request) {
        pending.delete(actionName);
        updateResource(actionName, {
          status: 'error',
          data: null,
          error: `No capability registered for "${step.call}".`,
          requestId,
        });
      }
      return {
        ok: false,
        diagnostics: [diag(
          'capability-missing',
          `No capability is registered for "${step.call}" (action "${actionName}").`,
        )],
      };
    }

    try {
      const result = await capability(input as Json, { signal: controller.signal, action: actionName });
      if (disposed) {
        return {
          ok: false,
          diagnostics: [diag('runtime-disposed', 'The runtime was disposed before the response arrived.')],
        };
      }
      if (pending.get(actionName) !== request) {
        return {
          ok: false,
          diagnostics: [diag(
            'action-superseded',
            `Action "${actionName}" response was discarded because a newer request replaced it.`,
          )],
        };
      }
      pending.delete(actionName);
      if (!isJsonValue(result)) {
        updateResource(actionName, {
          status: 'error',
          data: null,
          error: 'The capability returned a non-JSON value.',
          requestId,
        });
        return {
          ok: false,
          diagnostics: [diag('capability-result', `Capability "${step.call}" returned a non-JSON value.`)],
        };
      }
      updateResource(actionName, {
        status: 'success',
        data: deepFreeze(cloneJson(result)),
        error: null,
        requestId,
      });
      return { ok: true, revision };
    } catch (error) {
      if (pending.get(actionName) !== request) {
        return {
          ok: false,
          diagnostics: [diag(
            controller.signal.aborted ? 'action-cancelled' : 'action-superseded',
            `Action "${actionName}" was cancelled or replaced before it completed.`,
          )],
        };
      }
      pending.delete(actionName);
      if (controller.signal.aborted) {
        return {
          ok: false,
          diagnostics: [diag('action-cancelled', `Action "${actionName}" was cancelled.`)],
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      updateResource(actionName, { status: 'error', data: null, error: message, requestId });
      return {
        ok: false,
        diagnostics: [diag('capability-error', `Action "${actionName}" failed: ${message}`)],
      };
    }
  }

  function cancel(actionName: string): void {
    if (disposed) return;
    const request = pending.get(actionName);
    if (!request) return;
    pending.delete(actionName);
    request.controller.abort();
    updateResource(actionName, {
      status: 'idle',
      data: null,
      error: null,
      requestId: request.requestId,
    });
  }

  function evaluate(value: ValueSource, locals?: Record<string, Json>): Json {
    assertActive();
    return evaluateSource(value, locals);
  }

  function subscribe(names: readonly string[], listener: () => void): () => void {
    assertActive();
    const subscription: Subscription = { names: new Set(names), listener };
    subscriptions.add(subscription);
    return () => {
      subscriptions.delete(subscription);
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const request of pending.values()) request.controller.abort();
    pending.clear();
    subscriptions.clear();
    state = {};
    computed = {};
    resources = {};
  }

  function getSnapshot(): RuntimeSnapshot {
    assertActive();
    return snapshot;
  }

  return {
    snapshot: getSnapshot,
    dispatch,
    dispatchAsync,
    cancel,
    writeBinding,
    evaluate,
    subscribe,
    dispose,
  };
}
