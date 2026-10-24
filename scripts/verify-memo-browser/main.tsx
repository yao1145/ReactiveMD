import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  compileLocal,
  createLocalRuntime,
} from 'reactive-md';
import type { LocalDocument, LocalNode, LocalRuntime, LocalValue } from 'reactive-md';
import { LocalDocumentView } from 'reactive-md/react';
import 'reactive-md/styles.css';

const SECTIONS = 40;
const STEPS = 350;
const LOCALE_TO_ZH_STEP = 150;
const LOCALE_TO_EN_STEP = 290;
const RESET_STEPS = new Set([60, 180, 270]);
const TAB_CLICKS: Record<number, { index: number; label: string }> = {
  40: { index: 1, label: 'Details' },
  120: { index: 0, label: 'Overview' },
  240: { index: 1, label: 'Details' },
};
// One deliberately redundant write every 30 steps: set() must return [] and
// must not advance the runtime revision.
const NOOP_STEPS = new Set([25, 55, 85, 115, 145, 175, 205, 235, 265, 275, 325]);
// The locale flip back to `en` is a full invalidation (the env object changes).
// These writes then touch every binding once after that invalidation, so a
// dependency that the memo analysis missed cannot hide behind the re-render
// caused by flipping the locale near the end of the run.
const SWEEP_STEP = 291;
const SWEEP_BINDS = [
  'n', 'm', 'g', 'done', 'name', 'clicks', 'z', 'p',
  'tableCost', 'chartCost', 'owner', 'caption', 'warn',
  'tablePick', 'chartPick', 'diagramPick',
];
// One local-state interaction: close the disclosure, then reopen it through a
// panel reset after the final locale flip. Its static content has no binding
// dependencies, so only the reset token can make the memoized block re-render.
const DISCLOSURE_CLICK_STEP = 50;
const EXTRAS_RESET_STEP = STEPS - 1;
const TEXT_VALUES = ['Ada', 'Grace', 'Lin', 'Kai', 'Noa', 'Ruth', ''];
const CHECKLIST_ITEMS = ['item-1', 'item-2', 'item-3'];
// Key-column values of the table/chart views; these are the only legal values
// for their public selection bindings (the compiler validates the options).
const SELECTION_VALUES: Record<string, string[]> = {
  tablePick: ['Alpha', 'Beta', 'Gamma'],
  chartPick: ['Q1', 'Q2', 'Q3', 'Q4'],
  diagramPick: ['input', 'compute', 'view'],
};
const VISUAL_ONLY_BINDS = new Set(['tableCost', 'chartCost', 'owner', 'caption', 'warn']);
const SELECTION_BINDS = new Set(Object.keys(SELECTION_VALUES));
// Explicit visual writes spread over the run, so each visual-only dependency
// and each selection is exercised before the locale flips, not only by the
// seeded random pool or the post-flip sweep.
const VISUAL_WRITE_STEPS: Record<number, string> = {
  10: 'tableCost',
  35: 'owner',
  70: 'tablePick',
  80: 'chartCost',
  95: 'caption',
  100: 'diagramPick',
  110: 'chartPick',
  130: 'tableCost',
  160: 'warn',
  200: 'chartCost',
  210: 'tablePick',
  230: 'diagramPick',
  250: 'caption',
  260: 'chartPick',
  280: 'owner',
};

type Locale = 'en' | 'zh';

type SetOperation = {
  kind: 'set';
  step: number;
  nodeId: string;
  bind: string;
  value: LocalValue;
  noop: boolean;
  revisionAfter: number;
};

type ResetOperation = {
  kind: 'reset';
  step: number;
  nodeId: string;
  revisionAfter: number;
};

type LocaleOperation = {
  kind: 'locale';
  step: number;
  locale: Locale;
  revisionAfter: number;
};

type TabOperation = {
  kind: 'tab';
  step: number;
  index: number;
  label: string;
  revisionAfter: number;
};

type Operation = SetOperation | ResetOperation | LocaleOperation | TabOperation;

interface LatencyResult {
  samples: number;
  medianMs: number;
  p95Ms: number;
}

interface VerifyResult {
  sourceCharacters: number;
  steps: number;
  operations: {
    set: number;
    noop: number;
    reset: number;
    locale: number;
    tab: number;
    visual: number;
    selection: number;
  };
  finalLocale: Locale;
  finalRevision: number;
  stateA: Record<string, LocalValue>;
  stateB: Record<string, LocalValue>;
  statesEqual: boolean;
  htmlA: string;
  htmlB: string;
  latency: { z: LatencyResult; n: LatencyResult };
}

declare global {
  interface Window {
    memoVerify: {
      ready: boolean;
      run(): Promise<VerifyResult>;
    };
  }
}

/* ------------------------------------------------------------------ source */

function buildSource(): string {
  const controls = [
    '<panel title="Parameters" reset="true">',
    '<slider bind="n" label="Sections" initial="2" min="0" max="100">',
    '<slider bind="m" label="Isolated" initial="5" min="0" max="100">',
    '<slider bind="z" label="Unused" initial="7" min="0" max="100">',
    '<toggle bind="g" label="Show details">',
    '<input bind="name" label="Name" placeholder="Enter a name">',
    '<checklist bind="done" label="Tasks">',
    '- [x] First task',
    '- [ ] Second task',
    '- [ ] Third task',
    '</checklist>',
    '<counter bind="clicks" label="{{ m }}" initial="0" min="0" max="99">',
    '</panel>',
    '<panel title="Extras" reset="true">',
    '<accordion label="More">',
    '<disclosure label="Extra settings" open>',
    'Static extra content.',
    '</disclosure>',
    '</accordion>',
    '</panel>',
    '<slider bind="p" label="Plot only" initial="1" min="0" max="10">',
  ].join('\n');

  const sections = Array.from({ length: SECTIONS }, (_, index) => {
    const number = index + 1;
    const isolated = number === 20 ? ' Isolated value {{ m }}.' : '';
    return `## Section ${number}\n\nSection ${number} computes {{ n * ${number} }}.${isolated}`;
  });

  return [
    '# Memo equivalence document',
    '',
    controls,
    '',
    '<if when="{{ g }}">',
    'Conditional panel: three times n is {{ n * 3 }}.',
    '</if>',
    '',
    "Hello, **{{ name == '' ? 'friend' : name }}**.",
    '',
    'Selected tasks: {{ len(done) }} of 3. Counter value: {{ clicks }}.',
    '',
    sections.join('\n\n'),
    '',
    '<plot min="-6" max="6" samples="120" label="Curves">',
    '$$ y = n\\sin x $$',
    '$$ y = x^2 / 20 + m $$',
    '$$ y = p\\sin x $$',
    '</plot>',
    '',
    '<panel title="Visual inputs" reset="true">',
    '<slider bind="tableCost" label="Table cost" initial="4" min="0" max="20" step="1">',
    '<slider bind="chartCost" label="Chart cost" initial="6" min="0" max="20" step="1">',
    '<input bind="owner" label="Owner" placeholder="Owner">',
    '<input bind="caption" label="Caption" placeholder="Caption">',
    '<toggle bind="warn" label="Warning tone">',
    '</panel>',
    '',
    '<table label="Cost table" bind="tablePick" key="Item" initial="Alpha">',
    '| Item | Cost | Owner |',
    '| --- | ---: | --- |',
    '| Alpha | {{ tableCost }} | {{ owner }} |',
    '| Beta | {{ tableCost * 2 }} | Static |',
    "| Gamma | 40 | {{ owner == '' ? 'Unassigned' : owner }} |",
    '</table>',
    '',
    '<chart kind="bar" title="Cost for {{ caption }}" bind="chartPick" key="Period" initial="Q2" x="Period" y="Cost" y-label="Cost">',
    '| Period | Cost |',
    '| --- | ---: |',
    '| Q1 | {{ chartCost }} |',
    '| Q2 | {{ chartCost + 2 }} |',
    '| Q3 | 9 |',
    '| Q4 | 3 |',
    '</chart>',
    '',
    '<timeline title="Release plan" unit="minutes">',
    '| Task | Start | Duration | Notes |',
    '| --- | ---: | ---: | --- |',
    '| Draft | 0 | 10 | Outline |',
    '| Build | 10 | 20 | Implement |',
    '| Review | 30 | 10 | Final pass |',
    '</timeline>',
    '',
    '<diagram bind="diagramPick" initial="input" label="State flow">',
    '<node id="input" label="Input" tone="{{ warn ? \'warning\' : \'neutral\' }}">',
    'Parameters arrive from the controls.',
    '</node>',
    '<node id="compute" label="Compute">',
    'Visual values are recalculated.',
    '</node>',
    '<node id="view" label="View">',
    'Charts and tables update.',
    '</node>',
    '<edge from="input" to="compute" label="Change">',
    '<edge from="compute" to="view" label="Render">',
    '</diagram>',
    '',
    '<tabs label="Views">',
    '<tab label="Overview">',
    'Overview total: {{ n + m }}.',
    '</tab>',
    '<tab label="Details">',
    'Details for {{ name }} with {{ len(done) }} tasks.',
    '</tab>',
    '</tabs>',
    '',
  ].join('\n');
}

/* ----------------------------------------------------------------- helpers */

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allNodes(nodes: LocalNode[]): LocalNode[] {
  return nodes.flatMap((node) => [node, ...allNodes(node.children ?? [])]);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
  await document.fonts.ready;
  await nextFrame();
  await nextFrame();
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarize(samples: number[]): LatencyResult {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    medianMs: Number(median(samples).toFixed(4)),
    p95Ms: Number(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)].toFixed(4)),
  };
}

function copyValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? [...value] : value;
}

function valuesEqual(a: LocalValue | undefined, b: LocalValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => entry === b[index]);
  }
  return a === b;
}

function compileDocument(source: string, label: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) {
    throw new Error(`${label} compile failed: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
}

function findComponent(document: LocalDocument, name: string, bind?: string): LocalNode {
  const node = allNodes(document.nodes).find(
    (candidate) =>
      candidate.type === 'component' &&
      candidate.name === name &&
      (bind === undefined || candidate.attrs?.bind === bind),
  );
  if (!node) throw new Error(`document has no <${name}>${bind ? ` bound to "${bind}"` : ''}`);
  return node;
}

function nodeById(document: LocalDocument, id: string): LocalNode {
  const node = allNodes(document.nodes).find((candidate) => candidate.id === id);
  if (!node) throw new Error(`document has no node "${id}"`);
  return node;
}

function tabButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.local-tablist button')];
}

/**
 * Canonicalizes the serialized markup so two independent mounts can be compared
 * byte for byte:
 * - removes every `id` (React useId derives ids per mounted tree);
 * - removes attributes that reference those ids (`for`, aria-* id references,
 *   fragment-only `href`), whose values necessarily differ between mounts;
 * - collapses `url(#...)` shape references (SVG markers, clip paths) to
 *   `url(#)`, because the referenced element ids are mount-local as well;
 * - sorts attributes inside each tag, because React appends an attribute that
 *   was removed and re-added during an update, while a fresh mount inserts it
 *   in JSX order. Attribute order is not observable in the rendered UI, and it
 *   otherwise differs purely because A was updated over time and B was not.
 */
const ID_REFERENCE_ATTRIBUTES = [
  'for',
  'aria-controls',
  'aria-labelledby',
  'aria-describedby',
  'aria-activedescendant',
  'aria-owns',
];

function normalizeMarkup(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const visit = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      element.removeAttribute('id');
      for (const name of ID_REFERENCE_ATTRIBUTES) element.removeAttribute(name);
      if ((element.getAttribute('href') ?? '').startsWith('#')) element.removeAttribute('href');
      const attributes = [...element.attributes].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      for (const attribute of attributes) element.removeAttribute(attribute.name);
      for (const attribute of attributes) {
        const value = attribute.value.replace(/url\(\s*#[^)]*\)/g, 'url(#)');
        element.setAttribute(attribute.name, value);
      }
    }
    for (const child of [...node.childNodes]) visit(child);
  };
  for (const child of [...template.content.childNodes]) visit(child);
  return template.innerHTML;
}

/**
 * Serializes a mounted view with live form-control state. `innerHTML` reports
 * `checked`/`value` attributes as React last wrote them to the *attribute*:
 * React refreshes `value` on every update, but `checked` (defaultChecked) keeps
 * its mount-time attribute even though the live property is current. A and B
 * mount at different times, so the raw attributes would differ for reasons
 * that are invisible to the reader. Writing the live properties back into a
 * clone keeps the comparison byte-exact while still reporting the actual
 * visible/editable state of every control.
 */
function serializeView(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  const originals = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select',
  );
  const copies = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select',
  );
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (!copy) return;
    if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      copy.removeAttribute('checked');
      copy.removeAttribute('value');
      if (original.type === 'checkbox' || original.type === 'radio') {
        if (original.checked) copy.setAttribute('checked', '');
      } else if (original.type !== 'file') {
        copy.setAttribute('value', original.value);
      }
    } else if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.textContent = original.value;
    } else if (original instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
      [...copy.options].forEach((option, optionIndex) => {
        option.toggleAttribute('selected', original.options[optionIndex]?.selected === true);
      });
    }
  });
  return clone.innerHTML;
}

/* ----------------------------------------------------------------- harness */

async function run(): Promise<VerifyResult> {
  const source = buildSource();
  if (source.length >= 12 * 1024) {
    throw new Error(`test document is ${source.length} characters, over the 12KB budget`);
  }

  const documentA = compileDocument(source, 'view A');
  const runtimeA: LocalRuntime = createLocalRuntime(documentA);
  const containerA = document.getElementById('view-a')!;
  const containerB = document.getElementById('view-b')!;
  const rootA = createRoot(containerA);
  const rootB = createRoot(containerB);

  const nNode = findComponent(documentA, 'slider', 'n');
  const mNode = findComponent(documentA, 'slider', 'm');
  const zNode = findComponent(documentA, 'slider', 'z');
  const pNode = findComponent(documentA, 'slider', 'p');
  const gNode = findComponent(documentA, 'toggle', 'g');
  const nameNode = findComponent(documentA, 'input', 'name');
  const doneNode = findComponent(documentA, 'checklist', 'done');
  const clicksNode = findComponent(documentA, 'counter', 'clicks');
  const tableCostNode = findComponent(documentA, 'slider', 'tableCost');
  const chartCostNode = findComponent(documentA, 'slider', 'chartCost');
  const ownerNode = findComponent(documentA, 'input', 'owner');
  const captionNode = findComponent(documentA, 'input', 'caption');
  const warnNode = findComponent(documentA, 'toggle', 'warn');
  const tablePickNode = findComponent(documentA, 'table', 'tablePick');
  const chartPickNode = findComponent(documentA, 'chart', 'chartPick');
  const diagramPickNode = findComponent(documentA, 'diagram', 'diagramPick');
  const panelNode = findComponent(documentA, 'panel');
  const panels = allNodes(documentA.nodes).filter(
    (candidate) => candidate.type === 'component' && candidate.name === 'panel',
  );
  const extrasPanel = panels[1];
  if (!extrasPanel) throw new Error('document has no second panel');

  const numericBounds: Record<string, { min: number; max: number }> = {
    n: { min: 0, max: 100 },
    m: { min: 0, max: 100 },
    z: { min: 0, max: 100 },
    p: { min: 0, max: 10 },
    clicks: { min: 0, max: 99 },
    tableCost: { min: 0, max: 20 },
    chartCost: { min: 0, max: 20 },
  };
  const nodeByBind: Record<string, LocalNode> = {
    n: nNode,
    m: mNode,
    z: zNode,
    p: pNode,
    g: gNode,
    name: nameNode,
    done: doneNode,
    clicks: clicksNode,
    tableCost: tableCostNode,
    chartCost: chartCostNode,
    owner: ownerNode,
    caption: captionNode,
    warn: warnNode,
    tablePick: tablePickNode,
    chartPick: chartPickNode,
    diagramPick: diagramPickNode,
  };

  let locale: Locale = 'en';
  const renderA = () => {
    flushSync(() => {
      rootA.render(
        <LocalDocumentView
          document={documentA}
          runtime={runtimeA}
          locale={locale}
          colorScheme="light"
        />,
      );
    });
  };

  renderA();
  await settle();

  // Guard against a visual silently degrading to an error frame: the markup
  // comparison alone cannot distinguish two identical error messages.
  const visualSelectors: Array<[string, string]> = [
    ['.local-visual-table', 'table'],
    ['.local-visual-chart', 'chart'],
    ['.local-visual-timeline', 'timeline'],
    ['.local-visual-diagram', 'diagram'],
  ];
  for (const [selector, name] of visualSelectors) {
    if (!containerA.querySelector(selector)) {
      throw new Error(`test document did not render its ${name}`);
    }
  }
  if (containerA.querySelector('.local-visual-alert')) {
    throw new Error('a visual component rendered an error message instead of data');
  }

  const random = mulberry32(0x5eed1234);
  const writePool = [
    'n', 'n', 'm', 'z', 'z', 'p', 'g', 'name', 'done', 'clicks',
    'tableCost', 'tableCost', 'chartCost', 'chartCost', 'owner', 'caption', 'warn',
    'tablePick', 'chartPick', 'diagramPick',
  ];
  const operations: Operation[] = [];
  const revision = () => runtimeA.snapshot().revision;

  const applySet = (step: number, bind: string, value: LocalValue, noop: boolean): void => {
    const node = nodeByBind[bind];
    const before = revision();
    const diagnostics = runtimeA.set(node, value);
    if (diagnostics.length > 0) {
      throw new Error(`step ${step}: set("${bind}") failed: ${JSON.stringify(diagnostics)}`);
    }
    const after = revision();
    if (noop) {
      if (after !== before) throw new Error(`step ${step}: no-op write to "${bind}" committed`);
    } else if (after !== before + 1) {
      throw new Error(`step ${step}: write to "${bind}" did not commit exactly once`);
    }
    operations.push({
      kind: 'set',
      step,
      nodeId: node.id,
      bind,
      value: copyValue(value),
      noop,
      revisionAfter: after,
    });
  };

  const randomNumeric = (bind: string): number => {
    const { min, max } = numericBounds[bind];
    const current = runtimeA.get(nodeByBind[bind]);
    let next = Math.floor(random() * (max - min + 1)) + min;
    if (next === current) next = next === max ? min : next + 1;
    return next;
  };

  const randomText = (node: LocalNode): string => {
    const current = runtimeA.get(node);
    let next = TEXT_VALUES[Math.floor(random() * TEXT_VALUES.length)];
    if (next === current) {
      next = TEXT_VALUES[(TEXT_VALUES.indexOf(next) + 1) % TEXT_VALUES.length];
    }
    return next;
  };

  const randomSelection = (bind: string): string => {
    const values = SELECTION_VALUES[bind];
    const current = runtimeA.get(nodeByBind[bind]);
    let next = values[Math.floor(random() * values.length)];
    if (next === current) next = values[(values.indexOf(next) + 1) % values.length];
    return next;
  };

  const randomChecklist = (): string[] => {
    const current = runtimeA.get(doneNode);
    let next = CHECKLIST_ITEMS.filter(() => random() < 0.45);
    if (valuesEqual(current, next)) {
      next = next.includes('item-1')
        ? next.filter((item) => item !== 'item-1')
        : [...next, 'item-1'].sort();
    }
    return next;
  };

  const changedValue = (bind: string): LocalValue => {
    const current = runtimeA.get(nodeByBind[bind]);
    if (bind === 'g' || bind === 'warn') return current !== true;
    if (bind === 'name' || bind === 'owner' || bind === 'caption') {
      return current === 'Sweep' ? 'Sweep two' : 'Sweep';
    }
    if (bind === 'done') {
      return (current as string[]).includes('item-1')
        ? (current as string[]).filter((item) => item !== 'item-1')
        : [...(current as string[]), 'item-1'].sort();
    }
    if (SELECTION_BINDS.has(bind)) {
      const values = SELECTION_VALUES[bind];
      const index = values.indexOf(String(current));
      return values[(index + 1) % values.length];
    }
    const value = typeof current === 'number' ? current : 0;
    if (bind === 'p') return (value + 1) % 11;
    if (bind === 'clicks') return (value + 1) % 100;
    if (bind === 'tableCost' || bind === 'chartCost') return (value + 1) % 21;
    return (value + 1) % 101;
  };

  let noopCursor = 0;
  const noopBinds = [
    'n', 'm', 'z', 'g', 'name', 'done',
    'tableCost', 'chartCost', 'owner', 'caption', 'warn', 'tablePick',
  ];

  for (let step = 0; step < STEPS; step += 1) {
    if (step === LOCALE_TO_ZH_STEP || step === LOCALE_TO_EN_STEP) {
      locale = step === LOCALE_TO_ZH_STEP ? 'zh' : 'en';
      renderA();
      operations.push({ kind: 'locale', step, locale, revisionAfter: revision() });
      await nextFrame();
      continue;
    }
    if (step === DISCLOSURE_CLICK_STEP) {
      const trigger = containerA.querySelector<HTMLButtonElement>('.local-disclosure-trigger');
      if (!trigger) throw new Error(`step ${step}: missing disclosure trigger`);
      trigger.click();
      await nextFrame();
      if (!containerA.querySelector('.local-disclosure-panel')?.hasAttribute('hidden')) {
        throw new Error(`step ${step}: disclosure did not close`);
      }
      continue;
    }
    if (step === EXTRAS_RESET_STEP) {
      const before = revision();
      flushSync(() => {
        runtimeA.reset(extrasPanel);
      });
      const after = revision();
      if (after !== before + 1) throw new Error(`step ${step}: extras reset did not commit once`);
      operations.push({ kind: 'reset', step, nodeId: extrasPanel.id, revisionAfter: after });
      await nextFrame();
      continue;
    }
    if (RESET_STEPS.has(step)) {
      const before = revision();
      flushSync(() => {
        runtimeA.reset(panelNode);
      });
      const after = revision();
      if (after !== before + 1) throw new Error(`step ${step}: panel reset did not commit once`);
      operations.push({ kind: 'reset', step, nodeId: panelNode.id, revisionAfter: after });
      await nextFrame();
      continue;
    }
    if (TAB_CLICKS[step] !== undefined) {
      const target = TAB_CLICKS[step];
      const button = tabButtons(containerA)[target.index];
      if (!button) throw new Error(`step ${step}: missing tab button #${target.index}`);
      button.click();
      operations.push({
        kind: 'tab',
        step,
        index: target.index,
        label: target.label,
        revisionAfter: revision(),
      });
      await nextFrame();
      continue;
    }
    if (step >= SWEEP_STEP && step < SWEEP_STEP + SWEEP_BINDS.length) {
      const bind = SWEEP_BINDS[step - SWEEP_STEP];
      applySet(step, bind, changedValue(bind), false);
      await nextFrame();
      continue;
    }
    if (VISUAL_WRITE_STEPS[step] !== undefined) {
      const bind = VISUAL_WRITE_STEPS[step];
      applySet(step, bind, changedValue(bind), false);
      await nextFrame();
      continue;
    }
    if (NOOP_STEPS.has(step)) {
      const bind = noopBinds[noopCursor % noopBinds.length];
      noopCursor += 1;
      applySet(step, bind, copyValue(runtimeA.get(nodeByBind[bind])), true);
      await nextFrame();
      continue;
    }

    const bind = writePool[Math.floor(random() * writePool.length)];
    let value: LocalValue;
    if (bind === 'g' || bind === 'warn') {
      value = runtimeA.get(nodeByBind[bind]) !== true;
    } else if (bind === 'name' || bind === 'owner' || bind === 'caption') {
      value = randomText(nodeByBind[bind]);
    } else if (bind === 'done') {
      value = randomChecklist();
    } else if (SELECTION_BINDS.has(bind)) {
      value = randomSelection(bind);
    } else {
      value = randomNumeric(bind);
    }
    applySet(step, bind, value, false);
    await nextFrame();
  }

  await settle();
  const finalLocale = locale;
  const stateA = runtimeA.snapshot().state;
  const htmlA = normalizeMarkup(serializeView(containerA));

  /* --------------------------------------------------- recorded latency */
  const measureWrites = async (node: LocalNode, start: number): Promise<number[]> => {
    let value = start;
    const samples: number[] = [];
    for (let index = 0; index < 5 + 30; index += 1) {
      value = (value + 7) % 101;
      const started = performance.now();
      flushSync(() => {
        const diagnostics = runtimeA.set(node, value);
        if (diagnostics.length > 0) throw new Error(JSON.stringify(diagnostics));
      });
      void containerA.getBoundingClientRect();
      const ended = performance.now();
      if (index >= 5) samples.push(ended - started);
      await nextFrame();
    }
    return samples;
  };
  const zLatency = summarize(await measureWrites(zNode, 3));
  const nLatency = summarize(await measureWrites(nNode, 11));

  /* ------------------------------------------------- fresh compile + B */
  const documentB = compileDocument(source, 'view B');
  const runtimeB: LocalRuntime = createLocalRuntime(documentB);

  for (const operation of operations) {
    if (operation.kind === 'set') {
      const node = nodeById(documentB, operation.nodeId);
      const diagnostics = runtimeB.set(node, copyValue(operation.value));
      if (diagnostics.length > 0) {
        throw new Error(
          `replay step ${operation.step}: set("${operation.bind}") failed: ${JSON.stringify(diagnostics)}`,
        );
      }
    } else if (operation.kind === 'reset') {
      runtimeB.reset(nodeById(documentB, operation.nodeId));
    }
    const replayed = runtimeB.snapshot().revision;
    if (replayed !== operation.revisionAfter) {
      throw new Error(
        `replay step ${operation.step}: revision ${replayed}, expected ${operation.revisionAfter}`,
      );
    }
  }

  const stateB = runtimeB.snapshot().state;
  const statesEqual = JSON.stringify(stateA) === JSON.stringify(stateB);

  flushSync(() => {
    rootB.render(
      <LocalDocumentView
        document={documentB}
        runtime={runtimeB}
        locale={finalLocale}
        colorScheme="light"
      />,
    );
  });
  await settle();

  // Unbound tabs keep their selection in local component state; replay the
  // same clicks on B so both views end on the same tab.
  for (const operation of operations) {
    if (operation.kind !== 'tab') continue;
    const button = tabButtons(containerB)[operation.index];
    if (!button) throw new Error(`replay: missing tab button #${operation.index}`);
    button.click();
    await nextFrame();
  }
  await nextFrame();
  await nextFrame();
  const htmlB = normalizeMarkup(serializeView(containerB));

  const setOperations = operations.filter(
    (operation): operation is SetOperation => operation.kind === 'set',
  );
  const counts = {
    set: setOperations.filter((operation) => !operation.noop).length,
    noop: setOperations.filter((operation) => operation.noop).length,
    reset: operations.filter((operation) => operation.kind === 'reset').length,
    locale: operations.filter((operation) => operation.kind === 'locale').length,
    tab: operations.filter((operation) => operation.kind === 'tab').length,
    visual: setOperations.filter(
      (operation) => !operation.noop && VISUAL_ONLY_BINDS.has(operation.bind),
    ).length,
    selection: setOperations.filter(
      (operation) => !operation.noop && SELECTION_BINDS.has(operation.bind),
    ).length,
  };

  return {
    sourceCharacters: source.length,
    steps: STEPS,
    operations: counts,
    finalLocale,
    finalRevision: runtimeA.snapshot().revision,
    stateA,
    stateB,
    statesEqual,
    htmlA,
    htmlB,
    latency: { z: zLatency, n: nLatency },
  };
}

window.memoVerify = { ready: true, run };
