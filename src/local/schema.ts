import type { LocalValue, LocalValueKind } from './types';

/**
 * Static description of the `local-draft-1` component set. The compiler reads
 * attribute types and defaults from here; the renderer may use the same table
 * to know which props are dynamic and which controls own public state.
 */
export type LocalComponentForm = 'leaf' | 'inline' | 'container';

export type LocalChildRule =
  | 'none'
  | 'any'
  | 'inline'
  | 'options'
  | 'tabs'
  | 'disclosures'
  | 'cards'
  | 'diagram'
  | 'table'
  | 'plot'
  | 'content';

export type LocalPropKind = 'string' | 'number' | 'boolean' | 'enum';

export interface LocalPropSchema {
  kind: LocalPropKind;
  required?: boolean;
  /** Reject `{{ ... }}` in this property. Used for names, ids and enums. */
  static?: boolean;
  /** Accept exactly one typed interpolation in place of a literal. */
  dynamic?: boolean;
  values?: readonly string[];
  default?: LocalValue;
  integer?: boolean;
  positive?: boolean;
  min?: number;
  max?: number;
}

export type LocalBindingFamily =
  | 'text'
  | 'number'
  | 'boolean'
  | 'choice'
  | 'date'
  | 'timer'
  | 'checklist'
  | 'tabs'
  | 'diagram';

export interface LocalBindingSchema {
  kind: LocalValueKind;
  required: boolean;
  family: LocalBindingFamily;
  /** Only one component may own this binding, and its state cannot be shared. */
  exclusive?: boolean;
}

/**
 * `default` is the schema default for an ordinary property. `initialRule`
 * describes how a component produces the value of a binding when the author
 * omits `initial`.
 */
export type LocalInitialRule =
  | 'empty'
  | 'false'
  | 'min'
  | 'nearest-zero'
  | 'first-option'
  | 'first-tab'
  | 'first-node'
  | 'checked'
  | 'duration';

export interface LocalComponentSchema {
  name: string;
  form: LocalComponentForm;
  childRule: LocalChildRule;
  label: 'none' | 'required' | 'optional';
  /** Parent component names that may directly contain this structural child. */
  parent?: readonly string[];
  props: Record<string, LocalPropSchema>;
  binding?: LocalBindingSchema;
  initialRule?: LocalInitialRule;
}

/* ------------------------------------------------------------------ */
/* Shared property schemas                                             */
/* ------------------------------------------------------------------ */

const bind: LocalPropSchema = { kind: 'string', static: true };
const initialText: LocalPropSchema = { kind: 'string', static: true };
const initialNumber: LocalPropSchema = { kind: 'number', static: true };
const initialBoolean: LocalPropSchema = { kind: 'boolean', static: true };
const disabled: LocalPropSchema = { kind: 'boolean', dynamic: true, default: false };
const label: LocalPropSchema = { kind: 'string' };
const optionalLabel: LocalPropSchema = { kind: 'string' };
const optionalTitle: LocalPropSchema = { kind: 'string' };

const numberProp = (extra: Partial<LocalPropSchema> = {}): LocalPropSchema => ({
  kind: 'number',
  ...extra,
});

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

const components: LocalComponentSchema[] = [
  /* Inputs ---------------------------------------------------------- */
  {
    name: 'input',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'text' },
    initialRule: 'empty',
    props: {
      label,
      bind,
      initial: initialText,
      type: { kind: 'enum', static: true, values: ['text', 'email'], default: 'text' },
      placeholder: { kind: 'string' },
      required: { kind: 'boolean', default: false },
      'min-length': numberProp({ integer: true, min: 0, default: 0 }),
      'max-length': numberProp({ integer: true, min: 0 }),
      disabled,
    },
  },
  {
    name: 'textarea',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'text' },
    initialRule: 'empty',
    props: {
      label,
      bind,
      initial: initialText,
      placeholder: { kind: 'string' },
      rows: numberProp({ integer: true, positive: true, default: 4 }),
      required: { kind: 'boolean', default: false },
      'min-length': numberProp({ integer: true, min: 0, default: 0 }),
      'max-length': numberProp({ integer: true, min: 0 }),
      disabled,
    },
  },
  {
    name: 'number',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'number', required: false, family: 'number' },
    initialRule: 'nearest-zero',
    props: {
      label,
      bind,
      initial: initialNumber,
      min: numberProp(),
      max: numberProp(),
      step: numberProp({ positive: true, default: 1 }),
      disabled,
    },
  },
  {
    name: 'slider',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'number', required: false, family: 'number' },
    initialRule: 'min',
    props: {
      label,
      bind,
      initial: initialNumber,
      min: numberProp({ default: 0 }),
      max: numberProp({ default: 100 }),
      step: numberProp({ positive: true, default: 1 }),
      disabled,
    },
  },
  {
    name: 'toggle',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'boolean', required: false, family: 'boolean' },
    initialRule: 'false',
    props: { label, bind, initial: initialBoolean, disabled },
  },
  {
    name: 'checkbox',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'boolean', required: false, family: 'boolean' },
    initialRule: 'false',
    props: { label, bind, initial: initialBoolean, disabled },
  },
  {
    name: 'date',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'date' },
    initialRule: 'empty',
    props: {
      label,
      bind,
      initial: initialText,
      min: { kind: 'string', static: true },
      max: { kind: 'string', static: true },
      required: { kind: 'boolean', default: false },
      disabled,
    },
  },
  {
    name: 'select',
    form: 'container',
    childRule: 'options',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'choice' },
    initialRule: 'first-option',
    props: { label, bind, initial: initialText, disabled },
  },
  {
    name: 'choices',
    form: 'container',
    childRule: 'options',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'choice' },
    initialRule: 'first-option',
    props: { label, bind, initial: initialText, disabled },
  },
  {
    name: 'radio-group',
    form: 'container',
    childRule: 'options',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'choice' },
    initialRule: 'first-option',
    props: { label, bind, initial: initialText, disabled },
  },
  {
    name: 'option',
    form: 'container',
    childRule: 'inline',
    label: 'none',
    parent: ['select', 'choices', 'radio-group'],
    props: { value: { kind: 'string', static: true, required: true } },
  },

  /* Self-operating controls ---------------------------------------- */
  {
    name: 'counter',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'number', required: false, family: 'number' },
    initialRule: 'nearest-zero',
    props: {
      label,
      bind,
      initial: initialNumber,
      min: numberProp({ default: 0 }),
      max: numberProp(),
      step: numberProp({ positive: true, default: 1 }),
      disabled,
    },
  },
  {
    name: 'timer',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'number', required: false, family: 'timer', exclusive: true },
    initialRule: 'duration',
    props: {
      label,
      bind,
      duration: numberProp({ integer: true, positive: true, default: 60 }),
    },
  },
  {
    name: 'checklist',
    form: 'container',
    childRule: 'content',
    label: 'required',
    binding: { kind: 'array', required: false, family: 'checklist', exclusive: true },
    initialRule: 'checked',
    props: { label, bind, disabled },
  },
  {
    name: 'progress',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    props: {
      label,
      value: { kind: 'number', dynamic: true, required: true },
      max: numberProp({ positive: true, default: 100 }),
    },
  },

  /* Layout ---------------------------------------------------------- */
  {
    name: 'panel',
    form: 'container',
    childRule: 'any',
    label: 'none',
    props: {
      title: optionalTitle,
      reset: { kind: 'boolean', default: true },
    },
  },
  {
    name: 'card',
    form: 'container',
    childRule: 'any',
    label: 'none',
    props: { title: optionalTitle },
  },
  {
    name: 'grid',
    form: 'container',
    childRule: 'cards',
    label: 'none',
    props: {
      columns: numberProp({ integer: true, min: 1, max: 4, default: 2 }),
    },
  },
  {
    name: 'tabs',
    form: 'container',
    childRule: 'tabs',
    label: 'optional',
    binding: { kind: 'string', required: false, family: 'tabs', exclusive: true },
    initialRule: 'first-tab',
    props: {
      label: optionalLabel,
      bind,
      initial: initialText,
    },
  },
  {
    name: 'tab',
    form: 'container',
    childRule: 'any',
    label: 'required',
    parent: ['tabs'],
    props: {
      label,
      value: { kind: 'string', static: true },
    },
  },
  {
    name: 'accordion',
    form: 'container',
    childRule: 'disclosures',
    label: 'optional',
    props: { label: optionalLabel },
  },
  {
    name: 'disclosure',
    form: 'container',
    childRule: 'any',
    label: 'required',
    parent: ['accordion'],
    props: {
      label,
      open: { kind: 'boolean', default: false },
    },
  },
  {
    name: 'if',
    form: 'container',
    childRule: 'any',
    label: 'none',
    props: {
      when: { kind: 'boolean', dynamic: true, required: true },
    },
  },

  /* Feedback -------------------------------------------------------- */
  {
    name: 'alert',
    form: 'container',
    childRule: 'any',
    label: 'none',
    props: {
      title: optionalTitle,
      tone: { kind: 'enum', static: true, values: ['info', 'success', 'warning'], default: 'info' },
    },
  },
  {
    name: 'badge',
    form: 'inline',
    childRule: 'inline',
    label: 'none',
    props: {
      tone: { kind: 'enum', static: true, values: ['neutral', 'success', 'warning'], default: 'neutral' },
    },
  },
  {
    name: 'tooltip',
    form: 'inline',
    childRule: 'inline',
    label: 'none',
    props: {
      text: { kind: 'string', required: true },
    },
  },

  /* Data and visuals ------------------------------------------------ */
  {
    name: 'table',
    form: 'container',
    childRule: 'table',
    label: 'optional',
    props: {
      label: optionalLabel,
      searchable: { kind: 'boolean', default: true },
      sortable: { kind: 'boolean', default: true },
      'page-size': numberProp({ integer: true, positive: true, default: 10 }),
    },
  },
  {
    name: 'chart',
    form: 'container',
    childRule: 'table',
    label: 'none',
    props: {
      kind: {
        kind: 'enum',
        static: true,
        values: ['bar', 'line', 'area', 'scatter', 'donut'],
        default: 'bar',
      },
      title: optionalTitle,
      x: { kind: 'string', static: true },
      y: { kind: 'string', static: true },
      'x-label': { kind: 'string' },
      'y-label': { kind: 'string' },
    },
  },
  {
    name: 'plot',
    form: 'container',
    childRule: 'plot',
    label: 'optional',
    props: {
      label: optionalLabel,
      min: { kind: 'number', dynamic: true, default: -10 },
      max: { kind: 'number', dynamic: true, default: 10 },
      samples: numberProp({ integer: true, min: 2, max: 2000, static: true, default: 200 }),
      'x-label': { kind: 'string', default: 'x' },
      'y-label': { kind: 'string', default: 'y' },
    },
  },
  {
    name: 'timeline',
    form: 'container',
    childRule: 'table',
    label: 'none',
    props: {
      title: optionalTitle,
      unit: { kind: 'string', default: '分钟' },
    },
  },
  {
    name: 'diagram',
    form: 'container',
    childRule: 'diagram',
    label: 'optional',
    binding: { kind: 'string', required: false, family: 'diagram', exclusive: true },
    initialRule: 'first-node',
    props: {
      label: optionalLabel,
      bind,
      initial: initialText,
      direction: { kind: 'enum', static: true, values: ['right', 'down'], default: 'right' },
    },
  },
  {
    name: 'node',
    form: 'container',
    childRule: 'content',
    label: 'required',
    parent: ['diagram'],
    props: {
      id: { kind: 'string', static: true, required: true },
      label,
      tone: {
        kind: 'enum',
        dynamic: true,
        values: ['neutral', 'success', 'warning'],
        default: 'neutral',
      },
    },
  },
  {
    name: 'edge',
    form: 'leaf',
    childRule: 'none',
    label: 'none',
    parent: ['diagram'],
    props: {
      from: { kind: 'string', static: true, required: true },
      to: { kind: 'string', static: true, required: true },
      label: optionalLabel,
    },
  },
];

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const LOCAL_COMPONENTS: Readonly<Record<string, LocalComponentSchema>> = Object.freeze(
  Object.fromEntries(components.map((component) => [component.name, Object.freeze(component)])),
);

export const LOCAL_COMPONENT_NAMES: readonly string[] = Object.freeze(
  components.map((component) => component.name),
);

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
