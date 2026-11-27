import { TreeFragment, type Tree } from '@lezer/common';
import { parser, GFM } from '@lezer/markdown';
import { compileLocalTracked, type LocalCompilerServices } from '../compiler';
import { localDocumentRequiresRuntime } from '../runtime-requirement';
import { collectUsedComponents } from '../component-usage';
import { compileLocalStreamingTracked } from '../streaming';
import { LocalSemanticCache } from './semantic-cache';
import type { SemanticCacheStats } from '../compiler-services';
import {LocalParseSession} from '../../parsing/parse-session';
import {shareCompiledData,countSharedNodes} from '../../transport/shared-data';
import {reuseFlatRows} from './row-reuse';
import type {InlinePlan,InlinePlanLookup} from '../../parsing/fast-markdown';
import { plainCompiledData } from '../../transport/compiled-data';
import {
  localCompileOptionsKey,
  readLocalCompileOptions,
} from '../../../assemblies/default-options';
import { readLocalConfig } from '../../../assemblies/default-config';
import { getLocalComponent } from '../../../assemblies/default-schema';
import { MAX_LOCAL_DOCUMENT_LENGTH } from '../../../contracts/limits';
import type { LocalCompileOptions, LocalCompileResult, LocalDocument, LocalNode, LocalSourcePhase, SourceRange } from '../../types';

/**
 * Recovery mode disables incremental block assembly. Repaired regions have
 * boundaries and synthetic nodes that a block-level reuse decision cannot
 * validate, so loose mode always runs the same complete reference compile.
 * The identity still comes from `localCompileOptionsKey`, which carries the
 * recovery strategy version for `strict: false`.
 */
function isRecoveryMode(options: LocalCompileOptions | undefined): boolean {
  return typeof options === 'object' && options !== null
    && (options as { strict?: unknown }).strict === false;
}

/** Any present recovery list, including an explicit empty one, disables block reuse. */
function hasRecoveries(result: LocalCompileResult): boolean {
  return Object.hasOwn(result, 'recoveries') && result.recoveries !== undefined;
}

/** Only the two declared values are phases; anything else keeps legacy semantics. */
function readSourcePhase(value: unknown): LocalSourcePhase | undefined {
  return value === 'streaming' || value === 'final' ? value : undefined;
}

/** An explicitly declared but unsupported phase must fail closed, never compile as final. */
function invalidSourcePhaseResult(): LocalCompileResult {
  return {
    ok: false,
    status: 'failed',
    diagnostics: [{
      code: 'local.options.invalid',
      message: 'Compile option sourcePhase must be "streaming" or "final".',
      severity: 'error',
      range: { start: 0, end: 0 },
      line: 1,
      column: 1,
      messageKey: 'local.options.invalid.source-phase',
      phase: 'host',
      recoverable: false,
    }],
  };
}

/** A host may mark the phase on the options object instead of the call argument. */
function optionSourcePhase(options: LocalCompileOptions | undefined): LocalSourcePhase | undefined {
  try {
    return typeof options === 'object' && options !== null
      ? readSourcePhase((options as {sourcePhase?: unknown}).sourcePhase)
      : undefined;
  } catch {
    return undefined;
  }
}

const markdown = parser.configure(GFM);
const separator = '\n\n<!-- incremental-boundary -->\n\n';
type Dependencies = Record<string, readonly string[] | null>;
interface Block {
  from: number; to: number; origin: number; text: string;
  nodes: LocalNode[]; dependencies: Dependencies; cost: number;
  /**
   * A raw-body container compiles as one opaque block. Its Markdown-free text
   * may contain tag-shaped lines, so it is masked for the Lezer pass and
   * recompiled whole when an edit lands inside it.
   */
  opaque?: true;
  /** Prefix used for this block's isolated compile (opaque blocks omit themselves). */
  prefix?: string;
  /** Syntax nodes of `prefix`; subtracted from the isolated compile count. */
  prefixCost?: number;
  /** Per-row inline plans from the compile that produced this block. */
  rowPlans?: ReadonlyMap<string, InlinePlan | undefined>;
  publication?:{delta:number;nodes:LocalNode[]};
}
interface Snapshot {
  source: string; key: string; tree: Tree; metadata: LocalDocument;
  blocks: Block[]; context: Block[]; contextCost: number;
  prefix: string; prefixCost: number;
}
type Tracked = ReturnType<typeof compileLocalTracked>;

function allNodes(nodes: LocalNode[]): LocalNode[] {
  const result: LocalNode[] = [], stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!; result.push(node);
    if (node.children) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return result;
}
function copyNodes(nodes: LocalNode[], delta: number, rename?: Map<string, string>): LocalNode[] {
  if(delta===0&&!rename)return nodes;
  return nodes.map(node => ({ ...node, id: rename?.get(node.id) ?? node.id,
    range: {start: node.range.start + delta, end: node.range.end + delta},
    ...(node.fallback ? { fallback: { ...node.fallback, range: {
      start: node.fallback.range.start + delta, end: node.fallback.range.end + delta,
    } } } : {}),
    ...(node.attrs ? {attrs: {...node.attrs}} : {}), ...(node.align ? {align: [...node.align]} : {}),
    ...(node.children ? {children: copyNodes(node.children, delta, rename)} : {}),
  }));
}
function dependencies(nodes: LocalNode[], document: LocalDocument, rename?: Map<string, string>): Dependencies {
  const result: Dependencies = Object.create(null);
  for (const node of allNodes(nodes)) result[rename?.get(node.id) ?? node.id] = document.dependencies?.[node.id] ?? null;
  return result;
}
const NO_RAW_NAMES: ReadonlySet<string> = new Set();
const RAW_BODY_RULE = 'raw-body';

/** Container names whose body is delivered as one lazy raw node. */
function rawComponentNames(options: LocalCompileOptions | undefined): ReadonlySet<string> {
  try {
    const check = readLocalCompileOptions(options);
    if (!check.ok) return NO_RAW_NAMES;
    const names = new Set<string>();
    for (const [name, schema] of check.schemaByName) {
      if (schema.form === 'container' && schema.structure.rule === RAW_BODY_RULE) names.add(name);
    }
    return names.size ? names : NO_RAW_NAMES;
  } catch {
    return NO_RAW_NAMES;
  }
}
function isRawNode(node: LocalNode, rawNames: ReadonlySet<string>): boolean {
  return (node.type === 'component' || node.type === 'hostComponent')
    && node.name !== undefined && rawNames.has(node.name);
}
type BlockKind = 'context' | 'fragment' | 'unsupported' | 'raw';
function contextKind(node: LocalNode, rawNames: ReadonlySet<string> = NO_RAW_NAMES): BlockKind {
  // A raw container is one opaque unit, even though it is a component node.
  if (isRawNode(node, rawNames)) return 'raw';
  let context = false;
  for (const child of allNodes([node])) {
    if (['authorCss', 'authorJavaScript', 'extendedHtmlRaw'].includes(child.type)
      || (child.attrs && (Object.hasOwn(child.attrs, 'css') || Object.hasOwn(child.attrs, 'action-id')))) return 'unsupported';
    if (['definition', 'footnoteDefinition', 'footnoteReference', 'linkReference', 'imageReference'].includes(child.type)) return 'unsupported';
    if (child.type === 'hostComponent' || child.type === 'htmlDocument' || child.type === 'fallback') {
      // A raw container nested in a Markdown container stays opaque text; the
      // enclosing root is still one context unit.
      if (isRawNode(child, rawNames)) { context = true; continue; }
      return 'unsupported';
    }
    if (child.type === 'component') {
      if (isRawNode(child, rawNames)) { context = true; continue; }
      if (['anchor', 'jump'].includes(child.name ?? '') || !getLocalComponent(child.name ?? '')) return 'unsupported';
      context = true;
    }
    if (child.type === 'comment') context = true;
  }
  return context ? 'context' : 'fragment';
}
function mask(source: string, context: Block[]): string {
  let text = '', cursor = 0;
  for (const block of context) {
    text += source.slice(cursor, block.from) + block.text.replace(/[^\r\n]/g, ' ');
    cursor = block.to;
  }
  return text + source.slice(cursor);
}
function boundaries(tree: Tree, context: Block[], source: string): SourceRange[] | null {
  // Lezer deliberately does not resolve references. Such documents must use
  // the full semantic parser, including definitions nested in lists/quotes.
  const cursor = tree.cursor();
  do { if (cursor.name === 'LinkReference') return null; } while (cursor.next());
  const ranges: SourceRange[] = [];
  let contextIndex = 0;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    // Lezer's leaf range may omit indentation (notably indented code).
    // Restore the complete line prefix before invoking the semantic parser.
    let start = node.from, end = node.to;
    while (start > 0 && (source[start-1] === ' ' || source[start-1] === '\t')) start--;
    if (start > 0 && source[start-1] !== '\r' && source[start-1] !== '\n') start = node.from;
    while (source[end] === ' ' || source[end] === '\t') end++;
    while (contextIndex < context.length && context[contextIndex].to <= start) contextIndex++;
    if (contextIndex < context.length && context[contextIndex].from < end) return null;
    ranges.push({start, end});
  }
  return ranges;
}
/**
 * Lezer only breaks lines at `\n`; the local parser also accepts a lone `\r`.
 * Their line models then disagree, so such sources keep the full path.
 */
function hasLoneCarriageReturn(source: string): boolean {
  return /\r(?!\n)/.test(source);
}
function lineStart(source: string, at: number): number {
  while (at > 0 && source[at-1] !== '\n' && source[at-1] !== '\r') at--;
  return at;
}
/**
 * The parser's shielding pass hands the raw source to remark, which reads a
 * component line as an HTML block running to the next blank line. Content it
 * swallows is shielded differently from the same content compiled after the
 * incremental prefix, so every context block must be followed by a blank
 * line, the end of the source or another context block.
 */
function contextRunsOn(source: string, context: readonly Block[]): boolean {
  const starts = new Set(context.map(block => block.from));
  for (const block of context) {
    let at = block.to;
    while (source[at] === ' ' || source[at] === '\t') at++;
    if (at >= source.length) continue;
    if (source[at] === '\r' && source[at+1] === '\n') at += 2;
    else if (source[at] === '\n' || source[at] === '\r') at++;
    else return true;
    while (source[at] === ' ' || source[at] === '\t') at++;
    if (at < source.length && source[at] !== '\n' && source[at] !== '\r' && !starts.has(at)) return true;
  }
  return false;
}
/** Structural equality of two nodes at their source offsets, ignoring generated ids. */
function sameNode(a: LocalNode, aDelta: number, b: LocalNode, bDelta: number): boolean {
  if (a.type !== b.type || a.range.start + aDelta !== b.range.start + bDelta || a.range.end + aDelta !== b.range.end + bDelta) return false;
  let fields = 0;
  for (const [key, value] of Object.entries(a)) {
    if (value === undefined || key === 'id' || key === 'range') continue;
    fields++;
    const other = (b as unknown as Record<string, unknown>)[key];
    if (key === 'children') {
      const children = value as LocalNode[], others = other as LocalNode[] | undefined;
      if (!others || children.length !== others.length) return false;
      for (let index = 0; index < children.length; index++) if (!sameNode(children[index], aDelta, others[index], bDelta)) return false;
    } else if (value !== other && JSON.stringify(value) !== JSON.stringify(other)) return false;
  }
  for (const [key, value] of Object.entries(b)) if (value !== undefined && key !== 'id' && key !== 'range') fields--;
  return fields === 0;
}
function change(before: string, after: string) {
  let from = 0, oldTo = before.length, newTo = after.length;
  while (from < oldTo && from < newTo && before.charCodeAt(from) === after.charCodeAt(from)) from++;
  while (oldTo > from && newTo > from && before.charCodeAt(oldTo - 1) === after.charCodeAt(newTo - 1)) { oldTo--; newTo--; }
  return {from, oldTo, newTo, delta: newTo - oldTo};
}
/**
 * Collect the inline plans of the fast region that exactly matches `text`.
 * These plans are a pure function of the row text, so a later edit of the same
 * block can reuse them without touching the bounded global LRU.
 */
function rowPlansFor(tracked: Tracked, text: string): ReadonlyMap<string, InlinePlan | undefined> | undefined {
  const plans = tracked.parsed?.plans;
  if (!plans?.length) return;
  // Fast plans are pure functions of their text, so the region that matches
  // this block is the best hint. A single whole-document plan also covers
  // every block (including large ones embedded in plain paragraphs).
  for (const plan of plans) if (plan.source === text) return plan.rows;
  if (plans.length === 1) return plans[0].rows;
  return;
}


export interface LocalIncrementalStats {
  mode: 'full' | 'incremental' | 'cached' | 'streaming';
  totalBlocks: number;
  compiledBlocks: number;
  reusedBlocks: number;
  compiledCharacters: number;
  fallbackReason?: string;
  /** Block-index construction attempts during this call (including deferred recovery). */
  cacheBuilds?: number;
  sharedNodes?:number;
  semantic?:SemanticCacheStats;
  parse?:Readonly<LocalParseSession['stats']>;
  stages?:Readonly<Record<string,number>>;
}

export class LocalCompileSession {
  private disposed = false;  private snapshot: Snapshot | null = null;
  private deferred: {source: string; key: string; tracked: Tracked; options?:LocalCompileOptions} | null = null;
  private readonly parseSession=new LocalParseSession();
  private readonly semantic=new LocalSemanticCache();
  private readonly services:LocalCompilerServices={parser:this.parseSession,semantic:this.semantic};
  private rawNamesCache:{key:string;names:ReadonlySet<string>}|null=null;
  private shared:LocalCompileResult|null=null;
  private sharedKey:string|undefined;
  private sharedMode:boolean|undefined;
  /**
   * One streaming snapshot is enough for preview consumption: the scheduler
   * throttles updates and an identical snapshot must not be recompiled. It is
   * deliberately separate from the final caches above.
   */
  private streamingCache:{source:string;key:string;result:LocalCompileResult;blocks:number}|null=null;
  private epoch=0;
  private cacheBuilds = 0;
  private serial = 0;
  private lastStats: LocalIncrementalStats = { mode: 'full', totalBlocks: 0, compiledBlocks: 0, reusedBlocks: 0, compiledCharacters: 0 };
  get stats(): Readonly<LocalIncrementalStats> { return { ...this.lastStats, cacheBuilds: this.cacheBuilds }; }
  compile(source: string, options?: LocalCompileOptions, phase?: LocalSourcePhase): LocalCompileResult {
    const result=this.compileShared(source,options,phase),start=performance.now();
    const published=plainCompiledData(result);
    this.lastStats={...this.lastStats,stages:{...this.lastStats.stages,publicSnapshotMs:performance.now()-start}};
    return published;
  }
  /**
   * Compiler-owned persistent result for the Worker and preview. Treat as read-only.
   * `phase` wins over `options.sourcePhase`; when neither supplies a valid phase
   * the call keeps the historical final-compilation result shape.
   */
  compileShared(source:string,options?:LocalCompileOptions,phase?:LocalSourcePhase, collectPerformance = !!options?.observer?.onTrace):LocalCompileResult {
    if(this.disposed)throw new Error('Local compile session is disposed');
    // A phase argument is an explicit contract: an unsupported value fails
    // instead of silently falling back to the interactive final semantics.
    if(phase!==undefined&&readSourcePhase(phase)===undefined)return invalidSourcePhaseResult();
    const optionPhase=optionSourcePhase(options);
    const effective=readSourcePhase(phase)??optionPhase;
    // Streaming never reads or mutates the final caches: a later final compile
    // must not inherit a stabilized partial snapshot, deferred index or shared
    // result graph from an intermediate snapshot.
    if(effective==='streaming')return this.compileStreaming(source,options,collectPerformance);
    if(effective==='final')return this.compileFinal(source,optionPhase==='streaming' ? {...options,sourcePhase:'final'} : options,collectPerformance);
    return this.compileFinalOrLegacy(source,options,collectPerformance);
  }
  /** Explicit final phase: the normal path plus the resolved compile status. */
  private compileFinal(source:string,options:LocalCompileOptions | undefined, collectPerformance:boolean):LocalCompileResult {
    const result=this.compileFinalOrLegacy(source,options,collectPerformance);
    // Node and document identity stay untouched; only the result wrapper is new.
    return result.ok
      ?{...result,status:hasRecoveries(result)?'recovered' as const:'valid' as const}
      :{...result,status:'failed' as const};
  }
  private compileStreaming(source:string,options:LocalCompileOptions | undefined,collectPerformance:boolean):LocalCompileResult {
    // The streaming cache is keyed by source and option identity; invalid
    // options must always reach the compiler so their diagnostic is not hidden
    // by a cached success for the same text.
    const check=readLocalCompileOptions(options),cacheable=check.ok;
    const key=localCompileOptionsKey(options),cached=this.streamingCache;
    if(cacheable&&cached!==null&&cached.source===source&&cached.key===key){
      this.lastStats={mode:'streaming',totalBlocks:cached.blocks,compiledBlocks:0,reusedBlocks:0,compiledCharacters:0};
      return cached.result;
    }
    const tracked=compileLocalStreamingTracked(source,options,this.services,collectPerformance);
    const blocks=tracked.parsed?.nodes.length??0;
    this.lastStats={mode:'streaming',totalBlocks:blocks,compiledBlocks:blocks,reusedBlocks:0,
      compiledCharacters:typeof source==='string'?source.length:0,stages:tracked.timings};
    // This result is the one the compiler owns for this snapshot; callers that
    // need independence use `compile`, which snapshots it into plain data.
    if(cacheable)this.streamingCache={source,key,result:tracked.result,blocks};
    return tracked.result;
  }
  /** The historical compile path, shared by legacy and explicit-final callers. */
  private compileFinalOrLegacy(source:string,options:LocalCompileOptions | undefined, collectPerformance:boolean):LocalCompileResult {
    this.epoch++;
    const key=localCompileOptionsKey(options);
    // A mode switch must never be answered from a result produced under the
    // other strategy, even if another key component happens to collide.
    const mode=isRecoveryMode(options);
    if(key!==this.sharedKey||mode!==this.sharedMode){this.shared=null;this.sharedKey=key;this.sharedMode=mode;}
    const result=this.compileCore(source,options,collectPerformance),start=performance.now(),previous=this.shared;
    const persistent=shareCompiledData(previous??undefined,result).value;
    this.shared=persistent;
    this.lastStats={...this.lastStats,sharedNodes:countSharedNodes(previous,persistent),parse:this.parseSession.stats,
      semantic:this.lastStats.semantic??this.semantic.stats,
      stages:{...this.lastStats.stages,sharedPublicationMs:performance.now()-start}};
    return persistent;
  }
  private compileCore(source: string, options: LocalCompileOptions | undefined, collectPerformance: boolean): LocalCompileResult {
    if (this.disposed) throw new Error('Local compile session is disposed');
    this.cacheBuilds = 0;
    const key = localCompileOptionsKey(options), check = readLocalCompileOptions(options);
    // Raw-body containers are opaque units, not Markdown fragments. Their
    // names follow the validated schema list for this option identity.
    const rawNames = this.rawNames(key, options);
    // Loose mode reuses no block index: repaired boundaries, withdrawn nodes
    // and synthetic nodes must come from one complete reference compile so the
    // recovered result keeps exactly the strict pass's budgets and ranges.
    const recoveryMode = isRecoveryMode(options);
    let reason = recoveryMode ? 'recovery-reference' : 'initial';
    let defer = false;
    const pending = this.deferred;
    this.deferred = null;
    if (!recoveryMode && pending && pending.key === key && check.ok && typeof source === 'string' && source.length <= MAX_LOCAL_DOCUMENT_LENGTH) {
      if (source === pending.source) {
        this.deferred = pending;
        this.lastStats = {mode: 'cached', totalBlocks: this.lastStats.totalBlocks, compiledBlocks: 0, reusedBlocks: this.lastStats.totalBlocks, compiledCharacters: 0};
        return pending.tracked.result;
      }
      // Keep only the latest successful full result during context churn.
      // Build its block index when an ordinary edit can actually use it.
      defer = true;
      reason = 'scope-or-boundary';
      const edit = change(pending.source, source);
      const touches = (range: SourceRange) => edit.from <= range.end && edit.oldTo >= range.start;
      const parsed = pending.tracked.parsed;
      if (parsed && !/[`\\~]/.test(pending.source.slice(edit.from, edit.oldTo) + source.slice(edit.from, edit.newTo))
        && !parsed.nodes.some(n => touches(n.range) && contextKind(n, rawNames) !== 'fragment')
        && ![parsed.versionDeclaration?.range, parsed.themeRange].some(r => r && touches(r))) {
        try { this.snapshot = this.seed(pending.source, key, pending.tracked, options, undefined, rawNames); }
        catch { this.snapshot = null; }
      }
    } else if (pending) reason = recoveryMode ? 'recovery-reference' : 'options-or-limits';
    const previous = this.snapshot;
    if (!recoveryMode && previous && previous.key === key && check.ok && typeof source === 'string' && source.length <= MAX_LOCAL_DOCUMENT_LENGTH) {
      if (source === previous.source) {
        this.lastStats = {mode: 'cached', totalBlocks: previous.blocks.length, compiledBlocks: 0, reusedBlocks: previous.blocks.length, compiledCharacters: 0};
        return this.publish(previous);
      }
      let updated: Snapshot | null = null;
      try { updated = this.update(previous, source, options, check.maxSyntaxNodes, rawNames, collectPerformance); }
      catch { /* Incremental machinery must preserve the full compiler's error boundary. */ }
      if (updated) { this.snapshot = updated; return this.publish(updated); }
      reason = 'scope-or-boundary';
      defer = true;
    } else if (previous) reason = recoveryMode ? 'recovery-reference' : 'options-or-limits';
    this.snapshot = null;
    const tracked = compileLocalTracked(source, options, this.services, undefined, collectPerformance);
    this.lastStats = {mode: 'full', totalBlocks: tracked.parsed?.nodes.length ?? 0, compiledBlocks: tracked.parsed?.nodes.length ?? 0, reusedBlocks: 0, compiledCharacters: typeof source === 'string' ? source.length : 0, fallbackReason: reason,semantic:tracked.semantic,stages:tracked.timings};
    if (!recoveryMode && tracked.result.ok && !tracked.result.document.capabilities && tracked.result.diagnostics.length === 0 && !hasRecoveries(tracked.result) && check.ok && key !== 'invalid') {
      if (defer) {
        const deferredOptions = options === undefined ? undefined : plainCompiledData(options);
        // Keep the validated, frozen config so per-block compile keys do not
        // revalidate the whole registry. An invalid config is left untouched
        // and reported by the compiler.
        let trustedOptions = deferredOptions;
        if (deferredOptions?.config !== undefined) {
          try {
            trustedOptions = { ...deferredOptions, config: readLocalConfig(deferredOptions.config) };
          } catch {
            /* reported later by the compiler */
          }
        }
        this.deferred = {source, key, tracked, options: trustedOptions};
      } else {
        try { this.snapshot = this.seed(source, key, tracked, options, undefined, rawNames); }
        catch { this.snapshot = null; }
      }
      if (this.snapshot) this.lastStats.totalBlocks = this.lastStats.compiledBlocks = this.snapshot.blocks.length;
    }
    return this.snapshot?this.publish(this.snapshot):tracked.result;
  }
  private seed(source: string, key: string, tracked: Tracked, options?: LocalCompileOptions,preparedTree?:Tree,knownRaw?:ReadonlySet<string>): Snapshot | null {
    this.cacheBuilds++;
    if (!tracked.result.ok || !tracked.parsed || hasRecoveries(tracked.result) || source.includes('[^') || source.includes('\ufeff')
      || hasLoneCarriageReturn(source)) return null;
    const rawNames = knownRaw ?? this.rawNamesFor(options);
    const roots = tracked.parsed.nodes, kinds = roots.map(node => contextKind(node, rawNames));
    // A plain single-block document normally has nothing to reuse. One huge
    // flat list or table is the exception: row-level reuse makes the
    // incremental path cheaper than a full recompile, so let it seed. A raw
    // container block is reusable on its own as well.
    const rowBlock = roots.length === 1 && kinds[0] === 'fragment'
      && (roots[0].type === 'list' || roots[0].type === 'table');
    const rawRoots = kinds.filter(kind => kind === 'raw').length;
    if (kinds.includes('unsupported')
      || (!rowBlock && rawRoots === 0 && kinds.filter(kind => kind === 'fragment').length < 2)) return null;
    const doc:LocalDocument = {...tracked.result.document,nodes:[],source:''};
    const rendered = new Map(tracked.result.document.nodes.map(node => [node.id, node]));
    /** Every non-fragment root, including raw bodies; used for masking. */
    const masking: Block[] = [];
    const fragments: LocalNode[] = [];
    for (let index = 0; index < roots.length; index++) {
      const node = roots[index], kind = kinds[index];
      if (kind === 'fragment') { fragments.push(node); continue; }
      const nodes = rendered.has(node.id) ? [rendered.get(node.id)!] : [];
      const block: Block = {from: node.range.start, to: node.range.end, origin: node.range.start,
        text: source.slice(node.range.start, node.range.end), nodes, dependencies: dependencies(nodes, doc), cost: 0};
      if (kind === 'raw') {
        // A raw component is published as one block, so an interior edit
        // recompiles exactly this unit instead of Markdown fragments of it.
        if (!nodes.length) return null;
        block.opaque = true;
        block.cost = allNodes(nodes).length;
      }
      masking.push(block);
    }
    for (const range of [tracked.parsed.versionDeclaration?.range, tracked.parsed.themeRange]) {
      if (range && !masking.some(b => range.start >= b.from && range.end <= b.to)) {
        masking.push({from: range.start, to: range.end, origin: range.start, text: source.slice(range.start,range.end), nodes: [], dependencies: {}, cost: 0});
      }
    }
    masking.sort((a,b) => a.from-b.from);
    if (contextRunsOn(source, masking)) return null;
    const masked = mask(source, masking);
    // The local HTML scanner and Markdown's HTML lexer have different block
    // boundaries. Keep their whole-document shielding on the full path.
    if (masked.includes('<')) return null;
    const tree = preparedTree??markdown.parse(masked);
    const ranges = boundaries(tree, masking, masked);
    if (!ranges) return null;
    const opaqueBlocks = masking.filter(block => block.opaque);
    for (const block of opaqueBlocks) {
      if (ranges.some(range => range.start < block.to && range.end > block.from)) return null;
    }
    const entries: {range: SourceRange; opaque?: Block}[] = [
      ...ranges.map(range => ({range})),
      ...opaqueBlocks.map(block => ({range: {start: block.from, end: block.to}, opaque: block})),
    ].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
    const blocks: Block[] = [];
    let assigned = 0;
    for (const entry of entries) {
      const range = entry.range;
      if (entry.opaque) {
        const block = entry.opaque;
        if (assigned < fragments.length && fragments[assigned].range.start < range.end) return null;
        // Prefix for the isolated compile: every other context unit. The raw
        // body cannot declare bindings, but its attributes may read them, and
        // omitting its own text avoids duplicate declarations.
        const rest = masking.filter(item => item !== block);
        const prefixText = rest.length ? rest.map(item => item.text).join(separator) + separator : '';
        let prefixCost = 0;
        if (prefixText) {
          const prefixResult = this.parseSession.parse(prefixText, options);
          if (prefixResult.diagnostics.length) return null;
          prefixCost = prefixResult.syntaxNodes ?? 0;
        }
        block.prefix = prefixText;
        block.prefixCost = prefixCost;
        blocks.push(block);
        continue;
      }
      const members: LocalNode[] = [];
      while (assigned < fragments.length && fragments[assigned].range.start < range.end) {
        const member = fragments[assigned];
        if (member.range.start < range.start || member.range.end > range.end) return null;
        members.push(member); assigned++;
      }
      if (!members.length) return null;
      const nodes = members.flatMap(member => rendered.has(member.id) ? [rendered.get(member.id)!] : []);
      const cost = allNodes(nodes).length;
      const text = source.slice(range.start, range.end);
      blocks.push({from: range.start, to: range.end, origin: range.start, text, nodes,
        dependencies: dependencies(nodes, doc), cost, rowPlans: rowPlansFor(tracked, text)});
    }
    if (assigned !== fragments.length) return null;
    const prefix = masking.length ? masking.map(b => b.text).join(separator) + separator : '';
    // All semantic context already belongs to a successful complete result.
    // Recount the separator-prefixed syntax without revalidating every binding.
    const prefixResult = prefix ? this.parseSession.parse(prefix, options) : null;
    if (prefixResult?.diagnostics.length) return null;
    const contextCost = (tracked.parsed.syntaxNodes ?? 0) - blocks.reduce((sum,b) => sum + b.cost, 0);
    if (contextCost < 0) return null;
    doc.nodes = []; doc.source = ''; delete doc.dependencies;
    // Stored context excludes opaque blocks: they are already in `blocks`,
    // and update() reconstructs the masking view from both lists.
    const context = masking.filter(block => !block.opaque);
    return {source, key, tree, metadata: doc, blocks, context, contextCost, prefix, prefixCost: prefixResult?.syntaxNodes ?? 0};
  }
  private update(old: Snapshot, source: string, options: LocalCompileOptions | undefined, budget: number,
    knownRaw: ReadonlySet<string>, collectPerformance: boolean): Snapshot | null {
    if (source.includes('[^') || source.includes('\ufeff') || hasLoneCarriageReturn(source)) return null;
    const rawNames = knownRaw;
    const edit = change(old.source, source);
    // Local code shielding can extend beyond a Markdown leaf block. Changing
    // its delimiters invalidates that lexical context, even if Lezer kept a
    // neighboring block. Ordinary edits inside unchanged code remain local.
    if (/[`\\~]/.test(old.source.slice(edit.from,edit.oldTo) + source.slice(edit.from,edit.newTo))) return null;
    const context: Block[] = [];
    for (const b of old.context) {
      if (edit.from <= b.to && edit.oldTo >= b.from) return null;
      const delta = b.from >= edit.oldTo ? edit.delta : 0;
      const next = {...b, from: b.from + delta, to: b.to + delta};
      if (source.slice(next.from, next.to) !== b.text) return null;
      context.push(next);
    }
    // A raw-body container is one opaque unit. An edit strictly inside it
    // recompiles that block; anything touching its tags keeps the full path.
    const opaque: Block[] = [];
    for (const b of old.blocks) {
      if (!b.opaque) continue;
      if (edit.from > b.from && edit.oldTo < b.to) {
        const to = b.to + edit.delta;
        opaque.push({...b, to, text: source.slice(b.from, to)});
        continue;
      }
      if (edit.from <= b.to && edit.oldTo >= b.from) return null;
      const delta = b.from >= edit.oldTo ? edit.delta : 0;
      const next: Block = {...b, from: b.from + delta, to: b.to + delta};
      if (source.slice(next.from, next.to) !== b.text) return null;
      opaque.push(next);
    }
    /** Every non-fragment unit: masking, boundary protection and blank-line runs. */
    const masking = [...context, ...opaque].sort((a,b) => a.from - b.from);
    if (contextRunsOn(source, masking)) return null;
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(old.tree), [{fromA: edit.from, toA: edit.oldTo, fromB: edit.from, toB: edit.newTo}], 0);
    const masked = mask(source, masking);
    if (masked.includes('<')) return null;
    const tree = markdown.parse(masked, fragments);
    const ranges = boundaries(tree, masking, masked);
    if (!ranges) return null;
    for (const block of opaque) {
      if (ranges.some(range => range.start < block.to && range.end > block.from)) return null;
    }
    /** Markdown boundaries plus the opaque raw ranges, in source order. */
    const entries: {range: SourceRange; opaque?: Block}[] = [
      ...ranges.map(range => ({range})),
      ...opaque.map(block => ({range: {start: block.from, end: block.to}, opaque: block})),
    ].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
    const index = new Map(old.blocks.map(b => [`${b.from}:${b.to}`, b]));
    const blocks: Block[] = [];
    /** IDs already claimed by this revision; prevents a split block from duplicating them. */
    const claimed = new Set<string>();
    /** Blocks compiled in isolation during this revision. */
    const recompiled = new Set<Block>();
    let reused = 0, compiled = 0, characters = 0, cost = old.contextCost;
    let reuseMs = 0, rebuildMs = 0, parseMs = 0, semanticMs = 0;
    for (const entry of entries) {
      const range = entry.range;
      const delta = range.start >= edit.newTo ? edit.delta : 0;
      const reusable = range.end <= edit.from || range.start >= edit.newTo;
      const cached = reusable ? index.get(`${range.start - delta}:${range.end - delta}`) : undefined;
      const text = source.slice(range.start, range.end);
      if (cached && cached.text === text) {
        const reuseStarted = collectPerformance ? performance.now() : 0;
        blocks.push({...cached, from: range.start, to: range.end}); reused++; cost += cached.cost;
        for (const node of allNodes(cached.nodes)) claimed.add(node.id);
        if (collectPerformance) reuseMs += performance.now() - reuseStarted;
      } else if (entry.opaque) {
        // Recompile the raw container alone. Its prefix holds every other
        // context unit, so attribute expressions keep their declarations
        // while the block's own text is not compiled twice.
        const prefix = entry.opaque.prefix ?? '';
        const from = prefix.length;
        const tracked = compileLocalTracked(prefix + text, options, this.services, undefined, collectPerformance);
        if (collectPerformance) {
          rebuildMs += tracked.timings.totalMs;
          parseMs += tracked.timings.parseMs ?? 0;
          semanticMs += tracked.timings.semanticMs ?? 0;
        }
        characters += from + text.length; compiled++;
        if (!tracked.result.ok || tracked.result.diagnostics.length || !tracked.parsed || hasRecoveries(tracked.result)) return null;
        const parsed = tracked.parsed.nodes.filter(n => n.range.start >= from);
        if (parsed.length !== 1 || contextKind(parsed[0], rawNames) !== 'raw') return null;
        const fresh = tracked.result.document.nodes.filter(n => n.range.start >= from);
        if (fresh.length !== 1) return null;
        const rename = new Map(allNodes(fresh).map(n => [n.id, `incremental-${++this.serial}-${n.id}`]));
        const nodes = copyNodes(fresh, 0, rename);
        const count = (tracked.parsed.syntaxNodes ?? 0) - (entry.opaque.prefixCost ?? 0);
        if (count < allNodes(nodes).length) return null;
        const freshDeps = dependencies(fresh, tracked.result.document, rename);
        const deps: Dependencies = Object.create(null);
        for (const node of allNodes(nodes)) deps[node.id] = freshDeps[node.id] ?? null;
        const block: Block = {from: range.start, to: range.end, origin: from, text, nodes,
          dependencies: deps, cost: count, opaque: true,
          prefix, prefixCost: entry.opaque.prefixCost ?? 0};
        blocks.push(block); recompiled.add(block);
        cost += count;
      } else {
        // The unchanged declaration prefix supplies the same binding and type
        // environment. Only this new block is semantically compiled.
        const from = old.prefix.length;
        // Locate the previous block that occupied this new range. Its per-row
        // inline plans are checked before the bounded LRU (which would thrash
        // on a 1000-row sequential scan) and its row subtrees are candidates
        // for node-level substitution below.
        const previous = old.blocks.find(b => {
          const mappedStart = b.from >= edit.oldTo ? b.from + edit.delta : b.from;
          const mappedEnd = b.to >= edit.oldTo ? b.to + edit.delta : b.to;
          return mappedStart < range.end && mappedEnd > range.start;
        });
        const services = previous?.rowPlans ? {...this.services, rowPlans: previous.rowPlans} : this.services;
        const tracked = compileLocalTracked(old.prefix + text, options, services, undefined, collectPerformance);
        if (collectPerformance) {
          rebuildMs += tracked.timings.totalMs;
          parseMs += tracked.timings.parseMs ?? 0;
          semanticMs += tracked.timings.semanticMs ?? 0;
        }
        characters += from + text.length; compiled++;
        if (!tracked.result.ok || tracked.result.diagnostics.length || !tracked.parsed || hasRecoveries(tracked.result)) return null;
        const parsed = tracked.parsed.nodes.filter(n => n.range.start >= from);
        if (!parsed.length || parsed.some(n => contextKind(n) !== 'fragment')) return null;
        const fresh = tracked.result.document.nodes.filter(n => n.range.start >= from);
        const rename = new Map(allNodes(fresh).map(n => [n.id, `incremental-${++this.serial}-${n.id}`]));
        const renamed = copyNodes(fresh, 0, rename);
        let outcome = previous
          ? reuseFlatRows({text: previous.text, origin: previous.origin, nodes: previous.nodes}, {text, origin: from, nodes: renamed})
          : undefined;
        if (outcome) {
          // A block split can map two new blocks onto the same old block. If
          // any kept id was already published this revision, fall back to the
          // fresh nodes rather than duplicate node identity.
          for (const id of outcome.reusedIds) if (claimed.has(id)) { outcome = undefined; break; }
        }
        const nodes = outcome?.nodes ?? renamed;
        const count = (tracked.parsed.syntaxNodes ?? 0) - old.prefixCost;
        if (count < allNodes(nodes).length) return null;
        // Fresh dependencies are keyed by the renamed ids; kept row ids have no
        // entry here and are filled from the previous revision below.
        const freshDeps = dependencies(fresh, tracked.result.document, rename);
        const deps: Dependencies = Object.create(null);
        for (const node of allNodes(nodes)) deps[node.id] = freshDeps[node.id] ?? null;
        if (outcome && previous) {
          // Kept row IDs see only unchanged descendants, so their previous
          // lists are exact. The kept container ID, however, must use the
          // fresh aggregate: a changed row may read different bindings.
          const previousParentId = previous.nodes[0]?.id;
          const freshParentId = renamed[0]?.id;
          for (const id of outcome.reusedIds) {
            deps[id] = id === previousParentId && freshParentId !== undefined
              ? freshDeps[freshParentId] ?? null
              : previous.dependencies[id] ?? null;
            claimed.add(id);
          }
          for (let reusedIndex = 0; reusedIndex < outcome.reused; reusedIndex++) this.parseSession.noteRowReuse(outcome.kind);
        }
        const block: Block = {from: range.start, to: range.end, origin: from, text, nodes,
          dependencies: deps, cost: count, rowPlans: rowPlansFor(tracked, text)};
        blocks.push(block); recompiled.add(block);
        cost += count;
      }
      if (cost > budget) return null;
    }
    if (cost > budget) return null;
    if (!this.sameBoundaries(source, blocks, context, recompiled, edit, options)) return null;
    this.lastStats = {mode: 'incremental', totalBlocks: blocks.length, compiledBlocks: compiled, reusedBlocks: reused, compiledCharacters: characters,
      ...(collectPerformance ? { stages: { ...(reused ? { reuseMs } : {}), ...(compiled ? { rebuildMs, parseMs, semanticMs } : {}) } } : {})};
    return {...old, source, tree, context, blocks};
  }
  /**
   * Lezer only proposes block boundaries. The local parser can keep one node
   * across them (a lazy continuation line after an empty nested list item) or
   * read a block differently after its predecessor (`+` after indented code is
   * a paragraph, not a list). Every boundary next to a recompiled block or in
   * the edited gap is therefore re-parsed by the local parser in one window:
   * from the last top-level node before the boundary to the first one after
   * it. The window must reproduce exactly the nodes of the assembled blocks.
   * Matching edge nodes leave the parser in the same state as the complete
   * document, so untouched boundaries keep the result of earlier revisions.
   */
  private sameBoundaries(source: string, blocks: Block[], context: Block[], recompiled: ReadonlySet<Block>,
    edit: ReturnType<typeof change>, options: LocalCompileOptions | undefined): boolean {
    const contextBlocks = new Set(context);
    const all = [...blocks, ...context].sort((a,b) => a.from - b.from);
    const dirty = (k: number) => recompiled.has(all[k]) || recompiled.has(all[k+1])
      || (edit.from <= all[k+1].from && edit.newTo >= all[k].to);
    for (let k = 0; k + 1 < all.length; k++) {
      if (!dirty(k)) continue;
      let m = k;
      while (m + 2 < all.length && dirty(m + 1)) m++;
      /** Expected top-level nodes in source coordinates; a context block only fixes its range. */
      const expected: ({node: LocalNode; delta: number} | Block)[] = [];
      for (let index = k; index <= m + 1; index++) {
        const block = all[index];
        if (contextBlocks.has(block)) { expected.push(block); continue; }
        const delta = block.from - block.origin;
        const nodes = index === k ? block.nodes.slice(-1) : index === m + 1 ? block.nodes.slice(0, 1) : block.nodes;
        if (!nodes.length) return false;
        for (const node of nodes) expected.push({node, delta});
      }
      const head = expected[0], tail = expected[expected.length - 1];
      const start = 'node' in head ? Math.max(all[k].from, lineStart(source, head.node.range.start + head.delta)) : head.from;
      const end = 'node' in tail ? tail.node.range.end + tail.delta : tail.to;
      // Reuse the neighbours' per-row inline plans so a long list or table
      // next to the edit is not rescanned row by row.
      const plans = all.slice(k, m + 2).flatMap(block => block.rowPlans ? [block.rowPlans] : []);
      const rowPlans: InlinePlanLookup | undefined = plans.length < 2 ? plans[0] : {
        has: (text: string) => plans.some(map => map.has(text)),
        get: (text: string) => plans.find(map => map.has(text))?.get(text),
      } as InlinePlanLookup;
      const parsed = this.parseSession.parse(source.slice(start, end), options, undefined, rowPlans);
      if (parsed.diagnostics.length || parsed.recoveries?.length || parsed.nodes.length !== expected.length) return false;
      for (let index = 0; index < expected.length; index++) {
        const want = expected[index], got = parsed.nodes[index];
        if ('node' in want) {
          if (!sameNode(got, start, want.node, want.delta)) return false;
        } else if (got.range.start + start !== want.from || got.range.end + start !== want.to) return false;
      }
      k = m;
    }
    return true;
  }
  private publish(snapshot: Snapshot): LocalCompileResult {
    const doc = plainCompiledData(snapshot.metadata);
    doc.source = snapshot.source;
    const all = [...snapshot.blocks, ...snapshot.context].sort((a,b) => a.from - b.from);
    const oldById=new Map(this.shared?.ok?this.shared.document.nodes.map(n=>[n.id,n]):[]);
    doc.nodes = all.flatMap(b => {
      const delta=b.from-b.origin;
      if(b.publication?.delta===delta)return b.publication.nodes;
      const before=b.publication?.nodes??b.nodes.map(n=>oldById.get(n.id)).filter((n):n is LocalNode=>!!n);
      const nodes=shareCompiledData(before,copyNodes(b.nodes,delta)).value;
      b.publication={delta,nodes};
      return nodes;
    });
    const deps: Dependencies = {};
    for (const block of all) for (const [id, values] of Object.entries(block.dependencies)) {
      Object.defineProperty(deps, id, {value: values === null ? null : Object.freeze([...values]), enumerable: true});
    }
    doc.dependencies = Object.freeze(deps);
    const shiftUnits = [...snapshot.context, ...snapshot.blocks.filter(b => b.opaque)];
    const shift = (range: SourceRange): SourceRange => {
      const block = shiftUnits.find(b => range.start >= b.origin && range.end <= b.origin + b.text.length);
      const delta = block ? block.from - block.origin : 0;
      return {start: range.start + delta, end: range.end + delta};
    };
    if (doc.versionDeclaration) doc.versionDeclaration.range = shift(doc.versionDeclaration.range);
    if (doc.themeRange) doc.themeRange = shift(doc.themeRange);
    for (const value of Object.values(doc.computations ?? {})) value.range = shift(value.range);
    for (const value of doc.validations ?? []) value.range = shift(value.range);
    for (const value of Object.values(doc.externals ?? {})) value.range = shift(value.range);
    for (const constraints of Object.values(doc.dynamicConstraints ?? {})) {
      for (const constraint of Object.values(constraints)) {
        constraint.offset = shift({ start: constraint.offset, end: constraint.offset }).start;
      }
    }
    doc.requiresRuntime = localDocumentRequiresRuntime(doc);
    doc.usedComponents = collectUsedComponents(doc.nodes);
    return {ok: true, document: doc, diagnostics: []};
  }
  get hasPendingPreparation():boolean{return !this.disposed&&this.deferred!==null;}
  prepare():boolean {
    if(this.disposed||!this.deferred)return false;
    const pending=this.deferred,epoch=this.epoch,builds=this.cacheBuilds;
    try {
      const snapshot=this.seed(pending.source,pending.key,pending.tracked,pending.options);
      if(this.disposed||epoch!==this.epoch||this.deferred!==pending)return false;
      this.snapshot=snapshot;this.deferred=null;return snapshot!==null;
    } catch {return false;} finally {this.cacheBuilds=builds;}
  }
  async prepareAsync(signal?:{readonly aborted:boolean},yieldTask:()=>Promise<void>=()=>new Promise(resolve=>setTimeout(resolve,0))):Promise<boolean> {
    if(this.disposed||!this.deferred||signal?.aborted)return false;
    const pending=this.deferred,epoch=this.epoch;
    const valid=()=>!this.disposed&&!signal?.aborted&&this.epoch===epoch&&this.deferred===pending;
    await yieldTask();if(!valid())return false;
    if(!pending.tracked.result.ok||!pending.tracked.parsed)return false;
    const context:Block[]=[];
    const roots=pending.tracked.parsed.nodes;
    const rawNames=this.rawNamesFor(pending.options);
    for(let index=0;index<roots.length;index++) {
      const node=roots[index],kind=contextKind(node,rawNames);
      if(kind==='unsupported')return false;
      if(kind==='context'||kind==='raw')context.push({from:node.range.start,to:node.range.end,origin:node.range.start,text:pending.source.slice(node.range.start,node.range.end),nodes:[],dependencies:{},cost:0});
      if(index%64===63){await yieldTask();if(!valid())return false;}
    }
    for(const range of [pending.tracked.parsed.versionDeclaration?.range,pending.tracked.parsed.themeRange]) {
      if(range&&!context.some(b=>range.start>=b.from&&range.end<=b.to))context.push({from:range.start,to:range.end,origin:range.start,text:pending.source.slice(range.start,range.end),nodes:[],dependencies:{},cost:0});
    }
    context.sort((a,b)=>a.from-b.from);
    const masked=mask(pending.source,context);
    if(masked.includes('<'))return false;
    // Drive Lezer's partial parser in separate tasks. Message events can revoke
    // this revision while the advisory index is being prepared.
    const parse=markdown.startParse(masked);
    let tree:Tree|null=null;
    while(!tree){tree=parse.advance();if(!tree){await yieldTask();if(!valid())return false;}}
    await yieldTask();if(!valid())return false;
    const builds=this.cacheBuilds;
    try {
      const snapshot=this.seed(pending.source,pending.key,pending.tracked,pending.options,tree,rawNames);
      if(!valid())return false;
      this.snapshot=snapshot;this.deferred=null;return snapshot!==null;
    } catch {return false;} finally {this.cacheBuilds=builds;}
  }
  /** Validated raw-body container names for one compile-option identity. */
  private rawNames(key: string, options: LocalCompileOptions | undefined): ReadonlySet<string> {
    if (this.rawNamesCache?.key !== key) this.rawNamesCache = {key, names: rawComponentNames(options)};
    return this.rawNamesCache.names;
  }
  private rawNamesFor(options: LocalCompileOptions | undefined): ReadonlySet<string> {
    return this.rawNames(localCompileOptionsKey(options), options);
  }
  clear(): void { this.epoch++;this.snapshot = null; this.deferred = null; this.serial = 0; this.cacheBuilds = 0;this.shared=null;this.sharedKey=undefined;this.sharedMode=undefined;this.streamingCache=null;this.rawNamesCache=null;this.parseSession.clear();this.semantic.clear(); }
  dispose(): void { this.clear(); this.parseSession.dispose();this.disposed = true; }
}

export function createLocalCompileSession(): LocalCompileSession { return new LocalCompileSession(); }
