import type { Diagnostic } from './types';
import {walkLocalNodes} from './node-walk';
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
import type { LocalStateRetentionDrop } from './retention';
import { planLocalStateRetention } from './retention';
import { localKey, type LocalBinding, type LocalComputation, type LocalDocument, type LocalNode, type LocalRuntime, type LocalRuntimeOptions, type LocalValueKind, type LocalSnapshot, type LocalValidation, type LocalValue } from './types';

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
      let base = binding.min ?? 0;
      for (const node of nodes) {
        const minRead = readDynamic(node, 'min');
        if (minRead.present && !minRead.ok) return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'min' });
        if (minRead.present && minRead.ok) {
          if (typeof minRead.value !== 'number' || !Number.isFinite(minRead.value)) {
            return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'min' });
          }
          base = minRead.value;
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

function normalizeComputationError(error: unknown): LocalExpressionError {
  return error instanceof LocalExpressionError
    ? error
    : new LocalExpressionError('expression-eval', error instanceof Error ? error.message : String(error), 0);
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


interface RuntimeValidationRule {
  rule: LocalValidation;
  expression: LocalExpression | null;
  error: LocalExpressionError | null;
}

/**
 * Structural part of a runtime derived from one document. Rebuilt on every
 * document adoption; values, listeners and expression caches stay on the
 * runtime so identity survives an edit.
 */
interface RuntimeCore {
  document: LocalDocument;
  nodeIndex: Map<string, LocalNode>;
  controls: Map<string, LocalNode[]>;
  slotKeys: Map<string, Record<string, string>>;
  publicNames: readonly string[];
  publicSlotOwners: Map<string, Set<string>>;
  initial: Record<string, LocalValue>;
  computationMetadata: Record<string, LocalComputation>;
  computationNames: string[];
  computationOrder: string[];
  cyclicComputations: string[];
  computationExpressions: Map<string, LocalExpression>;
  constValues: Record<string, LocalValue>;
  constErrors: Map<string, LocalExpressionError>;
  cycleErrors: Map<string, LocalExpressionError>;
  validationRules: RuntimeValidationRule[];
  validationLineStarts: number[];
}

/**
 * Compile a metadata expression through the runtime-wide source cache. A
 * failed compile returns its error without caching it, so fixing the source
 * recovers on the next document adoption.
 */
function compileMetadataExpression(
  source: string,
  cache: Map<string, LocalExpression>,
): { expression: LocalExpression; error: null } | { expression: null; error: LocalExpressionError } {
  const cached = cache.get(source);
  if (cached) return { expression: cached, error: null };
  try {
    const compiled = compileExpression(source);
    if (cache.size >= RUNTIME_EXPRESSION_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(source, compiled);
    return { expression: compiled, error: null };
  } catch (error) {
    return { expression: null, error: normalizeComputationError(error) };
  }
}

function loadRuntimeCore(document: LocalDocument, expressions: Map<string, LocalExpression>): RuntimeCore {
  const nodeIndex = new Map<string, LocalNode>();
    for (const node of walkLocalNodes(document.nodes)) {
      nodeIndex.set(node.id, node);
    }

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

  /* --------------------------------------------------------- computations */

  const computationMetadata = (document.computations ?? {}) as Record<string, LocalComputation>;
  const computationNames = Object.keys(computationMetadata);
  const computationExpressions = new Map<string, LocalExpression>();
  for (const [name, meta] of Object.entries(computationMetadata)) {
    const compiled = compileMetadataExpression(meta.source, expressions);
    // A hand-built document can carry an invalid expression. The runtime
    // reports it through the same lazy-error channel as a domain failure.
    if (compiled.expression) computationExpressions.set(name, compiled.expression);
  }
  const { order: computationOrder, cyclic: cyclicComputations } = orderComputations(computationMetadata);
  const constValues: Record<string, LocalValue> = {};
  const constErrors = new Map<string, LocalExpressionError>();
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

  const validationRules: RuntimeValidationRule[] = [];
  if (Array.isArray(document.validations)) {
    for (const rule of document.validations) {
      if (!isLocalValidation(rule)) continue;
      const compiled = compileMetadataExpression(rule.expression, expressions);
      validationRules.push({ rule, expression: compiled.expression, error: compiled.error });
    }
  }
  const validationLineStarts = localLineStarts(typeof document.source === 'string' ? document.source : '');

  return {
    document,
    nodeIndex,
    controls,
    slotKeys,
    publicNames,
    publicSlotOwners,
    initial,
    computationMetadata,
    computationNames,
    computationOrder,
    cyclicComputations,
    computationExpressions,
    constValues,
    constErrors,
    cycleErrors,
    validationRules,
    validationLineStarts,
  };
}

function runtimeDocumentProblem(document: LocalDocument | null | undefined): string | null {
  if (!document || document.syntax !== 'local') {
    return 'createLocalRuntime requires a local interaction document.';
  }
  if ((document.syntaxVersion !== undefined && document.syntaxVersion !== LOCAL_SYNTAX_VERSION)
    || (document.versionDeclaration && document.versionDeclaration.version !== LOCAL_SYNTAX_VERSION)) {
    return `createLocalRuntime requires ${LOCAL_SYNTAX_VERSION}; migrate the source before constructing a runtime.`;
  }
  return null;
}

function nodeForBinding(core: RuntimeCore, binding: LocalBinding): LocalNode | undefined {
  return (core.controls.get(binding.name) ?? [])[0]
    ?? (binding.owner ? core.nodeIndex.get(binding.owner) : undefined)
    ?? (binding.nodeIds[0] ? core.nodeIndex.get(binding.nodeIds[0]) : undefined);
}

function valueDiagnosticFor(core: RuntimeCore, binding: LocalBinding, detail: LocalDiagnosticDetails): Diagnostic {
  const node = nodeForBinding(core, binding);
  return node
    ? diagnosticFor(core.document, node, 'local.runtime.value', detail)
    : parameterDiagnostic('local.runtime.value', diagnosticEnglish(detail));
}

/** Reject a range whose start would cross its end before any commit. */
function slotRelationError(core: RuntimeCore, nodeId: string, next: Record<string, LocalValue>): boolean {
  const slots = core.slotKeys.get(nodeId);
  if (!slots?.start || !slots?.end) return false;
  const start = next[slots.start];
  const end = next[slots.end];
  return typeof start === 'number' && typeof end === 'number' && start > end;
}

function rangeOrderDiagnostic(core: RuntimeCore, nodeId: string): Diagnostic {
  const node = core.nodeIndex.get(nodeId);
  return node
    ? diagnosticFor(core.document, node, 'local.runtime.value', localDiagnosticDetails('local.runtime.value.range-order'))
    : parameterDiagnostic('local.runtime.value', diagnosticEnglish(localDiagnosticDetails('local.runtime.value.range-order')));
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

export function createLocalRuntime(document: LocalDocument, options?: LocalRuntimeOptions): LocalRuntime {
  const problem = runtimeDocumentProblem(document);
  if (problem) throw new Error(problem);

  /** Source-keyed cache shared by control expressions and document metadata. */
  const expressions = new Map<string, LocalExpression>();
  const metadataExpressions = new Map<string, LocalExpression>();
  let core = loadRuntimeCore(document, metadataExpressions);

  /** Internal reads always go through the core of the current document. */
  const current = (): RuntimeCore => core;

  const externalState: Record<string, LocalValue> = {};
  for (const [name, meta] of Object.entries(document.externals ?? {})) {
    const raw = options?.externalValues?.[name];
    if (raw === undefined) continue;
    const checked = validateExternalValue(meta.type, raw);
    if (checked.ok) externalState[name] = checked.value;
  }
  const externalValuesFor = (loaded: RuntimeCore): Record<string, LocalValue> => {
    const values: Record<string, LocalValue> = {};
    for (const [name, meta] of Object.entries(loaded.document.externals ?? {})) {
      if (!Object.hasOwn(externalState, name)) continue;
      const checked = validateExternalValue(meta.type, externalState[name]);
      if (checked.ok) values[name] = checked.value;
    }
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
  let computationValues: Record<string, LocalValue> = {};
  let computationErrors = new Map<string, LocalExpressionError>();
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
    values: Record<string, LocalValue>;
    errors: Map<string, LocalExpressionError>;
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
    return { values, errors, environment, snapshotState: merged };
  };

  const refreshComputations = (): void => {
    const layer = computeLayer(current(), state);
    computationValues = layer.values;
    computationErrors = layer.errors;
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
    const changed = keys.some((key) => !valuesEqual(externalState[key], normalized[key]));
    if (!changed) return [];
    for (const [key, value] of Object.entries(normalized)) externalState[key] = value;
    revision += 1;
    refreshComputations();
    publish();
    notify();
    return [];
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
      const result = validateValue(binding, loaded.controls.get(key) ?? [], values[key], read);
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

  /**
   * Migrate control state onto a new document. The retention plan decides what
   * is comparable at all; each surviving value is revalidated against the new
   * bindings and shared controls exactly like a parameter write would be.
   */
  const migrateState = (next: LocalDocument, nextCore: RuntimeCore): {
    values: Record<string, LocalValue>;
    retained: string[];
    dropped: LocalStateRetentionDrop[];
    diagnostics: Diagnostic[];
  } => {
    const plan = planLocalStateRetention({ previous: core.document, state, next });
    const values: Record<string, LocalValue> = {};
    for (const [key, binding] of Object.entries(next.bindings)) {
      values[key] = cloneValue(binding.initial);
    }

    const droppedByName = new Map<string, LocalStateRetentionDrop>();
    for (const entry of plan.dropped) droppedByName.set(entry.name, Object.freeze({ ...entry }));
    const diagnostics: Diagnostic[] = [];
    const accepted: Record<string, LocalValue> = {};
    const acceptedNames: string[] = [];

    for (const name of plan.retained) {
      const binding = next.bindings[name];
      if (!binding) continue;
      const result = validateValue(binding, nextCore.controls.get(name) ?? [], plan.values[name], prospectiveReader(plan.values, nextCore, values));
      if (!result.ok) {
        diagnostics.push(valueDiagnosticFor(nextCore, binding, result.detail));
        droppedByName.set(name, Object.freeze({ name, reason: 'invalid' }));
        continue;
      }
      accepted[name] = cloneValue(result.value);
      acceptedNames.push(name);
    }

    // Mirror applyLocalStateRetention: try the surviving values atomically
    // first, then fall back to sorted individual writes when a slot relation
    // would cross. That keeps both slots readable and the final range ordered.
    const atomic: Record<string, LocalValue> = { ...values, ...accepted };
    const affected = new Set<string>();
    for (const name of acceptedNames) {
      for (const nodeId of nextCore.publicSlotOwners.get(name) ?? []) affected.add(nodeId);
    }
    let crossing = false;
    for (const nodeId of [...affected].sort()) {
      if (slotRelationError(nextCore, nodeId, atomic)) {
        crossing = true;
        break;
      }
    }

    let retained: string[];
    if (!crossing) {
      Object.assign(values, accepted);
      retained = acceptedNames;
    } else {
      retained = [];
      for (const name of acceptedNames) {
        const previous = values[name];
        values[name] = accepted[name];
        let blocked = false;
        for (const nodeId of [...(nextCore.publicSlotOwners.get(name) ?? [])].sort()) {
          if (slotRelationError(nextCore, nodeId, values)) {
            diagnostics.push(rangeOrderDiagnostic(nextCore, nodeId));
            blocked = true;
          }
        }
        if (blocked) {
          values[name] = previous;
          droppedByName.set(name, Object.freeze({ name, reason: 'invalid' }));
        } else {
          retained.push(name);
        }
      }
    }

    // Final invariant: a hand-built document may still declare crossing
    // initials. Reset both slots to their authored defaults, and reject the
    // document if even those defaults cross.
    for (const [nodeId, slots] of nextCore.slotKeys) {
      if (!slotRelationError(nextCore, nodeId, values)) continue;
      for (const slot of ['start', 'end'] as const) {
        const key = slots[slot];
        if (!key) continue;
        const binding = next.bindings[key];
        if (!binding) continue;
        values[key] = cloneValue(binding.initial);
        const index = retained.indexOf(key);
        if (index >= 0) retained.splice(index, 1);
        droppedByName.set(key, Object.freeze({ name: key, reason: 'invalid' }));
      }
      diagnostics.push(rangeOrderDiagnostic(nextCore, nodeId));
      if (slotRelationError(nextCore, nodeId, values)) {
        return { values: {}, retained: [], dropped: [], diagnostics: [] };
      }
    }

    // Resetting one retained dependency can invalidate other retained values.
    // Validate the actual candidate state until no retained value is dropped.
    let changed = true;
    while (changed) {
      const read = prospectiveReader({}, nextCore, values);
      const rejected: string[] = [];
      for (const name of retained) {
        const binding = next.bindings[name];
        const checked = validateValue(binding, nextCore.controls.get(name) ?? [], values[name], read);
        if (!checked.ok) {
          diagnostics.push(valueDiagnosticFor(nextCore, binding, checked.detail));
          rejected.push(name);
        }
      }
      for (const name of rejected) {
        values[name] = cloneValue(next.bindings[name].initial);
        retained.splice(retained.indexOf(name), 1);
        droppedByName.set(name, Object.freeze({ name, reason: 'invalid' }));
      }
      changed = rejected.length > 0;
    }

    const dropped = [...droppedByName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    retained.sort();
    return { values, retained, dropped, diagnostics };
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

    const migrated = migrateState(next, nextCore);
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

    const nextExternals = externalValuesFor(nextCore);
    for (const name of Object.keys(externalState)) delete externalState[name];
    Object.assign(externalState, nextExternals);
    core = nextCore;
    state = migrated.values;
    computationValues = layer.values;
    computationErrors = layer.errors;
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
    get document(): LocalDocument {
      return core.document;
    },

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
        ? localKey(canonical)
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
        if (slots) {
          return [diagnosticFor(loaded.document, canonical, 'local.runtime.binding', localDiagnosticDetails('local.runtime.binding.needs-slot'))];
        }
        key = localKey(canonical);
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
      const result = validateValue(binding, loaded.controls.get(key) ?? [], value, prospectiveReader({ [key]: value }));
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
        const result = validateValue(loaded.document.bindings[key], loaded.controls.get(key) ?? [], value, (target, attribute) => readDynamic(target, attribute, env));
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
      const loaded = current();
      if (name.startsWith('@') || !Object.hasOwn(loaded.document.bindings, name)) return undefined;
      return Object.hasOwn(state, name) ? cloneValue(state[name]) : undefined;
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
      if (!Object.hasOwn(current().document.externals ?? {}, name) || !Object.hasOwn(externalState, name)) return undefined;
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
    notify() {
      if (disposed) return;
      for (const listener of listeners) listener();
    },
  });

  refreshComputations();
  publish();

  return runtime;
}
