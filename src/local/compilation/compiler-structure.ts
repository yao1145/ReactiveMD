import {
  kernelProjectionForFamily,
  kernelRule,
  kernelRules,
  kernelStructure,
  kernelValueBinding,
  type KernelProjectionKind,
  type KernelRule,
  type KernelStructure,
  type NormalizedComponent,
} from './component-kernel';
import {
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
} from '../configuration/limits';
import type { LocalDiagnosticDetails } from '../configuration/diagnostics';
import type { LocalNode, LocalValue } from '../contracts/types';
import type { LocalComponentDefinition } from '../../sdk/types';
import {
  hasComponent,
  meaningful,
  numberValue,
  parseNumberText,
  staticAttributeString,
} from './compiler-values';

/* ------------------------------------------------------------------ */
/* Shared structure state                                              */
/* ------------------------------------------------------------------ */

export interface AttrState {
  raw: string;
  value?: LocalValue;
  dynamic: boolean;
  expression?: string;
  offset: number;
  expressionOffset?: number;
}

export type AttrMap = Record<string, AttrState>;

export interface Entry {
  node: LocalNode;
  name: string;
  kernel: NormalizedComponent;
  definition?: LocalComponentDefinition;
  legacy: boolean;
  parent: Entry | null;
}

export interface ChecklistInfo {
  ids: string[];
  checked: string[];
}

export type ReportDiagnostic = (
  code: string,
  message: string | LocalDiagnosticDetails,
  start: number,
  end?: number,
  details?: LocalDiagnosticDetails,
) => void;

/**
 * Minimal state the structure pass reads and writes. `CompileState` extends
 * this view so the compiler and the pass share one state shape.
 */
export interface StructureState {
  /** Unified registry used for every component node in this compile. */
  readonly schemaByName: ReadonlyMap<string, NormalizedComponent>;
  readonly report: ReportDiagnostic;
  readonly attrs: Map<string, AttrMap>;
  readonly options: Map<string, string[]>;
  readonly tabs: Map<string, string[]>;
  readonly steps: Map<string, string[]>;
  readonly selections: Map<string, string[]>;
  readonly diagramNodes: Map<string, string[]>;
  readonly checklists: Map<string, ChecklistInfo>;
  readonly tables: Map<string, LocalNode>;
}

/* ------------------------------------------------------------------ */
/* Children                                                            */
/* ------------------------------------------------------------------ */

interface ChildComponent {
  node: LocalNode;
  name: string;
}

function componentChildren(entry: Entry, state: StructureState): ChildComponent[] {
  const children: ChildComponent[] = [];
  for (const node of entry.node.children ?? []) {
    if ((node.type === 'component' || node.type === 'hostComponent') && node.name && state.schemaByName.has(node.name)) {
      children.push({ node, name: node.name });
    }
  }
  return children;
}

export function projectionMap(
  state: StructureState,
  kind: 'options' | 'tabs' | 'steps' | 'diagram-nodes',
): Map<string, string[]> {
  switch (kind) {
    case 'options':
      return state.options;
    case 'tabs':
      return state.tabs;
    case 'steps':
      return state.steps;
    case 'diagram-nodes':
      return state.diagramNodes;
  }
}

function setProjection(
  state: StructureState,
  entry: Entry,
  kind: KernelProjectionKind,
  values: string[],
): void {
  if (kind === 'selection') {
    state.selections.set(entry.node.id, values);
    return;
  }
  if (kind === 'checklist') return;
  projectionMap(state, kind).set(entry.node.id, values);
}

/** Split a structural rule's child-name list into the canonical singular view. */
function structureItems(structure: KernelStructure): readonly string[] {
  return structure.children ?? structure.items ?? (structure.child ? [structure.child] : []);
}

function structureMinimum(structure: KernelStructure): number {
  return structure.min ?? structure.minItems ?? 0;
}

/** True when a parent's declared structure/rules explicitly accept this child. */
function parentDeclaresChild(parent: Entry, childName: string): boolean {
  const structure = kernelStructure(parent.kernel);
  if (structureItems(structure).includes(childName)) return true;
  for (const rule of kernelRules(parent.kernel)) {
    switch (rule.kind) {
      case 'options-body':
      case 'value-sequence':
        if (rule.child === childName) return true;
        break;
      case 'only-children':
        if (rule.children.includes(childName)) return true;
        break;
      case 'data-table':
        if (rule.child === childName) return true;
        break;
      case 'quiz-body':
        if (rule.child === childName) return true;
        break;
      case 'diagram-body':
        if (rule.node === childName || rule.edge === childName) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

function structureMaximum(structure: KernelStructure): number | undefined {
  return structure.max ?? structure.maxItems ?? structure.maxItemsCount;
}

const KERNEL_INLINE_TYPES = new Set([
  'text', 'emphasis', 'strong', 'delete', 'underline', 'mark', 'link', 'image',
  'inlineCode', 'inlineMath', 'interpolation', 'break', 'comment', 'fallback',
  'footnoteReference',
]);

function isInlineBody(node: LocalNode): boolean {
  return KERNEL_INLINE_TYPES.has(node.type) && (node.children ?? []).every(isInlineBody);
}

function reportInlineBody(entry: Entry, kids: LocalNode[], state: StructureState, strict: boolean): void {
  if (strict) {
    const body = kids.length === 1 && kids[0].type === 'paragraph' ? kids[0].children ?? [] : kids;
    if (!body.every(isInlineBody)) {
      state.report('local.structure.children', { key: 'local.structure.inline-only', params: { name: entry.name } }, entry.node.range.start, entry.node.range.end);
    }
  }
  for (const child of kids) {
    if (hasComponent(child)) {
      state.report('local.structure.children', { key: 'local.structure.no-nested-components', params: { name: entry.name } }, child.range.start, child.range.end);
    }
  }
}

function reportNoComponents(entry: Entry, state: StructureState): void {
  const walk = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      if (node.type === 'component' || node.type === 'hostComponent') {
        state.report('local.structure.children', { key: 'local.structure.no-components', params: { name: entry.name } }, node.range.start, node.range.end);
        continue;
      }
      if (node.children) walk(node.children);
    }
  };
  walk(entry.node.children ?? []);
}

function validateOptionsBody(
  entry: Entry,
  state: StructureState,
  attrs: AttrMap,
  child: string,
  valueAttribute: string,
  unique: boolean,
  maxItems: number,
  forbidSeparator: string | undefined,
): void {
  const children = componentChildren(entry, state);
  const options = children.filter((candidate) => candidate.name === child);
  if (!options.length) {
    state.report('local.structure.children', { key: 'local.structure.options.needed', params: { name: entry.name } }, entry.node.range.start, entry.node.range.end);
  }
  for (const candidate of children) {
    if (candidate.name !== child) {
      state.report('local.structure.children', { key: 'local.structure.options.only', params: { name: entry.name } }, candidate.node.range.start, candidate.node.range.end);
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name === child
  ))) {
    state.report('local.structure.children', { key: 'local.structure.options.only', params: { name: entry.name } }, entry.node.range.start, entry.node.range.end);
  }
  if (options.length > maxItems) {
    state.report('local.budget.array', { key: 'local.budget.array.options', params: { name: entry.name, limit: maxItems } }, entry.node.range.start, entry.node.range.end);
  }
  const values: string[] = [];
  for (const option of options) {
    const optionAttrs = state.attrs.get(option.node.id) ?? {};
    const value = typeof optionAttrs[valueAttribute]?.value === 'string' ? optionAttrs[valueAttribute].value : '';
    if (!value) {
      state.report('local.option.value', { key: 'local.option.value.required' }, option.node.range.start, option.node.range.end);
      continue;
    }
    if (forbidSeparator !== undefined && value.includes(forbidSeparator)) {
      state.report('local.option.value', { key: 'local.option.value.comma', params: { value } }, option.node.range.start, option.node.range.end);
      continue;
    }
    if (unique && values.includes(value)) {
      state.report('local.option.value', { key: 'local.option.value.duplicate', params: { name: entry.name, value } }, option.node.range.start, option.node.range.end);
      continue;
    }
    if ((option.node.children ?? []).some(hasComponent)) {
      state.report('local.structure.children', { key: 'local.structure.option.no-components' }, option.node.range.start, option.node.range.end);
    }
    values.push(value);
  }
  setProjection(state, entry, 'options', values);
  void attrs;
}

function validateValueSequence(
  entry: Entry,
  state: StructureState,
  child: string,
  valueAttribute: string,
  generatedPrefix: string,
  duplicateCode: string,
): void {
  const children = componentChildren(entry, state);
  const items = children.filter((candidate) => candidate.name === child);
  if (!items.length) {
    state.report('local.structure.children', { key: 'local.structure.sequence.minimum', params: { name: entry.name, child } }, entry.node.range.start, entry.node.range.end);
  }
  for (const candidate of children) {
    if (candidate.name !== child) {
      state.report('local.structure.children', { key: 'local.structure.sequence.only', params: { name: entry.name, child } }, candidate.node.range.start, candidate.node.range.end);
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name === child
  ))) {
    state.report('local.structure.children', { key: 'local.structure.sequence.only', params: { name: entry.name, child } }, entry.node.range.start, entry.node.range.end);
  }
  const values: string[] = [];
  items.forEach((item, index) => {
    const itemAttrs = state.attrs.get(item.node.id) ?? {};
    const rawValue = typeof itemAttrs[valueAttribute]?.value === 'string' ? itemAttrs[valueAttribute].value.trim() : '';
    const value = rawValue || `${generatedPrefix}${index + 1}`;
    if (values.includes(value)) {
      state.report(
        duplicateCode,
        `Values in <${entry.name}> must be unique; duplicate value "${value}".`,
        item.node.range.start,
        item.node.range.end,
        { key: `${duplicateCode}.duplicate`, params: { value } },
      );
      return;
    }
    values.push(value);
  });
  const family = kernelValueBinding(entry.kernel)?.family;
  setProjection(state, entry, kernelProjectionForFamily(family ?? '') === 'tabs' ? 'tabs' : 'steps', values);
}

function validateOnlyChildren(
  entry: Entry,
  state: StructureState,
  allowed: readonly string[],
  min: number,
  max: number | undefined,
  onlyCode: string | undefined,
  maxCode: string | undefined,
): void {
  const children = componentChildren(entry, state);
  const matching = children.filter((candidate) => allowed.includes(candidate.name));
  const label = allowed.map((name) => `<${name}>`).join(' or ');
  const limit = max !== undefined && maxCode === 'local.budget.data-table.columns'
    ? Math.min(max, MAX_LOCAL_DATA_TABLE_COLUMNS)
    : max;
  if (matching.length < min) {
    state.report('local.structure.children', { key: 'local.structure.children.minimum', params: { name: entry.name, min, children: label } }, entry.node.range.start, entry.node.range.end);
  }
  if (limit !== undefined && matching.length > limit) {
    state.report(
      maxCode ?? 'local.budget.array',
      `<${entry.name}> supports at most ${limit} ${label}, but has ${matching.length}.`,
      entry.node.range.start,
      entry.node.range.end,
    );
  }
  for (const candidate of children) {
    if (!allowed.includes(candidate.name)) {
      state.report('local.structure.children', { key: onlyCode ?? 'local.structure.children.only', params: { name: entry.name, children: label } }, candidate.node.range.start, candidate.node.range.end);
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name && state.schemaByName.has(kid.name)
  ))) {
    state.report('local.structure.children', { key: onlyCode ?? 'local.structure.children.only', params: { name: entry.name, children: label } }, entry.node.range.start, entry.node.range.end);
  }
}

function validateDiagramBody(
  entry: Entry,
  state: StructureState,
  rule: Extract<KernelRule, { kind: 'diagram-body' }>,
): void {
  const children = componentChildren(entry, state);
  const nodes = children.filter((child) => child.name === rule.node);
  const edges = children.filter((child) => child.name === rule.edge);
  if (!nodes.length) {
    state.report('local.diagram.node', { key: 'local.diagram.node.required' }, entry.node.range.start, entry.node.range.end);
  }
  for (const child of children) {
    if (child.name !== rule.node && child.name !== rule.edge) {
      state.report('local.structure.children', { key: 'local.structure.diagram.only' }, child.node.range.start, child.node.range.end);
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name
    && (kid.name === rule.node || kid.name === rule.edge)
  ))) {
    state.report('local.structure.children', { key: 'local.structure.diagram.only' }, entry.node.range.start, entry.node.range.end);
  }

  const ids: string[] = [];
  for (const node of nodes) {
    const nodeAttrs = state.attrs.get(node.node.id) ?? {};
    const rawId = nodeAttrs[rule.id]?.value;
    const id = typeof rawId === 'string' ? rawId : '';
    if (!id) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
      state.report('local.diagram.node', { key: 'local.diagram.node.invalid', params: { id } }, node.node.range.start, node.node.range.end);
    }
    if (ids.includes(id)) {
      state.report('local.diagram.node', { key: 'local.diagram.node.duplicate', params: { id } }, node.node.range.start, node.node.range.end);
      continue;
    }
    ids.push(id);
  }
  setProjection(state, entry, 'diagram-nodes', ids);

  const seen = new Set<string>();
  for (const edge of edges) {
    const edgeAttrs = state.attrs.get(edge.node.id) ?? {};
    const rawFrom = edgeAttrs[rule.from]?.value;
    const rawTo = edgeAttrs[rule.to]?.value;
    const rawLabel = rule.label ? edgeAttrs[rule.label]?.value : undefined;
    const from = typeof rawFrom === 'string' ? rawFrom : '';
    const to = typeof rawTo === 'string' ? rawTo : '';
    const label = typeof rawLabel === 'string' ? rawLabel : '';
    if (from && !ids.includes(from)) {
      state.report('local.diagram.edge', { key: 'local.diagram.edge.from', params: { id: from } }, edge.node.range.start, edge.node.range.end);
    }
    if (to && !ids.includes(to)) {
      state.report('local.diagram.edge', { key: 'local.diagram.edge.to', params: { id: to } }, edge.node.range.start, edge.node.range.end);
    }
    const key = `${from}\u0000${to}\u0000${label}`;
    if (seen.has(key)) {
      state.report('local.diagram.edge', { key: 'local.diagram.edge.duplicate', params: { from, to, label: label ? ` (${label})` : '' } }, edge.node.range.start, edge.node.range.end);
    }
    seen.add(key);
  }
}

function validateQuizBody(
  entry: Entry,
  state: StructureState,
  attrs: AttrMap,
  rule: Extract<KernelRule, { kind: 'quiz-body' }>,
): void {
  const type = typeof attrs[rule.type]?.value === 'string' ? String(attrs[rule.type].value) : 'choice';
  const answer = staticAttributeString(entry, attrs, rule.answer) ?? '';
  if (!answer.trim()) {
    state.report('local.quiz.answer', { key: 'local.quiz.answer.required' }, attrs[rule.answer]?.offset ?? entry.node.range.start, undefined);
  }
  if (type === 'number') {
    if (meaningful(entry.node.children).length) {
      state.report('local.structure.children', { key: 'local.structure.quiz.numeric-no-body' }, entry.node.range.start, entry.node.range.end);
    }
    if (answer.trim() && parseNumberText(answer) === null) {
      state.report('local.quiz.answer', { key: 'local.quiz.answer.numeric' }, attrs[rule.answer]?.offset ?? entry.node.range.start, undefined);
    }
    const tolerance = numberValue(entry, attrs, rule.tolerance);
    if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance < 0)) {
      state.report('local.constraint', { key: 'local.constraint.quiz-tolerance' }, attrs[rule.tolerance]?.offset ?? entry.node.range.start, undefined);
    }
    return;
  }
  validateOptionsBody(entry, state, attrs, rule.child, rule.valueAttribute, true, Math.min(rule.max ?? MAX_LOCAL_ARRAY_LENGTH, MAX_LOCAL_ARRAY_LENGTH), undefined);
  const options = state.options.get(entry.node.id) ?? [];
  if (answer.trim() && options.length && !options.includes(answer)) {
    state.report('local.quiz.answer', { key: 'local.quiz.answer.not-option', params: { answer, options: options.join(', ') } }, attrs[rule.answer]?.offset ?? entry.node.range.start, undefined);
  }
}

export function validateChildren(entry: Entry, state: StructureState): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const kids = meaningful(entry.node.children);
  const report = state.report;
  const structure = kernelStructure(entry.kernel);
  const rules = kernelRules(entry.kernel);

  if (structure.parents) {
    const accepted = entry.parent !== null && (
      structure.parents.includes(entry.parent.name)
      || parentDeclaresChild(entry.parent, entry.name)
    );
    if (!accepted) {
      report(
        'local.structure.parent',
        `<${entry.name}> can only appear directly inside ${structure.parents.map((name) => `<${name}>`).join(' or ')}.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.structure.parent', params: { name: entry.name, parents: structure.parents.map((name) => `<${name}>`).join(' / ') } },
      );
    }
  }

  let consumedBody = false;
  let countEnforced = false;
  for (const rule of rules) {
    switch (rule.kind) {
      case 'inline-body':
        consumedBody = true;
        reportInlineBody(entry, kids, state, rule.strict === true || structure.inlineOnly === true);
        break;
      case 'no-components':
        consumedBody = true;
        reportNoComponents(entry, state);
        break;
      case 'single-table': {
        consumedBody = true;
        countEnforced = true;
        const tables = kids.filter((kid) => kid.type === 'table');
        if (tables.length !== 1 || kids.length !== 1) {
          report(
            'local.structure.children',
            `The body of <${entry.name}> must be exactly one Markdown table.`,
            entry.node.range.start,
            entry.node.range.end,
            { key: 'local.structure.table.single', params: { name: entry.name } },
          );
        }
        if (tables.length) state.tables.set(entry.node.id, tables[0]);
        else if (rule.fallbackSingle === true && kids.length === 1) state.tables.set(entry.node.id, kids[0]);
        break;
      }
      case 'math-body': {
        consumedBody = true;
        countEnforced = true;
        const mathNodes = kids.filter((kid) => kid.type === 'math');
        if (!mathNodes.length) {
          report('local.structure.children', `<${entry.name}> requires at least one $$...$$ formula block.`, entry.node.range.start, entry.node.range.end, { key: 'local.structure.plot.needs-formula' });
        }
        for (const kid of kids) {
          if (kid.type !== 'math') {
            report('local.structure.children', `The body of <${entry.name}> can only contain blank lines and $$...$$ formula blocks.`, kid.range.start, kid.range.end, { key: 'local.structure.plot.only-formulas' });
          }
        }
        break;
      }
      case 'options-body':
        consumedBody = true;
        countEnforced = true;
        validateOptionsBody(entry, state, attrs, rule.child, rule.valueAttribute, rule.unique, Math.min(rule.max ?? MAX_LOCAL_ARRAY_LENGTH, MAX_LOCAL_ARRAY_LENGTH), rule.forbidSeparator);
        break;
      case 'value-sequence':
        consumedBody = true;
        countEnforced = true;
        validateValueSequence(entry, state, rule.child, rule.valueAttribute, rule.generatedPrefix, rule.duplicateCode ?? `local.${rule.child}.value`);
        break;
      case 'only-children':
        consumedBody = true;
        countEnforced = true;
        validateOnlyChildren(entry, state, rule.children, rule.min, rule.max, rule.onlyCode, rule.maxCode);
        break;
      case 'diagram-body':
        consumedBody = true;
        countEnforced = true;
        validateDiagramBody(entry, state, rule);
        break;
      case 'quiz-body':
        consumedBody = true;
        countEnforced = true;
        validateQuizBody(entry, state, attrs, rule);
        break;
      case 'checklist-body':
        consumedBody = true;
        countEnforced = true;
        validateChecklist(entry, state, Math.min(rule.itemLimit, MAX_LOCAL_ARRAY_LENGTH));
        break;
      default:
        break;
    }
  }

  if (!consumedBody) {
    switch (structure.rule) {
      case 'none':
        if (kids.length) {
          if (entry.legacy) {
            report('local.host.structure', `Host component <${entry.name}> is a leaf and cannot have body content.`, kids[0].range.start, kids[0].range.end, { key: 'local.host.structure.leaf', params: { component: entry.name } });
          } else {
            report('local.structure.children', `<${entry.name}> does not accept body content.`, kids[0].range.start, kids[0].range.end, { key: 'local.structure.no-body', params: { name: entry.name } });
          }
        }
        break;
      case 'inline':
        reportInlineBody(entry, kids, state, structure.inlineOnly === true || structure.markdown === 'inline');
        break;
      case 'content':
        if (structure.noComponents === true || structure.allowComponents === false) reportNoComponents(entry, state);
        break;
      case 'components': {
        if (structure.noComponents === true || structure.allowComponents === false) reportNoComponents(entry, state);
        const allowed = structureItems(structure);
        if (allowed.length) {
          countEnforced = true;
          const rowRule = kernelRule(entry.kernel, 'data-table');
          validateOnlyChildren(
            entry,
            state,
            allowed,
            structureMinimum(structure),
            structureMaximum(structure),
            undefined,
            rowRule ? 'local.budget.data-table.columns' : undefined,
          );
        }
        break;
      }
      case 'options':
        countEnforced = true;
        validateOptionsBody(entry, state, attrs, structureItems(structure)[0] ?? 'option', structure.valueAttribute ?? 'value', true, Math.min(structure.maxItems ?? MAX_LOCAL_ARRAY_LENGTH, MAX_LOCAL_ARRAY_LENGTH), structure.forbidSeparator);
        break;
      case 'tabs':
      case 'steps':
        countEnforced = true;
        validateValueSequence(
          entry,
          state,
          structureItems(structure)[0] ?? (structure.rule === 'tabs' ? 'tab' : 'step'),
          structure.valueAttribute ?? 'value',
          structure.generatedPrefix ?? structure.valuePrefix ?? `${structure.rule === 'tabs' ? 'tab' : 'step'}-`,
          `local.${structure.rule === 'tabs' ? 'tab' : 'step'}.value`,
        );
        break;
      case 'diagram':
        break;
      case 'quiz':
        break;
      case 'table':
        break;
      case 'plot':
        break;
      case 'any':
      default:
        break;
    }
  }

  const minimum = structureMinimum(structure);
  if (!countEnforced && minimum > 0 && kids.length < minimum) {
    const code = entry.legacy ? 'local.host.structure' : 'local.structure.children';
    report(
      code,
      `Component <${entry.name}> requires body content.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: entry.legacy ? 'local.host.structure.leaf' : 'local.structure.content-required', params: { component: entry.name } },
    );
  }
  const maximum = structureMaximum(structure);
  if (!countEnforced && maximum !== undefined && kids.length > maximum) {
    report(
      'local.structure.children',
      `<${entry.name}> accepts at most ${maximum} body blocks.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: 'local.structure.body-max', params: { name: entry.name, max: maximum } },
    );
  }
  void attrs;
}

export function validateChecklist(
  entry: Entry,
  state: StructureState,
  itemLimit: number = MAX_LOCAL_ARRAY_LENGTH,
): ChecklistInfo {
  const cached = state.checklists.get(entry.node.id);
  if (cached) return cached;
  const kids = meaningful(entry.node.children);
  const lists = kids.filter((kid) => kid.type === 'list');
  if (kids.length !== 1 || lists.length !== 1) {
    state.report('local.checklist.body', { key: 'local.checklist.body.single' }, entry.node.range.start, entry.node.range.end);
  }
  const list = lists[0];
  const ids: string[] = [];
  const checked: string[] = [];
  if (!list) {
    state.checklists.set(entry.node.id, { ids, checked });
    return { ids, checked };
  }
  const items = list.children ?? [];
  if (!items.length) {
    state.report('local.checklist.body', { key: 'local.checklist.body.item-required' }, list.range.start, list.range.end);
  }
  if (items.length > itemLimit) {
    state.report('local.budget.array', { key: 'local.checklist.body.items-limit', params: { limit: itemLimit } }, list.range.start, list.range.end);
  }
  items.slice(0, itemLimit).forEach((item, index) => {
    if (item.type !== 'listItem' || item.checked === null || item.checked === undefined) {
      state.report('local.checklist.body', { key: 'local.checklist.body.task-only' }, item.range.start, item.range.end);
      return;
    }
    if ((item.children ?? []).some((child) => child.type === 'list')) {
      state.report('local.checklist.body', { key: 'local.checklist.body.no-nested' }, item.range.start, item.range.end);
    }
    if (hasComponent(item)) {
      state.report('local.checklist.body', { key: 'local.checklist.body.no-components' }, item.range.start, item.range.end);
    }
    const id = `item-${index + 1}`;
    ids.push(id);
    if (item.checked) checked.push(id);
  });
  const info = { ids, checked };
  state.checklists.set(entry.node.id, info);
  return info;
}
