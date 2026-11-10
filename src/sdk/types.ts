import type { LocalValueKind } from '../local/contracts/types';
import type {
  KernelBindingConstraint,
  KernelBindingSchema,
  KernelChildRule,
  KernelInitialRule,
  KernelPropSchema,
  KernelRule,
  KernelSlotRelation,
  KernelStructure,
} from '../local/compilation/component-kernel';
import {
  LOCAL_ASSEMBLY_PROTOCOL,
  LOCAL_COMPONENT_PROTOCOL,
  LOCAL_CONFIG_PROTOCOL_V2,
  LOCAL_EXTENSIONS_PROTOCOL,
  LOCAL_PRESET_PROTOCOL,
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
 * One explicit replacement declaration. The replacing manifest keeps the
 * target id and tag name; the version range identifies the base versions it
 * may replace. Assembly rejects implicit or ambiguous overrides.
 */
export interface LocalComponentReplacement {
  /** Must equal the declaring manifest's id. */
  readonly id: string;
  /** Base version range; omitted matches any base version. */
  readonly version?: string;
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
  /** Explicit replacement declaration; see `LocalComponentReplacement`. */
  readonly replaces?: LocalComponentReplacement;
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

/** One authoring override contributed by a preset package. */
export interface LocalPresetAuthoring {
  readonly componentId: string;
  readonly authoring: LocalComponentAuthoring;
}

/**
 * Versioned, plain-data preset package. Components are ordinary manifests;
 * authoring and themes are excluded from the semantic configuration key.
 */
export interface LocalPresetPackage {
  readonly protocol: typeof LOCAL_PRESET_PROTOCOL;
  readonly id: string;
  readonly version: string;
  readonly components: readonly LocalComponentDefinition[];
  readonly authoring?: readonly LocalPresetAuthoring[];
  readonly themes?: readonly LocalThemePackage[];
  readonly dependencies?: readonly LocalPresetReference[];
  readonly metadata?: {
    readonly title?: LocalComponentText;
    readonly description?: LocalComponentText;
  };
}

/**
 * Normalized, frozen, transportable assembly input. Every derived field on
 * `LocalConfig` is rebuilt from this snapshot; a receiver never trusts a
 * supplied key, registry or replacement record.
 */
export interface LocalAssemblySnapshot {
  readonly protocol: typeof LOCAL_ASSEMBLY_PROTOCOL;
  readonly presets: readonly LocalPresetPackage[];
  /** Pre-replacement explicit contributions, including replaced bases. */
  readonly components: readonly LocalComponentDefinition[];
  readonly replacementPolicy: 'allow' | 'forbid';
  /** Host-supplied themes; preset themes remain inside `presets`. */
  readonly themes: readonly LocalThemePackage[];
}

export interface LocalResolvedPreset {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export interface LocalReplacementRecord {
  readonly id: string;
  readonly name: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly fromDigest: string;
  readonly toDigest: string;
  /** Omitted for an external (explicit) contribution. */
  readonly fromPreset?: string;
  /** Omitted for an external (explicit) contribution. */
  readonly toPreset?: string;
}

export interface LocalLegacyConfigKey {
  readonly profile: string;
  readonly key: string;
}

/**
 * Immutable, serializable instance configuration. `assembly` is the input of
 * record; key, presets, components, replacements, registry and themes are
 * derived and revalidated on every read.
 */
export interface LocalConfig {
  readonly protocol: typeof LOCAL_CONFIG_PROTOCOL_V2;
  readonly assembly: LocalAssemblySnapshot;
  readonly key: string;
  readonly presets: readonly LocalResolvedPreset[];
  /** Active components that came from the explicit `components` input. */
  readonly components: readonly LocalComponentDefinition[];
  readonly replacements: readonly LocalReplacementRecord[];
  /** Full active registry in stable position order. */
  readonly registry: readonly LocalComponentDefinition[];
  readonly themes: readonly LocalThemePackage[];
  /** Supported legacy identity aliases, e.g. the v1 config key. */
  readonly legacyKeys: readonly LocalLegacyConfigKey[];
}

/** Preset inputs accepted by `createLocalConfig`. */
export type LocalPresetInput = LocalPresetPackage | string | LocalPresetReference;

/** Input accepted by `createLocalConfig` before validation. */
export interface LocalConfigInput {
  readonly presets?: readonly LocalPresetInput[];
  readonly components?: readonly LocalComponentDefinition[];
  /** Defaults to `'allow'`; only explicit `replaces` declarations apply. */
  readonly replacements?: 'allow' | 'forbid';
  readonly themes?: readonly LocalThemePackage[];
}
