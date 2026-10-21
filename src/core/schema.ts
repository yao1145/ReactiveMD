import type { DocumentNode, Json } from './types';

export type ComponentForm = 'inline' | 'leaf' | 'container';
export type PropValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'currency'
  | 'value'
  | 'json'
  | 'formula';
export type BindingType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
export type ChildRule = 'any' | 'none' | 'options' | 'tabs' | 'disclosures';
export type EventName = 'click' | 'submit' | 'select' | 'change';

export interface PropSchema {
  type: PropValueType;
  dynamic?: boolean;
  required?: boolean;
  values?: readonly string[];
  default?: Json;
  /** Extra shape requirement for JSON properties. */
  shape?: 'array' | 'object';
}

export interface ComponentSchema {
  name: string;
  form: ComponentForm;
  props: Record<string, PropSchema>;
  /** Where the visible label comes from. */
  label: 'none' | 'optional-directive' | 'required-directive' | 'prop';
  binding?: {
    required: boolean;
    type: BindingType;
  };
  events?: Partial<Record<EventName, boolean>>;
  /** Events that must be wired to an action. */
  requiredEvents?: readonly EventName[];
  /** Container child rule. */
  children?: ChildRule;
  /** Attributes that conflict with `bind`. */
  boundProps?: readonly string[];
}

const gap: PropSchema = { type: 'enum', values: ['sm', 'md', 'lg'], default: 'md' };
const disabled: PropSchema = { type: 'boolean', dynamic: true, default: false };
const label: PropSchema = { type: 'string', dynamic: true, required: true };
const optionalLabel: PropSchema = { type: 'string', dynamic: true };
const variant: PropSchema = {
  type: 'enum',
  values: ['primary', 'secondary', 'quiet'],
  default: 'primary',
};
const required: PropSchema = { type: 'boolean', default: false };
const jsonArray: PropSchema = { type: 'json', shape: 'array', dynamic: true };

const defaultSchemas: ComponentSchema[] = [
  {
    name: 'value',
    form: 'inline',
    label: 'none',
    children: 'none',
    props: {
      value: { type: 'value', dynamic: true, required: true },
      format: { type: 'enum', values: ['text', 'number', 'currency'], default: 'text' },
      currency: { type: 'currency' },
    },
  },
  {
    name: 'badge',
    form: 'inline',
    label: 'required-directive',
    children: 'none',
    props: {
      tone: { type: 'enum', values: ['neutral', 'success', 'warning'], default: 'neutral' },
    },
  },
  {
    name: 'card',
    form: 'container',
    label: 'optional-directive',
    children: 'any',
    props: {},
  },
  {
    name: 'stack',
    form: 'container',
    label: 'none',
    children: 'any',
    props: { gap },
  },
  {
    name: 'row',
    form: 'container',
    label: 'none',
    children: 'any',
    props: { gap },
  },
  {
    name: 'input',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'string' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      placeholder: { type: 'string' },
      commit: { type: 'enum', values: ['input', 'blur'], default: 'input' },
      disabled,
      required,
      'min-length': { type: 'number' },
      'max-length': { type: 'number' },
      pattern: { type: 'string' },
    },
  },
  {
    name: 'number',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'number' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      min: { type: 'number' },
      max: { type: 'number' },
      step: { type: 'number' },
      disabled,
      required,
    },
  },
  {
    name: 'slider',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'number' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      min: { type: 'number', required: true },
      max: { type: 'number', required: true },
      step: { type: 'number', default: 1 },
      disabled,
    },
  },
  {
    name: 'toggle',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'boolean' },
    boundProps: ['checked'],
    events: { change: true },
    props: {
      label,
      disabled,
    },
  },
  {
    name: 'select',
    form: 'container',
    label: 'prop',
    children: 'options',
    binding: { required: true, type: 'string' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      disabled,
    },
  },
  {
    name: 'option',
    form: 'leaf',
    label: 'required-directive',
    children: 'none',
    props: {
      value: { type: 'string', required: true },
    },
  },
  {
    name: 'button',
    form: 'leaf',
    label: 'required-directive',
    children: 'none',
    events: { click: true },
    requiredEvents: ['click'],
    props: {
      variant,
      disabled,
    },
  },
  {
    name: 'if',
    form: 'container',
    label: 'none',
    children: 'any',
    props: {
      when: { type: 'boolean', dynamic: true, required: true },
    },
  },

  /* ---------------------------------------------------------------- */
  /* Layout and disclosure                                            */
  /* ---------------------------------------------------------------- */
  {
    name: 'grid',
    form: 'container',
    label: 'none',
    children: 'any',
    props: {
      columns: { type: 'number', default: 2 },
      gap,
      'min-width': { type: 'number', default: 220 },
    },
  },
  {
    name: 'tabs',
    form: 'container',
    label: 'prop',
    children: 'tabs',
    binding: { required: true, type: 'string' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label: optionalLabel,
    },
  },
  {
    name: 'tab',
    form: 'container',
    label: 'prop',
    children: 'any',
    props: {
      value: { type: 'string', required: true },
      label: { type: 'string', required: true },
    },
  },
  {
    name: 'accordion',
    form: 'container',
    label: 'none',
    children: 'disclosures',
    props: {},
  },
  {
    name: 'disclosure',
    form: 'container',
    label: 'prop',
    children: 'any',
    binding: { required: false, type: 'boolean' },
    boundProps: ['open'],
    events: { change: true },
    props: {
      label,
      open: { type: 'boolean', default: false },
    },
  },

  /* ---------------------------------------------------------------- */
  /* Forms                                                            */
  /* ---------------------------------------------------------------- */
  {
    name: 'form',
    form: 'container',
    label: 'prop',
    children: 'any',
    events: { submit: true, change: true },
    requiredEvents: ['submit'],
    props: {
      label: optionalLabel,
    },
  },
  {
    name: 'submit',
    form: 'leaf',
    label: 'required-directive',
    children: 'none',
    props: {
      variant,
      disabled,
    },
  },
  {
    name: 'textarea',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'string' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      placeholder: { type: 'string' },
      rows: { type: 'number', default: 4 },
      required,
      'min-length': { type: 'number' },
      'max-length': { type: 'number' },
      pattern: { type: 'string' },
      commit: { type: 'enum', values: ['input', 'blur'], default: 'input' },
      disabled,
    },
  },
  {
    name: 'checkbox',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'boolean' },
    boundProps: ['checked'],
    events: { change: true },
    props: {
      label,
      disabled,
    },
  },
  {
    name: 'radio-group',
    form: 'container',
    label: 'prop',
    children: 'options',
    binding: { required: true, type: 'string' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      disabled,
    },
  },
  {
    name: 'choices',
    form: 'container',
    label: 'prop',
    children: 'options',
    binding: { required: true, type: 'string' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      disabled,
    },
  },
  {
    name: 'date',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'string' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      min: { type: 'string' },
      max: { type: 'string' },
      required,
      disabled,
    },
  },
  {
    name: 'checklist',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'array' },
    boundProps: ['value'],
    events: { change: true },
    props: {
      label,
      items: { ...jsonArray, required: true },
      disabled,
    },
  },

  /* ---------------------------------------------------------------- */
  /* Feedback and media                                               */
  /* ---------------------------------------------------------------- */
  {
    name: 'progress',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    props: {
      value: { type: 'number', dynamic: true, required: true },
      max: { type: 'number', default: 100 },
      label: optionalLabel,
    },
  },
  {
    name: 'alert',
    form: 'container',
    label: 'prop',
    children: 'any',
    props: {
      tone: { type: 'enum', values: ['info', 'success', 'warning', 'danger'], default: 'info' },
      label: optionalLabel,
    },
  },
  {
    name: 'tooltip',
    form: 'inline',
    label: 'required-directive',
    children: 'none',
    props: {
      text: { type: 'string', required: true },
    },
  },
  {
    name: 'image',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    props: {
      src: { type: 'string', dynamic: true, required: true },
      alt: { type: 'string', required: true },
      caption: { type: 'string', dynamic: true },
      fit: { type: 'enum', values: ['contain', 'cover'], default: 'contain' },
    },
  },
  {
    name: 'icon',
    form: 'inline',
    label: 'optional-directive',
    children: 'none',
    props: {
      name: {
        type: 'enum',
        required: true,
        values: ['check', 'info', 'warning', 'star', 'heart', 'search', 'clock', 'location', 'arrow'],
      },
      label: { type: 'string' },
    },
  },
  {
    name: 'divider',
    form: 'leaf',
    label: 'none',
    children: 'none',
    props: {},
  },
  {
    name: 'spacer',
    form: 'leaf',
    label: 'none',
    children: 'none',
    props: {
      size: { type: 'enum', values: ['sm', 'md', 'lg'], default: 'md' },
    },
  },
  {
    name: 'spinner',
    form: 'inline',
    label: 'optional-directive',
    children: 'none',
    props: { label: { type: 'string', dynamic: true, default: '加载中' } },
  },
  {
    name: 'stat',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    props: {
      label,
      value: { type: 'value', dynamic: true, required: true },
      format: { type: 'enum', values: ['text', 'number', 'currency'], default: 'text' },
      currency: { type: 'currency' },
      hint: { type: 'string', dynamic: true },
    },
  },
  {
    name: 'link-button',
    form: 'leaf',
    label: 'required-directive',
    children: 'none',
    props: {
      href: { type: 'string', dynamic: true, required: true },
      variant,
    },
  },

  /* ---------------------------------------------------------------- */
  /* Data display                                                     */
  /* ---------------------------------------------------------------- */
  {
    name: 'table',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    props: {
      data: { ...jsonArray, required: true },
      columns: jsonArray,
      label: optionalLabel,
      searchable: { type: 'boolean', default: true },
      sortable: { type: 'boolean', default: true },
      'page-size': { type: 'number', default: 5 },
    },
  },
  {
    name: 'list',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    events: { select: true },
    props: {
      items: { ...jsonArray, required: true },
      label: optionalLabel,
    },
  },
  {
    name: 'each',
    form: 'container',
    label: 'none',
    children: 'any',
    props: {
      items: { ...jsonArray, required: true },
      as: { type: 'string', default: 'item' },
      index: { type: 'string', default: 'index' },
      key: { type: 'string', required: true },
    },
  },

  /* ---------------------------------------------------------------- */
  /* Charts, diagrams and time                                        */
  /* ---------------------------------------------------------------- */
  {
    name: 'chart',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    events: { select: true },
    props: {
      data: { ...jsonArray, required: true },
      kind: { type: 'enum', values: ['bar', 'line', 'area', 'scatter', 'donut'], default: 'bar' },
      x: { type: 'string', default: 'label' },
      y: { type: 'string', default: 'value' },
      label,
      'x-label': { type: 'string' },
      'y-label': { type: 'string' },
    },
  },
  {
    name: 'plot',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    props: {
      formula: { type: 'formula', required: true },
      min: { type: 'number', dynamic: true, default: 0 },
      max: { type: 'number', dynamic: true, default: 10 },
      samples: { type: 'number', default: 60 },
      label,
      'x-label': { type: 'string' },
      'y-label': { type: 'string' },
    },
  },
  {
    name: 'diagram',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: false, type: 'string' },
    boundProps: ['value'],
    events: { select: true, change: true },
    props: {
      nodes: { ...jsonArray, required: true },
      edges: { ...jsonArray, default: [] },
      label,
    },
  },
  {
    name: 'timeline',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    props: {
      items: { ...jsonArray, required: true },
      label,
    },
  },
  {
    name: 'timer',
    form: 'leaf',
    label: 'prop',
    children: 'none',
    binding: { required: true, type: 'number' },
    boundProps: ['value'],
    props: {
      label,
      duration: { type: 'number', required: true },
    },
  },
];

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const registry = new Map<string, ComponentSchema>();
for (const schema of defaultSchemas) {
  if (schema.binding) schema.props.name = { type: 'string' };
}
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const PROP_TYPES = new Set<PropValueType>([
  'string', 'number', 'boolean', 'enum', 'currency', 'value', 'json', 'formula',
]);
const BINDING_TYPES = new Set<BindingType>(['string', 'number', 'boolean', 'array', 'object', 'null']);

function cloneSchema(schema: ComponentSchema): ComponentSchema {
  const props: Record<string, PropSchema> = {};
  for (const [name, prop] of Object.entries(schema.props ?? {})) {
    const copy: PropSchema = { ...prop };
    if (prop.values) copy.values = [...prop.values];
    props[name] = Object.freeze(copy);
  }
  const copy: ComponentSchema = {
    name: schema.name,
    form: schema.form,
    label: schema.label,
    props: Object.freeze(props) as Record<string, PropSchema>,
  };
  if (schema.binding) copy.binding = Object.freeze({ ...schema.binding });
  if (schema.events) copy.events = Object.freeze({ ...schema.events });
  if (schema.requiredEvents) copy.requiredEvents = Object.freeze([...schema.requiredEvents]);
  if (schema.children) copy.children = schema.children;
  if (schema.boundProps) copy.boundProps = Object.freeze([...schema.boundProps]);
  return Object.freeze(copy) as unknown as ComponentSchema;
}

function validateRegistration(schema: ComponentSchema): void {
  if (!schema || typeof schema !== 'object') throw new Error('Component schema must be an object.');
  if (typeof schema.name !== 'string' || !NAME_PATTERN.test(schema.name)) {
    throw new Error(`Invalid component name "${String(schema.name)}".`);
  }
  if (!['inline', 'leaf', 'container'].includes(schema.form)) {
    throw new Error(`Component "${schema.name}" has an invalid form.`);
  }
  if (!['none', 'optional-directive', 'required-directive', 'prop'].includes(schema.label)) {
    throw new Error(`Component "${schema.name}" has an invalid label mode.`);
  }
  if (schema.children && !['any', 'none', 'options', 'tabs', 'disclosures'].includes(schema.children)) {
    throw new Error(`Component "${schema.name}" has an invalid child rule.`);
  }
  if (schema.binding && !BINDING_TYPES.has(schema.binding.type)) {
    throw new Error(`Component "${schema.name}" has an invalid binding type.`);
  }
  if (schema.events) {
    for (const event of Object.keys(schema.events)) {
      if (!['click', 'submit', 'select', 'change'].includes(event)) {
        throw new Error(`Component "${schema.name}" declares an unknown event "${event}".`);
      }
    }
  }
  for (const event of schema.requiredEvents ?? []) {
    if (!['click', 'submit', 'select', 'change'].includes(event)) {
      throw new Error(`Component "${schema.name}" requires an unknown event "${event}".`);
    }
  }
  for (const [propName, prop] of Object.entries(schema.props ?? {})) {
    if (!prop || !PROP_TYPES.has(prop.type)) {
      throw new Error(`Component "${schema.name}" property "${propName}" has an invalid type.`);
    }
    if (prop.shape && !['array', 'object'].includes(prop.shape)) {
      throw new Error(`Component "${schema.name}" property "${propName}" has an invalid shape.`);
    }
    if (prop.type === 'enum' && (!prop.values || prop.values.length === 0)) {
      throw new Error(`Component "${schema.name}" enum property "${propName}" requires values.`);
    }
  }
}

for (const schema of defaultSchemas) {
  validateRegistration(schema);
  registry.set(schema.name, cloneSchema(schema));
}

export function getComponentSchema(name: string): ComponentSchema | undefined {
  return registry.get(name);
}

export function getComponentNames(): string[] {
  return [...registry.keys()];
}

/** A frozen public manifest of every registered component. */
export function getComponentManifest(): readonly ComponentSchema[] {
  return Object.freeze([...registry.values()]);
}

/**
 * Register a host-provided component schema. Documents may reference it after
 * registration. The returned function unregisters the component; documents
 * compiled before unregistration keep their schema snapshot.
 */
export function registerComponent(schema: ComponentSchema): () => void {
  validateRegistration(schema);
  if (registry.has(schema.name)) {
    throw new Error(`Component "${schema.name}" is already registered.`);
  }
  const stored = cloneSchema(schema);
  registry.set(schema.name, stored);
  return () => {
    if (registry.get(schema.name) === stored) registry.delete(schema.name);
  };
}

/** Schema snapshot used by the compiler; documents keep this record forever. */
export function snapshotComponentSchemas(): Record<string, ComponentSchema> {
  const snapshot: Record<string, ComponentSchema> = {};
  for (const [name, schema] of registry) {
    Object.defineProperty(snapshot, name, {
      value: schema,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot) as unknown as Record<string, ComponentSchema>;
}

/** Kept for compatibility; reflects the default component set only. */
export const COMPONENT_NAMES: readonly string[] = Object.freeze(defaultSchemas.map((schema) => schema.name));

export function expectedPropType(
  componentName: string,
  propName: string,
  componentSchemas: Record<string, ComponentSchema> = defaultSnapshot(),
): 'string' | 'number' | 'boolean' | 'value' | 'json' | 'array' | 'object' | null {
  const schema = componentSchemas[componentName] ?? getComponentSchema(componentName);
  if (!schema) return null;
  const prop = schema.props[propName];
  if (!prop) return null;
  switch (prop.type) {
    case 'string':
    case 'currency':
    case 'enum':
    case 'formula':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'value':
      return 'value';
    case 'json':
      if (prop.shape === 'array') return 'array';
      if (prop.shape === 'object') return 'object';
      return 'json';
  }
}

let cachedDefaultSnapshot: Record<string, ComponentSchema> | undefined;
function defaultSnapshot(): Record<string, ComponentSchema> {
  if (!cachedDefaultSnapshot) {
    const snapshot: Record<string, ComponentSchema> = {};
    for (const schema of defaultSchemas) snapshot[schema.name] = registry.get(schema.name)!;
    cachedDefaultSnapshot = snapshot;
  }
  return cachedDefaultSnapshot;
}

/** Kept for compatibility; a read-only view of the default schemas. */
export const COMPONENT_SCHEMAS: Record<string, ComponentSchema> = Object.freeze(defaultSnapshot()) as unknown as Record<string, ComponentSchema>;

export interface DynamicPropInfo {
  componentId: string;
  componentName: string;
  node: DocumentNode;
  prop: string;
  expected: 'string' | 'number' | 'boolean' | 'value' | 'json' | 'array' | 'object';
  /** each-scope names that must be provided through locals at evaluation time. */
  localNames: string[];
}

function literalString(node: DocumentNode, prop: string): string | undefined {
  const source = node.props?.[prop];
  return source && source.kind === 'literal' && typeof source.value === 'string'
    ? source.value
    : undefined;
}

/** Walk components and list every compiled dynamic property. */
export function collectDynamicProps(
  nodes: DocumentNode[],
  componentSchemas: Record<string, ComponentSchema> = defaultSnapshot(),
  localNames: string[] = [],
  out: DynamicPropInfo[] = [],
): DynamicPropInfo[] {
  for (const node of nodes) {
    if (node.type === 'component' && node.name) {
      const schema = componentSchemas[node.name] ?? getComponentSchema(node.name);
      if (schema && node.props) {
        for (const [prop, source] of Object.entries(node.props)) {
          if (source.kind !== 'expression') continue;
          const propSchema = schema.props[prop];
          if (!propSchema || !propSchema.dynamic) continue;
          const expected = expectedPropType(node.name, prop, componentSchemas);
          if (expected) {
            out.push({
              componentId: node.id,
              componentName: node.name,
              node,
              prop,
              expected,
              localNames: [...localNames],
            });
          }
        }
      }
    }
    if (node.children) {
      let childLocals = localNames;
      if (node.type === 'component' && node.name === 'each') {
        const as = literalString(node, 'as') ?? 'item';
        const index = literalString(node, 'index') ?? 'index';
        childLocals = [...localNames, as, index];
      }
      collectDynamicProps(node.children, componentSchemas, childLocals, out);
    }
  }
  return out;
}
