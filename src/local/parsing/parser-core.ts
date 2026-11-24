import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { LocalParserCapabilities } from './parser-capabilities';
import type {
  Diagnostic,
  LocalNode,
  LocalRecovery,
  LocalVersionDeclaration,
  SourceRange,
} from '../types';
import type { FastMarkdownContext, FastMarkdownPlan, InlinePlanLookup } from './fast-markdown';
import type { LocalOptionCheck } from '../configuration/options-core';
import { SourceContext } from '../source/source-context';
import {
  ParseBudgetError,
  ParseWorkBudget,
  type ParseSessionCache,
  type ParseSessionCounters,
} from './parse-budget';
import {
  MAX_LOCAL_DIAGNOSTIC_LENGTH,
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_DOCUMENT_LENGTH,
} from '../../contracts/limits';
import {
  diagnosticEnglish,
  localDiagnosticDetails,
  renderLocalDiagnostic,
  type LocalDiagnosticDetails,
} from '../configuration/diagnostics';
import { markdownTreeFacts, parseMarkdownBlocks, type MarkdownStructure } from './markdown-blocks';
import {
  HTML_NAMES,
  LocalBudgetError,
  MARK_CLOSE,
  MARK_OPEN,
  NATIVE_HTML_VOID,
  type DefinitionRange,
} from './parser-internals';
import { parsePlainParagraphs } from './plain-paragraphs';
import { maskLeakingAuthorBody } from './author-markdown';
import { scanInterpolationEnd } from './lexical';
import { localCodeUnitPrefix } from '../source/source-context';
import { createRegionScanner, type DocumentHeaders } from './parser-region';
import { createMarkdownConverter } from './parser-convert';
import { createTagScanner } from './parser-tags';
import { planRmdRecovery } from './rmd-recovery';
import { HTML_VOID_ELEMENTS } from '../html/html-policy';

/* Accepted tag shapes come from the unified registry snapshot passed through
 * compile options; tests/schema-shapes.test.ts pins the default preset forms. */
/** Private-use sentinels keep source tokens opaque while Markdown is parsed. */
/** P0 native HTML accepted inline in Markdown documents. */
/** Structural recoveries that explain partial rendering with one warning each. */
const RECOVERY_DIAGNOSTIC_CODES = new Set([
  'local.recovery.unclosed',
  'local.recovery.mismatch',
  'local.recovery.stray-close',
  'local.html.repair',
  'local.html.literal',
]);

/** Names longer than this are rejected and never fed to suggestion search. */
/** Monotonic wall clock for optional phase observations (never for budgets). */
function clock(): number {
  const perf = globalThis.performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Cheap over-approximation of "this source may contain Markdown containers".
 * When it is false the shared facts scan can be skipped entirely, preserving
 * the plain-paragraph fast path. The expression is line-anchored so `<`/`>`
 * used in prose does not trigger the scan.
 */
const CONTAINER_HINT = /(?:^|[\r\n])(?:[ \t]{0,3}>|[ \t]*(?:[-+*]|\d{1,9}[.)])(?=[ \t]|[\r\n]|$))/;

function mayHaveContainer(source: string): boolean {
  return CONTAINER_HINT.test(source)
    || (source.charCodeAt(0) === 0xfeff && CONTAINER_HINT.test(source.slice(1)));
}

const coreMarkdown: any = unified().use(remarkParse);

const markdownCache = new WeakMap<object, any>();

/** CommonMark is core; GFM and other syntax arrive as assembly capabilities. */
function markdownFor(capabilities?: LocalParserCapabilities): any {
  const plugins = capabilities?.markdownPlugins;
  if (!plugins?.length) return coreMarkdown;
  let processor = markdownCache.get(capabilities as object);
  if (processor === undefined) {
    processor = unified().use(remarkParse);
    for (const plugin of plugins) processor.use(plugin as any);
    markdownCache.set(capabilities as object, processor);
  }
  return processor;
}

export interface ParsedLocal {
  nodes: LocalNode[];
  diagnostics: Diagnostic[];
  /** Internal cumulative creation count, including discarded intermediates. */
  syntaxNodes?: number;
  /** Internal aggregate work over shielding and nested conversion calls. */
  work?: ParserWork;
  versionDeclaration?: LocalVersionDeclaration;
  /** Declared theme name, when the leading declaration is valid. */
  theme?: string;
  /** Source range of the first leading theme declaration, valid or not. */
  themeRange?: SourceRange;
  /**
   * Internal: fast Markdown plans used by this parse. The incremental
   * compiler keeps their per-row inline plans so a later edit of the same
   * block can skip re-scanning unchanged rows.
   */
  plans?: FastMarkdownPlan[];
  /**
   * Structural repairs applied in non-strict mode, in stable source order.
   * Strict parsing omits the field entirely.
   */
  recoveries?: LocalRecovery[];
}

export interface ParserWork {
  markdownCalls: number;
  fastBlocks: number;
  generalBlocks: number;
  fastCharacters: number;
  generalCharacters: number;
  mappingSegments: number;
  sourceLines: number;
  maxComponentDepth: number;
  /** Deterministic parser work charged for this parse. */
  parseWork?: number;
  /** Maximum Markdown container depth observed in the source. */
  maxMarkdownDepth?: number;
  /** Session cache lookups that were served from the session. */
  cacheHits?: number;
  /** Session cache lookups that had to be computed. */
  cacheMisses?: number;
  /** Whole fast plans reused from the session. */
  reusedBlocks?: number;
  /** Table rows/cells whose inline plan was reused. */
  reusedRows?: number;
  /** List items whose inline plan was reused. */
  reusedItems?: number;
  /** General Markdown ASTs reused from the session. */
  reusedAst?: number;
  /** Coarse phase timings; observability only, never part of a result. */
  timings?: {
    shieldMs: number;
    regionMs: number;
    convertMs: number;
    totalMs: number;
  };
}

/**
 * Clamp, sort and merge source spans for the region scanner. Empty or
 * reversed spans are dropped; overlapping spans become one. Forced literal
 * spans use the same representation as loose-mode recovery spans so the
 * scanner renders each as one fallback token with its original text.
 */
export function normalizeSourceRanges(
  ranges: readonly SourceRange[] | undefined,
  length: number,
): SourceRange[] {
  if (!ranges || ranges.length === 0) return [];
  const clamped: SourceRange[] = [];
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) continue;
    const start = Math.max(0, Math.min(length, range.start));
    const end = Math.max(0, Math.min(length, range.end));
    if (end > start) clamped.push({ start, end });
  }
  clamped.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: SourceRange[] = [];
  for (const range of clamped) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** A lexical pass shields code before recognizing local tags, interpolation and math. */
export function parseLocalCore(
  source: string,
  optionCheck: LocalOptionCheck,
  context?: SourceContext,
  cache?: ParseSessionCache,
  rowPlans?: InlinePlanLookup,
  literalRanges?: readonly SourceRange[],
): ParsedLocal {
  const diagnostics: Diagnostic[] = [];
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    const details = typeof source === 'string'
      ? localDiagnosticDetails('local.budget.document', { limit: MAX_LOCAL_DOCUMENT_LENGTH })
      : localDiagnosticDetails('local.parse.source');
    return { nodes: [], diagnostics: [{
      code: typeof source === 'string' ? 'local.budget' : 'local.parse',
      message: typeof source === 'string' ? `Document exceeds the ${MAX_LOCAL_DOCUMENT_LENGTH}-character limit.` : 'Document source must be a string.',
      severity: 'error', range: { start: 0, end: typeof source === 'string' && source.length ? 1 : 0 }, line: 1, column: 1,
      messageKey: details.key, ...(details.params ? { params: details.params } : {}),
      phase: typeof source === 'string' ? 'resource' : 'source',
      recoverable: false,
      ...(typeof source === 'string' ? { details: { budget: 'maxDocumentLength', limit: MAX_LOCAL_DOCUMENT_LENGTH, actual: source.length, unit: 'codeUnits' } } : {}),
    }] };
  }
  if (!optionCheck.ok) {
    return { nodes: [], diagnostics: [{
      code: 'local.options.invalid', message: optionCheck.message, severity: 'error',
      phase: 'host', recoverable: false,
      range: { start: 0, end: 0 }, line: 1, column: 1, messageKey: optionCheck.key,
      ...(optionCheck.detail === undefined ? {} : { params: { detail: optionCheck.detail } }),
    }] };
  }
  const maxSyntaxNodes = optionCheck.maxSyntaxNodes;
  // `strict` defaults to true; only the loose path plans structure recovery.
  const strict = optionCheck.strict !== false;
  const budget = new ParseWorkBudget({
    maxParseWork: optionCheck.maxParseWork,
    maxMarkdownDepth: optionCheck.maxMarkdownDepth,
  });
  // Soft breaks only become nodes when the host opts in; the source string is
  // never normalized, so offsets keep pointing at the original code units.
  const markdownBreaks = optionCheck.markdownBreaks;
  // The unified registry is the single source for accepted names and forms.
  const schemaByName = optionCheck.schemaByName;
  const externalNames = optionCheck.externalComponentNames;
  /** Inline forms behave like built-in inline tags for block placement. */
  const isInlineName = (name: string): boolean => schemaByName.get(name)?.form === 'inline';
  const known = schemaByName;
  const unmountedLeafNames = optionCheck.unmountedLeafNames;
  const suggestionNames = [...schemaByName.keys()];
  // Assembly capabilities: core Markdown always works; GFM, native HTML and
  // Lezer planning are installed only by the full assembly.
  const capabilities = optionCheck.capabilities;
  const htmlSupport = capabilities?.html;
  const scanStructure = capabilities?.markdownStructure;
  const nativeHtmlNames: ReadonlySet<string> = htmlSupport?.nativeTagNames ?? new Set<string>();
  const decodeEntities = htmlSupport?.decodeEntities ?? ((value: string): string => value);
  const decodeAttribute = htmlSupport?.decodeAttribute ?? decodeEntities;
  const markdown = markdownFor(capabilities);
  const sourceContext = context?.source === source ? context : new SourceContext(source);
  const {lineStarts} = sourceContext;
  const work: ParserWork = {markdownCalls:0,fastBlocks:0,generalBlocks:0,fastCharacters:0,generalCharacters:0,mappingSegments:0,sourceLines:lineStarts.length,maxComponentDepth:0};
  const cacheStart: ParseSessionCounters | undefined = cache?.counters();
  const startedAt = clock();
  let shieldPhaseMs = 0;
  let regionPhaseMs = 0;
  let convertPhaseMs = 0;
  const structures=new Map<string,MarkdownStructure>();
  const guarded=new Set<string>();
  const ensureDepth=(text:string):void=>{
    if(guarded.has(text)||!mayHaveContainer(text))return;
    guarded.add(text);
    const index=text===source?sourceContext:new SourceContext(text),facts=index.facts;
    let depth=facts.maxMarkdownDepth;
    // Raw prefixes are only an upper-bound hint. Resolve deep-looking code,
    // comments and same-line nested containers through the shared block scan.
    if(facts.potentialDepth>optionCheck.maxMarkdownDepth||depth>optionCheck.maxMarkdownDepth) {
      if(scanStructure){
        const structure=scanStructure(text);structures.set(text,structure);depth=structure.maxDepth;
      } else {
        // Resolve the hint with the core CommonMark tree when no advisory
        // planner is installed. Code and HTML leaves contribute no depth.
        depth=0;
        const pending=[{node:generalParse(text),depth:0}];
        while(pending.length){
          const current=pending.pop()!;
          const nested=current.depth+(current.node.type==='blockquote'||current.node.type==='list'?1:0);
          depth=Math.max(depth,nested);
          if(depth>optionCheck.maxMarkdownDepth)break;
          for(const child of current.node.children??[])pending.push({node:child,depth:nested});
        }
      }
    }
    budget.observeDepth(depth,0,Math.max(1,text.length));
  };
  const finishWork = (): void => {
    work.parseWork = budget.parseWork;
    work.maxMarkdownDepth = budget.maxDepth;
    if (cache) {
      const end = cache.counters();
      work.cacheHits = end.hits - (cacheStart?.hits ?? end.hits);
      work.cacheMisses = end.misses - (cacheStart?.misses ?? end.misses);
      work.reusedBlocks = end.reusedBlocks - (cacheStart?.reusedBlocks ?? end.reusedBlocks);
      work.reusedRows = end.reusedRows - (cacheStart?.reusedRows ?? end.reusedRows);
      work.reusedItems = end.reusedItems - (cacheStart?.reusedItems ?? end.reusedItems);
      work.reusedAst = end.reusedAst - (cacheStart?.reusedAst ?? end.reusedAst);
    }
    work.timings = {
      shieldMs: roundMs(shieldPhaseMs),
      regionMs: roundMs(regionPhaseMs),
      convertMs: roundMs(convertPhaseMs),
      totalMs: roundMs(clock() - startedAt),
    };
  };
  /**
   * General Markdown parses are pure functions of their text. Reusing the
   * read-only AST across session calls never changes ids or ranges because the
   * transform still rebuilds every LocalNode through this parse's factory.
   */
  const generalParse = (text: string): any => {
    const cached = cache?.readTree(text);
    if (cached?.hit) return cached.value;
    const tree = markdown.parse(text);
    cache?.writeTree(text, tree);
    return tree;
  };
  const parseMarkdown = (text: string, tryFast = true, fastContext:FastMarkdownContext={allowBraces:true}): any => {
    // Charge every submission up front, including cache hits, so whether a
    // document fits the work budget never depends on session state.
    budget.charge(text.length + 1, 0, Math.max(1, text.length));
    ensureDepth(text);
    if(!tryFast) {
      const tree=generalParse(text);
      work.markdownCalls++;work.generalBlocks+=tree.children.length;work.generalCharacters+=text.length;
      return tree;
    }
    let structure=structures.get(text);
    if(structure===undefined&&scanStructure){
      structure=scanStructure(text);structures.set(text,structure);
    }
    const {tree,stats}=parseMarkdownBlocks(text, generalParse, sourceContext, cache,structure,rowPlans,fastContext);
    work.markdownCalls++;
    work.fastBlocks+=stats.fastBlocks;work.generalBlocks+=stats.generalBlocks;
    work.fastCharacters+=stats.fastCharacters;work.generalCharacters+=stats.generalCharacters;
    return tree;
  };
  let serial = 0;
  let nodeCount = 0;
  /** Fast plans actually emitted, in document order (incremental reuse hints). */
  const fastPlans = new Set<FastMarkdownPlan>();
  const node = (type: string, start: number, end: number, extra: Partial<LocalNode> = {}): LocalNode => {
    if (nodeCount >= maxSyntaxNodes) {
      throw new LocalBudgetError('local.budget', `Syntax nodes exceed the limit of ${maxSyntaxNodes}.`, start, end, 'local.budget.nodes', { limit: maxSyntaxNodes }, nodeCount + 1);
    }
    nodeCount += 1;
    return { type, id: `local-${serial++}`, range: { start, end }, ...extra };
  };
  try {
    // One shared line/container scan bounds the root document before any
    // Markdown parser allocates an intermediate tree. Fenced and indented code
    // never contributes depth, so `>`/`-` inside code cannot be misread.
    budget.charge(source.length, 0, Math.max(1, source.length));
    // Only sources that may contain a container pay for the shared facts scan.
    ensureDepth(source);
    // Forced literal spans require region scanning; the plain-paragraph fast
    // path cannot represent them.
    const plain = literalRanges && literalRanges.length > 0
      ? undefined
      : parsePlainParagraphs(source, markdownBreaks, node);
    if (plain !== undefined) {
      work.fastBlocks=plain.length;work.fastCharacters=source.length;
      finishWork();
      return { nodes: plain, diagnostics, syntaxNodes: nodeCount, work };
    }
  } catch (cause) {
    if (cause instanceof ParseBudgetError) {
      reportParseBudget(cause);
      finishWork();
      return { nodes: [], diagnostics, work };
    }
    if (!(cause instanceof LocalBudgetError)) throw cause;
    reportLocalBudget(cause);
    return { nodes: [], diagnostics };
  }
  const reservedMarkers = new Set(source.match(new RegExp(MARK_OPEN + '[0-9]+' + MARK_CLOSE, 'g')) ?? []);
  const codeRanges: { start: number; end: number }[] = [];
  // Non-strict structural recovery. Ranges are merged, literal source spans;
  // the region scanner consumes each as one fallback token.
  let recoveryRanges: readonly SourceRange[] = [];
  let recoveries: LocalRecovery[] = [];
  const rootMathLiterals: SourceRange[] = [];
  /** Root-level footnote definitions, located by the Markdown parser. */
  const rootDefinitions: DefinitionRange[] = [];
  const sourceBomOffset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  /**
   * The first Markdown pass decides what is literal code and where footnote
   * definitions begin and end. Code stays opaque to the local lexical pass;
   * definitions are re-parsed separately so their bodies can keep controls and
   * interpolations inert while still formatting safe Markdown.
   */
  let rootMarkdown: any;
  let maskedAuthorBody = false;
  try {
    const markdownSource = source.slice(sourceBomOffset);
    rootMarkdown = parseMarkdown(markdownSource,true,{allowBraces:true,shield(text,offset){
      if(!text.includes('{{'))return;
      const parts:string[]=[];
      let cursor=0,search=0;
      while(search<text.length){
        const start=text.indexOf('{{',search);if(start<0)break;
        const stop=scanInterpolationEnd(source,start+offset+sourceBomOffset,offset+sourceBomOffset+text.length)-offset-sourceBomOffset;
        // Only validated simple blocks may use equal-length advisory text.
        // Multiline expressions keep the original shielding parser.
        if(stop<=start||/[\r\n]/.test(text.slice(start,stop)))return;
        parts.push(text.slice(cursor,start),'v'.repeat(stop-start));cursor=search=stop;
      }
      if(!parts.length)return;
      parts.push(text.slice(cursor));return parts.join('');
    }});
    // A wholly recognized simple document has no lexical tokens. Reject its
    // exact first over-budget node before constructing any LocalNode tree.
    if(!source.includes('{{')&&rootMarkdown.children.length===1 && rootMarkdown.children[0].type==='rmdFastBlock') {
      const overflow=(rootMarkdown.children[0].plan as FastMarkdownPlan).overflowAt(maxSyntaxNodes);
      if(overflow)throw new LocalBudgetError('local.budget',`Syntax nodes exceed the limit of ${maxSyntaxNodes}.`,overflow.start+sourceBomOffset,overflow.end+sourceBomOffset,'local.budget.nodes',{limit:maxSyntaxNodes},maxSyntaxNodes+1);
    }
    let facts=markdownTreeFacts(rootMarkdown);
    if (/<(?:css|javascript|iframe|dl|section|figure|figcaption)(?=[\s/>])/i.test(markdownSource)) {
      let shadow = markdownSource;
      let cursor = 0;
      // Recompute before classifying later tags: the leaked fence may have
      // hidden a real fence or made a fenced example look like a declaration.
      for (;;) {
        const repaired = maskLeakingAuthorBody(shadow, facts.codeRanges, facts.definitions, known, cursor);
        if (!repaired) break;
        maskedAuthorBody = true;
        shadow = repaired.source;
        cursor = repaired.end;
        rootMarkdown = parseMarkdown(shadow, false);
        facts = markdownTreeFacts(rootMarkdown);
      }
    }
    const shift=(range:SourceRange):SourceRange=>({start:range.start+sourceBomOffset,end:range.end+sourceBomOffset});
    for(const range of facts.codeRanges)codeRanges.push(shift(range));
    for(const range of facts.definitions)if(range.end>range.start)rootDefinitions.push(shift(range));
    for(const range of facts.mathLiterals)rootMathLiterals.push(shift(range));
    shieldPhaseMs = clock() - startedAt;
  } catch (cause) {
    if (cause instanceof ParseBudgetError) {
      reportParseBudget(cause);
      finishWork();
      return { nodes: [], diagnostics, work };
    }
    if(cause instanceof LocalBudgetError) {
      reportLocalBudget(cause);
      return {nodes:[],diagnostics,work};
    }
    error('local.parse', { key: 'local.parse.markdown' }, 0, undefined);
    return { nodes: [], diagnostics };
  }
  rootDefinitions.sort((a, b) => a.start - b.start || b.end - a.end);
  rootMathLiterals.sort((a, b) => a.start - b.start);
  const rootDefinitionRanges: DefinitionRange[] = [];
  for (const range of rootDefinitions) {
    const last = rootDefinitionRanges[rootDefinitionRanges.length - 1];
    if (last && range.start < last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      rootDefinitionRanges.push({ ...range });
    }
  }
  const codeEndAt = (offset: number): number | null => {
    let low = 0;
    let high = codeRanges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const range = codeRanges[middle];
      if (offset < range.start) high = middle - 1;
      else if (offset >= range.end) low = middle + 1;
      else return range.end;
    }
    return null;
  };
  function diagnostic(
    code: string,
    message: string,
    severity: 'error' | 'warning',
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
    structuredDetails?: Diagnostic['details'],
  ) {
    if (diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) {
      // Warnings must never crowd out a real error: once the budget is full a
      // new error replaces the newest warning that is still disposable.
      if (severity === 'warning') return;
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
    const line = low + 1;
    const text = message.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
      ? `${localCodeUnitPrefix(message, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
      : message;
    const key = details?.key ?? code;
    const resource = key === 'local.budget.nodes' ? { budget: 'maxSyntaxNodes', unit: 'nodes' }
      : key === 'local.budget.nesting' ? { budget: 'maxComponentDepth', unit: 'depth' }
      : key === 'local.budget.parse-work' ? { budget: 'maxParseWork', unit: 'work' }
      : key === 'local.budget.markdown-depth' ? { budget: 'maxMarkdownDepth', unit: 'depth' }
      : undefined;
    const bounded = localDiagnosticDetails(key, details?.params);
    const limit = bounded.params?.limit;
    diagnostics.push({
      code,
      message: text,
      severity,
      range: { start: safeStart, end: safeEnd },
      line,
      column: safeStart - lineStarts[low] + 1,
      messageKey: bounded.key,
      phase: code.startsWith('local.budget') ? 'resource' : 'parse',
      recoverable: severity === 'warning',
      ...(resource && typeof limit === 'number' && typeof structuredDetails?.actual === 'number'
        ? { details: { ...resource, limit, actual: structuredDetails.actual, ...structuredDetails } } : {}),
      ...(bounded.params ? { params: bounded.params } : {}),
    });
  }
  /** Key-first calls derive the English text from the registered template. */
  function resolveDiagnosticMessage(
    message: string | LocalDiagnosticDetails,
  ): { text: string; details?: LocalDiagnosticDetails } {
    return typeof message === 'string' ? { text: message } : { text: diagnosticEnglish(message), details: message };
  }
  function error(
    code: string,
    message: string | LocalDiagnosticDetails,
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
    structuredDetails?: Diagnostic['details'],
  ) {
    const resolved = resolveDiagnosticMessage(message);
    diagnostic(code, resolved.text, 'error', start, end, resolved.details ?? details, structuredDetails);
  }
  function warning(
    code: string,
    message: string | LocalDiagnosticDetails,
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
  ) {
    const resolved = resolveDiagnosticMessage(message);
    diagnostic(code, resolved.text, 'warning', start, end, resolved.details ?? details);
  }
  function reportLocalBudget(cause: LocalBudgetError): void {
    const resource = cause.key === 'local.budget.nodes' ? { budget: 'maxSyntaxNodes', unit: 'nodes' }
      : cause.key === 'local.budget.nesting' ? { budget: 'maxComponentDepth', unit: 'depth' }
      : undefined;
    const limit = cause.params?.limit;
    error(cause.code, cause.message, cause.start, cause.end,
      { key: cause.key, ...(cause.params ? { params: cause.params } : {}) },
      resource && typeof limit === 'number' && cause.actual !== undefined
        ? { ...resource, limit, actual: cause.actual }
        : undefined,
    );
  }
  /** Convert a deterministic budget failure into a localized parse diagnostic. */
  function reportParseBudget(cause: ParseBudgetError): void {
    const key = cause.kind === 'parse-work' ? 'local.budget.parse-work' : 'local.budget.markdown-depth';
    const actual = cause.kind === 'parse-work' ? budget.parseWork : budget.maxDepth;
    const resource = cause.kind === 'parse-work' ? { budget: 'maxParseWork', unit: 'work' } : { budget: 'maxMarkdownDepth', unit: 'depth' };
    error('local.budget', { key, params: { limit: cause.limit } }, cause.start, cause.end, undefined, { ...resource, limit: cause.limit, actual });
  }


  const headers: DocumentHeaders = { themeHeaders: 0, headerCursor: 0, versionHeaders: 0 };
  const convert = createMarkdownConverter({
    source, maxSyntaxNodes, budget, markdownBreaks, isInlineName, sourceContext,
    work, parseMarkdown, readNodeCount: () => nodeCount, fastPlans, node,
    reservedMarkers, sourceBomOffset, rootMarkdown, maskedAuthorBody, error,
  });
  let region: ReturnType<typeof createRegionScanner>;
  const scanner = createTagScanner({
    source, strict, known, htmlSupport, decodeEntities, decodeAttribute, sourceContext,
    node, codeEndAt, error, region: (...args) => region(...args), convert,
  });
  const { htmlCloseEnd, protectedEnd, scanTag, beginsLine } = scanner;

  /**
   * Undefined references stay visible as their original source. Definitions
   * are first-class nodes, so resolution happens once the whole tree (including
   * container bodies) exists; the first definition of an identifier wins for
   * the renderer, which receives every definition node unchanged.
   */
  function resolveFootnoteReferences(nodes: LocalNode[]): void {
    const defined = new Set<string>();
    const pending = [...nodes];
    while (pending.length) {
        const item = pending.pop()!;
        if (item.type === 'footnoteDefinition' && item.identifier) defined.add(item.identifier);
        if (item.children) for (const child of item.children) pending.push(child);
    }
    pending.push(...nodes);
    while (pending.length) {
        const item = pending.pop()!;
        if (item.type === 'footnoteReference' && (!item.identifier || !defined.has(item.identifier))) {
          item.type = 'text';
          item.value = source.slice(item.range.start, item.range.end);
          delete item.identifier;
          delete item.label;
        }
        if (item.children) for (const child of item.children) pending.push(child);
    }
  }
  /**
   * Emit one warning per distinct recovery after parsing completes. Later
   * semantic failures retain these warnings. An aborted parse may retain
   * recovery plans, but must not claim those plans were rendered.
   */
  function emitRecoveryWarnings(): void {
    if (strict || recoveries.length === 0) return;
    const seen = new Set<string>();
    let emitted = false;
    for (const recovery of recoveries) {
      if (!RECOVERY_DIAGNOSTIC_CODES.has(recovery.code)) continue;
      const { causeRange, affectedRange } = recovery;
      const identity = `${recovery.code}:${causeRange.start}:${causeRange.end}:${affectedRange.start}:${affectedRange.end}:${recovery.boundary}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      warning(recovery.code, renderLocalDiagnostic(recovery.code, 'en'), causeRange.start, causeRange.end, { key: recovery.code });
      emitted = true;
    }
    // Recovery warnings merge into the parser's source order. Normal sources
    // and strict parses never take this path.
    if (emitted) diagnostics.sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
  }
  try {
    if (!strict && source.includes('<')) {
      // Decide every structure recovery before the region scanner allocates
      // component, declaration or interpolation nodes. The planner shares the
      // code/comment/raw-HTML shields used below and charges one work budget.
      const plan = planRmdRecovery(source, {
        facts: sourceContext.facts,
        definitions: rootDefinitionRanges,
        isKnown: (name) => known.has(name),
        isPaired: (name) => {
          const schema = known.get(name);
          return schema === undefined ? !unmountedLeafNames.has(name) : schema.form !== 'leaf';
        },
        isHtmlName: (name) => htmlSupport !== undefined && (HTML_NAMES.has(name) || nativeHtmlNames.has(name)),
        isVoidHtml: (name) => NATIVE_HTML_VOID.has(name) || HTML_VOID_ELEMENTS.has(name),
        rawHtmlEnd: (name, bodyStart, insideContainer) => {
          if (name === 'plaintext') return source.length;
          if (name === 'pre' || name === 'code') {
            return htmlCloseEnd(bodyStart, name, source.length, insideContainer)?.end ?? null;
          }
          const close = new RegExp(`</${name}\\s*>`, 'i').exec(source.slice(bodyStart));
          return close ? bodyStart + close.index + close[0].length : null;
        },
        protectedEnd: (offset, insideContainer) => protectedEnd(offset, source.length, insideContainer),
        codeEndAt: (offset) => codeEndAt(offset),
        readTag: (offset) => {
          const scanned = scanTag(offset, source.length);
          if (scanned) {
            return { name: scanned.name, closing: scanned.closing, self: scanned.self, end: scanned.end, complete: true };
          }
          const head = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/.exec(source.slice(offset, Math.min(source.length, offset + 256)));
          if (!head) return null;
          return { name: head[2], closing: Boolean(head[1]), self: false, end: offset + head[0].length, complete: false };
        },
        beginsLine,
        charge: (units, from, to) => budget.charge(units, from, to),
      });
      recoveryRanges = plan.ranges;
      recoveries = [...plan.recoveries];
    }
    // Streaming hosts can force regions to stay literal. They share the loose
    // mode fallback token path but never produce recovery records.
    if (literalRanges && literalRanges.length > 0) {
      recoveryRanges = normalizeSourceRanges([...recoveryRanges, ...literalRanges], source.length);
    }

    region = createRegionScanner({
      source, diagnostics, maxSyntaxNodes, strict, budget, known, externalNames,
      unmountedLeafNames, suggestionNames, htmlSupport, nativeHtmlNames, sourceContext,
      work, ensureDepth, parseMarkdown, node, codeRanges, recoveryRanges, recoveries,
      rootMathLiterals, rootDefinitionRanges, error, warning, headers, scanner, convert,
    });

    const regionStart = clock();
    const result = region(0, source.length);
    regionPhaseMs = clock() - regionStart;
    const convertStart = clock();
    const nodes = convert(0, source.length, result.tokens);
    convertPhaseMs = clock() - convertStart;
    resolveFootnoteReferences(nodes);
    recoveries.sort((left, right) => left.causeRange.start - right.causeRange.start
      || left.causeRange.end - right.causeRange.end || left.affectedRange.start - right.affectedRange.start
      || left.affectedRange.end - right.affectedRange.end || left.code.localeCompare(right.code));
    emitRecoveryWarnings();
    finishWork();
    const { theme, themeRange, versionDeclaration } = headers;
    return {
      nodes,
      diagnostics,
      syntaxNodes: nodeCount,
      work,
      ...(fastPlans.size ? { plans: [...fastPlans] } : {}),
      ...(versionDeclaration ? { versionDeclaration } : {}),
      ...(theme !== undefined ? { theme } : {}),
      ...(themeRange ? { themeRange } : {}),
      ...(recoveries.length ? { recoveries } : {}),
    };
  } catch (cause) {
    if (cause instanceof ParseBudgetError) {
      reportParseBudget(cause);
      finishWork();
      return { nodes: [], diagnostics, work, ...(recoveries.length ? { recoveries } : {}) };
    }
    if (cause instanceof LocalBudgetError) {
      reportLocalBudget(cause);
      finishWork();
      return { nodes: [], diagnostics, work, ...(recoveries.length ? { recoveries } : {}) };
    }
    error('local.parse', {
      key: 'local.parse.document',
      params: { detail: cause instanceof Error ? cause.message : String(cause) },
    }, 0, undefined);
    return { nodes: [], diagnostics, ...(recoveries.length ? { recoveries } : {}) };
  }
}
