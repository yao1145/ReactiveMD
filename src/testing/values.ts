import {
  MAX_LOCAL_COMPLIANCE_ARRAY_LENGTH,
  MAX_LOCAL_COMPLIANCE_STRING_LENGTH,
  type LocalComplianceValue,
} from './types';

/**
 * Bounded value/spec helpers shared by every compliance suite. Invalid spec
 * data throws a TypeError with a path; it never degrades into a failed case.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must be a plain object.`);
  return value;
}

export function checkKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${path} must not contain "${key}".`);
    if (!allowed.has(key)) throw new TypeError(`${path} has unknown field "${key}".`);
  }
}

export function readString(
  value: unknown,
  path: string,
  limit = MAX_LOCAL_COMPLIANCE_STRING_LENGTH,
): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string.`);
  if (value.length > limit) throw new TypeError(`${path} exceeds ${limit} characters.`);
  return value;
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean.`);
  return value;
}

export function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

export function readInteger(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const numeric = readFiniteNumber(value, path);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new TypeError(`${path} must be an integer between ${min} and ${max}.`);
  }
  return numeric;
}

/** Validate one public compliance value and return a defensive copy. */
export function readComplianceValue(value: unknown, path: string): LocalComplianceValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return readFiniteNumber(value, path);
  if (typeof value === 'string') return readString(value, path);
  if (Array.isArray(value)) {
    if (value.length > MAX_LOCAL_COMPLIANCE_ARRAY_LENGTH) {
      throw new TypeError(`${path} exceeds ${MAX_LOCAL_COMPLIANCE_ARRAY_LENGTH} entries.`);
    }
    const strings = value.every((item) => typeof item === 'string');
    const numbers = value.every((item) => typeof item === 'number' && Number.isFinite(item));
    if (!strings && !numbers) {
      throw new TypeError(`${path} must be an array of strings or an array of finite numbers.`);
    }
    if (strings) return Object.freeze(value.map((item) => readString(item, path))) as readonly string[];
    return Object.freeze(value.map((item) => readFiniteNumber(item, path))) as readonly number[];
  }
  throw new TypeError(`${path} must be a scalar or a flat string/number array.`);
}

export function readComplianceValueRecord(
  value: unknown,
  path: string,
  maxEntries: number,
): Readonly<Record<string, LocalComplianceValue>> {
  const record = requireRecord(value, path);
  const keys = Object.keys(record);
  if (keys.length === 0) throw new TypeError(`${path} must not be empty.`);
  if (keys.length > maxEntries) throw new TypeError(`${path} accepts at most ${maxEntries} entries.`);
  const out: Record<string, LocalComplianceValue> = {};
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${path} must not contain "${key}".`);
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) || key.length > 128) {
      throw new TypeError(`${path}.${key} is not a valid public name.`);
    }
    out[key] = readComplianceValue(record[key], `${path}.${key}`);
  }
  return Object.freeze(out);
}

export function readStringList(
  value: unknown,
  path: string,
  maxEntries: number,
): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array of strings.`);
  if (value.length > maxEntries) throw new TypeError(`${path} accepts at most ${maxEntries} entries.`);
  return Object.freeze(value.map((item) => readString(item, path)));
}

export function sameComplianceValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => Object.is(item, right[index]));
  }
  return Object.is(left, right);
}

export function sameComplianceRecord(
  left: Readonly<Record<string, LocalComplianceValue>>,
  right: Readonly<Record<string, LocalComplianceValue>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && sameComplianceValue(left[key], right[key]));
}

/** Keep spec parity keys stable and reject duplicate case ids. */
export function readCaseId(value: unknown, path: string, seen: Set<string>, fallback: string): string {
  const id = value === undefined ? fallback : readString(value, path, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new TypeError(`${path} must use letters, digits, ".", "_" or "-".`);
  }
  if (seen.has(id)) throw new TypeError(`${path} duplicates case id "${id}".`);
  seen.add(id);
  return id;
}

/** Bounded diagnostic view of compiler/runtime output. */
export function readDiagnostics(value: unknown): readonly { code: string; message: string }[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const out: { code: string; message: string }[] = [];
  for (const item of value.slice(0, 20)) {
    if (!isPlainRecord(item)) continue;
    const code = typeof item.code === 'string' ? item.code.slice(0, 128) : 'local.unknown';
    const message = typeof item.message === 'string'
      ? item.message.slice(0, 2_000)
      : String(item.message).slice(0, 2_000);
    out.push(Object.freeze({ code, message }));
  }
  return Object.freeze(out);
}

export function readErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}
