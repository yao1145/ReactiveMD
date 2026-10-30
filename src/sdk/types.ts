import type { LocalBindingFamily } from '../local/schema';
import {
  LOCAL_COMPONENT_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL,
  LOCAL_EXTENSIONS_PROTOCOL,
} from './version';
import type { LocalThemePackage } from './theme';

export * from './version';

export type LocalComponentForm = 'leaf' | 'inline' | 'container';
export type LocalComponentPropKind = 'string' | 'number' | 'boolean' | 'enum';
export type LocalComponentBindingKind = 'string' | 'number' | 'boolean';
export type LocalComponentInitialRule = 'empty' | 'false' | 'nearest-zero' | 'min' | 'first-option';

/** One declared attribute of a component manifest. */
export interface LocalComponentProp {
  readonly kind: LocalComponentPropKind;
  readonly required?: boolean;
  /** Reject `{{ ... }}` in this attribute. */
  readonly static?: boolean;
  /** Accept exactly one typed interpolation in place of a literal. */
  readonly dynamic?: boolean;
  /** Value used only when the author omits the attribute. */
  readonly default?: string | number | boolean;
  /** Allowed literals for `kind: 'enum'`. */
  readonly enum?: readonly string[];
  /** Linear-time-safe RegExp source applied to string literals. */
  readonly pattern?: string;
  /** `number` only: inclusive lower bound. */
  readonly min?: number;
  /** `number` only: inclusive upper bound. */
  readonly max?: number;
  /** `number` only: require an integer value. */
  readonly integer?: boolean;
  /** Optional locale-keyed help text; excluded from the semantic digest. */
  readonly description?: LocalComponentText;
}

/** A constraint that is either a fixed literal or a reference to a numeric prop. */
export type LocalComponentBindingConstraint =
  | { readonly literal: number }
  | { readonly prop: string };

export interface LocalComponentBindingConstraints {
  readonly min?: LocalComponentBindingConstraint;
  readonly max?: LocalComponentBindingConstraint;
  readonly step?: LocalComponentBindingConstraint;
}

/**
 * The single scalar binding slot of the phase-one contract. `bind` and
 * `initial` are fixed attribute names; named multi-slot support arrives in a
 * later phase with the same structure.
 */
export interface LocalComponentBinding {
  readonly kind: LocalComponentBindingKind;
  readonly family: LocalBindingFamily;
  readonly bind: 'bind';
  readonly initial: 'initial';
  readonly initialRule: LocalComponentInitialRule;
  /** `string`/`choice` only: the accepted literals, in display order. */
  readonly options?: readonly string[];
  readonly constraints?: LocalComponentBindingConstraints;
}

export type LocalComponentChildrenKind = 'none' | 'inline' | 'markdown';

/** Body-content rule for a container or inline component. */
export interface LocalComponentChildren {
  readonly kind: LocalComponentChildrenKind;
  readonly required?: boolean;
}

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
  readonly bindings?: Readonly<{ readonly value: LocalComponentBinding }>;
  readonly children?: LocalComponentChildren;
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
 * manifests only; the built-in default preset is always implied in phase one.
 * `key` is a deterministic semantic digest and is never trusted on input.
 */
export interface LocalConfig {
  readonly protocol: typeof LOCAL_CONFIG_PROTOCOL;
  readonly key: string;
  readonly presets: readonly LocalPresetReference[];
  readonly components: readonly LocalComponentDefinition[];
  readonly themes: readonly LocalThemePackage[];
}

/** Input accepted by `createLocalConfig` before validation. */
export interface LocalConfigInput {
  readonly presets?: readonly (LocalPresetReference | string)[];
  readonly components?: readonly LocalComponentDefinition[];
  readonly themes?: readonly LocalThemePackage[];
}
