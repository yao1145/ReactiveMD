import type { LocalNode } from './types';

/** Offset-only Markdown nodes consumed by the existing semantic transform. */
interface FastNode {
  type: string;
  position: {start: {offset: number}; end: {offset: number}};
  children?: FastNode[];
  value?: string;
  ordered?: boolean;
  start?: number | null;
  checked?: null;
  align?: ('left' | 'right' | 'center' | null)[];
}
interface Line {from: number; to: number; text: string}
interface Cell {from: number; to: number; left: number; right: number}
const itemMarker = /^([-+*]|\d{1,9}[.)]) /;

/**
 * A fully validated scan of the simple Markdown subset. `nodeCount` and the
 * overflow ranges are exact, not estimates: `emit` creates the final
 * `LocalNode`s in the same children-first order as the remark transform, so a
 * caller can enforce its cumulative budget without an intermediate tree.
 */
export interface FastMarkdownPlan {
  /** Exact number of `LocalNode` constructions, excluding the root. */
  readonly nodeCount: number;
  /** Number of top-level nodes. */
  readonly blockCount: number;
  /** Exact scanned text this plan was validated against. */
  readonly source: string;
  /**
   * Inline plans discovered while validating this block, keyed by exact inline
   * text. A caller that recompiles a structurally similar block can hand this
   * map back as an `InlinePlanLookup` so unchanged rows/items never have to be
   * rescanned. Values may be `undefined` (a cached rejection).
   */
  readonly rows: ReadonlyMap<string, InlinePlan | undefined>;
  /**
   * Range of the `(remaining + 1)`-th node in transform order, or `undefined`
   * when the plan does not construct that many nodes. Never creates nodes.
   */
  overflowAt(remaining: number): {start: number; end: number} | undefined;
  /**
   * Build the final nodes children-first. Validation already succeeded when a
   * plan exists, so `create` is never called for an ambiguous document.
   */
  emit(create: (type: string, start: number, end: number, extra?: Partial<LocalNode>) => LocalNode): LocalNode[];
}

/** Node properties the simple subset can produce, in construction order. */
interface NodeExtra<N> {
  value?: string;
  ordered?: boolean;
  start?: number | null;
  checked?: null;
  align?: ('left' | 'right' | 'center' | null)[];
  children?: N[];
}
type ScanCreate<N> = (type: string, from: number, to: number, extra: NodeExtra<N>) => N;

/** One validated inline token; offsets are relative to the scanned text. */
export interface InlineTextToken {
  readonly type: 'text';
  readonly from: number;
  readonly to: number;
  readonly value: string;
}
export interface InlineStrongToken {
  readonly type: 'strong';
  readonly from: number;
  readonly to: number;
  /** Inner text value; the inner range is `[from + 2, to - 2)`. */
  readonly value: string;
}
export type InlineToken = InlineTextToken | InlineStrongToken;
/** Read-only inline plan. `undefined` means the text is outside the subset. */
export type InlinePlan = readonly InlineToken[];

/**
 * Row-level inline plans carried by a previous compile. Used in preference to
 * the bounded global LRU so a sequence of edits over a large list/table never
 * has to re-scan unchanged rows (and cannot thrash the LRU).
 */
export type InlinePlanLookup = ReadonlyMap<string, InlinePlan | undefined>;

/** Distinguishes a cached rejection from a cache miss. */
export type CacheLookup<T> =
  | { readonly hit: true; readonly value: T | undefined }
  | { readonly hit: false };

/**
 * Optional session cache used by the parser. Only read-only scan results are
 * stored; implementations must bound their entry count.
 */
export interface FastMarkdownCache {
  readPlan(text: string): CacheLookup<FastMarkdownPlan>;
  writePlan(text: string, value: FastMarkdownPlan | undefined): void;
  readInline(text: string): CacheLookup<InlinePlan>;
  writeInline(text: string, value: InlinePlan | undefined): void;
  /** Called when an inline plan was served from this cache. */
  noteInlineReuse?(kind: 'row' | 'item'): void;
  /** Called when a non-rejected fast plan was served from this cache. */
  notePlanReuse?(): void;
}

type InlineLookup = (from: number, to: number, kind?: 'row' | 'item') => InlinePlan | undefined;

/**
 * Reject the whole document before any node is built. Lines keep their exact
 * UTF-16 offsets; CR, LF and CRLF all terminate a line without normalization.
 */
function readLines(source: string): Line[] | undefined {
  if (source.includes(String.fromCharCode(0xfeff))
    || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\\`_{}\[\]<>!~&$@#]/.test(source)
    || source.includes('://') || /www\./i.test(source)) return;
  const lines: Line[] = [];
  for (let from = 0; from < source.length;) {
    let to = from;
    while (to < source.length && source[to] !== '\r' && source[to] !== '\n') to++;
    const text = source.slice(from, to);
    // Keep whitespace normalization and hard-break handling in remark.
    if (text.startsWith(' ') || text.endsWith(' ')) return;
    lines.push({from, to, text});
    from = source[to] === '\r' && source[to + 1] === '\n' ? to + 2 : to + 1;
  }
  return lines;
}

/**
 * Pure inline scan shared by validation, counting and emission. The result
 * depends only on the text itself, so `LocalParseSession` can reuse it when
 * one row or item in a table/list changes.
 */
function computeInlinePlan(text: string): InlinePlan | undefined {
  const tokens: InlineToken[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let open = cursor;
    while (open < text.length && text[open] !== '*') open++;
    if (open === text.length) {
      tokens.push({type: 'text', from: cursor, to: text.length, value: text.slice(cursor)});
      break;
    }
    if (text.slice(open, open + 2) !== '**' || (open > 0 && text[open - 1] !== ' ')) return;
    let close = open + 2;
    while (close < text.length && text[close] !== '*') close++;
    if (close + 2 > text.length || text.slice(close, close + 2) !== '**'
      || (close + 2 < text.length && !/[ .,;:?)\-]/.test(text[close + 2]))) return;
    const value = text.slice(open + 2, close);
    if (!/^[\p{L}\p{N}](?:[\p{L}\p{N} .,:;()/-]*[\p{L}\p{N}])?$/u.test(value)) return;
    if (open > cursor) tokens.push({type: 'text', from: cursor, to: open, value: text.slice(cursor, open)});
    tokens.push({type: 'strong', from: open, to: close + 2, value});
    cursor = close + 2;
  }
  return tokens;
}

/** Materialize one inline plan through the caller's node factory. */
function inlineNodes<N>(
  from: number,
  to: number,
  kind: 'row' | 'item' | undefined,
  build: ScanCreate<N>,
  lookup: InlineLookup,
): N[] | undefined {
  const plan = lookup(from, to, kind);
  if (plan === undefined) return;
  const result: N[] = [];
  for (const token of plan) {
    if (token.type === 'text') {
      result.push(build('text', from + token.from, from + token.to, {value: token.value}));
    } else {
      const inner = build('text', from + token.from + 2, from + token.to - 2, {value: token.value});
      result.push(build('strong', from + token.from, from + token.to, {children: [inner]}));
    }
  }
  return result;
}

/**
 * Linear scanner for flat, single-line list items, rectangular pipe tables and
 * single-line prose paragraphs. Only plain text and unambiguous,
 * space-delimited **strong** spans are accepted.
 *
 * The same traversal serves validation (a count-only builder), exact overflow
 * lookup and final emission. No node object is created until the caller's
 * builder asks for one, and anything outside the subset returns `undefined`,
 * reserving remark for its reference resolution, escaping, nesting and
 * container precedence rules.
 */
function scan<N>(source: string, lines: readonly Line[], build: ScanCreate<N>, inlinePlan: InlineLookup): N[] | undefined {
  function inline(from: number, to: number, kind?: 'row' | 'item'): N[] | undefined {
    return inlineNodes(from, to, kind, build, inlinePlan);
  }
  function prose(from: number, to: number, kind?: 'row' | 'item'): N | undefined {
    const text = source.slice(from, to);
    if (!text || /^[ >+=-]/.test(text) || itemMarker.test(text) || text.includes('|')) return;
    const children = inline(from, to, kind);
    if (children === undefined) return;
    return build('paragraph', from, to, {children});
  }
  function cells(line: Line): Cell[] | undefined {
    if (!line.text.startsWith('|') || !line.text.endsWith('|') || line.text.length < 2) return;
    const result: Cell[] = [];
    let left = line.from;
    for (let right = left + 1; right < line.to; right++) {
      if (source[right] !== '|') continue;
      let from = left + 1, to = right;
      while (source[from] === ' ' && from < to) from++;
      while (source[to - 1] === ' ' && to > from) to--;
      result.push({from, to, left, right}); left = right;
    }
    return result;
  }
  function row(line: Line, parts: Cell[]): N | undefined {
    const children: N[] = [];
    for (let i = 0; i < parts.length; i++) {
      const cell = parts[i], content = inline(cell.from, cell.to, 'row');
      if (content === undefined) return;
      children.push(build('tableCell', cell.left, i === parts.length - 1 ? line.to : cell.right, {children: content}));
    }
    return build('tableRow', line.from, line.to, {children});
  }
  const children: N[] = [];
  for (let i = 0; i < lines.length;) {
    const first = lines[i];
    if (!first.text) {i++; continue;}
    const marker = itemMarker.exec(first.text);
    if (marker) {
      const items: N[] = [];
      const ordered = marker[1].length > 1;
      const style = ordered ? marker[1].at(-1) : marker[1];
      while (i < lines.length) {
        const line = lines[i], next = itemMarker.exec(line.text);
        if (!next || (ordered ? next[1].length === 1 || next[1].at(-1) !== style : next[1] !== style)) break;
        const paragraph = prose(line.from + next[0].length, line.to, 'item');
        if (paragraph === undefined) return;
        items.push(build('listItem', line.from, line.to, {checked: null, children: [paragraph]})); i++;
      }
      // A blank between like lists produces a single loose list in CommonMark.
      let following = i;
      while (following < lines.length && !lines[following].text) following++;
      if (following < lines.length && itemMarker.test(lines[following].text)) return;
      children.push(build('list', first.from, lines[i-1].to, {
        ordered, start: ordered ? parseInt(marker[1], 10) : null, children: items,
      }));
    } else if (first.text.startsWith('|')) {
      const header = cells(first), delimiter = lines[i + 1] && cells(lines[i + 1]);
      if (!header?.length || !delimiter || header.length !== delimiter.length) return;
      const align: NonNullable<FastNode['align']> = [];
      for (const cell of delimiter) {
        const text = source.slice(cell.from, cell.to);
        if (!/^:?-+:?$/.test(text)) return;
        align.push(text.startsWith(':') ? text.endsWith(':') ? 'center' : 'left' : text.endsWith(':') ? 'right' : null);
      }
      const head = row(first, header);
      if (head === undefined) return;
      const rows = [head]; i += 2;
      while (i < lines.length && lines[i].text.startsWith('|')) {
        const parts = cells(lines[i]);
        if (!parts || parts.length !== header.length) return;
        const next = row(lines[i], parts);
        if (next === undefined) return;
        rows.push(next); i++;
      }
      children.push(build('table', first.from, lines[i-1].to, {align, children: rows}));
    } else {
      const paragraph = prose(first.from, first.to);
      if (paragraph === undefined) return;
      children.push(paragraph); i++;
    }
    if (i < lines.length && lines[i].text) return;
  }
  return children;
}

function uncachedInline(source: string): InlineLookup {
  return (from, to) => computeInlinePlan(source.slice(from, to));
}

/**
 * Build one validated plan, reusing inline plans from the session. A local map
 * prevents the counting and emission passes from double-counting a session hit
 * while still letting a changed block reuse unchanged rows/items.
 */
function buildPlan(source: string, cache?: FastMarkdownCache, rowPlans?: InlinePlanLookup): FastMarkdownPlan | undefined {
  const lines = readLines(source);
  if (lines === undefined) return;
  const local = new Map<string, InlinePlan | undefined>();
  const inlinePlan: InlineLookup = (from, to, kind) => {
    const text = source.slice(from, to);
    if (local.has(text)) return local.get(text);
    // A previous revision's per-row plan is exact for the same text and works
    // regardless of row order, so it is checked before the bounded LRU. This
    // is what keeps a 1000-row sequential scan from evicting its own working
    // set on every edit.
    if (rowPlans?.has(text)) {
      const plan = rowPlans.get(text);
      local.set(text, plan);
      if (kind && plan !== undefined) cache?.noteInlineReuse?.(kind);
      return plan;
    }
    if (cache) {
      const cached = cache.readInline(text);
      if (cached.hit) {
        if (kind && cached.value !== undefined) cache.noteInlineReuse?.(kind);
        local.set(text, cached.value);
        return cached.value;
      }
    }
    const plan = computeInlinePlan(text);
    local.set(text, plan);
    cache?.writeInline(text, plan);
    return plan;
  };
  let nodeCount = 0;
  const blocks = scan<null>(source, lines, () => { nodeCount += 1; return null; }, inlinePlan);
  if (blocks === undefined) return;
  const blockCount = blocks.length;
  return {
    nodeCount,
    blockCount,
    source,
    rows: local,
    overflowAt(remaining: number): {start: number; end: number} | undefined {
      // Looking for `remaining + 1` (one-based) is the first construction that
      // a cumulative budget of `remaining` would reject.
      const target = remaining + 1;
      if (!Number.isSafeInteger(target) || target < 1 || target > nodeCount) return;
      let index = 0;
      let found: {start: number; end: number} | undefined;
      const stop = {};
      try {
        scan<null>(source, lines, (_type, start, end) => {
          index += 1;
          if (index === target) {found = {start, end}; throw stop;}
          return null;
        }, inlinePlan);
      } catch (cause) {if(cause !== stop)throw cause;}
      return found;
    },
    emit(create: (type: string, start: number, end: number, extra?: Partial<LocalNode>) => LocalNode): LocalNode[] {
      // The input was validated above, so this pass cannot reject. Children are
      // built before their parent, matching the remark transform's ordering.
      const nodes = scan<LocalNode>(source, lines, (type, start, end, extra) =>
        create(type, start, end, extra as unknown as Partial<LocalNode>), inlinePlan);
      if (nodes === undefined) throw new Error('Fast Markdown plan became invalid during emission.');
      return nodes;
    },
  };
}

/**
 * Legacy offset-only scanner. Its entry restriction is unchanged: inputs
 * without a pipe or a list marker stay with remark. New production callers
 * should use `planFastMarkdown`, which also accepts single-line prose.
 */
export function parseFastMarkdown(source: string): FastNode | undefined {
  if (!source.includes('|') && !itemMarker.test(source) && !/[\r\n](?:[-+*]|\d{1,9}[.)]) /.test(source)) return;
  const lines = readLines(source);
  if (lines === undefined) return;
  const make = (type: string, from: number, to: number, extra: Partial<FastNode> = {}): FastNode =>
    ({type, position: {start: {offset: from}, end: {offset: to}}, ...extra});
  const children = scan<FastNode>(source, lines, (type, from, to, extra) => make(type, from, to, extra), uncachedInline(source));
  if (children === undefined) return;
  return make('root', 0, source.length, {children});
}

/**
 * Validate the whole input before exposing a plan. The counting pass uses
 * placeholder values, so no `LocalNode` and no identifier/budget state exists
 * until `emit` runs. Prose-only inputs are accepted here; the legacy entry
 * restriction above applies only to `parseFastMarkdown`.
 *
 * When a session cache is supplied, identical block text reuses the complete
 * plan (and, on a plan miss, identical rows/items reuse their inline plans).
 * `rowPlans` is an additional, caller-owned hint from the previous revision;
 * it is consulted before the bounded cache so large row blocks cannot thrash
 * it. Inline plans are pure functions of their text, so this never changes
 * validation, emission order or node counts.
 */
export function planFastMarkdown(
  source: string,
  cache?: FastMarkdownCache,
  rowPlans?: InlinePlanLookup,
): FastMarkdownPlan | undefined {
  if (cache) {
    const cached = cache.readPlan(source);
    if (cached.hit) {
      if (cached.value !== undefined) cache.notePlanReuse?.();
      return cached.value;
    }
  }
  const plan = buildPlan(source, cache, rowPlans);
  cache?.writePlan(source, plan);
  return plan;
}
