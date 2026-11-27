import { parseLocalCore, type ParsedLocal } from '../parsing/parser-core';
import {
  LOCAL_SYNTAX_VERSION,
  type Diagnostic,
  type LocalCompileOptions,
  type LocalCompileResult,
  type LocalDocument,
  type LocalRecovery,
  type LocalValue,
  type SourceRange,
} from '../types';
import type { NormalizedComponent } from '../../contracts/component-kernel';
import type { LocalComponentDefinition } from '../../sdk/types';
import { compilerComponentConfigKey, type LocalOptionCheck } from '../configuration/options-core';
import {
  reportWarning,
  type CompileState,
  type LocalCompilerCoreServices,
  type LocalHtmlDocumentSanitizer,
} from './compiler-services';
import {
  MAX_LOCAL_DIAGNOSTIC_LENGTH,
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_DOCUMENT_LENGTH,
} from '../../contracts/limits';
import {
  diagnosticEnglish,
  localDiagnosticDetails,
  type LocalDiagnosticDetails,
} from '../configuration/diagnostics';
import { localCodeUnitPrefix, SourceContext } from '../source/source-context';
import {
  collectEntries,
  collectLegacyFences,
  compileKernelMetadata,
  componentDefinitionsFor,
  extensionRequirements,
  reportUnmatchedHostComponents,
  validateChildren,
} from './compiler-structure';
import { attachTableShapes, computeSelections, validateTables } from './compiler-tables';
import { bindingKinds, resolveBindings } from './compiler-bindings';
import {
  collectDynamicConstraints,
  resolveComputations,
  resolveExternals,
  resolveSlotBindings,
  slotMap,
  stripDeclarationNodes,
} from './compiler-declarations';
import { validateExpressions, validateNavigation } from './compiler-expressions';
import { validateDataTables, validatePlots, validateValidations } from './compiler-validation';
import { cloneValue } from './compiler-values';
import { attachNodeDependencies } from './dependencies';
import { compileDocumentCapabilities } from './compiler-capabilities';
import { applyEmbedding, compileEmbeddingAttributes, embeddingFallback, replaceEmbeddingNodes } from './compiler-embedding';
import { localDocumentRequiresRuntime } from './runtime-requirement';

/**
 * The parser owns recovery detection. Until its optional field is part of the
 * shared `ParsedLocal` shape, read it structurally so the compiler works with
 * both halves of the migration.
 */
type ParsedLocalWithRecoveries = ParsedLocal & { recoveries?: LocalRecovery[] };

/**
 * Attach parser recovery records to a result. An empty list or a strict pass
 * that recovered nothing leaves the result shape untouched, preserving the
 * historical snapshots. Recoveries never turn a failure into a success: the
 * caller decides `ok` from the remaining diagnostics alone.
 */
function withRecoveries(
  result: LocalCompileResult,
  recoveries: readonly LocalRecovery[] | undefined,
): LocalCompileResult {
  if (!recoveries || recoveries.length === 0) return result;
  return { ...result, recoveries: [...recoveries] };
}

/** Fields the unified options/registry layer exposes in phase two. */
interface UnifiedRegistryCheck {
  schemaByName?: ReadonlyMap<string, NormalizedComponent>;
  componentByName?: ReadonlyMap<string, LocalComponentDefinition>;
  legacyHostNames?: ReadonlySet<string>;
}

function registrySchemaMap(check: LocalOptionCheck & UnifiedRegistryCheck): ReadonlyMap<string, NormalizedComponent> {
  // The unified registry is authoritative; there is no second schema table.
  return check.schemaByName ?? new Map();
}

function registryDefinitionMap(check: LocalOptionCheck & UnifiedRegistryCheck): ReadonlyMap<string, LocalComponentDefinition> {
  return check.componentByName ?? new Map();
}

/**
 * Parser services may accept forced literal spans as an optional final
 * argument. The shared service contract stays at four arguments so custom
 * parsers keep working; a parser that predates the parameter simply ignores it.
 */
type LiteralRangeParser = {
  parse(
    source: string,
    options?: LocalCompileOptions,
    context?: SourceContext,
    rowPlans?: LocalCompilerCoreServices['rowPlans'],
    literalRanges?: readonly SourceRange[],
  ): ParsedLocal;
};

/**
 * Whole-document native HTML branch. The Markdown parser, components,
 * expressions, computations and bindings are all bypassed; the source only
 * becomes grammar-aware sanitized HTML for an isolated `srcdoc` iframe.
 */
export function compileLegacyHtmlLocal(
  source: string,
  check: Extract<LocalOptionCheck, { ok: true }>,
  sanitize: LocalHtmlDocumentSanitizer,
): LocalCompileResult {
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
        phase: typeof source === 'string' ? 'resource' : 'source',
        recoverable: false,
        ...(typeof source === 'string' ? { details: { budget: 'maxDocumentLength', limit: MAX_LOCAL_DOCUMENT_LENGTH, actual: source.length, unit: 'codeUnits' } } : {}),
        ...(typeof source === 'string' ? { params: { limit: MAX_LOCAL_DOCUMENT_LENGTH } } : {}),
      }],
    };
  }

  const sanitized = sanitize(source, check.html, check.maxSyntaxNodes);
  if (sanitized.diagnostics.some((item) => item.severity === 'error')) {
    return { ok: false, diagnostics: sanitized.diagnostics };
  }

  const document: LocalDocument = {
    syntax: 'local',
    source,
    requiresRuntime: true,
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

/**
 * The single reference compiler pass. Options must already be validated; the
 * validated `optionCheck` is the option snapshot this pass reads, so later
 * mutation of the caller's options object cannot change compilation semantics.
 *
 * `services` carries optional execution goods (session parser, semantic
 * products, row plans, KaTeX display inspector). Omitting them keeps the same
 * semantic flow, only without cross-revision reuse and optional checks.
 */
export function compileLocalCore(
  source: string,
  options: LocalCompileOptions | undefined,
  optionCheck: Extract<LocalOptionCheck, { ok: true }>,
  services?: LocalCompilerCoreServices,
  capture?: (tree: ParsedLocal) => void,
  mark?: (name: string) => void,
  literalRanges?: readonly SourceRange[],
  semanticReplay?: { parsed: ParsedLocal; rejectedIds: ReadonlySet<string> },
): LocalCompileResult {
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    // Source-shape diagnostics come from the kernel parser; a session parser
    // is never asked to compile a non-string or oversized revision.
    const shape = parseLocalCore(source, optionCheck) as ParsedLocalWithRecoveries;
    return withRecoveries({ ok: false, diagnostics: shape.diagnostics }, shape.recoveries);
  }
  const diagnostics: Diagnostic[] = [];
  const sourceContext = new SourceContext(source);
  const {lineStarts} = sourceContext;
  const report = (
    code: string,
    message: string | LocalDiagnosticDetails,
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
  ) => {
    // Key-first calls derive the English text from the registered template,
    // so the same diagnostic id cannot drift between message and translation.
    const resolved = typeof message === 'string' ? details : message;
    const text = typeof message === 'string' ? message : diagnosticEnglish(message);
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
    const bounded = localDiagnosticDetails(resolved?.key ?? code, resolved?.params);
    diagnostics.push({
      code,
      message: text.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
        ? `${localCodeUnitPrefix(text, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
        : text,
      severity: 'error',
      range: { start: safeStart, end: safeEnd },
      line: low + 1,
      column: safeStart - lineStarts[low] + 1,
      messageKey: bounded.key,
      phase: code.includes('budget') ? 'resource' : code === 'local.parse' ? 'parse' : 'semantic',
      recoverable: false,
      ...(bounded.params ? { params: bounded.params } : {}),
    });
  };

  let parsed: ParsedLocal;
  try {
    if (!semanticReplay) mark?.('parse-start');
    parsed = semanticReplay?.parsed ?? (services?.parser
      ? (services.parser as LiteralRangeParser).parse(source, options, sourceContext, services.rowPlans, literalRanges)
      : parseLocalCore(source, optionCheck, sourceContext, undefined, undefined, literalRanges));
    if (!semanticReplay) {
      capture?.(parsed);
      mark?.('parseMs');
    }
  } catch (error) {
    report('local.parse', `Cannot parse document: ${error instanceof Error ? error.message : String(error)}`, 0, undefined, {
      key: 'local.parse.document',
      params: { detail: error instanceof Error ? error.message : String(error) },
    });
    return { ok: false, diagnostics };
  }
  diagnostics.push(...parsed.diagnostics);
  const recoveries = (parsed as ParsedLocalWithRecoveries).recoveries;
  // Never evaluate const declarations or construct an executable document
  // after an explicit syntax-version mismatch or malformed version header.
  if (diagnostics.some(item => item.severity === 'error' && item.code.startsWith('local.version.'))) {
    // Parsing may have completed a loose-mode recovery before the version
    // gate. Retain only its matching warnings alongside the fatal version
    // diagnostics; semantic evaluation still does not run.
    const recoveredWarnings = new Set((recoveries ?? []).map(recovery =>
      `${recovery.code}:${recovery.causeRange.start}:${recovery.causeRange.end}`));
    return withRecoveries(
      { ok: false, diagnostics: diagnostics.filter(item => item.code.startsWith('local.version.')
        || (item.severity === 'warning' && recoveredWarnings.has(`${item.code}:${item.range.start}:${item.range.end}`))) },
      recoveries,
    );
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
    semantic: services?.semantic,
    display: services?.display,
    htmlFragment: services?.htmlFragment,
    plotMath: services?.plotMath,
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

  applyEmbedding(state, optionCheck.embedding);
  if (semanticReplay) state.nodes = replaceEmbeddingNodes(state.nodes, node => semanticReplay.rejectedIds.has(node.id)
    ? embeddingFallback(state, node, optionCheck.embedding, 'local.embedding.attribute') : undefined);
  const capabilities = compileDocumentCapabilities(state, optionCheck.html, optionCheck.maxSyntaxNodes, optionCheck.embedding);
  collectEntries(state.nodes, null, state.entries, state);
  compileEmbeddingAttributes(state, optionCheck.embedding, capabilities);
  mark?.('attributesMs');
  for (const entry of state.entries) validateChildren(entry, state);
  computeSelections(state);
  mark?.('structureMs');

  const bindings = resolveBindings(state);
  resolveSlotBindings(state, bindings);
  state.bindingKinds = bindingKinds(bindings);
  mark?.('bindingsMs');

  resolveExternals(state);
  resolveComputations(state);
  mark?.('computationsMs');
  collectDynamicConstraints(state);

  const rejectedIds = optionCheck.embedding.onUnsupported === 'fallback' && !semanticReplay ? new Set<string>() : undefined;
  const rejectAttribute = rejectedIds && ((node: { id: string }) => rejectedIds.add(node.id));
  validateExpressions(state, rejectAttribute);
  mark?.('expressionsMs');
  validateDataTables(state, rejectAttribute);
  mark?.('dataTablesMs');
  const validations = validateValidations(state, rejectAttribute);
  mark?.('validationsMs');
  if (rejectedIds?.size) {
    // Rebuild the semantic model after pruning invalid components and their
    // bindings. Resource budgets are recomputed against the pruned tree, so an
    // overflow caused by a rejected node itself disappears here. The replay
    // disables rejectedIds, which bounds this to a single extra pass.
    return compileLocalCore(source, options, optionCheck, services, undefined, mark, literalRanges, { parsed, rejectedIds });
  }
  validatePlots(state);
  mark?.('plotsMs');
  validateTables(state);
  mark?.('tablesMs');

  const initialState: Record<string, LocalValue> = {};
  for (const [key, binding] of Object.entries(bindings)) initialState[key] = cloneValue(binding.initial);
  validateNavigation(state, bindings, initialState);
  reportUnmatchedHostComponents(state.nodes, state);
  mark?.('hostAndNavigationMs');
  const displayNodes = [...state.nodes];
  while (displayNodes.length && diagnostics.length < MAX_LOCAL_DIAGNOSTICS) {
    const node = displayNodes.pop()!;
    if (node.type === 'math' || node.type === 'inlineMath') {
      const delimiterLength = source.startsWith('\\\\[', node.range.start) ? 3
        : node.type === 'math' || source.startsWith('\\(', node.range.start) ? 2 : 1;
      const base = node.range.start + delimiterLength;
      if (state.display) {
        for (const issue of state.display(node.value ?? '', node.type === 'math')) {
          reportWarning(state, issue.code, issue.message, base + issue.start, base + issue.end, {
            key: issue.messageKey, params: issue.params,
          });
        }
      }
    } else if (node.children) displayNodes.push(...node.children);
  }
  mark?.('mathDisplayMs');

  diagnostics.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError) return withRecoveries({ ok: false, diagnostics }, recoveries);

  const bindingSlots = slotMap(state);
  const computationNames = Object.keys(state.computations);
  const externalNames = Object.keys(state.externals);
  const dynamicConstraints = Object.keys(state.dynamicConstraints).length
    ? state.dynamicConstraints
    : undefined;
  const extensions = extensionRequirements(state.nodes, optionCheck.sdkByName);
  const kernelMetadata = compileKernelMetadata(state, bindings);
  const usedDefinitions = componentDefinitionsFor(state);
  const document: LocalDocument = {
    syntax: 'local',
    source,
    ...((optionCheck.config || !options?.hostComponents)
      ? { componentConfigKey: compilerComponentConfigKey(optionCheck) } : {}),
    syntaxVersion: LOCAL_SYNTAX_VERSION,
    ...(parsed.versionDeclaration ? { versionDeclaration: parsed.versionDeclaration } : {}),
    nodes: stripDeclarationNodes(state.nodes),
    ...(capabilities ? { capabilities } : {}),
    initialState,
    bindings,
    // Themes are host metadata: the compiler only names the built-in default
    // and never loads theme definitions, CSS or host code.
    theme: parsed.theme ?? 'default',
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
  attachNodeDependencies(document, optionCheck.registry);
  attachTableShapes(document, state.tableShapes);
  document.requiresRuntime = localDocumentRequiresRuntime(document);
  mark?.('publicationMs');
  return withRecoveries({ ok: true, document, diagnostics }, recoveries);
}
