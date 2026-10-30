import type { LocalValueKind } from '../local/types';
import type {
  KernelBindingConstraint,
  KernelBindingSchema,
  KernelChildRule,
  KernelInitialRule,
  KernelPropSchema,
  KernelRule,
  KernelSlotRelation,
  KernelStructure,
} from '../local/component-kernel';
import {
  LOCAL_COMPONENT_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL,
  LOCAL_EXTENSIONS_PROTOCOL,
} from './version';
import type { LocalThemePackage } from './theme';

export * from './version';

export type LocalComponentForm = 'leaf' | 'inline' | 'container';
export type LocalComponentPropKind = 'string' | 'number' | 'boolean' | 'enum';

/** Shared value kinds; bindings use the same vocabulary as runtime values. */
export type LocalComponentBindingKind = LocalValueKind;
export type LocalComponentInitialRule = KernelInitialRule;
/** Body/child rule names shared by built-in and external components. */
export type LocalChildRule = KernelChildRule;

export type LocalBindingFamily =
  | 'text'
  | 'number'
  | 'boolean'
  | 'choice'
  | 'date'
  | 'timer'
  | 'checklist'
  | 'tabs'
  | 'diagram'
  | 'multi-select'
  | 'selection'
  | 'steps'
  | 'collection';

/** One declared attribute of a component manifest. */
export interface LocalComponentProp extends Readonly<Omit<KernelPropSchema, 'enum'>> {
  readonly kind: LocalComponentPropKind;
  /** Value used only when the author omits the attribute. */
  readonly default?: string | number | boolean | null;
  /** Allow an explicit `null` default. */
  readonly nullable?: boolean;
  /** Allowed literals for `kind: 'enum'`. */
  readonly enum?: readonly string[];
  /** Optional locale-keyed help text; excluded from the semantic digest. */
  readonly description?: LocalComponentText;
}

/** A constraint that is either a fixed literal or a reference to a numeric prop. */
export type LocalComponentBindingConstraint = KernelBindingConstraint;
export type LocalComponentBindingConstraints = Readonly<NonNullable<KernelBindingSchema['constraints']>>;

/**
 * One binding slot. `bind` and `initial` are authored attribute names; named
 * slots may use different names (for example `bind-start`). Named slots use
 * number/number and exclusive ownership in this preview. `required` requires
 * an authored binding name. `value` may coexist with named slots.
 */
export type LocalComponentBinding = Readonly<KernelBindingSchema> & {
  readonly family: LocalBindingFamily;
};

/** Legacy body-content rule; lowered to an equivalent `structure` rule. */
export interface LocalComponentChildren {
  readonly kind: 'none' | 'inline' | 'markdown';
  readonly required?: boolean;
}

/** Reusable child-structure declaration for a container or inline component. */
export type LocalComponentStructure = Readonly<KernelStructure>;

/**
 * Bounded JSON primitives shared by every component and the kernel.
 * Attribute-name strings refer to authored attributes.
 */
export type LocalComponentRule = Readonly<KernelRule>;

export type LocalComponentSlotRelation = KernelSlotRelation;

export interface LocalComponentCapabilities {
  readonly interactive: boolean;
  readonly static: boolean;
  readonly ssr: boolean;
  readonly offline: boolean;
}

/** Locale keyed editor strings, e.g. `{ zh: '评分', en: 'Rating' }`. */
export type LocalComponentText = Readonly<Record<string, string>>;

export interface LocalComponentAuthoring {
  readonly title?: LocalComponentText;
  readonly description?: LocalComponentText;
  readonly category?: string;
  readonly insertText?: string;
}

export interface LocalComponentDependency {
  readonly id: string;
  /** Exact version or a supported bounded range (`^`, `~`, comparisons). */
  readonly version?: string;
}

/** Host requirements checked when a configuration is assembled. */
export interface LocalComponentRequires {
  /** Supported bounded range of the kernel SDK version. */
  readonly kernel?: string;
}

/**
 * One component manifest: bounded JSON data only. It never contains functions,
 * React objects, cycles or host resources, so it can cross a Worker boundary
 * and be attached to a compiled document's requirement list.
 */
export interface LocalComponentDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly protocol: typeof LOCAL_COMPONENT_PROTOCOL;
  readonly form: LocalComponentForm;
  readonly props: Readonly<Record<string, LocalComponentProp>>;
  /** Public binding slots keyed by slot name; phase-one used only `value`. */
  readonly bindings?: Readonly<Record<string, LocalComponentBinding>>;
  /** Legacy body rule. Accepted when `structure` is absent. */
  readonly children?: LocalComponentChildren;
  /** Public child-structure declaration. */
  readonly structure?: LocalComponentStructure;
  /** Public bounded semantic rules. */
  readonly rules?: readonly LocalComponentRule[];
  /** Order relations between named binding slots (range start <= end). */
  readonly slotRelations?: readonly LocalComponentSlotRelation[];
  /** True for phase-one host input adapters; selects legacy diagnostic wording. */
  readonly legacyHost?: boolean;
  readonly capabilities: LocalComponentCapabilities;
  readonly authoring?: LocalComponentAuthoring;
  /** Export style-resource identities collected by the host build. */
  readonly styles?: readonly string[];
  readonly requires?: LocalComponentRequires;
  readonly dependencies?: readonly LocalComponentDependency[];
}

/** One component required to reproduce a compiled document. */
export interface LocalComponentRequirement {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** Components actually used by a compiled document. */
export interface LocalExtensionRequirements {
  readonly protocol: typeof LOCAL_EXTENSIONS_PROTOCOL;
  readonly components: readonly LocalComponentRequirement[];
}

/** One preset selected for an instance-level configuration. */
export interface LocalPresetReference {
  readonly id: string;
  readonly version: string;
}

/**
 * Immutable, serializable instance configuration. `components` holds external
 * manifests only; the built-in default preset is carried in `registry`.
 * `key` is a deterministic semantic digest and is never trusted on input.
 */
export interface LocalConfig {
  readonly protocol: typeof LOCAL_CONFIG_PROTOCOL;
  readonly key: string;
  readonly presets: readonly LocalPresetReference[];
  /** External components only, preserving phase-one callers. */
  readonly components: readonly LocalComponentDefinition[];
  /** Full validated snapshot: default preset followed by external components. */
  readonly registry: readonly LocalComponentDefinition[];
  readonly themes: readonly LocalThemePackage[];
}

/** Input accepted by `createLocalConfig` before validation. */
export interface LocalConfigInput {
  readonly presets?: readonly (LocalPresetReference | string)[];
  readonly components?: readonly LocalComponentDefinition[];
  readonly themes?: readonly LocalThemePackage[];
}
