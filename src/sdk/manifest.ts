import { localHash } from './hash';
import { isSafeLocalPattern } from './pattern';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DATA_DOCUMENT_CELLS,
  MAX_LOCAL_DATA_DOCUMENT_ROWS,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_VALIDATIONS,
} from '../local/limits';
import {
  LOCAL_COMPONENT_PROTOCOL,
  type LocalBindingFamily,
  type LocalChildRule,
  type LocalComponentAuthoring,
  type LocalComponentBinding,
  type LocalComponentBindingConstraint,
  type LocalComponentBindingConstraints,
  type LocalComponentBindingKind,
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
  type LocalComponentRule,
  type LocalComponentSlotRelation,
  type LocalComponentStructure,
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
const BINDING_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'null', 'array', 'number-array']);
const FAMILIES: ReadonlySet<string> = new Set([
  'text', 'number', 'boolean', 'choice', 'date', 'timer', 'checklist',
  'tabs', 'diagram', 'multi-select', 'selection', 'steps', 'collection',
]);
const INITIAL_RULES: ReadonlySet<string> = new Set([
  'empty', 'false', 'max-step', 'nearest-zero', 'min', 'first-option', 'first-tab',
  'first-step', 'first-node', 'checked', 'duration', 'empty-array', 'none',
]);
const CHILD_KINDS: ReadonlySet<string> = new Set(['none', 'inline', 'markdown']);
const CHILD_RULES: ReadonlySet<string> = new Set([
  'none', 'any', 'inline', 'content', 'table', 'plot', 'diagram', 'quiz',
  'options', 'tabs', 'steps', 'components',
]);
const RULE_KINDS: ReadonlySet<string> = new Set([
  'numeric-range', 'text-length', 'date-bounds', 'nonempty', 'progress-bounds',
  'timer-duration', 'option-count', 'selection-requires', 'inline-body',
  'no-components', 'single-table', 'math-body', 'options-body', 'value-sequence',
  'only-children', 'diagram-body', 'quiz-body', 'checklist-body',
  'dynamic-constraints', 'require-full-interpolation', 'scoped-expressions',
  'row-values', 'validation-rule', 'anchor', 'navigation', 'data-table',
  'plot-math', 'chart-table', 'timeline-table', 'table-selection', 'retain',
  'self-binding-read', 'inline-math-reads', 'value-date', 'value-length',
  'value-required', 'value-email',
]);
const LABELS: ReadonlySet<string> = new Set(['none', 'required', 'optional']);
const TOP_KEYS = new Set([
  'id', 'name', 'version', 'protocol', 'form', 'props', 'bindings',
  'children', 'structure', 'rules', 'slotRelations', 'legacyHost',
  'capabilities', 'authoring', 'dependencies', 'styles', 'requires',
]);
const PROP_KEYS = new Set([
  'kind', 'required', 'static', 'dynamic', 'default', 'nullable', 'enum', 'values',
  'pattern', 'min', 'max', 'integer', 'positive', 'color', 'coerce', 'description',
]);
const BINDING_KEYS = new Set([
  'kind', 'family', 'bind', 'initial', 'initialRule', 'required', 'exclusive',
  'constraints', 'options', 'maxItems', 'requiresAttributes', 'compare', 'retain',
]);
const CONSTRAINT_KEYS = new Set(['min', 'max', 'step']);
const CAPABILITY_KEYS = new Set(['interactive', 'static', 'ssr', 'offline']);
const AUTHORING_KEYS = new Set(['title', 'description', 'category', 'insertText']);
const CHILD_KEYS = new Set(['kind', 'required']);
const STRUCTURE_KEYS = new Set([
  'rule', 'label', 'parents', 'child', 'children', 'min', 'max', 'inlineOnly',
  'noComponents', 'valueAttribute', 'generatedPrefix', 'forbidSeparator',
  'maxItems',
]);
const DEPENDENCY_KEYS = new Set(['id', 'version']);
const REQUIRES_KEYS = new Set(['kernel']);
const STYLE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
/** Slot names and `setMany` are part of the public binding API. */
const SLOT_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const RESERVED_SLOT_NAMES: ReadonlySet<string> = new Set(['setMany']);
/** Bounded public rule/slot counts for one manifest. */
export const MAX_LOCAL_SDK_BINDINGS = 16;
export const MAX_LOCAL_SDK_RULES = 32;
export const MAX_LOCAL_SDK_RULE_SLOTS = 16;
export const MAX_LOCAL_SDK_STRUCTURE_ITEMS = 32;

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

/** Map a legacy `children` declaration to the equivalent public structure. */
export function localStructureFromChildren(children: LocalComponentChildren | undefined): LocalComponentStructure | undefined {
  if (children === undefined) return undefined;
  if (children.kind === 'none') {
    return Object.freeze({ rule: 'none', label: 'none' });
  }
  if (children.kind === 'inline') {
    return Object.freeze({ rule: 'inline', label: 'none', inlineOnly: true, noComponents: true, ...(children.required ? { min: 1 } : {}) });
  }
  return Object.freeze({ rule: 'any', label: 'none', ...(children.required ? { min: 1 } : {}) });
}

function readNameList(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(path, 'must be an array of component names.');
  if (value.length > MAX_LOCAL_SDK_STRUCTURE_ITEMS) {
    fail(path, `accepts at most ${MAX_LOCAL_SDK_STRUCTURE_ITEMS} names.`);
  }
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    const name = readIdentifier(item, path);
    if (seen.has(name)) fail(path, `name "${name}" is declared more than once.`);
    seen.add(name);
    names.push(name);
  }
  return Object.freeze(names);
}

function readPositiveCount(value: unknown, path: string): number {
  const numeric = readFiniteNumber(value, path);
  if (!Number.isInteger(numeric) || numeric < 0) fail(path, 'must be a nonnegative integer.');
  return numeric;
}

function readStructure(value: unknown, form: LocalComponentForm, path: string): LocalComponentStructure {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, STRUCTURE_KEYS, path);
  const rawRule = value.rule;
  if (typeof rawRule !== 'string' || !CHILD_RULES.has(rawRule)) fail(`${path}.rule`, 'is not a supported child rule.');
  const rule = rawRule as LocalChildRule;
  if (form === 'leaf' && rule !== 'none') fail(path, 'a leaf component cannot declare body content.');
  if (form === 'inline' && rule !== 'none' && rule !== 'inline' && rule !== 'any') {
    fail(path, 'an inline component only supports "none", "inline" or "any".');
  }
  const out: {
    rule: LocalChildRule;
    label?: 'none' | 'required' | 'optional';
    parents?: readonly string[];
    child?: string;
    children?: readonly string[];
    min?: number;
    max?: number;
    inlineOnly?: boolean;
    noComponents?: boolean;
    valueAttribute?: string;
    generatedPrefix?: string;
    forbidSeparator?: string;
    maxItems?: number;
  } = { rule };
  if (value.label !== undefined) {
    if (typeof value.label !== 'string' || !LABELS.has(value.label)) {
      fail(`${path}.label`, 'must be "none", "required" or "optional".');
    }
    out.label = value.label as 'none' | 'required' | 'optional';
  }
  if (value.parents !== undefined) out.parents = readNameList(value.parents, `${path}.parents`);
  if (value.child !== undefined) out.child = readIdentifier(value.child, `${path}.child`);
  if (value.children !== undefined) out.children = readNameList(value.children, `${path}.children`);
  if (value.min !== undefined) out.min = readBoundedCount(value.min, `${path}.min`, MAX_LOCAL_ARRAY_LENGTH);
  if (value.max !== undefined) out.max = readBoundedCount(value.max, `${path}.max`, MAX_LOCAL_ARRAY_LENGTH);
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
    fail(path, '"min" cannot exceed "max".');
  }
  if (value.inlineOnly !== undefined) out.inlineOnly = readBoolean(value.inlineOnly, `${path}.inlineOnly`);
  if (value.noComponents !== undefined) out.noComponents = readBoolean(value.noComponents, `${path}.noComponents`);
  if (value.valueAttribute !== undefined) out.valueAttribute = readIdentifier(value.valueAttribute, `${path}.valueAttribute`);
  if (value.generatedPrefix !== undefined) {
    const prefix = readString(value.generatedPrefix, `${path}.generatedPrefix`, MAX_LOCAL_SDK_NAME_LENGTH);
    if (prefix.length === 0) fail(`${path}.generatedPrefix`, 'must not be empty.');
    out.generatedPrefix = prefix;
  }
  if (value.forbidSeparator !== undefined) {
    const separator = readString(value.forbidSeparator, `${path}.forbidSeparator`, 4);
    if (separator.length === 0) fail(`${path}.forbidSeparator`, 'must not be empty.');
    out.forbidSeparator = separator;
  }
  if (value.maxItems !== undefined) out.maxItems = readBoundedCount(value.maxItems, `${path}.maxItems`, MAX_LOCAL_ARRAY_LENGTH);
  return Object.freeze(out);
}

function readRuleAttribute(value: unknown, path: string): string {
  return readIdentifier(value, path);
}

function readRuleCount(value: unknown, path: string): number {
  return readPositiveCount(value, path);
}

/** A declared budget may lower a kernel hard limit, never raise it. */
function readBoundedCount(value: unknown, path: string, limit: number): number {
  const numeric = readPositiveCount(value, path);
  if (numeric > limit) fail(path, `cannot exceed the kernel limit ${limit}.`);
  return numeric;
}

function readRuleStringList(value: unknown, path: string): readonly string[] {
  return readNameList(value, path);
}

/** Display strings such as timeline headers; not identifiers. */
function readPlainStringList(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(path, 'must be an array of strings.');
  if (value.length > MAX_LOCAL_SDK_STRUCTURE_ITEMS) fail(path, `accepts at most ${MAX_LOCAL_SDK_STRUCTURE_ITEMS} values.`);
  return Object.freeze(value.map((item) => readString(item, path, MAX_LOCAL_SDK_NAME_LENGTH)));
}

function readRule(value: unknown, path: string): LocalComponentRule {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  const kind = value.kind;
  if (typeof kind !== 'string' || !RULE_KINDS.has(kind)) fail(`${path}.kind`, 'is not a supported rule.');
  const allow = (keys: readonly string[]): void => checkKeys(value, new Set(['kind', ...keys]), path);
  const strings = (keys: readonly string[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const key of keys) {
      if (value[key] !== undefined) out[key] = readRuleAttribute(value[key], `${path}.${key}`);
    }
    return out;
  };
  switch (kind) {
    case 'numeric-range': {
      allow(['min', 'max', 'step', 'order', 'integer', 'positiveInteger']);
      let order: 'nondecreasing' | 'increasing' | undefined;
      if (value.order !== undefined) {
        if (value.order !== 'nondecreasing' && value.order !== 'increasing') {
          fail(`${path}.order`, 'must be "nondecreasing" or "increasing".');
        }
        order = value.order;
      }
      return Object.freeze({
        kind,
        ...strings(['min', 'max', 'step', 'integer', 'positiveInteger']),
        ...(order ? { order } : {}),
      }) as LocalComponentRule;
    }
    case 'text-length':
      allow(['min', 'max']);
      return Object.freeze({ kind, ...strings(['min', 'max']) }) as LocalComponentRule;
    case 'date-bounds':
      allow(['min', 'max', 'required']);
      return Object.freeze({ kind, ...strings(['min', 'max', 'required']) }) as LocalComponentRule;
    case 'nonempty':
      allow(['attribute']);
      return Object.freeze({ kind, attribute: readRuleAttribute(value.attribute, `${path}.attribute`) }) as LocalComponentRule;
    case 'progress-bounds':
      allow(['value', 'max', 'defaultMax']);
      return Object.freeze({
        kind,
        value: readRuleAttribute(value.value, `${path}.value`),
        max: readRuleAttribute(value.max, `${path}.max`),
        defaultMax: readFiniteNumber(value.defaultMax, `${path}.defaultMax`),
      }) as LocalComponentRule;
    case 'timer-duration':
      allow(['attribute', 'default']);
      return Object.freeze({
        kind,
        attribute: readRuleAttribute(value.attribute, `${path}.attribute`),
        default: readFiniteNumber(value.default, `${path}.default`),
      }) as LocalComponentRule;
    case 'option-count':
      allow(['max']);
      return Object.freeze({
        kind,
        ...(value.max !== undefined ? { max: readRuleAttribute(value.max, `${path}.max`) } : {}),
      }) as LocalComponentRule;
    case 'selection-requires':
      allow(['key', 'attributes']);
      return Object.freeze({
        kind,
        key: readRuleAttribute(value.key, `${path}.key`),
        attributes: readRuleStringList(value.attributes, `${path}.attributes`),
      }) as LocalComponentRule;
    case 'inline-body':
      allow(['strict']);
      return Object.freeze({
        kind,
        ...(value.strict !== undefined ? { strict: readBoolean(value.strict, `${path}.strict`) } : {}),
      }) as LocalComponentRule;
    case 'no-components':
    case 'math-body':
    case 'inline-math-reads':
      allow([]);
      return Object.freeze({ kind }) as LocalComponentRule;
    case 'single-table':
      allow(['fallbackSingle']);
      return Object.freeze({ kind, ...(value.fallbackSingle === undefined ? {} : { fallbackSingle: readBoolean(value.fallbackSingle, `${path}.fallbackSingle`) }) });
    case 'options-body': {
      allow(['child', 'valueAttribute', 'unique', 'max', 'forbidSeparator']);
      return Object.freeze({
        kind,
        child: readRuleAttribute(value.child, `${path}.child`),
        valueAttribute: readRuleAttribute(value.valueAttribute, `${path}.valueAttribute`),
        unique: value.unique === undefined ? true : readBoolean(value.unique, `${path}.unique`),
        ...(value.max !== undefined ? { max: readBoundedCount(value.max, `${path}.max`, MAX_LOCAL_ARRAY_LENGTH) } : {}),
        ...(value.forbidSeparator !== undefined ? { forbidSeparator: readString(value.forbidSeparator, `${path}.forbidSeparator`, 4) } : {}),
      }) as LocalComponentRule;
    }
    case 'value-sequence':
      allow(['child', 'valueAttribute', 'min', 'generatedPrefix', 'unique', 'duplicateCode']);
      return Object.freeze({
        kind,
        child: readRuleAttribute(value.child, `${path}.child`),
        valueAttribute: readRuleAttribute(value.valueAttribute, `${path}.valueAttribute`),
        min: readRuleCount(value.min, `${path}.min`),
        generatedPrefix: readString(value.generatedPrefix, `${path}.generatedPrefix`, MAX_LOCAL_SDK_NAME_LENGTH),
        unique: value.unique === undefined ? true : readBoolean(value.unique, `${path}.unique`),
        ...(value.duplicateCode === undefined ? {} : { duplicateCode: readString(value.duplicateCode, `${path}.duplicateCode`, MAX_LOCAL_SDK_NAME_LENGTH) }),
      }) as LocalComponentRule;
    case 'only-children':
      allow(['children', 'min', 'max', 'maxCode', 'onlyCode']);
      return Object.freeze({
        kind,
        children: readRuleStringList(value.children, `${path}.children`),
        min: readRuleCount(value.min, `${path}.min`),
        ...(value.max !== undefined ? { max: readBoundedCount(value.max, `${path}.max`, MAX_LOCAL_ARRAY_LENGTH) } : {}),
        ...(value.maxCode !== undefined ? { maxCode: readString(value.maxCode, `${path}.maxCode`, MAX_LOCAL_SDK_NAME_LENGTH) } : {}),
        ...(value.onlyCode !== undefined ? { onlyCode: readString(value.onlyCode, `${path}.onlyCode`, MAX_LOCAL_SDK_NAME_LENGTH) } : {}),
      }) as LocalComponentRule;
    case 'diagram-body':
      allow(['node', 'edge', 'id', 'from', 'to', 'label']);
      return Object.freeze({
        kind,
        node: readRuleAttribute(value.node, `${path}.node`),
        edge: readRuleAttribute(value.edge, `${path}.edge`),
        id: readRuleAttribute(value.id, `${path}.id`),
        from: readRuleAttribute(value.from, `${path}.from`),
        to: readRuleAttribute(value.to, `${path}.to`),
        ...(value.label !== undefined ? { label: readRuleAttribute(value.label, `${path}.label`) } : {}),
      }) as LocalComponentRule;
    case 'quiz-body':
      allow(['type', 'answer', 'tolerance', 'child', 'valueAttribute', 'max']);
      return Object.freeze({
        kind,
        type: readRuleAttribute(value.type, `${path}.type`),
        answer: readRuleAttribute(value.answer, `${path}.answer`),
        tolerance: readRuleAttribute(value.tolerance, `${path}.tolerance`),
        child: readRuleAttribute(value.child, `${path}.child`),
        valueAttribute: readRuleAttribute(value.valueAttribute, `${path}.valueAttribute`),
        ...(value.max !== undefined ? { max: readBoundedCount(value.max, `${path}.max`, MAX_LOCAL_ARRAY_LENGTH) } : {}),
      }) as LocalComponentRule;
    case 'checklist-body':
      allow(['itemLimit']);
      return Object.freeze({ kind, itemLimit: readBoundedCount(value.itemLimit, `${path}.itemLimit`, MAX_LOCAL_ARRAY_LENGTH) }) as LocalComponentRule;
    case 'dynamic-constraints':
    case 'require-full-interpolation':
      allow(['attributes']);
      return Object.freeze({ kind, attributes: readRuleStringList(value.attributes, `${path}.attributes`) }) as LocalComponentRule;
    case 'scoped-expressions':
      allow(['attributes', 'scope']);
      if (value.scope !== 'row' && value.scope !== 'validation') fail(`${path}.scope`, 'must be "row" or "validation".');
      return Object.freeze({
        kind,
        attributes: readRuleStringList(value.attributes, `${path}.attributes`),
        scope: value.scope,
      }) as LocalComponentRule;
    case 'row-values':
      allow(['rows', 'key', 'child', 'childValue']);
      return Object.freeze({
        kind,
        rows: readRuleAttribute(value.rows, `${path}.rows`),
        key: readRuleAttribute(value.key, `${path}.key`),
        child: readRuleAttribute(value.child, `${path}.child`),
        childValue: readRuleAttribute(value.childValue, `${path}.childValue`),
      }) as LocalComponentRule;
    case 'validation-rule':
      allow(['when', 'fields', 'message', 'placement', 'max']);
      if (value.placement !== 'container' && value.placement !== 'prose') fail(`${path}.placement`, 'must be "container" or "prose".');
      return Object.freeze({
        kind,
        when: readRuleAttribute(value.when, `${path}.when`),
        fields: readRuleAttribute(value.fields, `${path}.fields`),
        message: readRuleAttribute(value.message, `${path}.message`),
        placement: value.placement,
        max: readBoundedCount(value.max, `${path}.max`, MAX_LOCAL_VALIDATIONS),
      }) as LocalComponentRule;
    case 'anchor':
      allow(['id']);
      return Object.freeze({ kind, id: readRuleAttribute(value.id, `${path}.id`) }) as LocalComponentRule;
    case 'navigation':
      allow(['target']);
      return Object.freeze({ kind, target: readRuleAttribute(value.target, `${path}.target`) }) as LocalComponentRule;
    case 'data-table':
      allow(['rows', 'key', 'child', 'childValue', 'label', 'maxRows', 'defaultMaxRows', 'documentRows', 'documentCells', 'maxColumns']);
      return Object.freeze({
        kind,
        rows: readRuleAttribute(value.rows, `${path}.rows`),
        key: readRuleAttribute(value.key, `${path}.key`),
        child: readRuleAttribute(value.child, `${path}.child`),
        childValue: readRuleAttribute(value.childValue, `${path}.childValue`),
        label: readRuleAttribute(value.label, `${path}.label`),
        maxRows: readRuleAttribute(value.maxRows, `${path}.maxRows`),
        defaultMaxRows: readBoundedCount(value.defaultMaxRows, `${path}.defaultMaxRows`, MAX_LOCAL_DATA_TABLE_ROWS),
        documentRows: readBoundedCount(value.documentRows, `${path}.documentRows`, MAX_LOCAL_DATA_DOCUMENT_ROWS),
        documentCells: readBoundedCount(value.documentCells, `${path}.documentCells`, MAX_LOCAL_DATA_DOCUMENT_CELLS),
        maxColumns: readBoundedCount(value.maxColumns, `${path}.maxColumns`, MAX_LOCAL_DATA_TABLE_COLUMNS),
      }) as LocalComponentRule;
    case 'plot-math':
      allow(['min', 'max', 'samples', 'curves', 'points']);
      return Object.freeze({
        kind,
        min: readRuleAttribute(value.min, `${path}.min`),
        max: readRuleAttribute(value.max, `${path}.max`),
        samples: readRuleAttribute(value.samples, `${path}.samples`),
        curves: readBoundedCount(value.curves, `${path}.curves`, MAX_LOCAL_PLOT_CURVES),
        points: readBoundedCount(value.points, `${path}.points`, MAX_LOCAL_PLOT_POINTS),
      }) as LocalComponentRule;
    case 'chart-table':
      allow(['chartKind', 'x', 'y']);
      return Object.freeze({
        kind,
        chartKind: readRuleAttribute(value.chartKind, `${path}.chartKind`),
        x: readRuleAttribute(value.x, `${path}.x`),
        y: readRuleAttribute(value.y, `${path}.y`),
      }) as unknown as LocalComponentRule;
    case 'timeline-table': {
      allow(['headerSets']);
      if (!Array.isArray(value.headerSets)) fail(`${path}.headerSets`, 'must be an array.');
      const headerSets = value.headerSets.map((entry, index) => readPlainStringList(entry, `${path}.headerSets[${index}]`));
      return Object.freeze({ kind, headerSets: Object.freeze(headerSets) }) as LocalComponentRule;
    }
    case 'table-selection':
      allow(['key', 'bindings']);
      return Object.freeze({
        kind,
        key: readRuleAttribute(value.key, `${path}.key`),
        bindings: readRuleStringList(value.bindings, `${path}.bindings`),
      }) as LocalComponentRule;
    case 'retain':
      allow(['value']);
      return Object.freeze({ kind, value: readBoolean(value.value, `${path}.value`) }) as LocalComponentRule;
    case 'self-binding-read': {
      allow(['mode', 'attribute']);
      if (value.mode !== 'always' && value.mode !== 'attribute') fail(`${path}.mode`, 'must be "always" or "attribute".');
      return Object.freeze({
        kind,
        mode: value.mode,
        ...(value.attribute !== undefined ? { attribute: readRuleAttribute(value.attribute, `${path}.attribute`) } : {}),
      }) as LocalComponentRule;
    }
    case 'value-date':
      allow(['min', 'max', 'required']);
      return Object.freeze({ kind, ...strings(['min', 'max', 'required']) }) as LocalComponentRule;
    case 'value-length':
      allow(['min', 'max', 'email', 'emailType']);
      return Object.freeze({
        kind,
        ...strings(['min', 'max', 'email']),
        ...(value.emailType !== undefined ? { emailType: readString(value.emailType, `${path}.emailType`, MAX_LOCAL_SDK_NAME_LENGTH) } : {}),
      }) as LocalComponentRule;
    case 'value-required':
      allow(['required']);
      return Object.freeze({ kind, required: readRuleAttribute(value.required, `${path}.required`) }) as LocalComponentRule;
    case 'value-email':
      allow(['type', 'value']);
      return Object.freeze({ kind, ...strings(['type']), ...(value.value === undefined ? {} : { value: readString(value.value, `${path}.value`, MAX_LOCAL_SDK_NAME_LENGTH) }) });
    default:
      fail(`${path}.kind`, 'is not a supported rule.');
  }
}

function readRules(value: unknown): readonly LocalComponentRule[] {
  if (!Array.isArray(value)) fail('rules', 'must be an array.');
  if (value.length > MAX_LOCAL_SDK_RULES) fail('rules', `accepts at most ${MAX_LOCAL_SDK_RULES} rules.`);
  const rules: LocalComponentRule[] = [];
  for (let index = 0; index < value.length; index += 1) {
    rules.push(readRule(value[index], `rules[${index}]`));
  }
  return Object.freeze(rules);
}

function readSlotRelations(value: unknown): readonly LocalComponentSlotRelation[] {
  if (!Array.isArray(value)) fail('slotRelations', 'must be an array.');
  if (value.length > MAX_LOCAL_SDK_BINDINGS) fail('slotRelations', `accepts at most ${MAX_LOCAL_SDK_BINDINGS} relations.`);
  const relations: LocalComponentSlotRelation[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    const lead = `slotRelations[${index}]`;
    if (!isPlainRecord(raw)) fail(lead, 'must be an object.');
    checkKeys(raw, new Set(['lower', 'upper']), lead);
    relations.push(Object.freeze({
      lower: readIdentifier(raw.lower, `${lead}.lower`),
      upper: readIdentifier(raw.upper, `${lead}.upper`),
    }));
  }
  return Object.freeze(relations);
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
    default?: string | number | boolean | null;
    nullable?: boolean;
    enum?: readonly string[];
    pattern?: string;
    min?: number;
    max?: number;
    integer?: boolean;
    positive?: boolean;
    color?: boolean;
    coerce?: 'text';
    description?: LocalComponentText;
  } = { kind: typedKind };
  for (const flag of ['required', 'static', 'dynamic', 'integer', 'positive', 'color', 'nullable'] as const) {
    if (value[flag] === undefined) continue;
    out[flag] = readBoolean(value[flag], `${path}.${flag}`);
  }
  if (out.static === true && out.dynamic === true) {
    fail(path, 'cannot be both static and dynamic.');
  }
  if (value.coerce !== undefined) {
    if (value.coerce !== 'text') fail(`${path}.coerce`, 'must be "text".');
    if (typedKind !== 'string') fail(`${path}.coerce`, 'is only valid for kind "string".');
    out.coerce = 'text';
  }
  const rawEnum = value.enum !== undefined ? value.enum : value.values;
  const hasEnum = rawEnum !== undefined;
  if (typedKind !== 'enum') {
    if (hasEnum) fail(path, `"enum" is only valid for kind "enum", not "${typedKind}".`);
  } else {
    if (value.enum !== undefined && value.values !== undefined) {
      fail(path, 'use "enum" or "values", not both.');
    }
    if (!Array.isArray(rawEnum) || rawEnum.length === 0) {
      fail(`${path}.enum`, 'must be a non-empty string array.');
    }
    if (rawEnum.length > MAX_LOCAL_SDK_ENUM_VALUES) {
      fail(`${path}.enum`, `accepts at most ${MAX_LOCAL_SDK_ENUM_VALUES} values.`);
    }
    const seen = new Set<string>();
    const values: string[] = [];
    for (const item of rawEnum) {
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
    if (out.positive === true) fail(path, '"positive" is only valid for kind "number".');
  } else {
    if (hasMin) out.min = readFiniteNumber(value.min, `${path}.min`);
    if (hasMax) out.max = readFiniteNumber(value.max, `${path}.max`);
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
      fail(path, '"min" cannot exceed "max".');
    }
  }
  if (out.color === true && typedKind !== 'string') {
    fail(path, '"color" is only valid for kind "string".');
  }
  if (value.description !== undefined) {
    out.description = readTextMap(value.description, `${path}.description`);
  }
  const hasDefault = value.default !== undefined;
  if (hasDefault) {
    const fallback = value.default;
    if (fallback === null) {
      if (out.nullable !== true) fail(`${path}.default`, 'is null but the prop is not nullable.');
      out.default = null;
    } else if (typedKind === 'string') {
      out.default = readString(fallback, `${path}.default`);
    } else if (typedKind === 'number') {
      const numeric = readFiniteNumber(fallback, `${path}.default`);
      if (out.integer === true && !Number.isInteger(numeric)) {
        fail(`${path}.default`, 'must be an integer.');
      }
      if (out.positive === true && !(numeric > 0)) {
        fail(`${path}.default`, 'must be greater than zero.');
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
    if (out.pattern !== undefined && typedKind === 'string' && typeof out.default === 'string') {
      let accepted = true;
      try {
        accepted = new RegExp(out.pattern).test(out.default);
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
  kind: LocalComponentBindingKind,
  path: string,
): LocalComponentBindingConstraints {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, CONSTRAINT_KEYS, path);
  const out: {
    min?: LocalComponentBindingConstraint;
    max?: LocalComponentBindingConstraint;
    step?: LocalComponentBindingConstraint;
  } = {};
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
  if (kind !== 'number' && (out.min || out.max || out.step)) {
    fail(path, '"min", "max" and "step" are only valid for number bindings.');
  }
  if (out.min && 'literal' in out.min && out.max && 'literal' in out.max && out.min.literal > out.max.literal) {
    fail(path, '"min" cannot exceed "max".');
  }
  return out;
}

/** The initial rules a binding kind/family may declare. */
function initialRulesFor(kind: LocalComponentBindingKind, family: LocalBindingFamily): ReadonlySet<string> {
  if (kind === 'number') {
    return family === 'timer'
      ? new Set(['duration', 'min', 'nearest-zero'])
      : new Set(['min', 'nearest-zero', 'max-step']);
  }
  if (kind === 'boolean') return new Set(['false']);
  if (kind === 'null') return new Set(['empty']);
  if (kind === 'array') {
    if (family === 'checklist') return new Set(['checked', 'empty-array']);
    return new Set(['empty-array']);
  }
  if (kind === 'number-array') return new Set(['empty-array']);
  switch (family) {
    case 'choice':
    case 'selection':
      return new Set(['first-option', 'none']);
    case 'tabs': return new Set(['first-tab']);
    case 'steps': return new Set(['first-step']);
    case 'diagram': return new Set(['first-node']);
    case 'date': return new Set(['empty']);
    default: return new Set(['empty']);
  }
}

function readBinding(
  value: unknown,
  props: Readonly<Record<string, LocalComponentProp>>,
  path: string,
  structuralOptions = false,
): LocalComponentBinding {
  if (!isPlainRecord(value)) fail(path, 'must be an object.');
  checkKeys(value, BINDING_KEYS, path);
  const kind = value.kind;
  if (typeof kind !== 'string' || !BINDING_KINDS.has(kind)) {
    fail(`${path}.kind`, 'must be "string", "number", "boolean", "array", "number-array" or "null".');
  }
  const typedKind = kind as LocalComponentBindingKind;
  const family = value.family;
  if (typeof family !== 'string' || !FAMILIES.has(family)) {
    fail(`${path}.family`, 'must be a supported binding family.');
  }
  const typedFamily = family as LocalBindingFamily;
  const allowedFamilies: Readonly<Record<string, ReadonlySet<string>>> = {
    number: new Set(['number', 'timer']),
    boolean: new Set(['boolean']),
    string: new Set(['text', 'choice', 'date', 'tabs', 'diagram', 'steps', 'selection']),
    array: new Set(['multi-select', 'checklist', 'collection']),
    'number-array': new Set(['collection']),
    null: new Set(['text']),
  };
  if (!allowedFamilies[typedKind]?.has(typedFamily)) {
    fail(`${path}.family`, `"${typedFamily}" is not supported for a ${typedKind} binding.`);
  }
  let options: readonly string[] | undefined;
  if (value.options !== undefined) {
    if (typedKind !== 'string') fail(`${path}.options`, 'is only valid for a string binding.');
    if (typedFamily !== 'choice') fail(`${path}.options`, 'requires family "choice".');
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
  if (typedKind === 'string' && typedFamily === 'choice' && options === undefined && !structuralOptions) {
    fail(`${path}.options`, 'is required for a choice binding.');
  }
  if (typedFamily !== 'choice' && options !== undefined) {
    fail(`${path}.options`, 'is only valid for family "choice".');
  }
  const bind = readIdentifier(value.bind, `${path}.bind`);
  const initial = readIdentifier(value.initial, `${path}.initial`);
  if (bind === initial) fail(path, '"bind" and "initial" must name different attributes.');
  if (RESERVED_SLOT_NAMES.has(bind) || RESERVED_SLOT_NAMES.has(initial)) {
    fail(path, 'binding attributes cannot use a reserved slot name.');
  }
  if (Object.hasOwn(props, bind) || Object.hasOwn(props, initial)) {
    fail(path, 'binding attributes are reserved and cannot be declared as props.');
  }
  const allowedRules = initialRulesFor(typedKind, typedFamily);
  let initialRule: LocalComponentInitialRule;
  if (value.initialRule === undefined) {
    switch (typedKind) {
      case 'number': initialRule = typedFamily === 'timer' ? 'duration' : 'nearest-zero'; break;
      case 'boolean': initialRule = 'false'; break;
      case 'array': initialRule = typedFamily === 'checklist' ? 'checked' : 'empty-array'; break;
      case 'number-array': initialRule = 'empty-array'; break;
      case 'null': initialRule = 'empty'; break;
      default:
        initialRule = typedFamily === 'choice' ? 'first-option'
          : typedFamily === 'tabs' ? 'first-tab'
            : typedFamily === 'steps' ? 'first-step'
              : typedFamily === 'diagram' ? 'first-node'
                : typedFamily === 'selection' ? 'none'
                  : 'empty';
    }
  } else {
    if (typeof value.initialRule !== 'string' || !INITIAL_RULES.has(value.initialRule)) {
      fail(`${path}.initialRule`, 'is not a supported initial rule.');
    }
    initialRule = value.initialRule as LocalComponentInitialRule;
  }
  if (!allowedRules.has(initialRule)) {
    fail(`${path}.initialRule`, `is not supported for a ${typedKind} ${typedFamily} binding.`);
  }
  if (value.required !== undefined) readBoolean(value.required, `${path}.required`);
  if (value.exclusive !== undefined) readBoolean(value.exclusive, `${path}.exclusive`);
  if (value.retain !== undefined) readBoolean(value.retain, `${path}.retain`);
  let constraints: LocalComponentBindingConstraints | undefined;
  if (value.constraints !== undefined) {
    constraints = readConstraints(value.constraints, props, typedKind, `${path}.constraints`);
  }
  let maxItems: LocalComponentBindingConstraint | undefined;
  if (value.maxItems !== undefined) {
    if (typedKind !== 'array' && typedKind !== 'number-array') {
      fail(`${path}.maxItems`, 'is only valid for array or number-array bindings.');
    }
    maxItems = readConstraint(value.maxItems, `${path}.maxItems`);
    if ('prop' in maxItems) {
      const prop = props[maxItems.prop];
      if (prop === undefined) fail(`${path}.maxItems`, `references undeclared prop "${maxItems.prop}".`);
      if (prop.kind !== 'number') fail(`${path}.maxItems`, `references prop "${maxItems.prop}", which is not a number.`);
      if (prop.dynamic === true) fail(`${path}.maxItems`, 'requires a static numeric property.');
    } else if (!Number.isInteger(maxItems.literal) || maxItems.literal < 0) {
      fail(`${path}.maxItems`, 'must be a nonnegative integer.');
    }
  }
  let requiresAttributes: readonly string[] | undefined;
  if (value.requiresAttributes !== undefined) {
    requiresAttributes = readNameList(value.requiresAttributes, `${path}.requiresAttributes`);
    for (const name of requiresAttributes) {
      if (!Object.hasOwn(props, name)) fail(`${path}.requiresAttributes`, `references undeclared prop "${name}".`);
    }
  }
  let compare: readonly string[] | undefined;
  if (value.compare !== undefined) {
    compare = readNameList(value.compare, `${path}.compare`);
    for (const name of compare) {
      if (!Object.hasOwn(props, name)) fail(`${path}.compare`, `references undeclared prop "${name}".`);
    }
  }
  return Object.freeze({
    kind: typedKind,
    family: typedFamily,
    bind,
    initial,
    initialRule,
    ...(value.required === true ? { required: true } : {}),
    ...(value.exclusive === true ? { exclusive: true } : {}),
    ...(options ? { options } : {}),
    ...(constraints ? { constraints: Object.freeze(constraints) } : {}),
    ...(maxItems ? { maxItems } : {}),
    ...(requiresAttributes ? { requiresAttributes } : {}),
    ...(compare ? { compare } : {}),
    ...(value.retain === false ? { retain: false } : {}),
  });
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
    if (bindingKeys.length === 0) fail('bindings', 'must declare at least one binding slot.');
    if (bindingKeys.length > MAX_LOCAL_SDK_BINDINGS) {
      fail('bindings', `accepts at most ${MAX_LOCAL_SDK_BINDINGS} slots.`);
    }
    const slots: Record<string, LocalComponentBinding> = {};
    const attributes = new Set<string>();
    for (const key of bindingKeys) {
      if (DANGEROUS_KEYS.has(key)) fail('bindings', `field "${key}" is not allowed.`);
      if (!SLOT_NAME.test(key)) fail('bindings', `slot "${key}" must be a letter followed by letters or digits.`);
      if (RESERVED_SLOT_NAMES.has(key)) fail('bindings', `slot "${key}" is reserved by the runtime.`);
      const binding = readBinding(value.bindings[key], props, `bindings.${key}`,
        form === 'container' && Array.isArray(value.rules) && value.rules.some(rule => isPlainRecord(rule) && rule.kind === 'options-body'));
      if (key !== 'value' && (binding.kind !== 'number' || binding.family !== 'number')) {
        fail(
          `bindings.${key}`,
          'numeric named slots support kind "number" with family "number" in this contract.',
        );
      }
      if (key !== 'value' && isPlainRecord(value.bindings[key]) && value.bindings[key].exclusive === false) {
        fail(`bindings.${key}.exclusive`, 'named slots require exclusive ownership in this contract.');
      }
      for (const attribute of [binding.bind, binding.initial]) {
        if (attributes.has(attribute)) {
          fail('bindings', `attribute "${attribute}" is claimed by more than one binding.`);
        }
        attributes.add(attribute);
      }
      slots[key] = key === 'value' ? binding : Object.freeze({ ...binding, exclusive: true });
    }
    bindings = Object.freeze(slots);
  }

  const children = value.children === undefined ? undefined : readChildren(value.children, form, 'children');
  if (value.children !== undefined && value.structure !== undefined) {
    fail('manifest', 'cannot declare both "children" and "structure"; use "structure".');
  }
  const structure = value.structure !== undefined
    ? readStructure(value.structure, form, 'structure')
    : localStructureFromChildren(children);
  const rules = value.rules === undefined ? undefined : readRules(value.rules);
  const slotRelations = value.slotRelations === undefined ? undefined : readSlotRelations(value.slotRelations);
  if (value.legacyHost !== undefined) readBoolean(value.legacyHost, 'legacyHost');
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
    ...(structure && !children ? { structure } : {}),
    ...(rules ? { rules } : {}),
    ...(slotRelations ? { slotRelations } : {}),
    ...(value.legacyHost === true ? { legacyHost: true } : {}),
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
    ...(prop.nullable === true ? { nullable: true } : {}),
    ...(prop.enum ? { enum: [...prop.enum] } : {}),
    ...(prop.pattern !== undefined ? { pattern: prop.pattern } : {}),
    ...(prop.min !== undefined ? { min: prop.min } : {}),
    ...(prop.max !== undefined ? { max: prop.max } : {}),
    ...(prop.integer === true ? { integer: true } : {}),
    ...(prop.positive === true ? { positive: true } : {}),
    ...(prop.color === true ? { color: true } : {}),
    ...(prop.coerce !== undefined ? { coerce: prop.coerce } : {}),
  };
}

function canonicalConstraint(constraint: LocalComponentBindingConstraint): Record<string, unknown> {
  return 'literal' in constraint ? { literal: constraint.literal } : { prop: constraint.prop };
}

function canonicalConstraints(constraints: LocalComponentBindingConstraints): Record<string, unknown> {
  return {
    ...(constraints.min ? { min: canonicalConstraint(constraints.min) } : {}),
    ...(constraints.max ? { max: canonicalConstraint(constraints.max) } : {}),
    ...(constraints.step ? { step: canonicalConstraint(constraints.step) } : {}),
  };
}

function canonicalBinding(binding: LocalComponentBinding): Record<string, unknown> {
  const constraints = binding.constraints;
  return {
    kind: binding.kind,
    family: binding.family,
    bind: binding.bind,
    initial: binding.initial,
    initialRule: binding.initialRule,
    ...(binding.required === true ? { required: true } : {}),
    ...(binding.exclusive === true ? { exclusive: true } : {}),
    ...(binding.options ? { options: [...binding.options] } : {}),
    ...(constraints ? { constraints: canonicalConstraints(constraints) } : {}),
    ...(binding.maxItems ? { maxItems: canonicalConstraint(binding.maxItems) } : {}),
    ...(binding.requiresAttributes ? { requiresAttributes: [...binding.requiresAttributes] } : {}),
    ...(binding.compare ? { compare: [...binding.compare] } : {}),
    ...(binding.retain === false ? { retain: false } : {}),
  };
}

function canonicalStructure(structure: LocalComponentStructure): Record<string, unknown> {
  return {
    rule: structure.rule,
    ...(structure.label !== undefined ? { label: structure.label } : {}),
    ...(structure.parents ? { parents: [...structure.parents] } : {}),
    ...(structure.child !== undefined ? { child: structure.child } : {}),
    ...(structure.children ? { children: [...structure.children] } : {}),
    ...(structure.min !== undefined ? { min: structure.min } : {}),
    ...(structure.max !== undefined ? { max: structure.max } : {}),
    ...(structure.inlineOnly !== undefined ? { inlineOnly: structure.inlineOnly } : {}),
    ...(structure.noComponents !== undefined ? { noComponents: structure.noComponents } : {}),
    ...(structure.valueAttribute !== undefined ? { valueAttribute: structure.valueAttribute } : {}),
    ...(structure.generatedPrefix !== undefined ? { generatedPrefix: structure.generatedPrefix } : {}),
    ...(structure.forbidSeparator !== undefined ? { forbidSeparator: structure.forbidSeparator } : {}),
    ...(structure.maxItems !== undefined ? { maxItems: structure.maxItems } : {}),
  };
}

function canonicalRule(rule: LocalComponentRule): Record<string, unknown> {
  const source = rule as unknown as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    out[key] = Array.isArray(value)
      ? value.map((item) => Array.isArray(item) ? [...item] : item)
      : value;
  }
  return out;
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
  const bindings: Record<string, unknown> = {};
  if (definition.bindings) {
    for (const name of Object.keys(definition.bindings).sort()) {
      bindings[name] = canonicalBinding(definition.bindings[name]);
    }
  }
  return {
    protocol: definition.protocol,
    id: definition.id,
    name: definition.name,
    version: definition.version,
    form: definition.form,
    props,
    ...(definition.bindings ? { bindings } : {}),
    ...(definition.children
      ? { children: { kind: definition.children.kind, ...(definition.children.required ? { required: true } : {}) } }
      : {}),
    ...(definition.structure ? { structure: canonicalStructure(definition.structure) } : {}),
    ...(definition.rules ? { rules: definition.rules.map(canonicalRule) } : {}),
    ...(definition.slotRelations ? { slotRelations: definition.slotRelations.map((relation) => ({ ...relation })) } : {}),
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
