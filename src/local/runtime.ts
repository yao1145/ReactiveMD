import type { Diagnostic } from './types';
import { localDateTimestamp } from './dates';
import {
  compileExpression,
  interpolate,
  localValueBudgetError,
  localValueBudgetIssue,
  LocalExpressionError,
  type LocalExpression,
} from './expression';
import { evaluateComputations, orderComputations } from './computations';

import { diagnosticEnglish, localDiagnosticDetails, type LocalDiagnosticDetails } from './diagnostics';
import { countLocalCodePoints } from './text-length';
import { LOCAL_SYNTAX_VERSION } from './version';
import { isLocalEmail, MAX_LOCAL_EMAIL_LENGTH } from './limits';
import {
  boundLocalDiagnosticMessage,
  isLocalValidation,
  localLineStarts,
  LOCAL_VALIDATION_EXPRESSION_CODE,
  LOCAL_VALIDATION_FAILED_CODE,
  LOCAL_VALIDATION_FALLBACK_MESSAGE,
  validationDiagnostic,
} from './validation';
import { localKey, type LocalBinding, type LocalDocument, type LocalNode, type LocalRuntime, type LocalRuntimeOptions, type LocalSnapshot, type LocalValidation, type LocalValue, type LocalValueKind } from './types';

const EPSILON = 1e-9;
const RUNTIME_EXPRESSION_CACHE_LIMIT = 200;

function cloneValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? value.slice() : value;
}

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

function isValidDate(value: string): boolean {
  return value === '' || localDateTimestamp(value) !== null;
}

function onStep(value: number, base: number, step: number): boolean {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) <= EPSILON * Math.max(1, Math.abs(quotient));
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

function diagnosticFor(document: LocalDocument, node: LocalNode, code: string, detail: LocalDiagnosticDetails): Diagnostic {
  const start = Math.max(0, Math.min(document.source.length, node.range.start));
  const prefix = document.source.slice(0, start).split('\n');
  const message = diagnosticEnglish(detail);
  return {
    code,
    message,
    severity: 'error',
    range: { start, end: Math.max(start + 1, Math.min(document.source.length, node.range.end)) },
    line: prefix.length,
    column: (prefix.at(-1) ?? '').length + 1,
    messageKey: detail.key,
    ...(detail.params ? { params: detail.params } : {}),
  };
}

function parameterDiagnostic(code: string, message: string, detail?: LocalDiagnosticDetails): Diagnostic {
  return {
    code,
    message,
    severity: 'error',
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
    ...(detail ? { messageKey: detail.key, ...(detail.params ? { params: detail.params } : {}) } : {}),
  };
}

function rawAttr(node: LocalNode, name: string): string | undefined {
  return node.attrs?.[name];
}

function staticBoolean(node: LocalNode, name: string): boolean | undefined {
  const raw = rawAttr(node, name);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function staticNumber(node: LocalNode, name: string): number | undefined {
  const raw = rawAttr(node, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function codePointLength(value: string): number {
  return countLocalCodePoints(value);
}

type ValidationResult = { ok: true; value: LocalValue; detail?: undefined } | { ok: false; detail: LocalDiagnosticDetails };

function invalid(key: string, params?: Record<string, unknown>): ValidationResult {
  return { ok: false, detail: localDiagnosticDetails(key, params) };
}

/**
 * Validate one string binding against every registered control that shares the
 * binding. Compiler guarantees are not trusted here: a shared binding must be
 * writable only when all owners accept the value. Length is checked before the
 * email validator, whose shared implementation is linear and length-bounded.
 */
function validateStringControl(
  node: LocalNode,
  value: string,
  dynamic: { min?: string; max?: string; required?: boolean } = {},
): ValidationResult {
  if (node.name === 'date') {
    if (!isValidDate(value)) return invalid('local.runtime.value.date-invalid');
    const required = dynamic.required ?? (staticBoolean(node, 'required') === true);
    if (value === '' && required) {
      return invalid('local.runtime.value.date-required');
    }
    const min = dynamic.min ?? rawAttr(node, 'min');
    const max = dynamic.max ?? rawAttr(node, 'max');
    if (value !== '' && min && value < min) return invalid('local.runtime.value.date-earlier', { min });
    if (value !== '' && max && value > max) return invalid('local.runtime.value.date-later', { max });
    return { ok: true, value };
  }
  if (node.name === 'input' || node.name === 'textarea') {
    const length = codePointLength(value);
    const required = dynamic.required ?? (staticBoolean(node, 'required') === true);
    if (value === '' && required) {
      return invalid('local.runtime.value.field-required');
    }
    const minLength = staticNumber(node, 'min-length');
    const maxLength = staticNumber(node, 'max-length');
    if (minLength !== undefined && minLength > 0 && value !== '' && length < minLength) {
      return invalid('local.runtime.value.min-length', { min: minLength });
    }
    if (maxLength !== undefined && length > maxLength) {
      return invalid('local.runtime.value.max-length', { max: maxLength });
    }
    if (node.name === 'input' && rawAttr(node, 'type') === 'email' && value !== '') {
      if (value.length > MAX_LOCAL_EMAIL_LENGTH) {
        return invalid('local.runtime.value.email-length', { limit: MAX_LOCAL_EMAIL_LENGTH });
      }
      if (!isLocalEmail(value)) return invalid('local.runtime.value.email-invalid');
    }
  }
  return { ok: true, value };
}

type DynamicRead =
  | { present: false }
  | { present: true; ok: true; value: LocalValue }
  | { present: true; ok: false };

function validateValue(
  binding: LocalBinding,
  nodes: LocalNode[],
  value: LocalValue,
  readDynamic: (node: LocalNode, attribute: 'min' | 'max' | 'required') => DynamicRead,
): ValidationResult {
  switch (binding.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid('local.runtime.value.finite-number', { name: binding.name });
      }
      const step = binding.step ?? 1;
      const base = binding.min ?? 0;
      for (const node of nodes) {
        const minRead = readDynamic(node, 'min');
        if (minRead.present && !minRead.ok) return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'min' });
        if (minRead.present && minRead.ok) {
          if (typeof minRead.value !== 'number' || !Number.isFinite(minRead.value)) {
            return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'min' });
          }
          if (value < minRead.value) return invalid('local.runtime.value.min', { name: binding.name, min: minRead.value });
        }
        const maxRead = readDynamic(node, 'max');
        if (maxRead.present && !maxRead.ok) return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'max' });
        if (maxRead.present && maxRead.ok) {
          if (typeof maxRead.value !== 'number' || !Number.isFinite(maxRead.value)) {
            return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'max' });
          }
          if (value > maxRead.value) return invalid('local.runtime.value.max', { name: binding.name, max: maxRead.value });
        }
        if (minRead.present && minRead.ok && maxRead.present && maxRead.ok
          && typeof minRead.value === 'number' && typeof maxRead.value === 'number'
          && minRead.value > maxRead.value) {
          return invalid('local.runtime.value.constraint-range', { name: binding.name });
        }
      }
      if (binding.min !== undefined && value < binding.min) {
        return invalid('local.runtime.value.min', { name: binding.name, min: binding.min });
      }
      if (binding.max !== undefined && value > binding.max) {
        return invalid('local.runtime.value.max', { name: binding.name, max: binding.max });
      }
      if (step > 0 && !onStep(value, base, step)) {
        return invalid('local.runtime.value.step', { name: binding.name, step, base });
      }
      return { ok: true, value };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : invalid('local.runtime.value.boolean', { name: binding.name });
    case 'string': {
      if (typeof value !== 'string') return invalid('local.runtime.value.string', { name: binding.name });
      const budget = localValueBudgetIssue(value);
      if (budget) {
        return invalid('local.runtime.value.budget', { name: binding.name, detail: diagnosticEnglish(budget), detailKey: budget.key, ...budget.params });
      }
      for (const node of nodes) {
        const dynamic: { min?: string; max?: string; required?: boolean } = {};
        if (node.name === 'date') {
          for (const attribute of ['min', 'max'] as const) {
            const read = readDynamic(node, attribute);
            if (!read.present) continue;
            if (!read.ok || typeof read.value !== 'string' || !isValidDate(read.value)) {
              return invalid('local.runtime.value.constraint-date', { name: binding.name, attribute });
            }
            dynamic[attribute] = read.value;
          }
          const minValue = dynamic.min ?? rawAttr(node, 'min');
          const maxValue = dynamic.max ?? rawAttr(node, 'max');
          if (minValue && maxValue && isValidDate(minValue) && isValidDate(maxValue) && minValue > maxValue) {
            return invalid('local.runtime.value.constraint-range', { name: binding.name });
          }
        }
        if (node.name === 'date' || node.name === 'input' || node.name === 'textarea') {
          const requiredRead = readDynamic(node, 'required');
          if (requiredRead.present) {
            if (!requiredRead.ok || typeof requiredRead.value !== 'boolean') {
              return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'required' });
            }
            dynamic.required = requiredRead.value;
          }
        }
        const result = validateStringControl(node, value, dynamic);
        if (!result.ok) return result;
      }
      if (binding.options?.length && !binding.options.includes(value)) {
        return invalid('local.runtime.value.option', { value, options: binding.options.join(', ') });
      }
      return { ok: true, value };
    }
    case 'array': {
      if (!Array.isArray(value)) return invalid('local.runtime.value.array', { name: binding.name });
      const budget = localValueBudgetIssue(value);
      if (budget) {
        return invalid('local.runtime.value.budget', { name: binding.name, detail: diagnosticEnglish(budget), detailKey: budget.key, ...budget.params });
      }
      const chosen = new Set<string>();
      for (const entry of value) {
        if (typeof entry !== 'string') return invalid('local.runtime.value.array-members', { name: binding.name });
        if (binding.options && !binding.options.includes(entry)) {
          return invalid('local.runtime.value.checklist-option', { value: entry });
        }
        chosen.add(entry);
      }
      const ordered = binding.options
        ? binding.options.filter((id) => chosen.has(id))
        : [...chosen];
      if (binding.maxItems !== undefined && ordered.length > binding.maxItems) {
        return invalid('local.runtime.value.max-items', { name: binding.name, max: binding.maxItems });
      }
      return { ok: true, value: ordered };
    }
    case 'null':
      return { ok: true, value };
  }
  return invalid('local.runtime.value.unsupported-type', { name: binding.name });
}

type ExternalCheck =
  | { ok: true; value: LocalValue }
  | { ok: false; key: string; params?: Record<string, string | number | boolean | null> };

/** Validate one host external value against its declared type and budgets. */
function validateExternalValue(kind: LocalValueKind, value: LocalValue): ExternalCheck {
  switch (kind) {
    case 'string': {
      if (typeof value !== 'string') return { ok: false, key: 'local.runtime.external-value', params: { kind: 'string' } };
      const budget = localValueBudgetIssue(value);
      if (budget) return { ok: false, key: 'local.runtime.external-budget', params: { detailKey: budget.key, ...(budget.params ?? {}) } };
      return { ok: true, value };
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, key: 'local.runtime.external-value', params: { kind: 'number' } };
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, key: 'local.runtime.external-value', params: { kind: 'boolean' } };
    case 'array': {
      if (!Array.isArray(value)) return { ok: false, key: 'local.runtime.external-value', params: { kind: 'string-array' } };
      for (const entry of value) {
        if (typeof entry !== 'string') return { ok: false, key: 'local.runtime.external-value', params: { kind: 'string-array' } };
      }
      const budget = localValueBudgetIssue(value as string[]);
      if (budget) return { ok: false, key: 'local.runtime.external-budget', params: { detailKey: budget.key, ...(budget.params ?? {}) } };
      return { ok: true, value: value.slice() as string[] };
    }
    case 'number-array': {
      if (!Array.isArray(value)) return { ok: false, key: 'local.runtime.external-value', params: { kind: 'number-array' } };
      for (const entry of value) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
          return { ok: false, key: 'local.runtime.external-value', params: { kind: 'number-array' } };
        }
      }
      const budget = localValueBudgetIssue(value as number[]);
      if (budget) return { ok: false, key: 'local.runtime.external-budget', params: { detailKey: budget.key, ...(budget.params ?? {}) } };
      return { ok: true, value: value.slice() as number[] };
    }
    case 'null':
    default:
      return { ok: false, key: 'local.runtime.external-value', params: { kind: String(kind) } };
  }
}

export function createLocalRuntime(document: LocalDocument, options?: LocalRuntimeOptions): LocalRuntime {
  if (!document || document.syntax !== 'local') {
    throw new Error('createLocalRuntime requires a local interaction document.');
  }
  if ((document.syntaxVersion !== undefined && document.syntaxVersion !== LOCAL_SYNTAX_VERSION)
    || (document.versionDeclaration && document.versionDeclaration.version !== LOCAL_SYNTAX_VERSION)) {
    throw new Error(`createLocalRuntime requires ${LOCAL_SYNTAX_VERSION}; migrate the source before constructing a runtime.`);
  }

  const nodeIndex = new Map<string, LocalNode>();
  const collectNodes = (nodes: LocalNode[]): void => {
    for (const node of nodes) {
      nodeIndex.set(node.id, node);
      if (node.children) collectNodes(node.children);
    }
  };
  collectNodes(document.nodes);

  const initial: Record<string, LocalValue> = {};
  /** Registered controls per binding; caller-supplied node metadata is ignored. */
  const controls = new Map<string, LocalNode[]>();
  for (const [key, binding] of Object.entries(document.bindings)) {
    const budget = localValueBudgetIssue(binding.initial);
    if (budget) {
      throw new LocalExpressionError('expression-budget', `Parameter "${key}": ${diagnosticEnglish(budget)}`, 0);
    }
    initial[key] = cloneValue(binding.initial);
    const nodes: LocalNode[] = [];
    for (const id of binding.nodeIds) {
      const node = nodeIndex.get(id);
      if (node) nodes.push(node);
    }
    controls.set(key, nodes);
  }

  /** Canonical node id -> slot -> binding key, for range-slider and coordinate. */
  const slotKeys = new Map<string, Record<string, string>>();
  for (const [id, slots] of Object.entries(document.bindingSlots ?? {})) {
    slotKeys.set(id, { ...slots });
  }

  const publicNames = Object.freeze(
    Object.keys(document.bindings).filter((key) => !key.startsWith('@')).sort(),
  );

  /** Public slot binding key -> ids of the components that own it. */
  const publicSlotOwners = new Map<string, Set<string>>();
  for (const [id, slots] of slotKeys) {
    for (const key of Object.values(slots)) {
      if (key.startsWith('@')) continue;
      const owners = publicSlotOwners.get(key) ?? new Set<string>();
      owners.add(id);
      publicSlotOwners.set(key, owners);
    }
  }

  /** Reject a range whose start would cross its end before any commit. */
  const slotRelationError = (nodeId: string, next: Record<string, LocalValue>): boolean => {
    const slots = slotKeys.get(nodeId);
    if (!slots?.start || !slots?.end) return false;
    const start = next[slots.start];
    const end = next[slots.end];
    return typeof start === 'number' && typeof end === 'number' && start > end;
  };

  /* --------------------------------------------------------- externals */

  /**
   * Host-provided read-only values. They are declared by the document, filled
   * by the host and never written into `document.bindings`; a missing
   * declaration name stays unavailable and only affects expressions that read
   * it.
   */
  const externalMetadata = document.externals ?? {};
  const externalNames = Object.freeze(Object.keys(externalMetadata).sort());
  const externalState: Record<string, LocalValue> = {};
  if (options?.externalValues && externalNames.length) {
    for (const name of externalNames) {
      const raw = options.externalValues[name];
      if (raw === undefined) continue;
      const result = validateExternalValue(externalMetadata[name].type, raw);
      if (result.ok) externalState[name] = result.value;
    }
  }

  const unavailableExternals = (): Map<string, LocalExpressionError> => {
    const missing = new Map<string, LocalExpressionError>();
    for (const name of externalNames) {
      if (Object.hasOwn(externalState, name)) continue;
      missing.set(name, new LocalExpressionError('external-missing', `External data "${name}" is not available.`, 0));
    }
    return missing;
  };

  /* ------------------------------------------------- dynamic constraints */

  const dynamicMetadata = document.dynamicConstraints ?? {};
  const dynamicExpressions = new Map<string, LocalExpression | null>();
  const readDynamic = (
    node: LocalNode,
    attribute: 'min' | 'max' | 'required',
    env: Record<string, LocalValue>,
  ): DynamicRead => {
    const meta = dynamicMetadata[node.id]?.[attribute];
    if (!meta) return { present: false };
    const cacheKey = `${node.id}:${attribute}`;
    let compiled = dynamicExpressions.get(cacheKey);
    if (compiled === undefined) {
      try {
        compiled = compileExpression(meta.source);
      } catch {
        compiled = null;
      }
      dynamicExpressions.set(cacheKey, compiled);
    }
    if (!compiled) return { present: true, ok: false };
    try {
      return { present: true, ok: true, value: compiled.evaluate(env) };
    } catch {
      return { present: true, ok: false };
    }
  };

  /* --------------------------------------------------------- computations */

  /**
   * Read-only values are metadata, not controls. Both caches are internal:
   * `initialState` and `bindings` remain controls-only, while `snapshot().state`
   * publishes values that succeeded in the current revision.
   */
  const computationMetadata = document.computations ?? {};
  const computationNames = Object.keys(computationMetadata);
  const computationExpressions = new Map<string, LocalExpression>();
  for (const [name, meta] of Object.entries(computationMetadata)) {
    try {
      computationExpressions.set(name, compileExpression(meta.source));
    } catch {
      // A hand-built document can carry an invalid expression. The runtime
      // reports it through the same lazy-error channel as a domain failure.
    }
  }
  const { order: computationOrder, cyclic: cyclicComputations } = orderComputations(computationMetadata);
  const constValues: Record<string, LocalValue> = {};
  const constErrors = new Map<string, LocalExpressionError>();
  const normalizeComputationError = (error: unknown): LocalExpressionError =>
    error instanceof LocalExpressionError
      ? error
      : new LocalExpressionError('expression-eval', error instanceof Error ? error.message : String(error), 0);
  for (const name of computationOrder) {
    const meta = computationMetadata[name];
    if (!meta || meta.kind !== 'const') continue;
    if (Object.hasOwn(meta, 'value')) {
      const value = meta.value as LocalValue;
      const budget = localValueBudgetError(value);
      if (budget) {
        constErrors.set(name, new LocalExpressionError('expression-budget', `Constant "${name}": ${budget}`, 0));
        continue;
      }
      constValues[name] = cloneValue(value);
      continue;
    }
    const compiled = computationExpressions.get(name);
    if (!compiled) {
      constErrors.set(name, new LocalExpressionError('expression-eval', `Constant "${name}" cannot be evaluated.`, 0));
      continue;
    }
    try {
      const value = compiled.evaluate({ ...constValues });
      const budget = localValueBudgetError(value);
      if (budget) {
        constErrors.set(name, new LocalExpressionError('expression-budget', `Constant "${name}": ${budget}`, 0));
        continue;
      }
      constValues[name] = cloneValue(value);
    } catch (error) {
      constErrors.set(name, normalizeComputationError(error));
    }
  }
  const cycleErrors = new Map<string, LocalExpressionError>();
  for (const name of cyclicComputations) {
    cycleErrors.set(name, new LocalExpressionError('expression-cycle', `Computation "${name}" is part of a dependency cycle.`, 0));
  }

  /* --------------------------------------------------------- validations */

  /**
   * Advisory rules are metadata. Each rule is compiled once and evaluated
   * independently, so a failure in one rule never hides another or blocks
   * writes. `validate()` caches results per revision and returns clones.
   */
  const validationRules: { rule: LocalValidation; expression: LocalExpression | null; error: LocalExpressionError | null }[] = [];
  if (Array.isArray(document.validations)) {
    for (const rule of document.validations) {
      if (!isLocalValidation(rule)) continue;
      try {
        validationRules.push({ rule, expression: compileExpression(rule.expression), error: null });
      } catch (error) {
        validationRules.push({ rule, expression: null, error: normalizeComputationError(error) });
      }
    }
  }
  const validationLineStarts = localLineStarts(typeof document.source === 'string' ? document.source : '');
  let validationCache: { revision: number; diagnostics: readonly Diagnostic[] } | null = null;

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

  const evaluateValidations = (): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const source = typeof document.source === 'string' ? document.source : '';
    for (const item of validationRules) {
      if (item.error) {
        diagnostics.push(validationDiagnostic(
          source,
          validationLineStarts,
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
          validationLineStarts,
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
          validationLineStarts,
          item.rule.range,
          LOCAL_VALIDATION_EXPRESSION_CODE,
          'Validation expression must evaluate to a boolean.',
        ));
        continue;
      }
      if (value) continue;
      diagnostics.push(validationDiagnostic(
        source,
        validationLineStarts,
        item.rule.range,
        LOCAL_VALIDATION_FAILED_CODE,
        safeValidationMessage(item.rule.message),
      ));
    }
    return diagnostics;
  };

  let state: Record<string, LocalValue> = initial;
  let revision = 0;
  let computationValues: Record<string, LocalValue> = {};
  let computationErrors = new Map<string, LocalExpressionError>();
  /** Controls plus the current revision's readable computation values. */
  let evaluationEnv: Record<string, LocalValue> = {};
  let snapshotState: Record<string, LocalValue> = {};
  let snapshot: LocalSnapshot = { revision: 0, state: freezeState({}) };
  let disposed = false;
  const listeners = new Set<() => void>();
  const tokens = new Map<string, number>();
  const expressions = new Map<string, LocalExpression>();

  const ensure = (): void => {
    if (disposed) throw new Error('The local interaction runtime has been disposed.');
  };

  /**
   * Recompute the read-only layer for the current controls. Constants are not
   * re-evaluated: their static values were resolved once above. Failed values
   * are exposed through throwing getters in the evaluation environment, so an
   * unrelated expression or a short-circuited branch never observes an error,
   * while a real read propagates the original `LocalExpressionError`.
   */
  const refreshComputations = (): void => {
    const missing = unavailableExternals();
    if (computationNames.length === 0) {
      computationValues = {};
      computationErrors = new Map();
    } else {
      const inputs: Record<string, LocalValue> = { ...state };
      for (const [name, value] of Object.entries(externalState)) inputs[name] = value;
      const evaluated = evaluateComputations(
        computationMetadata,
        computationOrder,
        computationExpressions,
        inputs,
        constValues,
        missing,
      );
      computationValues = evaluated.values;
      computationErrors = evaluated.errors;
      for (const [name, error] of constErrors) {
        if (!Object.hasOwn(computationValues, name)) computationErrors.set(name, error);
      }
      for (const [name, error] of cycleErrors) {
        if (!Object.hasOwn(computationValues, name)) computationErrors.set(name, error);
      }
    }

    const environment: Record<string, LocalValue> = {};
    for (const [key, value] of Object.entries(state)) environment[key] = value;
    for (const [key, value] of Object.entries(externalState)) environment[key] = value;
    for (const [key, value] of Object.entries(computationValues)) environment[key] = value;
    for (const [key, error] of missing) {
      if (Object.hasOwn(environment, key)) continue;
      Object.defineProperty(environment, key, {
        enumerable: true,
        configurable: true,
        get() {
          throw error;
        },
      });
    }
    for (const [key, error] of computationErrors) {
      if (Object.hasOwn(computationValues, key)) continue;
      Object.defineProperty(environment, key, {
        enumerable: true,
        configurable: true,
        get() {
          throw error;
        },
      });
    }
    evaluationEnv = environment;

    const merged: Record<string, LocalValue> = {};
    for (const [key, value] of Object.entries(state)) merged[key] = value;
    for (const [key, value] of Object.entries(externalState)) merged[key] = value;
    for (const [key, value] of Object.entries(computationValues)) merged[key] = value;
    snapshotState = merged;
  };

  /**
   * Constraint expressions read the current plain values, plus the values being
   * written, without touching throwing getters for unavailable externals.
   */
  const constraintEnvironment = (overrides: Readonly<Record<string, LocalValue>> = {}): Record<string, LocalValue> => {
    const env: Record<string, LocalValue> = {};
    for (const [key, value] of Object.entries(state)) env[key] = value;
    for (const [key, value] of Object.entries(externalState)) env[key] = value;
    for (const [key, value] of Object.entries(computationValues)) env[key] = value;
    for (const [key, value] of Object.entries(overrides)) env[key] = value;
    return env;
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

  const writeExternals = (values: Readonly<Record<string, LocalValue>>): Diagnostic[] => {
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
    const changed = keys.some((key) => !valuesEqual(externalState[key], normalized[key]));
    if (!changed) return [];
    for (const [key, value] of Object.entries(normalized)) externalState[key] = value;
    revision += 1;
    refreshComputations();
    publish();
    notify();
    return [];
  };

  const valueDiagnostic = (binding: LocalBinding, detail: LocalDiagnosticDetails): Diagnostic => {
    const node = (controls.get(binding.name) ?? [])[0]
      ?? (binding.owner ? nodeIndex.get(binding.owner) : undefined)
      ?? (binding.nodeIds[0] ? nodeIndex.get(binding.nodeIds[0]) : undefined);
    return node
      ? diagnosticFor(document, node, 'local.runtime.value', detail)
      : parameterDiagnostic('local.runtime.value', diagnosticEnglish(detail));
  };

  const writeParameters = (values: Readonly<Record<string, LocalValue>>): Diagnostic[] => {
    ensure();
    const diagnostics: Diagnostic[] = [];
    const normalized: Record<string, LocalValue> = {};
    const keys = Object.keys(values).sort();
    const env = constraintEnvironment(values);
    for (const key of keys) {
      if (key === '__proto__') {
        diagnostics.push(parameterDiagnostic('local.runtime.parameter', 'Parameter names cannot be "__proto__".'));
        continue;
      }
      if (key.startsWith('@')) {
        diagnostics.push(parameterDiagnostic('local.runtime.parameter', `Internal parameter "${key}" cannot be written by name.`));
        continue;
      }
      if (!Object.hasOwn(document.bindings, key)) {
        diagnostics.push(parameterDiagnostic('local.runtime.parameter', `Unknown parameter "${key}".`));
        continue;
      }
      const binding = document.bindings[key];
      const result = validateValue(binding, controls.get(key) ?? [], values[key], (node, attribute) => readDynamic(node, attribute, env));
      if (!result.ok) {
        diagnostics.push(valueDiagnostic(binding, result.detail));
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
      for (const nodeId of publicSlotOwners.get(key) ?? []) affected.add(nodeId);
    }
    for (const nodeId of [...affected].sort()) {
      const crossing = slotRelationError(nodeId, next);
      if (crossing) {
        const node = nodeIndex.get(nodeId);
        diagnostics.push(node
          ? diagnosticFor(document, node, 'local.runtime.value', localDiagnosticDetails('local.runtime.value.range-order'))
          : parameterDiagnostic('local.runtime.value', diagnosticEnglish(localDiagnosticDetails('local.runtime.value.range-order'))));
      }
    }
    if (diagnostics.length) return diagnostics;

    commit(next);
    return [];
  };
  refreshComputations();
  publish();

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

  const subtreeIds = (node: LocalNode): Set<string> => {
    const ids = new Set<string>();
    const walk = (current: LocalNode): void => {
      ids.add(current.id);
      for (const child of current.children ?? []) walk(child);
    };
    walk(node);
    return ids;
  };

  const runtime: LocalRuntime = {
    document,

    snapshot(): LocalSnapshot {
      ensure();
      return snapshot;
    },

    get(node: LocalNode, slot?: string): LocalValue {
      ensure();
      const canonical = nodeIndex.get(node.id);
      if (!canonical) return null;
      const key = slot === undefined
        ? localKey(canonical)
        : slotKeys.get(canonical.id)?.[slot];
      if (!key) return null;
      return Object.hasOwn(state, key) ? cloneValue(state[key]) : null;
    },

    set(node: LocalNode, value: LocalValue, slot?: string): Diagnostic[] {
      ensure();
      const canonical = nodeIndex.get(node.id);
      if (!canonical) {
        return [diagnosticFor(document, node, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-writable'))];
      }
      const slots = slotKeys.get(canonical.id);
      let key: string | undefined;
      if (slot === undefined) {
        if (slots) {
          return [diagnosticFor(document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.needs-slot'))];
        }
        key = localKey(canonical);
      } else {
        key = slots?.[slot];
        if (!key) {
          return [diagnosticFor(document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.unknown-slot', { slot }))];
        }
      }
      const binding = Object.hasOwn(document.bindings, key) ? document.bindings[key] : undefined;
      if (!binding) {
        return [diagnosticFor(document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-writable'))];
      }
      const result = validateValue(
        binding,
        controls.get(key) ?? [],
        value,
        (target, attribute) => readDynamic(target, attribute, constraintEnvironment({ [key]: value })),
      );
      if (!result.ok) {
        return [diagnosticFor(document, canonical, 'local.runtime.value', result.detail)];
      }
      const nextValue = cloneValue(result.value);
      if (valuesEqual(state[key], nextValue)) return [];
      const next = { ...state, [key]: nextValue };
      const crossing = slotRelationError(canonical.id, next);
      if (crossing) {
        return [diagnosticFor(document, canonical, 'local.runtime.value', localDiagnosticDetails('local.runtime.value.range-order'))];
      }
      commit(next);
      return [];
    },

    setMany(node: LocalNode, values: Readonly<Record<string, LocalValue>>): Diagnostic[] {
      ensure();
      const canonical = nodeIndex.get(node.id);
      if (!canonical) {
        return [diagnosticFor(document, node, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-writable'))];
      }
      const slots = slotKeys.get(canonical.id);
      if (!slots) {
        return [diagnosticFor(document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.no-multi-slot'))];
      }
      const entries = Object.entries(values);
      if (!entries.length) return [];
      const next: Record<string, LocalValue> = { ...state };
      const env = constraintEnvironment(values);
      for (const [slot, value] of entries) {
        const key = slots[slot];
        if (!key || !Object.hasOwn(document.bindings, key)) {
          return [diagnosticFor(document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.unknown-slot', { slot }))];
        }
        const result = validateValue(document.bindings[key], controls.get(key) ?? [], value, (target, attribute) => readDynamic(target, attribute, env));
        if (!result.ok) {
          return [diagnosticFor(document, canonical, 'local.runtime.value', result.detail)];
        }
        next[key] = cloneValue(result.value);
      }
      const crossing = slotRelationError(canonical.id, next);
      if (crossing) {
        return [diagnosticFor(document, canonical, 'local.runtime.value', localDiagnosticDetails('local.runtime.value.range-order'))];
      }
      if (entries.every(([slot, value]) => valuesEqual(state[slots[slot]], value))) return [];
      commit(next);
      return [];
    },

    parameterNames(): readonly string[] {
      ensure();
      return publicNames;
    },

    getParameter(name: string): LocalValue | undefined {
      ensure();
      if (name.startsWith('@') || !Object.hasOwn(document.bindings, name)) return undefined;
      return Object.hasOwn(state, name) ? cloneValue(state[name]) : undefined;
    },

    getParameters(): Readonly<Record<string, LocalValue>> {
      ensure();
      const values: Record<string, LocalValue> = {};
      for (const name of publicNames) {
        const value = state[name];
        values[name] = Array.isArray(value) ? Object.freeze([...value]) as unknown as LocalValue : value;
      }
      return Object.freeze(values);
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
      if (!Object.hasOwn(externalMetadata, name) || !Object.hasOwn(externalState, name)) return undefined;
      return cloneValue(externalState[name]);
    },

    getExternalValues(): Readonly<Record<string, LocalValue>> {
      ensure();
      const values: Record<string, LocalValue> = {};
      for (const [name, value] of Object.entries(externalState)) {
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
      const canonical = nodeIndex.get(node.id);
      if (!canonical) return;
      const ids = subtreeIds(canonical);
      const next: Record<string, LocalValue> = { ...state };
      for (const [key, binding] of Object.entries(document.bindings)) {
        if (!(controls.get(key) ?? []).some((node) => ids.has(node.id))) continue;
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
      const canonical = nodeIndex.get(node.id);
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
      listeners.clear();
      expressions.clear();
      computationExpressions.clear();
      dynamicExpressions.clear();
      tokens.clear();
    },
  };

  return runtime;
}
