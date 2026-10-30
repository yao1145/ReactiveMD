/**
 * Shared component kernel for the local compiler and runtime.
 *
 * Phase two moves every component-specific compile/state rule out of tag-name
 * branches and into bounded, serializable manifest data. This module owns that
 * vocabulary and the generic evaluators; `compiler.ts` and `runtime.ts`
 * dispatch on rule kinds and attribute names only. Language declarations
 * (`theme`, `computed`, `const`, `external`) stay kernel grammar and are the
 * only remaining name checks in the compiler.
 *
 * The types here are the agreement with the registry module. `LocalComponentSchema`
 * may expose the same fields directly, or through the derived compatibility
 * views handled by the accessors below.
 */
import type { LocalNode, LocalValue, LocalValueKind, SourceRange } from './types';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
} from './limits';

/* ------------------------------------------------------------------ */
/* Public rule vocabulary                                              */
/* ------------------------------------------------------------------ */

export type KernelComponentForm = 'leaf' | 'inline' | 'container';
export type KernelLabel = 'none' | 'required' | 'optional';
export type KernelInitialRule =
  | 'empty'
  | 'false'
  | 'nearest-zero'
  | 'min'
  | 'max-step'
  | 'first-option'
  | 'first-tab'
  | 'first-step'
  | 'first-node'
  | 'checked'
  | 'duration'
  | 'empty-array'
  | 'none';

export type KernelChildRule =
  | 'none'
  | 'any'
  | 'inline'
  | 'content'
  | 'table'
  | 'plot'
  | 'diagram'
  | 'quiz'
  | 'options'
  | 'tabs'
  | 'steps'
  | 'components';

export interface KernelPropSchema {
  kind: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  static?: boolean;
  dynamic?: boolean;
  values?: readonly string[];
  enum?: readonly string[];
  default?: LocalValue;
  integer?: boolean;
  positive?: boolean;
  min?: number;
  max?: number;
  color?: boolean;
  pattern?: string;
  /** Coerce a scalar interpolation to display text instead of requiring a string. */
  coerce?: 'text';
  /** Allow an explicit null default/prop value. */
  nullable?: boolean;
}

export type KernelBindingConstraint =
  | { readonly literal: number }
  | { readonly prop: string };

export interface KernelBindingSchema {
  kind: LocalValueKind;
  /** Family semantics stay kernel-owned; components do not add new families. */
  family: string;
  /** Attribute that names the public binding (default "bind"). */
  bind: string;
  /** Attribute that supplies an explicit initial value (default "initial"). */
  initial: string;
  initialRule: KernelInitialRule;
  options?: readonly string[];
  constraints?: {
    min?: KernelBindingConstraint;
    max?: KernelBindingConstraint;
    step?: KernelBindingConstraint;
  };
  required?: boolean;
  exclusive?: boolean;
  maxItems?: KernelBindingConstraint;
  /** Register the binding only when every listed attribute is present. */
  requiresAttributes?: readonly string[];
  /** Attributes whose literal/expression must match between shared owners. */
  compare?: readonly string[];
  /** False excludes the binding from state retention (timers, checklists). */
  retain?: boolean;
}

export interface KernelStructure {
  rule: KernelChildRule;
  label?: KernelLabel;
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
  /* Tolerant aliases accepted from the registry lowering. */
  items?: readonly string[];
  minItems?: number;
  maxItemsCount?: number;
  valuePrefix?: string;
  markdown?: 'inline' | 'block' | 'any';
  allowComponents?: boolean;
  single?: 'markdown-table' | 'formula-block';
  content?: 'markdown' | 'task-list';
}

export type KernelRule =
  /* attribute relations */
  | {
      kind: 'numeric-range';
      min?: string;
      max?: string;
      step?: string;
      order?: 'nondecreasing' | 'increasing';
      integer?: string;
      positiveInteger?: string;
    }
  | { kind: 'text-length'; min?: string; max?: string }
  | { kind: 'date-bounds'; min?: string; max?: string; required?: string }
  | { kind: 'nonempty'; attribute: string }
  | { kind: 'progress-bounds'; value: string; max: string; defaultMax: number }
  | { kind: 'timer-duration'; attribute: string; default: number }
  | { kind: 'option-count'; max?: string }
  | { kind: 'selection-requires'; key: string; attributes: readonly string[] }
  /* body / children */
  | { kind: 'inline-body'; strict?: boolean }
  | { kind: 'no-components' }
  | { kind: 'single-table'; fallbackSingle?: boolean }
  | { kind: 'math-body' }
  | {
      kind: 'options-body';
      child: string;
      valueAttribute: string;
      unique: boolean;
      max?: number;
      forbidSeparator?: string;
    }
  | {
      kind: 'value-sequence';
      child: string;
      valueAttribute: string;
      min: number;
      generatedPrefix: string;
      unique: boolean;
      duplicateCode?: string;
    }
  | {
      kind: 'only-children';
      children: readonly string[];
      min: number;
      max?: number;
      maxCode?: string;
      onlyCode?: string;
    }
  | {
      kind: 'diagram-body';
      node: string;
      edge: string;
      id: string;
      from: string;
      to: string;
      label?: string;
    }
  | {
      kind: 'quiz-body';
      type: string;
      answer: string;
      tolerance: string;
      child: string;
      valueAttribute: string;
      max?: number;
    }
  | { kind: 'checklist-body'; itemLimit: number }
  /* expression scopes */
  | { kind: 'dynamic-constraints'; attributes: readonly string[] }
  | { kind: 'require-full-interpolation'; attributes: readonly string[] }
  | { kind: 'scoped-expressions'; attributes: readonly string[]; scope: 'row' | 'validation' }
  | { kind: 'row-values'; rows: string; key: string; child: string; childValue: string }
  | {
      kind: 'validation-rule';
      when: string;
      fields: string;
      message: string;
      placement: 'container' | 'prose';
      max: number;
    }
  /* navigation */
  | { kind: 'anchor'; id: string }
  | { kind: 'navigation'; target: string }
  /* data / visuals */
  | {
      kind: 'data-table';
      rows: string;
      key: string;
      child: string;
      childValue: string;
      label: string;
      maxRows: string;
      defaultMaxRows: number;
      documentRows: number;
      documentCells: number;
      maxColumns: number;
    }
  | {
      kind: 'plot-math';
      min: string;
      max: string;
      samples: string;
      curves: number;
      points: number;
    }
  | { kind: 'chart-table'; chartKind: string; x: string; y: string }
  | { kind: 'timeline-table'; headerSets: readonly (readonly string[])[] }
  | { kind: 'table-selection'; key: string; bindings: readonly string[] }
  /* state / dependencies */
  | { kind: 'retain'; value: boolean }
  | { kind: 'self-binding-read'; mode: 'always' | 'attribute'; attribute?: string }
  | { kind: 'inline-math-reads' }
  /* runtime value rules */
  | { kind: 'value-date'; min?: string; max?: string; required?: string }
  | { kind: 'value-length'; min?: string; max?: string; email?: string; emailType?: string }
  | { kind: 'value-email'; type?: string; value?: string }
  | { kind: 'value-required'; required: string };

export interface KernelSlotRelation {
  readonly lower: string;
  readonly upper: string;
}

/** Legacy `LocalComponentSchema.slots` entry shape, kept for compatibility. */
export interface KernelLegacySlot {
  readonly name: string;
  readonly bind: string;
  readonly initial: string;
  readonly kind: LocalValueKind;
  readonly family: string;
  readonly exclusive?: boolean;
  readonly initialRule?: string;
}

/**
 * Structural view of a component schema the kernel needs. `LocalComponentSchema`
 * satisfies it directly once the registry populates `structure`, `rules`,
 * `bindings` and `slotRelations`; legacy phase-one schemas satisfy it through
 * the derived accessors below.
 */
export interface KernelComponentSchema {
  name: string;
  form: KernelComponentForm;
  props: Readonly<Record<string, KernelPropSchema>>;
  /** Compatibility view: the scalar `value` binding. */
  binding?: KernelBindingSchema;
  /** Record of scalar and named-slot bindings. */
  bindings?: Readonly<Record<string, KernelBindingSchema>>;
  /** Compatibility view of named slots. */
  slots?: readonly KernelLegacySlot[];
  structure?: KernelStructure;
  rules?: readonly KernelRule[];
  slotRelations?: readonly KernelSlotRelation[];
  /** Legacy compatibility projections. */
  childRule?: string;
  label?: KernelLabel;
  parent?: readonly string[];
  initialRule?: string;
  /** Diagnostic profile for phase-one host/config input adapters. */
  legacyHost?: boolean;
}

/* ------------------------------------------------------------------ */
/* Schema accessors                                                    */
/* ------------------------------------------------------------------ */

function normalizeBinding(
  binding: KernelBindingSchema | undefined,
  name: string,
  fallbackRule?: KernelInitialRule,
): KernelBindingSchema | undefined {
  if (!binding) return undefined;
  const legacy = binding as KernelBindingSchema & {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly family?: string;
  };
  const options = binding.options ?? [];
  const constraints = binding.constraints ?? (
    legacy.min !== undefined || legacy.max !== undefined || legacy.step !== undefined
      ? {
          ...(legacy.min !== undefined ? { min: { literal: legacy.min } } : {}),
          ...(legacy.max !== undefined ? { max: { literal: legacy.max } } : {}),
          ...(legacy.step !== undefined ? { step: { literal: legacy.step } } : {}),
        }
      : undefined
  );
  const family = binding.family
    ?? (binding.kind === 'number' ? 'number'
      : binding.kind === 'boolean' ? 'boolean'
        : binding.kind === 'array' ? 'multi-select'
          : options.length ? 'choice' : 'text');
  return {
    ...binding,
    family,
    bind: binding.bind ?? 'bind',
    initial: binding.initial ?? 'initial',
    initialRule: binding.initialRule
      ?? fallbackRule
      ?? (name === 'value'
        ? (binding.kind === 'boolean' ? 'false' : binding.kind === 'number' ? 'nearest-zero' : 'empty')
        : 'nearest-zero'),
    ...(constraints ? { constraints } : {}),
  };
}

/** The scalar `value` binding, from the record or the compatibility view. */
export function kernelValueBinding(schema: KernelComponentSchema): KernelBindingSchema | undefined {
  const fromRecord = schema.bindings?.value;
  const fallbackRule = schema.initialRule as KernelInitialRule | undefined;
  return normalizeBinding(fromRecord ?? schema.binding, 'value', fallbackRule);
}

/** Named slot bindings in declaration order, excluding `value`. */
export function kernelSlotBindings(
  schema: KernelComponentSchema,
): readonly (KernelBindingSchema & { slot: string })[] {
  if (schema.bindings) {
    const slots: (KernelBindingSchema & { slot: string })[] = [];
    for (const [name, binding] of Object.entries(schema.bindings)) {
      if (name === 'value') continue;
      const normalized = normalizeBinding(binding, name);
      if (normalized) slots.push({ ...normalized, slot: name });
    }
    return slots;
  }
  return (schema.slots ?? []).map((slot) => ({
    kind: slot.kind,
    family: slot.family,
    bind: slot.bind,
    initial: slot.initial,
    initialRule: (slot.initialRule as KernelInitialRule | undefined) ?? 'nearest-zero',
    exclusive: slot.exclusive,
    slot: slot.name,
  }));
}

/** Declared order relations between slots (e.g. range start <= end). */
export function kernelSlotRelations(schema: KernelComponentSchema): readonly KernelSlotRelation[] {
  if (schema.slotRelations) return schema.slotRelations;
  return [];
}

/** Derived structure view; legacy schemas lower through their old fields. */
export function kernelStructure(schema: KernelComponentSchema): KernelStructure {
  if (schema.structure) return schema.structure;
  const rule = (schema.childRule as KernelChildRule | undefined)
    ?? (schema.form === 'leaf' ? 'none' : schema.form === 'inline' ? 'inline' : 'any');
  return {
    rule,
    label: schema.label ?? 'none',
    ...(schema.parent ? { parents: schema.parent } : {}),
  };
}

export function kernelRules(schema: KernelComponentSchema): readonly KernelRule[] {
  return schema.rules ?? [];
}

export function kernelRule<K extends KernelRule['kind']>(
  schema: KernelComponentSchema,
  kind: K,
): Extract<KernelRule, { kind: K }> | undefined {
  for (const rule of kernelRules(schema)) {
    if (rule.kind === kind) return rule as Extract<KernelRule, { kind: K }>;
  }
  return undefined;
}

export function kernelRulesOf<K extends KernelRule['kind']>(
  schema: KernelComponentSchema,
  kind: K,
): Extract<KernelRule, { kind: K }>[] {
  return kernelRules(schema).filter((rule): rule is Extract<KernelRule, { kind: K }> => rule.kind === kind);
}

/** Phase-one manifest input adapters keep their diagnostic wording. */
export function kernelUsesLegacyDiagnostics(schema: KernelComponentSchema): boolean {
  return schema.legacyHost === true;
}

/** Definition-level fields the registry adds; all optional for compatibility. */
export interface KernelDefinitionFields {
  readonly structure?: KernelStructure;
  readonly rules?: readonly KernelRule[];
  readonly bindings?: Readonly<Record<string, KernelBindingSchema>>;
  readonly slotRelations?: readonly KernelSlotRelation[];
  readonly legacyHost?: boolean;
}

function bindingAttrProp(binding: KernelBindingSchema, attribute: string): KernelPropSchema {
  if (attribute === binding.bind) {
    return binding.options ? { kind: 'string', static: true } : { kind: 'string', static: true };
  }
  switch (binding.kind) {
    case 'number':
      return { kind: 'number', static: true };
    case 'boolean':
      return { kind: 'boolean', static: true };
    default:
      return { kind: 'string', static: true };
  }
}

/**
 * Merge the compatibility schema with definition-level phase-two fields and
 * synthesize the attributes every declared binding owns implicitly. This keeps
 * the compiler's attribute table independent of how the registry represents
 * built-in versus external manifests.
 */
export function kernelSchemaFor(
  schema: KernelComponentSchema,
  definition?: KernelDefinitionFields,
): KernelComponentSchema {
  const props: Record<string, KernelPropSchema> = { ...schema.props };
  const bindings = definition?.bindings ?? schema.bindings;
  const scalar = bindings?.value ?? schema.binding;
  const slotBindings = bindings
    ? Object.entries(bindings).filter(([name]) => name !== 'value').map(([, binding]) => binding)
    : (schema.slots ?? []).map((slot) => ({
        kind: slot.kind,
        family: slot.family,
        bind: slot.bind,
        initial: slot.initial,
        initialRule: (slot.initialRule as KernelInitialRule | undefined) ?? 'nearest-zero',
      } as KernelBindingSchema));
  for (const binding of scalar ? [scalar] : []) {
    if (!Object.hasOwn(props, binding.bind)) props[binding.bind] = bindingAttrProp(binding, binding.bind);
    if (!Object.hasOwn(props, binding.initial)) props[binding.initial] = bindingAttrProp(binding, binding.initial);
    if (!Object.hasOwn(props, 'disabled')) {
      props.disabled = { kind: 'boolean', dynamic: true, default: false };
    }
  }
  for (const binding of slotBindings) {
    if (!Object.hasOwn(props, binding.bind)) props[binding.bind] = bindingAttrProp(binding, binding.bind);
    if (!Object.hasOwn(props, binding.initial)) props[binding.initial] = bindingAttrProp(binding, binding.initial);
  }
  return {
    ...schema,
    props,
    ...(definition?.structure ?? schema.structure ? { structure: definition?.structure ?? schema.structure } : {}),
    ...(definition?.rules ?? schema.rules ? { rules: definition?.rules ?? schema.rules } : {}),
    ...(bindings ? { bindings } : {}),
    ...(definition?.slotRelations ?? schema.slotRelations
      ? { slotRelations: definition?.slotRelations ?? schema.slotRelations }
      : {}),
    ...(definition?.legacyHost === true || schema.legacyHost === true ? { legacyHost: true } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Attribute helpers                                                   */
/* ------------------------------------------------------------------ */

export interface KernelAttrState {
  raw: string;
  value?: LocalValue;
  dynamic: boolean;
  expression?: string;
  offset: number;
  expressionOffset?: number;
}

export type KernelAttrMap = Record<string, KernelAttrState>;

export interface KernelDiagnosticIssue {
  code: string;
  message: string;
  start: number;
  end?: number;
  key: string;
  params?: Readonly<Record<string, string | number | boolean | null>>;
}

function staticNumber(
  schema: KernelComponentSchema,
  attrs: KernelAttrMap,
  name: string | undefined,
): number | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'number' ? info.value : undefined;
  const fallback = schema.props[name]?.default;
  return typeof fallback === 'number' ? fallback : undefined;
}

function staticString(
  schema: KernelComponentSchema,
  attrs: KernelAttrMap,
  name: string | undefined,
): string | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'string' ? info.value : undefined;
  const fallback = schema.props[name]?.default;
  return typeof fallback === 'string' ? fallback : undefined;
}

function attrOffset(attrs: KernelAttrMap, fallback: number, name: string | undefined): number {
  if (name === undefined) return fallback;
  return attrs[name]?.offset ?? fallback;
}

/**
 * Evaluate the declarative attribute-relation rules of one component.
 * Diagnostic codes and offsets mirror the phase-one checks exactly; the rule
 * kind, not the tag name, decides which relation applies.
 */
export function kernelAttributeIssues(
  schema: KernelComponentSchema,
  attrs: KernelAttrMap,
  nodeRange: SourceRange,
): KernelDiagnosticIssue[] {
  const issues: KernelDiagnosticIssue[] = [];
  const name = schema.name;
  const component = name;
  const report = (
    code: string,
    message: string,
    start: number,
    key: string,
    params?: Readonly<Record<string, string | number | boolean | null>>,
  ): void => {
    issues.push({ code, message, start, key, ...(params ? { params } : {}) });
  };

  for (const rule of kernelRules(schema)) {
    switch (rule.kind) {
      case 'numeric-range': {
        const min = staticNumber(schema, attrs, rule.min);
        const max = staticNumber(schema, attrs, rule.max);
        if (min !== undefined && max !== undefined) {
          const bad = rule.order === 'increasing' ? !(min < max) : min > max;
          if (bad) {
            report(
              'local.constraint',
              rule.order === 'increasing'
                ? `${name} ${rule.min ?? 'min'} must be less than ${rule.max ?? 'max'}.`
                : `Component <${name}> min cannot exceed max.`,
              attrOffset(attrs, nodeRange.start, rule.min),
              rule.order === 'increasing'
                ? 'local.constraint.plot-range'
                : 'local.constraint.number-min-max',
              rule.order === 'increasing' ? undefined : { component },
            );
          }
        }
        const step = staticNumber(schema, attrs, rule.step);
        if (step !== undefined && (!(step > 0) || !Number.isFinite(step))) {
          report(
            'local.constraint',
            `Component <${name}> step must be greater than 0.`,
            attrOffset(attrs, nodeRange.start, rule.step),
            'local.constraint.number-step',
            { component },
          );
        }
        const integerName = rule.integer;
        if (integerName !== undefined) {
          const value = staticNumber(schema, attrs, integerName);
          if (value !== undefined && !Number.isInteger(value)) {
            report(
              'local.constraint',
              `Attribute ${integerName} must be a whole number.`,
              attrOffset(attrs, nodeRange.start, integerName),
              'local.constraint.integer',
              { name: integerName, component },
            );
          }
        }
        if (rule.positiveInteger !== undefined) {
          const value = staticNumber(schema, attrs, rule.positiveInteger);
          if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
            report(
              'local.constraint',
              `Attribute ${rule.positiveInteger} must be a positive whole number.`,
              attrOffset(attrs, nodeRange.start, rule.positiveInteger),
              'local.constraint.positive-integer',
              { name: rule.positiveInteger, component },
            );
          }
        }
        break;
      }
      case 'text-length': {
        const minimum = staticNumber(schema, attrs, rule.min) ?? 0;
        const maximum = staticNumber(schema, attrs, rule.max);
        if (maximum !== undefined && maximum < minimum) {
          report(
            'local.constraint',
            'max-length cannot be less than min-length.',
            attrOffset(attrs, nodeRange.start, rule.max),
            'local.constraint.length-order',
          );
        }
        break;
      }
      case 'date-bounds': {
        const min = staticString(schema, attrs, rule.min);
        const max = staticString(schema, attrs, rule.max);
        if (min !== undefined && !isKernelDate(min)) {
          report(
            'local.attribute.type',
            `Date lower bound ${min} is not a valid YYYY-MM-DD.`,
            attrOffset(attrs, nodeRange.start, rule.min),
            'local.attribute.type.date-lower',
            { value: min },
          );
        }
        if (max !== undefined && !isKernelDate(max)) {
          report(
            'local.attribute.type',
            `Date upper bound ${max} is not a valid YYYY-MM-DD.`,
            attrOffset(attrs, nodeRange.start, rule.max),
            'local.attribute.type.date-upper',
            { value: max },
          );
        }
        if (min && max && min > max) {
          report(
            'local.constraint',
            'Date min cannot be later than max.',
            attrOffset(attrs, nodeRange.start, rule.min),
            'local.constraint.date-order',
          );
        }
        break;
      }
      case 'nonempty': {
        const info = attrs[rule.attribute];
        if (!info || info.dynamic) break;
        const text = typeof info.value === 'string' ? info.value : String(info.raw ?? '');
        if (!text.trim()) {
          report(
            'local.constraint',
            `Attribute ${rule.attribute} of <${name}> cannot be empty.`,
            info.offset,
            `local.constraint.${name}-${rule.attribute}`,
            { name: rule.attribute, component },
          );
        }
        break;
      }
      case 'progress-bounds': {
        const max = staticNumber(schema, attrs, rule.max) ?? rule.defaultMax;
        const info = attrs[rule.value];
        if (info && !info.dynamic && typeof info.value === 'number') {
          if (info.value < 0 || info.value > max) {
            report(
              'local.constraint',
              `progress value must be between 0 and ${max}, got ${info.value}.`,
              info.offset,
              'local.constraint.progress-range',
              { max, value: info.value },
            );
          }
        }
        break;
      }
      case 'timer-duration': {
        const duration = staticNumber(schema, attrs, rule.attribute) ?? rule.default;
        if (!Number.isInteger(duration) || duration <= 0) {
          report(
            'local.constraint',
            'timer duration must be a positive whole number of seconds.',
            attrOffset(attrs, nodeRange.start, rule.attribute),
            'local.constraint.timer-duration',
          );
        }
        break;
      }
      case 'option-count': {
        const maximum = staticNumber(schema, attrs, rule.max);
        if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 0)) {
          report(
            'local.constraint',
            `${name} ${rule.max} must be a nonnegative whole number.`,
            attrOffset(attrs, nodeRange.start, rule.max),
            `local.constraint.${name}`,
          );
        }
        break;
      }
      case 'selection-requires': {
        if (Object.hasOwn(attrs, rule.key)) break;
        for (const attribute of rule.attributes) {
          const info = attrs[attribute];
          if (!info) continue;
          report(
            'local.selection.key',
            `<${name}> ${attribute} requires a key attribute naming the selection column.`,
            info.offset,
            'local.selection.key.required',
            { component, name: attribute },
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const DISPLAY_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A bounded YYYY-MM-DD check independent of the compiler's date helpers. */
export function isKernelDate(value: string): boolean {
  if (value === '') return true;
  const match = DISPLAY_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/* ------------------------------------------------------------------ */
/* Binding constraints and initial values                              */
/* ------------------------------------------------------------------ */

export interface KernelNumericConstraints {
  min?: number;
  max?: number;
  step: number;
  dynamicMin?: string;
  dynamicMax?: string;
}

function constraintLiteral(
  schema: KernelComponentSchema,
  attrs: KernelAttrMap,
  constraint: KernelBindingConstraint | undefined,
): number | undefined {
  if (constraint === undefined) return undefined;
  if ('literal' in constraint) return constraint.literal;
  const raw = attrs[constraint.prop];
  if (raw) {
    if (raw.dynamic) return undefined;
    return typeof raw.value === 'number' ? raw.value : undefined;
  }
  const fallback = schema.props[constraint.prop]?.default;
  return typeof fallback === 'number' ? fallback : undefined;
}

/**
 * Effective numeric constraints of a binding. Literal constraints and prop
 * references resolve from the node's own attributes/defaults; full
 * interpolations stay dynamic and are recorded separately.
 */
export function kernelNumericConstraints(
  schema: KernelComponentSchema,
  binding: KernelBindingSchema,
  attrs: KernelAttrMap,
): KernelNumericConstraints {
  const constraints = binding.constraints;
  if (!constraints) return { step: 1 };
  const min = constraintLiteral(schema, attrs, constraints.min);
  const max = constraintLiteral(schema, attrs, constraints.max);
  const step = constraintLiteral(schema, attrs, constraints.step) ?? 1;
  const dynamicOf = (constraint: KernelBindingConstraint | undefined): string | undefined => {
    if (constraint === undefined || !('prop' in constraint)) return undefined;
    const info = attrs[constraint.prop];
    return info?.dynamic ? (info.expression ?? '').trim() : undefined;
  };
  const dynamicMin = dynamicOf(constraints.min);
  const dynamicMax = dynamicOf(constraints.max);
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    step: step > 0 ? step : 1,
    ...(dynamicMin !== undefined ? { dynamicMin } : {}),
    ...(dynamicMax !== undefined ? { dynamicMax } : {}),
  };
}

/** Resolve a `maxItems` constraint to a literal cap. */
export function kernelMaxItems(
  schema: KernelComponentSchema,
  binding: KernelBindingSchema,
  attrs: KernelAttrMap,
): number | undefined {
  return constraintLiteral(schema, attrs, binding.maxItems);
}

/** Bounds are compatible only when both sides are the same literal or expression. */
export function kernelSameNumericBound(
  a: KernelNumericConstraints,
  b: KernelNumericConstraints,
  bound: 'min' | 'max',
): boolean {
  const dynamicA = bound === 'min' ? a.dynamicMin : a.dynamicMax;
  const dynamicB = bound === 'min' ? b.dynamicMin : b.dynamicMax;
  if (dynamicA !== undefined || dynamicB !== undefined) return dynamicA === dynamicB;
  return a[bound] === b[bound];
}

export function kernelDescribeConstraints(constraints: KernelNumericConstraints): string {
  const min = constraints.dynamicMin !== undefined
    ? `{{ ${constraints.dynamicMin} }}`
    : constraints.min === undefined ? '-∞' : String(constraints.min);
  const max = constraints.dynamicMax !== undefined
    ? `{{ ${constraints.dynamicMax} }}`
    : constraints.max === undefined ? '∞' : String(constraints.max);
  return `[${min}, ${max}] / ${constraints.step}`;
}

export function kernelOnStep(value: number, base: number, step: number): boolean {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) <= 1e-9 * Math.max(1, Math.abs(quotient));
}

export function kernelNearestZero(
  min: number | undefined,
  max: number | undefined,
  step: number,
): number | null {
  const base = min ?? 0;
  const lower = min === undefined ? Number.NEGATIVE_INFINITY : Math.ceil((min - base) / step);
  const upper = max === undefined ? Number.POSITIVE_INFINITY : Math.floor((max - base) / step);
  if (lower > upper) return null;
  const target = -base / step;
  let best: number | null = null;
  for (const candidate of [Math.floor(target), Math.ceil(target)]) {
    const index = Math.min(upper, Math.max(lower, candidate));
    if (!Number.isFinite(index)) continue;
    if (best === null) {
      best = index;
      continue;
    }
    const value = base + index * step;
    const current = base + best * step;
    if (Math.abs(value) < Math.abs(current) || (Math.abs(value) === Math.abs(current) && value < current)) {
      best = index;
    }
  }
  if (best === null) return null;
  const value = base + best * step;
  return min !== undefined && value < min ? null : max !== undefined && value > max ? null : value;
}

/** Derive the default initial value for any binding without tag names. */
export function kernelDefaultInitial(
  rule: KernelInitialRule,
  constraints: KernelNumericConstraints | undefined,
  options: readonly string[],
): { value: LocalValue } | { error: 'no-step' | 'cannot-derive' } {
  switch (rule) {
    case 'empty':
      return { value: '' };
    case 'false':
      return { value: false };
    case 'min':
      return { value: constraints?.min ?? 0 };
    case 'nearest-zero': {
      const local = constraints ?? { step: 1 };
      const value = kernelNearestZero(local.min, local.max, local.step);
      return value === null ? { error: 'no-step' } : { value };
    }
    case 'duration':
      return { value: constraints?.max ?? 60 };
    case 'first-option':
    case 'first-tab':
    case 'first-step':
    case 'first-node':
      return { value: options[0] ?? '' };
    case 'checked':
      return { value: [] };
    case 'empty-array':
      return { value: [] };
    case 'max-step': {
      const local = constraints ?? { step: 1 };
      const base = local.min ?? 0;
      const span = (local.max ?? base) - base;
      const index = Math.max(0, Math.floor(span / local.step + 1e-9));
      const value = base + index * local.step;
      return {
        value: Math.min(local.max ?? value, Math.max(local.min ?? value, value)),
      };
    }
    case 'none':
      return { value: '' };
    default:
      return { error: 'cannot-derive' };
  }
}

/* ------------------------------------------------------------------ */
/* Structure projections                                               */
/* ------------------------------------------------------------------ */

export type KernelProjectionKind =
  | 'options'
  | 'tabs'
  | 'steps'
  | 'selection'
  | 'diagram-nodes'
  | 'checklist';

/** Binding family -> projection kind. Family semantics are kernel-owned. */
export function kernelProjectionForFamily(family: string): KernelProjectionKind | undefined {
  switch (family) {
    case 'choice':
    case 'multi-select':
      return 'options';
    case 'tabs':
      return 'tabs';
    case 'steps':
      return 'steps';
    case 'selection':
      return 'selection';
    case 'diagram':
      return 'diagram-nodes';
    case 'checklist':
      return 'checklist';
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Runtime metadata lowering                                           */
/* ------------------------------------------------------------------ */

export type KernelValueRule =
  | { kind: 'date'; min?: string; max?: string; required?: string }
  | { kind: 'length'; min?: string; max?: string; email?: string; emailType?: string }
  | { kind: 'required'; required: string }
  | { kind: 'email'; type: string; value: string };

export interface KernelDocumentMetadata {
  readonly valueRules: Readonly<Record<string, readonly KernelValueRule[]>>;
  readonly slotRelations: readonly { nodeId: string; lower: string; upper: string }[];
  readonly retentionExclusions: readonly string[];
  /** Authored bind/initial attribute names per public binding. */
  readonly bindingAttributes?: Readonly<Record<string, { readonly bind: string; readonly initial: string }>>;
  /** Dependency-display capabilities per component node. */
  readonly dependencyRules?: Readonly<Record<string, {
    readonly selfBinding?: { readonly mode: 'always' | 'attribute'; readonly attribute?: string };
    readonly inlineMathReads?: boolean;
  }>>;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

/** Lower a component's runtime value rules; compile-time rules are ignored. */
export function kernelValueRules(schema: KernelComponentSchema): readonly KernelValueRule[] {
  const rules: KernelValueRule[] = [];
  for (const rule of kernelRules(schema)) {
    switch (rule.kind) {
      case 'value-date':
        rules.push(stripUndefined({ kind: 'date', min: rule.min, max: rule.max, required: rule.required }));
        break;
      case 'value-length':
        rules.push(stripUndefined({ kind: 'length', min: rule.min, max: rule.max }));
        if (rule.email !== undefined || rule.emailType !== undefined) {
          rules.push(stripUndefined({ kind: 'email', type: rule.email ?? 'type', value: rule.emailType ?? 'email' }));
        }
        break;
      case 'value-email':
        rules.push(stripUndefined({ kind: 'email', type: rule.type ?? 'type', value: rule.value ?? 'email' }));
        break;
      case 'value-required':
        rules.push({ kind: 'required', required: rule.required });
        break;
      default:
        break;
    }
  }
  return rules;
}

/** The serialized kernel metadata a compiled document carries. */
export function kernelDocumentMetadata(document: unknown): KernelDocumentMetadata | undefined {
  if (!document || typeof document !== 'object') return undefined;
  const value = (document as { kernel?: unknown }).kernel;
  if (!value || typeof value !== 'object') return undefined;
  return value as KernelDocumentMetadata;
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

const ANCHOR_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function isKernelAnchorId(value: string): boolean {
  return ANCHOR_ID.test(value);
}

export interface KernelNavigationTarget {
  name: string;
  target: string;
  offset: number;
}

/**
 * Check navigation targets against known anchors and heading slugs. Rules pick
 * the target attribute; the algorithm is shared by every declaring component.
 */
export function kernelNavigationIssues(
  targets: readonly KernelNavigationTarget[],
  explicit: ReadonlySet<string>,
  headings: ReadonlySet<string>,
): KernelDiagnosticIssue[] {
  const issues: KernelDiagnosticIssue[] = [];
  for (const item of targets) {
    const to = item.target;
    if (!to) {
      issues.push({
        code: 'local.jump.target',
        message: '<jump> target cannot be empty.',
        start: item.offset,
        key: 'local.jump.empty',
      });
      continue;
    }
    if (to.startsWith('#') || /\s/.test(to)) {
      issues.push({
        code: 'local.jump.target',
        message: `<${item.name}> target "${to}" must be a bare heading slug or anchor id without "#" or whitespace.`,
        start: item.offset,
        key: 'local.jump.bad-target',
        params: { target: to },
      });
      continue;
    }
    if (!explicit.has(to) && !headings.has(to)) {
      issues.push({
        code: 'local.jump.target',
        message: `<${item.name}> target "${to}" does not resolve to a heading or explicit anchor in this document.`,
        start: item.offset,
        key: 'local.jump.unresolved',
        params: { target: to },
      });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Limits re-exported for rule manifests                               */
/* ------------------------------------------------------------------ */

export const KERNEL_LIMITS = Object.freeze({
  arrayLength: MAX_LOCAL_ARRAY_LENGTH,
  dataTableColumns: MAX_LOCAL_DATA_TABLE_COLUMNS,
  plotCurves: MAX_LOCAL_PLOT_CURVES,
  plotPoints: MAX_LOCAL_PLOT_POINTS,
});

/* ------------------------------------------------------------------ */
/* Structural child helpers (shared by compiler and tests)             */
/* ------------------------------------------------------------------ */

export function kernelMeaningfulChildren(nodes: readonly LocalNode[] | undefined): LocalNode[] {
  return (nodes ?? []).filter((node) => !(
    node.type === 'comment'
    || (node.type === 'text' && !(node.value ?? '').trim())
    || (node.type === 'paragraph' && !node.children?.length && !(node.value ?? '').trim())
  ));
}

export function kernelHasComponent(node: LocalNode): boolean {
  if (node.type === 'component' || node.type === 'hostComponent') return true;
  return (node.children ?? []).some(kernelHasComponent);
}
