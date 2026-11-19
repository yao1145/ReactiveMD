import {
  localKey,
  type Diagnostic,
  type LocalDocument,
  type LocalNode,
  type LocalRuntime,
  type LocalRuntimeOptions,
  type LocalSnapshot,
  type LocalSubmissionFieldCheck,
  type LocalSubmissionFieldsResult,
  type LocalValue,
} from '../types';
import type { LocalStateRetentionDrop } from './retention';
import { createNetworkSession, type Json, type NetworkSession } from '../../runtime-services/network';
import {
  compileMetadataExpression,
  loadRuntimeCore,
  rangeOrderDiagnostic,
  RUNTIME_EXPRESSION_CACHE_LIMIT,
  runtimeDocumentProblem,
  slotRelationError,
  valueDiagnosticFor,
  type RuntimeCore,
} from './runtime-document';
import { componentStateKey, localSourceDigest } from '../../runtime-services/identity';
import {
  compileExpression,
  interpolate,
  LocalExpressionError,
  localValueBudgetIssue,
  type LocalExpression,
} from '../evaluation/expression';
import { walkLocalNodes } from '../source/source-context';
import { createLocalRuntimeServices, type LocalRuntimeServices } from '../../runtime-services/runtime';
import {
  cloneValue,
  diagnosticFor,
  parameterDiagnostic,
  validateExternalValue,
  validateValue,
  type DynamicRead,
} from './runtime-values';
import { evaluateComputations } from '../evaluation/computations';
import { diagnosticEnglish, localDiagnosticDetails } from '../configuration/diagnostics';
import {
  boundLocalDiagnosticMessage,
  LOCAL_VALIDATION_EXPRESSION_CODE,
  LOCAL_VALIDATION_FAILED_CODE,
  LOCAL_VALIDATION_FALLBACK_MESSAGE,
  validationDiagnostic,
} from '../evaluation/validation';
import { migrateRuntimeState } from './runtime-migration';

function cloneDiagnostic(diagnostic: Diagnostic): Diagnostic {
  return { ...diagnostic, range: { ...diagnostic.range } };
}

function valuesEqual(a: LocalValue | undefined, b: LocalValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => entry === b[index]);
  }
  return a === b;
}

function freezeState(state: Record<string, LocalValue>): Readonly<Record<string, LocalValue>> {
  for (const [key, value] of Object.entries(state)) {
    // Already-frozen arrays keep their identity across commits, so dependency
    // slices compare equal for bindings a write did not touch.
    if (Array.isArray(value) && !Object.isFrozen(value)) {
      state[key] = Object.freeze([...value]) as unknown as LocalValue;
    }
  }
  return Object.freeze(state);
}

export interface LocalRuntimeUpdateOptions {
  /**
   * Announce the adopted revision to subscribers (default true). The document
   * view stages updates with `false` and flushes after React commits, so no
   * subscriber is notified during render.
   */
  readonly notify?: boolean;
}

export interface LocalRuntimeDocumentUpdate {
  /** False when the next document could not be adopted; the runtime is unchanged. */
  readonly ok: boolean;
  /** True when the document identity was adopted (state may or may not differ). */
  readonly changed: boolean;
  /** Revision after the call; unchanged when `ok` is false. */
  readonly revision: number;
  readonly retained: readonly string[];
  readonly dropped: readonly LocalStateRetentionDrop[];
  readonly diagnostics: readonly Diagnostic[];
}

interface RuntimeController {
  update(next: LocalDocument, notify: boolean): LocalRuntimeDocumentUpdate;
  notify(): void;
  bindNetworkExternals(session: NetworkSession, report?: (diagnostics: Diagnostic[]) => void): () => void;
}

const runtimeControllers = new WeakMap<LocalRuntime, RuntimeController>();

function freezeUpdate(result: LocalRuntimeDocumentUpdate): LocalRuntimeDocumentUpdate {
  return Object.freeze({
    ok: result.ok,
    changed: result.changed,
    revision: result.revision,
    retained: Object.freeze([...result.retained]),
    dropped: Object.freeze(result.dropped.map((entry) => Object.freeze({ ...entry }))),
    diagnostics: Object.freeze([...result.diagnostics]),
  });
}

/**
 * Adopt a freshly compiled document without discarding the runtime object.
 * Values migrate with the same rules as `planLocalStateRetention` /
 * `applyLocalStateRetention`: an unchanged public binding keeps its value, a
 * value the new constraints reject falls back to the new author initial, and
 * type, initial-definition, anonymous, timer, checklist, renamed or removed
 * bindings reset conservatively. Multi-slot ranges stay globally ordered.
 */
export function updateLocalRuntime(
  runtime: LocalRuntime,
  next: LocalDocument,
  options?: LocalRuntimeUpdateOptions,
): LocalRuntimeDocumentUpdate {
  const controller = runtimeControllers.get(runtime);
  if (!controller) {
    throw new TypeError('updateLocalRuntime requires a runtime created by createLocalRuntime.');
  }
  return controller.update(next, options?.notify !== false);
}

/** Flush a staged document update to subscribers after React commits. */
export function notifyLocalRuntime(runtime: LocalRuntime): void {
  runtimeControllers.get(runtime)?.notify();
}

/** Connect a view-scoped network session to a ReactiveMD runtime. */
export function bindLocalNetworkExternals(
  runtime: LocalRuntime,
  session: NetworkSession,
  report?: (diagnostics: Diagnostic[]) => void,
): () => void {
  return runtimeControllers.get(runtime)?.bindNetworkExternals(session, report) ?? (() => {});
}

export function createLocalRuntime(document: LocalDocument, options?: LocalRuntimeOptions): LocalRuntime {
  const problem = runtimeDocumentProblem(document);
  if (problem) throw new Error(problem);

  const ownsServices = options?.services === undefined;
  const networkSession = createNetworkSession(options?.network);
  const submissionFields = new Map<string, Map<LocalSubmissionFieldCheck, string>>();
  const sourceDigest = localSourceDigest(document.source);

  /** Source-keyed cache shared by control expressions and document metadata. */
  const expressions = new Map<string, LocalExpression>();
  const metadataExpressions = new Map<string, LocalExpression>();
  let core = loadRuntimeCore(document, metadataExpressions);

  /** Internal reads always go through the core of the current document. */
  const current = (): RuntimeCore => core;

  const knownStateKeys = (): ReadonlySet<string> => {
    const keys = new Set<string>();
    for (const node of walkLocalNodes(core.document.nodes)) {
      if (node.name === undefined) continue;
      keys.add(componentStateKey({
        documentId: options?.documentId,
        sourceDigest,
        nodeId: node.id,
        stateKey: node.attrs?.['state-key'],
      }));
    }
    return keys;
  };
  const services: LocalRuntimeServices = options?.services ?? createLocalRuntimeServices({
    documentId: options?.documentId,
    sourceDigest,
    randomSeed: options?.randomSeed,
    componentState: options?.componentState,
    ...(options?.componentStateStorage === undefined
      ? {}
      : { componentStateStorage: options.componentStateStorage }),
    ...(options?.componentStateWriteDelayMs === undefined
      ? {}
      : { componentStateWriteDelayMs: options.componentStateWriteDelayMs }),
    ...(options?.configKey === undefined ? {} : { configKey: options.configKey }),
    ...(options?.legacyConfigKeys === undefined ? {} : { legacyConfigKeys: options.legacyConfigKeys }),
    ...(ownsServices ? { knownStateKeys } : {}),
  });

  const externalState: Record<string, LocalValue> = {};
  const mappedExternals = new Map<Record<string, LocalValue>, () => void>();
  for (const [name, meta] of Object.entries(document.externals ?? {})) {
    const raw = options?.externalValues?.[name];
    if (raw === undefined) continue;
    const checked = validateExternalValue(meta.type, raw);
    if (checked.ok) externalState[name] = checked.value;
  }
  const selectExternals = (
    loaded: RuntimeCore,
    source: Readonly<Record<string, LocalValue>>,
  ): Record<string, LocalValue> => {
    const values: Record<string, LocalValue> = {};
    for (const [name, meta] of Object.entries(loaded.document.externals ?? {})) {
      if (!Object.hasOwn(source, name)) continue;
      const checked = validateExternalValue(meta.type, source[name]);
      if (checked.ok) values[name] = checked.value;
    }
    return values;
  };
  const externalValuesFor = (loaded: RuntimeCore): Record<string, LocalValue> => {
    const values = selectExternals(loaded, externalState);
    for (const layer of mappedExternals.keys()) Object.assign(values, selectExternals(loaded, layer));
    return values;
  };
  const readDynamic = (node: LocalNode, attribute: 'min' | 'max' | 'required', env: Record<string, LocalValue>, loaded = current()): DynamicRead => {
    const meta = loaded.document.dynamicConstraints?.[node.id]?.[attribute];
    if (!meta) return { present: false };
    const compiled = compileMetadataExpression(meta.source, metadataExpressions);
    if (!compiled.expression) return { present: true, ok: false };
    try {
      const value = compiled.expression.evaluate(env);
      const numeric = meta.numeric;
      if (numeric && (typeof value !== 'number' || !Number.isFinite(value)
        || (numeric.integer === true && !Number.isInteger(value))
        || (numeric.min !== undefined && value < numeric.min)
        || (numeric.max !== undefined && value > numeric.max))) return { present: true, ok: false };
      return { present: true, ok: true, value };
    }
    catch { return { present: true, ok: false }; }
  };

  let state: Record<string, LocalValue> = core.initial;
  let revision = 0;
  /** Controls plus the current revision's readable computation values. */
  let evaluationEnv: Record<string, LocalValue> = {};
  let snapshotState: Record<string, LocalValue> = {};
  let snapshot: LocalSnapshot = { revision: 0, state: freezeState({}) };
  let disposed = false;
  let validationCache: { revision: number; diagnostics: readonly Diagnostic[] } | null = null;
  const listeners = new Set<() => void>();
  const tokens = new Map<string, number>();

  const ensure = (): void => {
    if (disposed) throw new Error('The local interaction runtime has been disposed.');
  };

  function parameterValue(loaded: RuntimeCore, name: string): LocalValue | undefined {
    if (name.startsWith('@') || !Object.hasOwn(loaded.document.bindings, name)) return undefined;
    return Object.hasOwn(state, name) ? state[name] : undefined;
  }

  /**
   * Compute the read-only layer for a candidate document/state pair without
   * publishing it. Constants are not re-evaluated: their static values live on
   * the adopted core. Failed values are exposed through throwing getters in the
   * evaluation environment, so an unrelated expression or a short-circuited
   * branch never observes an error, while a real read propagates the original
   * `LocalExpressionError`.
   */
  const computeLayer = (
    loaded: RuntimeCore,
    controlsState: Record<string, LocalValue>,
  ): {
    environment: Record<string, LocalValue>;
    snapshotState: Record<string, LocalValue>;
  } => {
    const externalValues = externalValuesFor(loaded);
    const missing = new Map<string, LocalExpressionError>();
    for (const name of Object.keys(loaded.document.externals ?? {})) {
      if (!Object.hasOwn(externalValues, name)) missing.set(name, new LocalExpressionError('external-missing', 'External data "' + name + '" is not available.', 0));
    }
    let values: Record<string, LocalValue> = {};
    let errors = new Map<string, LocalExpressionError>();
    if (loaded.computationNames.length > 0) {
      const evaluated = evaluateComputations(
        loaded.computationMetadata,
        loaded.computationOrder,
        loaded.computationExpressions,
        { ...controlsState, ...externalValues },
        loaded.constValues,
        missing,
      );
      values = evaluated.values;
      errors = evaluated.errors;
      for (const [name, error] of loaded.constErrors) {
        if (!Object.hasOwn(values, name)) errors.set(name, error);
      }
      for (const [name, error] of loaded.cycleErrors) {
        if (!Object.hasOwn(values, name)) errors.set(name, error);
      }
    }

    const environment: Record<string, LocalValue> = {};
    for (const [key, value] of Object.entries(controlsState)) environment[key] = value;
    for (const [key, value] of Object.entries(externalValues)) environment[key] = value;
    for (const [key, value] of Object.entries(values)) environment[key] = value;
    for (const [key, error] of [...missing, ...errors]) {
      if (Object.hasOwn(values, key)) continue;
      Object.defineProperty(environment, key, {
        enumerable: true,
        configurable: true,
        get() {
          throw error;
        },
      });
    }

    const merged: Record<string, LocalValue> = {};
    for (const [key, value] of Object.entries(controlsState)) merged[key] = value;
    for (const [key, value] of Object.entries(externalValues)) merged[key] = value;
    for (const [key, value] of Object.entries(values)) merged[key] = value;
    return { environment, snapshotState: merged };
  };

  const refreshComputations = (): void => {
    const layer = computeLayer(current(), state);
    evaluationEnv = layer.environment;
    snapshotState = layer.snapshotState;
  };

  /**
   * Constraints observe the prospective controls and their recomputed values.
   * Missing data and failed computations remain lazy errors, so unrelated or
   * short-circuited expressions can still succeed.
   */
  const prospectiveReader = (overrides: Readonly<Record<string, LocalValue>>, loaded = current(), controlsState = state) => {
    let env: Record<string, LocalValue> | undefined;
    return (node: LocalNode, attribute: 'min' | 'max' | 'required'): DynamicRead => {
      if (!loaded.document.dynamicConstraints?.[node.id]?.[attribute]) return { present: false };
      env ??= computeLayer(loaded, { ...controlsState, ...overrides }).environment;
      return readDynamic(node, attribute, env, loaded);
    };
  };

  const publish = (): void => {
    snapshot = { revision, state: freezeState(snapshotState) };
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const commit = (next: Record<string, LocalValue>): void => {
    state = next;
    revision += 1;
    refreshComputations();
    publish();
    notify();
  };

  const changeExternals = (): void => {
    revision += 1;
    refreshComputations();
    publish();
    notify();
  };

  const writeExternals = (
    values: Readonly<Record<string, LocalValue>>,
    target = externalState,
  ): Diagnostic[] => {
    ensure();
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError('setExternalValues requires an object of external values.');
    }
    const diagnostics: Diagnostic[] = [];
    const normalized: Record<string, LocalValue> = {};
    const keys = Object.keys(values).sort();
    for (const key of keys) {
      if (key === '__proto__') {
        diagnostics.push(parameterDiagnostic('local.runtime.external', 'External names cannot be "__proto__".'));
        continue;
      }
      const externalMetadata = current().document.externals ?? {};
      const meta = Object.hasOwn(externalMetadata, key) ? externalMetadata[key] : undefined;
      if (!meta) {
        const detail = localDiagnosticDetails('local.runtime.external', { name: key });
        diagnostics.push(parameterDiagnostic('local.runtime.external', diagnosticEnglish(detail), detail));
        continue;
      }
      const result = validateExternalValue(meta.type, values[key]);
      if (!result.ok) {
        const detail = localDiagnosticDetails(result.key, { name: key, ...(result.params ?? {}) });
        diagnostics.push(parameterDiagnostic('local.runtime.external', diagnosticEnglish(detail), detail));
        continue;
      }
      normalized[key] = result.value;
    }
    if (diagnostics.length) return diagnostics;
    const changed = keys.some((key) => !valuesEqual(target[key], normalized[key]));
    if (!changed) return [];
    Object.assign(target, normalized);
    changeExternals();
    return [];
  };

  const bindNetworkExternals = (session: NetworkSession, report?: (diagnostics: Diagnostic[]) => void): (() => void) => {
    if (disposed) return () => {};
    const layer: Record<string, LocalValue> = {};
    const release = session.bindExternalValues(values => {
      if (disposed || !mappedExternals.has(layer)) return;
      const diagnostics = writeExternals(values, layer);
      if (diagnostics.length) report?.(diagnostics);
    });
    if (!release) return () => {};
    mappedExternals.set(layer, release);
    return () => {
      if (!mappedExternals.delete(layer)) return;
      release();
      if (!disposed && Object.keys(layer).length) changeExternals();
    };
  };

  const writeParameters = (values: Readonly<Record<string, LocalValue>>): Diagnostic[] => {
    ensure();
    const loaded = current();
    const diagnostics: Diagnostic[] = [];
    const normalized: Record<string, LocalValue> = {};
    const keys = Object.keys(values).sort();
    const read = prospectiveReader(values);
    for (const key of keys) {
      if (key === '__proto__') {
        diagnostics.push(parameterDiagnostic('local.runtime.parameter', 'Parameter names cannot be "__proto__".'));
        continue;
      }
      if (key.startsWith('@')) {
        diagnostics.push(parameterDiagnostic('local.runtime.parameter', `Internal parameter "${key}" cannot be written by name.`));
        continue;
      }
      if (!Object.hasOwn(loaded.document.bindings, key)) {
        diagnostics.push(parameterDiagnostic('local.runtime.parameter', `Unknown parameter "${key}".`));
        continue;
      }
      const binding = loaded.document.bindings[key];
      const result = validateValue(binding, loaded.controls.get(key) ?? [], values[key], read, loaded.valueRules, loaded.legacyValueRules);
      if (!result.ok) {
        diagnostics.push(valueDiagnosticFor(loaded, binding, result.detail));
        continue;
      }
      normalized[key] = cloneValue(result.value);
    }
    if (diagnostics.length) return diagnostics;

    const changed = keys.some((key) => !valuesEqual(state[key], normalized[key]));
    if (!changed) return [];

    const next: Record<string, LocalValue> = { ...state, ...normalized };
    const affected = new Set<string>();
    for (const key of keys) {
      for (const nodeId of loaded.publicSlotOwners.get(key) ?? []) affected.add(nodeId);
    }
    for (const nodeId of [...affected].sort()) {
      if (slotRelationError(loaded, nodeId, next)) {
        diagnostics.push(rangeOrderDiagnostic(loaded, nodeId));
      }
    }
    if (diagnostics.length) return diagnostics;

    commit(next);
    return [];
  };

  const compile = (expression: string): LocalExpression => {
    let compiled = expressions.get(expression);
    if (!compiled) {
      compiled = compileExpression(expression);
      if (expressions.size >= RUNTIME_EXPRESSION_CACHE_LIMIT) {
        const oldest = expressions.keys().next().value;
        if (oldest !== undefined) expressions.delete(oldest);
      }
      expressions.set(expression, compiled);
    }
    return compiled;
  };

  const evaluateValidations = (): Diagnostic[] => {
    const loaded = current();
    const diagnostics: Diagnostic[] = [];
    const source = typeof loaded.document.source === 'string' ? loaded.document.source : '';
    for (const item of loaded.validationRules) {
      if (item.error) {
        diagnostics.push(validationDiagnostic(
          source,
          loaded.validationLineStarts,
          item.rule.range,
          LOCAL_VALIDATION_EXPRESSION_CODE,
          boundLocalDiagnosticMessage(`Validation expression is invalid: ${item.error.message}`),
        ));
        continue;
      }
      if (!item.expression) continue;
      let value: LocalValue;
      try {
        value = item.expression.evaluate(evaluationEnv);
      } catch (error) {
        diagnostics.push(validationDiagnostic(
          source,
          loaded.validationLineStarts,
          item.rule.range,
          LOCAL_VALIDATION_EXPRESSION_CODE,
          boundLocalDiagnosticMessage(
            `Validation expression failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ));
        continue;
      }
      if (typeof value !== 'boolean') {
        diagnostics.push(validationDiagnostic(
          source,
          loaded.validationLineStarts,
          item.rule.range,
          LOCAL_VALIDATION_EXPRESSION_CODE,
          'Validation expression must evaluate to a boolean.',
        ));
        continue;
      }
      if (value) continue;
      diagnostics.push(validationDiagnostic(
        source,
        loaded.validationLineStarts,
        item.rule.range,
        LOCAL_VALIDATION_FAILED_CODE,
        safeValidationMessage(item.rule.message),
      ));
    }
    return diagnostics;
  };

  const safeValidationMessage = (template: string): string => {
    let value: string;
    try {
      value = interpolate(template, evaluationEnv);
    } catch {
      // A message may read the same failing value as its rule. Show a safe
      // default instead of leaking a raw template or an error string.
      value = LOCAL_VALIDATION_FALLBACK_MESSAGE;
    }
    return boundLocalDiagnosticMessage(value);
  };

  const update = (next: LocalDocument, notify: boolean): LocalRuntimeDocumentUpdate => {
    ensure();
    if (next === core.document) {
      return freezeUpdate({ ok: true, changed: false, revision, retained: [], dropped: [], diagnostics: [] });
    }
    if (runtimeDocumentProblem(next)) {
      return freezeUpdate({ ok: false, changed: false, revision, retained: [], dropped: [], diagnostics: [] });
    }
    let nextCore: RuntimeCore;
    try {
      nextCore = loadRuntimeCore(next, metadataExpressions);
    } catch {
      return freezeUpdate({ ok: false, changed: false, revision, retained: [], dropped: [], diagnostics: [] });
    }

    const migrated = migrateRuntimeState(core, state, next, nextCore, prospectiveReader);
    if (Object.keys(migrated.values).length === 0 && Object.keys(next.bindings).length > 0) {
      // A globally invalid slot document was rejected above.
      return freezeUpdate({ ok: false, changed: false, revision, retained: [], dropped: [], diagnostics: [] });
    }

    // Compute the read-only layer before mutating anything, so a failing
    // evaluation cannot leave the runtime half-adopted.
    let layer: ReturnType<typeof computeLayer>;
    try {
      layer = computeLayer(nextCore, migrated.values);
    } catch {
      return freezeUpdate({ ok: false, changed: false, revision, retained: [], dropped: [], diagnostics: [] });
    }

    for (const source of [externalState, ...mappedExternals.keys()]) {
      const nextExternals = selectExternals(nextCore, source);
      for (const name of Object.keys(source)) delete source[name];
      Object.assign(source, nextExternals);
    }
    core = nextCore;
    state = migrated.values;
    evaluationEnv = layer.environment;
    snapshotState = layer.snapshotState;
    validationCache = null;
    revision += 1;
    publish();
    if (notify) {
      for (const listener of listeners) listener();
    }
    return freezeUpdate({
      ok: true,
      changed: true,
      revision,
      retained: migrated.retained,
      dropped: migrated.dropped,
      diagnostics: migrated.diagnostics,
    });
  };

  const subtreeIds = (node: LocalNode): Set<string> => {
    const ids = new Set<string>();
    for(const current of walkLocalNodes([node])){
      ids.add(current.id);
    }
    return ids;
  };

  const runtime: LocalRuntime = {
    network: networkSession.network,
    get document(): LocalDocument {
      return core.document;
    },

    services,

    snapshot(): LocalSnapshot {
      ensure();
      return snapshot;
    },

    get(node: LocalNode, slot?: string): LocalValue {
      ensure();
      const loaded = current();
      const canonical = loaded.nodeIndex.get(node.id);
      if (!canonical) return null;
      const key = slot === undefined
        ? (loaded.slotKeys.get(canonical.id)?.value ?? loaded.bindingByNode.get(canonical.id) ?? localKey(canonical))
        : loaded.slotKeys.get(canonical.id)?.[slot];
      if (!key) return null;
      return Object.hasOwn(state, key) ? cloneValue(state[key]) : null;
    },

    set(node: LocalNode, value: LocalValue, slot?: string): Diagnostic[] {
      ensure();
      const loaded = current();
      const canonical = loaded.nodeIndex.get(node.id);
      if (!canonical) {
        return [diagnosticFor(loaded.document, node, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-writable'))];
      }
      const slots = loaded.slotKeys.get(canonical.id);
      let key: string | undefined;
      if (slot === undefined) {
        if (slots && !slots.value) {
          return [diagnosticFor(loaded.document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.needs-slot'))];
        }
        key = slots?.value ?? loaded.bindingByNode.get(canonical.id) ?? localKey(canonical);
      } else {
        key = slots?.[slot];
        if (!key) {
          return [diagnosticFor(loaded.document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.unknown-slot', { slot }))];
        }
      }
      const binding = Object.hasOwn(loaded.document.bindings, key) ? loaded.document.bindings[key] : undefined;
      if (!binding) {
        return [diagnosticFor(loaded.document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-writable'))];
      }
      const result = validateValue(binding, loaded.controls.get(key) ?? [], value, prospectiveReader({ [key]: value }), loaded.valueRules, loaded.legacyValueRules);
      if (!result.ok) {
        return [diagnosticFor(loaded.document, canonical, 'local.runtime.value', result.detail)];
      }
      const nextValue = cloneValue(result.value);
      if (valuesEqual(state[key], nextValue)) return [];
      const next = { ...state, [key]: nextValue };
      if (slotRelationError(loaded, canonical.id, next)) {
        return [diagnosticFor(loaded.document, canonical, 'local.runtime.value', localDiagnosticDetails('local.runtime.value.range-order'))];
      }
      commit(next);
      return [];
    },

    setMany(node: LocalNode, values: Readonly<Record<string, LocalValue>>): Diagnostic[] {
      ensure();
      const loaded = current();
      const canonical = loaded.nodeIndex.get(node.id);
      if (!canonical) {
        return [diagnosticFor(loaded.document, node, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-writable'))];
      }
      const slots = loaded.slotKeys.get(canonical.id);
      if (!slots) {
        return [diagnosticFor(loaded.document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-multi-slot'))];
      }
      const entries = Object.entries(values);
      if (!entries.length) return [];
      const next: Record<string, LocalValue> = { ...state };
      const env = computeLayer(loaded, { ...state, ...Object.fromEntries(entries.map(([slot, value]) => [slots[slot], value])) }).environment;
      for (const [slot, value] of entries) {
        const key = slots[slot];
        if (!key || !Object.hasOwn(loaded.document.bindings, key)) {
          return [diagnosticFor(loaded.document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.unknown-slot', { slot }))];
        }
        const result = validateValue(loaded.document.bindings[key], loaded.controls.get(key) ?? [], value, (target, attribute) => readDynamic(target, attribute, env), loaded.valueRules, loaded.legacyValueRules);
        if (!result.ok) {
          return [diagnosticFor(loaded.document, canonical, 'local.runtime.value', result.detail)];
        }
        next[key] = cloneValue(result.value);
      }
      if (slotRelationError(loaded, canonical.id, next)) {
        return [diagnosticFor(loaded.document, canonical, 'local.runtime.value', localDiagnosticDetails('local.runtime.value.range-order'))];
      }
      if (entries.every(([slot, value]) => valuesEqual(state[slots[slot]], value))) return [];
      commit(next);
      return [];
    },

    parameterNames(): readonly string[] {
      ensure();
      return current().publicNames;
    },

    getParameter(name: string): LocalValue | undefined {
      ensure();
      const value = parameterValue(current(), name);
      return value === undefined ? undefined : cloneValue(value);
    },

    getParameters(): Readonly<Record<string, LocalValue>> {
      ensure();
      const loaded = current();
      const values: Record<string, LocalValue> = {};
      for (const name of loaded.publicNames) {
        const value = state[name];
        values[name] = Array.isArray(value) ? Object.freeze([...value]) as unknown as LocalValue : value;
      }
      return Object.freeze(values);
    },

    readSubmissionFields(fields): LocalSubmissionFieldsResult {
      ensure();
      const loaded = current();
      const values = new Map<string, LocalValue>();
      const readConstraint = (node: LocalNode, attribute: 'min' | 'max' | 'required'): DynamicRead =>
        readDynamic(node, attribute, evaluationEnv, loaded);
      if (fields.length === 0) return { ok: false, field: '', reason: 'unavailable' };
      for (const field of fields) {
        const value = parameterValue(loaded, field);
        if (value === undefined || values.has(field)) return { ok: false, field, reason: 'unavailable' };
        const checked = validateValue(loaded.document.bindings[field], loaded.controls.get(field) ?? [],
          value, readConstraint, loaded.valueRules, loaded.legacyValueRules);
        if (!checked.ok) {
          const key = checked.detail.key;
          const required = key === 'local.runtime.value.field-required' || key === 'local.runtime.value.date-required';
          return { ok: false, field, reason: required ? 'required' : 'invalid' };
        }
        values.set(field, value);
      }
      const payload: Record<string, Json> = Object.create(null);
      for (const [field, value] of values) {
        for (const [check, nodeId] of submissionFields.get(field) ?? []) {
          if (!loaded.controls.get(field)?.some(node => node.id === nodeId)) continue;
          const reason = check(cloneValue(value));
          if (reason) return { ok: false, field, reason };
        }
        payload[field] = Array.isArray(value) ? Object.freeze([...value]) : value;
      }
      return { ok: true, payload: Object.freeze(payload) };
    },

    registerSubmissionField(node, check): () => void {
      if (disposed) return () => {};
      const loaded = current();
      const key = loaded.slotKeys.get(node.id)?.value ?? loaded.bindingByNode.get(node.id);
      if (!key || key.startsWith('@')) return () => {};
      let checks = submissionFields.get(key);
      if (!checks) submissionFields.set(key, checks = new Map());
      checks.set(check, node.id);
      return () => {
        checks.delete(check);
        if (checks.size === 0 && submissionFields.get(key) === checks) submissionFields.delete(key);
      };
    },

    setParameter(name: string, value: LocalValue): Diagnostic[] {
      ensure();
      const values: Record<string, LocalValue> = Object.create(null);
      values[name] = value;
      return writeParameters(values);
    },

    setParameters(values: Readonly<Record<string, LocalValue>>): Diagnostic[] {
      ensure();
      if (values === null || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError('setParameters requires an object of parameter values.');
      }
      return writeParameters(values);
    },

    getExternal(name: string): LocalValue | undefined {
      ensure();
      if (!Object.hasOwn(current().document.externals ?? {}, name) || !Object.hasOwn(snapshotState, name)) return undefined;
      return cloneValue(snapshotState[name]);
    },

    getExternalValues(): Readonly<Record<string, LocalValue>> {
      ensure();
      const values: Record<string, LocalValue> = {};
      for (const [name, value] of Object.entries(externalValuesFor(current()))) {
        values[name] = Array.isArray(value) ? Object.freeze([...value]) as unknown as LocalValue : value;
      }
      return Object.freeze(values);
    },

    setExternalValues(values: Readonly<Record<string, LocalValue>>): Diagnostic[] {
      return writeExternals(values);
    },

    evaluate(expression: string): LocalValue {
      ensure();
      const value = compile(expression).evaluate(evaluationEnv);
      // Never hand out the array stored inside runtime state.
      return Array.isArray(value) ? value.slice() : value;
    },

    validate(): Diagnostic[] {
      ensure();
      if (validationCache && validationCache.revision === revision) {
        return validationCache.diagnostics.map(cloneDiagnostic);
      }
      const diagnostics = evaluateValidations();
      validationCache = { revision, diagnostics };
      return diagnostics.map(cloneDiagnostic);
    },

    text(template: string): string {
      ensure();
      return interpolate(template, evaluationEnv);
    },

    reset(node: LocalNode): void {
      ensure();
      const loaded = current();
      const canonical = loaded.nodeIndex.get(node.id);
      if (!canonical) return;
      const ids = subtreeIds(canonical);
      const next: Record<string, LocalValue> = { ...state };
      for (const [key, binding] of Object.entries(loaded.document.bindings)) {
        if (!(loaded.controls.get(key) ?? []).some((node) => ids.has(node.id))) continue;
        const budget = localValueBudgetIssue(binding.initial);
        if (budget) {
          throw new LocalExpressionError('expression-budget', `Parameter "${key}": ${diagnosticEnglish(budget)}`, 0);
        }
        next[key] = cloneValue(binding.initial);
      }
      for (const id of ids) tokens.set(id, (tokens.get(id) ?? 0) + 1);
      commit(next);
    },

    resetToken(node: LocalNode): number {
      ensure();
      const canonical = current().nodeIndex.get(node.id);
      return canonical ? (tokens.get(canonical.id) ?? 0) : 0;
    },

    subscribe(listener: () => void): () => void {
      ensure();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      networkSession.dispose();
      for (const release of mappedExternals.values()) release();
      mappedExternals.clear();
      submissionFields.clear();
      // Coalesced saves would otherwise be dropped when a preview is replaced.
      services.state.flush();
      if (ownsServices) services.scheduler.dispose();
      listeners.clear();
      expressions.clear();
      metadataExpressions.clear();
      core.computationExpressions.clear();
      core.constErrors.clear();
      core.cycleErrors.clear();
      core.validationRules.length = 0;
      tokens.clear();
    },
  };

  runtimeControllers.set(runtime, {
    update,
    bindNetworkExternals,
    notify() {
      if (disposed) return;
      for (const listener of listeners) listener();
    },
  });

  refreshComputations();
  publish();
  bindNetworkExternals(networkSession);

  return runtime;
}
