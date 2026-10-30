import {
  DEFAULT_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DATA_DOCUMENT_CELLS,
  MAX_LOCAL_DATA_DOCUMENT_ROWS,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_VALIDATIONS,
} from '../local/limits';
import { defineLocalComponent } from '../sdk/manifest';
import {
  LOCAL_COMPONENT_PROTOCOL,
  type LocalComponentBinding,
  type LocalComponentCapabilities,
  type LocalComponentDefinition,
  type LocalComponentProp,
  type LocalComponentRule,
  type LocalComponentStructure,
} from '../sdk/types';
import { LOCAL_SDK_VERSION } from '../sdk/version';
import { defaultManifestAuthoring } from './default-authoring';

const VERSION = LOCAL_SDK_VERSION;

const props = {
  text: (extra: Partial<LocalComponentProp> = {}): LocalComponentProp => ({ kind: 'string', coerce: 'text', ...extra }),
  /** Strict string with no text coercion; used for expression-bearing props. */
  expressionText: (extra: Partial<LocalComponentProp> = {}): LocalComponentProp => ({ kind: 'string', ...extra }),
  dynamicText: (extra: Partial<LocalComponentProp> = {}): LocalComponentProp => ({ kind: 'string', dynamic: true, ...extra }),
  staticText: (extra: Partial<LocalComponentProp> = {}): LocalComponentProp => ({ kind: 'string', static: true, ...extra }),
  number: (extra: Partial<LocalComponentProp> = {}): LocalComponentProp => ({ kind: 'number', ...extra }),
  boolean: (extra: Partial<LocalComponentProp> = {}): LocalComponentProp => ({ kind: 'boolean', ...extra }),
  choice: (values: readonly string[], extra: Partial<LocalComponentProp> = {}): LocalComponentProp => ({
    kind: 'enum',
    enum: values,
    ...extra,
  }),
};

const label = (extra: Partial<LocalComponentProp> = {}): LocalComponentProp => props.text(extra);
const optionalLabel = (): LocalComponentProp => props.text();
const optionalTitle = (): LocalComponentProp => props.text();
const disabled = (): LocalComponentProp => props.boolean({ dynamic: true, default: false });
const color = (): LocalComponentProp => props.staticText({ color: true });

function caps(): LocalComponentCapabilities {
  return Object.freeze({ interactive: true, static: true, ssr: true, offline: true });
}

function binding(
  kind: LocalComponentBinding['kind'],
  family: LocalComponentBinding['family'],
  initialRule: LocalComponentBinding['initialRule'],
  extra: Partial<LocalComponentBinding> = {},
): LocalComponentBinding {
  return Object.freeze({
    kind,
    family,
    bind: 'bind',
    initial: 'initial',
    initialRule,
    ...extra,
  } as LocalComponentBinding);
}

function slot(
  name: string,
  initialRule: LocalComponentBinding['initialRule'],
  extra: Partial<LocalComponentBinding> = {},
): LocalComponentBinding {
  return Object.freeze({
    kind: 'number',
    family: 'number',
    bind: `bind-${name}`,
    initial: `initial-${name}`,
    initialRule,
    exclusive: true,
    ...extra,
  } as LocalComponentBinding);
}

const numericConstraints = (min: string, max: string, step = 'step') => ({
  min: { prop: min },
  max: { prop: max },
  step: { prop: step },
} as const);

function structure(value: LocalComponentStructure): LocalComponentStructure {
  return Object.freeze(value);
}

function rules(...list: LocalComponentRule[]): readonly LocalComponentRule[] {
  return Object.freeze(list.map((rule) => Object.freeze(rule)));
}

function definition(
  name: string,
  form: LocalComponentDefinition['form'],
  value: Omit<LocalComponentDefinition, 'id' | 'name' | 'version' | 'protocol' | 'form' | 'capabilities'>,
): LocalComponentDefinition {
  const authoring = defaultManifestAuthoring(name);
  return defineLocalComponent({
    id: `reactive-md/${name}`,
    name,
    version: VERSION,
    protocol: LOCAL_COMPONENT_PROTOCOL,
    form,
    capabilities: caps(),
    ...value,
    ...(authoring ? { authoring } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

const inputDef = definition('input', 'leaf', {
  props: {
    label: label(),
    type: props.choice(['text', 'email'], { static: true, default: 'text' }),
    placeholder: props.text(),
    required: props.boolean({ dynamic: true, default: false }),
    'min-length': props.number({ integer: true, min: 0, default: 0 }),
    'max-length': props.number({ integer: true, min: 0 }),
    disabled: disabled(),
  },
  bindings: { value: binding('string', 'text', 'empty') },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'text-length', min: 'min-length', max: 'max-length' },
    { kind: 'dynamic-constraints', attributes: ['required'] },
    { kind: 'value-length', min: 'min-length', max: 'max-length', email: 'type', emailType: 'email' },
    { kind: 'value-required', required: 'required' },
  ),
});

const textareaDef = definition('textarea', 'leaf', {
  props: {
    label: label(),
    placeholder: props.text(),
    rows: props.number({ integer: true, positive: true, default: 4 }),
    required: props.boolean({ dynamic: true, default: false }),
    'min-length': props.number({ integer: true, min: 0, default: 0 }),
    'max-length': props.number({ integer: true, min: 0 }),
    disabled: disabled(),
  },
  bindings: { value: binding('string', 'text', 'empty') },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'text-length', min: 'min-length', max: 'max-length' },
    { kind: 'dynamic-constraints', attributes: ['required'] },
    { kind: 'value-length', min: 'min-length', max: 'max-length' },
    { kind: 'value-required', required: 'required' },
  ),
});

const numberDef = definition('number', 'leaf', {
  props: {
    label: label(),
    min: props.number({ dynamic: true }),
    max: props.number({ dynamic: true }),
    step: props.number({ positive: true, default: 1 }),
    disabled: disabled(),
  },
  bindings: { value: binding('number', 'number', 'nearest-zero', { constraints: numericConstraints('min', 'max') }) },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'numeric-range', min: 'min', max: 'max', step: 'step' },
    { kind: 'dynamic-constraints', attributes: ['min', 'max'] },
  ),
});

const sliderDef = definition('slider', 'leaf', {
  props: {
    label: label(),
    min: props.number({ dynamic: true, default: 0 }),
    max: props.number({ dynamic: true, default: 100 }),
    step: props.number({ positive: true, default: 1 }),
    disabled: disabled(),
    color: color(),
  },
  bindings: { value: binding('number', 'number', 'min', { constraints: numericConstraints('min', 'max') }) },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'numeric-range', min: 'min', max: 'max', step: 'step' },
    { kind: 'dynamic-constraints', attributes: ['min', 'max'] },
  ),
});

const rangeSliderDef = definition('range-slider', 'leaf', {
  props: {
    label: label(),
    min: props.number({ default: 0 }),
    max: props.number({ default: 100 }),
    step: props.number({ positive: true, default: 1 }),
    disabled: disabled(),
    color: color(),
  },
  bindings: {
    start: slot('start', 'min', { constraints: numericConstraints('min', 'max') }),
    end: slot('end', 'max-step', { constraints: numericConstraints('min', 'max') }),
  },
  slotRelations: [{ lower: 'start', upper: 'end' }],
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules({ kind: 'numeric-range', min: 'min', max: 'max', step: 'step' }),
});

const coordinateDef = definition('coordinate', 'leaf', {
  props: {
    label: label(),
    'x-min': props.number({ default: -5 }),
    'x-max': props.number({ default: 5 }),
    'y-min': props.number({ default: -5 }),
    'y-max': props.number({ default: 5 }),
    step: props.number({ positive: true, default: 1 }),
    disabled: disabled(),
    color: color(),
  },
  bindings: {
    x: slot('x', 'nearest-zero', {
      constraints: { min: { prop: 'x-min' }, max: { prop: 'x-max' }, step: { prop: 'step' } },
    }),
    y: slot('y', 'nearest-zero', {
      constraints: { min: { prop: 'y-min' }, max: { prop: 'y-max' }, step: { prop: 'step' } },
    }),
  },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'numeric-range', min: 'x-min', max: 'x-max', step: 'step' },
    { kind: 'numeric-range', min: 'y-min', max: 'y-max' },
  ),
});

const toggleDef = definition('toggle', 'leaf', {
  props: { label: label(), disabled: disabled(), color: color() },
  bindings: { value: binding('boolean', 'boolean', 'false') },
  structure: structure({ rule: 'none', label: 'required' }),
});

const checkboxDef = definition('checkbox', 'leaf', {
  props: { label: label(), disabled: disabled(), color: color() },
  bindings: { value: binding('boolean', 'boolean', 'false') },
  structure: structure({ rule: 'none', label: 'required' }),
});

const dateDef = definition('date', 'leaf', {
  props: {
    label: label(),
    min: props.dynamicText(),
    max: props.dynamicText(),
    required: props.boolean({ dynamic: true, default: false }),
    disabled: disabled(),
  },
  bindings: { value: binding('string', 'date', 'empty') },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'date-bounds', min: 'min', max: 'max' },
    { kind: 'dynamic-constraints', attributes: ['min', 'max', 'required'] },
    { kind: 'value-date', min: 'min', max: 'max', required: 'required' },
  ),
});

const optionStructure = structure({
  rule: 'inline',
  label: 'none',
  inlineOnly: true,
  noComponents: true,
});

function optionsComponent(name: string, def: LocalComponentDefinition['form'] = 'container'): LocalComponentDefinition {
  return definition(name, def, {
    props: { label: label(), disabled: disabled(), color: color() },
    bindings: { value: binding('string', 'choice', 'first-option') },
    structure: structure({
      rule: 'options',
      label: 'required',
      child: 'option',
      children: ['option'],
      min: 1,
      max: MAX_LOCAL_ARRAY_LENGTH,
      valueAttribute: 'value',
    }),
    rules: rules({
      kind: 'options-body',
      child: 'option',
      valueAttribute: 'value',
      unique: true,
      max: MAX_LOCAL_ARRAY_LENGTH,
    }),
  });
}

const selectDef = optionsComponent('select');
const choicesDef = optionsComponent('choices');
const radioGroupDef = optionsComponent('radio-group');

const multiSelectDef = definition('multi-select', 'container', {
  props: {
    label: label(),
    'max-selected': props.number({ integer: true, min: 0 }),
    disabled: disabled(),
    color: color(),
  },
  bindings: {
    value: binding('array', 'multi-select', 'empty-array', {
      exclusive: true,
      maxItems: { prop: 'max-selected' },
    }),
  },
  structure: structure({
    rule: 'options',
    label: 'required',
    child: 'option',
    children: ['option'],
    min: 1,
    max: MAX_LOCAL_ARRAY_LENGTH,
    valueAttribute: 'value',
    forbidSeparator: ',',
  }),
  rules: rules(
    {
      kind: 'options-body',
      child: 'option',
      valueAttribute: 'value',
      unique: true,
      max: MAX_LOCAL_ARRAY_LENGTH,
      forbidSeparator: ',',
    },
    { kind: 'option-count', max: 'max-selected' },
  ),
});

const optionDef = definition('option', 'container', {
  props: { value: props.staticText({ required: true }) },
  structure: structure({ rule: 'inline', label: 'none', inlineOnly: true, noComponents: true }),
  rules: rules({ kind: 'inline-body', strict: true }, { kind: 'no-components' }),
});

const counterDef = definition('counter', 'leaf', {
  props: {
    label: label(),
    min: props.number({ default: 0 }),
    max: props.number(),
    step: props.number({ positive: true, default: 1 }),
    disabled: disabled(),
  },
  bindings: { value: binding('number', 'number', 'nearest-zero', { constraints: numericConstraints('min', 'max') }) },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules({ kind: 'numeric-range', min: 'min', max: 'max', step: 'step' }),
});

const timerDef = definition('timer', 'leaf', {
  props: {
    label: label(),
    duration: props.number({ integer: true, positive: true, default: 60 }),
  },
  bindings: {
    value: binding('number', 'timer', 'duration', {
      exclusive: true,
      constraints: { min: { literal: 0 }, max: { prop: 'duration' }, step: { literal: 1 } },
      retain: false,
    }),
  },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'timer-duration', attribute: 'duration', default: 60 },
    { kind: 'retain', value: false },
  ),
});

const checklistDef = definition('checklist', 'container', {
  props: { label: label(), disabled: disabled(), color: color() },
  bindings: {
    value: binding('array', 'checklist', 'checked', { exclusive: true, retain: false }),
  },
  structure: structure({ rule: 'content', label: 'required', noComponents: true }),
  rules: rules(
    { kind: 'checklist-body', itemLimit: MAX_LOCAL_ARRAY_LENGTH },
    { kind: 'retain', value: false },
  ),
});

const progressDef = definition('progress', 'leaf', {
  props: {
    label: label(),
    value: props.number({ dynamic: true, required: true }),
    max: props.number({ positive: true, default: 100 }),
    color: color(),
  },
  structure: structure({ rule: 'none', label: 'required' }),
  rules: rules(
    { kind: 'progress-bounds', value: 'value', max: 'max', defaultMax: 100 },
  ),
});

const jumpDef = definition('jump', 'inline', {
  props: {
    to: props.staticText({ required: true }),
    appearance: props.choice(['link', 'button'], { static: true, default: 'link' }),
    color: color(),
  },
  structure: structure({ rule: 'inline', label: 'none', inlineOnly: true, noComponents: true }),
  rules: rules({ kind: 'inline-body', strict: true }, { kind: 'no-components' }, { kind: 'navigation', target: 'to' }),
});

const anchorDef = definition('anchor', 'leaf', {
  props: { id: props.staticText({ required: true }) },
  structure: structure({ rule: 'none', label: 'none' }),
  rules: rules({ kind: 'anchor', id: 'id' }),
});

const textDef = definition('text', 'inline', {
  props: { color: props.staticText({ required: true, color: true }) },
  structure: structure({ rule: 'inline', label: 'none', inlineOnly: true, noComponents: true }),
  rules: rules({ kind: 'inline-body', strict: true }, { kind: 'no-components' }),
});

const sectionDef = definition('section', 'container', {
  props: { color: props.staticText({ required: true, color: true }) },
  structure: structure({ rule: 'any', label: 'none' }),
});

const quizDef = definition('quiz', 'container', {
  props: {
    type: props.choice(['choice', 'number'], { static: true, default: 'choice' }),
    label: label(),
    answer: props.staticText({ required: true }),
    explanation: props.text(),
    tolerance: props.number({ min: 0, default: 0 }),
    disabled: disabled(),
  },
  structure: structure({
    rule: 'quiz',
    label: 'required',
    child: 'option',
    children: ['option'],
    max: MAX_LOCAL_ARRAY_LENGTH,
    valueAttribute: 'value',
  }),
  rules: rules({
    kind: 'quiz-body',
    type: 'type',
    answer: 'answer',
    tolerance: 'tolerance',
    child: 'option',
    valueAttribute: 'value',
    max: MAX_LOCAL_ARRAY_LENGTH,
  }, { kind: 'nonempty', attribute: 'answer' }),
});

const panelDef = definition('panel', 'container', {
  props: { title: optionalTitle(), reset: props.boolean({ default: true }) },
  structure: structure({ rule: 'any', label: 'none' }),
  rules: rules({ kind: 'self-binding-read', mode: 'always' }),
});

const cardDef = definition('card', 'container', {
  props: { title: optionalTitle() },
  structure: structure({ rule: 'any', label: 'none' }),
});

const gridDef = definition('grid', 'container', {
  props: { columns: props.number({ integer: true, min: 1, max: 4, default: 2 }) },
  structure: structure({ rule: 'components', label: 'none', child: 'card', children: ['card'], min: 1 }),
  rules: rules({ kind: 'only-children', children: ['card'], min: 1 }),
});

const tabsDef = definition('tabs', 'container', {
  props: { label: optionalLabel() },
  bindings: { value: binding('string', 'tabs', 'first-tab', { exclusive: true }) },
  structure: structure({
    rule: 'tabs',
    label: 'optional',
    child: 'tab',
    children: ['tab'],
    min: 1,
    valueAttribute: 'value',
    generatedPrefix: 'tab-',
  }),
  rules: rules({
    kind: 'value-sequence',
    child: 'tab',
    valueAttribute: 'value',
    min: 1,
    generatedPrefix: 'tab-',
    unique: true,
  }),
});

const tabDef = definition('tab', 'container', {
  props: { label: label(), value: props.staticText() },
  structure: structure({ rule: 'any', label: 'required', parents: ['tabs'] }),
});

const stepsDef = definition('steps', 'container', {
  props: { label: optionalLabel() },
  bindings: { value: binding('string', 'steps', 'first-step', { exclusive: true }) },
  structure: structure({
    rule: 'steps',
    label: 'optional',
    child: 'step',
    children: ['step'],
    min: 1,
    valueAttribute: 'value',
    generatedPrefix: 'step-',
  }),
  rules: rules({
    kind: 'value-sequence',
    child: 'step',
    valueAttribute: 'value',
    min: 1,
    generatedPrefix: 'step-',
    unique: true,
  }),
});

const stepDef = definition('step', 'container', {
  props: { label: label(), value: props.staticText() },
  structure: structure({ rule: 'any', label: 'required', parents: ['steps'] }),
});

const accordionDef = definition('accordion', 'container', {
  props: { label: optionalLabel() },
  structure: structure({
    rule: 'components',
    label: 'optional',
    child: 'disclosure',
    children: ['disclosure'],
    min: 1,
  }),
  rules: rules({ kind: 'only-children', children: ['disclosure'], min: 1 }),
});

const disclosureDef = definition('disclosure', 'container', {
  props: { label: label(), open: props.boolean({ default: false }) },
  structure: structure({ rule: 'any', label: 'required', parents: ['accordion'] }),
});

const ifDef = definition('if', 'container', {
  props: { when: props.boolean({ dynamic: true, required: true }) },
  structure: structure({ rule: 'any', label: 'none' }),
  rules: rules({ kind: 'require-full-interpolation', attributes: ['when'] }),
});

const alertDef = definition('alert', 'container', {
  props: {
    title: optionalTitle(),
    tone: props.choice(['info', 'success', 'warning'], { dynamic: true, default: 'info' }),
  },
  structure: structure({ rule: 'any', label: 'none' }),
});

const badgeDef = definition('badge', 'inline', {
  props: {
    tone: props.choice(['neutral', 'success', 'warning'], { dynamic: true, default: 'neutral' }),
    color: color(),
  },
  structure: structure({ rule: 'inline', label: 'none', inlineOnly: true, noComponents: true }),
  rules: rules({ kind: 'inline-body', strict: true }, { kind: 'no-components' }),
});

const tooltipDef = definition('tooltip', 'inline', {
  props: { text: props.text({ required: true }) },
  structure: structure({ rule: 'inline', label: 'none', inlineOnly: true, noComponents: true }),
  rules: rules({ kind: 'inline-body', strict: true }, { kind: 'no-components' }),
});

const validationDef = definition('validation', 'leaf', {
  props: {
    when: props.boolean({ dynamic: true, required: true }),
    message: props.text({ required: true }),
    fields: props.staticText({ required: true }),
  },
  structure: structure({ rule: 'none', label: 'none' }),
  rules: rules(
    {
      kind: 'validation-rule',
      when: 'when',
      fields: 'fields',
      message: 'message',
      placement: 'prose',
      max: MAX_LOCAL_VALIDATIONS,
    },
    { kind: 'scoped-expressions', attributes: ['fields'], scope: 'validation' },
  ),
});

const dataTableDef = definition('data-table', 'container', {
  props: {
    label: props.staticText(),
    rows: props.expressionText({ required: true }),
    key: props.expressionText({ required: true }),
    'max-rows': props.number({
      integer: true,
      positive: true,
      max: MAX_LOCAL_DATA_TABLE_ROWS,
      default: DEFAULT_LOCAL_DATA_TABLE_ROWS,
    }),
  },
  structure: structure({
    rule: 'components',
    label: 'required',
    child: 'column',
    children: ['column'],
    min: 1,
    max: MAX_LOCAL_DATA_TABLE_COLUMNS,
  }),
  rules: rules(
    {
      kind: 'data-table',
      rows: 'rows',
      key: 'key',
      child: 'column',
      childValue: 'value',
      label: 'label',
      maxRows: 'max-rows',
      defaultMaxRows: DEFAULT_LOCAL_DATA_TABLE_ROWS,
      documentRows: MAX_LOCAL_DATA_DOCUMENT_ROWS,
      documentCells: MAX_LOCAL_DATA_DOCUMENT_CELLS,
      maxColumns: MAX_LOCAL_DATA_TABLE_COLUMNS,
    },
    { kind: 'require-full-interpolation', attributes: ['rows', 'key'] },
    { kind: 'scoped-expressions', attributes: ['key'], scope: 'row' },
    { kind: 'row-values', rows: 'rows', key: 'key', child: 'column', childValue: 'value' },
  ),
});

const columnDef = definition('column', 'leaf', {
  props: {
    label: props.staticText({ required: true }),
    value: props.expressionText({ required: true }),
  },
  structure: structure({ rule: 'none', label: 'none', parents: ['data-table'] }),
  rules: rules(
    { kind: 'require-full-interpolation', attributes: ['value'] },
    { kind: 'scoped-expressions', attributes: ['value'], scope: 'row' },
  ),
});

const tableDef = definition('table', 'container', {
  props: {
    label: optionalLabel(),
    searchable: props.boolean({ default: true }),
    sortable: props.boolean({ default: true }),
    'page-size': props.number({ integer: true, positive: true, default: 10 }),
    key: props.staticText(),
  },
  bindings: {
    value: binding('string', 'selection', 'none', { requiresAttributes: ['key'] }),
  },
  structure: structure({ rule: 'table', label: 'optional' }),
  rules: rules(
    { kind: 'single-table' },
    { kind: 'selection-requires', key: 'key', attributes: ['bind', 'initial'] },
    { kind: 'table-selection', key: 'key', bindings: ['bind'] },
    { kind: 'self-binding-read', mode: 'attribute', attribute: 'key' },
  ),
});

const chartDef = definition('chart', 'container', {
  props: {
    kind: props.choice(['bar', 'line', 'area', 'scatter', 'donut'], { static: true, default: 'bar' }),
    title: optionalTitle(),
    x: props.staticText(),
    y: props.staticText(),
    'x-label': props.text(),
    'y-label': props.text(),
    key: props.staticText(),
  },
  bindings: {
    value: binding('string', 'selection', 'none', { requiresAttributes: ['key'] }),
  },
  structure: structure({ rule: 'table', label: 'none' }),
  rules: rules(
    { kind: 'single-table' },
    { kind: 'chart-table', chartKind: 'kind', x: 'x', y: 'y' } as unknown as LocalComponentRule,
    { kind: 'table-selection', key: 'key', bindings: ['bind'] },
    { kind: 'selection-requires', key: 'key', attributes: ['bind', 'initial'] },
    { kind: 'self-binding-read', mode: 'attribute', attribute: 'key' },
  ),
});

const plotDef = definition('plot', 'container', {
  props: {
    label: optionalLabel(),
    min: props.number({ dynamic: true, default: -10 }),
    max: props.number({ dynamic: true, default: 10 }),
    samples: props.number({ integer: true, min: 2, max: 2000, static: true, default: 200 }),
    'x-label': props.text({ default: 'x' }),
    'y-label': props.text({ default: 'y' }),
  },
  structure: structure({ rule: 'plot', label: 'optional' }),
  rules: rules(
    { kind: 'math-body' },
    { kind: 'numeric-range', min: 'min', max: 'max', order: 'increasing' },
    { kind: 'plot-math', min: 'min', max: 'max', samples: 'samples', curves: MAX_LOCAL_PLOT_CURVES, points: MAX_LOCAL_PLOT_POINTS },
    { kind: 'inline-math-reads' },
  ),
});

const timelineDef = definition('timeline', 'container', {
  props: {
    title: optionalTitle(),
    unit: props.text({ default: 'minutes' }),
  },
  structure: structure({ rule: 'table', label: 'none' }),
  rules: rules(
    { kind: 'single-table' },
    {
      kind: 'timeline-table',
      headerSets: [
        ['Task', 'Start', 'Duration', 'Notes'],
        ['事项', '开始', '时长', '说明'],
      ],
    },
  ),
});

const diagramDef = definition('diagram', 'container', {
  props: {
    label: optionalLabel(),
    direction: props.choice(['right', 'down'], { static: true, default: 'right' }),
  },
  bindings: { value: binding('string', 'diagram', 'first-node', { exclusive: true }) },
  structure: structure({
    rule: 'diagram',
    label: 'optional',
    child: 'node',
    children: ['node', 'edge'],
    min: 1,
  }),
  rules: rules({
    kind: 'diagram-body',
    node: 'node',
    edge: 'edge',
    id: 'id',
    from: 'from',
    to: 'to',
    label: 'label',
  }, { kind: 'self-binding-read', mode: 'always' }),
});

const nodeDef = definition('node', 'container', {
  props: {
    id: props.staticText({ required: true }),
    label: label(),
    tone: props.choice(['neutral', 'success', 'warning'], { dynamic: true, default: 'neutral' }),
  },
  structure: structure({ rule: 'content', label: 'required', noComponents: true, parents: ['diagram'] }),
  rules: rules({ kind: 'no-components' }),
});

const edgeDef = definition('edge', 'leaf', {
  props: {
    from: props.staticText({ required: true }),
    to: props.staticText({ required: true }),
    label: optionalLabel(),
  },
  structure: structure({ rule: 'none', label: 'none', parents: ['diagram'] }),
});

/**
 * The 46 rendered/structural components of the default preset, in the original
 * declaration order. `computed`, `const` and `external` stay kernel grammar
 * metadata in `src/local/schema.ts`.
 */
export const DEFAULT_COMPONENT_DEFINITIONS: readonly LocalComponentDefinition[] = Object.freeze([
  inputDef,
  textareaDef,
  numberDef,
  sliderDef,
  rangeSliderDef,
  coordinateDef,
  toggleDef,
  checkboxDef,
  dateDef,
  selectDef,
  choicesDef,
  radioGroupDef,
  multiSelectDef,
  optionDef,
  counterDef,
  timerDef,
  checklistDef,
  progressDef,
  jumpDef,
  anchorDef,
  textDef,
  sectionDef,
  quizDef,
  panelDef,
  cardDef,
  gridDef,
  tabsDef,
  tabDef,
  stepsDef,
  stepDef,
  accordionDef,
  disclosureDef,
  ifDef,
  alertDef,
  badgeDef,
  tooltipDef,
  validationDef,
  dataTableDef,
  columnDef,
  tableDef,
  chartDef,
  plotDef,
  timelineDef,
  diagramDef,
  nodeDef,
  edgeDef,
]);

export const DEFAULT_COMPONENT_NAMES: readonly string[] = Object.freeze(
  DEFAULT_COMPONENT_DEFINITIONS.map((component) => component.name),
);
