import { parseLocal, type ParsedLocal } from './parser';
import { localCompileOptionsKey } from './options';
import type { LocalCompileOptions } from './types';
import type { SourceContext } from './source-context';
import type { CacheLookup, FastMarkdownPlan, InlinePlan } from './fast-markdown';
import type { ParseSessionCache, ParseSessionCounters } from './parse-budget';

/** Bounded entry counts; sessions retain only the current/recent document. */
const MAX_PLAN_ENTRIES = 128;
const MAX_INLINE_ENTRIES = 512;
const MAX_TREE_ENTRIES = 32;

/**
 * Small insertion-ordered LRU. Values may themselves be `undefined` (a cached
 * rejection), so entries are wrapped to keep `has` semantics exact. Both entry
 * count and the approximate key bytes are bounded, and a single oversized key
 * is simply not cached.
 */
class LruMap<T> {
  private readonly entries = new Map<string, { value: T }>();
  private bytes = 0;
  constructor(
    private readonly limit: number,
    private readonly byteLimit: number,
  ) {}
  get size(): number { return this.entries.size; }
  read(key: string): CacheLookup<T> {
    const entry = this.entries.get(key);
    if (entry === undefined) return { hit: false };
    // Refresh recency without reallocating the wrapper.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { hit: true, value: entry.value };
  }
  write(key: string, value: T): void {
    if (key.length > this.byteLimit / 2) return;
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      this.bytes -= key.length;
    }
    this.entries.set(key, { value });
    this.bytes += key.length;
    while (this.entries.size > this.limit || this.bytes > this.byteLimit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.bytes -= oldest.value.length;
    }
  }
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/**
 * Session-scoped reuse for the Markdown parser.
 *
 * The session stores only read-only intermediate data: validated fast-block
 * plans, inline plans for table rows/list items, and general Markdown ASTs.
 * Every `parse()` still rebuilds the final `LocalNode` tree through the
 * parser's own factory, so ids, source ranges and the exact cumulative node
 * budget match an independent full compilation.
 *
 * Caches are bounded and keyed by exact source text. Changing compile options,
 * permissions or budgets clears them. Independent `parseLocal`/`compileLocal`
 * calls never see this state.
 */
export class LocalParseSession implements ParseSessionCache {
  private disposed = false;
  private optionKey: string | undefined;
  private readonly plans = new LruMap<FastMarkdownPlan | undefined>(MAX_PLAN_ENTRIES, 512 * 1024);
  private readonly inline = new LruMap<InlinePlan | undefined>(MAX_INLINE_ENTRIES, 256 * 1024);
  private readonly trees = new LruMap<unknown>(MAX_TREE_ENTRIES, 512 * 1024);
  private counts: {-readonly [K in keyof ParseSessionCounters]:ParseSessionCounters[K]} = {
    hits: 0,
    misses: 0,
    reusedBlocks: 0,
    reusedRows: 0,
    reusedItems: 0,
    reusedAst: 0,
  };

  parse(source: string, options?: LocalCompileOptions, context?: SourceContext): ParsedLocal {
    if (this.disposed) throw new Error('Local parse session is disposed');
    const key = localCompileOptionsKey(options);
    // Options, capability flags and budgets all fold into this key.
    if (key !== this.optionKey) {
      this.optionKey = key;
      this.reset();
    }
    return parseLocal(source, options, context, this);
  }

  clear(): void {
    this.optionKey = undefined;
    this.reset();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  get stats(): Readonly<{
    hits: number;
    misses: number;
    reusedBlocks: number;
    reusedRows: number;
    reusedItems: number;
    entries: number;
  }> {
    return {
      hits: this.counts.hits,
      misses: this.counts.misses,
      reusedBlocks: this.counts.reusedBlocks,
      reusedRows: this.counts.reusedRows,
      reusedItems: this.counts.reusedItems,
      entries: this.plans.size + this.inline.size + this.trees.size,
    };
  }

  private reset(): void {
    this.plans.clear();
    this.inline.clear();
    this.trees.clear();
    this.counts = { hits: 0, misses: 0, reusedBlocks: 0, reusedRows: 0, reusedItems: 0, reusedAst: 0 };
  }

  counters(): ParseSessionCounters {
    return { ...this.counts };
  }

  readPlan(text: string): CacheLookup<FastMarkdownPlan> {
    return this.lookup(this.plans, text);
  }

  writePlan(text: string, value: FastMarkdownPlan | undefined): void {
    this.plans.write(text, value);
  }

  readInline(text: string): CacheLookup<InlinePlan> {
    return this.lookup(this.inline, text);
  }

  writeInline(text: string, value: InlinePlan | undefined): void {
    this.inline.write(text, value);
  }

  notePlanReuse(): void {
    this.counts.reusedBlocks += 1;
  }

  noteInlineReuse(kind: 'row' | 'item'): void {
    if (kind === 'row') this.counts.reusedRows += 1;
    else this.counts.reusedItems += 1;
  }

  readTree(text: string): { readonly hit: true; readonly value: unknown } | { readonly hit: false } {
    return this.lookup(this.trees, text, true);
  }

  writeTree(text: string, value: unknown): void {
    this.trees.write(text, value);
  }

  private lookup<T>(map: LruMap<T>, key: string, tree = false): CacheLookup<T> {
    const result = map.read(key);
    if (result.hit) {
      this.counts.hits += 1;
      if (tree) this.counts.reusedAst += 1;
    } else {
      this.counts.misses += 1;
    }
    return result;
  }
}
