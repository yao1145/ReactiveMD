import { LocalFunctionError } from './formatting';

/**
 * Deterministic aggregates for numeric arrays in the local expression
 * language. Inputs are already validated as finite numbers by the evaluator;
 * these helpers only guard the computed result. Empty-array semantics live
 * here so `sum([])` is `0` while the other aggregates return `null`.
 */

function nonFinite(): never {
  throw new LocalFunctionError('expression-number', 'The result is not a finite number.');
}

function requireFiniteMember(value: number): number {
  if (!Number.isFinite(value)) {
    throw new LocalFunctionError('expression-value', 'Numeric array members must be finite numbers.');
  }
  return value;
}

export function sumNumberArray(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += requireFiniteMember(value);
  if (!Number.isFinite(total)) nonFinite();
  return total;
}

export function averageNumberArray(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = sumNumberArray(values);
  const average = total / values.length;
  if (!Number.isFinite(average)) nonFinite();
  return average;
}

export function minNumberArray(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let result = requireFiniteMember(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    const value = requireFiniteMember(values[index]);
    if (value < result) result = value;
  }
  return result;
}

export function maxNumberArray(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let result = requireFiniteMember(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    const value = requireFiniteMember(values[index]);
    if (value > result) result = value;
  }
  return result;
}
