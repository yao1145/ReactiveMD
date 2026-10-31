import type { Diagnostic } from './types';
import { isLocalColor } from './colors';
import { localDateTimestamp } from './dates';

import { localDiagnosticDetails, type LocalDiagnosticDetails } from './diagnostics';
import { countLocalCodePoints } from './text-length';
import { attachNodeDependencies } from './dependencies';
import { compileExpression, LocalExpressionError, localValueBudgetIssue, RESERVED_NAMES, type LocalExpression } from './expression';
import {
  resolveComputationGraph,
  type ComputationInput,
} from './computations';
import { createHeadingAnchors } from './heading-anchors';
import { compileLatex } from './math';
import { inspectLocalMathDisplay } from './math-display';
import { parseLocal } from './parser';
import { LOCAL_SYNTAX_VERSION } from './version';
import { DEFAULT_LOCAL_THEME } from './theme';
import { localComponentConfigKey } from '../sdk/config';
import {
  isLocalEmail,
  MAX_LOCAL_EMAIL_LENGTH,
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
  closestName,
  type LocalComponentSchema,
} from './schema';
import {
  isKernelAnchorId,
  isKernelDate,
  kernelAttributeIssues,
  kernelDefaultInitial,
  kernelDescribeConstraints,
  kernelHasComponent,
  kernelMeaningfulChildren,
  kernelMaxItems,
  kernelNearestZero,
  kernelNavigationIssues,
  kernelNumericConstraints,
  kernelOnStep,
  kernelProjectionForFamily,
  kernelRule,
  kernelRules,
  kernelRulesOf,
  kernelSameNumericBound,
  kernelSchemaFor,
  kernelSlotBindings,
  kernelSlotRelations,
  kernelStructure,
  kernelUsesLegacyDiagnostics,
  kernelValueBinding,
  kernelValueRules,
  type KernelAttrMap,
  type KernelBindingSchema,
  type KernelChildRule,
  type KernelComponentSchema,
  type KernelDefinitionFields,
  type KernelDiagnosticIssue,
  type KernelNumericConstraints,
  type KernelProjectionKind,
  type KernelPropSchema,
  type KernelRule,
  type KernelStructure,
  type KernelValueRule,
} from './component-kernel';
import type { LocalBindingFamily } from './schema';
import { parseValidationFields } from './validation';
import { readLocalCompileOptions, type LocalOptionCheck } from './options';
import { localComponentRequirement } from '../sdk/manifest';
import { localComponentHostBinding, resolveLocalComponentBindingConstraints } from '../sdk/props';
import { LOCAL_EXTENSIONS_PROTOCOL, type LocalComponentDefinition, type LocalComponentRequirement, type LocalExtensionRequirements } from '../sdk/types';
import { sanitizeLocalHtmlDocument } from './html';
import { plainCompiledData } from './compiled-data';
import {walkLocalNodes} from './node-walk';
import { SourceContext } from './source-context';
import { LocalSemanticCache, type SemanticCacheStats } from './compiler-cache';
import { localCompileOptionsKey } from './options';
import type { InlinePlanLookup } from './fast-markdown';
import type {
  LocalBinding,
  LocalCompileOptions,
  LocalCompileResult,
  LocalComputation,
  LocalDocument,
  LocalDynamicConstraints,
  LocalExternal,
  LocalHostBindingSchema,
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

/** Fields the unified options/registry layer exposes in phase two. */
interface UnifiedRegistryCheck {
  schemaByName?: ReadonlyMap<string, KernelComponentSchema>;
  componentByName?: ReadonlyMap<string, LocalComponentDefinition>;
  legacyHostNames?: ReadonlySet<string>;
}

function registrySchemaMap(check: LocalOptionCheck & UnifiedRegistryCheck): ReadonlyMap<string, KernelComponentSchema> {
  // The unified registry is authoritative; there is no second schema table.
  return check.schemaByName ?? new Map();
}

function registryDefinitionMap(check: LocalOptionCheck & UnifiedRegistryCheck): ReadonlyMap<string, LocalComponentDefinition> {
  return check.componentByName ?? new Map();
}

function kernelView(
  schema: LocalComponentSchema,
  definition: LocalComponentDefinition | undefined,
): KernelComponentSchema {
  return kernelSchemaFor(
    schema as unknown as KernelComponentSchema,
    definition as unknown as KernelDefinitionFields | undefined,
  );
}

function suggestRegistryName(name: string, candidates: Iterable<string>): string | undefined {
  if (name.length > MAX_LOCAL_NAME_LENGTH) return undefined;
  return closestName(name, [...candidates]);
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

interface Entry {
  node: LocalNode;
  name: string;
  schema: LocalComponentSchema;
  kernel: KernelComponentSchema;
  definition?: LocalComponentDefinition;
  legacy: boolean;
  parent: Entry | null;
}

interface ChecklistInfo {
  ids: string[];
  checked: string[];
}

interface CompileState {
  semantic?: LocalSemanticCache;
  source: string;
  lineStarts: number[];
  nodes: LocalNode[];
  diagnostics: Diagnostic[];
  /** Unified registry used for every component node in this compile. */
  schemaByName: ReadonlyMap<string, KernelComponentSchema>;
  definitionsByName: ReadonlyMap<string, LocalComponentDefinition>;
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
  externals: Record<string, LocalExternal>;
  externalKinds: Record<string, LocalValueKind>;
  dynamicConstraints: Record<string, LocalDynamicConstraints>;
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

/** Compile to plain data that can cross a React Server Component boundary. */
export function compileLocal(source: string, options?: LocalCompileOptions): LocalCompileResult {
  return plainCompiledData(compileLocalInternal(source, options));
}

/** Compiler-owned capture for editor sessions. Callers must copy before publishing. */
export interface LocalCompilerServices {
  parser?: {parse(source:string,options?:LocalCompileOptions,context?:SourceContext,rowPlans?:InlinePlanLookup):ReturnType<typeof parseLocal>};
  semantic?: LocalSemanticCache;
  /**
   * Per-row inline plans from the previous revision. Checked before the
   * session LRU so large sequential row blocks cannot thrash it.
   */
  rowPlans?: InlinePlanLookup;
}
export function compileLocalTracked(source: string, options?: LocalCompileOptions, services?:LocalCompilerServices): {
  result: LocalCompileResult; parsed?: ReturnType<typeof parseLocal>;
  semantic?:SemanticCacheStats; timings:Record<string,number>;
} {
  let parsed: ReturnType<typeof parseLocal> | undefined;
  const now=()=>globalThis.performance?.now?.()??Date.now();
  const started=now(),timings:Record<string,number>={};let previous=started;
  const mark=(name:string)=>{const time=now();timings[name]=time-previous;previous=time;};
  services?.semantic?.begin(localCompileOptionsKey(options));
  const result = compileLocalInternal(source, options, tree => { parsed = tree; },services,mark);
  timings.totalMs=now()-started;
  return { result, parsed, ...(services?.semantic?{semantic:services.semantic.stats}:{}),timings };
}

function compileLocalInternal(source: string, options?: LocalCompileOptions, capture?: (tree: ReturnType<typeof parseLocal>) => void,services?:LocalCompilerServices,mark?:(name:string)=>void): LocalCompileResult {
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
        ...(optionCheck.detail === undefined ? {} : { params: { detail: optionCheck.detail } }),
      }],
    };
  }
  if (optionCheck.htmlActive) return compileHtmlLocal(source, optionCheck);
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    return { ok: false, diagnostics: parseLocal(source, options).diagnostics };
  }
  const diagnostics: Diagnostic[] = [];
  const sourceContext = new SourceContext(source);
  const {lineStarts} = sourceContext;
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
    parsed = services?.parser ? services.parser.parse(source,options,sourceContext,services.rowPlans) : parseLocal(source, options, sourceContext);
    capture?.(parsed);
    mark?.('parseMs');
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
    semantic:services?.semantic,
    source,
    lineStarts,
    nodes: parsed.nodes,
    diagnostics,
    schemaByName: registrySchemaMap(optionCheck),
    definitionsByName: registryDefinitionMap(optionCheck),
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
    externals: {},
    externalKinds: {},
    dynamicConstraints: {},
    expressionKinds: new Map(),
  };

  collectEntries(parsed.nodes, null, state.entries, state);
  for (const entry of state.entries) {
    state.attrs.set(entry.node.id, validateAttributes(entry, state));
    validateAttributeRelations(entry, state);
    validateBindingConstraintAttributes(entry, state);
  }
  mark?.('attributesMs');
  for (const entry of state.entries) validateChildren(entry, state);
  computeSelections(state);
  mark?.('structureMs');

  const bindings = resolveBindings(state);
  state.bindingKinds = bindingKinds(bindings);
  mark?.('bindingsMs');

  resolveExternals(state);
  resolveComputations(state);
  mark?.('computationsMs');
  collectDynamicConstraints(state);

  validateExpressions(state);
  mark?.('expressionsMs');
  validateDataTables(state);
  mark?.('dataTablesMs');
  const validations = validateValidations(state);
  mark?.('validationsMs');
  validatePlots(state);
  mark?.('plotsMs');
  validateTables(state);
  mark?.('tablesMs');

  const initialState: Record<string, LocalValue> = {};
  for (const [key, binding] of Object.entries(bindings)) initialState[key] = cloneValue(binding.initial);
  validateNavigation(state, bindings, initialState);
  reportUnmatchedHostComponents(parsed.nodes, state);
  mark?.('hostAndNavigationMs');
  const displayNodes = [...parsed.nodes];
  while (displayNodes.length && diagnostics.length < MAX_LOCAL_DIAGNOSTICS) {
    const node = displayNodes.pop()!;
    if (node.type === 'math' || node.type === 'inlineMath') {
      const delimiterLength = source.startsWith('\\\\[', node.range.start) ? 3
        : node.type === 'math' || source.startsWith('\\(', node.range.start) ? 2 : 1;
      const base = node.range.start + delimiterLength;
      for (const issue of (state.semantic ? state.semantic.display(node.value ?? '',node.type==='math') : inspectLocalMathDisplay(node.value ?? '', node.type === 'math'))) {
        reportWarning(state, issue.code, issue.message, base + issue.start, base + issue.end, {
          key: issue.messageKey, params: issue.params,
        });
      }
    } else if (node.children) displayNodes.push(...node.children);
  }
  mark?.('mathDisplayMs');

  diagnostics.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError) return { ok: false, diagnostics };

  const bindingSlots = slotMap(state);
  const computationNames = Object.keys(state.computations);
  const externalNames = Object.keys(state.externals);
  const dynamicConstraints = Object.keys(state.dynamicConstraints).length
    ? state.dynamicConstraints
    : undefined;
  const extensions = extensionRequirements(parsed.nodes, optionCheck.sdkByName);
  const kernelMetadata = compileKernelMetadata(state, bindings);
  const usedDefinitions = componentDefinitionsFor(state);
  const document: LocalDocument = {
    syntax: 'local',
    source,
    ...((optionCheck.config || !options?.hostComponents)
      ? { componentConfigKey: localComponentConfigKey(optionCheck.config) } : {}),
    syntaxVersion: LOCAL_SYNTAX_VERSION,
    ...(parsed.versionDeclaration ? { versionDeclaration: parsed.versionDeclaration } : {}),
    nodes: stripDeclarationNodes(parsed.nodes),
    initialState,
    bindings,
    theme: parsed.theme ?? DEFAULT_LOCAL_THEME.name,
    ...(parsed.themeRange ? { themeRange: parsed.themeRange } : {}),
    ...(bindingSlots ? { bindingSlots } : {}),
    ...(computationNames.length ? { computations: state.computations } : {}),
    ...(externalNames.length ? { externals: state.externals } : {}),
    ...(dynamicConstraints ? { dynamicConstraints } : {}),
    ...(validations.length ? { validations } : {}),
    ...(extensions ? { extensions } : {}),
    kernel: kernelMetadata,
    ...(usedDefinitions.length ? { componentDefinitions: Object.freeze(usedDefinitions) } : {}),
  };
  attachNodeDependencies(document);
  attachTableShapes(document, state.tableShapes);
  mark?.('publicationMs');
  return { ok: true, document, diagnostics };
}

/* ------------------------------------------------------------------ */
/* Collection and attributes                                           */
/* ------------------------------------------------------------------ */

function collectLegacyFences(nodes: LocalNode[]): LocalNode[] {
  const found: LocalNode[] = [];
    for (const node of walkLocalNodes(nodes)) {
      if (node.type === 'code' && (node.lang ?? '').trim().toLowerCase() === 'reactive-md') found.push(node);
    }
  return found;
}

function collectEntries(nodes: LocalNode[], parent: Entry | null, out: Entry[], state: CompileState): void {
  const pending=[{nodes,parent,index:0}];
  while(pending.length){
    const frame=pending[pending.length-1];
    if(frame.index===frame.nodes.length){pending.pop();continue;}
    const node=frame.nodes[frame.index++],parent=frame.parent;
    let nextParent=parent;
    const isComponent = (node.type === 'component' || node.type === 'hostComponent') && !!node.name;
    if (isComponent) {
      const schema = state.schemaByName.get(node.name!);
      if (schema) {
        const definition = state.definitionsByName.get(node.name!);
        const kernel = kernelView(schema as LocalComponentSchema, definition);
        // Phase-one external manifests (no phase-two rules) keep host wording.
        const legacy = kernelUsesLegacyDiagnostics(kernel)
          || (definition !== undefined && !definition.rules?.length && node.type === 'hostComponent');
        const entry: Entry = {
          node,
          name: node.name!,
          schema: schema as unknown as LocalComponentSchema,
          kernel,
          ...(definition ? { definition } : {}),
          legacy,
          parent,
        };
        out.push(entry);
        nextParent = entry;
      } else if (node.type === 'component') {
        const suggestion = suggestRegistryName(node.name!, state.schemaByName.keys());
        state.report(
          'local.component.unknown',
          `Unknown component <${node.name}>. ${suggestion ? `Did you mean <${suggestion}>?` : 'This mode only accepts local interaction components.'}`,
          node.range.start,
          node.range.end,
          {
            key: suggestion ? 'local.component.unknown.suggestion' : 'local.component.unknown',
            params: suggestion ? { name: node.name!, suggestion } : { name: node.name! },
          },
        );
      }
      // An unmatched hostComponent warns in reportUnmatchedHostComponents; it
      // owns no binding or runtime state.
    }
    if(node.children)pending.push({nodes:node.children,parent:nextParent,index:0});
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
  if(!state.semantic)return validateAttributesUncached(entry,state);
  const key=entry.name+'\0'+openingTag(state.source,entry.node.range.start,entry.node.range.end);
  const cached=state.semantic.attributes<AttrMap>(key);
  const clone=(attrs:AttrMap,delta:number):AttrMap=>Object.fromEntries(Object.entries(attrs).map(([name,info])=>[name,{...info,offset:info.offset+delta,...(info.expressionOffset===undefined?{}:{expressionOffset:info.expressionOffset+delta}),...(Array.isArray(info.value)?{value:cloneValue(info.value)}:{})}]));
  if(cached)return clone(cached.value,entry.node.range.start-cached.origin);
  const count=state.diagnostics.length,value=validateAttributesUncached(entry,state);
  if(count<MAX_LOCAL_DIAGNOSTICS && state.diagnostics.length===count)state.semantic.rememberAttributes(key,entry.node.range.start,clone(value,0));
  return value;
}
function validateAttributesUncached(entry: Entry, state: CompileState): AttrMap {
  const attrs: AttrMap = {};
  const rawAttrs = entry.node.attrs ?? {};
  const props = entry.kernel.props;
  const legacy = entry.legacy;
  const bindingAttributes = legacy ? legacyBindingAttributes(entry) : undefined;
  for (const [name, raw] of Object.entries(rawAttrs)) {
    const offset = attributeOffset(state, entry.node, name);
    if (legacy && raw.length > MAX_LOCAL_STRING_LENGTH) {
      state.report(
        'local.budget.attribute',
        `Attribute ${name} on component <${entry.name}> exceeds the ${MAX_LOCAL_STRING_LENGTH}-character limit.`,
        offset,
        offset + name.length,
        { key: 'local.budget.attribute', params: { name, component: entry.name, limit: MAX_LOCAL_STRING_LENGTH } },
      );
      continue;
    }
    if (bindingAttributes?.bind.has(name) || bindingAttributes?.initial.has(name)) {
      // The binding resolver owns these attributes and reports their rules.
      attrs[name] = bindingAttributeInfo(entry, name, raw, offset);
      continue;
    }
    const prop = props[name];
    if (!prop) {
      const suggestion = closestName(name, Object.keys(props));
      if (legacy) {
        state.report(
          'local.host.attribute',
          `Component <${entry.name}> does not support attribute ${name}.`,
          offset,
          offset + name.length,
          { key: 'local.host.attribute.unknown', params: { component: entry.name, name } },
        );
      } else {
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
      }
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
    validatePropValue(entry, name, prop, info, state, legacy);
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
  for (const [name, prop] of Object.entries(props)) {
    if (bindingAttributes?.bind.has(name) || bindingAttributes?.initial.has(name)) continue;
    if (prop.required && prop.default === undefined && !Object.hasOwn(attrs, name)) {
      if (legacy) {
        state.report(
          'local.host.attribute',
          `Component <${entry.name}> is missing required attribute ${name}.`,
          entry.node.range.start,
          entry.node.range.end,
          { key: 'local.host.attribute.required', params: { component: entry.name, name } },
        );
      } else {
        state.report(
          'local.attribute.required',
          `Component <${entry.name}> is missing required attribute ${name}.`,
          entry.node.range.start,
          entry.node.range.end,
          { key: 'local.attribute.required', params: { component: entry.name, name } },
        );
      }
    }
  }
  if (kernelStructure(entry.kernel).label === 'required') {
    if (!Object.hasOwn(attrs, 'label')) {
      state.report('local.label.required', `Component <${entry.name}> requires a label.`, entry.node.range.start, entry.node.range.end, { key: 'local.label.required.missing', params: { component: entry.name } });
    } else if (!String(attrs.label.raw).trim()) {
      state.report('local.label.required', `Component <${entry.name}> label cannot be empty.`, attrs.label.offset, undefined, { key: 'local.label.required.empty', params: { component: entry.name } });
    }
  }
  return attrs;
}

/** Attributes the declared bindings own; the binding resolver validates them. */
function legacyBindingAttributes(entry: Entry): { bind: Set<string>; initial: Set<string> } | undefined {
  const bind = new Set<string>();
  const initial = new Set<string>();
  const scalar = kernelValueBinding(entry.kernel);
  if (scalar) {
    bind.add(scalar.bind);
    initial.add(scalar.initial);
  }
  for (const slot of kernelSlotBindings(entry.kernel)) {
    bind.add(slot.bind);
    initial.add(slot.initial);
  }
  return bind.size || initial.size ? { bind, initial } : undefined;
}

/** Decode one implicitly bound attribute for the binding resolver. */
function bindingAttributeInfo(entry: Entry, name: string, raw: string, offset: number): AttrState {
  const scalar = kernelValueBinding(entry.kernel);
  const binding = scalar && scalar.bind === name
    ? scalar
    : kernelSlotBindings(entry.kernel).find((slot) => slot.bind === name || slot.initial === name)
      ?? (scalar && scalar.initial === name ? scalar : undefined);
  const info: AttrState = { raw, offset, dynamic: false };
  if (!binding || binding.bind === name) {
    info.value = raw;
    return info;
  }
  if (binding.kind === 'number') {
    const value = parseNumberText(raw);
    if (value !== null) info.value = value;
  } else if (binding.kind === 'boolean') {
    if (raw === 'true' || raw === 'false') info.value = raw === 'true';
  } else {
    info.value = raw;
  }
  return info;
}

function kernelPropValues(prop: KernelPropSchema): readonly string[] {
  return prop.values ?? prop.enum ?? [];
}

function validatePropValue(
  entry: Entry,
  name: string,
  prop: KernelPropSchema,
  info: AttrState,
  state: CompileState,
  legacy: boolean,
): void {
  const staticKey = legacy ? 'local.host.attribute.static' : 'local.attribute.static';
  const staticCode = legacy ? 'local.host.attribute' : 'local.attribute.static';
  if (prop.kind === 'string') {
    // A dynamic string attribute (for example `date.min`) accepts one complete
    // interpolation that must evaluate to a string, or a literal fallback.
    if (prop.dynamic) {
      const full = fullInterpolation(info.raw);
      if (full) {
        info.dynamic = true;
        info.expression = full.expression;
        info.expressionOffset = info.offset + full.start;
        if (!full.expression) {
          state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset, undefined, { key: 'local.expression.empty.attribute', params: { name } });
        }
        return;
      }
    }
    if (prop.static) {
      const scanned = scanInterpolations(info.raw);
      if (scanned.segments.length || scanned.unterminated.length) {
        state.report(
          staticCode,
          `Attribute ${name} is static and cannot contain interpolations.`,
          info.offset,
          info.offset + info.raw.length,
          { key: staticKey, params: { name } },
        );
      }
      info.value = info.raw;
      return;
    }
    if (prop.dynamic === false) {
      const scanned = scanInterpolations(info.raw);
      if (scanned.segments.length || scanned.unterminated.length) {
        state.report(
          legacy ? 'local.host.attribute' : 'local.attribute.interpolation',
          `Attribute ${name} does not accept interpolations.`,
          info.offset,
          info.offset + info.raw.length,
          { key: 'local.attribute.interpolation.dynamic', params: { name } },
        );
        return;
      }
    }
    if (prop.pattern !== undefined) {
      const scanned = scanInterpolations(info.raw);
      const interpolated = scanned.segments.length > 0 || scanned.unterminated.length > 0;
      if (interpolated) {
        // A pattern constrains literal shape, so only one full interpolation may
        // replace the literal. Mixed text and unterminated braces are rejected.
        if (!singleFullInterpolation(info.raw)) {
          state.report(
            legacy ? 'local.host.attribute' : 'local.attribute.interpolation',
            `Attribute ${name} must be a literal matching ${prop.pattern} or one full interpolation.`,
            info.offset,
            info.offset + info.raw.length,
            {
              key: legacy ? 'local.host.attribute.interpolation' : 'local.attribute.interpolation.pattern',
              params: { name, pattern: prop.pattern },
            },
          );
        }
        info.value = info.raw;
        return;
      }
      let accepted = true;
      try {
        accepted = new RegExp(prop.pattern).test(info.raw);
      } catch {
        // Options validation rejects invalid patterns; do not crash if a
        // schema bypassed it.
      }
      if (!accepted) {
        if (legacy) {
          state.report(
            'local.host.attribute',
            `Attribute ${name} must match pattern ${prop.pattern}.`,
            info.offset,
            info.offset + info.raw.length,
            { key: 'local.host.attribute.pattern', params: { name, pattern: prop.pattern } },
          );
        } else {
          state.report(
            'local.attribute.type',
            `Attribute ${name} must match pattern ${prop.pattern}.`,
            info.offset,
            info.offset + info.raw.length,
            { key: 'local.attribute.type.pattern', params: { name, pattern: prop.pattern } },
          );
        }
      }
      info.value = info.raw;
      return;
    }
    info.value = info.raw;
    return;
  }

  const dynamicAllowed = prop.static !== true && prop.dynamic !== false
    && (prop.dynamic === true || legacy);
  if (prop.kind === 'number') {
    const full = dynamicAllowed ? fullInterpolation(info.raw) : null;
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
      if (legacy) {
        state.report(
          'local.host.attribute',
          `Attribute ${name} requires a number, got "${info.raw}".`,
          info.offset,
          info.offset + info.raw.length,
          { key: 'local.host.attribute.type', params: { name, value: info.raw, kind: 'number' } },
        );
      } else {
        state.report(
          'local.attribute.type',
          `Attribute ${name} requires a number${prop.dynamic ? ' or a full number interpolation' : ''}, got "${info.raw}".`,
          info.offset,
          info.offset + info.raw.length,
          { key: prop.dynamic ? 'local.attribute.type.number-interpolation' : 'local.attribute.type.number', params: { name, value: info.raw } },
        );
      }
      return;
    }
    if (prop.integer && !Number.isInteger(value)) {
      if (legacy) {
        state.report('local.host.attribute', `Attribute ${name} requires an integer, got "${info.raw}".`, info.offset, info.offset + info.raw.length, { key: 'local.attribute.type.integer', params: { name } });
      } else {
        state.report('local.attribute.type', `Attribute ${name} requires an integer.`, info.offset, undefined, { key: 'local.attribute.type.integer', params: { name } });
      }
    }
    if (prop.positive && !(value > 0)) {
      state.report('local.attribute.type', `Attribute ${name} requires a positive number.`, info.offset, undefined, { key: 'local.attribute.type.positive', params: { name } });
    }
    if (prop.min !== undefined && value < prop.min) {
      if (legacy) {
        state.report('local.host.attribute', `Attribute ${name} must be at least ${prop.min}, got "${info.raw}".`, info.offset, info.offset + info.raw.length, { key: 'local.attribute.range.min', params: { name, min: prop.min } });
      } else {
        state.report('local.attribute.range', `Attribute ${name} must be at least ${prop.min}.`, info.offset, undefined, { key: 'local.attribute.range.min', params: { name, min: prop.min } });
      }
    }
    if (prop.max !== undefined && value > prop.max) {
      if (legacy) {
        state.report('local.host.attribute', `Attribute ${name} must be at most ${prop.max}, got "${info.raw}".`, info.offset, info.offset + info.raw.length, { key: 'local.attribute.range.max', params: { name, max: prop.max } });
      } else {
        state.report('local.attribute.range', `Attribute ${name} must be at most ${prop.max}.`, info.offset, undefined, { key: 'local.attribute.range.max', params: { name, max: prop.max } });
      }
    }
    info.value = value;
    return;
  }

  if (prop.kind === 'boolean') {
    const full = dynamicAllowed ? fullInterpolation(info.raw) : null;
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
    if (legacy) {
      state.report(
        'local.host.attribute',
        `Component <${entry.name}> attribute ${name} requires a boolean, got "${info.raw}".`,
        info.offset,
        info.offset + info.raw.length,
        { key: 'local.host.attribute.type', params: { name, value: info.raw, kind: 'boolean' } },
      );
    } else {
      state.report(
        'local.attribute.type',
        `Attribute ${name} requires true or false${prop.dynamic ? ', or a full boolean interpolation' : ''}.`,
        info.offset,
        info.offset + info.raw.length,
        { key: prop.dynamic ? 'local.attribute.type.boolean-interpolation' : 'local.attribute.type.boolean', params: { name } },
      );
    }
    return;
  }

  // enum
  const full = dynamicAllowed ? fullInterpolation(info.raw) : null;
  if (full) {
    info.dynamic = true;
    info.expression = full.expression;
    info.expressionOffset = info.offset + full.start;
    if (!full.expression) {
      state.report('local.expression.empty', `Attribute ${name} interpolation cannot be empty.`, info.expressionOffset, undefined, { key: 'local.expression.empty.attribute', params: { name } });
    }
    return;
  }
  const values = kernelPropValues(prop);
  if (!values.includes(info.raw)) {
    if (legacy) {
      state.report(
        'local.host.attribute',
        `Attribute ${name} must be one of ${values.join(' / ')}, got "${info.raw}".`,
        info.offset,
        info.offset + info.raw.length,
        { key: 'local.host.attribute.enum', params: { name, values: values.join(' / '), value: info.raw } },
      );
    } else {
      state.report(
        'local.attribute.type',
        `Attribute ${name} must be one of ${values.join(' / ')}, got "${info.raw}".`,
        info.offset,
        info.offset + info.raw.length,
        { key: 'local.attribute.type.enum', params: { name, values: values.join(' / '), value: info.raw } },
      );
    }
    return;
  }
  info.value = info.raw;
}

function numberValue(entry: Entry, attrs: AttrMap, name: string): number | undefined {
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'number' ? info.value : undefined;
  const fallback = entry.kernel.props[name]?.default;
  return typeof fallback === 'number' ? fallback : undefined;
}

/** A binding step referenced by a prop must be static and positive. */
function validateBindingConstraintAttributes(entry: Entry, state: CompileState): void {
  // Kernel manifests validate step props through their declared prop schema;
  // only phase-one host adapters keep this extra adapter check.
  if (!entry.legacy) return;
  const binding = kernelValueBinding(entry.kernel);
  const step = binding?.kind === 'number' ? binding.constraints?.step : undefined;
  if (!step || !('prop' in step)) return;
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const propName = step.prop;
  const prop = entry.kernel.props[propName];
  const info = attrs[propName];
  const offset = info?.offset ?? attributeOffset(state, entry.node, propName);
  if (!info) {
    const fallback = prop?.default;
    if (typeof fallback !== 'number') {
      state.report(
        'local.host.attribute',
        `Attribute ${propName} is required by the step constraint.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.host.attribute.type', params: { name: propName, value: 'missing', kind: 'number' } },
      );
    } else if (!(fallback > 0)) {
      state.report(
        'local.host.attribute',
        `Attribute ${propName} requires a positive number.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.attribute.type.positive', params: { name: propName } },
      );
    }
    return;
  }
  if (info.dynamic) {
    state.report(
      'local.host.attribute',
      `Attribute ${propName} is used as a step and must be a static number.`,
      offset,
      offset + info.raw.length,
      { key: 'local.host.attribute.static', params: { name: propName } },
    );
  } else if (typeof info.value === 'number' && !(info.value > 0)) {
    state.report(
      'local.host.attribute',
      `Attribute ${propName} requires a positive number.`,
      offset,
      offset + info.raw.length,
      { key: 'local.attribute.type.positive', params: { name: propName } },
    );
  }
}

function validateAttributeRelations(entry: Entry, state: CompileState): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  for (const issue of kernelAttributeIssues(entry.kernel, attrs, entry.node.range)) {
    state.report(
      issue.code,
      issue.message,
      issue.start,
      issue.end,
      { key: issue.key, ...(issue.params ? { params: issue.params } : {}) },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Children                                                            */
/* ------------------------------------------------------------------ */

interface ChildComponent {
  node: LocalNode;
  name: string;
}

function componentChildren(entry: Entry, state: CompileState): ChildComponent[] {
  const children: ChildComponent[] = [];
  for (const node of entry.node.children ?? []) {
    if ((node.type === 'component' || node.type === 'hostComponent') && node.name && state.schemaByName.has(node.name)) {
      children.push({ node, name: node.name });
    }
  }
  return children;
}

function projectionMap(
  state: CompileState,
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
  state: CompileState,
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
  return structure.max ?? structure.maxItems ?? structure.maxItemsCount ?? structure.maxItems;
}

const KERNEL_INLINE_TYPES = new Set([
  'text', 'emphasis', 'strong', 'delete', 'underline', 'mark', 'link', 'image',
  'inlineCode', 'inlineMath', 'interpolation', 'break', 'comment', 'fallback',
  'footnoteReference',
]);

function isInlineBody(node: LocalNode): boolean {
  return KERNEL_INLINE_TYPES.has(node.type) && (node.children ?? []).every(isInlineBody);
}

function reportInlineBody(entry: Entry, kids: LocalNode[], state: CompileState, strict: boolean): void {
  if (strict) {
    const body = kids.length === 1 && kids[0].type === 'paragraph' ? kids[0].children ?? [] : kids;
    if (!body.every(isInlineBody)) {
      state.report(
        'local.structure.children',
        `<${entry.name}> only accepts inline Markdown.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.structure.inline-only', params: { name: entry.name } },
      );
    }
  }
  for (const child of kids) {
    if (hasComponent(child)) {
      state.report(
        'local.structure.children',
        `The body of <${entry.name}> cannot contain other interactive components.`,
        child.range.start,
        child.range.end,
        { key: 'local.structure.no-nested-components', params: { name: entry.name } },
      );
    }
  }
}

function reportNoComponents(entry: Entry, state: CompileState): void {
  const walk = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      if (node.type === 'component' || node.type === 'hostComponent') {
        state.report(
          'local.structure.children',
          `The body of <${entry.name}> cannot contain interactive components.`,
          node.range.start,
          node.range.end,
          { key: 'local.structure.no-components', params: { name: entry.name } },
        );
        continue;
      }
      if (node.children) walk(node.children);
    }
  };
  walk(entry.node.children ?? []);
}

function validateOptionsBody(
  entry: Entry,
  state: CompileState,
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
    state.report(
      'local.structure.children',
      `<${entry.name}> requires at least one <${child} value="...">.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: 'local.structure.options.needed', params: { name: entry.name } },
    );
  }
  for (const candidate of children) {
    if (candidate.name !== child) {
      state.report(
        'local.structure.children',
        `<${entry.name}> can only contain <${child}>.`,
        candidate.node.range.start,
        candidate.node.range.end,
        { key: 'local.structure.options.only', params: { name: entry.name } },
      );
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name === child
  ))) {
    state.report(
      'local.structure.children',
      `<${entry.name}> can only contain <${child}>.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: 'local.structure.options.only', params: { name: entry.name } },
    );
  }
  if (options.length > maxItems) {
    state.report(
      'local.budget.array',
      `<${entry.name}> options exceed the limit of ${maxItems}.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: 'local.budget.array.options', params: { name: entry.name, limit: maxItems } },
    );
  }
  const values: string[] = [];
  for (const option of options) {
    const optionAttrs = state.attrs.get(option.node.id) ?? {};
    const value = typeof optionAttrs[valueAttribute]?.value === 'string' ? optionAttrs[valueAttribute].value : '';
    if (!value) {
      state.report('local.option.value', `<${child}> requires a non-empty ${valueAttribute}.`, option.node.range.start, option.node.range.end, { key: 'local.option.value.required' });
      continue;
    }
    if (forbidSeparator !== undefined && value.includes(forbidSeparator)) {
      state.report(
        'local.option.value',
        `<${entry.name}> option values cannot contain ${forbidSeparator}: "${value}".`,
        option.node.range.start,
        option.node.range.end,
        { key: 'local.option.value.comma', params: { value } },
      );
      continue;
    }
    if (unique && values.includes(value)) {
      state.report(
        'local.option.value',
        `Option values in <${entry.name}> must be unique; duplicate value "${value}".`,
        option.node.range.start,
        option.node.range.end,
        { key: 'local.option.value.duplicate', params: { name: entry.name, value } },
      );
      continue;
    }
    if ((option.node.children ?? []).some(hasComponent)) {
      state.report('local.structure.children', `The body of <${child}> cannot contain interactive components.`, option.node.range.start, option.node.range.end, { key: 'local.structure.option.no-components' });
    }
    values.push(value);
  }
  setProjection(state, entry, 'options', values);
  void attrs;
}

function validateValueSequence(
  entry: Entry,
  state: CompileState,
  child: string,
  valueAttribute: string,
  generatedPrefix: string,
  duplicateCode: string,
): void {
  const children = componentChildren(entry, state);
  const items = children.filter((candidate) => candidate.name === child);
  if (!items.length) {
    state.report(
      'local.structure.children',
      `<${entry.name}> requires at least one <${child}>.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: `local.structure.${entry.name}.needs-${child}` },
    );
  }
  for (const candidate of children) {
    if (candidate.name !== child) {
      state.report(
        'local.structure.children',
        `<${entry.name}> can only contain <${child}>.`,
        candidate.node.range.start,
        candidate.node.range.end,
        { key: `local.structure.${entry.name}.only-${child}` },
      );
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name === child
  ))) {
    state.report(
      'local.structure.children',
      `<${entry.name}> can only contain <${child}>.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: `local.structure.${entry.name}.only-${child}` },
    );
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
  state: CompileState,
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
    state.report(
      'local.structure.children',
      `<${entry.name}> requires at least ${min} ${label}.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: `local.structure.${entry.name}.needs-${allowed[0]}` },
    );
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
      state.report(
        'local.structure.children',
        `Direct children of <${entry.name}> must be ${label}.`,
        candidate.node.range.start,
        candidate.node.range.end,
        { key: onlyCode ?? `local.structure.${entry.name}.only` },
      );
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name && state.schemaByName.has(kid.name)
  ))) {
    state.report(
      'local.structure.children',
      `Direct children of <${entry.name}> must be ${label}.`,
      entry.node.range.start,
      entry.node.range.end,
      { key: onlyCode ?? `local.structure.${entry.name}.only` },
    );
  }
}

function validateDiagramBody(
  entry: Entry,
  state: CompileState,
  rule: Extract<KernelRule, { kind: 'diagram-body' }>,
): void {
  const children = componentChildren(entry, state);
  const nodes = children.filter((child) => child.name === rule.node);
  const edges = children.filter((child) => child.name === rule.edge);
  if (!nodes.length) {
    state.report('local.diagram.node', `<${entry.name}> requires at least one <${rule.node}>.`, entry.node.range.start, entry.node.range.end, { key: 'local.diagram.node.required' });
  }
  for (const child of children) {
    if (child.name !== rule.node && child.name !== rule.edge) {
      state.report('local.structure.children', `<${entry.name}> can only contain <${rule.node}> and <${rule.edge}>.`, child.node.range.start, child.node.range.end, { key: 'local.structure.diagram.only' });
    }
  }
  if (meaningful(entry.node.children).some((kid) => !(
    (kid.type === 'component' || kid.type === 'hostComponent') && kid.name
    && (kid.name === rule.node || kid.name === rule.edge)
  ))) {
    state.report('local.structure.children', `<${entry.name}> can only contain <${rule.node}> and <${rule.edge}>.`, entry.node.range.start, entry.node.range.end, { key: 'local.structure.diagram.only' });
  }

  const ids: string[] = [];
  for (const node of nodes) {
    const nodeAttrs = state.attrs.get(node.node.id) ?? {};
    const rawId = nodeAttrs[rule.id]?.value;
    const id = typeof rawId === 'string' ? rawId : '';
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

function validateQuizBody(
  entry: Entry,
  state: CompileState,
  attrs: AttrMap,
  rule: Extract<KernelRule, { kind: 'quiz-body' }>,
): void {
  const type = typeof attrs[rule.type]?.value === 'string' ? String(attrs[rule.type].value) : 'choice';
  const answer = staticAttributeString(entry, attrs, rule.answer) ?? '';
  if (!answer.trim()) {
    state.report('local.quiz.answer', `<${entry.name}> requires a non-empty ${rule.answer}.`, attrs[rule.answer]?.offset ?? entry.node.range.start, undefined, { key: 'local.quiz.answer.required' });
  }
  if (type === 'number') {
    if (meaningful(entry.node.children).length) {
      state.report(
        'local.structure.children',
        `A numeric <${entry.name}> cannot have body content; use type="choice" for option-based quizzes.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.structure.quiz.numeric-no-body' },
      );
    }
    if (answer.trim() && parseNumberText(answer) === null) {
      state.report('local.quiz.answer', `A numeric <${entry.name}> answer must be a finite number.`, attrs[rule.answer]?.offset ?? entry.node.range.start, undefined, { key: 'local.quiz.answer.numeric' });
    }
    const tolerance = numberValue(entry, attrs, rule.tolerance);
    if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance < 0)) {
      state.report('local.constraint', `<${entry.name}> tolerance must be a nonnegative finite number.`, attrs[rule.tolerance]?.offset ?? entry.node.range.start, undefined, { key: 'local.constraint.quiz-tolerance' });
    }
    return;
  }
  validateOptionsBody(entry, state, attrs, rule.child, rule.valueAttribute, true, Math.min(rule.max ?? MAX_LOCAL_ARRAY_LENGTH, MAX_LOCAL_ARRAY_LENGTH), undefined);
  const options = state.options.get(entry.node.id) ?? [];
  if (answer.trim() && options.length && !options.includes(answer)) {
    state.report(
      'local.quiz.answer',
      `<${entry.name}> answer "${answer}" is not one of the option values: ${options.join(', ')}.`,
      attrs[rule.answer]?.offset ?? entry.node.range.start,
      undefined,
      { key: 'local.quiz.answer.not-option', params: { answer, options: options.join(', ') } },
    );
  }
}

function validateChildren(entry: Entry, state: CompileState): void {
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

function validateChecklist(
  entry: Entry,
  state: CompileState,
  itemLimit: number = MAX_LOCAL_ARRAY_LENGTH,
): ChecklistInfo {
  const cached = state.checklists.get(entry.node.id);
  if (cached) return cached;
  const kids = meaningful(entry.node.children);
  const lists = kids.filter((kid) => kid.type === 'list');
  if (kids.length !== 1 || lists.length !== 1) {
    state.report(
      'local.checklist.body',
      `The body of <${entry.name}> must be exactly one single-level Markdown task list.`,
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
    state.report('local.checklist.body', `<${entry.name}> requires at least one task list item.`, list.range.start, list.range.end, { key: 'local.checklist.body.item-required' });
  }
  if (items.length > itemLimit) {
    state.report(
      'local.budget.array',
      `<${entry.name}> items exceed the limit of ${itemLimit}.`,
      list.range.start,
      list.range.end,
      { key: 'local.checklist.body.items-limit', params: { limit: itemLimit } },
    );
  }
  items.slice(0, itemLimit).forEach((item, index) => {
    if (item.type !== 'listItem' || item.checked === null || item.checked === undefined) {
      state.report('local.checklist.body', `<${entry.name}> can only contain task list items (- [ ] / - [x]).`, item.range.start, item.range.end, { key: 'local.checklist.body.task-only' });
      return;
    }
    if ((item.children ?? []).some((child) => child.type === 'list')) {
      state.report('local.checklist.body', `<${entry.name}> does not support nested lists.`, item.range.start, item.range.end, { key: 'local.checklist.body.no-nested' });
    }
    if (hasComponent(item)) {
      state.report('local.checklist.body', `<${entry.name}> items cannot contain interactive components.`, item.range.start, item.range.end, { key: 'local.checklist.body.no-components' });
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
  binding: KernelBindingSchema;
  members: GroupMember[];
}

function requireBindingAttribute(entry: Entry, binding: KernelBindingSchema, attrs: AttrMap, state: CompileState): void {
  if (!binding.required || Object.hasOwn(attrs, binding.bind)) return;
  state.report('local.attribute.required', `Component <${entry.name}> requires attribute "${binding.bind}".`,
    entry.node.range.start, entry.node.range.end,
    { key: 'local.attribute.required', params: { component: entry.name, name: binding.bind } });
}

function resolveBindings(state: CompileState): Record<string, LocalBinding> {
  const groups = new Map<string, Group>();
  for (const entry of state.entries) {
    const binding = kernelValueBinding(entry.kernel);
    if (!binding) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    // Activation attributes make the binding conditional (table/chart `key`).
    if (binding.requiresAttributes?.some((attribute) => !Object.hasOwn(attrs, attribute))) continue;
    requireBindingAttribute(entry, binding, attrs, state);
    const rawBind = typeof attrs[binding.bind]?.value === 'string' ? String(attrs[binding.bind].value) : '';
    let key = rawBind ? rawBind : `@${entry.node.id}`;
    if (Object.hasOwn(attrs, binding.bind)) {
      const offset = attrs[binding.bind].offset ?? entry.node.range.start;
      if (rawBind.length > MAX_LOCAL_NAME_LENGTH) {
        state.report(
          'local.budget.identifier',
          `Parameter name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`,
          offset,
          undefined,
          { key: 'local.budget.identifier', params: { limit: MAX_LOCAL_NAME_LENGTH } },
        );
        key = `@${entry.node.id}`;
      } else if (!IDENTIFIER.test(rawBind)) {
        state.report(
          'local.binding.name',
          `Parameter name "${rawBind}" must match [A-Za-z_][A-Za-z0-9_]*.`,
          offset,
          undefined,
          { key: 'local.binding.name', params: { name: rawBind } },
        );
        key = `@${entry.node.id}`;
      } else if (RESERVED_NAMES.has(rawBind) || EXTRA_RESERVED.has(rawBind)) {
        state.report(
          'local.binding.reserved',
          `Parameter name "${rawBind}" is reserved; choose another name.`,
          offset,
          undefined,
          { key: 'local.binding.reserved', params: { name: rawBind } },
        );
        key = `@${entry.node.id}`;
      }
    }
    const existing = groups.get(key);
    if (existing) existing.members.push({ entry, attrs });
    else groups.set(key, { key, binding, members: [{ entry, attrs }] });
  }

  const bindings: Record<string, LocalBinding> = {};
  for (const group of groups.values()) {
    const family = group.binding.family;
    // Checklist defaults populate a separate validation index and must keep
    // their original side effects. Other groups depend on their own members,
    // constraints and already-resolved option sets, not unrelated bindings.
    const cacheKey = state.semantic && family !== 'checklist'
      ? JSON.stringify([group.key, group.members.map(({ entry }) => [
          entry.name,
          entry.node.id,
          entry.node.attrs,
          bindingOptions(entry, state, entry.kernel, family),
        ])])
      : undefined;
    const cached = cacheKey ? state.semantic!.binding<LocalBinding>(cacheKey) : undefined;
    const count = state.diagnostics.length;
    const binding = cached ? plainCompiledData(cached) : resolveGroup(group, state);
    if (!cached && binding && cacheKey && count < MAX_LOCAL_DIAGNOSTICS && state.diagnostics.length === count) {
      state.semantic!.rememberBinding(cacheKey, plainCompiledData(binding));
    }
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

/** Flatten a node tree in document order. */
function flattenNodes(nodes: LocalNode[], out: LocalNode[] = []): LocalNode[] {
  for (const node of nodes) {
    out.push(node);
    if (node.children) flattenNodes(node.children, out);
  }
  return out;
}

/*
 * Phase one resolved host bindings in a second engine here. Phase two lowers
 * every input adapter into the same manifest registry, so `resolveBindings`
 * above is the only binding resolver.
 */


type NumericConstraints = KernelNumericConstraints;

function numericConstraints(entry: Entry, attrs: AttrMap): NumericConstraints {
  const binding = kernelValueBinding(entry.kernel);
  return binding ? kernelNumericConstraints(entry.kernel, binding, attrs) : { step: 1 };
}

const sameNumericBound = kernelSameNumericBound;
const describeConstraints = kernelDescribeConstraints;

function comparedAttribute(member: GroupMember, name: string): string | undefined {
  const info = member.attrs[name];
  if (!info) return undefined;
  if (info.dynamic) return `{{ ${(info.expression ?? '').trim()} }}`;
  return typeof info.value === 'string' ? info.value : String(info.value ?? '');
}

function resolveGroup(group: Group, state: CompileState): LocalBinding | null {
  const first = group.members[0];
  const bindingSchema = group.binding;
  const family = bindingSchema.family;

  for (const member of group.members.slice(1)) {
    const memberBinding = kernelValueBinding(member.entry.kernel);
    if (!memberBinding || memberBinding.family !== family || memberBinding.kind !== bindingSchema.kind) {
      state.report(
        'local.binding.type',
        `Parameter "${group.key}" is already declared as ${typeName(bindingSchema.kind)} by <${first.entry.name}> and cannot also bind <${member.entry.name}>.`,
        member.entry.node.range.start,
        member.entry.node.range.end,
        { key: 'local.binding.type', params: { key: group.key, kind: typeName(bindingSchema.kind), first: first.entry.name, second: member.entry.name } },
      );
    }
  }

  const exclusiveOwner = group.members.find((member) => kernelValueBinding(member.entry.kernel)?.exclusive === true);
  if (exclusiveOwner && group.members.length > 1) {
    for (const member of group.members) {
      if (member === exclusiveOwner) continue;
      state.report(
        'local.binding.exclusive',
        `Parameter "${group.key}" of <${exclusiveOwner.entry.name}> can only be owned by one component and cannot be shared with <${member.entry.name}>.`,
        member.entry.node.range.start,
        member.entry.node.range.end,
        { key: 'local.binding.exclusive', params: { key: group.key, first: exclusiveOwner.entry.name, second: member.entry.name } },
      );
    }
  }

  const options = bindingOptions(first.entry, state, first.entry.kernel, family);
  let constraints: NumericConstraints | undefined;
  if (bindingSchema.kind === 'number') {
    constraints = numericConstraints(first.entry, first.attrs);
    for (const member of group.members.slice(1)) {
      const other = numericConstraints(member.entry, member.attrs);
      if (
        !sameNumericBound(other, constraints, 'min')
        || !sameNumericBound(other, constraints, 'max')
        || other.step !== constraints.step
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
      const other = bindingOptions(member.entry, state, member.entry.kernel, family);
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

  // Attributes declared comparable (date bounds) participate in shared writes.
  const compare = new Set(bindingSchema.compare ?? []);
  for (const rule of kernelRules(first.entry.kernel)) {
    if (rule.kind !== 'date-bounds') continue;
    if (rule.min) compare.add(rule.min);
    if (rule.max) compare.add(rule.max);
  }
  for (const name of compare) {
    const expected = comparedAttribute(first, name);
    for (const member of group.members.slice(1)) {
      if (comparedAttribute(member, name) !== expected) {
        state.report(
          'local.binding.constraint',
          `Parameter "${group.key}" must use the same ${name} bound: <${first.entry.name}> and <${member.entry.name}> differ.`,
          member.entry.node.range.start,
          member.entry.node.range.end,
          { key: 'local.binding.constraint', params: { key: group.key, first: first.entry.name, second: member.entry.name, firstConstraints: `${name} bounds`, secondConstraints: `${name} bounds` } },
        );
      }
    }
  }

  const maxItems = bindingSchema.maxItems
    ? kernelMaxItems(first.entry.kernel, bindingSchema, first.attrs)
    : undefined;
  const explicit = group.members.filter((member) => Object.hasOwn(member.attrs, bindingSchema.initial));
  let initial: LocalValue;
  if (explicit.length > 1) {
    // Precompute lines once; report only a bounded sample of the conflicts.
    const conflictLines = explicit.map((member) => lineAt(state, member.attrs[bindingSchema.initial].offset));
    const reported = Math.min(explicit.length, MAX_INITIAL_CONFLICT_DIAGNOSTICS);
    for (let index = 0; index < reported; index += 1) {
      const peers: number[] = [];
      for (let step = 1; step < conflictLines.length && peers.length < MAX_CONFLICT_PEERS; step += 1) {
        peers.push(conflictLines[(index + step) % conflictLines.length]);
      }
      state.report(
        'local.initial.duplicate',
        `Parameter "${group.key}" has multiple explicit initial values (${explicit.length} in total${peers.length ? `; see also line ${peers.join(', ')}` : ''}).`,
        explicit[index].attrs[bindingSchema.initial].offset,
        undefined,
        peers.length
          ? { key: 'local.initial.duplicate-peers', params: { key: group.key, count: explicit.length, lines: peers.join(', ') } }
          : { key: 'local.initial.duplicate', params: { key: group.key, count: explicit.length } },
      );
    }
  }
  if (family === 'multi-select') {
    initial = explicit.length
      ? multiSelectInitial(explicit[0], options, maxItems, state, bindingSchema)
      : [];
  } else if (family === 'collection') {
    initial = explicit.length
      ? collectionInitial(explicit[0], state, bindingSchema)
      : [];
  } else if (explicit.length > 0) {
    initial = memberInitial(explicit[0], state, bindingSchema, options);
  } else {
    initial = defaultInitial(first, state, bindingSchema, options, constraints);
  }

  if (family === 'checklist' && !Array.isArray(initial)) initial = [];
  validateInitialValue(group, first, initial, bindingSchema, options, constraints, state);
  validateStaticInitial(group, initial, state);

  const binding: LocalBinding = {
    family: bindingSchema.family as LocalBindingFamily,
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
  if (family === 'multi-select') binding.maxItems = maxItems ?? options.length;
  else if (maxItems !== undefined) binding.maxItems = maxItems;
  return binding;
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
 * A shared string binding must satisfy every owner's runtime value rules.
 * Empty values stay allowed at compile time so an optional required input can
 * still start empty; writes are enforced by the runtime.
 */
function validateStaticInitial(group: Group, initial: LocalValue, state: CompileState, initialOffset?: number): void {
  if (typeof initial !== 'string' || initial === '') return;
  const first = group.members[0];
  const initialAttribute = kernelValueBinding(first.entry.kernel)?.initial ?? 'initial';
  const offset = initialOffset ?? first.attrs[initialAttribute]?.offset ?? first.entry.node.range.start;
  const length = countLocalCodePoints(initial);
  for (const member of group.members) {
    const { entry, attrs } = member;
    for (const rule of kernelValueRules(entry.kernel)) {
      if (rule.kind === 'length') {
        const minLength = staticAttributeNumber(entry, attrs, rule.min) ?? 0;
        const maxLength = staticAttributeNumber(entry, attrs, rule.max);
        if (minLength > 0 && length < minLength) {
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
      } else if (rule.kind === 'email') {
        const type = staticAttributeString(entry, attrs, rule.type) ?? 'text';
        if (type === rule.value) {
          if (initial.length > MAX_LOCAL_EMAIL_LENGTH || !isLocalEmail(initial)) {
            state.report('local.initial.email', `Initial value of parameter "${group.key}" is not a valid email address.`, offset, undefined, { key: 'local.initial.email', params: { key: group.key } });
          }
        }
      } else if (rule.kind === 'date' && isKernelDate(initial)) {
        const min = staticAttributeString(entry, attrs, rule.min);
        const max = staticAttributeString(entry, attrs, rule.max);
        if (min && isKernelDate(min) && initial < min) {
          state.report('local.initial.range', `Initial value ${initial} of parameter "${group.key}" is earlier than the minimum date ${min} of <${entry.name}>.`, offset, undefined, { key: 'local.initial.date.min', params: { key: group.key, value: initial, min } });
        }
        if (max && isKernelDate(max) && initial > max) {
          state.report('local.initial.range', `Initial value ${initial} of parameter "${group.key}" is later than the maximum date ${max} of <${entry.name}>.`, offset, undefined, { key: 'local.initial.date.max', params: { key: group.key, value: initial, max } });
        }
      }
    }
  }
}

function staticAttributeNumber(entry: Entry, attrs: AttrMap, name: string | undefined): number | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'number' ? info.value : undefined;
  const fallback = entry.kernel.props[name]?.default;
  return typeof fallback === 'number' ? fallback : undefined;
}

function staticAttributeString(entry: Entry, attrs: AttrMap, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'string' ? info.value : undefined;
  const fallback = entry.kernel.props[name]?.default;
  return typeof fallback === 'string' ? fallback : undefined;
}

function bindingOptions(
  entry: Entry,
  state: CompileState,
  kernel: KernelComponentSchema,
  family: string,
): string[] {
  const kind = kernelProjectionForFamily(family);
  if (!kind) return [];
  if (kind === 'checklist') {
    const limit = kernelRule(kernel, 'checklist-body')?.itemLimit;
    return validateChecklist(entry, state, limit).ids;
  }
  if (kind === 'selection') return state.selections.get(entry.node.id) ?? [''];
  const projected = projectionMap(state, kind).get(entry.node.id);
  if (projected !== undefined) return projected;
  // Host/static choice bindings carry their options on the binding itself.
  return [...(kernelValueBinding(kernel)?.options ?? [])];
}

/** Parse a JSON array literal for a `collection` family binding. */
function collectionInitial(
  member: GroupMember,
  state: CompileState,
  binding: KernelBindingSchema,
): LocalValue {
  const info = member.attrs[binding.initial];
  if (!info) return [];
  const raw = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    state.report(
      'local.initial.type',
      `Initial value of parameter "${member.entry.node.id}" must be a JSON array.`,
      info.offset,
      undefined,
      { key: 'local.initial.type.collection', params: { key: member.entry.node.id } },
    );
    return [];
  }
  if (!Array.isArray(parsed)) {
    state.report(
      'local.initial.type',
      `Initial value of parameter "${member.entry.node.id}" must be a JSON array.`,
      info.offset,
      undefined,
      { key: 'local.initial.type.collection', params: { key: member.entry.node.id } },
    );
    return [];
  }
  if (binding.kind === 'number-array') {
    if (!parsed.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
      state.report(
        'local.initial.type',
        `Initial value of parameter "${member.entry.node.id}" must contain only finite numbers.`,
        info.offset,
        undefined,
        { key: 'local.initial.type.number-array', params: { key: member.entry.node.id } },
      );
      return [];
    }
    return parsed as number[];
  }
  if (!parsed.every((entry) => typeof entry === 'string')) {
    state.report(
      'local.initial.type',
      `Initial value of parameter "${member.entry.node.id}" must contain only strings.`,
      info.offset,
      undefined,
      { key: 'local.initial.type.array', params: { key: member.entry.node.id } },
    );
    return [];
  }
  return parsed as string[];
}

/** Parse the comma-separated `initial` of a multi-select binding into an array. */
function multiSelectInitial(
  member: GroupMember,
  options: string[],
  maxSelected: number | undefined,
  state: CompileState,
  binding: KernelBindingSchema,
): string[] {
  const info = member.attrs[binding.initial];
  if (!info) return [];
  const raw = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  const chosen: string[] = [];
  for (const part of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!options.includes(part)) {
      state.report(
        'local.initial.option',
        `Initial value "${part}" of parameter "${member.entry.node.id}" is not an option of <${member.entry.name}>.`,
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
      `Initial values of <${member.entry.name}> exceed max-selected ${maxSelected}.`,
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
  binding: KernelBindingSchema,
  options: string[],
): LocalValue {
  const info = member.attrs[binding.initial];
  const entry = member.entry;
  const constraints = numericConstraints(entry, member.attrs);
  if (!info) return defaultInitial(member, state, binding, options, undefined);
  if (binding.kind === 'null') {
    if (info.raw.trim() !== 'null') state.report('local.initial.type', `Initial value of parameter "${entry.node.id}" must be null.`, info.offset, undefined, { key: 'local.initial.type', params: { name: entry.node.id } });
    return null;
  }
  if (entry.legacy) {
    const scanned = scanInterpolations(info.raw);
    if (scanned.segments.length || scanned.unterminated.length) {
      state.report(
        'local.host.attribute',
        'Attribute initial is static and cannot contain interpolations.',
        info.offset,
        info.offset + info.raw.length,
        { key: 'local.host.attribute.static', params: { name: binding.initial } },
      );
      const derived = kernelDefaultInitial(binding.initialRule, constraints, options);
      return 'value' in derived ? derived.value : '';
    }
  }
  if (binding.kind === 'number') {
    if (typeof info.value === 'number') return info.value;
    state.report('local.initial.type', `Initial value of parameter "${entry.node.id}" has the wrong type.`, info.offset, undefined, { key: 'local.initial.type', params: { name: entry.node.id } });
    return 0;
  }
  if (binding.kind === 'boolean') {
    if (typeof info.value === 'boolean') return info.value;
    state.report('local.initial.type', `Initial value of parameter "${entry.node.id}" has the wrong type.`, info.offset, undefined, { key: 'local.initial.type', params: { name: entry.node.id } });
    return false;
  }
  const value = typeof info.value === 'string' ? info.value : String(info.value ?? '');
  if (kernelValueRules(entry.kernel).some((rule) => rule.kind === 'date') && !isKernelDate(value)) {
    state.report('local.initial.date', `Initial date "${value}" is not a valid YYYY-MM-DD.`, info.offset, undefined, { key: 'local.initial.date', params: { value } });
  }
  if (options.length && !options.includes(value) && binding.family !== 'text' && binding.family !== 'date') {
    state.report('local.initial.option', `Initial value "${value}" is not an available option: ${options.join(', ')}.`, info.offset, undefined, { key: 'local.initial.value.option', params: { value, options: options.join(', ') } });
  }
  return value;
}

function defaultInitial(
  member: GroupMember,
  state: CompileState,
  binding: KernelBindingSchema,
  options: string[],
  constraints: NumericConstraints | undefined,
): LocalValue {
  const entry = member.entry;
  if (binding.kind === 'null') return null;
  if (binding.family === 'checklist') {
    return [...validateChecklist(entry, state, kernelRule(entry.kernel, 'checklist-body')?.itemLimit).checked];
  }
  const local = constraints ?? numericConstraints(entry, member.attrs);
  const derived = kernelDefaultInitial(binding.initialRule, local, options);
  if ('value' in derived && derived.value !== undefined) return derived.value;
  if ('error' in derived && derived.error === 'no-step') {
    state.report(
      'local.initial.range',
      `Parameter "${entry.node.id}" has no valid step value within range [${local.min ?? '-∞'}, ${local.max ?? '∞'}].`,
      entry.node.range.start,
      entry.node.range.end,
      { key: 'local.initial.no-step', params: { key: entry.node.id, min: local.min ?? '-∞', max: local.max ?? '∞' } },
    );
    return 0;
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
  binding: KernelBindingSchema,
  options: string[],
  constraints: NumericConstraints | undefined,
  state: CompileState,
): void {
  const key = group.key;
  const offset = first.attrs[binding.initial]?.offset ?? first.entry.node.range.start;
  if (binding.kind === 'array' || binding.kind === 'number-array') {
    if (!Array.isArray(value)) {
      state.report('local.initial.type', `Initial value of parameter "${key}" must be an array.`, offset, undefined, { key: 'local.initial.type.array', params: { key } });
      return;
    }
    const budget = localValueBudgetIssue(value);
    if (budget) {
      state.report('local.budget.array', `Initial value of parameter "${key}" exceeds the value budget.`, offset, undefined, { key: budget.key, params: { ...budget.params, key } });
      return;
    }
    if (binding.kind === 'number-array') {
      if (!value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        state.report('local.initial.type', `Initial value of parameter "${key}" must contain only finite numbers.`, offset, undefined, { key: 'local.initial.type.number-array', params: { key } });
        return;
      }
    } else {
      if (!value.every((entry) => typeof entry === 'string')) {
        state.report('local.initial.type', `Initial value of parameter "${key}" must contain only strings.`, offset, undefined, { key: 'local.initial.type.array', params: { key } });
        return;
      }
      if (options.length) {
        for (const entry of value as string[]) {
          if (!options.includes(entry)) {
            state.report('local.initial.option', `Initial value "${entry}" is not an available option: ${options.join(', ')}.`, offset, undefined, { key: 'local.initial.value.option', params: { value: entry, options: options.join(', ') } });
          }
        }
      }
    }
    const maxItems = kernelMaxItems(first.entry.kernel, binding, first.attrs);
    if (maxItems !== undefined && value.length > maxItems) {
      state.report('local.initial.range', `Initial value of parameter "${key}" exceeds the ${maxItems}-item limit.`, offset, undefined, { key: 'local.initial.value.max-items', params: { key, max: maxItems } });
    }
    return;
  }
  if (binding.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      state.report('local.initial.type', `Initial value of parameter "${key}" must be a finite number.`, first.entry.node.range.start, undefined, { key: 'local.initial.type.number', params: { key } });
      return;
    }
    const local = constraints ?? numericConstraints(first.entry, first.attrs);
    if (local.min !== undefined && value < local.min) {
      state.report(
        'local.initial.range',
        `Initial value ${value} of parameter "${key}" is below the minimum ${local.min}.`,
        offset,
        undefined,
        { key: 'local.initial.range.min', params: { value, key, min: local.min } },
      );
    }
    if (local.max !== undefined && value > local.max) {
      state.report(
        'local.initial.range',
        `Initial value ${value} of parameter "${key}" exceeds the maximum ${local.max}.`,
        offset,
        undefined,
        { key: 'local.initial.range.max', params: { value, key, max: local.max } },
      );
    }
    const base = local.min ?? 0;
    if (local.dynamicMin === undefined && value >= (local.min ?? Number.NEGATIVE_INFINITY) && value <= (local.max ?? Number.POSITIVE_INFINITY) && !kernelOnStep(value, base, local.step)) {
      state.report(
        'local.initial.step',
        `Initial value ${value} of parameter "${key}" is not on step ${local.step} (based at ${local.min ?? 0}).`,
        offset,
        undefined,
        { key: 'local.initial.range.step', params: { value, key, step: local.step, base: local.min ?? 0 } },
      );
    }
    return;
  }
  if (binding.kind === 'boolean' && typeof value !== 'boolean') {
    state.report('local.initial.type', `Initial value of parameter "${key}" must be a boolean.`, first.entry.node.range.start, undefined, { key: 'local.initial.type.boolean', params: { key } });
  }
  const selectionFamily = binding.family === 'choice' || binding.family === 'tabs'
    || binding.family === 'steps' || binding.family === 'diagram' || binding.family === 'selection';
  if (selectionFamily && options.length && !options.includes(String(value))) {
    state.report(
      'local.initial.option',
      `Initial value "${String(value)}" of parameter "${key}" is not among the available values ${options.join(', ')}.`,
      offset,
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
  const primaryByNode = new Map<string, string>();
  for (const [key, binding] of Object.entries(bindings)) {
    for (const nodeId of binding.nodeIds) primaryByNode.set(nodeId, key);
  }
  for (const entry of state.entries) {
    const slots = kernelSlotBindings(entry.kernel);
    if (!slots.length) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const map: Record<string, string> = Object.create(null);
    const keys = new Map<string, string>();
    // Mixed contracts retain the primary value in the same transaction map.
    const valueBinding = kernelValueBinding(entry.kernel);
    if (valueBinding && !valueBinding.requiresAttributes?.some(attribute => !Object.hasOwn(attrs, attribute))) {
      const scalar = primaryByNode.get(entry.node.id);
      if (scalar) {
        map.value = scalar;
        keys.set('value', scalar);
      }
    }
    for (const slot of slots) {
      if (slot.requiresAttributes?.some(attribute => !Object.hasOwn(attrs, attribute))) continue;
      requireBindingAttribute(entry, slot, attrs, state);
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
      let key = publicKey ?? `@${entry.node.id}:${slot.slot}`;
      if (publicKey && used.has(publicKey)) {
        state.report(
          'local.binding.exclusive',
          `Parameter "${publicKey}" of the ${slot.slot} slot of <${entry.name}> is exclusive and cannot be shared with another control.`,
          bindInfo?.offset ?? entry.node.range.start,
          undefined,
          { key: 'local.binding.exclusive.slot', params: { key: publicKey, slot: slot.slot, name: entry.name } },
        );
        key = `@${entry.node.id}:${slot.slot}`;
      }
      used.add(key);
      const constraints = kernelNumericConstraints(entry.kernel, slot, attrs);
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
      map[slot.slot] = key;
      keys.set(slot.slot, key);
    }
    for (const relation of kernelSlotRelations(entry.kernel)) {
      const lowerKey = keys.get(relation.lower);
      const upperKey = keys.get(relation.upper);
      if (!lowerKey || !upperKey) continue;
      const lower = bindings[lowerKey].initial;
      const upper = bindings[upperKey].initial;
      if (typeof lower === 'number' && typeof upper === 'number' && lower > upper) {
        state.report(
          'local.initial.range',
          `<${entry.name}> ${relation.lower} ${lower} cannot be greater than ${relation.upper} ${upper}.`,
          entry.node.range.start,
          entry.node.range.end,
          { key: 'local.initial.range-slider', params: { start: lower, end: upper } },
        );
      }
    }
    if (Object.keys(map).length) state.bindingSlots[entry.node.id] = map;
  }
}

function slotInitial(
  entry: Entry,
  attrs: AttrMap,
  slot: KernelBindingSchema,
  constraints: NumericConstraints,
  state: CompileState,
): LocalValue {
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
    if (!kernelOnStep(value, base, constraints.step)) {
      state.report('local.initial.step', `Initial value ${value} of <${entry.name}> ${slot.initial} is not on step ${constraints.step} (based at ${base}).`, info.offset, undefined, { key: 'local.initial.slot.step', params: { value, name: entry.name, slot: slot.initial, step: constraints.step, base } });
    }
    return value;
  }
  const derived = kernelDefaultInitial(slot.initialRule, constraints, []);
  return 'value' in derived && derived.value !== undefined ? derived.value : 0;
}

function slotMap(state: CompileState): Record<string, Record<string, string>> | undefined {
  return Object.keys(state.bindingSlots).length ? state.bindingSlots : undefined;
}



/* ------------------------------------------------------------------ */
/* Computations                                                        */
/* ------------------------------------------------------------------ */

/** A declaration must be its own top-level source line. */
function standaloneDeclaration(state: CompileState, node: LocalNode): boolean {
  const lineStart = state.lineStarts[lineAt(state,node.range.start)-1];
  const next = state.lineStarts[lineAt(state,node.range.end)];
  const lineEnd = next === undefined ? state.source.length : next-1;
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
    if (Object.hasOwn(state.externalKinds, rawName)) {
      state.report(
        'local.computation.duplicate',
        `Computation name "${rawName}" conflicts with an external declaration of the same name.`,
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

  const resolved = resolveComputationGraph(
    inputs,
    { ...state.bindingKinds, ...state.externalKinds },
    state.report,
    new Set(Object.keys(state.externalKinds)),
    state.semantic,
  );
  state.computations = resolved.computations;
  state.computationKinds = resolved.kinds;
}

/** Environment used by ordinary expressions: writable parameters plus read-only computations and externals. */
function expressionEnv(state: CompileState): Record<string, LocalValueKind> {
  return { ...state.bindingKinds, ...state.externalKinds, ...state.computationKinds };
}

/** Declaration tags never reach the published tree; they are metadata only. */
function stripDeclarationNodes(nodes: LocalNode[]): LocalNode[] {
  const kept: LocalNode[] = [];
  const pending=[{nodes,kept,index:0}];
  while(pending.length){
    const frame=pending[pending.length-1];
    if(frame.index===frame.nodes.length){pending.pop();continue;}
    const node=frame.nodes[frame.index++];
    if (node.type === 'component' && (node.name === 'computed' || node.name === 'const' || node.name === 'external')) continue;
    frame.kept.push(node);
    if(node.children){
      const children=node.children;node.children=[];
      pending.push({nodes:children,kept:node.children,index:0});
    }
  }
  return kept;
}

/** Author-facing type names for `<external type="...">`. */
const EXTERNAL_TYPES: Readonly<Record<string, LocalValueKind>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  'string-array': 'array',
  'number-array': 'number-array',
};

/**
 * Resolve top-level `<external>` declarations into read-only document metadata.
 * Names share the expression namespace with controls and computations but are
 * never writable: they do not enter `bindings`, public parameters or state
 * files.
 */
function resolveExternals(state: CompileState): void {
  const roots = new Set(state.nodes);
  for (const entry of state.entries) {
    if (entry.name !== 'external') continue;
    const node = entry.node;
    if (!roots.has(node) || !standaloneDeclaration(state, node)) {
      state.report(
        'local.external.placement',
        '<external> declarations must be standalone tags at the document top level.',
        node.range.start,
        node.range.end,
        { key: 'local.external.placement' },
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
        `External name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`,
        nameInfo.offset,
        undefined,
        { key: 'local.budget.identifier', params: { limit: MAX_LOCAL_NAME_LENGTH } },
      );
      continue;
    }
    if (!IDENTIFIER.test(rawName)) {
      state.report(
        'local.external.name',
        `External name "${rawName}" must match [A-Za-z_][A-Za-z0-9_]*.`,
        nameInfo.offset,
        undefined,
        { key: 'local.external.name', params: { name: rawName } },
      );
      continue;
    }
    if (RESERVED_NAMES.has(rawName) || EXTRA_RESERVED.has(rawName)) {
      state.report(
        'local.external.reserved',
        `External name "${rawName}" is reserved; choose another name.`,
        nameInfo.offset,
        undefined,
        { key: 'local.external.reserved', params: { name: rawName } },
      );
      continue;
    }
    if (Object.hasOwn(state.bindingKinds, rawName)) {
      state.report(
        'local.external.duplicate',
        `External name "${rawName}" conflicts with a control parameter of the same name.`,
        nameInfo.offset,
        undefined,
        { key: 'local.external.conflict', params: { name: rawName } },
      );
      continue;
    }
    if (Object.hasOwn(state.externals, rawName)) {
      state.report(
        'local.external.duplicate',
        `External name "${rawName}" is declared more than once.`,
        nameInfo.offset,
        undefined,
        { key: 'local.external.duplicate', params: { name: rawName } },
      );
      continue;
    }
    const typeInfo = attrs.type;
    const rawType = typeof typeInfo?.value === 'string' ? typeInfo.value : '';
    const kind = EXTERNAL_TYPES[rawType];
    if (!kind) {
      state.report(
        'local.external.type',
        `External "${rawName}" must declare type string, number, boolean, string-array or number-array.`,
        typeInfo?.offset ?? node.range.start,
        undefined,
        { key: 'local.external.type', params: { name: rawName } },
      );
      continue;
    }
    state.externals[rawName] = {
      name: rawName,
      type: kind,
      nodeId: node.id,
      range: { ...node.range },
    };
    state.externalKinds[rawName] = kind;
  }
}

/**
 * Record dynamic `min`, `max` and `required` expressions for the runtime. Any
 * attribute named by a manifest `dynamic-constraints` rule or by a numeric
 * binding constraint prop is eligible; tag names play no part.
 */
function collectDynamicConstraints(state: CompileState): void {
  for (const entry of state.entries) {
    const attrs = state.attrs.get(entry.node.id) ?? {};
    let collected: LocalDynamicConstraints | undefined;
    const record = (
      attribute: 'min' | 'max' | 'required',
      info: AttrState,
      numeric?: { min?: number; max?: number; integer?: boolean },
    ): void => {
      if (!info.dynamic || info.expression === undefined) return;
      collected ??= {};
      collected[attribute] = {
        source: info.expression,
        offset: info.expressionOffset ?? info.offset,
        ...(numeric ? { numeric } : {}),
      };
    };
    for (const rule of kernelRulesOf(entry.kernel, 'dynamic-constraints')) {
      for (const name of rule.attributes) {
        if (name === 'min' || name === 'max' || name === 'required') {
          const info = attrs[name];
          if (info) record(name, info);
        }
      }
    }
    const scalar = kernelValueBinding(entry.kernel);
    if (scalar?.kind === 'number' && scalar.constraints) {
      for (const attribute of ['min', 'max'] as const) {
        const constraint = scalar.constraints[attribute];
        if (!constraint || !('prop' in constraint)) continue;
        const info = attrs[constraint.prop];
        if (!info) continue;
        const prop = entry.kernel.props[constraint.prop];
        record(attribute, info, prop ? {
          ...(prop.min === undefined ? {} : { min: prop.min }),
          ...(prop.max === undefined ? {} : { max: prop.max }),
          ...(prop.integer === true ? { integer: true } : {}),
        } : undefined);
      }
    }
    if (collected) state.dynamicConstraints[entry.node.id] = collected;
  }
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
      compiled = state.semantic?.expression(expression) ?? compileExpression(expression);
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
      kind = state.semantic ? state.semantic.infer(compiled,env) : compiled.inferType(env);
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

    for (const node of walkLocalNodes(state.nodes)) {
      if (node.type === 'interpolation') {
        const raw = state.source.slice(node.range.start + 2, Math.max(node.range.start + 2, node.range.end - 2));
        const value = node.value ?? '';
        const leading = Math.max(0, raw.indexOf(value));
        const base = node.range.start + 2 + leading;
        state.expressionKinds.set(node.id, validate(value, base, 'text'));
      }
    }

  for (const entry of state.entries) {
    // Declaration values are expressions, not text templates; they are
    // validated by resolveComputations with their own dependency graph.
    if (entry.name === 'computed' || entry.name === 'const') continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const scoped = new Set<string>();
    const fullRequired = new Set<string>();
    for (const rule of kernelRules(entry.kernel)) {
      if (rule.kind === 'scoped-expressions') for (const name of rule.attributes) scoped.add(name);
      else if (rule.kind === 'row-values') {
        scoped.add(rule.rows);
        scoped.add(rule.key);
      } else if (rule.kind === 'validation-rule') scoped.add(rule.when);
      else if (rule.kind === 'require-full-interpolation') for (const name of rule.attributes) fullRequired.add(name);
    }
    for (const [name, info] of Object.entries(attrs)) {
      const prop = entry.kernel.props[name];
      if (!prop || prop.static) continue;
      // Row-scoped and rule attributes have their own environment and are
      // validated by validateDataTables / validateValidations.
      if (scoped.has(name)) continue;
      if (prop.kind === 'string') {
        if (prop.dynamic) {
          // A full interpolation is a typed string expression; a literal is a
          // static fallback and has no expression to validate.
          if (info.dynamic) validate(info.expression ?? '', info.expressionOffset ?? info.offset, 'string');
          continue;
        }
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
    for (const name of fullRequired) {
      const info = attrs[name];
      if (info && !singleFullInterpolation(info.raw)) {
        state.report(
          'local.attribute.interpolation',
          `The ${name} attribute of <${entry.name}> must be a full interpolation.`,
          info.offset,
          undefined,
          { key: 'local.attribute.interpolation', params: { name, component: entry.name } },
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
    for (const node of walkLocalNodes(state.nodes)) {
      if (node.type === 'heading') {
        const id = anchors.ids.get(node);
        if (id && id.startsWith(`${namespace}-`)) headingSlugs.add(id.slice(namespace.length + 1));
      }
    }

  const explicit = new Set<string>();
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'anchor');
    if (!rule) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const info = attrs[rule.id];
    if (!info) continue;
    const id = typeof info.value === 'string' ? info.value : '';
    if (!id || !isKernelAnchorId(id)) {
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

  const targets: { name: string; target: string; offset: number }[] = [];
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'navigation');
    if (!rule) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const info = attrs[rule.target];
    if (!info) continue;
    targets.push({
      name: entry.name,
      target: typeof info.value === 'string' ? info.value : '',
      offset: info.offset,
    });
  }
  for (const issue of kernelNavigationIssues(targets, explicit, headingSlugs)) {
    state.report(
      issue.code,
      issue.message,
      issue.start,
      issue.end,
      { key: issue.key, ...(issue.params ? { params: issue.params } : {}) },
    );
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
    compiled = state.semantic?.expression(expression) ?? compileExpression(expression);
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
    kind = state.semantic ? state.semantic.infer(compiled,env) : compiled.inferType(env);
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

function dataTableMaxRows(attrs: AttrMap, rule: Extract<KernelRule, { kind: 'data-table' }>): number {
  const info = attrs[rule.maxRows];
  const fallback = Math.min(rule.defaultMaxRows, MAX_LOCAL_DATA_TABLE_ROWS);
  if (
    info && !info.dynamic
    && typeof info.value === 'number'
    && Number.isInteger(info.value)
    && info.value > 0
    && info.value <= MAX_LOCAL_DATA_TABLE_ROWS
  ) return info.value;
  return fallback;
}

/**
 * Validate every component declaring a `data-table` rule and sum document
 * budgets. Rows use the ordinary global environment; `key` and the child value
 * attribute additionally see the immutable row locals `item`/`index`.
 */
function validateDataTables(state: CompileState): void {
  const dataTables: [Entry, Extract<KernelRule, { kind: 'data-table' }>][] = [];
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'data-table');
    if (rule) dataTables.push([entry, rule]);
  }
  if (!dataTables.length) return;
  const env = expressionEnv(state);
  let totalRows = 0;
  let totalCells = 0;
  let rowsBudgetReported = false;
  let cellsBudgetReported = false;

  for (const [entry, rule] of dataTables) {
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const columns = meaningful(entry.node.children)
      .filter((child) => (child.type === 'component' || child.type === 'hostComponent') && child.name === rule.child);
    const maxRows = dataTableMaxRows(attrs, rule);
    const columnLimit = Math.min(rule.maxColumns, MAX_LOCAL_DATA_TABLE_COLUMNS);
    const rowBudget = Math.min(rule.documentRows, MAX_LOCAL_DATA_DOCUMENT_ROWS);
    const cellBudget = Math.min(rule.documentCells, MAX_LOCAL_DATA_DOCUMENT_CELLS);
    const columnCount = Math.min(columns.length, columnLimit);
    totalRows += maxRows;
    totalCells += maxRows * columnCount;
    if (!rowsBudgetReported && totalRows > rowBudget) {
      rowsBudgetReported = true;
      state.report(
        'local.budget.data-table.rows',
        `The document's generated row budget exceeds ${rowBudget}; ${rule.maxRows} summed over every <${entry.name}> must stay within it.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }
    if (!cellsBudgetReported && totalCells > cellBudget) {
      cellsBudgetReported = true;
      state.report(
        'local.budget.data-table.cells',
        `The document's generated cell budget exceeds ${cellBudget}; ${rule.maxRows} multiplied by columns, summed over every <${entry.name}>, must stay within it.`,
        entry.node.range.start,
        entry.node.range.end,
      );
    }

    const rows = fullExpressionAttribute(attrs[rule.rows], 'local.data-table.rows', entry.name, rule.rows, state);
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
          `<${entry.name}> ${rule.rows} must evaluate to an array, but the expression evaluates to ${typeName(result.kind)}.`,
          rows.base,
        );
      }
    }

    const rowEnv: Record<string, LocalValueKind> = { ...env, item: itemKind, index: 'number' };
    const key = fullExpressionAttribute(attrs[rule.key], 'local.data-table.key', entry.name, rule.key, state);
    if (key) {
      const result = validateScopedExpression(state, key.expression, key.base, rowEnv, rowsInferred);
      if (result) {
        const dependencies = result.compiled.dependencies;
        if (!dependencies.includes('item')) {
          state.report('local.data-table.key', `<${entry.name}> key must depend on item.`, key.base);
        }
        for (const dependency of dependencies) {
          if (dependency === 'item') continue;
          if (dependency === 'index') {
            state.report('local.data-table.key', `<${entry.name}> key cannot depend on index; use a stable item identifier.`, key.base);
          } else if (Object.hasOwn(env, dependency)) {
            state.report(
              'local.data-table.key',
              `<${entry.name}> key cannot depend on global parameter "${dependency}"; it must be derived from item only.`,
              key.base,
            );
          }
        }
        if (result.kind !== null && result.kind !== 'string' && result.kind !== 'number') {
          state.report(
            'local.data-table.key',
            `<${entry.name}> key must evaluate to a string or number, got ${typeName(result.kind)}.`,
            key.base,
          );
        }
      }
    }

    for (const column of columns) {
      const columnAttrs = state.attrs.get(column.id) ?? {};
      const label = columnAttrs[rule.label];
      if (label && !String(label.value ?? '').trim()) {
        state.report('local.data-table.column', `<${rule.child}> ${rule.label} cannot be empty.`, label.offset);
      }
      const value = fullExpressionAttribute(columnAttrs[rule.childValue], 'local.data-table.value', rule.child, rule.childValue, state);
      if (!value) continue;
      const result = validateScopedExpression(state, value.expression, value.base, rowEnv, rowsInferred);
      if (result && (result.kind === 'array' || result.kind === 'number-array')) {
        state.report(
          'local.data-table.value',
          `<${rule.child}> ${rule.childValue} must be a scalar string, number, boolean or null, got ${typeName(result.kind)}.`,
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
    const rule = kernelRule(entry.kernel, 'validation-rule');
    if (!rule) continue;
    declarations += 1;
    const node = entry.node;
    const maxRules = Math.min(rule.max, MAX_LOCAL_VALIDATIONS);
    if (declarations > maxRules) {
      if (!budgetReported) {
        budgetReported = true;
        state.report(
          'local.validation.budget',
          `The document declares more than ${maxRules} validation rules; rules in hidden regions count too.`,
          node.range.start,
          node.range.end,
        );
      }
      continue;
    }
    if (
      entry.parent
      && (entry.parent.kernel.form !== 'container' || kernelRule(entry.parent.kernel, 'data-table') !== undefined)
    ) {
      state.report(
        'local.validation.placement',
        `<${entry.name}> can appear in normal prose or a container, but not inside inline content or a data table.`,
        node.range.start,
        node.range.end,
      );
    }

    const attrs = state.attrs.get(node.id) ?? {};
    let expression = '';
    let dependencies: string[] = [];
    const when = attrs[rule.when];
    if (when) {
      const full = fullInterpolation(when.raw);
      if (!full) {
        state.report(
          'local.validation.when',
          `<${entry.name}> ${rule.when} must be exactly one {{ boolean }} interpolation.`,
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

    const fieldsInfo = attrs[rule.fields];
    const fields = fieldsInfo ? parseValidationFields(fieldsInfo.raw) : [];
    if (fieldsInfo && !fields.length) {
      state.report(
        'local.validation.fields',
        `<${entry.name}> requires at least one field name.`,
        fieldsInfo.offset,
        fieldsInfo.offset + fieldsInfo.raw.length,
      );
    }
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field)) {
        state.report(
          'local.validation.fields',
          `Duplicate field "${field}" in <${entry.name}> fields.`,
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

    // The message is an ordinary text template: validateExpressions checks its
    // interpolations. Rules without a usable `when` are already rejected.
    if (!expression) continue;
    validations.push({
      nodeId: node.id,
      expression,
      dependencies,
      message: typeof attrs[rule.message]?.value === 'string' ? String(attrs[rule.message].value) : '',
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

function plotSamples(entry: Entry, attrs: AttrMap, rule: Extract<KernelRule, { kind: 'plot-math' }>): number {
  const fallback = entry.kernel.props[rule.samples]?.default;
  const base = typeof fallback === 'number' ? fallback : 200;
  return numberValue(entry, attrs, rule.samples) ?? base;
}

function validatePlots(state: CompileState): void {
  const env = expressionEnv(state);
  let totalPoints = 0;
  let pointsBudgetExceeded = false;
  for (const entry of state.entries) {
    const rule = kernelRule(entry.kernel, 'plot-math');
    if (!rule) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const mathNodes = meaningful(entry.node.children).filter((node) => node.type === 'math');
    const samples = plotSamples(entry, attrs, rule);
    // Manifest rule counts can never raise the kernel's hard budgets.
    const curveLimit = Math.min(rule.curves, MAX_LOCAL_PLOT_CURVES);
    const pointLimit = Math.min(rule.points, MAX_LOCAL_PLOT_POINTS);
    if (mathNodes.length > curveLimit) {
      state.report(
        'local.budget.plot.curves',
        `<${entry.name}> supports at most ${curveLimit} curves, but has ${mathNodes.length}.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.budget.plot.curves', params: { limit: curveLimit, count: mathNodes.length } },
      );
    }
    const requested = mathNodes.length * samples;
    const nextTotal = totalPoints + requested;
    if (!pointsBudgetExceeded && nextTotal > pointLimit) {
      state.report(
        'local.budget.plot.points',
        `The document's total plot sample count exceeds the limit of ${pointLimit}.`,
        entry.node.range.start,
        entry.node.range.end,
        { key: 'local.budget.plot.points', params: { limit: pointLimit } },
      );
      pointsBudgetExceeded = true;
    }
    totalPoints = Math.min(pointLimit + 1, nextTotal);
    // Once the shapes are known to exceed budget, do not spend work compiling
    // an unbounded number of formulas. The document is already rejected.
    if (mathNodes.length > curveLimit || pointsBudgetExceeded) continue;
    for (const node of mathNodes) {
      const recipe = (node.value ?? '').trim();
      if (!/^y\s*=/u.test(recipe)) {
        state.report(
          'local.math.formula',
          `<${entry.name}> formulas must be written explicitly as y = expression.`,
          node.range.start,
          node.range.end,
          { key: 'local.math.formula.shape' },
        );
        continue;
      }
      let compiled: ReturnType<typeof compileLatex> | null = null;
      try {
        compiled = state.semantic?.latex(recipe) ?? compileLatex(recipe);
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
  const timeline = kernelRule(component.kernel, 'timeline-table') !== undefined;
  shape.rows.forEach((row, rowIndex) => {
    const cell = row[column];
    if (!cell) return;
    const kids = meaningful(cell.children);
    if (kids.length === 1 && kids[0].type === 'interpolation') {
      const kind = state.expressionKinds.get(kids[0].id);
      if (kind !== undefined && kind !== null && kind !== 'number') {
        state.report(
          'local.chart.numeric',
          `${timeline ? 'Timeline' : 'Chart'} column "${name}" requires a number in row ${rowIndex + 1}, but the expression evaluates to ${typeName(kind)}.`,
          cell.range.start,
          cell.range.end,
          {
            key: timeline ? 'local.timeline.numeric.expression' : 'local.chart.numeric.expression',
            params: { name, row: rowIndex + 1, kind: typeName(kind) },
          },
        );
      }
      return;
    }
    if (!cellNumeric(cell, state)) {
      state.report(
        'local.chart.numeric',
        `${timeline ? 'Timeline' : 'Chart'} column "${name}" requires a plain number in row ${rowIndex + 1}, got "${plainText(cell).trim() || 'empty'}".`,
        cell.range.start,
        cell.range.end,
        {
          key: timeline ? 'local.timeline.numeric.plain' : 'local.chart.numeric.plain',
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
    if (!kernelRule(entry.kernel, 'single-table')) continue;
    const chart = kernelRule(entry.kernel, 'chart-table');
    const timeline = kernelRule(entry.kernel, 'timeline-table');
    if (!chart && !timeline) {
      tableShapeFor(entry, state);
      continue;
    }
    const shape = tableShapeFor(entry, state);
    if (!shape) continue;
    if (chart) validateChart(entry, shape, state, chart);
    else if (timeline) validateTimeline(entry, shape, state, timeline);
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
    const rule = kernelRule(entry.kernel, 'table-selection');
    if (!rule) continue;
    const attrs = state.attrs.get(entry.node.id) ?? {};
    const keyInfo = attrs[rule.key];
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

function validateChart(
  entry: Entry,
  shape: TableShape,
  state: CompileState,
  rule: Extract<KernelRule, { kind: 'chart-table' }>,
): void {
  const attrs = state.attrs.get(entry.node.id) ?? {};
  const kind = typeof attrs[rule.chartKind]?.value === 'string' ? String(attrs[rule.chartKind].value) : 'bar';
  const header = shape.header;
  for (const name of header) {
    if (name.includes(',')) {
      state.report('local.chart.column', `Chart column names cannot contain commas: "${name}".`, entry.node.range.start, entry.node.range.end, { key: 'local.chart.column.comma', params: { name } });
    }
  }
  const xName = typeof attrs[rule.x]?.value === 'string' ? String(attrs[rule.x].value).trim() : '';
  const yRaw = typeof attrs[rule.y]?.value === 'string' ? String(attrs[rule.y].value).trim() : '';
  if (xName && columnIndex(header, xName) < 0) {
    state.report('local.chart.column', `Chart x column "${xName}" does not exist.`, attrs[rule.x]?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.x-missing', params: { name: xName } });
  }
  let yNames: string[] = [];
  if (yRaw) {
    yNames = yRaw.split(',').map((name) => name.trim()).filter(Boolean);
    if (!yNames.length) {
      state.report('local.chart.column', 'Chart y requires a column name.', attrs[rule.y]?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.y-required' });
    }
    for (const name of yNames) {
      if (columnIndex(header, name) < 0) {
        state.report('local.chart.column', `Chart y column "${name}" does not exist.`, attrs[rule.y]?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.y-missing', params: { name } });
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
      state.report('local.chart.column', 'Donut chart y can only specify one numeric column.', attrs[rule.y]?.offset ?? entry.node.range.start, undefined, { key: 'local.chart.column.donut-y' });
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

function validateTimeline(
  entry: Entry,
  shape: TableShape,
  state: CompileState,
  rule: Extract<KernelRule, { kind: 'timeline-table' }>,
): void {
  const headerSets = rule.headerSets.map((set) => ({
    title: set[0] ?? '',
    start: set[1] ?? '',
    duration: set[2] ?? '',
    notes: set[3] ?? '',
  }));
  const headers = headerSets.find((set) =>
    shape.header.includes(set.title) && shape.header.includes(set.start) && shape.header.includes(set.duration),
  );
  if (!headers) {
    state.report(
      'local.timeline.header',
      `<${entry.name}> requires title, start and duration columns, with an optional notes column.`,
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
 * Requirements for external components actually used by the document. A
 * configured component that never appears in the source contributes nothing,
 * so restoring a document only needs the implementations it really references.
 */
function extensionRequirements(
  nodes: LocalNode[],
  sdkByName: ReadonlyMap<string, LocalComponentDefinition>,
): LocalExtensionRequirements | undefined {
  if (sdkByName.size === 0) return undefined;
  const used = new Map<string, LocalComponentRequirement>();
  for (const node of walkLocalNodes(nodes)) {
    if (node.type !== 'hostComponent' || !node.name) continue;
    const definition = sdkByName.get(node.name);
    if (definition !== undefined) used.set(definition.id, localComponentRequirement(definition));
  }
  if (used.size === 0) return undefined;
  const components = Object.freeze(
    [...used.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  return Object.freeze({ protocol: LOCAL_EXTENSIONS_PROTOCOL, components });
}

/*
 * Phase-one host parameter and SDK binding adapters were removed in phase two.
 * `readLocalCompileOptions` lowers both inputs into the unified registry above,
 * so every component uses the same attribute, structure and binding engine.
 */


function singleFullInterpolation(value: string): boolean {
  if (!fullInterpolation(value)) return false;
  const scanned = scanInterpolations(value);
  return scanned.segments.length === 1 && scanned.unterminated.length === 0;
}

/* ------------------------------------------------------------------ */
/* Top-level entry point used by validateExpressions                   */
/* ------------------------------------------------------------------ */

export function compileLocalDocument(source: string, options?: LocalCompileOptions): LocalCompileResult {
  return compileLocal(source, options);
}

/* ------------------------------------------------------------------ */
/* Kernel metadata publication                                         */
/* ------------------------------------------------------------------ */

/** Lower manifest rules to the serializable metadata the runtime consumes. */
function compileKernelMetadata(
  state: CompileState,
  bindings: Record<string, LocalBinding>,
): {
  valueRules: Record<string, readonly KernelValueRule[]>;
  slotRelations: readonly { nodeId: string; lower: string; upper: string }[];
  retentionExclusions: readonly string[];
  bindingAttributes?: Record<string, { bind: string; initial: string }>;
  dependencyRules?: Record<string, { selfBinding?: { mode: 'always' | 'attribute'; attribute?: string }; inlineMathReads?: boolean }>;
} {
  const valueRules: Record<string, readonly KernelValueRule[]> = {};
  const dependencyRules: Record<string, { selfBinding?: { mode: 'always' | 'attribute'; attribute?: string }; inlineMathReads?: boolean }> = {};
  const bindingAttributes: Record<string, { bind: string; initial: string }> = {};
  const slotRelations: { nodeId: string; lower: string; upper: string }[] = [];
  const entryById = new Map(state.entries.map((entry) => [entry.node.id, entry]));
  const slotOwner = new Map<string, { entry: Entry; slot: string }>();
  for (const [nodeId, map] of Object.entries(state.bindingSlots)) {
    const entry = entryById.get(nodeId);
    if (!entry) continue;
    for (const [slot, key] of Object.entries(map)) slotOwner.set(key, { entry, slot });
  }
  for (const [key, binding] of Object.entries(bindings)) {
    const slot = slotOwner.get(key);
    if (slot) {
      const definition = kernelSlotBindings(slot.entry.kernel).find((candidate) => candidate.slot === slot.slot);
      if (definition) bindingAttributes[key] = { bind: definition.bind, initial: definition.initial };
      continue;
    }
    const entry = entryById.get(binding.owner ?? binding.nodeIds[0] ?? '');
    const scalar = entry ? kernelValueBinding(entry.kernel) : undefined;
    if (scalar) bindingAttributes[key] = { bind: scalar.bind, initial: scalar.initial };
  }
  for (const entry of state.entries) {
    const rules = kernelValueRules(entry.kernel);
    if (rules.length) valueRules[entry.node.id] = Object.freeze([...rules]);
    const self = kernelRule(entry.kernel, 'self-binding-read');
    const inlineMath = kernelRule(entry.kernel, 'inline-math-reads');
    if (self || inlineMath) {
      dependencyRules[entry.node.id] = {
        ...(self ? { selfBinding: { mode: self.mode, ...(self.attribute ? { attribute: self.attribute } : {}) } } : {}),
        ...(inlineMath ? { inlineMathReads: true } : {}),
      };
    }
    for (const relation of kernelSlotRelations(entry.kernel)) {
      if (!state.bindingSlots[entry.node.id]?.[relation.lower]) continue;
      if (!state.bindingSlots[entry.node.id]?.[relation.upper]) continue;
      slotRelations.push({ nodeId: entry.node.id, lower: relation.lower, upper: relation.upper });
    }
  }
  const retentionExclusions: string[] = [];
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.nodeIds.some((id) => {
      const entry = entryById.get(id);
      const scalar = entry ? kernelValueBinding(entry.kernel) : undefined;
      return scalar?.retain === false;
    })) retentionExclusions.push(key);
  }
  if (
    Object.keys(valueRules).length === 0
    && Object.keys(dependencyRules).length === 0
    && Object.keys(bindingAttributes).length === 0
    && slotRelations.length === 0
    && retentionExclusions.length === 0
  ) {
    // Still publish an empty marker: a compiled document must never fall back
    // to phase-one tag-name semantics, even when it has no state at all.
    return { valueRules: Object.freeze({}), slotRelations: Object.freeze([]), retentionExclusions: Object.freeze([]) };
  }
  return {
    valueRules: Object.freeze(valueRules),
    slotRelations: Object.freeze(slotRelations.map((item) => Object.freeze(item))),
    retentionExclusions: Object.freeze(retentionExclusions.sort()),
    ...(Object.keys(bindingAttributes).length
      ? { bindingAttributes: Object.freeze(bindingAttributes) }
      : {}),
    ...(Object.keys(dependencyRules).length
      ? { dependencyRules: Object.freeze(dependencyRules) }
      : {}),
  };
}

/** Distinct manifests referenced by the compiled document, in first-use order. */
function componentDefinitionsFor(state: CompileState): LocalComponentDefinition[] {
  const seen = new Set<string>();
  const definitions: LocalComponentDefinition[] = [];
  for (const entry of state.entries) {
    const definition = entry.definition;
    if (!definition || seen.has(definition.id)) continue;
    seen.add(definition.id);
    definitions.push(definition);
  }
  return definitions;
}

/** Host-shaped nodes with no registry entry warn instead of failing the document. */
function reportUnmatchedHostComponents(nodes: LocalNode[], state: CompileState): void {
  for (const node of walkLocalNodes(nodes)) {
    if (node.type !== 'hostComponent') continue;
    if (node.name && state.schemaByName.has(node.name)) continue;
    const name = node.name ?? '';
    reportWarning(
      state,
      'local.component.unknown',
      `Unknown component <${name}>. This mode only accepts local interaction components.`,
      node.range.start,
      node.range.end,
      { key: 'local.component.unknown', params: { name } },
    );
  }
}
