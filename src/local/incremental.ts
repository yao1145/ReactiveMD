import { TreeFragment, type Tree } from '@lezer/common';
import { parser, GFM } from '@lezer/markdown';
import { compileLocalTracked,type LocalCompilerServices } from './compiler';
import {LocalSemanticCache,type SemanticCacheStats} from './compiler-cache';
import {LocalParseSession} from './parse-session';
import {shareCompiledData,countSharedNodes} from './shared-data';
import {reuseFlatRows} from './row-reuse';
import type {InlinePlan} from './fast-markdown';
import { plainCompiledData } from './compiled-data';
import { localCompileOptionsKey, readLocalCompileOptions } from './options';
import { readLocalConfig } from '../sdk/config';
import { getLocalComponent } from './schema';
import { MAX_LOCAL_DOCUMENT_LENGTH } from './limits';
import type { LocalCompileOptions, LocalCompileResult, LocalDocument, LocalNode, SourceRange } from './types';

const markdown = parser.configure(GFM);
const separator = '\n\n<!-- incremental-boundary -->\n\n';
type Dependencies = Record<string, readonly string[] | null>;
interface Block {
  from: number; to: number; origin: number; text: string;
  nodes: LocalNode[]; dependencies: Dependencies; cost: number;
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
    ...(node.attrs ? {attrs: {...node.attrs}} : {}), ...(node.align ? {align: [...node.align]} : {}),
    ...(node.children ? {children: copyNodes(node.children, delta, rename)} : {}),
  }));
}
function dependencies(nodes: LocalNode[], document: LocalDocument, rename?: Map<string, string>): Dependencies {
  const result: Dependencies = Object.create(null);
  for (const node of allNodes(nodes)) result[rename?.get(node.id) ?? node.id] = document.dependencies?.[node.id] ?? null;
  return result;
}
function contextKind(node: LocalNode): 'context' | 'fragment' | 'unsupported' {
  let context = false;
  for (const child of allNodes([node])) {
    if (['definition', 'footnoteDefinition', 'footnoteReference', 'linkReference', 'imageReference'].includes(child.type)) return 'unsupported';
    if (child.type === 'hostComponent' || child.type === 'htmlDocument' || child.type === 'fallback') return 'unsupported';
    if (child.type === 'component') {
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
  mode: 'full' | 'incremental' | 'cached';
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
  private disposed = false;
  private snapshot: Snapshot | null = null;
  private deferred: {source: string; key: string; tracked: Tracked; options?:LocalCompileOptions} | null = null;
  private readonly parseSession=new LocalParseSession();
  private readonly semantic=new LocalSemanticCache();
  private readonly services:LocalCompilerServices={parser:this.parseSession,semantic:this.semantic};
  private shared:LocalCompileResult|null=null;
  private sharedKey:string|undefined;
  private epoch=0;
  private cacheBuilds = 0;
  private serial = 0;
  private lastStats: LocalIncrementalStats = { mode: 'full', totalBlocks: 0, compiledBlocks: 0, reusedBlocks: 0, compiledCharacters: 0 };
  get stats(): Readonly<LocalIncrementalStats> { return { ...this.lastStats, cacheBuilds: this.cacheBuilds }; }
  compile(source: string, options?: LocalCompileOptions): LocalCompileResult {
    const result=this.compileShared(source,options),start=performance.now();
    const published=plainCompiledData(result);
    this.lastStats={...this.lastStats,stages:{...this.lastStats.stages,publicSnapshotMs:performance.now()-start}};
    return published;
  }
  /** Compiler-owned persistent result for the Worker and preview. Treat as read-only. */
  compileShared(source:string,options?:LocalCompileOptions):LocalCompileResult {
    if(this.disposed)throw new Error('Local compile session is disposed');
    this.epoch++;
    const key=localCompileOptionsKey(options);
    if(key!==this.sharedKey){this.shared=null;this.sharedKey=key;}
    const result=this.compileCore(source,options),start=performance.now(),previous=this.shared;
    const persistent=shareCompiledData(previous??undefined,result).value;
    this.shared=persistent;
    this.lastStats={...this.lastStats,sharedNodes:countSharedNodes(previous,persistent),parse:this.parseSession.stats,
      semantic:this.lastStats.semantic??this.semantic.stats,
      stages:{...this.lastStats.stages,sharedPublicationMs:performance.now()-start}};
    return persistent;
  }
  private compileCore(source: string, options?: LocalCompileOptions): LocalCompileResult {
    if (this.disposed) throw new Error('Local compile session is disposed');
    this.cacheBuilds = 0;
    const key = localCompileOptionsKey(options), check = readLocalCompileOptions(options);
    let reason = 'initial';
    let defer = false;
    const pending = this.deferred;
    this.deferred = null;
    if (pending && pending.key === key && check.ok && !check.htmlActive && typeof source === 'string' && source.length <= MAX_LOCAL_DOCUMENT_LENGTH) {
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
        && !parsed.nodes.some(n => touches(n.range) && contextKind(n) !== 'fragment')
        && ![parsed.versionDeclaration?.range, parsed.themeRange].some(r => r && touches(r))) {
        try { this.snapshot = this.seed(pending.source, key, pending.tracked, options); }
        catch { this.snapshot = null; }
      }
    } else if (pending) reason = 'options-or-limits';
    const previous = this.snapshot;
    if (previous && previous.key === key && check.ok && !check.htmlActive && typeof source === 'string' && source.length <= MAX_LOCAL_DOCUMENT_LENGTH) {
      if (source === previous.source) {
        this.lastStats = {mode: 'cached', totalBlocks: previous.blocks.length, compiledBlocks: 0, reusedBlocks: previous.blocks.length, compiledCharacters: 0};
        return this.publish(previous);
      }
      let updated: Snapshot | null = null;
      try { updated = this.update(previous, source, options, check.maxSyntaxNodes); }
      catch { /* Incremental machinery must preserve the full compiler's error boundary. */ }
      if (updated) { this.snapshot = updated; return this.publish(updated); }
      reason = 'scope-or-boundary';
      defer = true;
    } else if (previous) reason = 'options-or-limits';
    this.snapshot = null;
    const tracked = compileLocalTracked(source, options,this.services);
    this.lastStats = {mode: 'full', totalBlocks: tracked.parsed?.nodes.length ?? 0, compiledBlocks: tracked.parsed?.nodes.length ?? 0, reusedBlocks: 0, compiledCharacters: typeof source === 'string' ? source.length : 0, fallbackReason: reason,semantic:tracked.semantic,stages:tracked.timings};
    if (tracked.result.ok && tracked.result.diagnostics.length === 0 && check.ok && !check.htmlActive && key !== 'invalid') {
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
        try { this.snapshot = this.seed(source, key, tracked, options); }
        catch { this.snapshot = null; }
      }
      if (this.snapshot) this.lastStats.totalBlocks = this.lastStats.compiledBlocks = this.snapshot.blocks.length;
    }
    return this.snapshot?this.publish(this.snapshot):tracked.result;
  }
  private seed(source: string, key: string, tracked: Tracked, options?: LocalCompileOptions,preparedTree?:Tree): Snapshot | null {
    this.cacheBuilds++;
    if (!tracked.result.ok || !tracked.parsed || source.includes('[^') || source.includes('\ufeff')) return null;
    const roots = tracked.parsed.nodes, kinds = roots.map(contextKind);
    // A plain single-block document normally has nothing to reuse. One huge
    // flat list or table is the exception: row-level reuse makes the
    // incremental path cheaper than a full recompile, so let it seed.
    const rowBlock = roots.length === 1 && kinds[0] === 'fragment'
      && (roots[0].type === 'list' || roots[0].type === 'table');
    if (kinds.includes('unsupported')
      || (!rowBlock && kinds.filter(kind => kind === 'fragment').length < 2)) return null;
    const doc:LocalDocument = {...tracked.result.document,nodes:[],source:''};
    const rendered = new Map(tracked.result.document.nodes.map(node => [node.id, node]));
    const context: Block[] = [];
    const fragments: LocalNode[] = [];
    for (let index = 0; index < roots.length; index++) {
      const node = roots[index], kind = kinds[index];
      if (kind === 'fragment') fragments.push(node);
      else {
        const nodes = rendered.has(node.id) ? [rendered.get(node.id)!] : [];
        context.push({from: node.range.start, to: node.range.end, origin: node.range.start,
          text: source.slice(node.range.start, node.range.end), nodes, dependencies: dependencies(nodes, doc), cost: 0});
      }
    }
    for (const range of [tracked.parsed.versionDeclaration?.range, tracked.parsed.themeRange]) {
      if (range && !context.some(b => range.start >= b.from && range.end <= b.to)) {
        context.push({from: range.start, to: range.end, origin: range.start, text: source.slice(range.start,range.end), nodes: [], dependencies: {}, cost: 0});
      }
    }
    context.sort((a,b) => a.from-b.from);
    const masked = mask(source, context);
    // The local HTML scanner and Markdown's HTML lexer have different block
    // boundaries. Keep their whole-document shielding on the full path.
    if (masked.includes('<')) return null;
    const tree = preparedTree??markdown.parse(masked);
    const ranges = boundaries(tree, context, masked);
    if (!ranges) return null;
    const blocks: Block[] = [];
    let assigned = 0;
    for (const range of ranges) {
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
    const prefix = context.length ? context.map(b => b.text).join(separator) + separator : '';
    // All semantic context already belongs to a successful complete result.
    // Recount the separator-prefixed syntax without revalidating every binding.
    const prefixResult = prefix ? this.parseSession.parse(prefix, options) : null;
    if (prefixResult?.diagnostics.length) return null;
    const contextCost = (tracked.parsed.syntaxNodes ?? 0) - blocks.reduce((sum,b) => sum + b.cost, 0);
    if (contextCost < 0) return null;
    doc.nodes = []; doc.source = ''; delete doc.dependencies;
    return {source, key, tree, metadata: doc, blocks, context, contextCost, prefix, prefixCost: prefixResult?.syntaxNodes ?? 0};
  }
  private update(old: Snapshot, source: string, options: LocalCompileOptions | undefined, budget: number): Snapshot | null {
    if (source.includes('[^') || source.includes('\ufeff')) return null;
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
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(old.tree), [{fromA: edit.from, toA: edit.oldTo, fromB: edit.from, toB: edit.newTo}], 0);
    const masked = mask(source, context);
    if (masked.includes('<')) return null;
    const tree = markdown.parse(masked, fragments);
    const ranges = boundaries(tree, context, masked);
    if (!ranges) return null;
    const index = new Map(old.blocks.map(b => [`${b.from}:${b.to}`, b]));
    const blocks: Block[] = [];
    /** IDs already claimed by this revision; prevents a split block from duplicating them. */
    const claimed = new Set<string>();
    let reused = 0, compiled = 0, characters = 0, cost = old.contextCost;
    for (const range of ranges) {
      const delta = range.start >= edit.newTo ? edit.delta : 0;
      const reusable = range.end <= edit.from || range.start >= edit.newTo;
      const cached = reusable ? index.get(`${range.start - delta}:${range.end - delta}`) : undefined;
      const text = source.slice(range.start, range.end);
      if (cached && cached.text === text) {
        blocks.push({...cached, from: range.start, to: range.end}); reused++; cost += cached.cost;
        for (const node of allNodes(cached.nodes)) claimed.add(node.id);
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
        const tracked = compileLocalTracked(old.prefix + text, options, services);
        characters += from + text.length; compiled++;
        if (!tracked.result.ok || tracked.result.diagnostics.length || !tracked.parsed) return null;
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
        blocks.push({from: range.start, to: range.end, origin: from, text, nodes,
          dependencies: deps, cost: count, rowPlans: rowPlansFor(tracked, text)});
        cost += count;
      }
      if (cost > budget) return null;
    }
    if (cost > budget) return null;
    this.lastStats = {mode: 'incremental', totalBlocks: blocks.length, compiledBlocks: compiled, reusedBlocks: reused, compiledCharacters: characters};
    return {...old, source, tree, context, blocks};
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
    const shift = (range: SourceRange): SourceRange => {
      const block = snapshot.context.find(b => range.start >= b.origin && range.end <= b.origin + b.text.length);
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
    for(let index=0;index<roots.length;index++) {
      const node=roots[index],kind=contextKind(node);
      if(kind==='unsupported')return false;
      if(kind==='context')context.push({from:node.range.start,to:node.range.end,origin:node.range.start,text:pending.source.slice(node.range.start,node.range.end),nodes:[],dependencies:{},cost:0});
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
      const snapshot=this.seed(pending.source,pending.key,pending.tracked,pending.options,tree);
      if(!valid())return false;
      this.snapshot=snapshot;this.deferred=null;return snapshot!==null;
    } catch {return false;} finally {this.cacheBuilds=builds;}
  }
  clear(): void { this.epoch++;this.snapshot = null; this.deferred = null; this.serial = 0; this.cacheBuilds = 0;this.shared=null;this.sharedKey=undefined;this.parseSession.clear();this.semantic.clear(); }
  dispose(): void { this.clear(); this.parseSession.dispose();this.disposed = true; }
}

export function createLocalCompileSession(): LocalCompileSession { return new LocalCompileSession(); }
