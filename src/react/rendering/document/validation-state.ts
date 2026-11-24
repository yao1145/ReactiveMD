import type { Localize } from '../../localization';
import { useRef } from 'react';
import type { Diagnostic, LocalDocument, LocalNode, LocalRuntime } from '../../../local/types';
import { LOCAL_VALIDATION_EXPRESSION_CODE, LOCAL_VALIDATION_FAILED_CODE } from '../../../local/evaluation/validation';
import { localCodeUnitPrefix } from '../../../local/source/source-context';

export interface LocalValidationHint {
  /** Per-document-instance id, kept stable for every rule state. */
  id: string;
  failed: boolean;
  error: boolean;
  message: string;
}

export interface LocalValidationField {
  describedBy?: string;
  invalid: boolean;
}

export interface LocalValidationState {
  /** The hint for a rendered `<validation>` tag, matched by tag range. */
  hintFor(node: LocalNode): LocalValidationHint | null;
  /** Current failing hints attached to a bound control/slot group. */
  fieldFor(node: LocalNode): LocalValidationField;
}

export type LocalizeValidation = (english: string, chinese: string) => string;

const VALIDATION_MESSAGE_BUDGET = 2_000;
const NO_VALIDATION_FIELD: LocalValidationField = { invalid: false };

export const NO_VALIDATIONS: LocalValidationState = {
  hintFor: () => null,
  fieldFor: () => NO_VALIDATION_FIELD,
};

function validationRangeKey(range: { start: number; end: number }): string {
  return `${range.start}:${range.end}`;
}

function boundedValidationText(message: string): string {
  return message.length > VALIDATION_MESSAGE_BUDGET
    ? `${localCodeUnitPrefix(message, VALIDATION_MESSAGE_BUDGET - 1)}…`
    : message;
}

/**
 * Project runtime validation results onto rule hints and their bound fields.
 * Rendering consumes this small model to set accessible hint and error props.
 */
export function createValidationState(
  document: LocalDocument,
  runtime: LocalRuntime,
  instanceId: string,
  t: LocalizeValidation,
): LocalValidationState {
  const rules = Array.isArray(document.validations) ? document.validations : [];
  if (rules.length === 0) return NO_VALIDATIONS;

  let diagnostics: Diagnostic[] | null = null;
  try {
    // Hand-built runtimes may predate the advisory API; treat the absent or
    // throwing call as an evaluation failure instead of silently passing.
    if (typeof runtime.validate === 'function') diagnostics = runtime.validate();
  } catch {
    diagnostics = null;
  }

  const byRange = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics ?? []) {
    if (
      diagnostic.code !== LOCAL_VALIDATION_FAILED_CODE
      && diagnostic.code !== LOCAL_VALIDATION_EXPRESSION_CODE
    ) {
      continue;
    }
    byRange.set(validationRangeKey(diagnostic.range), diagnostic);
  }

  const hintsByNode = new Map<string, LocalValidationHint>();
  const hintsByRange = new Map<string, LocalValidationHint>();
  const fields = new Map<string, string[]>();
  const errorMessage = t('This rule cannot be evaluated', '无法计算此规则');
  const fallbackMessage = t('Validation failed.', '校验未通过。');

  for (const [index, rule] of rules.entries()) {
    const key = validationRangeKey(rule.range);
    const diagnostic = byRange.get(key);
    const error = diagnostics === null || diagnostic?.code === LOCAL_VALIDATION_EXPRESSION_CODE;
    const failed = diagnostic?.code === LOCAL_VALIDATION_FAILED_CODE;
    const message = failed
      ? boundedValidationText(diagnostic?.message || rule.message || fallbackMessage)
      : error
        ? diagnostic?.message
          ? `${errorMessage}: ${boundedValidationText(diagnostic.message)}`
          : errorMessage
        : '';
    const hint: LocalValidationHint = {
      id: `${instanceId}-validation-${index}`,
      failed,
      error,
      message,
    };
    hintsByNode.set(rule.nodeId, hint);
    hintsByRange.set(key, hint);
    if (!failed && !error) continue;

    for (const name of rule.fields ?? []) {
      const binding = Object.hasOwn(document.bindings, name)
        ? document.bindings[name]
        : undefined;
      if (!binding) continue;
      for (const nodeId of binding.nodeIds ?? []) {
        const current = fields.get(nodeId);
        if (!current) fields.set(nodeId, [hint.id]);
        else if (!current.includes(hint.id)) current.push(hint.id);
      }
    }
  }

  return {
    hintFor(node: LocalNode): LocalValidationHint | null {
      return hintsByRange.get(validationRangeKey(node.range)) ?? hintsByNode.get(node.id) ?? null;
    },
    fieldFor(node: LocalNode): LocalValidationField {
      const ids = fields.get(node.id);
      return ids && ids.length > 0
        ? { describedBy: ids.join(' '), invalid: true }
        : NO_VALIDATION_FIELD;
    },
  };
}

interface ValidationCache {
  runtime: LocalRuntime;
  t: Localize;
  key: string;
  value: LocalValidationState;
}

/**
 * Validation rendering only depends on the rule/binding projection and the
 * current diagnostic signature, not on prose elsewhere in the document.
 */
export function useStableValidation(
  document: LocalDocument,
  runtime: LocalRuntime,
  instanceId: string,
  t: Localize,
  key: string,
): LocalValidationState {
  const cache = useRef<ValidationCache | null>(null);
  let entry = cache.current;
  if (!entry || entry.runtime !== runtime || entry.t !== t || entry.key !== key) {
    entry = { runtime, t, key, value: createValidationState(document, runtime, instanceId, t) };
    cache.current = entry;
  }
  return entry.value;
}
