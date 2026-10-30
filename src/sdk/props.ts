import type { LocalHostBindingSchema, LocalRuntime } from '../local/types';
import { isLocalColor } from '../local/colors';
import type {
  LocalComponentDefinition,
  LocalComponentProp,
} from './types';

/** Typed, resolved values handed to a component implementation. */
export type LocalResolvedProps = Readonly<Record<string, string | number | boolean | null>>;

/** Effective scalar binding constraints after resolving prop references. */
export interface LocalResolvedBindingConstraints {
  min?: number;
  max?: number;
  step?: number;
}

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** All attribute names owned implicitly by a manifest's declared bindings. */
export function localBindingAttributeNames(definition: LocalComponentDefinition): ReadonlySet<string> {
  const names = new Set<string>();
  for (const binding of Object.values(definition.bindings ?? {})) {
    names.add(binding.bind);
    names.add(binding.initial);
  }
  return names;
}

function parseNumberLiteral(raw: string): number | null {
  const text = raw.trim();
  if (!NUMBER_TEXT.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** True when the value contains an unescaped interpolation opener. */
function hasInterpolation(raw: string): boolean {
  for (let index = 0; index < raw.length - 1; index += 1) {
    if (raw[index] === '\\') {
      index += 1;
      continue;
    }
    if (raw[index] === '{' && raw[index + 1] === '{') return true;
  }
  return false;
}

/** The inner expression when `raw` is exactly one interpolation. */
function fullExpression(raw: string): string | null {
  const text = raw.trim();
  if (text.length < 5 || !text.startsWith('{{') || !text.endsWith('}}')) return null;
  const inner = text.slice(2, -2);
  if (inner.includes('{{') || inner.includes('}}')) return null;
  const expression = inner.trim();
  return expression === '' ? null : expression;
}

function propError(definition: LocalComponentDefinition, name: string, message: string): Error {
  return new Error(`Local component <${definition.name}> prop "${name}" ${message}`);
}

function evaluateProp(
  definition: LocalComponentDefinition,
  name: string,
  expression: string,
  runtime: Pick<LocalRuntime, 'evaluate'>,
): unknown {
  try {
    return runtime.evaluate(expression);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw propError(definition, name, `expression failed: ${detail}`);
  }
}

function checkNumber(
  definition: LocalComponentDefinition,
  name: string,
  prop: LocalComponentProp,
  value: number,
): number {
  if (!Number.isFinite(value)) throw propError(definition, name, 'must be a finite number.');
  if (prop.integer === true && !Number.isInteger(value)) {
    throw propError(definition, name, 'must be an integer.');
  }
  if (prop.positive === true && !(value > 0)) {
    throw propError(definition, name, 'must be greater than zero.');
  }
  if (prop.min !== undefined && value < prop.min) {
    throw propError(definition, name, `must be at least ${prop.min}.`);
  }
  if (prop.max !== undefined && value > prop.max) {
    throw propError(definition, name, `must be at most ${prop.max}.`);
  }
  return value;
}

function checkStringPattern(
  definition: LocalComponentDefinition,
  name: string,
  prop: LocalComponentProp,
  value: string,
): string {
  if (prop.pattern === undefined) return value;
  let accepted = true;
  try {
    accepted = new RegExp(prop.pattern).test(value);
  } catch {
    accepted = false;
  }
  if (!accepted) throw propError(definition, name, `must match pattern ${prop.pattern}.`);
  return value;
}

function checkEnum(
  definition: LocalComponentDefinition,
  name: string,
  prop: LocalComponentProp,
  value: string,
): string {
  const allowed = prop.enum ?? [];
  if (!allowed.includes(value)) {
    throw propError(definition, name, `must be one of ${allowed.join(' / ')}, got "${value}".`);
  }
  return value;
}

function checkColor(
  definition: LocalComponentDefinition,
  name: string,
  prop: LocalComponentProp,
  value: string,
): string {
  if (prop.color === true && value !== '' && !isLocalColor(value)) {
    throw propError(definition, name, `must be a standard CSS named color or #RGB/#RRGGBB, got "${value}".`);
  }
  return value;
}

/** Apply the string checks shared by literal, expression and mixed values. */
function checkText(
  definition: LocalComponentDefinition,
  name: string,
  prop: LocalComponentProp,
  value: string,
): string {
  if (prop.kind === 'enum') return checkColor(definition, name, prop, checkEnum(definition, name, prop, value));
  return checkColor(definition, name, prop, checkStringPattern(definition, name, prop, value));
}

function resolveProp(
  definition: LocalComponentDefinition,
  name: string,
  prop: LocalComponentProp,
  raw: string | undefined,
  runtime: Pick<LocalRuntime, 'evaluate' | 'text'>,
): string | number | boolean | null {
  if (raw === undefined) {
    if (prop.required === true && prop.default === undefined) {
      throw propError(definition, name, 'is required but was not provided.');
    }
    if (prop.default !== undefined) {
      if (prop.default === null) return null;
      if (prop.kind === 'number') {
        return checkNumber(definition, name, prop, prop.default as number);
      }
      if (prop.kind === 'boolean') return prop.default as boolean;
      const text = prop.default as string;
      return checkText(definition, name, prop, text);
    }
    return null;
  }

  const interpolated = hasInterpolation(raw);
  if (interpolated) {
    if (prop.static === true) throw propError(definition, name, 'is static and cannot contain interpolations.');
    if (prop.dynamic === false) throw propError(definition, name, 'does not accept interpolations.');
  }
  const expression = fullExpression(raw);

  if (prop.kind === 'string' || prop.kind === 'enum') {
    let value: string;
    if (expression !== null) {
      const evaluated = evaluateProp(definition, name, expression, runtime);
      if (prop.coerce === 'text' && prop.kind === 'string') {
        // Builtin label/template text renders any scalar through `text()`.
        if (evaluated === null) value = '';
        else if (typeof evaluated === 'string') value = evaluated;
        else if (typeof evaluated === 'number' || typeof evaluated === 'boolean') value = String(evaluated);
        else throw propError(definition, name, `expected a scalar, got ${typeof evaluated}.`);
      } else {
        if (typeof evaluated !== 'string') {
          throw propError(definition, name, `expected a string, got ${typeof evaluated}.`);
        }
        value = evaluated;
      }
      return checkText(definition, name, prop, value);
    }
    if (interpolated) {
      // Mixed literal text with interpolations is valid for string props only.
      // Static pattern and color checks run on the resolved text.
      value = runtime.text(raw);
      return checkText(definition, name, prop, value);
    }
    return checkText(definition, name, prop, raw);
  }

  if (prop.kind === 'number') {
    if (expression !== null) {
      const evaluated = evaluateProp(definition, name, expression, runtime);
      if (typeof evaluated !== 'number' || !Number.isFinite(evaluated)) {
        throw propError(definition, name, 'expected a finite number.');
      }
      return checkNumber(definition, name, prop, evaluated);
    }
    if (interpolated) {
      throw propError(definition, name, 'requires a number literal or one full numeric interpolation.');
    }
    const literal = parseNumberLiteral(raw);
    if (literal === null) throw propError(definition, name, `requires a number, got "${raw}".`);
    return checkNumber(definition, name, prop, literal);
  }

  // boolean
  if (expression !== null) {
    const evaluated = evaluateProp(definition, name, expression, runtime);
    if (typeof evaluated !== 'boolean') throw propError(definition, name, 'expected a boolean.');
    return evaluated;
  }
  if (interpolated) {
    throw propError(definition, name, 'requires true, false, or one full boolean interpolation.');
  }
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw propError(definition, name, `requires true or false, got "${raw}".`);
}

/**
 * Normalize a component's authored attributes against its manifest: missing
 * defaults, literal or expression evaluation, type checks and range/enum
 * checks. Optional missing props resolve to `null`; invalid explicit values
 * throw instead of being silently replaced by a default.
 */
export function resolveLocalComponentProps(
  definition: LocalComponentDefinition,
  attrs: Record<string, string>,
  runtime: Pick<LocalRuntime, 'evaluate' | 'text'>,
): LocalResolvedProps {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('resolveLocalComponentProps requires a component definition.');
  }
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
    throw new TypeError(`Local component <${definition.name}> attributes must be an object.`);
  }
  const bindingAttributes = localBindingAttributeNames(definition);
  for (const name of Object.keys(attrs)) {
    if (bindingAttributes.has(name)) continue;
    if (!Object.hasOwn(definition.props, name)) {
      throw new Error(`Local component <${definition.name}> does not declare attribute "${name}".`);
    }
  }
  const output: Record<string, string | number | boolean | null> = {};
  for (const name of Object.keys(definition.props)) {
    const raw = Object.hasOwn(attrs, name) && typeof attrs[name] === 'string' ? attrs[name] : undefined;
    output[name] = resolveLocalComponentProp(definition, name, raw, runtime);
  }
  return Object.freeze(output);
}

/** Resolve one declared prop using the same contract as document rendering. */
export function resolveLocalComponentProp(
  definition: LocalComponentDefinition,
  name: string,
  raw: string | undefined,
  runtime: Pick<LocalRuntime, 'evaluate' | 'text'>,
): string | number | boolean | null {
  const prop = definition.props[name];
  if (!prop) throw propError(definition, name, 'is not declared.');
  const scoped = definition.rules?.some(rule =>
    rule.kind === 'scoped-expressions' && rule.attributes.includes(name)
    || rule.kind === 'row-values' && (rule.rows === name || rule.key === name));
  if (scoped && raw !== undefined && prop.kind === 'string') return raw;
  return resolveProp(definition, name, prop, raw, runtime);
}

function constraintValue(
  definition: LocalComponentDefinition,
  attrs: Record<string, string>,
  constraint: { readonly literal: number } | { readonly prop: string } | undefined,
): number | undefined {
  if (constraint === undefined) return undefined;
  if ('literal' in constraint) return constraint.literal;
  const prop = definition.props[constraint.prop];
  if (prop === undefined || prop.kind !== 'number') return undefined;
  const raw = Object.hasOwn(attrs, constraint.prop) ? attrs[constraint.prop] : undefined;
  if (typeof raw === 'string') {
    if (hasInterpolation(raw)) return undefined;
    return parseNumberLiteral(raw) ?? undefined;
  }
  return typeof prop.default === 'number' ? prop.default : undefined;
}

/**
 * Compiler-side view of a number binding. Literal bounds are always returned;
 * prop references resolve against literal attributes or their defaults, and
 * remain unknown for dynamic interpolations (the runtime checks those).
 */
export function resolveLocalComponentBindingConstraints(
  definition: LocalComponentDefinition,
  attrs: Record<string, string>,
): LocalResolvedBindingConstraints {
  const binding = definition.bindings?.value;
  if (binding === undefined || binding.kind !== 'number') return {};
  const constraints = binding.constraints;
  if (constraints === undefined) return {};
  const min = constraintValue(definition, attrs, constraints.min);
  const max = constraintValue(definition, attrs, constraints.max);
  const step = constraintValue(definition, attrs, constraints.step);
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined && step > 0 ? { step } : {}),
  };
}

/**
 * Lower one manifest binding to the existing host binding shape. Only literal
 * constraints are represented here; per-node prop references are applied by
 * `resolveLocalComponentBindingConstraints` during compilation.
 */
export function localComponentHostBinding(
  definition: LocalComponentDefinition,
): LocalHostBindingSchema | undefined {
  const binding = definition.bindings?.value;
  if (binding === undefined) return undefined;
  if (binding.kind !== 'number' && binding.kind !== 'string' && binding.kind !== 'boolean') return undefined;
  const compatibleRules = ['empty', 'false', 'first-option', 'min', 'nearest-zero'] as const;
  const initialRule = compatibleRules.find(rule => rule === binding.initialRule);
  const constraints = binding.constraints;
  const literal = (value: { readonly literal: number } | { readonly prop: string } | undefined): number | undefined =>
    value !== undefined && 'literal' in value ? value.literal : undefined;
  const min = literal(constraints?.min);
  const max = literal(constraints?.max);
  const step = literal(constraints?.step);
  return {
    kind: binding.kind,
    ...(initialRule ? { initialRule } : {}),
    ...(binding.options ? { options: [...binding.options] } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(binding.kind === 'number' ? { step: step ?? 1 } : {}),
  };
}
