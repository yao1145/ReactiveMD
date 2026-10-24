import { MAX_LOCAL_DIAGNOSTIC_LENGTH } from './limits';
import type { Diagnostic, LocalValidation, SourceRange } from './types';

/**
 * Shared pieces for advisory cross-field rules (`<validation>`).
 *
 * The compiler publishes `LocalDocument.validations` in source order; the
 * runtime evaluates each rule independently against the current revision and
 * reports two stable diagnostic codes. Renderers must not infer extra fields:
 * a failed rule is identified by its tag range (`LocalValidation.range`).
 */

/** A rule whose `when` expression evaluated to `false`. */
export const LOCAL_VALIDATION_FAILED_CODE = 'local.validation.failed';
/** A rule whose `when` expression could not be evaluated or was not boolean. */
export const LOCAL_VALIDATION_EXPRESSION_CODE = 'local.validation.expression';

/** Visible substitute when the rule message itself cannot be interpolated. */
export const LOCAL_VALIDATION_FALLBACK_MESSAGE = 'Validation failed.';

/** Apply the shared diagnostic message budget with the existing ellipsis style. */
export function boundLocalDiagnosticMessage(message: string): string {
  return message.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
    ? `${message.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
    : message;
}

/** `fields` is a whitespace-separated list of public writable parameter names. */
export function parseValidationFields(raw: string): string[] {
  const trimmed = raw.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

export function localLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

/**
 * Runtime rules are metadata, so a hand-built document may carry anything.
 * Only well-formed rules are evaluated; malformed entries are ignored instead
 * of crashing the runtime.
 */
export function isLocalValidation(rule: unknown): rule is LocalValidation {
  if (!rule || typeof rule !== 'object') return false;
  const candidate = rule as Partial<LocalValidation>;
  const range = candidate.range;
  return (
    typeof candidate.expression === 'string'
    && typeof candidate.message === 'string'
    && Array.isArray(candidate.fields)
    && !!range
    && Number.isFinite(range.start)
    && Number.isFinite(range.end)
  );
}

/**
 * Build a runtime diagnostic anchored at the validation tag. `range` comes
 * from the compiled metadata, so renderers can match the diagnostic back to
 * the tag node without any extra field.
 */
export function validationDiagnostic(
  source: string,
  lineStarts: readonly number[],
  range: SourceRange,
  code: string,
  message: string,
): Diagnostic {
  const length = source.length;
  const start = Math.max(0, Math.min(length, Math.trunc(range.start)));
  const end = Math.max(start + 1, Math.min(length, Math.trunc(range.end)));
  let low = 0;
  let high = Math.max(0, lineStarts.length - 1);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle] <= start) low = middle;
    else high = middle - 1;
  }
  return {
    code,
    message,
    severity: 'error',
    range: { start, end },
    line: low + 1,
    column: start - lineStarts[low] + 1,
  };
}
