import { TreeFragment, type Tree } from '@lezer/common';
import { parser, GFM } from '@lezer/markdown';
import { compileLocalTracked } from './compiler';
import { plainCompiledData } from './compiled-data';
import { localCompileOptionsKey, readLocalCompileOptions } from './options';
import { getLocalComponent } from './schema';
import { MAX_LOCAL_DOCUMENT_LENGTH } from './limits';
import type { LocalCompileOptions, LocalCompileResult, LocalDocument, LocalNode, SourceRange } from './types';

const markdown = parser.configure(GFM);
const separator = '\n\n<!-- incremental-boundary -->\n\n';
type Dependencies = Record<string, readonly string[] | null>;
interface Block {
  from: number; to: number; origin: number; text: string;
  nodes: LocalNode[]; dependencies: Dependencies; cost: number;
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

export interface LocalIncrementalStats {
  mode: 'full' | 'incremental' | 'cached';
  totalBlocks: number;
  compiledBlocks: number;
  reusedBlocks: number;
  compiledCharacters: number;
  fallbackReason?: string;
}

export class LocalCompileSession {
  private disposed = false;
  private snapshot: Snapshot | null = null;
  private serial = 0;
  private lastStats: LocalIncrementalStats = { mode: 'full', totalBlocks: 0, compiledBlocks: 0, reusedBlocks: 0, compiledCharacters: 0 };
  get stats(): Readonly<LocalIncrementalStats> { return { ...this.lastStats }; }
  compile(source: string, options?: LocalCompileOptions): LocalCompileResult {
    if (this.disposed) throw new Error('Local compile session is disposed');
    const key = localCompileOptionsKey(options), check = readLocalCompileOptions(options);
    let reason = 'initial';
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
    } else if (previous) reason = 'options-or-limits';
    this.snapshot = null;
    const tracked = compileLocalTracked(source, options);
    this.lastStats = {mode: 'full', totalBlocks: tracked.parsed?.nodes.length ?? 0, compiledBlocks: tracked.parsed?.nodes.length ?? 0, reusedBlocks: 0, compiledCharacters: typeof source === 'string' ? source.length : 0, fallbackReason: reason};
    if (tracked.result.ok && tracked.result.diagnostics.length === 0 && check.ok && !check.htmlActive && key !== 'invalid') {
      try { this.snapshot = this.seed(source, key, tracked, options); }
      catch { this.snapshot = null; }
      if (this.snapshot) this.lastStats.totalBlocks = this.lastStats.compiledBlocks = this.snapshot.blocks.length;
    }
    return tracked.result;
  }
  private seed(source: string, key: string, tracked: Tracked, options?: LocalCompileOptions): Snapshot | null {
    if (!tracked.result.ok || !tracked.parsed || source.includes('[^') || source.includes('\ufeff')) return null;
    const roots = tracked.parsed.nodes, kinds = roots.map(contextKind);
    if (kinds.includes('unsupported') || kinds.filter(kind => kind === 'fragment').length < 2) return null;
    const doc = plainCompiledData(tracked.result.document);
    const rendered = new Map(doc.nodes.map(node => [node.id, node]));
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
    const tree = markdown.parse(masked);
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
      blocks.push({from: range.start, to: range.end, origin: range.start, text: source.slice(range.start, range.end), nodes, dependencies: dependencies(nodes, doc), cost});
    }
    if (assigned !== fragments.length) return null;
    const prefix = context.length ? context.map(b => b.text).join(separator) + separator : '';
    const prefixResult = prefix ? compileLocalTracked(prefix, options) : null;
    if (prefixResult && (!prefixResult.result.ok || prefixResult.result.diagnostics.length)) return null;
    const contextCost = (tracked.parsed.syntaxNodes ?? 0) - blocks.reduce((sum,b) => sum + b.cost, 0);
    if (contextCost < 0) return null;
    doc.nodes = []; doc.source = ''; delete doc.dependencies;
    return {source, key, tree, metadata: doc, blocks, context, contextCost, prefix, prefixCost: prefixResult?.parsed?.syntaxNodes ?? 0};
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
    let reused = 0, compiled = 0, characters = 0, cost = old.contextCost;
    for (const range of ranges) {
      const delta = range.start >= edit.newTo ? edit.delta : 0;
      const reusable = range.end <= edit.from || range.start >= edit.newTo;
      const cached = reusable ? index.get(`${range.start - delta}:${range.end - delta}`) : undefined;
      const text = source.slice(range.start, range.end);
      if (cached && cached.text === text) {
        blocks.push({...cached, from: range.start, to: range.end}); reused++; cost += cached.cost;
      } else {
        // The unchanged declaration prefix supplies the same binding and type
        // environment. Only this new block is semantically compiled.
        const from = old.prefix.length;
        const tracked = compileLocalTracked(old.prefix + text, options);
        characters += from + text.length; compiled++;
        if (!tracked.result.ok || tracked.result.diagnostics.length || !tracked.parsed) return null;
        const parsed = tracked.parsed.nodes.filter(n => n.range.start >= from);
        if (!parsed.length || parsed.some(n => contextKind(n) !== 'fragment')) return null;
        const nodes = tracked.result.document.nodes.filter(n => n.range.start >= from);
        const rename = new Map(allNodes(nodes).map(n => [n.id, `incremental-${++this.serial}-${n.id}`]));
        const count = (tracked.parsed.syntaxNodes ?? 0) - old.prefixCost;
        if (count < allNodes(nodes).length) return null;
        blocks.push({from: range.start, to: range.end, origin: from, text, nodes: copyNodes(nodes, 0, rename), dependencies: dependencies(nodes, tracked.result.document, rename), cost: count});
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
    doc.nodes = all.flatMap(b => copyNodes(b.nodes, b.from - b.origin));
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
    return {ok: true, document: doc, diagnostics: []};
  }
  clear(): void { this.snapshot = null; this.serial = 0; }
  dispose(): void { this.clear(); this.disposed = true; }
}

export function createLocalCompileSession(): LocalCompileSession { return new LocalCompileSession(); }
