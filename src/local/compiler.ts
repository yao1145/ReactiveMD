import type { Diagnostic } from './types';
import { isLocalColor } from './colors';
import { localDateTimestamp } from './dates';

import { localDiagnosticDetails, type LocalDiagnosticDetails } from './diagnostics';
import { countLocalCodePoints } from './text-length';
import { attachNodeDependencies } from './dependencies';
import { compileExpression, LocalExpressionError, RESERVED_NAMES, type LocalExpression } from './expression';
import {
  resolveComputationGraph,
  type ComputationInput,
} from './computations';
import { createHeadingAnchors } from './heading-anchors';
import { compileLatex } from './math';
import { parseLocal } from './parser';
import { LOCAL_SYNTAX_VERSION } from './version';
import { DEFAULT_LOCAL_THEME } from './theme';
import {
  isLocalEmail,
  DEFAULT_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_DATA_DOCUMENT_CELLS,
  MAX_LOCAL_DATA_DOCUMENT_ROWS,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_DOCUMENT_LENGTH,
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_DIAGNOSTIC_LENGTH,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_STRING_LENGTH,
  MAX_LOCAL_VALIDATIONS,
} from './limits';
import {
  getLocalComponent,
  suggestAttribute,
  suggestComponent,
  type LocalComponentSchema,
  type LocalPropSchema,
} from './schema';
import { parseValidationFields } from './validation';
import { readLocalCompileOptions, type LocalOptionCheck } from './options';
import { sanitizeLocalHtmlDocument } from './html';
import type {
  LocalBinding,
  LocalCompileOptions,
  LocalCompileResult,
  LocalComputation,
  LocalDocument,
  LocalHostComponentSchema,
  LocalHostPropSchema,
  LocalNode,
  LocalValidation,
  LocalValue,
  LocalValueKind,
} from './types';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
  return value === '' || localDateTimestamp(value) !== null;
}

function cloneValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? value.slice() : value;
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
    case 'number-array':
      return 'number-array';
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
  diagnostics: Diagnostic[];
  report: (
    code: string,
    message: string,
    start: number,
    end?: number,
    details?: LocalDiagnosticDetails,
  ) => void;
  entries: Entry[];
  attrs: Map<string, AttrMap>;
  options: Map<string, string[]>;
  tabs: Map<string, string[]>;
  steps: Map<string, string[]>;
  selections: Map<string, string[]>;
  diagramNodes: Map<string, string[]>;
  checklists: Map<string, ChecklistInfo>;
  tables: Map<string, LocalNode>;
  tableShapes: Map<string, TableShape | null>;
  bindingSlots: Record<string, Record<string, string>>;
  bindingKinds: Record<string, LocalValueKind>;
  computationKinds: Record<string, LocalValueKind>;
  computations: Record<string, LocalComputation>;
  expressionKinds: Map<string, LocalValueKind | null>;
}

/**
 * Whole-document native HTML branch. The Markdown parser, components,
 * expressions, computations and bindings are all bypassed; the source only
 * becomes grammar-aware sanitized HTML for an isolated `srcdoc` iframe.
 */
function compileHtmlLocal(source: string, check: Extract<LocalOptionCheck, { ok: true }>): LocalCompileResult {
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    return {
      ok: false,
      diagnostics: [{
        code: typeof source === 'string' ? 'local.budget' : 'local.parse',
        message: typeof source === 'string'
          ? `Document exceeds the ${MAX_LOCAL_DOCUMENT_LENGTH}-character limit.`
          : 'Document source must be a string.',
        severity: 'error',
        range: { start: 0, end: typeof source === 'string' && source.length ? 1 : 0 },
        line: 1,
        column: 1,
        messageKey: typeof source === 'string' ? 'local.budget.document' : 'local.parse.source',
        ...(typeof source === 'string' ? { params: { limit: MAX_LOCAL_DOCUMENT_LENGTH } } : {}),
      }],
    };
  }

  const sanitized = sanitizeLocalHtmlDocument(source, check.html, check.maxSyntaxNodes);
  if (sanitized.diagnostics.some((item) => item.severity === 'error')) {
    return { ok: false, diagnostics: sanitized.diagnostics };
  }

  const document: LocalDocument = {
    syntax: 'local',
    source,
    syntaxVersion: LOCAL_SYNTAX_VERSION,
    html: check.html,
    nodes: [{
      type: 'htmlDocument',
      id: 'local-0',
      range: { start: 0, end: source.length },
      // Complete sanitized document, including the trusted head and CSP.
      value: sanitized.markup,
    }],
    initialState: {},
    bindings: {},
  };
  return { ok: true, document, diagnostics: sanitized.diagnostics };
}

export function compileLocal(source: string, options?: LocalCompileOptions): LocalCompileResult {
  const optionCheck = readLocalCompileOptions(options);
  if (!optionCheck.ok) {
    return {
      ok: false,
      diagnostics: [{
        code: 'local.options.invalid',
        message: optionCheck.message,
        severity: 'error',
        range: { start: 0, end: 0 },
        line: 1,
        column: 1,
        messageKey: optionCheck.key,
      }],
    };
  }
  if (optionCheck.htmlActive) return compileHtmlLocal(source, optionCheck);
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    return { ok: false, diagnostics: parseLocal(source, options).diagnostics };
  }
  const diagnostics: Diagnostic[] = [];
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  const report = (
    code: string,
    message: string,
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
  ) => {
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
    const bounded = localDiagnosticDetails(details?.key ?? code, details?.params);
    diagnostics.push({
      code,
      message: message.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
        ? `${message.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
        : message,
      severity: 'error',
      range: { start: safeStart, end: safeEnd },
      line: low + 1,
      column: safeStart - lineStarts[low] + 1,
      messageKey: bounded.key,
      ...(bounded.params ? { params: bounded.params } : {}),
    });
  };

  let parsed: ReturnType<typeof parseLocal>;
  try {
    parsed = parseLocal(source, options);
  } catch (error) {
    report('local.parse', `Cannot parse document: ${error instanceof Error ? error.message : String(error)}`, 0, undefined, {
      key: 'local.parse.document',
      params: { detail: error instanceof Error ? error.message : String(error) },
    });
    return { ok: false, diagnostics };
  }
  diagnostics.push(...parsed.diagnostics);
  // Never evaluate const declarations or construct an executable document
  // after an explicit syntax-version mismatch or malformed version header.
  if (diagnostics.some(item => item.severity === 'error' && item.code.startsWith('local.version.'))) {
    return { ok: false, diagnostics: diagnostics.filter(item => item.code.startsWith('local.version.')) };
  }

  // A fenced `reactive-md` block keeps the legacy configuration language name
  // (state/actions/data/computed). Ordinary markdown/text code fences stay
  // literal and are not diagnosed.
  for (const code of collectLegacyFences(parsed.nodes)) {
    report(
      'local.legacy',
      'Legacy reactive-md configuration fences (state/data/computed/actions, etc.) are not part of the local interaction syntax; select legacy mode explicitly in the host.',
      code.range.start,
      code.range.end,
      { key: 'local.legacy' },
    );
  }

  const state: CompileState = {
    source,
    lineStarts,
    nodes: parsed.nodes,
    diagnostics,
    report,
    entries: [],
    attrs: new Map(),
    options: new Map(),
    tabs: new Map(),
    steps: new Map(),
    selections: new Map(),
    diagramNodes: new Map(),
    checklists: new Map(),
    tables: new Map(),
    tableShapes: new Map(),
    bindingSlots: Object.create(null),
    bindingKinds: {},
    computationKinds: {},
    computations: {},
    expressionKinds: new Map(),
  };

  collectEntries(parsed.nodes, null, state.entries, state);
  for (const entry of state.entries) {
    state.attrs.set(entry.node.id, validateAttributes(entry, state));
    validateAttributeRelations(entry, state);
  }
  for (const entry of state.entries) validateChildren(entry, state);
  computeSelections(state);

  const bindings = resolveBindings(state);
  state.bindingKinds = bindingKinds(bindings);

  resolveComputations(state);

  validateExpressions(state);
  validateDataTables(state);
  const validations = validateValidations(state);
  validatePlots(state);
  validateTables(state);

  const initialState: Record<string, LocalValue> = {};
  for (const [key, binding] of Object.entries(bindings)) initialState[key] = cloneValue(binding.initial);
  validateNavigation(state, bindings, initialState);
  validateHostComponents(parsed.nodes, optionCheck.hostByName, state);

  diagnostics.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError) return { ok: false, diagnostics };

  const bindingSlots = slotMap(state);
  const computationNames = Object.keys(state.computations);
  const document: LocalDocument = {
    syntax: 'local',
    source,
    syntaxVersion: LOCAL_SYNTAX_VERSION,
    ...(parsed.versionDeclaration ? { versionDeclaration: parsed.versionDeclaration } : {}),
    nodes: stripComputationNodes(parsed.nodes),
    initialState,
    bindings,
    theme: parsed.theme ?? DEFAULT_LOCAL_THEME.name,
    ...(parsed.themeRange ? { themeRange: parsed.themeRange } : {}),
    ...(bindingSlots ? { bindingSlots } : {}),
    ...(computationNames.length ? { computations: state.computations } : {}),
    ...(validations.length ? { validations } : {}),
  };
  attachNodeDependencies(document);
  attachTableShapes(document, state.tableShapes);
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
          {
            key: suggestion ? 'local.component.unknown.suggestion' : 'local.component.unknown',
            params: suggestion ? { name: node.name, suggestion } : { name: node.name },
          },
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

function attributeOffset(state: CompileState, node: LocalNode, name: string): number {
  if (name.length > MAX_LOCAL_NAME_LENGTH) return node.range.start;
  const text = openingTag(state.source, node.range.start, node.range.end);
  const pattern = new RegExp(`(?:^|[\\s"'/])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|=|/|>)`);
  const match = pattern.exec(text);
  return match ? node.range.start + match.index + (match[0].length - name.length) : node.range.start;
}

function validateAttributes(entry: Entry, state: CompileState): AttrMap {
  const attrs: AttrMap = {};
  const rawAttrs = entry.node.attrs ?? {};
  for (const [name, raw] of Object.entries(rawAttrs)) {
    const prop = entry.schema.props[name];
    const offset = attributeOffset(state, entry.node, name);
    if (!prop) {
      const suggestion = name.length <= MAX_LOCAL_NAME_LENGTH ? suggestAttribute(entry.schema, name) : undefined;
      state.report(
        'local.attribute.unknown',
        `Component <${entry.name}> does not support attribute ${name}.${suggestion ? ` Did you mean ${suggestion}?` : ''}`,
        offset,
        offset + name.length,
        {
          key: suggestion ? 'local.attribute.unknown.suggestion' : 'local.attribute.unknown',
          params: suggestion ? { component: entry.name, name, suggestion } : { component: entry.name, name },
        },
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
        { key: 'local.budget.attribute', params: { name, component: entry.name, limit: MAX_LOCAL_STRING_LENGTH } },
      );
      info.raw = raw.slice(0, MAX_LOCAL_STRING_LENGTH);
    }
    validatePropValue(entry, name, prop, info, state);
    if (prop.color) {
      const scanned = scanInterpolations(info.raw);
      if (!scanned.segments.length && !scanned.unterminated.length && !isLocalColor(info.raw)) {
        state.report(
          'local.attribute.color',
          `Attribute ${name} on component <${entry.name}> must be a standard CSS named color or #RGB/#RRGGBB, got "${info.raw}".`,
          offset,
          offset + name.length,
          { key: 'local.attribute.color', params: { name, component: entry.name, value: info.raw } },
        );
      }
    }
    attrs[name] = info;
  }
  for (const [name, prop] of Object.entries(entry.schema.props)) {
    if (prop.required && !Object.hasOwn(attrs, name)) {
      state.report(
        'local.attribute.required',
        `Component <${entry.name}> is missing required attribute ${name}.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.attribute.required', params: { component: entry.name, name } },
      );
    }
  }
  if (entry.schema.label === 'required') {
    if (!Object.hasOwn(attrs, 'label')) {
      state.report('local.label.required', `Component <${entry.name}> requires a label.`, entry.node.range.start, entry.node.range.end, { key: 'local.label.required.missing', params: { component: entry.name } });
    } else if (!String(attrs.label.raw).trim()) {
      state.report('local.label.required', `Component <${entry.name}> label cannot be empty.`, attrs.label.offset, undefined, { key: 'local.label.required.empty', params: { component: entry.name } });
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
          { key: 'local.attribute.static', params: { name } },
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
        state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset, undefined, { key: 'local.expression.empty.attribute', params: { name } });
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
        { key: prop.dynamic ? 'local.attribute.type.number-interpolation' : 'local.attribute.type.number', params: { name, value: info.raw } },
      );
      return;
    }
    if (prop.integer && !Number.isInteger(value)) {
      state.report('local.attribute.type', `Attribute ${name} requires an integer.`, info.offset, undefined, { key: 'local.attribute.type.integer', params: { name } });
    }
    if (prop.positive && !(value > 0)) {
      state.report('local.attribute.type', `Attribute ${name} requires a positive number.`, info.offset, undefined, { key: 'local.attribute.type.positive', params: { name } });
    }
    if (prop.min !== undefined && value < prop.min) {
      state.report('local.attribute.range', `Attribute ${name} must be at least ${prop.min}.`, info.offset, undefined, { key: 'local.attribute.range.min', params: { name, min: prop.min } });
    }
    if (prop.max !== undefined && value > prop.max) {
      state.report('local.attribute.range', `Attribute ${name} must be at most ${prop.max}.`, info.offset, undefined, { key: 'local.attribute.range.max', params: { name, max: prop.max } });
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
        state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset, undefined, { key: 'local.expression.empty.attribute', params: { name } });
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
      { key: prop.dynamic ? 'local.attribute.type.boolean-interpolation' : 'local.attribute.type.boolean', params: { name } },
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
      state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset, undefined, { key: 'local.expression.empty.attribute', params: { name } });
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
      { key: 'local.attribute.type.enum', params: { name, values: values.join(' / '), value: info.raw } },
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
      report('local.constraint', `Component <${entry.name}> min cannot exceed max.`, attrs.min?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.number-min-max', params: { component: entry.name } });
    }
    if (step !== undefined && !(step > 0)) {
      report('local.constraint', `Component <${entry.name}> step must be greater than 0.`, attrs.step?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.number-step', params: { component: entry.name } });
    }
  }

  if (entry.name === 'input' || entry.name === 'textarea') {
    const minimum = numberValue(entry, attrs, 'min-length') ?? 0;
    const maximum = numberValue(entry, attrs, 'max-length');
    if (maximum !== undefined && maximum < minimum) {
      report('local.constraint', 'max-length cannot be less than min-length.', attrs['max-length']?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.length-order' });
    }
  }

  if (entry.name === 'date') {
    const min = typeof attrs.min?.value === 'string' ? attrs.min.value : undefined;
    const max = typeof attrs.max?.value === 'string' ? attrs.max.value : undefined;
    if (min !== undefined && !isValidDate(min)) {
      report('local.attribute.type', `Date lower bound ${min} is not a valid YYYY-MM-DD.`, attrs.min?.offset ?? entry.node.range.start, undefined, { key: 'local.attribute.type.date-lower', params: { value: min } });
    }
    if (max !== undefined && !isValidDate(max)) {
      report('local.attribute.type', `Date upper bound ${max} is not a valid YYYY-MM-DD.`, attrs.max?.offset ?? entry.node.range.start, undefined, { key: 'local.attribute.type.date-upper', params: { value: max } });
    }
    if (min && max && min > max) {
      report('local.constraint', 'Date min cannot be later than max.', attrs.min?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.date-order' });
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
          undefined,
          { key: 'local.constraint.progress-range', params: { max, value: value.value } },
        );
      }
    }
  }

  if (entry.name === 'plot') {
    const min = numberValue(entry, attrs, 'min');
    const max = numberValue(entry, attrs, 'max');
    if (min !== undefined && max !== undefined && !(min < max)) {
      report('local.constraint', 'plot min must be less than max.', attrs.min?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.plot-range' });
    }
  }

  if (entry.name === 'timer') {
    const duration = numberValue(entry, attrs, 'duration') ?? 60;
    if (!Number.isInteger(duration) || duration <= 0) {
      report('local.constraint', 'timer duration must be a positive whole number of seconds.', attrs.duration?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.timer-duration' });
    }
  }

  if (entry.name === 'range-slider') {
    const min = numberValue(entry, attrs, 'min') ?? 0;
    const max = numberValue(entry, attrs, 'max') ?? 100;
    const step = numberValue(entry, attrs, 'step') ?? 1;
    if (!(min <= max)) {
      report('local.constraint', 'range-slider min cannot exceed max.', attrs.min?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.range-slider-min-max' });
    }
    if (!(step > 0) || !Number.isFinite(step)) {
      report('local.constraint', 'range-slider step must be a finite positive number.', attrs.step?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.range-slider-step' });
    }
  }

  if (entry.name === 'coordinate') {
    for (const axis of ['x', 'y'] as const) {
      const min = numberValue(entry, attrs, `${axis}-min`) ?? -5;
      const max = numberValue(entry, attrs, `${axis}-max`) ?? 5;
      if (!(min <= max)) {
        report('local.constraint', `coordinate ${axis}-min cannot exceed ${axis}-max.`, attrs[`${axis}-min`]?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.coordinate-axis', params: { axis } });
      }
    }
    const step = numberValue(entry, attrs, 'step') ?? 1;
    if (!(step > 0) || !Number.isFinite(step)) {
      report('local.constraint', 'coordinate step must be a finite positive number.', attrs.step?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.coordinate-step' });
    }
  }

  if (entry.name === 'multi-select') {
    const maxSelected = numberValue(entry, attrs, 'max-selected');
    if (maxSelected !== undefined && (!Number.isInteger(maxSelected) || maxSelected < 0)) {
      report('local.constraint', 'multi-select max-selected must be a nonnegative whole number.', attrs['max-selected']?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.multi-select' });
    }
  }

  if (entry.name === 'table' || entry.name === 'chart') {
    if (!Object.hasOwn(attrs, 'key')) {
      for (const name of ['bind', 'initial']) {
        if (Object.hasOwn(attrs, name)) {
          report(
            'local.selection.key',
            `<${entry.name}> ${name} requires a key attribute naming the selection column.`,
            attrs[name].offset,
            undefined,
            { key: 'local.selection.key.required', params: { component: entry.name, name } },
          );
        }
      }
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
        { key: 'local.structure.parent', params: { name: entry.name, parents: entry.schema.parent.map((name) => `<${name}>`).join(' / ') } },
      );
    }
  }

  switch (rule) {
    case 'none':
      if (kids.length) {
        report('local.structure.children', `<${entry.name}> does not accept body content.`, kids[0].range.start, kids[0].range.end, { key: 'local.structure.no-body', params: { name: entry.name } });
      }
      break;
    case 'inline':
      if (entry.name === 'text' || entry.name === 'jump') {
        const inlineTypes = new Set(['text', 'emphasis', 'strong', 'delete', 'underline', 'mark', 'link', 'image', 'inlineCode', 'inlineMath', 'interpolation', 'break', 'comment', 'fallback', 'footnoteReference']);
        const isInline = (node: LocalNode): boolean => inlineTypes.has(node.type) && (node.children ?? []).every(isInline);
        const body = kids.length === 1 && kids[0].type === 'paragraph' ? kids[0].children ?? [] : kids;
        if (!body.every(isInline)) {
          report('local.structure.children', `<${entry.name}> only accepts inline Markdown.`, entry.node.range.start, entry.node.range.end, { key: 'local.structure.inline-only', params: { name: entry.name } });
        }
      }
      for (const child of kids) {
        if (hasComponent(child)) {
          report('local.structure.children', `The body of <${entry.name}> cannot contain other interactive components.`, child.range.start, child.range.end, { key: 'local.structure.no-nested-components', params: { name: entry.name } });
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
        report('local.structure.children', '<accordion> requires at least one <disclosure>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.accordion.needs-disclosure' });
      }
      if (allowed.length !== children.length) {
        for (const child of children) if (child.name !== 'disclosure') report('local.structure.children', '<accordion> can only contain <disclosure>.', child.node.range.start, child.node.range.end, { key: 'local.structure.accordion.only-disclosure' });
      }
      if (kids.some((kid) => kid.type !== 'component')) {
        report('local.structure.children', '<accordion> can only contain <disclosure>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.accordion.only-disclosure' });
      }
      break;
    }
    case 'cards': {
      const children = componentChildren(entry);
      const allowed = children.filter((child) => child.name === 'card');
      if (!allowed.length) {
        report('local.structure.children', '<grid> requires at least one <card>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.grid.needs-card' });
      }
      if (allowed.length !== children.length) {
        for (const child of children) if (child.name !== 'card') report('local.structure.children', 'Direct children of <grid> must be <card>.', child.node.range.start, child.node.range.end, { key: 'local.structure.grid.only-card' });
      }
      if (kids.some((kid) => kid.type !== 'component')) {
        report('local.structure.children', 'Direct children of <grid> must be <card>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.grid.only-card' });
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
          { key: 'local.structure.table.single', params: { name: entry.name } },
        );
      }
      if (tables.length) state.tables.set(entry.node.id, tables[0]);
      else if (entry.name === 'table' && kids.length === 1) state.tables.set(entry.node.id, kids[0]);
      break;
    }
    case 'plot': {
      const mathNodes = kids.filter((kid) => kid.type === 'math');
      if (!mathNodes.length) {
        report('local.structure.children', '<plot> requires at least one $$...$$ formula block.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.plot.needs-formula' });
      }
      for (const kid of kids) {
        if (kid.type !== 'math') {
          report('local.structure.children', 'The body of <plot> can only contain blank lines and $$...$$ formula blocks.', kid.range.start, kid.range.end, { key: 'local.structure.plot.only-formulas' });
        }
      }
      break;
    }
    case 'steps':
      validateSteps(entry, state);
      break;
    case 'quiz':
      validateQuiz(entry, state, attrs);
      break;
    case 'columns': {
      const children = componentChildren(entry);
      const columns = children.filter((child) => child.name === 'column');
      if (!columns.length) {
        report('local.structure.children', '<data-table> requires at least one <column>.', entry.node.range.start, entry.node.range.end);
      }
      if (columns.length > MAX_LOCAL_DATA_TABLE_COLUMNS) {
        report(
          'local.budget.data-table.columns',
          `<data-table> supports at most ${MAX_LOCAL_DATA_TABLE_COLUMNS} columns, but has ${columns.length}.`,
          entry.node.range.start,
          entry.node.range.end,
        );
      }
      for (const child of children) {
        if (child.name !== 'column') {
          report('local.structure.children', '<data-table> can only contain <column>.', child.node.range.start, child.node.range.end);
        }
      }
      if (kids.some((kid) => kid.type !== 'component')) {
        report('local.structure.children', '<data-table> can only contain <column>.', entry.node.range.start, entry.node.range.end);
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
          { key: 'local.structure.node.no-components' },
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
      { key: 'local.structure.options.needed', params: { name: entry.name } },
    );
  }
  for (const child of children) {
    if (child.name !== 'option') {
      state.report('local.structure.children', `<${entry.name}> can only contain <option>.`, child.node.range.start, child.node.range.end, { key: 'local.structure.options.only', params: { name: entry.name } });
    }
  }
  if (meaningful(entry.node.children).some((kid) => kid.type !== 'component')) {
    state.report('local.structure.children', `<${entry.name}> can only contain <option>.`, entry.node.range.start, entry.node.range.end, { key: 'local.structure.options.only', params: { name: entry.name } });
  }
  if (options.length > MAX_LOCAL_ARRAY_LENGTH) {
    state.report(
      'local.budget.array',
      `<${entry.name}> options exceed the limit of ${MAX_LOCAL_ARRAY_LENGTH}.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: 'local.budget.array.options', params: { name: entry.name, limit: MAX_LOCAL_ARRAY_LENGTH } },
    );
  }
  const values: string[] = [];
  for (const option of options) {
    const optionAttrs = state.attrs.get(option.node.id) ?? {};
    const value = typeof optionAttrs.value?.value === 'string' ? optionAttrs.value.value : '';
    if (!value) {
      state.report('local.option.value', '<option> requires a non-empty value.', option.node.range.start, option.node.range.end, { key: 'local.option.value.required' });
      continue;
    }
    if (entry.name === 'multi-select' && value.includes(',')) {
      state.report(
        'local.option.value',
        `<multi-select> option values cannot contain commas: "${value}".`,
        option.node.range.start,
        option.node.range.end,
        { key: 'local.option.value.comma', params: { value } },
      );
      continue;
    }
    if (values.includes(value)) {
      state.report('local.option.value', `Option values in <${entry.name}> must be unique; duplicate value "${value}".`, option.node.range.start, option.node.range.end, { key: 'local.option.value.duplicate', params: { name: entry.name, value } });
      continue;
    }
    if ((option.node.children ?? []).some(hasComponent)) {
      state.report('local.structure.children', 'The body of <option> cannot contain interactive components.', option.node.range.start, option.node.range.end, { key: 'local.structure.option.no-components' });
    }
    values.push(value);
  }
  state.options.set(entry.node.id, values);
}

function validateTabs(entry: Entry, state: CompileState): void {
  const children = componentChildren(entry);
  const tabs = children.filter((child) => child.name === 'tab');
  if (!tabs.length) {
    state.report('local.structure.children', '<tabs> requires at least one <tab>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.tabs.needs-tab' });
  }
  for (const child of children) {
    if (child.name !== 'tab') {
      state.report('local.structure.children', '<tabs> can only contain <tab>.', child.node.range.start, child.node.range.end, { key: 'local.structure.tabs.only-tab' });
    }
  }
  if (meaningful(entry.node.children).some((kid) => kid.type !== 'component')) {
    state.report('local.structure.children', '<tabs> can only contain <tab>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.tabs.only-tab' });
  }
  const values: string[] = [];
  tabs.forEach((tab, index) => {
    const tabAttrs = state.attrs.get(tab.node.id) ?? {};
    const rawValue = typeof tabAttrs.value?.value === 'string' ? tabAttrs.value.value.trim() : '';
    const value = rawValue || `tab-${index + 1}`;
    if (values.includes(value)) {
      state.report('local.tab.value', `Tab values in <tabs> must be unique; duplicate value "${value}".`, tab.node.range.start, tab.node.range.end, { key: 'local.tab.value.duplicate', params: { value } });
      return;
    }
    values.push(value);
  });
  state.tabs.set(entry.node.id, values);
}

function validateSteps(entry: Entry, state: CompileState): void {
  const children = componentChildren(entry);
  const steps = children.filter((child) => child.name === 'step');
  if (!steps.length) {
    state.report('local.structure.children', '<steps> requires at least one <step>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.steps.needs-step' });
  }
  for (const child of children) {
    if (child.name !== 'step') {
      state.report('local.structure.children', '<steps> can only contain <step>.', child.node.range.start, child.node.range.end, { key: 'local.structure.steps.only-step' });
    }
  }
  if (meaningful(entry.node.children).some((kid) => kid.type !== 'component')) {
    state.report('local.structure.children', '<steps> can only contain <step>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.steps.only-step' });
  }
  const values: string[] = [];
  steps.forEach((step, index) => {
    const stepAttrs = state.attrs.get(step.node.id) ?? {};
    const rawValue = typeof stepAttrs.value?.value === 'string' ? stepAttrs.value.value.trim() : '';
    const value = rawValue || `step-${index + 1}`;
    if (values.includes(value)) {
      state.report('local.step.value', `Step values in <steps> must be unique; duplicate value "${value}".`, step.node.range.start, step.node.range.end, { key: 'local.step.value.duplicate', params: { value } });
      return;
    }
    values.push(value);
  });
  state.steps.set(entry.node.id, values);
}

function validateQuiz(entry: Entry, state: CompileState, attrs: AttrMap): void {
  const type = typeof attrs.type?.value === 'string' ? attrs.type.value : 'choice';
  const answer = typeof attrs.answer?.value === 'string' ? attrs.answer.value : '';
  if (!answer.trim()) {
    state.report('local.quiz.answer', '<quiz> requires a non-empty answer.', attrs.answer?.offset ?? entry.node.range.start, undefined, { key: 'local.quiz.answer.required' });
  }
  if (type === 'number') {
    if (meaningful(entry.node.children).length) {
      state.report(
        'local.structure.children',
        'A numeric <quiz> cannot have body content; use type="choice" for option-based quizzes.',
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.structure.quiz.numeric-no-body' },
      );
    }
    if (answer.trim() && parseNumberText(answer) === null) {
      state.report('local.quiz.answer', 'A numeric <quiz> answer must be a finite number.', attrs.answer?.offset ?? entry.node.range.start, undefined, { key: 'local.quiz.answer.numeric' });
    }
    const tolerance = numberValue(entry, attrs, 'tolerance');
    if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance < 0)) {
      state.report('local.constraint', '<quiz> tolerance must be a nonnegative finite number.', attrs.tolerance?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.quiz-tolerance' });
    }
    return;
  }
  validateOptions(entry, state, attrs);
  const options = state.options.get(entry.node.id) ?? [];
  if (answer.trim() && options.length && !options.includes(answer)) {
    state.report(
      'local.quiz.answer',
      `<quiz> answer "${answer}" is not one of the option values: ${options.join(', ')}.`,
      attrs.answer?.offset ?? entry.node.range.start,
      undefined,
      { key: 'local.quiz.answer.not-option', params: { answer, options: options.join(', ') } },
    );
  }
}

function validateDiagram(entry: Entry, state: CompileState): void {
  const children = componentChildren(entry);
  const nodes = children.filter((child) => child.name === 'node');
  const edges = children.filter((child) => child.name === 'edge');
  if (!nodes.length) {
    state.report('local.diagram.node', '<diagram> requires at least one <node>.', entry.node.range.start, entry.node.range.end, { key: 'local.diagram.node.required' });
  }
  for (const child of children) {
    if (child.name !== 'node' && child.name !== 'edge') {
      state.report('local.structure.children', '<diagram> can only contain <node> and <edge>.', child.node.range.start, child.node.range.end, { key: 'local.structure.diagram.only' });
    }
  }
  if (meaningful(entry.node.children).some((kid) => kid.type !== 'component')) {
    state.report('local.structure.children', '<diagram> can only contain <node> and <edge>.', entry.node.range.start, entry.node.range.end, { key: 'local.structure.diagram.only' });
  }

  const ids: string[] = [];
  for (const node of nodes) {
    const nodeAttrs = state.attrs.get(node.node.id) ?? {};
    const id = typeof nodeAttrs.id?.value === 'string' ? nodeAttrs.id.value : '';
    if (!id) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
      state.report('local.diagram.node', `Node ID "${id}" may only contain letters, digits, underscores and hyphens, and cannot start with a digit.`, node.node.range.start, node.node.range.end, { key: 'local.diagram.node.invalid', params: { id } });
    }
    if (ids.includes(id)) {
      state.report('local.diagram.node', `Duplicate node ID "${id}".`, node.node.range.start, node.node.range.end, { key: 'local.diagram.node.duplicate', params: { id } });
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
      state.report('local.diagram.edge', `Edge from references unknown node "${from}".`, edge.node.range.start, edge.node.range.end, { key: 'local.diagram.edge.from', params: { id: from } });
    }
    if (to && !ids.includes(to)) {
      state.report('local.diagram.edge', `Edge to references unknown node "${to}".`, edge.node.range.start, edge.node.range.end, { key: 'local.diagram.edge.to', params: { id: to } });
    }
    const key = `${from}\u0000${to}\u0000${label}`;
    if (seen.has(key)) {
      state.report('local.diagram.edge', `Duplicate edge: ${from} → ${to}${label ? ` (${label})` : ''}.`, edge.node.range.start, edge.node.range.end, { key: 'local.diagram.edge.duplicate', params: { from, to, label: label ? ` (${label})` : '' } });
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
      { key: 'local.checklist.body.single' },
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
    state.report('local.checklist.body', '<checklist> requires at least one task list item.', list.range.start, list.range.end, { key: 'local.checklist.body.item-required' });
  }
  if (items.length > MAX_LOCAL_ARRAY_LENGTH) {
    state.report(
      'local.budget.array',
      `<checklist> items exceed the limit of ${MAX_LOCAL_ARRAY_LENGTH}.`,
      list.range.start,
      list.range.end,
      { key: 'local.checklist.body.items-limit', params: { limit: MAX_LOCAL_ARRAY_LENGTH } },
    );
  }
  items.slice(0, MAX_LOCAL_ARRAY_LENGTH).forEach((item, index) => {
    if (item.type !== 'listItem' || item.checked === null || item.checked === undefined) {
      state.report('local.checklist.body', '<checklist> can only contain task list items (- [ ] / - [x]).', item.range.start, item.range.end, { key: 'local.checklist.body.task-only' });
      return;
    }
    if ((item.children ?? []).some((child) => child.type === 'list')) {
      state.report('local.checklist.body', '<checklist> does not support nested lists.', item.range.start, item.range.end, { key: 'local.checklist.body.no-nested' });
    }
    if (hasComponent(item)) {
      state.report('local.checklist.body', '<checklist> items cannot contain interactive components.', item.range.start, item.range.end, { key: 'local.checklist.body.no-components' });
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
    // Table/chart selection only becomes a binding when the author supplies a
    // key column; existing documents keep their renderer-local selection state.
    if ((entry.name === 'table' || entry.name === 'chart') && !Object.hasOwn(attrs, 'key')) continue;
    const rawBind = typeof attrs.bind?.value === 'string' ? attrs.bind.value : '';
    let key = rawBind ? rawBind : `@${entry.node.id}`;
    if (attrs.bind) {
      if (rawBind.length > MAX_LOCAL_NAME_LENGTH) {
        state.report(
          'local.budget.identifier',
          `Parameter name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`,
          attrs.bind.offset ?? entry.node.range.start,
          undefined,
          { key: 'local.budget.identifier', params: { limit: MAX_LOCAL_NAME_LENGTH } },
        );
        key = `@${entry.node.id}`;
      } else if (!IDENTIFIER.test(rawBind)) {
        state.report(
          'local.binding.name',
          `Parameter name "${rawBind}" must match [A-Za-z_][A-Za-z0-9_]*.`,
          attrs.bind.offset ?? entry.node.range.start,
          undefined,
          { key: 'local.binding.name', params: { name: rawBind } },
        );
        key = `@${entry.node.id}`;
      } else if (RESERVED_NAMES.has(rawBind) || EXTRA_RESERVED.has(rawBind)) {
        state.report(
          'local.binding.reserved',
          `Parameter name "${rawBind}" is reserved; choose another name.`,
          attrs.bind.offset ?? entry.node.range.start,
          undefined,
          { key: 'local.binding.reserved', params: { name: rawBind } },
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
  resolveSlotBindings(state, bindings);
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
        { key: 'local.binding.type', params: { key: group.key, kind: typeName(bindingSchema.kind), first: first.entry.name, second: member.entry.name } },
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
        { key: 'local.binding.exclusive', params: { key: group.key, first: first.entry.name, second: member.entry.name } },
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
          {
            key: 'local.binding.constraint',
            params: {
              key: group.key,
              first: first.entry.name,
              second: member.entry.name,
              firstConstraints: describeConstraints(constraints),
              secondConstraints: describeConstraints(other),
            },
          },
        );
      }
    }
  }

  if (family === 'choice' || family === 'selection') {
    for (const member of group.members.slice(1)) {
      const other = bindingOptions(member.entry, state, family);
      if (other.join('\u0000') !== options.join('\u0000')) {
        state.report(
          'local.binding.option',
          `Parameter "${group.key}" must use the same option set in the same order.`,
          member.entry.node.range.start,
          member.entry.node.range.end,
          { key: 'local.binding.option', params: { key: group.key } },
        );
      }
    }
  }

  const maxSelected = family === 'multi-select' ? numberValue(first.entry, first.attrs, 'max-selected') : undefined;
  const explicit = group.members.filter((member) => Object.hasOwn(member.attrs, 'initial'));
  let initial: LocalValue;
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
        undefined,
        peers.length
          ? { key: 'local.initial.duplicate-peers', params: { key: group.key, count: explicit.length, lines: peers.join(', ') } }
          : { key: 'local.initial.duplicate', params: { key: group.key, count: explicit.length } },
      );
    }
  }
  if (family === 'multi-select') {
    initial = explicit.length
      ? multiSelectInitial(explicit[0], options, maxSelected, state)
      : [];
  } else if (explicit.length > 0) {
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
  if (family === 'multi-select') binding.maxItems = maxSelected ?? options.length;
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
  const length = countLocalCodePoints(initial);
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
          undefined,
          { key: 'local.initial.length.min', params: { key: group.key, length, min: minLength, name: entry.name } },
        );
      }
      if (maxLength !== undefined && length > maxLength) {
        state.report(
          'local.initial.length',
          `Initial value of parameter "${group.key}" has length ${length}, exceeding the maximum length ${maxLength} allowed by <${entry.name}>.`,
          offset,
          undefined,
          { key: 'local.initial.length.max', params: { key: group.key, length, max: maxLength, name: entry.name } },
        );
      }
      if (entry.name === 'input') {
        const type = typeof attrs.type?.value === 'string' ? attrs.type.value : 'text';
        if (type === 'email' && !isLocalEmail(initial)) {
          state.report('local.initial.email', `Initial value of parameter "${group.key}" is not a valid email address.`, offset, undefined, { key: 'local.initial.email', params: { key: group.key } });
        }
      }
    } else if (entry.name === 'date' && isValidDate(initial)) {
      const min = typeof attrs.min?.value === 'string' && isValidDate(attrs.min.value) ? attrs.min.value : undefined;
      const max = typeof attrs.max?.value === 'string' && isValidDate(attrs.max.value) ? attrs.max.value : undefined;
      if (min && initial < min) {
        state.report('local.initial.range', `Initial value ${initial} of parameter "${group.key}" is earlier than the minimum date ${min} of <date>.`, offset, undefined, { key: 'local.initial.date.min', params: { key: group.key, value: initial, min } });
      }
      if (max && initial > max) {
        state.report('local.initial.range', `Initial value ${initial} of parameter "${group.key}" is later than the maximum date ${max} of <date>.`, offset, undefined, { key: 'local.initial.date.max', params: { key: group.key, value: initial, max } });
      }
    }
  }
}

function bindingOptions(entry: Entry, state: CompileState, family: string): string[] {
  switch (family) {
    case 'choice':
    case 'multi-select':
      return state.options.get(entry.node.id) ?? [];
    case 'tabs':
      return state.tabs.get(entry.node.id) ?? [];
    case 'steps':
      return state.steps.get(entry.node.id) ?? [];
    case 'selection':
      return state.selections.get(entry.node.id) ?? [''];
    case 'diagram':
      return state.diagramNodes.get(entry.node.id) ?? [];
    case 'checklist':
      return validateChecklist(entry, state).ids;
    default:
      return [];
  }
}

/** Parse the comma-separated `initial` of `<multi-select>` into a set array. */
function multiSelectInitial(
  member: GroupMember,
  options: string[],
  maxSelected: number | undefined,
  state: CompileState,
): string[] {
  const info = member.attrs.initial;
  if (!info) return [];
  const raw = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  const chosen: string[] = [];
  for (const part of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!options.includes(part)) {
      state.report(
        'local.initial.option',
        `Initial value "${part}" of parameter "${member.entry.node.id}" is not an option of <multi-select>.`,
        info.offset,
        undefined,
        { key: 'local.initial.option.multi-select', params: { key: member.entry.node.id, value: part } },
      );
      continue;
    }
    if (!chosen.includes(part)) chosen.push(part);
  }
  if (maxSelected !== undefined && chosen.length > maxSelected) {
    state.report(
      'local.initial.range',
      `Initial values of <multi-select> exceed max-selected ${maxSelected}.`,
      info.offset,
      undefined,
      { key: 'local.initial.multi-select', params: { max: maxSelected } },
    );
  }
  return options.filter((value) => chosen.includes(value));
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
    state.report('local.initial.type', `Initial value of parameter "${entry.node.id}" has the wrong type.`, info.offset, undefined, { key: 'local.initial.type', params: { name: entry.node.id } });
    return family === 'number' ? 0 : false;
  }
  const value = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  if (family === 'date' && !isValidDate(value)) {
    state.report('local.initial.date', `Initial date "${value}" is not a valid YYYY-MM-DD.`, info.offset, undefined, { key: 'local.initial.date', params: { value } });
  }
  if (family === 'choice' && options.length && !options.includes(value)) {
    state.report('local.initial.option', `Initial value "${value}" is not an available option: ${options.join(', ')}.`, info.offset, undefined, { key: 'local.initial.value.option', params: { value, options: options.join(', ') } });
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
    case 'steps':
    case 'diagram':
      return options[0] ?? '';
    case 'selection':
      return '';
    case 'multi-select':
      return [];
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
          { key: 'local.initial.no-step', params: { key: entry.node.id, min: local.min ?? '-∞', max: local.max ?? '∞' } },
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
    { key: 'local.initial.cannot-derive', params: { name: entry.name, key: entry.node.id } },
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
      state.report('local.initial.type', `Initial value of parameter "${key}" must be a finite number.`, first.entry.node.range.start, undefined, { key: 'local.initial.type.number', params: { key } });
      return;
    }
    const local = constraints ?? numericConstraints(first.entry, first.attrs, family);
    if (local.min !== undefined && value < local.min) {
      state.report(
        'local.initial.range',
        `Initial value ${value} of parameter "${key}" is below the minimum ${local.min}.`,
        first.attrs.initial?.offset ?? first.entry.node.range.start,
        undefined,
        { key: 'local.initial.range.min', params: { value, key, min: local.min } },
      );
    }
    if (local.max !== undefined && value > local.max) {
      state.report(
        'local.initial.range',
        `Initial value ${value} of parameter "${key}" exceeds the maximum ${local.max}.`,
        first.attrs.initial?.offset ?? first.entry.node.range.start,
        undefined,
        { key: 'local.initial.range.max', params: { value, key, max: local.max } },
      );
    }
    const base = local.min ?? 0;
    if (value >= (local.min ?? Number.NEGATIVE_INFINITY) && value <= (local.max ?? Number.POSITIVE_INFINITY) && !onStep(value, base, local.step)) {
      state.report(
        'local.initial.step',
        `Initial value ${value} of parameter "${key}" is not on step ${local.step} (based at ${local.min ?? 0}).`,
        first.attrs.initial?.offset ?? first.entry.node.range.start,
        undefined,
        { key: 'local.initial.range.step', params: { value, key, step: local.step, base: local.min ?? 0 } },
      );
    }
    return;
  }
  if (family === 'boolean' && typeof value !== 'boolean') {
    state.report('local.initial.type', `Initial value of parameter "${key}" must be a boolean.`, first.entry.node.range.start, undefined, { key: 'local.initial.type.boolean', params: { key } });
  }
  if ((family === 'choice' || family === 'tabs' || family === 'steps' || family === 'diagram' || family === 'selection') && options.length && !options.includes(String(value))) {
    state.report(
      family === 'diagram' ? 'local.initial.option' : 'local.initial.option',
      `Initial value "${String(value)}" of parameter "${key}" is not among the available values ${options.join(', ')}.`,
      first.attrs.initial?.offset ?? first.entry.node.range.start,
      undefined,
      { key: 'local.initial.value.options', params: { value: String(value), key, options: options.join(', ') } },
    );
  }
}

/**
 * Resolve the independent, exclusive slot bindings of `<range-slider>` and
 * `<coordinate>`. Each slot registers its own binding key, so `setMany` can
 * update the slots atomically while `bindingSlots` tells the renderer which
 * slot maps to which public parameter.
 */
function resolveSlotBindings(state: CompileState, bindings: Record<string, LocalBinding>): void {
  const used = new Set(Object.keys(bindings));
  for (const entry of state.entries) {
    const slots = entry.schema.slots;
    if (!slots?.length) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const map: Record<string, string> = Object.create(null);
    const keys = new Map<string, string>();
    for (const slot of slots) {
      const bindInfo = attrs[slot.bind];
      let publicKey: string | undefined;
      if (bindInfo) {
        const raw = typeof bindInfo.value === 'string' ? bindInfo.value : '';
        if (raw.length > MAX_LOCAL_NAME_LENGTH) {
          state.report(
            'local.budget.identifier',
            `Parameter name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`,
            bindInfo.offset ?? entry.node.range.start,
            undefined,
            { key: 'local.budget.identifier', params: { limit: MAX_LOCAL_NAME_LENGTH } },
          );
        } else if (!IDENTIFIER.test(raw)) {
          state.report(
            'local.binding.name',
            `Parameter name "${raw}" must match [A-Za-z_][A-Za-z0-9_]*.`,
            bindInfo.offset ?? entry.node.range.start,
            undefined,
            { key: 'local.binding.name', params: { name: raw } },
          );
        } else if (RESERVED_NAMES.has(raw) || EXTRA_RESERVED.has(raw)) {
          state.report(
            'local.binding.reserved',
            `Parameter name "${raw}" is reserved; choose another name.`,
            bindInfo.offset ?? entry.node.range.start,
            undefined,
            { key: 'local.binding.reserved', params: { name: raw } },
          );
        } else {
          publicKey = raw;
        }
      }
      let key = publicKey ?? `@${entry.node.id}:${slot.name}`;
      if (publicKey && used.has(publicKey)) {
        state.report(
          'local.binding.exclusive',
          `Parameter "${publicKey}" of the ${slot.name} slot of <${entry.name}> is exclusive and cannot be shared with another control.`,
          bindInfo?.offset ?? entry.node.range.start,
          undefined,
          { key: 'local.binding.exclusive.slot', params: { key: publicKey, slot: slot.name, name: entry.name } },
        );
        key = `@${entry.node.id}:${slot.name}`;
      }
      used.add(key);
      const constraints = slotConstraints(entry, attrs, slot.name);
      const initial = slotInitial(entry, attrs, slot, constraints, state);
      const binding: LocalBinding = {
        name: key,
        nodeIds: [entry.node.id],
        type: slot.kind,
        initial,
        owner: entry.node.id,
      };
      if (constraints.min !== undefined) binding.min = constraints.min;
      if (constraints.max !== undefined) binding.max = constraints.max;
      binding.step = constraints.step;
      bindings[key] = binding;
      map[slot.name] = key;
      keys.set(slot.name, key);
    }
    const startKey = keys.get('start');
    const endKey = keys.get('end');
    if (startKey && endKey) {
      const start = bindings[startKey].initial;
      const end = bindings[endKey].initial;
      if (typeof start === 'number' && typeof end === 'number' && start > end) {
        state.report(
          'local.initial.range',
          `<range-slider> start ${start} cannot be greater than end ${end}.`,
          entry.node.range.start,
          entry.node.range.end,
          { key: 'local.initial.range-slider', params: { start, end } },
        );
      }
    }
    state.bindingSlots[entry.node.id] = map;
  }
}

function slotConstraints(entry: Entry, attrs: AttrMap, slot: string): NumericConstraints {
  if (entry.name === 'coordinate') {
    return {
      min: numberValue(entry, attrs, `${slot}-min`) ?? -5,
      max: numberValue(entry, attrs, `${slot}-max`) ?? 5,
      step: numberValue(entry, attrs, 'step') ?? 1,
    };
  }
  return {
    min: numberValue(entry, attrs, 'min') ?? 0,
    max: numberValue(entry, attrs, 'max') ?? 100,
    step: numberValue(entry, attrs, 'step') ?? 1,
  };
}

function slotInitial(
  entry: Entry,
  attrs: AttrMap,
  slot: { initial: string; initialRule: 'min' | 'max-step' | 'nearest-zero' },
  constraints: NumericConstraints,
  state: CompileState,
): number {
  const base = constraints.min ?? 0;
  const info = attrs[slot.initial];
  if (info && typeof info.value === 'number') {
    const value = info.value;
    if (constraints.min !== undefined && value < constraints.min) {
      state.report('local.initial.range', `Initial value ${value} of <${entry.name}> ${slot.initial} is below the minimum ${constraints.min}.`, info.offset, undefined, { key: 'local.initial.slot.min', params: { value, name: entry.name, slot: slot.initial, min: constraints.min } });
    }
    if (constraints.max !== undefined && value > constraints.max) {
      state.report('local.initial.range', `Initial value ${value} of <${entry.name}> ${slot.initial} exceeds the maximum ${constraints.max}.`, info.offset, undefined, { key: 'local.initial.slot.max', params: { value, name: entry.name, slot: slot.initial, max: constraints.max } });
    }
    if (!onStep(value, base, constraints.step)) {
      state.report('local.initial.step', `Initial value ${value} of <${entry.name}> ${slot.initial} is not on step ${constraints.step} (based at ${base}).`, info.offset, undefined, { key: 'local.initial.slot.step', params: { value, name: entry.name, slot: slot.initial, step: constraints.step, base } });
    }
    return value;
  }
  if (slot.initialRule === 'max-step') {
    const span = (constraints.max ?? base) - base;
    const index = Math.max(0, Math.floor(span / constraints.step + EPSILON));
    const value = base + index * constraints.step;
    return Math.min(constraints.max ?? value, Math.max(constraints.min ?? value, value));
  }
  if (slot.initialRule === 'min') return constraints.min ?? 0;
  return nearestZero(constraints.min, constraints.max, constraints.step) ?? 0;
}

function slotMap(state: CompileState): Record<string, Record<string, string>> | undefined {
  return Object.keys(state.bindingSlots).length ? state.bindingSlots : undefined;
}



/* ------------------------------------------------------------------ */
/* Computations                                                        */
/* ------------------------------------------------------------------ */

/** A declaration must be its own top-level source line. */
function standaloneDeclaration(state: CompileState, node: LocalNode): boolean {
  const lineStart = state.source.lastIndexOf('\n', node.range.start - 1) + 1;
  const newline = state.source.indexOf('\n', node.range.end);
  const lineEnd = newline < 0 ? state.source.length : newline;
  return (
    state.source.slice(lineStart, node.range.start).trim() === ''
    && state.source.slice(node.range.end, lineEnd).trim() === ''
  );
}

/** Absolute offset of the expression inside the declaration's value attribute. */
function declarationExpressionOffset(state: CompileState, entry: Entry, expressionStart: number): number {
  const text = openingTag(state.source, entry.node.range.start, entry.node.range.end);
  const match = /(?:^|[\s"'/])value\s*=\s*(["'])/.exec(text);
  if (!match) return entry.node.range.start;
  const valueStart = entry.node.range.start + match.index + match[0].length;
  return Math.min(entry.node.range.end, valueStart + expressionStart);
}

/**
 * Resolve top-level `<computed>` and `<const>` declarations into document
 * metadata. Namespace checks happen here because both controls and slot
 * bindings are already resolved; the graph walk and type inference live in
 * `computations.ts`.
 */
function resolveComputations(state: CompileState): void {
  const inputs: ComputationInput[] = [];
  const declared = new Map<string, 'computed' | 'const'>();
  const roots = new Set(state.nodes);
  for (const entry of state.entries) {
    if (entry.name !== 'computed' && entry.name !== 'const') continue;
    const kind: 'computed' | 'const' = entry.name;
    const node = entry.node;
    if (!roots.has(node) || !standaloneDeclaration(state, node)) {
      state.report(
        'local.computation.placement',
        `<${kind}> declarations must be standalone tags at the document top level.`,
        node.range.start,
        node.range.end,
      );
      continue;
    }
    const attrs = state.attrs.get(node.id) ?? {};
    const nameInfo = attrs.name;
    const rawName = typeof nameInfo?.value === 'string' ? nameInfo.value : '';
    if (!nameInfo || !rawName) continue;
    if (rawName.length > MAX_LOCAL_NAME_LENGTH) {
      state.report(
        'local.budget.identifier',
        `Computation name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`,
        nameInfo.offset,
      );
      continue;
    }
    if (!IDENTIFIER.test(rawName)) {
      state.report(
        'local.computation.name',
        `Computation name "${rawName}" must match [A-Za-z_][A-Za-z0-9_]*.`,
        nameInfo.offset,
      );
      continue;
    }
    if (RESERVED_NAMES.has(rawName) || EXTRA_RESERVED.has(rawName)) {
      state.report(
        'local.computation.reserved',
        `Computation name "${rawName}" is reserved; choose another name.`,
        nameInfo.offset,
      );
      continue;
    }
    if (Object.hasOwn(state.bindingKinds, rawName)) {
      state.report(
        'local.computation.duplicate',
        `Computation name "${rawName}" conflicts with a control parameter of the same name.`,
        nameInfo.offset,
      );
      continue;
    }
    if (declared.has(rawName)) {
      state.report(
        'local.computation.duplicate',
        `Computation name "${rawName}" is declared more than once.`,
        nameInfo.offset,
      );
      continue;
    }
    declared.set(rawName, kind);

    const valueInfo = attrs.value;
    if (!valueInfo) continue;
    const full = fullInterpolation(valueInfo.raw);
    if (!full) {
      state.report(
        'local.computation.value',
        `The value of <${kind}> must be exactly one {{ expression }} interpolation.`,
        valueInfo.offset,
        valueInfo.offset + valueInfo.raw.length,
      );
      continue;
    }
    if (!full.expression) {
      state.report('local.expression.empty', 'Interpolation expression cannot be empty.', valueInfo.offset);
      continue;
    }
    inputs.push({
      name: rawName,
      kind,
      source: full.expression,
      expressionOffset: declarationExpressionOffset(state, entry, full.start),
      nodeId: node.id,
      range: { ...node.range },
    });
  }

  const resolved = resolveComputationGraph(inputs, state.bindingKinds, state.report);
  state.computations = resolved.computations;
  state.computationKinds = resolved.kinds;
}

/** Environment used by ordinary expressions: writable parameters plus read-only computations. */
function expressionEnv(state: CompileState): Record<string, LocalValueKind> {
  return Object.keys(state.computationKinds).length
    ? { ...state.bindingKinds, ...state.computationKinds }
    : state.bindingKinds;
}

/** Declaration tags never reach the published tree; they are metadata only. */
function stripComputationNodes(nodes: LocalNode[]): LocalNode[] {
  const kept: LocalNode[] = [];
  for (const node of nodes) {
    if (node.type === 'component' && (node.name === 'computed' || node.name === 'const')) continue;
    if (node.children) node.children = stripComputationNodes(node.children);
    kept.push(node);
  }
  return kept;
}

function validateExpressions(state: CompileState): void {
  const env = expressionEnv(state);
  const names = Object.keys(env);

  const expressionError = (error: unknown, base: number): void => {
    if (error instanceof LocalExpressionError) {
      state.report(
        `local.expression.${error.code || 'invalid'}`,
        `Expression error: ${error.message}`,
        base + (Number.isFinite(error.offset) ? error.offset : 0),
        undefined,
        { key: 'local.expression.error', params: {
          detail: error.message, code: error.code || 'invalid',
          near: state.source.slice(Math.max(base, base + error.offset - 16), base + error.offset + 24),
        } },
      );
      return;
    }
    state.report(
      'local.expression.invalid',
      `Expression error: ${error instanceof Error ? error.message : String(error)}`,
      base,
      undefined,
      { key: 'local.expression.error', params: { detail: error instanceof Error ? error.message : String(error), code: 'invalid' } },
    );
  };

  const validate = (
    expression: string,
    base: number,
    expected: 'text' | 'number' | 'boolean' | 'string',
  ): LocalValueKind | null => {
    if (!expression.trim()) {
      state.report('local.expression.empty', 'Interpolation expression cannot be empty.', base, undefined, { key: 'local.expression.empty' });
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
          undefined,
          suggestion
            ? { key: 'local.binding.unknown.suggestion', params: { name: dependency, suggestion } }
            : { key: 'local.binding.unknown', params: { name: dependency } },
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
      state.report('local.type', `Expected a number here, but the expression evaluates to ${typeName(kind)}.`, base, undefined, { key: 'local.type.number', params: { kind: typeName(kind) } });
    } else if (expected === 'boolean' && kind !== 'boolean') {
      state.report('local.type', `Expected a boolean here, but the expression evaluates to ${typeName(kind)}.`, base, undefined, { key: 'local.type.boolean', params: { kind: typeName(kind) } });
    } else if (expected === 'string' && kind !== 'string') {
      state.report('local.type', `Expected a string here, but the expression evaluates to ${typeName(kind)}.`, base, undefined, { key: 'local.type.string', params: { kind: typeName(kind) } });
    } else if (expected === 'text' && (kind === 'array' || kind === 'number-array')) {
      state.report('local.type', 'Arrays cannot be displayed directly; convert them first with a function such as len.', base, undefined, { key: 'local.type.array' });
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
    // Declaration values are expressions, not text templates; they are
    // validated by resolveComputations with their own dependency graph.
    if (entry.name === 'computed' || entry.name === 'const') continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    for (const [name, info] of Object.entries(attrs)) {
      const prop = entry.schema.props[name];
      if (!prop || prop.static) continue;
      // Row-scoped and rule attributes have their own environment and are
      // validated by validateDataTables / validateValidations.
      if (entry.name === 'data-table' && (name === 'rows' || name === 'key')) continue;
      if (entry.name === 'column' && name === 'value') continue;
      if (entry.name === 'validation' && name === 'when') continue;
      if (prop.kind === 'string') {
        const scanned = scanInterpolations(info.raw);
        for (const offset of scanned.unterminated) {
          state.report('local.interpolation', 'Interpolation is missing }}.', info.offset + offset, undefined, { key: 'local.interpolation.unclosed' });
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
          undefined,
          { key: 'local.attribute.interpolation' },
        );
      }
    }
  }
}

/**
 * Validate static navigation targets after bindings are known: heading slugs
 * can depend on initial interpolation values, and explicit anchors must be
 * unique with each other and with heading targets.
 */
function validateNavigation(
  state: CompileState,
  bindings: Record<string, LocalBinding>,
  initialState: Record<string, LocalValue>,
): void {
  const document: LocalDocument = {
    syntax: 'local', source: state.source, nodes: state.nodes, initialState, bindings,
    ...(Object.keys(state.computations).length ? { computations: state.computations } : {}),
  };
  const namespace = '__local_core_check__';
  // Ignore explicit anchors while assigning heading slugs so collisions are
  // rejected regardless of whether the explicit anchor appears first.
  const anchors = createHeadingAnchors(document, namespace, false);
  const headingSlugs = new Set<string>();
  const visit = (nodes: LocalNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const id = anchors.ids.get(node);
        if (id && id.startsWith(`${namespace}-`)) headingSlugs.add(id.slice(namespace.length + 1));
      }
      if (node.children) visit(node.children);
    }
  };
  visit(state.nodes);

  const explicit = new Set<string>();
  for (const entry of state.entries) {
    if (entry.name !== 'anchor') continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const info = attrs.id;
    if (!info) continue;
    const id = typeof info.value === 'string' ? info.value : '';
    if (!id || !IDENTIFIER_ANCHOR.test(id)) {
      state.report(
        'local.anchor.id',
        `Anchor id "${id}" must match [A-Za-z_][A-Za-z0-9_-]*.`,
        info.offset,
        undefined,
        { key: 'local.anchor.id', params: { id } },
      );
      continue;
    }
    if (explicit.has(id)) {
      state.report('local.anchor.duplicate', `Duplicate anchor id "${id}".`, info.offset, undefined, { key: 'local.anchor.duplicate', params: { id } });
    } else {
      explicit.add(id);
    }
    if (headingSlugs.has(id)) {
      state.report(
        'local.anchor.duplicate',
        `Anchor id "${id}" collides with an automatic heading target.`,
        info.offset,
        undefined,
        { key: 'local.anchor.heading-collision', params: { id } },
      );
    }
  }

  for (const entry of state.entries) {
    if (entry.name !== 'jump') continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const info = attrs.to;
    if (!info) continue;
    const to = typeof info.value === 'string' ? info.value : '';
    if (!to) {
      state.report('local.jump.target', '<jump> target cannot be empty.', info.offset, undefined, { key: 'local.jump.empty' });
      continue;
    }
    if (to.startsWith('#') || /\s/.test(to)) {
      state.report(
        'local.jump.target',
        `<jump> target "${to}" must be a bare heading slug or anchor id without "#" or whitespace.`,
        info.offset,
        undefined,
        { key: 'local.jump.bad-target', params: { target: to } },
      );
      continue;
    }
    if (!explicit.has(to) && !headingSlugs.has(to)) {
      state.report(
        'local.jump.target',
        `<jump> target "${to}" does not resolve to a heading or explicit anchor in this document.`,
        info.offset,
        undefined,
        { key: 'local.jump.unresolved', params: { target: to } },
      );
    }
  }
}

const IDENTIFIER_ANCHOR = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/* ------------------------------------------------------------------ */
/* Cross-field rules and generated data tables                         */
/* ------------------------------------------------------------------ */

interface ScopedExpression {
  compiled: LocalExpression;
  /** Null when dependencies were missing or inference was not requested. */
  kind: LocalValueKind | null;
}

function reportExpressionError(state: CompileState, error: unknown, base: number): void {
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
}

/**
 * Compile one expression against a caller-provided type environment. Used by
 * the row scope of data tables and by validation rules; ordinary attributes
 * keep using the document environment in validateExpressions.
 */
function validateScopedExpression(
  state: CompileState,
  expression: string,
  base: number,
  env: Record<string, LocalValueKind>,
  infer: boolean,
): ScopedExpression | null {
  if (!expression.trim()) {
    state.report('local.expression.empty', 'Interpolation expression cannot be empty.', base);
    return null;
  }
  let compiled: LocalExpression;
  try {
    compiled = compileExpression(expression);
  } catch (error) {
    reportExpressionError(state, error, base);
    return null;
  }
  const names = Object.keys(env);
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
  if (missing || !infer) return { compiled, kind: null };
  let kind: LocalValueKind;
  try {
    kind = compiled.inferType(env);
  } catch (error) {
    reportExpressionError(state, error, base);
    return null;
  }
  return { compiled, kind };
}

/** Require a whole-value `{{ expression }}` attribute; returns its expression. */
function fullExpressionAttribute(
  info: AttrState | undefined,
  code: string,
  component: string,
  attribute: string,
  state: CompileState,
): { expression: string; base: number } | null {
  if (!info) return null;
  const full = fullInterpolation(info.raw);
  if (!full) {
    state.report(
      code,
      `<${component}> ${attribute} must be exactly one {{ expression }} interpolation.`,
      info.offset,
      info.offset + info.raw.length,
    );
    return null;
  }
  if (!full.expression) {
    state.report('local.expression.empty', 'Interpolation expression cannot be empty.', info.offset + full.start);
    return null;
  }
  return { expression: full.expression, base: info.offset + full.start };
}

function dataTableMaxRows(attrs: AttrMap): number {
  const info = attrs['max-rows'];
  if (
    info && !info.dynamic
    && typeof info.value === 'number'
    && Number.isInteger(info.value)
    && info.value > 0
    && info.value <= MAX_LOCAL_DATA_TABLE_ROWS
  ) return info.value;
  return DEFAULT_LOCAL_DATA_TABLE_ROWS;
}

/**
 * Validate every `<data-table>` and sum document budgets. Rows use the
 * ordinary global environment; `key` and `column.value` additionally see the
 * immutable row locals `item`/`index`, which shadow same-named globals.
 */
function validateDataTables(state: CompileState): void {
  const dataTables = state.entries.filter((entry) => entry.name === 'data-table');
  if (!dataTables.length) return;
  const env = expressionEnv(state);
  let totalRows = 0;
  let totalCells = 0;
  let rowsBudgetReported = false;
  let cellsBudgetReported = false;

  for (const entry of dataTables) {
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const columns = meaningful(entry.node.children)
      .filter((child): child is LocalNode => child.type === 'component' && child.name === 'column');
    const maxRows = dataTableMaxRows(attrs);
    const columnCount = Math.min(columns.length, MAX_LOCAL_DATA_TABLE_COLUMNS);
    totalRows += maxRows;
    totalCells += maxRows * columnCount;
    if (!rowsBudgetReported && totalRows > MAX_LOCAL_DATA_DOCUMENT_ROWS) {
      rowsBudgetReported = true;
      state.report(
        'local.budget.data-table.rows',
        `The document's generated row budget exceeds ${MAX_LOCAL_DATA_DOCUMENT_ROWS}; max-rows summed over every <data-table> must stay within it.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }
    if (!cellsBudgetReported && totalCells > MAX_LOCAL_DATA_DOCUMENT_CELLS) {
      cellsBudgetReported = true;
      state.report(
        'local.budget.data-table.cells',
        `The document's generated cell budget exceeds ${MAX_LOCAL_DATA_DOCUMENT_CELLS}; max-rows multiplied by columns, summed over every <data-table>, must stay within it.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }

    const rows = fullExpressionAttribute(attrs.rows, 'local.data-table.rows', 'data-table', 'rows', state);
    let itemKind: LocalValueKind = 'string';
    let rowsInferred = false;
    if (rows) {
      const result = validateScopedExpression(state, rows.expression, rows.base, env, true);
      if (result?.kind === 'array') {
        itemKind = 'string';
        rowsInferred = true;
      } else if (result?.kind === 'number-array') {
        itemKind = 'number';
        rowsInferred = true;
      } else if (result && result.kind !== null) {
        state.report(
          'local.data-table.rows',
          `<data-table> rows must evaluate to an array, but the expression evaluates to ${typeName(result.kind)}.`,
          rows.base,
        );
      }
    }

    const rowEnv: Record<string, LocalValueKind> = { ...env, item: itemKind, index: 'number' };
    const key = fullExpressionAttribute(attrs.key, 'local.data-table.key', 'data-table', 'key', state);
    if (key) {
      const result = validateScopedExpression(state, key.expression, key.base, rowEnv, rowsInferred);
      if (result) {
        const dependencies = result.compiled.dependencies;
        if (!dependencies.includes('item')) {
          state.report('local.data-table.key', '<data-table> key must depend on item.', key.base);
        }
        for (const dependency of dependencies) {
          if (dependency === 'item') continue;
          if (dependency === 'index') {
            state.report('local.data-table.key', '<data-table> key cannot depend on index; use a stable item identifier.', key.base);
          } else if (Object.hasOwn(env, dependency)) {
            state.report(
              'local.data-table.key',
              `<data-table> key cannot depend on global parameter "${dependency}"; it must be derived from item only.`,
              key.base,
            );
          }
        }
        if (result.kind !== null && result.kind !== 'string' && result.kind !== 'number') {
          state.report(
            'local.data-table.key',
            `<data-table> key must evaluate to a string or number, got ${typeName(result.kind)}.`,
            key.base,
          );
        }
      }
    }

    for (const column of columns) {
      const columnAttrs = state.attrs.get(column.id) ?? {};
      const label = columnAttrs.label;
      if (label && !String(label.value ?? '').trim()) {
        state.report('local.data-table.column', '<column> label cannot be empty.', label.offset);
      }
      const value = fullExpressionAttribute(columnAttrs.value, 'local.data-table.value', 'column', 'value', state);
      if (!value) continue;
      const result = validateScopedExpression(state, value.expression, value.base, rowEnv, rowsInferred);
      if (result && (result.kind === 'array' || result.kind === 'number-array')) {
        state.report(
          'local.data-table.value',
          `<column> value must be a scalar string, number, boolean or null, got ${typeName(result.kind)}.`,
          value.base,
        );
      }
    }
  }
}

/**
 * Validate `<validation>` rules and build their source-ordered metadata. The
 * tag itself stays in the tree so the renderer can place the hint; unlike
 * `<computed>`, it is not stripped.
 */
function validateValidations(state: CompileState): LocalValidation[] {
  const validations: LocalValidation[] = [];
  let declarations = 0;
  let budgetReported = false;
  const writable = Object.keys(state.bindingKinds);
  const env = expressionEnv(state);

  for (const entry of state.entries) {
    if (entry.name !== 'validation') continue;
    declarations += 1;
    const node = entry.node;
    if (declarations > MAX_LOCAL_VALIDATIONS) {
      if (!budgetReported) {
        budgetReported = true;
        state.report(
          'local.validation.budget',
          `The document declares more than ${MAX_LOCAL_VALIDATIONS} validation rules; rules in hidden regions count too.`,
          node.range.start,
          node.range.end,
        );
      }
      continue;
    }
    if (entry.parent && (entry.parent.schema.form !== 'container' || entry.parent.name === 'data-table')) {
      state.report(
        'local.validation.placement',
        '<validation> can appear in normal prose or a container, but not inside inline content or a data table.',
        node.range.start,
        node.range.end,
      );
    }

    const attrs = state.attrs.get(node.id) ?? {};
    let expression = '';
    let dependencies: string[] = [];
    const when = attrs.when;
    if (when) {
      const full = fullInterpolation(when.raw);
      if (!full) {
        state.report(
          'local.validation.when',
          '<validation> when must be exactly one {{ boolean }} interpolation.',
          when.offset,
          when.offset + when.raw.length,
        );
      } else if (full.expression) {
        expression = full.expression;
        const result = validateScopedExpression(state, expression, when.offset + full.start, env, true);
        if (result) {
          dependencies = [...result.compiled.dependencies];
          if (result.kind !== null && result.kind !== 'boolean') {
            state.report(
              'local.type',
              `Expected a boolean here, but the expression evaluates to ${typeName(result.kind)}.`,
              when.offset + full.start,
            );
          }
        }
      }
    }

    const fieldsInfo = attrs.fields;
    const fields = fieldsInfo ? parseValidationFields(fieldsInfo.raw) : [];
    if (fieldsInfo && !fields.length) {
      state.report(
        'local.validation.fields',
        '<validation> requires at least one field name.',
        fieldsInfo.offset,
        fieldsInfo.offset + fieldsInfo.raw.length,
      );
    }
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field)) {
        state.report(
          'local.validation.fields',
          `Duplicate field "${field}" in <validation> fields.`,
          fieldsInfo?.offset ?? node.range.start,
        );
        continue;
      }
      seen.add(field);
      if (!Object.hasOwn(state.bindingKinds, field)) {
        const suggestion = suggestName(field, writable);
        state.report(
          'local.validation.fields',
          `Field "${field}" is not a public writable parameter.${suggestion ? ` Did you mean ${suggestion}?` : ''}`,
          fieldsInfo?.offset ?? node.range.start,
        );
      }
    }

    // `message` is an ordinary text template: validateExpressions checks its
    // interpolations. Rules without a usable `when` are already rejected.
    if (!expression) continue;
    validations.push({
      nodeId: node.id,
      expression,
      dependencies,
      message: typeof attrs.message?.value === 'string' ? attrs.message.value : '',
      fields: [...seen],
      range: { ...node.range },
    });
  }
  return validations;
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
  const env = expressionEnv(state);
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
        { key: 'local.budget.plot.curves', params: { limit: MAX_LOCAL_PLOT_CURVES, count: mathNodes.length } },
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
        { key: 'local.budget.plot.points', params: { limit: MAX_LOCAL_PLOT_POINTS } },
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
          { key: 'local.math.formula.shape' },
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
          {
            key: 'local.math.compute',
            params: {
              detail: error instanceof Error ? error.message : String(error),
              code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'latex-syntax',
              near: recipe.slice(0, 120),
            },
          },
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
            { key: 'local.math.binding.unknown', params: { name: dependency } },
          );
        } else if (env[dependency] !== 'number') {
          state.report(
            'local.math.binding',
            `Plot parameter "${dependency}" must be a number, but is ${typeName(env[dependency])}.`,
            node.range.start,
            node.range.end,
            { key: 'local.math.binding.type', params: { name: dependency, kind: typeName(env[dependency]) } },
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
    state.report('local.table.header', `The table for <${component.name}> is missing a header.`, table.range.start, table.range.end, { key: 'local.table.header.missing', params: { name: component.name } });
    return null;
  }
  const header = rows[0].children ?? [];
  const names: string[] = [];
  for (const cell of header) {
    if (hasInterpolation(cell)) {
      state.report('local.table.header', 'Table headers cannot contain interpolations.', cell.range.start, cell.range.end, { key: 'local.table.header.interpolation' });
      return null;
    }
    const text = plainText(cell).trim();
    if (!text) {
      state.report('local.table.header', 'Table headers cannot be empty.', cell.range.start, cell.range.end, { key: 'local.table.header.empty' });
      return null;
    }
    if (names.includes(text)) {
      state.report('local.table.header', `Duplicate table header "${text}".`, cell.range.start, cell.range.end, { key: 'local.table.header.duplicate', params: { name: text } });
      return null;
    }
    names.push(text);
  }
  if (!names.length) {
    state.report('local.table.header', 'Table headers cannot be empty.', table.range.start, table.range.end, { key: 'local.table.header.empty' });
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
        { key: 'local.table.row.mismatch', params: { header: names.length, row: cells.length } },
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
          {
            key: component.name === 'timeline' ? 'local.timeline.numeric.expression' : 'local.chart.numeric.expression',
            params: { name, row: rowIndex + 1, kind: typeName(kind) },
          },
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
        {
          key: component.name === 'timeline' ? 'local.timeline.numeric.plain' : 'local.chart.numeric.plain',
          params: { name, row: rowIndex + 1, value: plainText(cell).trim() || 'empty' },
        },
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
      tableShapeFor(entry, state);
      continue;
    }
    if (entry.name !== 'chart' && entry.name !== 'timeline') continue;
    const shape = tableShapeFor(entry, state);
    if (!shape) continue;
    if (entry.name === 'chart') validateChart(entry, shape, state);
    else validateTimeline(entry, shape, state);
  }
}

function tableShapeFor(entry: Entry, state: CompileState): TableShape | null {
  if (state.tableShapes.has(entry.node.id)) return state.tableShapes.get(entry.node.id) ?? null;
  const table = state.tables.get(entry.node.id);
  const shape = table ? tableShape(table, state, entry) : null;
  state.tableShapes.set(entry.node.id, shape);
  return shape;
}

/**
 * Projects the compiler's table shapes onto the document as plain, frozen
 * data. Only header text and cell node ids are kept, so the persisted form is
 * serializable and never references nodes or forms cycles.
 */
function attachTableShapes(document: LocalDocument, shapes: Map<string, TableShape | null>): void {
  if (shapes.size === 0) return;
  const record: Record<
    string,
    { readonly header: readonly string[]; readonly rowIds: readonly (readonly string[])[] }
  > = Object.create(null);
  let count = 0;
  for (const [id, shape] of shapes) {
    if (!shape) continue;
    record[id] = Object.freeze({
      header: Object.freeze([...shape.header]),
      rowIds: Object.freeze(shape.rows.map((row) => Object.freeze(row.map((cell) => cell.id)))),
    });
    count += 1;
  }
  if (count === 0) return;
  document.tableShapes = Object.freeze(record);
}

/**
 * Turn the `key` column of a table/chart into the stable selection options used
 * by its optional `bind`. Selection is only compiled when `key` is present, so
 * old documents keep the renderer's internal selection state.
 */
function computeSelections(state: CompileState): void {
  for (const entry of state.entries) {
    if (entry.name !== 'table' && entry.name !== 'chart') continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const keyInfo = attrs.key;
    if (!keyInfo) continue;
    const keyName = typeof keyInfo.value === 'string' ? keyInfo.value.trim() : '';
    if (!keyName) {
      state.report('local.selection.key', `<${entry.name}> key cannot be empty.`, keyInfo.offset, undefined, { key: 'local.selection.key.empty', params: { component: entry.name } });
      state.selections.set(entry.node.id, ['']);
      continue;
    }
    const shape = tableShapeFor(entry, state);
    if (!shape) {
      state.selections.set(entry.node.id, ['']);
      continue;
    }
    const column = columnIndex(shape.header, keyName);
    if (column < 0) {
      state.report(
        'local.selection.key',
        `<${entry.name}> key column "${keyName}" does not exist in its table.`,
        keyInfo.offset,
        undefined,
        { key: 'local.selection.key.missing-column', params: { component: entry.name, name: keyName } },
      );
      state.selections.set(entry.node.id, ['']);
      continue;
    }
    const values: string[] = [];
    const seen = new Set<string>();
    shape.rows.forEach((row, rowIndex) => {
      const cell = row[column];
      if (!cell) return;
      if (hasInterpolation(cell)) {
        state.report(
          'local.selection.key',
          `<${entry.name}> key column "${keyName}" must contain static text; row ${rowIndex + 1} contains an interpolation.`,
          cell.range.start,
          cell.range.end,
          { key: 'local.selection.key.interpolation', params: { component: entry.name, name: keyName, row: rowIndex + 1 } },
        );
        return;
      }
      const text = plainText(cell).trim();
      if (!text) {
        state.report(
          'local.selection.key',
          `<${entry.name}> key column "${keyName}" cannot be empty in row ${rowIndex + 1}.`,
          cell.range.start,
          cell.range.end,
          { key: 'local.selection.key.empty-cell', params: { component: entry.name, name: keyName, row: rowIndex + 1 } },
        );
        return;
      }
      if (seen.has(text)) {
        state.report(
          'local.selection.key',
          `<${entry.name}> key column "${keyName}" must be unique; duplicate value "${text}".`,
          cell.range.start,
          cell.range.end,
          { key: 'local.selection.key.duplicate', params: { component: entry.name, name: keyName, value: text } },
        );
        return;
      }
      seen.add(text);
      values.push(text);
    });
    state.selections.set(entry.node.id, ['', ...values]);
    const initial = attrs.initial;
    if (initial && typeof initial.value === 'string' && initial.value !== '' && !values.includes(initial.value)) {
      state.report(
        'local.initial.option',
        `Initial selection "${initial.value}" of <${entry.name}> is not a value of key column "${keyName}".`,
        initial.offset,
        undefined,
        { key: 'local.selection.key.initial', params: { value: initial.value, component: entry.name, name: keyName } },
      );
    }
  }
}

function validateChart(entry: Entry, shape: TableShape, state: CompileState): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const kind = typeof attrs.kind?.value === 'string' ? attrs.kind.value : 'bar';
  const header = shape.header;
  for (const name of header) {
    if (name.includes(',')) {
      state.report('local.chart.column', `Chart column names cannot contain commas: "${name}".`, entry.node.range.start, entry.node.range.end, { key: 'local.chart.column.comma', params: { name } });
    }
  }
  const xName = typeof attrs.x?.value === 'string' ? attrs.x.value.trim() : '';
  const yRaw = typeof attrs.y?.value === 'string' ? attrs.y.value.trim() : '';
  if (xName && columnIndex(header, xName) < 0) {
    state.report('local.chart.column', `Chart x column "${xName}" does not exist.`, attrs.x?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.x-missing', params: { name: xName } });
  }
  let yNames: string[] = [];
  if (yRaw) {
    yNames = yRaw.split(',').map((name) => name.trim()).filter(Boolean);
    if (!yNames.length) {
      state.report('local.chart.column', 'Chart y requires a column name.', attrs.y?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.y-required' });
    }
    for (const name of yNames) {
      if (columnIndex(header, name) < 0) {
        state.report('local.chart.column', `Chart y column "${name}" does not exist.`, attrs.y?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.y-missing', params: { name } });
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
      state.report('local.chart.column', 'Chart requires at least one numeric column.', entry.node.range.start, entry.node.range.end, { key: 'local.chart.column.needs-numeric' });
    }
  } else if (kind === 'scatter') {
    const xColumn = xName ? columnIndex(header, xName) : 0;
    if (xColumn < 0) {
      state.report('local.chart.column', `Scatter chart x column "${xName}" does not exist.`, entry.node.range.start, undefined, { key: 'local.chart.column.scatter-x-missing', params: { name: xName } });
    } else {
      requireNumericColumn(shape, xColumn, state, entry, 'x');
    }
    numeric = yNames.length
      ? yNames.map((name) => columnIndex(header, name)).filter((index) => index >= 0)
      : header.map((_, index) => index).filter((index) => index !== xColumn);
    if (!numeric.length) {
      state.report('local.chart.column', 'Scatter chart requires at least one numeric column.', entry.node.range.start, entry.node.range.end, { key: 'local.chart.column.scatter-needs-numeric' });
    }
  } else if (kind === 'donut') {
    if (header.length < 2) {
      state.report('local.chart.column', 'Donut chart requires a label column and a value column.', entry.node.range.start, entry.node.range.end, { key: 'local.chart.column.donut-columns' });
      return;
    }
    if (yNames.length === 1) {
      const index = columnIndex(header, yNames[0]);
      if (index >= 0) numeric = [index];
    } else if (yNames.length > 1) {
      state.report('local.chart.column', 'Donut chart y can only specify one numeric column.', attrs.y?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.donut-y' });
    } else if (header.length > 2) {
      state.report('local.chart.column', 'A donut chart with more than two columns must use y to specify the single numeric column.', entry.node.range.start, entry.node.range.end, { key: 'local.chart.column.donut-need-y' });
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
            { key: 'local.chart.negative', params: { row: rowIndex + 1, value } },
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
      { key: 'local.timeline.header.missing' },
    );
    return;
  }
  const allowed = new Set(Object.values(headers));
  for (const name of shape.header) {
    if (!allowed.has(name)) {
      state.report('local.timeline.header', `Timeline does not support column "${name}".`, entry.node.range.start, entry.node.range.end, { key: 'local.timeline.header.column', params: { name } });
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
          { key: 'local.timeline.value.negative', params: { name: shape.header[column], row: rowIndex + 1 } },
        );
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Host components                                                     */
/* ------------------------------------------------------------------ */

/** Host schemas are validated before parsing; an unmatched node only warns. */
function reportWarning(
  state: CompileState,
  code: string,
  message: string,
  start: number,
  end = start + 1,
  details?: LocalDiagnosticDetails,
): void {
  if (state.diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) return;
  const safeStart = Math.max(0, Math.min(state.source.length, start));
  const safeEnd = Math.max(safeStart, Math.min(state.source.length, Math.max(safeStart, end)));
  let low = 0;
  let high = state.lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (state.lineStarts[middle] <= safeStart) low = middle;
    else high = middle - 1;
  }
  const bounded = localDiagnosticDetails(details?.key ?? code, details?.params);
  state.diagnostics.push({
    code,
    message: message.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
      ? `${message.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
      : message,
    severity: 'warning',
    range: { start: safeStart, end: safeEnd },
    line: low + 1,
    column: safeStart - state.lineStarts[low] + 1,
    messageKey: bounded.key,
    ...(bounded.params ? { params: bounded.params } : {}),
  });
}

/**
 * Validate host-defined leaf tags in place. They already count as parser syntax
 * nodes but never enter `state.entries`: they own no bindings, children or
 * runtime state, so only their literal attributes are checked here.
 */
function validateHostComponents(
  nodes: LocalNode[],
  hostByName: ReadonlyMap<string, LocalHostComponentSchema>,
  state: CompileState,
): void {
  for (const node of nodes) {
    if (node.type === 'hostComponent') {
      const schema = node.name ? hostByName.get(node.name) : undefined;
      if (!schema) {
        // The parser only creates these from the same option; an unmatched node
        // means a mismatch between parser and compile options.
        const name = node.name ?? '';
        reportWarning(
          state,
          'local.component.unknown',
          `Unknown component <${name}>. This mode only accepts local interaction components.`,
          node.range.start,
          node.range.end,
          { key: 'local.component.unknown', params: { name } },
        );
      } else {
        validateHostAttributes(node, schema, state);
      }
    }
    if (node.children) validateHostComponents(node.children, hostByName, state);
  }
}

function validateHostAttributes(
  node: LocalNode,
  schema: LocalHostComponentSchema,
  state: CompileState,
): void {
  const component = schema.name;
  const rawAttrs = node.attrs ?? {};
  for (const [name, raw] of Object.entries(rawAttrs)) {
    const prop = schema.props[name];
    const offset = attributeOffset(state, node, name);
    if (!prop) {
      state.report(
        'local.host.attribute',
        `Component <${component}> does not support attribute ${name}.`,
        offset,
        offset + name.length,
        { key: 'local.host.attribute.unknown', params: { component, name } },
      );
      continue;
    }
    validateHostPropValue(name, prop, raw, offset, state);
  }
  for (const [name, prop] of Object.entries(schema.props)) {
    if (prop.required && !Object.hasOwn(rawAttrs, name)) {
      state.report(
        'local.host.attribute',
        `Component <${component}> is missing required attribute ${name}.`,
        node.range.start,
        node.range.end,
        { key: 'local.host.attribute.required', params: { component, name } },
      );
    }
  }
}

function validateHostPropValue(
  name: string,
  prop: LocalHostPropSchema,
  raw: string,
  offset: number,
  state: CompileState,
): void {
  if (prop.static) {
    const scanned = scanInterpolations(raw);
    if (scanned.segments.length || scanned.unterminated.length) {
      state.report(
        'local.host.attribute',
        `Attribute ${name} is static and cannot contain interpolations.`,
        offset,
        offset + raw.length,
        { key: 'local.host.attribute.static', params: { name } },
      );
      return;
    }
  }

  if (prop.kind === 'string') {
    if (prop.pattern) {
      const scanned = scanInterpolations(raw);
      // An allowed interpolation makes the literal pattern inapplicable.
      if (!scanned.segments.length && !scanned.unterminated.length) {
        let accepted = true;
        try {
          accepted = new RegExp(prop.pattern).test(raw);
        } catch {
          // Options validation rejects invalid patterns; do not crash if a
          // schema bypassed it.
        }
        if (!accepted) {
          state.report(
            'local.host.attribute',
            `Attribute ${name} must match pattern ${prop.pattern}.`,
            offset,
            offset + raw.length,
            { key: 'local.host.attribute.pattern', params: { name, pattern: prop.pattern } },
          );
        }
      }
    }
    return;
  }

  // Dynamic kinds accept exactly one full interpolation unless declared static.
  if (!prop.static && fullInterpolation(raw)) return;

  if (prop.kind === 'number') {
    if (parseNumberText(raw) === null) {
      state.report(
        'local.host.attribute',
        `Attribute ${name} requires a number, got "${raw}".`,
        offset,
        offset + raw.length,
        { key: 'local.host.attribute.type', params: { name, value: raw, kind: 'number' } },
      );
    }
    return;
  }

  if (prop.kind === 'boolean') {
    if (raw !== 'true' && raw !== 'false') {
      state.report(
        'local.host.attribute',
        `Attribute ${name} requires a boolean, got "${raw}".`,
        offset,
        offset + raw.length,
        { key: 'local.host.attribute.type', params: { name, value: raw, kind: 'boolean' } },
      );
    }
    return;
  }

  const values = prop.enum ?? [];
  if (!values.includes(raw)) {
    state.report(
      'local.host.attribute',
      `Attribute ${name} must be one of ${values.join(' / ')}, got "${raw}".`,
      offset,
      offset + raw.length,
      { key: 'local.host.attribute.enum', params: { name, values: values.join(' / '), value: raw } },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Top-level entry point used by validateExpressions                   */
/* ------------------------------------------------------------------ */

export function compileLocalDocument(source: string, options?: LocalCompileOptions): LocalCompileResult {
  return compileLocal(source, options);
}
