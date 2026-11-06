/** One physical source line (LF, CRLF or CR terminated). */
export interface SourceLineFacts {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly blank: boolean;
  readonly indent: number;
  /** Leading blockquote markers (`>`); code content contributes zero. */
  readonly quoteDepth: number;
  /** True for a fence delimiter or any line inside a fenced code block. */
  readonly fenced: boolean;
  /** Blockquote depth plus open list levels at this line. */
  readonly depth: number;
}

/**
 * Shared, read-only line and container facts for one source string. The block
 * planner, the parse budgets and the cache all consume this single scan instead
 * of re-splitting the same text. It is intentionally conservative: fenced and
 * (non-marker) indented code lines never contribute container depth, so `>`
 * and `-` inside code cannot be mistaken for structure.
 */
export interface SourceFacts {
  readonly lines: readonly SourceLineFacts[];
  readonly maxMarkdownDepth: number;
  /** Upper bound from raw line prefixes, including code/HTML. Used to decide
   * when the authoritative container scan is necessary, never to reject. */
  readonly potentialDepth: number;
  /** Half-open ranges of fenced code blocks, including their delimiter lines. */
  readonly fenceSpans: readonly { readonly from: number; readonly to: number }[];
}

interface FenceRun { readonly char: string; readonly length: number }

function fenceRunAt(text: string, index: number): FenceRun | undefined {
  const char = text[index];
  if (char !== '`' && char !== '~') return undefined;
  let length = 0;
  while (text[index + length] === char) length++;
  return length >= 3 ? { char, length } : undefined;
}

function computeFacts(source: string): SourceFacts {
  if (!source.length) return { lines: [], maxMarkdownDepth: 0,potentialDepth:0, fenceSpans: [] };
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '\r') {
      if (source[index + 1] === '\n') index++;
      starts.push(index + 1);
    } else if (char === '\n') {
      starts.push(index + 1);
    }
  }
  const lines: SourceLineFacts[] = [];
  const fenceSpans: { from: number; to: number }[] = [];
  const listColumns: number[] = [];
  let fence: { char: string; length: number } | null = null;
  let maxMarkdownDepth = 0;
  let potentialDepth=0;
  for (let index = 0; index < starts.length; index++) {
    const from = starts[index];
    let to = index + 1 < starts.length ? starts[index + 1] : source.length;
    // `starts` points after the line ending; trim it for the content range.
    while (to > from && (source[to - 1] === '\r' || source[to - 1] === '\n')) to--;
    const text = source.slice(from, to);
    let raw=from,potential=0;
    while(raw<to) {
      while(source[raw]===' '||source[raw]==='\t'){potential+=source[raw]==='\t'?4:1;raw++;}
      if(source[raw]==='>'){potential++;raw++;continue;}
      const marker=/^(?:[-+*]|\d{1,9}[.)])(?=[ \t])/.exec(source.slice(raw,to));
      if(marker){potential++;raw+=marker[0].length;continue;}
      break;
    }
    potentialDepth=Math.max(potentialDepth,potential);
    const cursor = index === 0 && source.charCodeAt(0) === 0xfeff ? from + 1 : from;
    let indent = 0;
    while (source[cursor + indent] === ' ' || source[cursor + indent] === '\t') indent++;
    const blank = /^[ \t]*$/.test(source.slice(cursor, to));
    let probe = cursor;
    for (let spaces = 0; spaces < 3 && source[probe] === ' '; spaces++) probe++;
    let fenced = false;
    if (fence) {
      const rest = source.slice(probe, to);
      const close = fenceRunAt(rest, 0);
      if (close && close.char === fence.char && close.length >= fence.length
        && /^[ \t]*$/.test(rest.slice(close.length))) {
        fence = null;
        const span = fenceSpans[fenceSpans.length - 1];
        if (span) span.to = to;
      }
      fenced = true;
    } else {
      const open = fenceRunAt(source.slice(probe, to), 0);
      if (open) {
        fence = { char: open.char, length: open.length };
        fenced = true;
        fenceSpans.push({ from, to: source.length });
      }
    }
    let quoteDepth = 0;
    let depth = 0;
    if (!fenced && !blank) {
      let quoteCursor = cursor;
      for (;;) {
        let next = quoteCursor;
        for (let spaces = 0; spaces < 3 && source[next] === ' '; spaces++) next++;
        if (source[next] !== '>') break;
        quoteCursor = next + 1;
        if (source[quoteCursor] === ' ') quoteCursor++;
        quoteDepth++;
      }
      let markerCursor = quoteCursor;
      while (markerCursor < to && (source[markerCursor] === ' ' || source[markerCursor] === '\t')) markerCursor++;
      const marker = /^([-+*]|\d{1,9}[.)])(?=[ \t]|$)/.exec(source.slice(markerCursor, to));
      // Four or more columns of indentation with no open list is indented code,
      // not a new container: `    - x` and `    > x` stay inert here.
      const indentedCode = markerCursor - quoteCursor >= 4 && listColumns.length === 0;
      if (marker && !indentedCode) {
        const column = markerCursor - cursor;
        while (listColumns.length && listColumns[listColumns.length - 1] >= column) listColumns.pop();
        listColumns.push(column);
      } else {
        const indentAfterQuote = markerCursor - quoteCursor;
        while (listColumns.length && indentAfterQuote < listColumns[listColumns.length - 1]) listColumns.pop();
      }
      depth = quoteDepth + listColumns.length;
      if (depth > maxMarkdownDepth) maxMarkdownDepth = depth;
    }
    lines.push({ from, to, text, blank, indent, quoteDepth, fenced, depth });
  }
  return { lines, maxMarkdownDepth,potentialDepth, fenceSpans };
}

/** Compiler-private source index. Diagnostic line semantics remain LF-based. */
export class SourceContext {
  readonly lineStarts = [0];
  private logicalLines: number | undefined;
  private factsValue: SourceFacts | undefined;
  constructor(readonly source: string) {
    for(let i=0;i<source.length;i++)if(source[i]==='\n')this.lineStarts.push(i+1);
  }
  get logicalLineCount(): number {
    if(this.logicalLines!==undefined)return this.logicalLines;
    let lines=this.source.length?this.lineStarts.length:0;
    for(let i=this.source.indexOf('\r');i>=0;i=this.source.indexOf('\r',i+1))if(this.source[i+1]!=='\n')lines++;
    return this.logicalLines=lines;
  }
  /** One shared physical-line/container scan, computed on first use. */
  get facts(): SourceFacts {
    return this.factsValue ?? (this.factsValue = computeFacts(this.source));
  }
  lineIndexAt(offset: number): number {
    let low=0,high=this.lineStarts.length-1;
    while(low<high) {
      const mid=(low+high+1)>>>1;
      if(this.lineStarts[mid]<=offset)low=mid;else high=mid-1;
    }
    return low;
  }
  lineStartAt(offset: number): number {return this.lineStarts[this.lineIndexAt(offset)];}
}

interface Segment {from: number; to: number; source: number; step: 0 | 1}
/** Piecewise affine mapping, including an explicit original-region EOF. */
export class MappedSource {
  private readonly chunks: string[] = [];
  private readonly segments: Segment[] = [];
  private end = 0;
  private recent = 0;
  length = 0;
  constructor(private readonly context: SourceContext) {}
  get segmentCount(): number {return this.segments.length;}
  private append(text: string, source: number, step: 0 | 1): void {
    if(!text.length)return;
    const previous=this.segments.at(-1);
    if(previous && previous.step===step && previous.source+(previous.to-previous.from)*step===source)previous.to+=text.length;
    else this.segments.push({from:this.length,to:this.length+text.length,source,step});
    this.chunks.push(text);this.length+=text.length;
  }
  generated(text: string, source: number): void {this.append(text,source,0);}
  original(from: number, to: number, indent=0, stripBlockquote=false, stripBom=false): void {
    const {source,lineStarts}=this.context;
    if(stripBom && from===0 && source.charCodeAt(0)===0xfeff)from++;
    if(from>=to)return;
    if(!indent){this.append(source.slice(from,to),from,1);return;}
    let line=this.context.lineIndexAt(from);
    while(from<to) {
      const start=lineStarts[line],lineEnd=lineStarts[line+1]??source.length,end=Math.min(to,lineEnd);
      let skip=stripBlockquote ? (/^(?:[ \t]{0,3}>[ \t]?)+/.exec(source.slice(start,lineEnd))?.[0].length??0) : 0;
      let spaces=0;
      while(spaces<indent && (source[start+skip]===' '||source[start+skip]==='\t')){skip++;spaces++;}
      const begin=Math.min(end,Math.max(from,start+skip));
      this.append(source.slice(begin,end),begin,1);
      from=end;line++;
    }
  }
  finish(end: number): void {this.end=end;}
  text(): string {return this.chunks.join('');}
  at(offset: number, fallback: number): number {
    if(offset===this.length)return this.end;
    if(offset<0||offset>this.length||!Number.isInteger(offset))return fallback;
    let segment=this.segments[this.recent];
    if(!segment||offset<segment.from||offset>=segment.to) {
      let low=0,high=this.segments.length-1;
      while(low<high) {
        const mid=(low+high+1)>>>1;
        if(this.segments[mid].from<=offset)low=mid;else high=mid-1;
      }
      this.recent=low;segment=this.segments[low];
    }
    return segment ? segment.source+(offset-segment.from)*segment.step : fallback;
  }
}
