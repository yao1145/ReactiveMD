import { planFastMarkdown, type FastMarkdownCache, type FastMarkdownPlan, type InlinePlanLookup, type FastMarkdownContext } from './fast-markdown';
import type { SourceContext } from '../source/source-context';

/** Per-parse accounting used by the compiler's performance diagnostics. */
export interface MarkdownBlockStats {
  fastBlocks: number;
  generalBlocks: number;
  fastCharacters: number;
  generalCharacters: number;
  lines: number;
}

export interface Candidate { from: number; to: number; type: string }
export interface MarkdownStructure {candidates:Candidate[];maxDepth:number;codeRanges:{start:number;end:number}[]}
interface FastRegion { from: number; to: number; plan: FastMarkdownPlan }

const FAST_BLOCK = 'rmdFastBlock';
/** Footnote definitions are containers and can continue lazily on the next line. */
const FOOTNOTE_LABEL = '[^';
/** Lezer containers whose last paragraph may absorb the next line lazily. */
const CONTAINERS = new Set(['BulletList', 'OrderedList', 'Blockquote']);
/** A fast region that is a list starts with a list item marker. */
const LIST_START = /^([-+*]|\d{1,9}[.)]) /;
/** The next non-blank line after a block starts with a list item marker. */
const ITEM_AFTER_BLANKS = /[ \t]*(?:\r\n?|\n)(?:[ \t]*(?:\r\n?|\n))*[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|\r|\n|$)/y;
/** Fenced code starts with its fence; indented code starts with indentation. */
const FENCE_START = /^ {0,3}(`|~)/;
/** Single-line leaves that close every open block, so the next line starts fresh. */
const CLOSED_LEAVES = new Set(['ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'HorizontalRule']);

/**
 * Split a Markdown document into independently parseable simple blocks.
 *
 * A whole-document fast plan is used when possible. Otherwise Lezer only
 * proposes top-level boundaries; every proposal is re-validated with the fast
 * planner, which rejects syntax whose meaning depends on surrounding context.
 * Safe ranges are blanked with equal-length spaces (line endings preserved) and
 * parsed once by the general parser, so reference and footnote resolution still
 * sees the whole document. Any overlap between a general node and a blanked
 * range means the boundaries were not trustworthy and the whole source is
 * re-parsed normally.
 */
export function parseMarkdownBlocks(
  source: string,
  parseGeneral: (source: string) => any,
  context?: SourceContext,
  cache?: FastMarkdownCache,
  structure?:MarkdownStructure,
  rowPlans?:InlinePlanLookup,
  fastContext?:FastMarkdownContext,
): {tree: any; stats: MarkdownBlockStats} {
  // Physical line count for the work statistics. LF-only `lineStarts` stays
  // reserved for diagnostic coordinates.
  const lines = context?.source === source ? context.logicalLineCount : countLines(source);
  const whole = planOf(source, cache, rowPlans, fastContext);
  if (whole) {
    return {
      tree: root(source, [fastBlock(0, source.length, whole)]),
      stats: {
        fastBlocks: whole.blockCount,
        generalBlocks: 0,
        fastCharacters: source.length,
        generalCharacters: 0,
        lines,
      },
    };
  }

  const candidates = structure?.candidates ?? [];
  const proposed: FastRegion[] = [];
  let floor = 0;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (candidate.from < floor || !isBlockBoundary(source, candidate)) continue;
    if (!safePredecessor(source, candidate, candidates[index - 1], proposed.at(-1))) continue;
    const plan = planOf(source.slice(candidate.from, candidate.to), cache, rowPlans, fastContext?{...fastContext,offset:candidate.from}:undefined);
    if (!plan) continue;
    proposed.push({from: candidate.from, to: candidate.to, plan});
    floor = candidate.to;
  }
  const regions = keepFollowingContext(source, proposed);
  if (!regions.length) return generalResult(source, parseGeneral, lines);

  const masked = maskRegions(source, regions);
  const general = parseGeneral(masked);
  if (!general || !Array.isArray(general.children)
    || overlapsFastRegions(general.children, regions)
    || footnoteContinuesIntoFastLine(source, general.children, regions)
    || contextCrossesBlankLines(source, general.children, regions)) {
    return generalResult(source, parseGeneral, lines);
  }

  let fastCharacters = 0;
  let fastBlocks = 0;
  for (const region of regions) {
    fastCharacters += region.to - region.from;
    fastBlocks += region.plan.blockCount;
  }
  return {
    tree: root(source, mergeChildren(general.children, regions)),
    stats: {
      fastBlocks,
      generalBlocks: general.children.length,
      fastCharacters,
      generalCharacters: source.length - fastCharacters,
      lines,
    },
  };
}

function planOf(source: string, cache?: FastMarkdownCache, rowPlans?:InlinePlanLookup, context?:FastMarkdownContext): FastMarkdownPlan | undefined {
  if (!source.length || typeof planFastMarkdown !== 'function') return undefined;
  let plan: FastMarkdownPlan | undefined;
  try {
    const shield=context?.shield?.(source,context.offset??0);
    if(shield!==undefined){
      const advisory=planFastMarkdown(shield,cache,undefined,{allowBraces:true});
      if(advisory)return {...advisory,shieldOnly:true,emit(){throw new Error('Cannot emit an advisory shielding plan');}};
    }
    plan = planFastMarkdown(source, cache, rowPlans,context);
  } catch {
    return undefined;
  }
  return plan && Number.isInteger(plan.blockCount) && plan.blockCount > 0
    && typeof plan.emit === 'function' && typeof plan.overflowAt === 'function'
    ? plan
    : undefined;
}

function generalResult(
  source: string,
  parseGeneral: (source: string) => any,
  lines: number,
): {tree: any; stats: MarkdownBlockStats} {
  const tree = parseGeneral(source);
  const generalBlocks = tree && Array.isArray(tree.children) ? tree.children.length : 0;
  return {
    tree,
    stats: {
      fastBlocks: 0,
      generalBlocks,
      fastCharacters: 0,
      generalCharacters: source.length,
      lines,
    },
  };
}

export interface MarkdownTreeFacts {
  codeRanges:{start:number;end:number}[];
  definitions:{start:number;end:number}[];
  mathLiterals:{start:number;end:number}[];
}
const treeFactsCache=new WeakMap<object,{all?:MarkdownTreeFacts;outer?:MarkdownTreeFacts}>();
/** One iterative semantic-fact traversal shared by shielding and containers. */
export function markdownTreeFacts(tree:any,enterFootnotes=true):MarkdownTreeFacts {
  const cached=treeFactsCache.get(tree)??{};
  const key=enterFootnotes?'all':'outer';if(cached[key])return cached[key]!;
  const result:MarkdownTreeFacts={codeRanges:[],definitions:[],mathLiterals:[]};
  const stack=[tree];
  while(stack.length) {
    const raw=stack.pop()!;
    const from=raw.position?.start?.offset,to=raw.position?.end?.offset;
    if(raw.type==='code'&&Number.isInteger(from)&&Number.isInteger(to))result.codeRanges.push({start:from,end:to});
    if(raw.type==='footnoteDefinition'&&Number.isInteger(from)&&Number.isInteger(to))result.definitions.push({start:from,end:to});
    const whole=['image','imageReference','definition'].includes(raw.type);
    if(whole||raw.type==='link'||raw.type==='linkReference') {
      const start=whole?from:raw.children?.at(-1)?.position?.end?.offset??from;
      if(Number.isInteger(start)&&Number.isInteger(to))result.mathLiterals.push({start,end:to});
    }
    if(!enterFootnotes&&raw.type==='footnoteDefinition')continue;
    const children=raw.children??[];for(let i=children.length-1;i>=0;i--)stack.push(children[i]);
  }
  cached[key]=result;treeFactsCache.set(tree,cached);return result;
}

function isBlockBoundary(source: string, candidate: Candidate): boolean {
  return Number.isInteger(candidate.from) && Number.isInteger(candidate.to)
    && candidate.from >= 0 && candidate.to <= source.length && candidate.from < candidate.to
    && (candidate.from === 0 || isLineEnding(source.charCodeAt(candidate.from - 1)))
    && (candidate.to === source.length || isLineEnding(source.charCodeAt(candidate.to)));
}

/**
 * A candidate may only start where the previous line is blank, where a trusted
 * sibling ends at the line break, or where it is the first block. Lezer can
 * misjudge where a general block ends (a lazy line after an empty nested item)
 * or whether the next line interrupts it, so a sibling is trusted only when it
 * is itself a validated fast region or a single-line leaf. A paragraph inside a
 * list item or quote may continue lazily, even where Lezer starts a table, so a
 * container is never trusted. A footnote definition can lazily continue with
 * plain paragraph text, so a paragraph that Lezer split off after a
 * footnote-looking reference definition is not safe.
 */
function safePredecessor(source: string, candidate: Candidate, previous: Candidate | undefined, region: FastRegion | undefined): boolean {
  if (candidate.from === 0) return true;
  const breakStart = lineBreakStartBefore(source, candidate.from);
  if (previousLineBlank(source, breakStart)) return true;
  if (!previous || previous.to !== breakStart || CONTAINERS.has(previous.type)) return false;
  if (previous.type === 'LinkReference') {
    return !(candidate.type === 'Paragraph' && source.startsWith(FOOTNOTE_LABEL, previous.from));
  }
  return CLOSED_LEAVES.has(previous.type) || region?.to === previous.to;
}

/** Start offset of the line ending that terminates the line before `at`. */
function lineBreakStartBefore(source: string, at: number): number {
  let start = at;
  if (source.charCodeAt(start - 1) === 10) start--;
  if (start > 0 && source.charCodeAt(start - 1) === 13) start--;
  return start;
}

function previousLineBlank(source: string, breakStart: number): boolean {
  for (let index = breakStart; index > 0;) {
    const ch = source.charCodeAt(index - 1);
    if (isLineEnding(ch)) return true;
    if (ch !== 32 && ch !== 9) return false;
    index--;
  }
  return true;
}

/**
 * Masking a region also hides it as context for a general line right after
 * it: that line could no longer continue a list lazily or fail to interrupt a
 * paragraph. Such a region stays general unless the next line is fast too.
 */
function keepFollowingContext(source: string, proposed: readonly FastRegion[]): FastRegion[] {
  const kept: FastRegion[] = [];
  let following: number | undefined;
  for (let index = proposed.length - 1; index >= 0; index--) {
    const region = proposed[index], next = nextLineStart(source, region.to);
    if (next !== undefined && !blankLine(source, next) && following !== next) continue;
    kept.push(region);
    following = region.from;
  }
  return kept.reverse();
}

/** True when the line starting at `at` contains only spaces or tabs. */
function blankLine(source: string, at: number): boolean {
  for (let index = at; index < source.length; index++) {
    const ch = source.charCodeAt(index);
    if (isLineEnding(ch)) return true;
    if (ch !== 32 && ch !== 9) return false;
  }
  return true;
}

function maskRegions(source: string, regions: readonly FastRegion[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const region of regions) {
    parts.push(source.slice(cursor, region.from));
    // Same UTF-16 length, so every remaining position still matches the source.
    parts.push(source.slice(region.from, region.to).replace(/[^\r\n]/g, ' '));
    cursor = region.to;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

/** Ordered interval cursor; general children are already sorted by start. */
function overlapsFastRegions(children: readonly any[], regions: readonly FastRegion[]): boolean {
  let index = 0;
  let previousStart = -1;
  for (const child of children) {
    const start = child?.position?.start?.offset;
    const end = child?.position?.end?.offset;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || start < previousStart) return true;
    previousStart = start;
    while (index < regions.length && regions[index].to <= start) index++;
    const region = regions[index];
    if (region && region.from < end && start < region.to) return true;
  }
  return false;
}

/**
 * Even after masking, a footnote definition may in the real source absorb the
 * next physical line as lazy continuation. Detect that immediately following
 * fast region and defer the whole document to the general parser.
 */
function footnoteContinuesIntoFastLine(
  source: string,
  children: readonly any[],
  regions: readonly FastRegion[],
): boolean {
  const starts = new Set(regions.map(region => region.from));
  const stack = [...children];
  while (stack.length) {
    const node = stack.pop();
    if (node?.type === 'footnoteDefinition') {
      const end = node.position?.end?.offset;
      const next = Number.isInteger(end) ? nextLineStart(source, end) : undefined;
      if (next !== undefined && starts.has(next)) return true;
    }
    const nested = node?.children;
    if (Array.isArray(nested)) for (const child of nested) stack.push(child);
  }
  return false;
}

/**
 * Masked regions read as blank lines, yet some context survives blank lines.
 * Lists separated only by blank lines can form one loose list (for example
 * when Lezer ended the earlier list too soon), so a fast region must not meet
 * another list across whitespace. Whether an empty item or an ordered list
 * not starting at 1 may follow indented code depends on earlier blocks as
 * well, so a list marker after top-level indented code keeps the document
 * wholly general. Indented code and a list ending in an empty item also read
 * a masked line after them differently from the real block, and masked lines
 * after a list change where indented code following them ends.
 */
function contextCrossesBlankLines(source: string, children: readonly any[], regions: readonly FastRegion[]): boolean {
  const blocks: {from: number; to: number; list: boolean; indentedCode: boolean; open: boolean; fast: boolean}[] = [];
  for (const child of children) {
    const from = child.position.start.offset as number, to = child.position.end.offset as number;
    const indentedCode = child.type === 'code' && !FENCE_START.test(source.slice(from, from + 4));
    if (indentedCode) {
      ITEM_AFTER_BLANKS.lastIndex = to;
      if (ITEM_AFTER_BLANKS.test(source)) return true;
    }
    // Indented code and an empty last item read a following masked line differently.
    const open = indentedCode || (child.type === 'list' && !child.children?.at(-1)?.children?.length);
    blocks.push({from, to, list: child.type === 'list', indentedCode, open, fast: false});
  }
  for (const region of regions) {
    blocks.push({from: region.from, to: region.to, list: LIST_START.test(source.slice(region.from, region.to)),
      indentedCode: false, open: false, fast: true});
  }
  blocks.sort((a, b) => a.from - b.from);
  /** Whether the current run of masked regions directly follows a general list. */
  let maskedAfterList = false;
  for (let index = 1; index < blocks.length; index++) {
    const previous = blocks[index - 1], block = blocks[index];
    const adjacent = /^[ \t\r\n]*$/.test(source.slice(previous.to, block.from));
    // Masked lines read as blank lines inside that list, which changes how
    // indented code right after them ends.
    if (adjacent && block.indentedCode && previous.fast && maskedAfterList) return true;
    maskedAfterList = adjacent && block.fast && (previous.fast ? maskedAfterList : previous.list);
    if (!adjacent) continue;
    if ((previous.fast || block.fast) && previous.list && block.list) return true;
    if (previous.open && block.fast) return true;
  }
  return false;
}

function nextLineStart(source: string, end: number): number | undefined {
  let index = end;
  while (index < source.length && (source.charCodeAt(index) === 32 || source.charCodeAt(index) === 9)) index++;
  if (index >= source.length) return undefined;
  const ch = source.charCodeAt(index);
  if (ch === 10) return index + 1;
  if (ch === 13) return index + (source.charCodeAt(index + 1) === 10 ? 2 : 1);
  return undefined;
}

function mergeChildren(children: readonly any[], regions: readonly FastRegion[]): any[] {
  const merged: any[] = [];
  let index = 0;
  for (const child of children) {
    const start = child.position.start.offset;
    while (index < regions.length && regions[index].to <= start) {
      merged.push(fastBlock(regions[index].from, regions[index].to, regions[index].plan));
      index++;
    }
    merged.push(child);
  }
  while (index < regions.length) {
    merged.push(fastBlock(regions[index].from, regions[index].to, regions[index].plan));
    index++;
  }
  return merged;
}

function fastBlock(from: number, to: number, plan: FastMarkdownPlan): any {
  return {type: FAST_BLOCK, position: {start: {offset: from}, end: {offset: to}}, plan};
}

function root(source: string, children: any[]): any {
  return {type: 'root', position: {start: {offset: 0}, end: {offset: source.length}}, children};
}

function isLineEnding(code: number): boolean {
  return code === 10 || code === 13;
}

function countLines(source: string): number {
  if (!source.length) return 0;
  let lines = 1;
  for (let index = 0; index < source.length; index++) {
    const ch = source.charCodeAt(index);
    if (ch === 10) lines++;
    else if (ch === 13) {
      lines++;
      if (source.charCodeAt(index + 1) === 10) index++;
    }
  }
  return lines;
}
