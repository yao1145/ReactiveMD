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
  | 'content'
  | 'steps'
  | 'quiz';

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
  /** Reject anything but a bounded named CSS color or #RGB/#RRGGBB. */
  color?: boolean;
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
  | 'diagram'
  | 'multi-select'
  | 'selection'
  | 'steps';

export interface LocalBindingSchema {
  kind: LocalValueKind;
  required: boolean;
  family: LocalBindingFamily;
  /** Only one component may own this binding, and its state cannot be shared. */
  exclusive?: boolean;
}

/**
 * One independently bound value of a multi-slot component. Each slot has its
 * own public binding name (or an internal `@node:slot` key) and is exclusive in
 * the first revision of the slot API.
 */
export interface LocalBindingSlotSchema {
  name: string;
  /** Attribute that names the public binding, e.g. `bind-start`. */
  bind: string;
  /** Attribute that provides an explicit initial value, e.g. `initial-start`. */
  initial: string;
  kind: LocalValueKind;
  family: LocalBindingFamily;
  exclusive: boolean;
  initialRule: 'min' | 'max-step' | 'nearest-zero';
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
  | 'first-step'
  | 'first-node'
  | 'checked'
  | 'duration'
  | 'empty-array'
  | 'none';

export interface LocalComponentSchema {
  name: string;
  form: LocalComponentForm;
  childRule: LocalChildRule;
  label: 'none' | 'required' | 'optional';
  /** Parent component names that may directly contain this structural child. */
  parent?: readonly string[];
  props: Record<string, LocalPropSchema>;
  binding?: LocalBindingSchema;
  /** Independent bindings owned by a leaf component (range-slider, coordinate). */
  slots?: readonly LocalBindingSlotSchema[];
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
const color = (): LocalPropSchema => ({ kind: 'string', static: true, color: true });

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
      color: color(),
    },
  },
  {
    name: 'range-slider',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    slots: [
      {
        name: 'start', bind: 'bind-start', initial: 'initial-start',
        kind: 'number', family: 'number', exclusive: true, initialRule: 'min',
      },
      {
        name: 'end', bind: 'bind-end', initial: 'initial-end',
        kind: 'number', family: 'number', exclusive: true, initialRule: 'max-step',
      },
    ],
    props: {
      label,
      'bind-start': bind,
      'bind-end': bind,
      'initial-start': initialNumber,
      'initial-end': initialNumber,
      min: numberProp({ default: 0 }),
      max: numberProp({ default: 100 }),
      step: numberProp({ positive: true, default: 1 }),
      disabled,
      color: color(),
    },
  },
  {
    name: 'coordinate',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    slots: [
      {
        name: 'x', bind: 'bind-x', initial: 'initial-x',
        kind: 'number', family: 'number', exclusive: true, initialRule: 'nearest-zero',
      },
      {
        name: 'y', bind: 'bind-y', initial: 'initial-y',
        kind: 'number', family: 'number', exclusive: true, initialRule: 'nearest-zero',
      },
    ],
    props: {
      label,
      'bind-x': bind,
      'bind-y': bind,
      'initial-x': initialNumber,
      'initial-y': initialNumber,
      'x-min': numberProp({ default: -5 }),
      'x-max': numberProp({ default: 5 }),
      'y-min': numberProp({ default: -5 }),
      'y-max': numberProp({ default: 5 }),
      step: numberProp({ positive: true, default: 1 }),
      disabled,
      color: color(),
    },
  },
  {
    name: 'toggle',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'boolean', required: false, family: 'boolean' },
    initialRule: 'false',
    props: { label, bind, initial: initialBoolean, disabled, color: color() },
  },
  {
    name: 'checkbox',
    form: 'leaf',
    childRule: 'none',
    label: 'required',
    binding: { kind: 'boolean', required: false, family: 'boolean' },
    initialRule: 'false',
    props: { label, bind, initial: initialBoolean, disabled, color: color() },
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
    props: { label, bind, initial: initialText, disabled, color: color() },
  },
  {
    name: 'choices',
    form: 'container',
    childRule: 'options',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'choice' },
    initialRule: 'first-option',
    props: { label, bind, initial: initialText, disabled, color: color() },
  },
  {
    name: 'radio-group',
    form: 'container',
    childRule: 'options',
    label: 'required',
    binding: { kind: 'string', required: false, family: 'choice' },
    initialRule: 'first-option',
    props: { label, bind, initial: initialText, disabled, color: color() },
  },
  {
    name: 'multi-select',
    form: 'container',
    childRule: 'options',
    label: 'required',
    binding: { kind: 'array', required: false, family: 'multi-select', exclusive: true },
    initialRule: 'empty-array',
    props: {
      label,
      bind,
      initial: initialText,
      'max-selected': numberProp({ integer: true, min: 0 }),
      disabled,
      color: color(),
    },
  },
  {
    name: 'option',
    form: 'container',
    childRule: 'inline',
    label: 'none',
    parent: ['select', 'choices', 'radio-group', 'multi-select', 'quiz'],
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
    props: { label, bind, disabled, color: color() },
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
      color: color(),
    },
  },

  /* Navigation, emphasis and assessment ---------------------------- */
  {
    name: 'jump',
    form: 'inline',
    childRule: 'inline',
    label: 'none',
    props: {
      to: { kind: 'string', static: true, required: true },
      appearance: { kind: 'enum', static: true, values: ['link', 'button'], default: 'link' },
      color: color(),
    },
  },
  {
    name: 'anchor',
    form: 'leaf',
    childRule: 'none',
    label: 'none',
    props: { id: { kind: 'string', static: true, required: true } },
  },
  {
    name: 'text',
    form: 'inline',
    childRule: 'inline',
    label: 'none',
    props: { color: { kind: 'string', static: true, required: true, color: true } },
  },
  {
    name: 'section',
    form: 'container',
    childRule: 'any',
    label: 'none',
    props: { color: { kind: 'string', static: true, required: true, color: true } },
  },
  {
    name: 'quiz',
    form: 'container',
    childRule: 'quiz',
    label: 'required',
    props: {
      type: { kind: 'enum', static: true, values: ['choice', 'number'], default: 'choice' },
      label,
      answer: { kind: 'string', static: true, required: true },
      explanation: { kind: 'string' },
      tolerance: numberProp({ min: 0, default: 0 }),
      disabled,
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
    name: 'steps',
    form: 'container',
    childRule: 'steps',
    label: 'optional',
    binding: { kind: 'string', required: false, family: 'steps', exclusive: true },
    initialRule: 'first-step',
    props: {
      label: optionalLabel,
      bind,
      initial: initialText,
    },
  },
  {
    name: 'step',
    form: 'container',
    childRule: 'any',
    label: 'required',
    parent: ['steps'],
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
      color: color(),
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
    binding: { kind: 'string', required: false, family: 'selection' },
    initialRule: 'none',
    props: {
      label: optionalLabel,
      searchable: { kind: 'boolean', default: true },
      sortable: { kind: 'boolean', default: true },
      'page-size': numberProp({ integer: true, positive: true, default: 10 }),
      bind,
      key: { kind: 'string', static: true },
      initial: initialText,
    },
  },
  {
    name: 'chart',
    form: 'container',
    childRule: 'table',
    label: 'none',
    binding: { kind: 'string', required: false, family: 'selection' },
    initialRule: 'none',
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
      bind,
      key: { kind: 'string', static: true },
      initial: initialText,
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
      unit: { kind: 'string', default: 'minutes' },
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
