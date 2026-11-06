import type {
  KernelBindingSchema,
  KernelChildRule,
  KernelComponentSchema,
  KernelInitialRule,
  KernelLegacySlot,
  KernelPropSchema,
} from '../compilation/component-kernel';

/**
 * Theme-free component schema vocabulary.
 *
 * These declarations are the part of `schema.ts` that depends only on the
 * language kernel. The default preset projection, suggestions over installed
 * names and every manifest import stay in `schema.ts`; the single-compilation
 * entry point may import this module without loading the preset or the theme
 * registry.
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

/** Closest candidate within an edit distance of two, or `undefined`. */
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
