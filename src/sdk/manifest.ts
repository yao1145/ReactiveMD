import type { LocalBindingFamily } from '../local/schema';
import { localHash } from './hash';
import { isSafeLocalPattern } from './pattern';
import {
  LOCAL_COMPONENT_PROTOCOL,
  type LocalComponentAuthoring,
  type LocalComponentBinding,
  type LocalComponentBindingConstraint,
  type LocalComponentBindingConstraints,
  type LocalComponentCapabilities,
  type LocalComponentChildren,
  type LocalComponentDefinition,
  type LocalComponentDependency,
  type LocalComponentForm,
  type LocalComponentInitialRule,
  type LocalComponentProp,
  type LocalComponentPropKind,
  type LocalComponentRequirement,
  type LocalComponentRequires,
  type LocalComponentText,
} from './types';
import { parseLocalVersionRange } from './version';

/** Bounded registration budgets for external manifests. */
export const MAX_LOCAL_SDK_COMPONENTS = 64;
export const MAX_LOCAL_SDK_PROPS = 64;
export const MAX_LOCAL_SDK_NAME_LENGTH = 128;
export const MAX_LOCAL_SDK_ID_LENGTH = 160;
export const MAX_LOCAL_SDK_VERSION_LENGTH = 64;
export const MAX_LOCAL_SDK_ENUM_VALUES = 64;
export const MAX_LOCAL_SDK_PATTERN_LENGTH = 512;
export const MAX_LOCAL_SDK_STRING_LENGTH = 4096;
export const MAX_LOCAL_SDK_DEPENDENCIES = 16;
export const MAX_LOCAL_SDK_STYLES = 32;
export const MAX_LOCAL_SDK_STYLE_ID_LENGTH = 256;
/** Aggregate serialized-size budget for one component manifest. */
export const MAX_LOCAL_SDK_MANIFEST_BYTES = 64 * 1024;

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const validatedDefinitions = new WeakSet<object>();

const PROP_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'enum']);
const FORMS: ReadonlySet<string> = new Set(['leaf', 'inline', 'container']);
const BINDING_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);
const FAMILIES: ReadonlySet<string> = new Set([
  'text', 'number', 'boolean', 'choice', 'date', 'timer', 'checklist',
  'tabs', 'diagram', 'multi-select', 'selection', 'steps',
]);
const INITIAL_RULES: ReadonlySet<string> = new Set(['empty', 'false', 'nearest-zero', 'min', 'first-option']);
const CHILD_KINDS: ReadonlySet<string> = new Set(['none', 'inline', 'markdown']);
const TOP_KEYS = new Set([
  'id', 'name', 'version', 'protocol', 'form', 'props', 'bindings',
  'children', 'capabilities', 'authoring', 'dependencies', 'styles', 'requires',
]);
const PROP_KEYS = new Set(['kind', 'required', 'static', 'dynamic', 'default', 'enum', 'pattern', 'min', 'max', 'integer', 'description']);
const BINDING_KEYS = new Set(['kind', 'family', 'bind', 'initial', 'initialRule', 'constraints', 'options']);
const CONSTRAINT_KEYS = new Set(['min', 'max', 'step']);
const CAPABILITY_KEYS = new Set(['interactive', 'static', 'ssr', 'offline']);
const AUTHORING_KEYS = new Set(['title', 'description', 'category', 'insertText']);
const CHILD_KEYS = new Set(['kind', 'required']);
const DEPENDENCY_KEYS = new Set(['id', 'version']);
const REQUIRES_KEYS = new Set(['kernel']);
const STYLE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Attributes owned implicitly by a declared binding. */
export const LOCAL_BINDING_ATTRIBUTES: ReadonlySet<string> = new Set(['bind', 'initial', 'disabled']);

function fail(path: string, message: string): never {
  throw new Error(`Invalid local component manifest (${path}): ${message}`);
}

/** UTF-8 byte length of JSON-compatible data, bounded by the caller. */
export function localJsonByteLength(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') return Number.POSITIVE_INFINITY;
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return text.length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) fail(path, `field "${key}" is not allowed.`);
    if (!allowed.has(key)) fail(path, `unknown field "${key}".`);
  }
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean.');
  return value;
}

function readString(value: unknown, path: string, limit = MAX_LOCAL_SDK_STRING_LENGTH): string {
  if (typeof value !== 'string') fail(path, 'must be a string.');
  if (value.length > limit) fail(path, `exceeds the ${limit}-character limit.`);
  return value;
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number.');
  return value;
}

function readIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string.');
  if (value.length > MAX_LOCAL_SDK_NAME_LENGTH) fail(path, `exceeds the ${MAX_LOCAL_SDK_NAME_LENGTH}-character limit.`);
  if (!NAME.test(value)) fail(path, 'must use lowercase kebab-case.');
  return value;
}

function readTextMap(value: unknown, path: string): LocalComponentText {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  const out: Record<string, string> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key)) fail(path, `locale "${key}" is not allowed.`);
    if (!LOCALE.test(key)) fail(path, `locale "${key}" must look like "en" or "zh-CN".`);
    out[key] = readString(value[key], `${path}.${key}`, 256);
  }
  return out;
}

function readAuthoring(value: unknown, path: string): LocalComponentAuthoring {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, AUTHORING_KEYS, path);
  const out: {
    title?: LocalComponentText;
    description?: LocalComponentText;
    category?: string;
    insertText?: string;
  } = {};
  if (value.title !== undefined) out.title = readTextMap(value.title, `${path}.title`);
  if (value.description !== undefined) out.description = readTextMap(value.description, `${path}.description`);
  if (value.category !== undefined) out.category = readString(value.category, `${path}.category`, 64);
  if (value.insertText !== undefined) out.insertText = readString(value.insertText, `${path}.insertText`, MAX_LOCAL_SDK_STRING_LENGTH);
  return out;
}

function readChildren(value: unknown, form: LocalComponentForm, path: string): LocalComponentChildren {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, CHILD_KEYS, path);
  const rawKind = value.kind;
  if (typeof rawKind !== 'string' || !CHILD_KINDS.has(rawKind)) {
    fail(`${path}.kind`, 'must be "none", "inline" or "markdown".');
  }
  const kind = rawKind as LocalComponentChildren['kind'];
  if (value.required !== undefined) readBoolean(value.required, `${path}.required`);
  const required = value.required === true;
  if (form === 'leaf' && kind !== 'none') {
    fail(path, 'a leaf component cannot declare body content.');
  }
  if (form === 'inline' && kind === 'markdown') {
    fail(path, 'an inline component cannot declare Markdown block content.');
  }
  if (required && kind === 'none') fail(path, 'cannot require body content of kind "none".');
  return { kind, ...(required ? { required: true } : {}) };
}

function readCapabilities(value: unknown, path: string): LocalComponentCapabilities {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, CAPABILITY_KEYS, path);
  const read = (key: keyof LocalComponentCapabilities): boolean =>
    value[key] === undefined ? false : readBoolean(value[key], `${path}.${key}`);
  return {
    interactive: read('interactive'),
    static: read('static'),
    ssr: read('ssr'),
    offline: read('offline'),
  };
}

function readProp(value: unknown, path: string): LocalComponentProp {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, PROP_KEYS, path);
  const kind = value.kind;
  if (typeof kind !== 'string' || !PROP_KINDS.has(kind)) {
    fail(`${path}.kind`, 'must be "string", "number", "boolean" or "enum".');
  }
  const typedKind = kind as LocalComponentPropKind;
  const out: {
    kind: LocalComponentPropKind;
    required?: boolean;
    static?: boolean;
    dynamic?: boolean;
    default?: string | number | boolean;
    enum?: readonly string[];
    pattern?: string;
    min?: number;
    max?: number;
    integer?: boolean;
    description?: LocalComponentText;
  } = { kind: typedKind };
  for (const flag of ['required', 'static', 'dynamic', 'integer'] as const) {
    if (value[flag] === undefined) continue;
    out[flag] = readBoolean(value[flag], `${path}.${flag}`);
  }
  if (out.static === true && out.dynamic === true) {
    fail(path, 'cannot be both static and dynamic.');
  }
  const hasEnum = value.enum !== undefined;
  if (typedKind !== 'enum') {
    if (hasEnum) fail(path, `"enum" is only valid for kind "enum", not "${typedKind}".`);
  } else {
    if (!Array.isArray(value.enum) || value.enum.length === 0) {
      fail(`${path}.enum`, 'must be a non-empty string array.');
    }
    if (value.enum.length > MAX_LOCAL_SDK_ENUM_VALUES) {
      fail(`${path}.enum`, `accepts at most ${MAX_LOCAL_SDK_ENUM_VALUES} values.`);
    }
    const seen = new Set<string>();
    const values: string[] = [];
    for (const item of value.enum) {
      const text = readString(item, `${path}.enum`, MAX_LOCAL_SDK_NAME_LENGTH);
      if (seen.has(text)) fail(`${path}.enum`, `value "${text}" is declared more than once.`);
      seen.add(text);
      values.push(text);
    }
    out.enum = values;
  }
  const hasPattern = value.pattern !== undefined;
  if (typedKind !== 'string') {
    if (hasPattern) fail(path, `"pattern" is only valid for kind "string", not "${typedKind}".`);
  } else if (hasPattern) {
    if (typeof value.pattern !== 'string') fail(`${path}.pattern`, 'must be a string.');
    if (value.pattern.length > MAX_LOCAL_SDK_PATTERN_LENGTH) {
      fail(`${path}.pattern`, `exceeds the ${MAX_LOCAL_SDK_PATTERN_LENGTH}-character limit.`);
    }
    try {
      new RegExp(value.pattern);
    } catch {
      fail(`${path}.pattern`, 'is not a valid regular expression.');
    }
    if (!isSafeLocalPattern(value.pattern)) {
      fail(`${path}.pattern`, 'uses unsupported regex syntax; nested quantifiers, quantified alternation, backreferences and lookarounds are rejected.');
    }
    out.pattern = value.pattern;
  }
  const hasMin = value.min !== undefined;
  const hasMax = value.max !== undefined;
  if (typedKind !== 'number') {
    if (hasMin || hasMax) fail(path, '"min" and "max" are only valid for kind "number".');
    if (out.integer === true) fail(path, '"integer" is only valid for kind "number".');
  } else {
    if (hasMin) out.min = readFiniteNumber(value.min, `${path}.min`);
    if (hasMax) out.max = readFiniteNumber(value.max, `${path}.max`);
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
      fail(path, '"min" cannot exceed "max".');
    }
  }
  if (value.description !== undefined) {
    out.description = readTextMap(value.description, `${path}.description`);
  }
  const hasDefault = value.default !== undefined;
  if (hasDefault) {
    const fallback = value.default;
    if (typedKind === 'string') {
      out.default = readString(fallback, `${path}.default`);
    } else if (typedKind === 'number') {
      const numeric = readFiniteNumber(fallback, `${path}.default`);
      if (out.integer === true && !Number.isInteger(numeric)) {
        fail(`${path}.default`, 'must be an integer.');
      }
      if (out.min !== undefined && numeric < out.min) fail(`${path}.default`, `is below the minimum ${out.min}.`);
      if (out.max !== undefined && numeric > out.max) fail(`${path}.default`, `exceeds the maximum ${out.max}.`);
      out.default = numeric;
    } else if (typedKind === 'boolean') {
      out.default = readBoolean(fallback, `${path}.default`);
    } else {
      const text = readString(fallback, `${path}.default`, MAX_LOCAL_SDK_NAME_LENGTH);
      if (!out.enum?.includes(text)) fail(`${path}.default`, `"${text}" is not an allowed enum value.`);
      out.default = text;
    }
    if (out.pattern !== undefined && typedKind === 'string') {
      let accepted = true;
      try {
        accepted = new RegExp(out.pattern).test(String(out.default));
      } catch {
        accepted = false;
      }
      if (!accepted) fail(`${path}.default`, `does not match pattern ${out.pattern}.`);
    }
  }
  return out;
}

function readConstraint(value: unknown, path: string): LocalComponentBindingConstraint {
  if (!isPlainRecord(value)) fail(path, 'must be an object with "literal" or "prop".');
  const keys = Object.keys(value);
  if (keys.length !== 1) fail(path, 'must contain exactly one of "literal" or "prop".');
  const key = keys[0];
  if (DANGEROUS_KEYS.has(key)) fail(path, `field "${key}" is not allowed.`);
  if (key === 'literal') {
    const literal = readFiniteNumber(value.literal, `${path}.literal`);
    return { literal };
  }
  if (key === 'prop') {
    const prop = readIdentifier(value.prop, `${path}.prop`);
    return { prop };
  }
  fail(path, `unknown field "${key}"; use "literal" or "prop".`);
}

function readConstraints(
  value: unknown,
  props: Readonly<Record<string, LocalComponentProp>>,
  path: string,
): LocalComponentBindingConstraints {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, CONSTRAINT_KEYS, path);
  const out: { min?: LocalComponentBindingConstraint; max?: LocalComponentBindingConstraint; step?: LocalComponentBindingConstraint } = {};
  for (const key of ['min', 'max', 'step'] as const) {
    if (value[key] === undefined) continue;
    const constraint = readConstraint(value[key], `${path}.${key}`);
    if ('prop' in constraint) {
      const prop = props[constraint.prop];
      if (prop === undefined) fail(`${path}.${key}`, `references undeclared prop "${constraint.prop}".`);
      if (prop.kind !== 'number') {
        fail(`${path}.${key}`, `references prop "${constraint.prop}", which is not a number.`);
      }
    }
    if (key === 'step' && 'literal' in constraint && !(constraint.literal > 0)) {
      fail(`${path}.step`, 'must be greater than 0.');
    }
    out[key] = constraint;
  }
  if (out.min && 'literal' in out.min && out.max && 'literal' in out.max && out.min.literal > out.max.literal) {
    fail(path, '"min" cannot exceed "max".');
  }
  return out;
}

function readBinding(
  value: unknown,
  props: Readonly<Record<string, LocalComponentProp>>,
  path: string,
): LocalComponentBinding {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, BINDING_KEYS, path);
  const kind = value.kind;
  if (typeof kind !== 'string' || !BINDING_KINDS.has(kind)) {
    fail(`${path}.kind`, 'must be "string", "number" or "boolean".');
  }
  const typedKind = kind as LocalComponentBinding['kind'];
  const family = value.family;
  if (typeof family !== 'string' || !FAMILIES.has(family)) {
    fail(`${path}.family`, 'must be a supported binding family.');
  }
  if (typedKind === 'number' && family !== 'number') fail(`${path}.family`, 'must be "number" for a number binding.');
  if (typedKind === 'boolean' && family !== 'boolean') fail(`${path}.family`, 'must be "boolean" for a boolean binding.');
  if (typedKind === 'string') {
    if (family !== 'text' && family !== 'choice') {
      fail(`${path}.family`, `"${family}" is not supported for a phase-one string binding; use "text" or "choice".`);
    }
  }
  let options: readonly string[] | undefined;
  if (value.options !== undefined) {
    if (typedKind !== 'string') fail(`${path}.options`, 'is only valid for a string binding.');
    if (family !== 'choice') fail(`${path}.options`, 'requires family "choice".');
    const rawOptions = value.options;
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      fail(`${path}.options`, 'must be a non-empty string array.');
    }
    if (rawOptions.length > MAX_LOCAL_SDK_ENUM_VALUES) {
      fail(`${path}.options`, `accepts at most ${MAX_LOCAL_SDK_ENUM_VALUES} values.`);
    }
    const seen = new Set<string>();
    const values: string[] = [];
    for (const item of rawOptions) {
      const text = readString(item, `${path}.options`, MAX_LOCAL_SDK_NAME_LENGTH);
      if (text.length === 0) fail(`${path}.options`, 'values must be non-empty.');
      if (seen.has(text)) fail(`${path}.options`, `value "${text}" is declared more than once.`);
      seen.add(text);
      values.push(text);
    }
    options = Object.freeze(values);
  }
  if (typedKind === 'string' && family === 'choice' && options === undefined) {
    fail(`${path}.options`, 'is required for a choice binding.');
  }
  if (value.bind !== 'bind') fail(`${path}.bind`, 'must be "bind" in phase one.');
  if (value.initial !== 'initial') fail(`${path}.initial`, 'must be "initial" in phase one.');
  const defaultRule: LocalComponentInitialRule = typedKind === 'number'
    ? 'nearest-zero'
    : typedKind === 'boolean'
      ? 'false'
      : family === 'choice' ? 'first-option' : 'empty';
  let initialRule: LocalComponentInitialRule = defaultRule;
  if (value.initialRule !== undefined) {
    if (typeof value.initialRule !== 'string' || !INITIAL_RULES.has(value.initialRule)) {
      fail(`${path}.initialRule`, 'is not a supported initial rule.');
    }
    initialRule = value.initialRule as LocalComponentInitialRule;
  }
  if (typedKind === 'number' && initialRule !== 'min' && initialRule !== 'nearest-zero') {
    fail(`${path}.initialRule`, 'must be "min" or "nearest-zero" for a number binding.');
  }
  if (typedKind === 'boolean' && initialRule !== 'false') {
    fail(`${path}.initialRule`, 'must be "false" for a boolean binding.');
  }
  if (typedKind === 'string' && initialRule !== defaultRule) {
    fail(`${path}.initialRule`, `must be "${defaultRule}" for a ${family} binding.`);
  }
  let constraints: LocalComponentBindingConstraints | undefined;
  if (value.constraints !== undefined) {
    if (typedKind !== 'number') fail(`${path}.constraints`, 'is only valid for a number binding.');
    constraints = readConstraints(value.constraints, props, `${path}.constraints`);
  }
  return {
    kind: typedKind,
    family: family as LocalBindingFamily,
    bind: 'bind',
    initial: 'initial',
    initialRule,
    ...(options ? { options } : {}),
    ...(constraints ? { constraints } : {}),
  };
}

function readDependency(value: unknown, path: string): LocalComponentDependency {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, DEPENDENCY_KEYS, path);
  const id = value.id;
  if (typeof id !== 'string' || !ID.test(id) || id.length > MAX_LOCAL_SDK_ID_LENGTH) {
    fail(`${path}.id`, 'must be a lowercase namespaced id.');
  }
  let version: string | undefined;
  if (value.version !== undefined) {
    const raw = value.version;
    const parsed = parseLocalVersionRange(raw);
    if (parsed === null) {
      fail(`${path}.version`, 'must be an exact version or a supported range (exact, ^, ~, >=, <=, >, <).');
    }
    version = parsed.source;
  }
  return { id, ...(version ? { version } : {}) };
}

function readRequires(value: unknown): LocalComponentRequires {
  if (!isPlainRecord(value)) fail('requires', 'must be an object.');
  checkKeys(value, REQUIRES_KEYS, 'requires');
  let kernel: string | undefined;
  if (value.kernel !== undefined) {
    const parsed = parseLocalVersionRange(value.kernel);
    if (parsed === null) {
      fail('requires.kernel', 'must be a supported kernel version range (exact, ^, ~, >=, <=, >, <).');
    }
    kernel = parsed.source;
  }
  return { ...(kernel ? { kernel } : {}) };
}

function readStyles(value: unknown): readonly string[] {
  if (!Array.isArray(value)) fail('styles', 'must be an array of style-resource ids.');
  if (value.length > MAX_LOCAL_SDK_STYLES) fail('styles', `accepts at most ${MAX_LOCAL_SDK_STYLES} resources.`);
  const seen = new Set<string>();
  const styles: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LOCAL_SDK_STYLE_ID_LENGTH) {
      fail(`styles[${index}]`, `must be a non-empty string of at most ${MAX_LOCAL_SDK_STYLE_ID_LENGTH} characters.`);
    }
    if (!STYLE_ID.test(raw)) fail(`styles[${index}]`, 'must be a bounded resource id.');
    if (seen.has(raw)) fail('styles', `resource "${raw}" is declared more than once.`);
    seen.add(raw);
    styles.push(raw);
  }
  return Object.freeze(styles);
}

/**
 * Validate and normalize one component manifest. Unknown fields, unsafe
 * regexes, conflicting prop modes and invalid defaults are rejected; the
 * result is fresh, bounded, JSON-only data.
 */
export function readLocalComponentManifest(value: unknown): LocalComponentDefinition {
  if (!isPlainRecord(value)) fail('manifest', 'must be an object.');
  checkKeys(value, TOP_KEYS, 'manifest');
  const id = value.id;
  if (typeof id !== 'string' || id.length > MAX_LOCAL_SDK_ID_LENGTH || !ID.test(id)) {
    fail('id', 'must be a lowercase namespaced id such as "example/rating".');
  }
  const name = readIdentifier(value.name, 'name');
  const version = value.version;
  if (typeof version !== 'string' || version.length > MAX_LOCAL_SDK_VERSION_LENGTH || !VERSION.test(version)) {
    fail('version', 'must be a semantic version such as 1.0.0.');
  }
  if (value.protocol !== LOCAL_COMPONENT_PROTOCOL) {
    fail('protocol', `must be "${LOCAL_COMPONENT_PROTOCOL}".`);
  }
  const rawForm = value.form;
  if (typeof rawForm !== 'string' || !FORMS.has(rawForm)) {
    fail('form', 'must be "leaf", "inline" or "container".');
  }
  const form = rawForm as LocalComponentForm;
  if (!isPlainRecord(value.props)) fail('props', 'must be an object.');
  const propNames = Object.keys(value.props).sort();
  if (propNames.length > MAX_LOCAL_SDK_PROPS) fail('props', `accepts at most ${MAX_LOCAL_SDK_PROPS} properties.`);
  const props: Record<string, LocalComponentProp> = {};
  for (const propName of propNames) {
    if (DANGEROUS_KEYS.has(propName)) fail('props', `property "${propName}" is not allowed.`);
    if (!NAME.test(propName) || propName.length > MAX_LOCAL_SDK_NAME_LENGTH) {
      fail('props', `property "${propName}" must use lowercase kebab-case.`);
    }
    props[propName] = readProp(value.props[propName], `props.${propName}`);
  }

  let bindings: LocalComponentDefinition['bindings'];
  if (value.bindings !== undefined) {
    if (!isPlainRecord(value.bindings)) fail('bindings', 'must be an object.');
    const bindingKeys = Object.keys(value.bindings);
    for (const key of bindingKeys) {
      if (DANGEROUS_KEYS.has(key)) fail('bindings', `field "${key}" is not allowed.`);
      if (key !== 'value') fail('bindings', `unknown field "${key}"; phase one supports only "value".`);
    }
    if (bindingKeys.length === 0) fail('bindings', 'must declare "value".');
    const binding = readBinding(value.bindings.value, props, 'bindings.value');
    for (const attribute of LOCAL_BINDING_ATTRIBUTES) {
      if (Object.hasOwn(props, attribute)) {
        fail('props', `property "${attribute}" is reserved by the declared binding.`);
      }
    }
    bindings = Object.freeze({ value: Object.freeze(binding) });
  }

  const children = value.children === undefined ? undefined : readChildren(value.children, form, 'children');
  const capabilities = readCapabilities(value.capabilities, 'capabilities');
  const authoring = value.authoring === undefined ? undefined : readAuthoring(value.authoring, 'authoring');
  const styles = value.styles === undefined ? undefined : readStyles(value.styles);
  const requires = value.requires === undefined ? undefined : readRequires(value.requires);
  let dependencies: readonly LocalComponentDependency[] | undefined;
  if (value.dependencies !== undefined) {
    if (!Array.isArray(value.dependencies)) fail('dependencies', 'must be an array.');
    if (value.dependencies.length > MAX_LOCAL_SDK_DEPENDENCIES) {
      fail('dependencies', `accepts at most ${MAX_LOCAL_SDK_DEPENDENCIES} entries.`);
    }
    const seen = new Set<string>();
    const list: LocalComponentDependency[] = [];
    for (let index = 0; index < value.dependencies.length; index += 1) {
      const dependency = readDependency(value.dependencies[index], `dependencies[${index}]`);
      if (seen.has(dependency.id)) fail('dependencies', `"${dependency.id}" is declared more than once.`);
      seen.add(dependency.id);
      list.push(Object.freeze(dependency));
    }
    dependencies = Object.freeze(list);
  }

  const definition: LocalComponentDefinition = {
    id,
    name,
    version,
    protocol: LOCAL_COMPONENT_PROTOCOL,
    form,
    props: Object.freeze(props),
    ...(bindings ? { bindings } : {}),
    ...(children ? { children: Object.freeze(children) } : {}),
    capabilities: Object.freeze(capabilities),
    ...(authoring ? { authoring: Object.freeze(authoring) } : {}),
    ...(styles ? { styles } : {}),
    ...(requires ? { requires: Object.freeze(requires) } : {}),
    ...(dependencies ? { dependencies } : {}),
  };
  if (localJsonByteLength(definition) > MAX_LOCAL_SDK_MANIFEST_BYTES) {
    fail('manifest', `serialized size exceeds the ${MAX_LOCAL_SDK_MANIFEST_BYTES}-byte budget.`);
  }
  const frozen = deepFreeze(definition);
  validatedDefinitions.add(frozen);
  return frozen;
}

/** `defineLocalComponent` validates, clones and freezes a manifest. */
export function defineLocalComponent(input: LocalComponentDefinition): LocalComponentDefinition {
  return readLocalComponentManifest(input);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

function canonicalProp(prop: LocalComponentProp): Record<string, unknown> {
  return {
    kind: prop.kind,
    ...(prop.required === true ? { required: true } : {}),
    ...(prop.static === true ? { static: true } : {}),
    ...(prop.dynamic !== undefined ? { dynamic: prop.dynamic } : {}),
    ...(prop.default !== undefined ? { default: prop.default } : {}),
    ...(prop.enum ? { enum: [...prop.enum] } : {}),
    ...(prop.pattern !== undefined ? { pattern: prop.pattern } : {}),
    ...(prop.min !== undefined ? { min: prop.min } : {}),
    ...(prop.max !== undefined ? { max: prop.max } : {}),
    ...(prop.integer === true ? { integer: true } : {}),
  };
}

function canonicalConstraint(constraint: LocalComponentBindingConstraint): Record<string, unknown> {
  return 'literal' in constraint ? { literal: constraint.literal } : { prop: constraint.prop };
}

function canonicalBinding(binding: LocalComponentBinding): Record<string, unknown> {
  const constraints = binding.constraints;
  return {
    kind: binding.kind,
    family: binding.family,
    bind: binding.bind,
    initial: binding.initial,
    initialRule: binding.initialRule,
    ...(binding.options ? { options: [...binding.options] } : {}),
    ...(constraints
      ? {
          constraints: {
            ...(constraints.min ? { min: canonicalConstraint(constraints.min) } : {}),
            ...(constraints.max ? { max: canonicalConstraint(constraints.max) } : {}),
            ...(constraints.step ? { step: canonicalConstraint(constraints.step) } : {}),
          },
        }
      : {}),
  };
}

/**
 * Deterministic, key-order-independent view of a normalized manifest.
 *
 * Authoring metadata and per-prop descriptions are deliberately excluded:
 * editor copy must not change a component's compile semantic digest.
 */
export function canonicalLocalComponent(definition: LocalComponentDefinition): unknown {
  const props: Record<string, unknown> = {};
  for (const name of Object.keys(definition.props).sort()) props[name] = canonicalProp(definition.props[name]);
  return {
    protocol: definition.protocol,
    id: definition.id,
    name: definition.name,
    version: definition.version,
    form: definition.form,
    props,
    ...(definition.bindings ? { bindings: { value: canonicalBinding(definition.bindings.value) } } : {}),
    ...(definition.children
      ? { children: { kind: definition.children.kind, ...(definition.children.required ? { required: true } : {}) } }
      : {}),
    capabilities: {
      interactive: definition.capabilities.interactive,
      static: definition.capabilities.static,
      ssr: definition.capabilities.ssr,
      offline: definition.capabilities.offline,
    },
    ...(definition.styles ? { styles: [...definition.styles] } : {}),
    ...(definition.requires?.kernel ? { requires: { kernel: definition.requires.kernel } } : {}),
    ...(definition.dependencies
      ? { dependencies: [...definition.dependencies].map((item) => ({ ...item })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }
      : {}),
  };
}

const digestCache = new WeakMap<object, string>();

/** Stable semantic digest of one manifest. */
export function localComponentDigest(definition: LocalComponentDefinition): string {
  const normalized = validatedDefinitions.has(definition) ? definition : readLocalComponentManifest(definition);
  const cached = digestCache.get(normalized);
  if (cached !== undefined) return cached;
  const digest = localHash(JSON.stringify(canonicalLocalComponent(normalized)));
  digestCache.set(normalized, digest);
  return digest;
}

/** Plain requirement record used by compiled documents and export checks. */
export function localComponentRequirement(definition: LocalComponentDefinition): LocalComponentRequirement {
  return Object.freeze({
    id: definition.id,
    name: definition.name,
    version: definition.version,
    digest: localComponentDigest(definition),
  });
}

/** Read-only check used by registry validation and tests. */
export function isLocalComponentName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LOCAL_SDK_NAME_LENGTH && NAME.test(value);
}
