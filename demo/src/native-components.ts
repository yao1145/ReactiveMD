/**
 * Catalog of `local-draft-3` native components offered by the editor toolbar.
 *
 * Templates stay as close to the documented authoring syntax as possible:
 * - `{{bind:base}}` is resolved by `renderNativeSnippet` to a fresh bind name.
 * - `{{selection}}`, `{{selection:fallback}}`, `{{caret}}` and `{{select:value}}`
 *   are intentionally left for the toolbar's `insertTemplate` handler.
 * - Leaf components never receive a closing tag; container bodies use blank
 *   lines so inserted Markdown keeps a natural block layout.
 */

import { NATIVE_COMPONENT_CATALOG_COPY } from './editor-i18n';
import { EXTENDED_NATIVE_COMPONENTS } from './extended-native-components';
import type { Language } from './i18n';

export type NativeComponentGroupId = 'input' | 'action' | 'layout' | 'data' | 'hint';

export interface NativeComponentGroup {
  id: NativeComponentGroupId;
  label: string;
}

export interface NativeComponentDefinition {
  id: string;
  label: string;
  description: string;
  group: NativeComponentGroupId;
  keywords: string[];
  inline?: boolean;
  template: string;
}

export const NATIVE_COMPONENT_GROUPS: readonly NativeComponentGroup[] = [
  { id: 'input', label: 'Input controls' },
  { id: 'action', label: 'Interactive tools' },
  { id: 'layout', label: 'Content layout' },
  { id: 'data', label: 'Data visualization' },
  { id: 'hint', label: 'Feedback' },
];

export const NATIVE_COMPONENTS: readonly NativeComponentDefinition[] = [
  ...EXTENDED_NATIVE_COMPONENTS,
  /* Input ------------------------------------------------------------- */
  {
    id: 'slider',
    label: 'Slider',
    description: 'Drag the slider to choose a number within a range.',
    group: 'input',
    keywords: ['slider', 'range', 'number', 'drag', 'value'],
    template: '<slider bind="{{bind:amount}}" label="Amount" initial="10" min="0" max="100" step="1">',
  },
  {
    id: 'number',
    label: 'Number input',
    description: 'Enter an exact number with an optional range and step.',
    group: 'input',
    keywords: ['number', 'numeric', 'input', 'step', 'quantity'],
    template: '<number bind="{{bind:quantity}}" label="Quantity" initial="1" min="0" max="100" step="1">',
  },
  {
    id: 'input',
    label: 'Single-line text',
    description: 'Enter a name, title or other single-line text.',
    group: 'input',
    keywords: ['input', 'text', 'single-line', 'field', 'name'],
    template: '<input bind="{{bind:name}}" label="Name" placeholder="Enter a name">',
  },
  {
    id: 'textarea',
    label: 'Multi-line text',
    description: 'Enter notes, descriptions or other multi-line text.',
    group: 'input',
    keywords: ['textarea', 'text area', 'multi-line', 'notes', 'description'],
    template:
      '<textarea bind="{{bind:message}}" label="Details" placeholder="Enter details" rows="4">',
  },
  {
    id: 'toggle',
    label: 'Toggle',
    description: 'Switch a boolean option on or off.',
    group: 'input',
    keywords: ['toggle', 'switch', 'boolean', 'enable', 'on'],
    template: '<toggle bind="{{bind:enabled}}" label="Enable option">',
  },
  {
    id: 'checkbox',
    label: 'Checkbox',
    description: 'Check or uncheck a boolean option.',
    group: 'input',
    keywords: ['checkbox', 'check', 'boolean', 'confirm', 'option'],
    template: '<checkbox bind="{{bind:confirmed}}" label="Confirm option">',
  },
  {
    id: 'date',
    label: 'Date picker',
    description: 'Pick a date; the value stays empty until one is chosen.',
    group: 'input',
    keywords: ['date', 'calendar', 'picker', 'day'],
    template: '<date bind="{{bind:date}}" label="Pick a date">',
  },
  {
    id: 'choices',
    label: 'Choice cards',
    description: 'Pick one option from a set of cards.',
    group: 'input',
    keywords: ['choices', 'options', 'cards', 'select', 'radio'],
    template: [
      '<choices bind="{{bind:plan}}" label="Choose a plan">',
      '<option value="basic">Basic</option>',
      '<option value="pro">Pro</option>',
      '</choices>',
    ].join('\n'),
  },

  /* Action ------------------------------------------------------------ */
  {
    id: 'counter',
    label: 'Counter',
    description: 'Adjust an integer with plus and minus buttons, then reset it in one click.',
    group: 'action',
    keywords: ['counter', 'count', 'plus', 'minus', 'integer'],
    template: '<counter bind="{{bind:count}}" label="Count" initial="0" min="0" max="99">',
  },
  {
    id: 'timer',
    label: 'Countdown timer',
    description: 'Start, pause and reset a focus timer.',
    group: 'action',
    keywords: ['timer', 'countdown', 'focus', 'seconds', 'pause'],
    template: '<timer bind="{{bind:remaining}}" label="Focus timer" duration="60">',
  },
  {
    id: 'checklist',
    label: 'Checklist',
    description: 'Track completion with a checkable task list.',
    group: 'action',
    keywords: ['checklist', 'tasks', 'todo', 'check', 'done'],
    template: [
      '<checklist bind="{{bind:done}}" label="Task checklist">',
      '- [ ] First task',
      '- [ ] Second task',
      '- [ ] Third task',
      '</checklist>',
    ].join('\n'),
  },
  {
    id: 'progress',
    label: 'Progress bar',
    description: 'Show completion from 0 to 100.',
    group: 'action',
    keywords: ['progress', 'completion', 'bar', 'percent'],
    template: '<progress label="Progress" value="{{ 40 }}">',
  },

  /* Layout ------------------------------------------------------------ */
  {
    id: 'panel',
    label: 'Parameter panel',
    description: 'Group controls in a panel with a restore-defaults button.',
    group: 'layout',
    keywords: ['panel', 'parameters', 'reset', 'form', 'group'],
    template: ['<panel title="Parameters">', '{{selection:Sample content}}', '</panel>'].join('\n'),
  },
  {
    id: 'card',
    label: 'Content card',
    description: 'Organize a self-contained piece of content in a card.',
    group: 'layout',
    keywords: ['card', 'container', 'content', 'section'],
    template: ['<card title="Content card">', '{{selection:Sample content}}', '</card>'].join('\n'),
  },
  {
    id: 'if',
    label: 'Conditional section',
    description: 'Show the contents only when a condition is true.',
    group: 'layout',
    keywords: ['if', 'condition', 'when', 'show', 'visible'],
    template: ['<if when="{{ {{select:true}} }}">', '{{selection:Sample content}}', '</if>'].join('\n'),
  },
  {
    id: 'tabs',
    label: 'Tabs',
    description: 'Split content across switchable tabs.',
    group: 'layout',
    keywords: ['tabs', 'switch', 'sections', 'groups'],
    template: [
      '<tabs label="Content tabs">',
      '<tab label="Tab one">',
      '{{selection:Sample content}}',
      '</tab>',
      '',
      '<tab label="Tab two">',
      'Content for the second tab.',
      '</tab>',
      '</tabs>',
    ].join('\n'),
  },
  {
    id: 'accordion',
    label: 'Accordion',
    description: 'Put notes into items that expand and collapse.',
    group: 'layout',
    keywords: ['accordion', 'collapse', 'expand', 'faq', 'disclosure'],
    template: [
      '<accordion label="FAQ">',
      '<disclosure label="Question one">',
      '{{selection:Sample content}}',
      '</disclosure>',
      '',
      '<disclosure label="Question two">',
      'Details for the second item.',
      '</disclosure>',
      '</accordion>',
    ].join('\n'),
  },

  /* Data -------------------------------------------------------------- */
  {
    id: 'chart',
    label: 'Bar chart',
    description: 'Turn a Markdown table into a bar chart.',
    group: 'data',
    keywords: ['chart', 'bar', 'graph', 'table', 'data'],
    template: [
      '<chart kind="bar" title="Category comparison" y-label="Value">',
      '| Item | Value |',
      '| --- | ---: |',
      '| Item A | 20 |',
      '| Item B | 35 |',
      '</chart>',
    ].join('\n'),
  },
  {
    id: 'table',
    label: 'Enhanced table',
    description: 'A Markdown table with search, sorting and paging.',
    group: 'data',
    keywords: ['table', 'search', 'sort', 'paging', 'data'],
    template: [
      '<table label="Data table" page-size="5">',
      '| Name | Category | Value |',
      '| --- | --- | ---: |',
      '| Item A | Category one | 20 |',
      '| Item B | Category two | 35 |',
      '</table>',
    ].join('\n'),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'Show task start times and durations in a table.',
    group: 'data',
    keywords: ['timeline', 'schedule', 'plan', 'duration', 'gantt'],
    template: [
      '<timeline title="Task timeline">',
      '| Task | Start | Duration | Notes |',
      '| --- | ---: | ---: | --- |',
      '| Prepare | 0 | 10 | List the materials |',
      '| Execute | 10 | 20 | Complete the main work |',
      '| Review | 30 | 5 | Check the results |',
      '</timeline>',
    ].join('\n'),
  },
  {
    id: 'diagram',
    label: 'Interactive diagram',
    description: 'Show a flow with nodes and edges; click a node to read its notes.',
    group: 'data',
    keywords: ['diagram', 'flow', 'node', 'edge', 'graph'],
    template: [
      '<diagram label="Flow overview">',
      '<node id="start" label="Start">',
      'Where the flow begins.',
      '</node>',
      '',
      '<node id="process" label="Process">',
      'Perform the main step.',
      '</node>',
      '',
      '<node id="end" label="End">',
      'Review the result.',
      '</node>',
      '',
      '<edge from="start" to="process" label="Proceed">',
      '<edge from="process" to="end" label="Complete">',
      '</diagram>',
    ].join('\n'),
  },
  {
    id: 'plot',
    label: 'Function plot',
    description: 'Plot a function curve from a LaTeX formula.',
    group: 'data',
    keywords: ['plot', 'curve', 'function', 'formula', 'latex', 'math'],
    template: ['<plot min="-5" max="5" label="Function plot">', '$$ y = x^2 $$', '</plot>'].join('\n'),
  },

  /* Hint -------------------------------------------------------------- */
  {
    id: 'alert',
    label: 'Alert',
    description: 'Highlight info, success or warning messages with different tones.',
    group: 'hint',
    keywords: ['alert', 'notice', 'warning', 'info', 'message'],
    template: [
      '<alert tone="info" title="Notice">',
      '{{selection:Sample content}}',
      '</alert>',
    ].join('\n'),
  },
  {
    id: 'badge',
    label: 'Badge',
    description: 'Show a short status marker inside a sentence.',
    group: 'hint',
    keywords: ['badge', 'label', 'status', 'inline', 'tag'],
    inline: true,
    template: '<badge tone="success">Badge</badge>',
  },
  {
    id: 'tooltip',
    label: 'Tooltip',
    description: 'Attach a hover or focus note to a word in a sentence.',
    group: 'hint',
    keywords: ['tooltip', 'hint', 'hover', 'focus', 'inline'],
    inline: true,
    template: '<tooltip text="Extra details appear here.">Hover to view</tooltip>',
  },
];

const BIND_TOKEN = /\{\{bind:([^{}]+)\}\}/g;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

function mergeKeywords(base: readonly string[], extra: readonly string[]): string[] {
  const merged = [...base];
  for (const keyword of extra) {
    const normalized = keyword.toLowerCase();
    if (!merged.some((existing) => existing.toLowerCase() === normalized)) {
      merged.push(keyword);
    }
  }
  return merged;
}

export const NATIVE_COMPONENT_GROUPS_ZH: readonly NativeComponentGroup[] =
  NATIVE_COMPONENT_GROUPS.map((group) => ({
    ...group,
    label: NATIVE_COMPONENT_CATALOG_COPY.zh.groups[group.id],
  }));

// The English catalog keeps its canonical labels and templates, but adds the
// Chinese keywords so picker search works in either language.
const NATIVE_COMPONENTS_EN: readonly NativeComponentDefinition[] = NATIVE_COMPONENTS.map(
  (component) => ({
    ...component,
    keywords: mergeKeywords(
      component.keywords,
      NATIVE_COMPONENT_CATALOG_COPY.zh.components[component.id]?.keywords ?? [],
    ),
  }),
);

export const NATIVE_COMPONENTS_ZH: readonly NativeComponentDefinition[] = NATIVE_COMPONENTS.map(
  (component) => {
    const copy = NATIVE_COMPONENT_CATALOG_COPY.zh.components[component.id];
    if (!copy) return component;
    return {
      ...component,
      label: copy.label,
      description: copy.description,
      keywords: mergeKeywords(component.keywords, copy.keywords),
      template: copy.template,
    };
  },
);

export interface NativeComponentCatalog {
  groups: readonly NativeComponentGroup[];
  components: readonly NativeComponentDefinition[];
}

/**
 * Catalog for the active UI language. Labels, descriptions and templates are
 * localized; keywords keep both English and Chinese terms so either query
 * works in either language.
 */
export function getNativeComponentCatalog(language: Language = 'en'): NativeComponentCatalog {
  if (language === 'zh') {
    return { groups: NATIVE_COMPONENT_GROUPS_ZH, components: NATIVE_COMPONENTS_ZH };
  }
  return { groups: NATIVE_COMPONENT_GROUPS, components: NATIVE_COMPONENTS_EN };
}

function collectIdentifiers(source: string): Set<string> {
  return new Set(source.match(IDENTIFIER) ?? []);
}

function normalizeBindBase(rawBase: string): string {
  const cleaned = rawBase.trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!cleaned) return 'value';
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function uniqueBindName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/**
 * Render one toolbar template for insertion into `source`.
 *
 * Only `{{bind:base}}` is resolved here. Selection, caret and selectable tokens
 * stay intact for the toolbar's `insertTemplate` step. `selectedText` is kept
 * for future use; it never replaces the tokens here.
 */
export function renderNativeSnippet(
  component: NativeComponentDefinition,
  source: string,
  selectedText?: string,
): string {
  void selectedText;
  const used = collectIdentifiers(source);
  const rendered = new Map<string, string>();

  return component.template.replace(BIND_TOKEN, (_token: string, rawBase: string) => {
    const key = rawBase.trim();
    const existing = rendered.get(key);
    if (existing) return existing;

    const name = uniqueBindName(normalizeBindBase(key), used);
    used.add(name);
    rendered.set(key, name);
    return name;
  });
}
