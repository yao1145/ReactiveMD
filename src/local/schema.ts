import type {
  KernelBindingSchema,
  KernelChildRule,
  KernelComponentSchema,
  KernelInitialRule,
  KernelLegacySlot,
  KernelPropSchema,
} from './component-kernel';
import type { LocalValue } from './types';
import { DEFAULT_COMPONENT_DEFINITIONS } from '../presets/default-components';
import { componentSchemaFromDefinition } from '../sdk/registry';

/**
 * Static description of the `local-draft-1` component set, derived from the
 * default preset manifests. The compatibility fields (`childRule`, `label`,
 * `parent`, `binding`, `slots`, `initialRule`) are projections of `structure`
 * and `bindings`; the authoritative declarations live in
 * `src/presets/default-components.ts`.
 */
export type LocalComponentForm = 'leaf' | 'inline' | 'container';
export type LocalChildRule = KernelChildRule;
export type LocalPropKind = 'string' | 'number' | 'boolean' | 'enum';
export type LocalPropSchema = KernelPropSchema;

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

export type LocalBindingSchema = KernelBindingSchema;

/**
 * One independently bound value of a multi-slot component. Each slot has its
 * own public binding name (or an internal `@node:slot` key) and is exclusive in
 * the first revision of the slot API.
 */
export type LocalBindingSlotSchema = KernelLegacySlot;

/**
 * `default` is the schema default for an ordinary property. `initialRule`
 * describes how a component produces the value of a binding when the author
 * omits `initial`.
 */
export type LocalInitialRule = KernelInitialRule;

export type LocalComponentSchema = KernelComponentSchema;

/* ------------------------------------------------------------------ */
/* Kernel grammar declarations                                         */
/* ------------------------------------------------------------------ */

/**
 * Language declarations are kernel grammar, not preset components. They keep
 * the phase-one attribute contract but own no renderer implementation.
 */
const computedSchema: LocalComponentSchema = {
  name: 'computed',
  form: 'leaf',
  childRule: 'none',
  label: 'none',
  props: {
    name: { kind: 'string', static: true, required: true },
    value: { kind: 'string', required: true },
  },
  structure: { rule: 'none', label: 'none' },
  rules: [{ kind: 'require-full-interpolation', attributes: ['value'] }],
};

const constSchema: LocalComponentSchema = {
  name: 'const',
  form: 'leaf',
  childRule: 'none',
  label: 'none',
  props: {
    name: { kind: 'string', static: true, required: true },
    value: { kind: 'string', required: true },
  },
  structure: { rule: 'none', label: 'none' },
  rules: [{ kind: 'require-full-interpolation', attributes: ['value'] }],
};

const externalSchema: LocalComponentSchema = {
  name: 'external',
  form: 'leaf',
  childRule: 'none',
  label: 'none',
  props: {
    name: { kind: 'string', static: true, required: true },
    type: {
      kind: 'enum',
      static: true,
      required: true,
      values: ['string', 'number', 'boolean', 'string-array', 'number-array'],
    },
  },
  structure: { rule: 'none', label: 'none' },
};

export const LOCAL_KERNEL_DECLARATIONS: readonly LocalComponentSchema[] = Object.freeze([
  Object.freeze(computedSchema),
  Object.freeze(constSchema),
  Object.freeze(externalSchema),
]);

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

function buildComponents(): readonly LocalComponentSchema[] {
  const projected = DEFAULT_COMPONENT_DEFINITIONS.map(componentSchemaFromDefinition);
  const validationIndex = projected.findIndex((component) => component.name === 'validation');
  const insertAt = validationIndex < 0 ? projected.length : validationIndex;
  return Object.freeze([
    ...projected.slice(0, insertAt),
    ...LOCAL_KERNEL_DECLARATIONS,
    ...projected.slice(insertAt),
  ]);
}

const components = buildComponents();

export const LOCAL_COMPONENTS: Readonly<Record<string, LocalComponentSchema>> = Object.freeze(
  Object.fromEntries(components.map((component) => [component.name, Object.freeze(component)])),
);

export const LOCAL_COMPONENT_NAMES: readonly string[] = Object.freeze(
  components.map((component) => component.name),
);

/**
 * Frozen names grouped by tag shape. The parser derives its void, paired and
 * inline tag sets from the registry, so `form` here is the single declarative
 * source for accepted tag syntax.
 */
const namesByForm: Readonly<Record<LocalComponentForm, readonly string[]>> = Object.freeze({
  leaf: Object.freeze(components.filter((component) => component.form === 'leaf').map((component) => component.name)),
  inline: Object.freeze(components.filter((component) => component.form === 'inline').map((component) => component.name)),
  container: Object.freeze(components.filter((component) => component.form === 'container').map((component) => component.name)),
});

/** Component names with the given tag shape, in declaration order. */
export function localComponentNames(form: LocalComponentForm): readonly string[] {
  return namesByForm[form];
}

export function getLocalComponent(name: string): LocalComponentSchema | undefined {
  return Object.hasOwn(LOCAL_COMPONENTS, name) ? LOCAL_COMPONENTS[name] : undefined;
}

export function getPropDefault(component: LocalComponentSchema, prop: string): LocalValue | undefined {
  return component.props[prop]?.default;
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = saved;
    }
  }
  return previous[b.length];
}

export function closestName(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

export function suggestComponent(name: string): string | undefined {
  return closestName(name, LOCAL_COMPONENT_NAMES);
}

export function suggestAttribute(component: LocalComponentSchema, name: string): string | undefined {
  return closestName(name, Object.keys(component.props));
}
