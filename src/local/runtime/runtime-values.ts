import type {
  Diagnostic,
  LocalBinding,
  LocalDocument,
  LocalNode,
  LocalValue,
  LocalValueKind,
} from '../types';
import { countLocalCodePoints } from '../source/source-context';
import {
  diagnosticEnglish,
  localDiagnosticDetails,
  type LocalDiagnosticDetails,
} from '../configuration/diagnostics';
import { isKernelDate, type KernelComponentSchema } from '../configuration/component-kernel';
import { kernelValueRules, type KernelValueRule } from '../configuration/kernel-value-rules';
import { isLocalEmail, MAX_LOCAL_EMAIL_LENGTH } from '../configuration/limits';
import { getLocalComponentDefinition } from '../../sdk/registry';
import { LocalExpressionError, localValueBudgetIssue } from '../evaluation/expression/compile';

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

interface StringDynamic {
  min?: string;
  max?: string;
  required?: boolean;
}

/** Static string attribute or declaration default, without interpolation. */
function stringAttribute(node: LocalNode, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const raw = rawAttr(node, name);
  return raw;
}

function numberAttribute(node: LocalNode, name: string | undefined): number | undefined {
  if (name === undefined) return undefined;
  return staticNumber(node, name);
}

/**
 * Validate one string binding against the compiled rules published on the
 * document. Rules name the authored attributes, so a component needs no
 * special runtime code of its own.
 */
function validateKernelStringControl(
  node: LocalNode,
  value: string,
  rules: readonly KernelValueRule[],
  dynamic: StringDynamic = {},
): ValidationResult {
  for (const rule of rules) {
    if (rule.kind === 'date') {
      if (!isKernelDate(value)) return invalid('local.runtime.value.date-invalid');
      const required = dynamic.required
        ?? (rule.required !== undefined && staticBoolean(node, rule.required) === true);
      if (value === '' && required) return invalid('local.runtime.value.date-required');
      const min = dynamic.min ?? stringAttribute(node, rule.min);
      const max = dynamic.max ?? stringAttribute(node, rule.max);
      if (value !== '' && min && value < min) return invalid('local.runtime.value.date-earlier', { min });
      if (value !== '' && max && value > max) return invalid('local.runtime.value.date-later', { max });
      continue;
    }
    if (rule.kind === 'required') {
      const required = dynamic.required
        ?? (staticBoolean(node, rule.required) === true);
      if (value === '' && required) return invalid('local.runtime.value.field-required');
      continue;
    }
    if (rule.kind === 'length') {
      const length = codePointLength(value);
      const minLength = numberAttribute(node, rule.min);
      const maxLength = numberAttribute(node, rule.max);
      if (minLength !== undefined && minLength > 0 && value !== '' && length < minLength) {
        return invalid('local.runtime.value.min-length', { min: minLength });
      }
      if (maxLength !== undefined && length > maxLength) {
        return invalid('local.runtime.value.max-length', { max: maxLength });
      }
      continue;
    }
    if (rule.kind === 'email') {
      const type = stringAttribute(node, rule.type) ?? 'text';
      if (type === rule.value && value !== '') {
        if (value.length > MAX_LOCAL_EMAIL_LENGTH) {
          return invalid('local.runtime.value.email-length', { limit: MAX_LOCAL_EMAIL_LENGTH });
        }
        if (!isLocalEmail(value)) return invalid('local.runtime.value.email-invalid');
      }
    }
  }
  return { ok: true, value };
}

const defaultDefinitionCache = new Map<string, readonly KernelValueRule[] | null>();

/**
 * Phase-one documents built by hand carry no kernel metadata. Resolve their
 * value rules from the public default preset instead of maintaining a second
 * built-in semantic list here.
 */
function legacyValueRules(node: LocalNode): readonly KernelValueRule[] {
  if (!node.name) return EMPTY_VALUE_RULES;
  const cached = defaultDefinitionCache.get(node.name);
  if (cached !== undefined) return cached ?? EMPTY_VALUE_RULES;
  const definition = getLocalComponentDefinition(node.name);
  const rules = definition
    ? kernelValueRules(definition as unknown as KernelComponentSchema)
    : EMPTY_VALUE_RULES;
  defaultDefinitionCache.set(node.name, definition ? rules : null);
  return rules;
}

export type DynamicRead =
  | { present: false }
  | { present: true; ok: true; value: LocalValue }
  | { present: true; ok: false };

const EMPTY_VALUE_RULES: readonly KernelValueRule[] = Object.freeze([]);

export function validateValue(
  binding: LocalBinding,
  nodes: LocalNode[],
  value: LocalValue,
  readDynamic: (node: LocalNode, attribute: 'min' | 'max' | 'required') => DynamicRead,
  valueRules?: ReadonlyMap<string, readonly KernelValueRule[]>,
  legacyMode = false,
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
        const rules = valueRules?.get(node.id) ?? (legacyMode ? legacyValueRules(node) : EMPTY_VALUE_RULES);
        if (!rules.length) continue;
        const dynamic: StringDynamic = {};
        for (const rule of rules) {
          if (rule.kind === 'date') {
            for (const attribute of ['min', 'max'] as const) {
              if (rule[attribute] === undefined) continue;
              const read = readDynamic(node, attribute);
              if (!read.present) continue;
              if (!read.ok || typeof read.value !== 'string' || !isKernelDate(read.value)) {
                return invalid('local.runtime.value.constraint-date', { name: binding.name, attribute });
              }
              dynamic[attribute] = read.value;
            }
            const minValue = dynamic.min ?? stringAttribute(node, rule.min);
            const maxValue = dynamic.max ?? stringAttribute(node, rule.max);
            if (minValue && maxValue && isKernelDate(minValue) && isKernelDate(maxValue) && minValue > maxValue) {
              return invalid('local.runtime.value.constraint-range', { name: binding.name });
            }
          }
          const requiredAttribute = rule.kind === 'date' || rule.kind === 'required' ? rule.required : undefined;
          if (requiredAttribute !== undefined) {
            const requiredRead = readDynamic(node, 'required');
            if (requiredRead.present) {
              if (!requiredRead.ok || typeof requiredRead.value !== 'boolean') {
                return invalid('local.runtime.value.constraint', { name: binding.name, attribute: 'required' });
              }
              dynamic.required = requiredRead.value;
            }
          }
        }
        const result = validateKernelStringControl(node, value, rules, dynamic);
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
      for (const entry of value) {
        if (typeof entry !== 'string') return invalid('local.runtime.value.array-members', { name: binding.name });
      }
      if (binding.family === 'collection') {
        if (binding.maxItems !== undefined && value.length > binding.maxItems) {
          return invalid('local.runtime.value.max-items', { name: binding.name, max: binding.maxItems });
        }
        return { ok: true, value: (value as string[]).slice() };
      }
      const chosen = new Set<string>();
      for (const entry of value as string[]) {
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
    case 'number-array': {
      if (!Array.isArray(value)) return invalid('local.runtime.value.number-array', { name: binding.name });
      const budget = localValueBudgetIssue(value);
      if (budget) {
        return invalid('local.runtime.value.budget', { name: binding.name, detail: diagnosticEnglish(budget), detailKey: budget.key, ...budget.params });
      }
      for (const entry of value) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
          return invalid('local.runtime.value.number-array-members', { name: binding.name });
        }
      }
      if (binding.maxItems !== undefined && value.length > binding.maxItems) {
        return invalid('local.runtime.value.max-items', { name: binding.name, max: binding.maxItems });
      }
      return { ok: true, value: (value as number[]).slice() };
    }
    case 'null':
      return value === null ? { ok: true, value } : invalid('local.runtime.value.null', { name: binding.name });
  }
  return invalid('local.runtime.value.unsupported-type', { name: binding.name });
}

export function normalizeComputationError(error: unknown): LocalExpressionError {
  return error instanceof LocalExpressionError
    ? error
    : new LocalExpressionError('expression-eval', error instanceof Error ? error.message : String(error), 0);
}

type ExternalCheck =
  | { ok: true; value: LocalValue }
  | { ok: false; key: string; params?: Record<string, string | number | boolean | null> };

/** Validate one host external value against its declared type and budgets. */
export function validateExternalValue(kind: LocalValueKind, value: LocalValue): ExternalCheck {
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

const EPSILON = 1e-9;

export function cloneValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? value.slice() : value;
}

export function onStep(value: number, base: number, step: number): boolean {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) <= EPSILON * Math.max(1, Math.abs(quotient));
}

export function diagnosticFor(document: LocalDocument, node: LocalNode, code: string, detail: LocalDiagnosticDetails): Diagnostic {
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

export function parameterDiagnostic(code: string, message: string, detail?: LocalDiagnosticDetails): Diagnostic {
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
