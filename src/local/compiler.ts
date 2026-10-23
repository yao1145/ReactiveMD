import type { Diagnostic } from './types';
import { compileExpression, LocalExpressionError, RESERVED_NAMES, type LocalExpression } from './expression';
import { compileLatex } from './math';
import { parseLocal } from './parser';
import {
  isLocalEmail,
  MAX_LOCAL_DOCUMENT_LENGTH,
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_DIAGNOSTIC_LENGTH,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_STRING_LENGTH,
} from './limits';
import {
  getLocalComponent,
  suggestAttribute,
  suggestComponent,
  type LocalComponentSchema,
  type LocalPropSchema,
} from './schema';
import type {
  LocalBinding,
  LocalCompileOptions,
  LocalCompileResult,
  LocalDocument,
  LocalNode,
  LocalValue,
  LocalValueKind,
} from './types';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const EPSILON = 1e-9;
/** Longer names are rejected before suggestion/edit-distance work. */
const MAX_LOCAL_NAME_LENGTH = 128;
/** Keep conflict bursts readable while bounding diagnostic volume. */
const MAX_INITIAL_CONFLICT_DIAGNOSTICS = 4;
/** Show at most this many peer locations in one conflict message. */
const MAX_CONFLICT_PEERS = 3;

/** Bind names that cannot be used because they are literals or plot variables. */
const EXTRA_RESERVED = new Set(['x', 'y', 'true', 'false', 'null', 'pi', 'e']);

function parseNumberText(raw: string): number | null {
  const text = raw.trim();
  if (!NUMBER_TEXT.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isValidDate(value: string): boolean {
  if (value === '') return true;
  const match = DATE_TEXT.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function cloneValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? [...value] : value;
}

function onStep(value: number, base: number, step: number): boolean {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) <= EPSILON * Math.max(1, Math.abs(quotient));
}

function nearestZero(min: number | undefined, max: number | undefined, step: number): number | null {
  const base = min ?? 0;
  const lower = min === undefined ? Number.NEGATIVE_INFINITY : Math.ceil((min - base) / step);
  const upper = max === undefined ? Number.POSITIVE_INFINITY : Math.floor((max - base) / step);
  if (lower > upper) return null;
  const target = -base / step;
  let best: number | null = null;
  for (const candidate of [Math.floor(target), Math.ceil(target)]) {
    const index = Math.min(upper, Math.max(lower, candidate));
    if (!Number.isFinite(index)) continue;
    if (best === null) {
      best = index;
      continue;
    }
    const value = base + index * step;
    const current = base + best * step;
    if (Math.abs(value) < Math.abs(current) || (Math.abs(value) === Math.abs(current) && value < current)) {
      best = index;
    }
  }
  if (best === null) return null;
  const value = base + best * step;
  return min !== undefined && value < min ? null : max !== undefined && value > max ? null : value;
}

interface ScanSegment {
  expression: string;
  start: number;
  end: number;
}

/** Locate `{{ ... }}` segments inside a decoded attribute value. */
function scanInterpolations(value: string): { segments: ScanSegment[]; unterminated: number[] } {
  const segments: ScanSegment[] = [];
  const unterminated: number[] = [];
  for (let i = 0; i < value.length; ) {
    if (value[i] === '\\' && value.startsWith('{{', i + 1)) {
      i += 3;
      continue;
    }
    if (!value.startsWith('{{', i)) {
      i++;
      continue;
    }
    let quote = '';
    let end = i + 2;
    for (; end < value.length - 1; end++) {
      const character = value[end];
      if (quote) {
        if (character === '\\') end++;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '}' && value[end + 1] === '}') break;
    }
    if (end >= value.length - 1) {
      unterminated.push(i);
      break;
    }
    const raw = value.slice(i + 2, end);
    const leading = raw.length - raw.trimStart().length;
    segments.push({ expression: raw.trim(), start: i + 2 + leading, end });
    i = end + 2;
  }
  return { segments, unterminated };
}

function fullInterpolation(value: string): { expression: string; start: number } | null {
  const match = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(value);
  if (!match) return null;
  const raw = match[1];
  const leading = raw.length - raw.trimStart().length;
  const brace = value.indexOf('{{');
  return { expression: raw.trim(), start: brace + 2 + leading };
}

function isWhitespaceNode(node: LocalNode): boolean {
  return (
    node.type === 'comment' ||
    (node.type === 'text' && !(node.value ?? '').trim()) ||
    (node.type === 'paragraph' && !node.children?.length && !(node.value ?? '').trim())
  );
}

function meaningful(nodes: LocalNode[] | undefined): LocalNode[] {
  return (nodes ?? []).filter((node) => !isWhitespaceNode(node));
}

function plainText(node: LocalNode): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'fallback') return node.value ?? '';
  if (node.type === 'interpolation') return '\u0000';
  if (node.type === 'break') return ' ';
  return (node.children ?? []).map(plainText).join('');
}

function hasInterpolation(node: LocalNode): boolean {
  if (node.type === 'interpolation') return true;
  return (node.children ?? []).some(hasInterpolation);
}

function hasComponent(node: LocalNode): boolean {
  if (node.type === 'component') return true;
  return (node.children ?? []).some(hasComponent);
}

function typeName(kind: LocalValueKind): string {
  switch (kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return 'array';
  }
}

/* ------------------------------------------------------------------ */
/* Compiler implementation                                             */
/* ------------------------------------------------------------------ */

interface Entry {
  node: LocalNode;
  name: string;
  schema: LocalComponentSchema;
  parent: Entry | null;
}

interface AttrState {
  raw: string;
  value?: LocalValue;
  dynamic: boolean;
  expression?: string;
  offset: number;
  expressionOffset?: number;
}

type AttrMap = Record<string, AttrState>;

interface ChecklistInfo {
  ids: string[];
  checked: string[];
}

interface CompileState {
  source: string;
  lineStarts: number[];
  nodes: LocalNode[];
  report: (code: string, message: string, start: number, end?: number) => void;
  entries: Entry[];
  attrs: Map<string, AttrMap>;
  options: Map<string, string[]>;
  tabs: Map<string, string[]>;
  diagramNodes: Map<string, string[]>;
  checklists: Map<string, ChecklistInfo>;
  tables: Map<string, LocalNode>;
  bindingKinds: Record<string, LocalValueKind>;
  expressionKinds: Map<string, LocalValueKind | null>;
}

export function compileLocal(source: string, options?: LocalCompileOptions): LocalCompileResult {
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    return { ok: false, diagnostics: parseLocal(source, options).diagnostics };
  }
  const diagnostics: Diagnostic[] = [];
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  const report = (code: string, message: string, start: number, end = start + 1) => {
    if (diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) {
      // Parser warnings can fill the budget first; a real error still needs to
      // be visible, so replace the newest disposable warning.
      let index = diagnostics.length - 1;
      while (index >= 0 && diagnostics[index].severity !== 'warning') index -= 1;
      if (index < 0) return;
      diagnostics.splice(index, 1);
    }
    const safeStart = Math.max(0, Math.min(source.length, start));
    const safeEnd = Math.max(safeStart, Math.min(source.length, Math.max(safeStart, end)));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= safeStart) low = middle;
      else high = middle - 1;
    }
    diagnostics.push({
      code,
      message: message.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
        ? `${message.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
        : message,
      severity: 'error',
      range: { start: safeStart, end: safeEnd },
      line: low + 1,
      column: safeStart - lineStarts[low] + 1,
    });
  };

  let parsed: ReturnType<typeof parseLocal>;
  try {
    parsed = parseLocal(source, options);
  } catch (error) {
    report('local.parse', `Cannot parse document: ${error instanceof Error ? error.message : String(error)}`, 0);
    return { ok: false, diagnostics };
  }
  diagnostics.push(...parsed.diagnostics);

  // A fenced `reactive-md` block keeps the legacy configuration language name
  // (state/actions/data/computed). Ordinary markdown/text code fences stay
  // literal and are not diagnosed.
  for (const code of collectLegacyFences(parsed.nodes)) {
    report(
      'local.legacy',
      'Legacy reactive-md configuration fences (state/data/computed/actions, etc.) are not part of the local interaction syntax; select legacy mode explicitly in the host.',
      code.range.start,
      code.range.end,
    );
  }

  const state: CompileState = {
    source,
    lineStarts,
    nodes: parsed.nodes,
    report,
    entries: [],
    attrs: new Map(),
    options: new Map(),
    tabs: new Map(),
    diagramNodes: new Map(),
    checklists: new Map(),
    tables: new Map(),
    bindingKinds: {},
    expressionKinds: new Map(),
  };

  collectEntries(parsed.nodes, null, state.entries, state);
  for (const entry of state.entries) {
    state.attrs.set(entry.node.id, validateAttributes(entry, state));
    validateAttributeRelations(entry, state);
  }
  for (const entry of state.entries) validateChildren(entry, state);

  const bindings = resolveBindings(state);
  state.bindingKinds = bindingKinds(bindings);

  validateExpressions(state);
  validatePlots(state);
  validateTables(state);

  const initialState: Record<string, LocalValue> = {};
  for (const [key, binding] of Object.entries(bindings)) initialState[key] = cloneValue(binding.initial);

  diagnostics.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError) return { ok: false, diagnostics };

  const document: LocalDocument = {
    syntax: 'local',
    source,
    nodes: parsed.nodes,
    initialState,
    bindings,
  };
  return { ok: true, document, diagnostics };
}

/* ------------------------------------------------------------------ */
/* Collection and attributes                                           */
/* ------------------------------------------------------------------ */

function collectLegacyFences(nodes: LocalNode[]): LocalNode[] {
  const found: LocalNode[] = [];
  const walk = (items: LocalNode[]): void => {
    for (const node of items) {
      if (node.type === 'code' && (node.lang ?? '').trim().toLowerCase() === 'reactive-md') found.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return found;
}

function collectEntries(nodes: LocalNode[], parent: Entry | null, out: Entry[], state: CompileState): void {
  for (const node of nodes) {
    let nextParent = parent;
    if (node.type === 'component' && node.name) {
      const schema = getLocalComponent(node.name);
      if (schema) {
        const entry: Entry = { node, name: node.name, schema, parent };
        out.push(entry);
        nextParent = entry;
      } else {
        const suggestion = node.name.length <= MAX_LOCAL_NAME_LENGTH ? suggestComponent(node.name) : undefined;
        state.report(
          'local.component.unknown',
          `Unknown component <${node.name}>. ${suggestion ? `Did you mean <${suggestion}>?` : 'This mode only accepts local interaction components.'}`,
          node.range.start,
          node.range.end,
        );
      }
    }
    if (node.children) collectEntries(node.children, nextParent, out, state);
  }
}

/** Slice only the opening tag so attribute lookup never rescans component content. */
function openingTag(source: string, start: number, end: number): string {
  let quote = '';
  let index = start;
  for (; index < end; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      index += 1;
      break;
    }
  }
  return source.slice(start, index);
}

function attributeOffset(state: CompileState, entry: Entry, name: string): number {
  if (name.length > MAX_LOCAL_NAME_LENGTH) return entry.node.range.start;
  const text = openingTag(state.source, entry.node.range.start, entry.node.range.end);
  const pattern = new RegExp(`(?:^|[\\s"'/])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|=|/|>)`);
  const match = pattern.exec(text);
  return match ? entry.node.range.start + match.index + (match[0].length - name.length) : entry.node.range.start;
}

function validateAttributes(entry: Entry, state: CompileState): AttrMap {
  const attrs: AttrMap = {};
  const rawAttrs = entry.node.attrs ?? {};
  for (const [name, raw] of Object.entries(rawAttrs)) {
    const prop = entry.schema.props[name];
    const offset = attributeOffset(state, entry, name);
    if (!prop) {
      const suggestion = name.length <= MAX_LOCAL_NAME_LENGTH ? suggestAttribute(entry.schema, name) : undefined;
      state.report(
        'local.attribute.unknown',
        `Component <${entry.name}> does not support attribute ${name}.${suggestion ? ` Did you mean ${suggestion}?` : ''}`,
        offset,
        offset + name.length,
      );
      continue;
    }
    const info: AttrState = { raw, offset, dynamic: false };
    if (prop.kind === 'string' && raw.length > MAX_LOCAL_STRING_LENGTH) {
      state.report(
        'local.budget.attribute',
        `Attribute ${name} on component <${entry.name}> exceeds the ${MAX_LOCAL_STRING_LENGTH}-character limit.`,
        offset,
        offset + name.length,
      );
      info.raw = raw.slice(0, MAX_LOCAL_STRING_LENGTH);
    }
    validatePropValue(entry, name, prop, info, state);
    attrs[name] = info;
  }
  for (const [name, prop] of Object.entries(entry.schema.props)) {
    if (prop.required && !Object.hasOwn(attrs, name)) {
      state.report(
        'local.attribute.required',
        `Component <${entry.name}> is missing required attribute ${name}.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }
  }
  if (entry.schema.label === 'required') {
    if (!Object.hasOwn(attrs, 'label')) {
      state.report('local.label.required', `Component <${entry.name}> requires a label.`, entry.node.range.start, entry.node.range.end);
    } else if (!String(attrs.label.raw).trim()) {
      state.report('local.label.required', `Component <${entry.name}> label cannot be empty.`, attrs.label.offset);
    }
  }
  return attrs;
}

function validatePropValue(
  entry: Entry,
  name: string,
  prop: LocalPropSchema,
  info: AttrState,
  state: CompileState,
): void {
  if (prop.kind === 'string') {
    if (prop.static) {
      const scanned = scanInterpolations(info.raw);
      if (scanned.segments.length || scanned.unterminated.length) {
        state.report(
          'local.attribute.static',
          `Attribute ${name} is static and cannot contain interpolations.`,
          info.offset,
          info.offset + info.raw.length,
        );
      }
    }
    info.value = info.raw;
    return;
  }

  if (prop.kind === 'number') {
    const full = prop.dynamic ? fullInterpolation(info.raw) : null;
    if (full) {
      info.dynamic = true;
      info.expression = full.expression;
      info.expressionOffset = info.offset + full.start;
      if (!full.expression) {
        state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset);
      }
      return;
    }
    const value = parseNumberText(info.raw);
    if (value === null) {
      state.report(
        'local.attribute.type',
        `Attribute ${name} requires a number${prop.dynamic ? ' or a full number interpolation' : ''}, got "${info.raw}".`,
        info.offset,
        info.offset + info.raw.length,
      );
      return;
    }
    if (prop.integer && !Number.isInteger(value)) {
      state.report('local.attribute.type', `Attribute ${name} requires an integer.`, info.offset);
    }
    if (prop.positive && !(value > 0)) {
      state.report('local.attribute.type', `Attribute ${name} requires a positive number.`, info.offset);
    }
    if (prop.min !== undefined && value < prop.min) {
      state.report('local.attribute.range', `Attribute ${name} must be at least ${prop.min}.`, info.offset);
    }
    if (prop.max !== undefined && value > prop.max) {
      state.report('local.attribute.range', `Attribute ${name} must be at most ${prop.max}.`, info.offset);
    }
    info.value = value;
    return;
  }

  if (prop.kind === 'boolean') {
    const full = prop.dynamic ? fullInterpolation(info.raw) : null;
    if (full) {
      info.dynamic = true;
      info.expression = full.expression;
      info.expressionOffset = info.offset + full.start;
      if (!full.expression) {
        state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset);
      }
      return;
    }
    if (info.raw === 'true' || info.raw === 'false') {
      info.value = info.raw === 'true';
      return;
    }
    state.report(
      'local.attribute.type',
      `Attribute ${name} requires true or false${prop.dynamic ? ', or a full boolean interpolation' : ''}.`,
      info.offset,
      info.offset + info.raw.length,
    );
    return;
  }

  // enum
  const full = prop.dynamic ? fullInterpolation(info.raw) : null;
  if (full) {
    info.dynamic = true;
    info.expression = full.expression;
    info.expressionOffset = info.offset + full.start;
    if (!full.expression) {
      state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset);
    }
    return;
  }
  const values = prop.values ?? [];
  if (!values.includes(info.raw)) {
    state.report(
      'local.attribute.type',
      `Attribute ${name} must be one of ${values.join(' / ')}, got "${info.raw}".`,
      info.offset,
      info.offset + info.raw.length,
    );
    return;
  }
  info.value = info.raw;
}

function numberValue(entry: Entry, attrs: AttrMap, name: string): number | undefined {
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'number' ? info.value : undefined;
  const fallback = entry.schema.props[name]?.default;
  return typeof fallback === 'number' ? fallback : undefined;
}

function validateAttributeRelations(entry: Entry, state: CompileState): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const report = state.report;

  if (entry.name === 'number' || entry.name === 'slider' || entry.name === 'counter') {
    const min = numberValue(entry, attrs, 'min');
    const max = numberValue(entry, attrs, 'max');
    const step = numberValue(entry, attrs, 'step');
    if (min !== undefined && max !== undefined && min > max) {
      report('local.constraint', `Component <${entry.name}> min cannot exceed max.`, attrs.min?.offset ?? entry.node.range.start);
    }
    if (step !== undefined && !(step > 0)) {
      report('local.constraint', `Component <${entry.name}> step must be greater than 0.`, attrs.step?.offset ?? entry.node.range.start);
    }
  }

  if (entry.name === 'input' || entry.name === 'textarea') {
    const minimum = numberValue(entry, attrs, 'min-length') ?? 0;
    const maximum = numberValue(entry, attrs, 'max-length');
    if (maximum !== undefined && maximum < minimum) {
      report('local.constraint', 'max-length cannot be less than min-length.', attrs['max-length']?.offset ?? entry.node.range.start);
    }
  }

  if (entry.name === 'date') {
    const min = typeof attrs.min?.value === 'string' ? attrs.min.value : undefined;
    const max = typeof attrs.max?.value === 'string' ? attrs.max.value : undefined;
    if (min !== undefined && !isValidDate(min)) {
      report('local.attribute.type', `Date lower bound ${min} is not a valid YYYY-MM-DD.`, attrs.min?.offset ?? entry.node.range.start);
    }
    if (max !== undefined && !isValidDate(max)) {
      report('local.attribute.type', `Date upper bound ${max} is not a valid YYYY-MM-DD.`, attrs.max?.offset ?? entry.node.range.start);
    }
    if (min && max && min > max) {
      report('local.constraint', 'Date min cannot be later than max.', attrs.min?.offset ?? entry.node.range.start);
    }
  }

  if (entry.name === 'progress') {
    const max = numberValue(entry, attrs, 'max') ?? 100;
    const value = attrs.value;
    if (value && !value.dynamic && typeof value.value === 'number') {
      if (value.value < 0 || value.value > max) {
        report(
          'local.constraint',
          `progress value must be between 0 and ${max}, got ${value.value}.`,
          value.offset,
        );
      }
    }
  }

  if (entry.name === 'plot') {
    const min = numberValue(entry, attrs, 'min');
    const max = numberValue(entry, attrs, 'max');
    if (min !== undefined && max !== undefined && !(min < max)) {
      report('local.constraint', 'plot min must be less than max.', attrs.min?.offset ?? entry.node.range.start);
    }
  }

  if (entry.name === 'timer') {
    const duration = numberValue(entry, attrs, 'duration') ?? 60;
    if (!Number.isInteger(duration) || duration <= 0) {
      report('local.constraint', 'timer duration must be a positive whole number of seconds.', attrs.duration?.offset ?? entry.node.range.start);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Children                                                            */
/* ------------------------------------------------------------------ */

function componentChildren(entry: Entry): Entry[] {
  return (entry.node.children ?? [])
    .filter((node): node is LocalNode => node.type === 'component' && !!node.name)
    .map((node) => ({
      node,
      name: node.name!,
      schema: getLocalComponent(node.name!)!,
      parent: entry,
    }))
    .filter((child) => !!child.schema);
}

function validateChildren(entry: Entry, state: CompileState): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const kids = meaningful(entry.node.children);
  const report = state.report;
  const rule = entry.schema.childRule;

  if (entry.schema.parent) {
    if (!entry.parent || !entry.schema.parent.includes(entry.parent.name)) {
      report(
        'local.structure.parent',
        `<${entry.name}> can only appear directly inside ${entry.schema.parent.map((name) => `<${name}>`).join(' or ')}.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }
  }

  switch (rule) {
    case 'none':
      if (kids.length) {
        report('local.structure.children', `<${entry.name}> does not accept body content.`, kids[0].range.start, kids[0].range.end);
      }
      break;
    case 'inline':
      for (const child of kids) {
        if (hasComponent(child)) {
          report('local.structure.children', `The body of <${entry.name}> cannot contain other interactive components.`, child.range.start, child.range.end);
        }
      }
      break;
    case 'content':
      if (entry.name === 'node') validateNodeContent(entry, state);
      break;
    case 'any':
      break;
    case 'options':
      validateOptions(entry, state, attrs);
      break;
    case 'tabs':
      validateTabs(entry, state);
      break;
    case 'disclosures': {
      const children = componentChildren(entry);
      const allowed = children.filter((child) => child.name === 'disclosure');
      if (!allowed.length) {
        report('local.structure.children', '<accordion> requires at least one <disclosure>.', entry.node.range.start, entry.node.range.end);
      }
      if (allowed.length !== children.length) {
        for (const child of children) if (child.name !== 'disclosure') report('local.structure.children', '<accordion> can only contain <disclosure>.', child.node.range.start, child.node.range.end);
      }
      if (kids.some((kid) => kid.type !== 'component')) {
        report('local.structure.children', '<accordion> can only contain <disclosure>.', entry.node.range.start, entry.node.range.end);
      }
      break;
    }
    case 'cards': {
      const children = componentChildren(entry);
      const allowed = children.filter((child) => child.name === 'card');
      if (!allowed.length) {
        report('local.structure.children', '<grid> requires at least one <card>.', entry.node.range.start, entry.node.range.end);
      }
      if (allowed.length !== children.length) {
        for (const child of children) if (child.name !== 'card') report('local.structure.children', 'Direct children of <grid> must be <card>.', child.node.range.start, child.node.range.end);
      }
      if (kids.some((kid) => kid.type !== 'component')) {
        report('local.structure.children', 'Direct children of <grid> must be <card>.', entry.node.range.start, entry.node.range.end);
      }
      break;
    }
    case 'diagram':
      validateDiagram(entry, state);
      break;
    case 'table': {
      const tables = kids.filter((kid) => kid.type === 'table');
      if (tables.length !== 1 || kids.length !== 1) {
        report(
          'local.structure.children',
          `The body of <${entry.name}> must be exactly one Markdown table.`,
          entry.node.range.start,
          entry.node.range.end,
        );
      }
      if (tables.length) state.tables.set(entry.node.id, tables[0]);
      else if (entry.name === 'table' && kids.length === 1) state.tables.set(entry.node.id, kids[0]);
      break;
    }
    case 'plot': {
      const mathNodes = kids.filter((kid) => kid.type === 'math');
      if (!mathNodes.length) {
        report('local.structure.children', '<plot> requires at least one $$...$$ formula block.', entry.node.range.start, entry.node.range.end);
      }
      for (const kid of kids) {
        if (kid.type !== 'math') {
          report('local.structure.children', 'The body of <plot> can only contain blank lines and $$...$$ formula blocks.', kid.range.start, kid.range.end);
        }
      }
      break;
    }
  }
}

function validateNodeContent(entry: Entry, state: CompileState): void {
  const walk = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      if (node.type === 'component') {
        state.report(
          'local.structure.children',
          'The description of <node> cannot contain interactive components.',
          node.range.start,
          node.range.end,
        );
        continue;
      }
      if (node.children) walk(node.children);
    }
  };
  walk(entry.node.children ?? []);
}

function validateOptions(entry: Entry, state: CompileState, attrs: AttrMap): void {
  const children = componentChildren(entry);
  const options = children.filter((child) => child.name === 'option');
  if (!options.length) {
    state.report(
      'local.structure.children',
      `<${entry.name}> requires at least one <option value="...">.`,
      entry.node.range.start,
      entry.node.range.end,
    );
  }
  for (const child of children) {
    if (child.name !== 'option') {
      state.report('local.structure.children', `<${entry.name}> can only contain <option>.`, child.node.range.start, child.node.range.end);
    }
  }
  if (meaningful(entry.node.children).some((kid) => kid.type !== 'component')) {
    state.report('local.structure.children', `<${entry.name}> can only contain <option>.`, entry.node.range.start, entry.node.range.end);
  }
  const values: string[] = [];
  for (const option of options) {
    const optionAttrs = state.attrs.get(option.node.id) ?? {};
    const value = typeof optionAttrs.value?.value === 'string' ? optionAttrs.value.value : '';
    if (!value) {
      state.report('local.option.value', '<option> requires a non-empty value.', option.node.range.start, option.node.range.end);
      continue;
    }
    if (values.includes(value)) {
      state.report('local.option.value', `Option values in <${entry.name}> must be unique; duplicate value "${value}".`, option.node.range.start, option.node.range.end);
      continue;
    }
    if ((option.node.children ?? []).some(hasComponent)) {
      state.report('local.structure.children', 'The body of <option> cannot contain interactive components.', option.node.range.start, option.node.range.end);
    }
    values.push(value);
  }
  state.options.set(entry.node.id, values);
}

function validateTabs(entry: Entry, state: CompileState): void {
  const children = componentChildren(entry);
  const tabs = children.filter((child) => child.name === 'tab');
  if (!tabs.length) {
    state.report('local.structure.children', '<tabs> requires at least one <tab>.', entry.node.range.start, entry.node.range.end);
  }
  for (const child of children) {
    if (child.name !== 'tab') {
      state.report('local.structure.children', '<tabs> can only contain <tab>.', child.node.range.start, child.node.range.end);
    }
  }
  if (meaningful(entry.node.children).some((kid) => kid.type !== 'component')) {
    state.report('local.structure.children', '<tabs> can only contain <tab>.', entry.node.range.start, entry.node.range.end);
  }
  const values: string[] = [];
  tabs.forEach((tab, index) => {
    const tabAttrs = state.attrs.get(tab.node.id) ?? {};
    const rawValue = typeof tabAttrs.value?.value === 'string' ? tabAttrs.value.value.trim() : '';
    const value = rawValue || `tab-${index + 1}`;
    if (values.includes(value)) {
      state.report('local.tab.value', `Tab values in <tabs> must be unique; duplicate value "${value}".`, tab.node.range.start, tab.node.range.end);
      return;
    }
    values.push(value);
  });
  state.tabs.set(entry.node.id, values);
}

function validateDiagram(entry: Entry, state: CompileState): void {
  const children = componentChildren(entry);
  const nodes = children.filter((child) => child.name === 'node');
  const edges = children.filter((child) => child.name === 'edge');
  if (!nodes.length) {
    state.report('local.diagram.node', '<diagram> requires at least one <node>.', entry.node.range.start, entry.node.range.end);
  }
  for (const child of children) {
    if (child.name !== 'node' && child.name !== 'edge') {
      state.report('local.structure.children', '<diagram> can only contain <node> and <edge>.', child.node.range.start, child.node.range.end);
    }
  }
  if (meaningful(entry.node.children).some((kid) => kid.type !== 'component')) {
    state.report('local.structure.children', '<diagram> can only contain <node> and <edge>.', entry.node.range.start, entry.node.range.end);
  }

  const ids: string[] = [];
  for (const node of nodes) {
    const nodeAttrs = state.attrs.get(node.node.id) ?? {};
    const id = typeof nodeAttrs.id?.value === 'string' ? nodeAttrs.id.value : '';
    if (!id) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
      state.report('local.diagram.node', `Node ID "${id}" may only contain letters, digits, underscores and hyphens, and cannot start with a digit.`, node.node.range.start, node.node.range.end);
    }
    if (ids.includes(id)) {
      state.report('local.diagram.node', `Duplicate node ID "${id}".`, node.node.range.start, node.node.range.end);
      continue;
    }
    ids.push(id);
  }
  state.diagramNodes.set(entry.node.id, ids);

  const seen = new Set<string>();
  for (const edge of edges) {
    const edgeAttrs = state.attrs.get(edge.node.id) ?? {};
    const from = typeof edgeAttrs.from?.value === 'string' ? edgeAttrs.from.value : '';
    const to = typeof edgeAttrs.to?.value === 'string' ? edgeAttrs.to.value : '';
    const label = typeof edgeAttrs.label?.value === 'string' ? edgeAttrs.label.value : '';
    if (from && !ids.includes(from)) {
      state.report('local.diagram.edge', `Edge from references unknown node "${from}".`, edge.node.range.start, edge.node.range.end);
    }
    if (to && !ids.includes(to)) {
      state.report('local.diagram.edge', `Edge to references unknown node "${to}".`, edge.node.range.start, edge.node.range.end);
    }
    const key = `${from}\u0000${to}\u0000${label}`;
    if (seen.has(key)) {
      state.report('local.diagram.edge', `Duplicate edge: ${from} → ${to}${label ? ` (${label})` : ''}.`, edge.node.range.start, edge.node.range.end);
    }
    seen.add(key);
  }
}

function validateChecklist(entry: Entry, state: CompileState): ChecklistInfo {
  const cached = state.checklists.get(entry.node.id);
  if (cached) return cached;
  const kids = meaningful(entry.node.children);
  const lists = kids.filter((kid) => kid.type === 'list');
  if (kids.length !== 1 || lists.length !== 1) {
    state.report(
      'local.checklist.body',
      'The body of <checklist> must be exactly one single-level Markdown task list.',
      entry.node.range.start,
      entry.node.range.end,
    );
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
    state.report('local.checklist.body', '<checklist> requires at least one task list item.', list.range.start, list.range.end);
  }
  if (items.length > MAX_LOCAL_ARRAY_LENGTH) {
    state.report(
      'local.budget.array',
      `<checklist> items exceed the limit of ${MAX_LOCAL_ARRAY_LENGTH}.`,
      list.range.start,
      list.range.end,
    );
  }
  items.slice(0, MAX_LOCAL_ARRAY_LENGTH).forEach((item, index) => {
    if (item.type !== 'listItem' || item.checked === null || item.checked === undefined) {
      state.report('local.checklist.body', '<checklist> can only contain task list items (- [ ] / - [x]).', item.range.start, item.range.end);
      return;
    }
    if ((item.children ?? []).some((child) => child.type === 'list')) {
      state.report('local.checklist.body', '<checklist> does not support nested lists.', item.range.start, item.range.end);
    }
    if (hasComponent(item)) {
      state.report('local.checklist.body', '<checklist> items cannot contain interactive components.', item.range.start, item.range.end);
    }
    const id = `item-${index + 1}`;
    ids.push(id);
    if (item.checked) checked.push(id);
  });
  const info = { ids, checked };
  state.checklists.set(entry.node.id, info);
  return info;
}

/* ------------------------------------------------------------------ */
/* Bindings                                                            */
/* ------------------------------------------------------------------ */

interface GroupMember {
  entry: Entry;
  attrs: AttrMap;
}

interface Group {
  key: string;
  schema: LocalComponentSchema;
  members: GroupMember[];
}

function resolveBindings(state: CompileState): Record<string, LocalBinding> {
  const groups = new Map<string, Group>();
  for (const entry of state.entries) {
    const bindingSchema = entry.schema.binding;
    if (!bindingSchema) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const rawBind = typeof attrs.bind?.value === 'string' ? attrs.bind.value : '';
    let key = rawBind ? rawBind : `@${entry.node.id}`;
    if (attrs.bind) {
      if (rawBind.length > MAX_LOCAL_NAME_LENGTH) {
        state.report(
          'local.budget.identifier',
          `Parameter name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`,
          attrs.bind.offset ?? entry.node.range.start,
        );
        key = `@${entry.node.id}`;
      } else if (!IDENTIFIER.test(rawBind)) {
        state.report(
          'local.binding.name',
          `Parameter name "${rawBind}" must match [A-Za-z_][A-Za-z0-9_]*.`,
          attrs.bind.offset ?? entry.node.range.start,
        );
        key = `@${entry.node.id}`;
      } else if (RESERVED_NAMES.has(rawBind) || EXTRA_RESERVED.has(rawBind)) {
        state.report(
          'local.binding.reserved',
          `Parameter name "${rawBind}" is reserved; choose another name.`,
          attrs.bind.offset ?? entry.node.range.start,
        );
        key = `@${entry.node.id}`;
      }
    }
    const existing = groups.get(key);
    if (existing) existing.members.push({ entry, attrs });
    else groups.set(key, { key, schema: entry.schema, members: [{ entry, attrs }] });
  }

  const bindings: Record<string, LocalBinding> = {};
  for (const group of groups.values()) {
    const binding = resolveGroup(group, state);
    if (binding) bindings[group.key] = binding;
  }
  return bindings;
}

function bindingKinds(bindings: Record<string, LocalBinding>): Record<string, LocalValueKind> {
  const kinds: Record<string, LocalValueKind> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    if (!key.startsWith('@')) kinds[key] = binding.type;
  }
  return kinds;
}

interface NumericConstraints {
  min?: number;
  max?: number;
  step: number;
}

function numericConstraints(entry: Entry, attrs: AttrMap, family: string): NumericConstraints {
  if (family === 'timer') {
    const duration = numberValue(entry, attrs, 'duration') ?? 60;
    return { min: 0, max: duration, step: 1 };
  }
  return {
    min: numberValue(entry, attrs, 'min'),
    max: numberValue(entry, attrs, 'max'),
    step: numberValue(entry, attrs, 'step') ?? 1,
  };
}

function resolveGroup(group: Group, state: CompileState): LocalBinding | null {
  const first = group.members[0];
  const bindingSchema = first.entry.schema.binding;
  if (!bindingSchema) return null;
  const family = bindingSchema.family;

  for (const member of group.members.slice(1)) {
    const memberFamily = member.entry.schema.binding?.family;
    if (memberFamily !== family) {
      state.report(
        'local.binding.type',
        `Parameter "${group.key}" is already declared as ${typeName(bindingSchema.kind)} by <${first.entry.name}> and cannot also bind <${member.entry.name}>.`,
        member.entry.node.range.start,
        member.entry.node.range.end,
      );
    }
  }

  if (bindingSchema.exclusive && group.members.length > 1) {
    for (const member of group.members.slice(1)) {
      state.report(
        'local.binding.exclusive',
        `Parameter "${group.key}" of <${first.entry.name}> can only be owned by one component and cannot be shared with <${member.entry.name}>.`,
        member.entry.node.range.start,
        member.entry.node.range.end,
      );
    }
  }

  const options = bindingOptions(first.entry, state, family);
  let constraints: NumericConstraints | undefined;
  if (bindingSchema.kind === 'number') {
    constraints = numericConstraints(first.entry, first.attrs, family);
    for (const member of group.members.slice(1)) {
      const other = numericConstraints(member.entry, member.attrs, family);
      if (
        other.min !== constraints.min ||
        other.max !== constraints.max ||
        other.step !== constraints.step
      ) {
        state.report(
          'local.binding.constraint',
          `Parameter "${group.key}" must use the same numeric range and step: <${first.entry.name}> has ${describeConstraints(constraints)}, <${member.entry.name}> has ${describeConstraints(other)}.`,
          member.entry.node.range.start,
          member.entry.node.range.end,
        );
      }
    }
  }

  if (family === 'choice') {
    for (const member of group.members.slice(1)) {
      const other = state.options.get(member.entry.node.id) ?? [];
      if (other.join('\u0000') !== options.join('\u0000')) {
        state.report(
          'local.binding.option',
          `Parameter "${group.key}" must use the same option set in the same order.`,
          member.entry.node.range.start,
          member.entry.node.range.end,
        );
      }
    }
  }

  const explicit = group.members.filter((member) => Object.hasOwn(member.attrs, 'initial'));
  let initial: LocalValue;
  if (explicit.length > 0) {
    if (explicit.length > 1) {
      // Precompute lines once; report only a bounded sample of the conflicts.
      const conflictLines = explicit.map((member) => lineAt(state, member.attrs.initial.offset));
      const reported = Math.min(explicit.length, MAX_INITIAL_CONFLICT_DIAGNOSTICS);
      for (let index = 0; index < reported; index += 1) {
        const peers: number[] = [];
        for (let step = 1; step < conflictLines.length && peers.length < MAX_CONFLICT_PEERS; step += 1) {
          peers.push(conflictLines[(index + step) % conflictLines.length]);
        }
        state.report(
          'local.initial.duplicate',
          `Parameter "${group.key}" has multiple explicit initial values (${explicit.length} in total${peers.length ? `; see also line ${peers.join(', ')}` : ''}).`,
          explicit[index].attrs.initial.offset,
        );
      }
    }
    initial = memberInitial(explicit[0], state, family, options);
  } else {
    initial = defaultInitial(first, state, family, options, constraints);
  }

  if (family === 'checklist' && !Array.isArray(initial)) initial = [];
  if (bindingSchema.kind !== 'array') validateInitialValue(group, first, initial, family, options, constraints, state);
  if (family === 'text' || family === 'date') validateStaticInitial(group, initial, state);

  const binding: LocalBinding = {
    name: group.key,
    nodeIds: group.members.map((member) => member.entry.node.id),
    type: bindingSchema.kind,
    initial: cloneValue(initial),
    owner: first.entry.node.id,
  };
  if (constraints) {
    if (constraints.min !== undefined) binding.min = constraints.min;
    if (constraints.max !== undefined) binding.max = constraints.max;
    binding.step = constraints.step;
  }
  if (options.length) binding.options = [...options];
  return binding;
}

function describeConstraints(constraints: NumericConstraints): string {
  const min = constraints.min === undefined ? '-∞' : String(constraints.min);
  const max = constraints.max === undefined ? '∞' : String(constraints.max);
  return `[${min}, ${max}] / ${constraints.step}`;
}

function lineAt(state: CompileState, offset: number): number {
  const target = Math.max(0, Math.min(state.source.length, offset));
  let low = 0;
  let high = state.lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (state.lineStarts[middle] <= target) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/**
 * A shared string binding must satisfy every owner's static constraints.
 * Empty values stay allowed at compile time so an optional required input can
 * still start empty; writes are enforced by the runtime.
 */
function validateStaticInitial(group: Group, initial: LocalValue, state: CompileState): void {
  if (typeof initial !== 'string' || initial === '') return;
  const first = group.members[0];
  const offset = first.attrs.initial?.offset ?? first.entry.node.range.start;
  const length = initial.length;
  for (const member of group.members) {
    const { entry, attrs } = member;
    if (entry.name === 'input' || entry.name === 'textarea') {
      const minLength = numberValue(entry, attrs, 'min-length') ?? 0;
      const maxLength = numberValue(entry, attrs, 'max-length');
      if (length < minLength) {
        state.report(
          'local.initial.length',
          `Initial value of parameter "${group.key}" has length ${length}, below the minimum length ${minLength} required by <${entry.name}>.`,
          offset,
        );
      }
      if (maxLength !== undefined && length > maxLength) {
        state.report(
          'local.initial.length',
          `Initial value of parameter "${group.key}" has length ${length}, exceeding the maximum length ${maxLength} allowed by <${entry.name}>.`,
          offset,
        );
      }
      if (entry.name === 'input') {
        const type = typeof attrs.type?.value === 'string' ? attrs.type.value : 'text';
        if (type === 'email' && !isLocalEmail(initial)) {
          state.report('local.initial.email', `Initial value of parameter "${group.key}" is not a valid email address.`, offset);
        }
      }
    } else if (entry.name === 'date' && isValidDate(initial)) {
      const min = typeof attrs.min?.value === 'string' && isValidDate(attrs.min.value) ? attrs.min.value : undefined;
      const max = typeof attrs.max?.value === 'string' && isValidDate(attrs.max.value) ? attrs.max.value : undefined;
      if (min && initial < min) {
        state.report('local.initial.range', `Initial value ${initial} of parameter "${group.key}" is earlier than the minimum date ${min} of <date>.`, offset);
      }
      if (max && initial > max) {
        state.report('local.initial.range', `Initial value ${initial} of parameter "${group.key}" is later than the maximum date ${max} of <date>.`, offset);
      }
    }
  }
}

function bindingOptions(entry: Entry, state: CompileState, family: string): string[] {
  switch (family) {
    case 'choice':
      return state.options.get(entry.node.id) ?? [];
    case 'tabs':
      return state.tabs.get(entry.node.id) ?? [];
    case 'diagram':
      return state.diagramNodes.get(entry.node.id) ?? [];
    case 'checklist':
      return validateChecklist(entry, state).ids;
    default:
      return [];
  }
}

function memberInitial(
  member: GroupMember,
  state: CompileState,
  family: string,
  options: string[],
): LocalValue {
  const info = member.attrs.initial;
  if (!info) return defaultInitial(member, state, family, options, undefined);
  const entry = member.entry;
  if (family === 'number' && typeof info.value === 'number') return info.value;
  if (family === 'boolean' && typeof info.value === 'boolean') return info.value;
  if (family === 'number' || family === 'boolean') {
    state.report('local.initial.type', `Initial value of parameter "${entry.node.id}" has the wrong type.`, info.offset);
    return family === 'number' ? 0 : false;
  }
  const value = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  if (family === 'date' && !isValidDate(value)) {
    state.report('local.initial.date', `Initial date "${value}" is not a valid YYYY-MM-DD.`, info.offset);
  }
  if (family === 'choice' && options.length && !options.includes(value)) {
    state.report('local.initial.option', `Initial value "${value}" is not an available option: ${options.join(', ')}.`, info.offset);
  }
  return value;
}

function defaultInitial(
  member: GroupMember,
  state: CompileState,
  family: string,
  options: string[],
  constraints: NumericConstraints | undefined,
): LocalValue {
  const entry = member.entry;
  switch (family) {
    case 'text':
    case 'date':
      return '';
    case 'boolean':
      return false;
    case 'choice':
      return options[0] ?? '';
    case 'tabs':
    case 'diagram':
      return options[0] ?? '';
    case 'timer': {
      const local = constraints ?? numericConstraints(entry, member.attrs, family);
      return local.max ?? 60;
    }
    case 'checklist':
      return [...validateChecklist(entry, state).checked];
    case 'number': {
      const local = constraints ?? numericConstraints(entry, member.attrs, family);
      if (entry.schema.initialRule === 'min') return local.min ?? 0;
      const value = nearestZero(local.min, local.max, local.step);
      if (value === null) {
        state.report(
          'local.initial.range',
          `Parameter "${entry.node.id}" has no valid step value within range [${local.min ?? '-∞'}, ${local.max ?? '∞'}].`,
          entry.node.range.start,
          entry.node.range.end,
        );
        return 0;
      }
      return value;
    }
  }
  state.report(
    'local.initial',
    `Cannot derive a default initial value for <${entry.name}> parameter "${entry.node.id}".`,
    entry.node.range.start,
    entry.node.range.end,
  );
  return '';
}

function validateInitialValue(
  group: Group,
  first: GroupMember,
  value: LocalValue,
  family: string,
  options: string[],
  constraints: NumericConstraints | undefined,
  state: CompileState,
): void {
  const key = group.key;
  if (family === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      state.report('local.initial.type', `Initial value of parameter "${key}" must be a finite number.`, first.entry.node.range.start);
      return;
    }
    const local = constraints ?? numericConstraints(first.entry, first.attrs, family);
    if (local.min !== undefined && value < local.min) {
      state.report(
        'local.initial.range',
        `Initial value ${value} of parameter "${key}" is below the minimum ${local.min}.`,
        first.attrs.initial?.offset ?? first.entry.node.range.start,
      );
    }
    if (local.max !== undefined && value > local.max) {
      state.report(
        'local.initial.range',
        `Initial value ${value} of parameter "${key}" exceeds the maximum ${local.max}.`,
        first.attrs.initial?.offset ?? first.entry.node.range.start,
      );
    }
    const base = local.min ?? 0;
    if (value >= (local.min ?? Number.NEGATIVE_INFINITY) && value <= (local.max ?? Number.POSITIVE_INFINITY) && !onStep(value, base, local.step)) {
      state.report(
        'local.initial.step',
        `Initial value ${value} of parameter "${key}" is not on step ${local.step} (based at ${local.min ?? 0}).`,
        first.attrs.initial?.offset ?? first.entry.node.range.start,
      );
    }
    return;
  }
  if (family === 'boolean' && typeof value !== 'boolean') {
    state.report('local.initial.type', `Initial value of parameter "${key}" must be a boolean.`, first.entry.node.range.start);
  }
  if ((family === 'choice' || family === 'tabs' || family === 'diagram') && options.length && !options.includes(String(value))) {
    state.report(
      family === 'diagram' ? 'local.initial.option' : 'local.initial.option',
      `Initial value "${String(value)}" of parameter "${key}" is not among the available values ${options.join(', ')}.`,
      first.attrs.initial?.offset ?? first.entry.node.range.start,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Expression validation                                               */
/* ------------------------------------------------------------------ */

function validateExpressions(state: CompileState): void {
  const env = state.bindingKinds;
  const names = Object.keys(env);

  const expressionError = (error: unknown, base: number): void => {
    if (error instanceof LocalExpressionError) {
      state.report(
        `local.expression.${error.code || 'invalid'}`,
        `Expression error: ${error.message}`,
        base + (Number.isFinite(error.offset) ? error.offset : 0),
      );
      return;
    }
    state.report(
      'local.expression.invalid',
      `Expression error: ${error instanceof Error ? error.message : String(error)}`,
      base,
    );
  };

  const validate = (
    expression: string,
    base: number,
    expected: 'text' | 'number' | 'boolean' | 'string',
  ): LocalValueKind | null => {
    if (!expression.trim()) {
      state.report('local.expression.empty', 'Interpolation expression cannot be empty.', base);
      return null;
    }
    let compiled: LocalExpression | null = null;
    try {
      compiled = compileExpression(expression);
    } catch (error) {
      expressionError(error, base);
      return null;
    }
    if (!compiled) return null;
    let missing = false;
    for (const dependency of compiled.dependencies) {
      if (!Object.hasOwn(env, dependency)) {
        const suggestion = suggestName(dependency, names);
        state.report(
          'local.binding.unknown',
          `Reference to undeclared parameter ${dependency}.${suggestion ? ` Did you mean ${suggestion}?` : ''}`,
          base + Math.max(0, expression.indexOf(dependency)),
        );
        missing = true;
      }
    }
    if (missing) return null;
    let kind: LocalValueKind;
    try {
      kind = compiled.inferType(env);
    } catch (error) {
      expressionError(error, base);
      return null;
    }
    if (expected === 'number' && kind !== 'number') {
      state.report('local.type', `Expected a number here, but the expression evaluates to ${typeName(kind)}.`, base);
    } else if (expected === 'boolean' && kind !== 'boolean') {
      state.report('local.type', `Expected a boolean here, but the expression evaluates to ${typeName(kind)}.`, base);
    } else if (expected === 'string' && kind !== 'string') {
      state.report('local.type', `Expected a string here, but the expression evaluates to ${typeName(kind)}.`, base);
    } else if (expected === 'text' && kind === 'array') {
      state.report('local.type', 'Arrays cannot be displayed directly; convert them first with a function such as len.', base);
    }
    return kind;
  };

  const walk = (nodes: LocalNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'interpolation') {
        const raw = state.source.slice(node.range.start + 2, Math.max(node.range.start + 2, node.range.end - 2));
        const value = node.value ?? '';
        const leading = Math.max(0, raw.indexOf(value));
        const base = node.range.start + 2 + leading;
        state.expressionKinds.set(node.id, validate(value, base, 'text'));
      }
      if (node.children) walk(node.children);
    }
  };
  walk(state.nodes);

  for (const entry of state.entries) {
    const attrs = state.attrs.get(entry.node.id) ?? {};
    for (const [name, info] of Object.entries(attrs)) {
      const prop = entry.schema.props[name];
      if (!prop || prop.static) continue;
      if (prop.kind === 'string') {
        const scanned = scanInterpolations(info.raw);
        for (const offset of scanned.unterminated) {
          state.report('local.interpolation', 'Interpolation is missing }}.', info.offset + offset);
        }
        for (const segment of scanned.segments) {
          validate(segment.expression, info.offset + segment.start, 'text');
        }
        continue;
      }
      if (!info.dynamic) continue;
      if (prop.kind === 'number') {
        validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'number');
      } else if (prop.kind === 'boolean') {
        validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'boolean');
      } else if (prop.kind === 'enum') {
        validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'string');
      }
    }
    if (entry.name === 'if') {
      const when = attrs.when;
      if (when && !when.dynamic) {
        state.report(
          'local.attribute.interpolation',
          'The when attribute of if must be a full boolean interpolation, e.g. when="{{ seats >= 5 }}".',
          when.offset,
        );
      }
    }
  }
}

function suggestName(name: string, candidates: string[]): string | undefined {
  if (name.length > MAX_LOCAL_NAME_LENGTH) return undefined;
  let best: string | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const current = editDistance(name, candidate);
    if (current < distance) {
      best = candidate;
      distance = current;
    }
  }
  return distance <= 2 ? best : undefined;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[b.length];
}

/* ------------------------------------------------------------------ */
/* Plot math                                                           */
/* ------------------------------------------------------------------ */

function plotSamples(entry: Entry, attrs: AttrMap): number {
  const fallback = entry.schema.props.samples?.default;
  const base = typeof fallback === 'number' ? fallback : 200;
  return numberValue(entry, attrs, 'samples') ?? base;
}

function validatePlots(state: CompileState): void {
  const env = state.bindingKinds;
  let totalPoints = 0;
  let pointsBudgetExceeded = false;
  for (const entry of state.entries) {
    if (entry.name !== 'plot') continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const mathNodes = meaningful(entry.node.children).filter((node) => node.type === 'math');
    const samples = plotSamples(entry, attrs);
    if (mathNodes.length > MAX_LOCAL_PLOT_CURVES) {
      state.report(
        'local.budget.plot.curves',
        `<plot> supports at most ${MAX_LOCAL_PLOT_CURVES} curves, but has ${mathNodes.length}.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }
    const requested = mathNodes.length * samples;
    const nextTotal = totalPoints + requested;
    if (!pointsBudgetExceeded && nextTotal > MAX_LOCAL_PLOT_POINTS) {
      state.report(
        'local.budget.plot.points',
        `The document's total plot sample count exceeds the limit of ${MAX_LOCAL_PLOT_POINTS}.`,
        entry.node.range.start,
        entry.node.range.end,
      );
      pointsBudgetExceeded = true;
    }
    totalPoints = Math.min(MAX_LOCAL_PLOT_POINTS + 1, nextTotal);
    // Once the shapes are known to exceed budget, do not spend work compiling
    // an unbounded number of formulas. The document is already rejected.
    if (mathNodes.length > MAX_LOCAL_PLOT_CURVES || pointsBudgetExceeded) continue;
    for (const node of mathNodes) {
      const recipe = (node.value ?? '').trim();
      if (!/^y\s*=/u.test(recipe)) {
        state.report(
          'local.math.formula',
          '<plot> formulas must be written explicitly as y = expression.',
          node.range.start,
          node.range.end,
        );
        continue;
      }
      let compiled: ReturnType<typeof compileLatex> | null = null;
      try {
        compiled = compileLatex(recipe);
      } catch (error) {
        state.report(
          'local.math',
          `Cannot compute plot formula: ${error instanceof Error ? error.message : String(error)}`,
          node.range.start,
          node.range.end,
        );
      }
      if (!compiled) continue;
      for (const dependency of compiled.dependencies) {
        if (dependency === 'x' || dependency === 'y') continue;
        if (!Object.hasOwn(env, dependency)) {
          state.report(
            'local.math.binding',
            `Plot formula references undeclared parameter "${dependency}".`,
            node.range.start,
            node.range.end,
          );
        } else if (env[dependency] !== 'number') {
          state.report(
            'local.math.binding',
            `Plot parameter "${dependency}" must be a number, but is ${typeName(env[dependency])}.`,
            node.range.start,
            node.range.end,
          );
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tables, charts and timelines                                        */
/* ------------------------------------------------------------------ */

interface TableShape {
  header: string[];
  rows: LocalNode[][];
}

function tableShape(table: LocalNode, state: CompileState, component: Entry): TableShape | null {
  const rows = (table.children ?? []).filter((node) => node.type === 'tableRow');
  if (!rows.length) {
    state.report('local.table.header', `The table for <${component.name}> is missing a header.`, table.range.start, table.range.end);
    return null;
  }
  const header = rows[0].children ?? [];
  const names: string[] = [];
  for (const cell of header) {
    if (hasInterpolation(cell)) {
      state.report('local.table.header', 'Table headers cannot contain interpolations.', cell.range.start, cell.range.end);
      return null;
    }
    const text = plainText(cell).trim();
    if (!text) {
      state.report('local.table.header', 'Table headers cannot be empty.', cell.range.start, cell.range.end);
      return null;
    }
    if (names.includes(text)) {
      state.report('local.table.header', `Duplicate table header "${text}".`, cell.range.start, cell.range.end);
      return null;
    }
    names.push(text);
  }
  if (!names.length) {
    state.report('local.table.header', 'Table headers cannot be empty.', table.range.start, table.range.end);
    return null;
  }
  const dataRows: LocalNode[][] = [];
  for (const row of rows.slice(1)) {
    const cells = row.children ?? [];
    if (cells.length !== names.length) {
      state.report(
        'local.table.row',
        `Table row has a different column count: header has ${names.length} columns, this row has ${cells.length}.`,
        row.range.start,
        row.range.end,
      );
      continue;
    }
    dataRows.push(cells);
  }
  return { header: names, rows: dataRows };
}

function cellNumeric(cell: LocalNode, state: CompileState): boolean {
  const kids = meaningful(cell.children);
  if (kids.length === 1 && kids[0].type === 'interpolation') {
    const kind = state.expressionKinds.get(kids[0].id);
    if (kind === 'number' || kind === null) return true;
    if (kind !== undefined) return false;
  }
  const text = plainText(cell).trim();
  if (!text) return false;
  const value = parseNumberText(text);
  return value !== null;
}

function requireNumericColumn(
  shape: TableShape,
  column: number,
  state: CompileState,
  component: Entry,
  label: string,
): void {
  const name = shape.header[column];
  shape.rows.forEach((row, rowIndex) => {
    const cell = row[column];
    if (!cell) return;
    const kids = meaningful(cell.children);
    if (kids.length === 1 && kids[0].type === 'interpolation') {
      const kind = state.expressionKinds.get(kids[0].id);
      if (kind !== undefined && kind !== null && kind !== 'number') {
        state.report(
          'local.chart.numeric',
          `${component.name === 'timeline' ? 'Timeline' : 'Chart'} column "${name}" requires a number in row ${rowIndex + 1}, but the expression evaluates to ${typeName(kind)}.`,
          cell.range.start,
          cell.range.end,
        );
      }
      return;
    }
    if (!cellNumeric(cell, state)) {
      state.report(
        'local.chart.numeric',
        `${component.name === 'timeline' ? 'Timeline' : 'Chart'} column "${name}" requires a plain number in row ${rowIndex + 1}, got "${plainText(cell).trim() || 'empty'}".`,
        cell.range.start,
        cell.range.end,
      );
    }
  });
  void label;
}

function columnIndex(header: string[], name: string): number {
  return header.indexOf(name);
}

function validateTables(state: CompileState): void {
  for (const entry of state.entries) {
    if (entry.name === 'table') {
      const table = state.tables.get(entry.node.id);
      if (table) tableShape(table, state, entry);
      continue;
    }
    const table = state.tables.get(entry.node.id);
    if (!table) continue;
    const shape = tableShape(table, state, entry);
    if (!shape) continue;
    if (entry.name === 'chart') validateChart(entry, shape, state);
    else if (entry.name === 'timeline') validateTimeline(entry, shape, state);
  }
}

function validateChart(entry: Entry, shape: TableShape, state: CompileState): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const kind = typeof attrs.kind?.value === 'string' ? attrs.kind.value : 'bar';
  const header = shape.header;
  for (const name of header) {
    if (name.includes(',')) {
      state.report('local.chart.column', `Chart column names cannot contain commas: "${name}".`, entry.node.range.start, entry.node.range.end);
    }
  }
  const xName = typeof attrs.x?.value === 'string' ? attrs.x.value.trim() : '';
  const yRaw = typeof attrs.y?.value === 'string' ? attrs.y.value.trim() : '';
  if (xName && columnIndex(header, xName) < 0) {
    state.report('local.chart.column', `Chart x column "${xName}" does not exist.`, attrs.x?.offset ?? entry.node.range.start);
  }
  let yNames: string[] = [];
  if (yRaw) {
    yNames = yRaw.split(',').map((name) => name.trim()).filter(Boolean);
    if (!yNames.length) {
      state.report('local.chart.column', 'Chart y requires a column name.', attrs.y?.offset ?? entry.node.range.start);
    }
    for (const name of yNames) {
      if (columnIndex(header, name) < 0) {
        state.report('local.chart.column', `Chart y column "${name}" does not exist.`, attrs.y?.offset ?? entry.node.range.start);
      }
    }
  }

  let numeric: number[] = [];
  if (kind === 'bar' || kind === 'line' || kind === 'area') {
    const xColumn = xName ? Math.max(0, columnIndex(header, xName)) : 0;
    numeric = yNames.length
      ? yNames.map((name) => columnIndex(header, name)).filter((index) => index >= 0)
      : header.map((_, index) => index).filter((index) => index !== xColumn);
    if (!numeric.length) {
      state.report('local.chart.column', 'Chart requires at least one numeric column.', entry.node.range.start, entry.node.range.end);
    }
  } else if (kind === 'scatter') {
    const xColumn = xName ? columnIndex(header, xName) : 0;
    if (xColumn < 0) {
      state.report('local.chart.column', `Scatter chart x column "${xName}" does not exist.`, entry.node.range.start);
    } else {
      requireNumericColumn(shape, xColumn, state, entry, 'x');
    }
    numeric = yNames.length
      ? yNames.map((name) => columnIndex(header, name)).filter((index) => index >= 0)
      : header.map((_, index) => index).filter((index) => index !== xColumn);
    if (!numeric.length) {
      state.report('local.chart.column', 'Scatter chart requires at least one numeric column.', entry.node.range.start, entry.node.range.end);
    }
  } else if (kind === 'donut') {
    if (header.length < 2) {
      state.report('local.chart.column', 'Donut chart requires a label column and a value column.', entry.node.range.start, entry.node.range.end);
      return;
    }
    if (yNames.length === 1) {
      const index = columnIndex(header, yNames[0]);
      if (index >= 0) numeric = [index];
    } else if (yNames.length > 1) {
      state.report('local.chart.column', 'Donut chart y can only specify one numeric column.', attrs.y?.offset ?? entry.node.range.start);
    } else if (header.length > 2) {
      state.report('local.chart.column', 'A donut chart with more than two columns must use y to specify the single numeric column.', entry.node.range.start, entry.node.range.end);
    } else {
      numeric = [1];
    }
  }

  numeric = [...new Set(numeric)];
  for (const column of numeric) requireNumericColumn(shape, column, state, entry, 'y');
  if (kind === 'donut') {
    for (const column of numeric) {
      shape.rows.forEach((row, rowIndex) => {
        const cell = row[column];
        if (!cell) return;
        const kids = meaningful(cell.children);
        if (kids.length) return;
        const value = parseNumberText(plainText(cell).trim());
        if (value !== null && value < 0) {
          state.report(
            'local.chart.negative',
            `Donut chart values cannot be negative; row ${rowIndex + 1} is ${value}.`,
            cell.range.start,
            cell.range.end,
          );
        }
      });
    }
  }
}

function validateTimeline(entry: Entry, shape: TableShape, state: CompileState): void {
  const headerSets = [
    { title: 'Task', start: 'Start', duration: 'Duration', notes: 'Notes' },
    { title: '事项', start: '开始', duration: '时长', notes: '说明' },
  ];
  const headers = headerSets.find((set) =>
    shape.header.includes(set.title) && shape.header.includes(set.start) && shape.header.includes(set.duration),
  );
  if (!headers) {
    state.report(
      'local.timeline.header',
      'Timeline requires either Task, Start and Duration columns or 事项, 开始 and 时长 columns, with optional Notes or 说明.',
      entry.node.range.start,
      entry.node.range.end,
    );
    return;
  }
  const allowed = new Set(Object.values(headers));
  for (const name of shape.header) {
    if (!allowed.has(name)) {
      state.report('local.timeline.header', `Timeline does not support column "${name}".`, entry.node.range.start, entry.node.range.end);
    }
  }
  for (const name of [headers.start, headers.duration]) {
    const column = columnIndex(shape.header, name);
    if (column >= 0) requireNumericColumn(shape, column, state, entry, name);
  }
  const startColumn = columnIndex(shape.header, headers.start);
  const durationColumn = columnIndex(shape.header, headers.duration);
  shape.rows.forEach((row, rowIndex) => {
    for (const column of [startColumn, durationColumn]) {
      if (column < 0) continue;
      const cell = row[column];
      if (!cell) continue;
      if (meaningful(cell.children).length) continue;
      const value = parseNumberText(plainText(cell).trim());
      if (value !== null && value < 0) {
        state.report(
          'local.timeline.value',
          `Timeline column "${shape.header[column]}" cannot be negative in row ${rowIndex + 1}.`,
          cell.range.start,
          cell.range.end,
        );
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Top-level entry point used by validateExpressions                   */
/* ------------------------------------------------------------------ */

export function compileLocalDocument(source: string, options?: LocalCompileOptions): LocalCompileResult {
  return compileLocal(source, options);
}
