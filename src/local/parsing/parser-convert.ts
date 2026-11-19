import { ParseWorkBudget } from './parse-budget';
import { MappedSource, SourceContext } from '../source/source-context';
import type { ParserWork } from './parser-core';
import {
  BLOCK_HTML_RESULTS,
  LocalBudgetError,
  MARK_BOUNDARY,
  MARK_CLOSE,
  MARK_OPEN,
  type ConvertOptions,
  type CreateNode,
  type ParseDiagnostic,
  type ParseMarkdown,
  type Token,
} from './parser-internals';
import type { FastMarkdownPlan } from './fast-markdown';
import type { LocalNode } from '../types';
import { normalizeFootnoteIdentifier } from './footnotes';

interface MarkdownConverterOptions {
  source: string;
  maxSyntaxNodes: number;
  budget: ParseWorkBudget;
  markdownBreaks: boolean;
  isInlineName: (name: string) => boolean;
  sourceContext: SourceContext;
  work: ParserWork;
  parseMarkdown: ParseMarkdown;
  readNodeCount: () => number;
  fastPlans: Set<FastMarkdownPlan>;
  node: CreateNode;
  reservedMarkers: Set<string>;
  sourceBomOffset: number;
  rootMarkdown: any;
  error: ParseDiagnostic;
}

export function createMarkdownConverter({
  source, maxSyntaxNodes, budget, markdownBreaks, isInlineName, sourceContext,
  work, parseMarkdown, readNodeCount, fastPlans, node, reservedMarkers,
  sourceBomOffset, rootMarkdown, error,
}: MarkdownConverterOptions) {
  let markerSerial = 0;

  function convert(start: number, end: number, tokens: Token[], indent = 0, options: ConvertOptions = {}): LocalNode[] {
    if (end > start) budget.charge(end - start, start, end);
    let masked = '', cursor = start;
    let hasProse = false;
    // With no replacements or dedenting, the shielding pass already parsed
    // exactly this source. Its positions only need the original BOM offset.
    const reuseRoot = start === 0 && end === source.length && tokens.length === 0
      && indent === 0 && !options.stripBlockquote && !options.literalHtml
      && !rootMarkdown?.children.some((child:any)=>child.plan?.shieldOnly);
    const mapped = new MappedSource(sourceContext);
    const sourceAt = (offset: number, fallback: number): number =>
      reuseRoot ? offset + sourceBomOffset : mapped.at(offset, fallback);
    const markers = new Map<number, { marker: string; end: number; node: LocalNode }>();
    const emphasisBoundaries = new Set<number>();
    function appendEmphasisBoundary(at: number) {
      emphasisBoundaries.add(mapped.length);
      append(MARK_BOUNDARY, at, false);
    }
    function append(text: string, from: number, linear: boolean) {
      // Remove a file BOM before calculating generated marker indices. remark
      // ignores it, while this mapping retains original source coordinates.
      if(linear) {
        if(text.trim().length)hasProse=true;
        mapped.original(from,from+text.length,indent,options.stripBlockquote,true);
      }
      else mapped.generated(text,from);
    }
    let tree: any;
    if (reuseRoot) {
      masked = source.slice(sourceBomOffset);
      tree = rootMarkdown;
      rootMarkdown = undefined;
    } else {
      if (start === 0 && end === source.length) rootMarkdown = undefined;
      for (const token of tokens) {
        append(source.slice(cursor, token.start), cursor, true);
        let marker: string;
        do { marker = MARK_OPEN + markerSerial++ + MARK_CLOSE; } while (reservedMarkers.has(marker));
        const block = token.block ?? (token.node.type === 'math' || ((token.node.type === 'component' || token.node.type === 'hostComponent') && !isInlineName(token.node.name!)));
        if (block) append('\n\n', token.start, false);
        // An interpolation is a value, so adjacent emphasis delimiters must see
        // a non-punctuation boundary. The image surrogate's `!` and `)` would
        // otherwise prevent intraword emphasis such as 中文**{{ value }}**中文.
        const interpolation = token.node.type === 'interpolation';
        if (interpolation && /[*_]/.test(source[token.start - 1] ?? '')) appendEmphasisBoundary(token.start);
        const markerStart = mapped.length;
        // A generated Markdown image has its own source range. Restore only this
        // exact range; entity decoding and adjacent code cannot forge a node.
        append(`![${marker}](rmd-internal:placeholder)`, token.start, false);
        markers.set(markerStart, { marker, end: mapped.length, node: token.node });
        if (interpolation && /[*_]/.test(source[token.end] ?? '')) appendEmphasisBoundary(token.end);
        if (block) append('\n\n', token.end, false);
        cursor = token.end;
      }
      append(source.slice(cursor, end), cursor, true); mapped.finish(end);
      masked = mapped.text();
      work.mappingSegments+=mapped.segmentCount;
      // A document containing only opaque lexical tokens and whitespace has
      // no simple Markdown block to discover. Avoid building an advisory tree
      // for thousands of generated control placeholders.
      const placeholders=new Map([...markers].filter(([,slot])=>slot.node.type==='interpolation'));
      tree = parseMarkdown(masked,hasProse,{allowBraces:true,...(placeholders.size?{placeholders}:{})});
    }
    function unescapeTablePipes(nodes: LocalNode[]) {
      for (const child of nodes) {
        if (child.type === 'interpolation' && child.value !== undefined) child.value = child.value.replace(/\\\|/g, '|');
        if (child.children) unescapeTablePipes(child.children);
      }
    }
    /**
     * Split one remark text node at source soft breaks when the host asked for
     * `<br>`-style breaks. Only line endings that exist both in the parsed value
     * and in the masked source are converted, so decoded entities and escaped
     * text keep their literal newlines. The source string is never rewritten:
     * every produced node keeps the offsets of the slice it came from.
     */
    function textNodes(raw: any, from: number, to: number): LocalNode[] {
      const value: unknown = raw.value;
      if (typeof value !== 'string' || !value) return [];
      if (!markdownBreaks || !/[\r\n]/.test(value)) return [node('text', from, to, { value })];
      const rawStart = raw.position?.start?.offset;
      const rawEnd = raw.position?.end?.offset;
      if (!Number.isInteger(rawStart) || !Number.isInteger(rawEnd)
        || rawStart < 0 || rawEnd <= rawStart || rawEnd > masked.length) {
        return [node('text', from, to, { value })];
      }
      /**
       * The next line of a text node can be preceded by container syntax that
       * the Markdown parser consumed (`>`, list indentation). Start the segment
       * at its first value character when that character is found close by;
       * otherwise keep the original offset instead of guessing.
       */
      const segmentSource = (after: number, first: string | undefined): number => {
        if (first === undefined) return after;
        let index = after;
        for (let skipped = 0; index < source.length && skipped < 32; skipped += 1) {
          const character = source[index];
          if (character !== ' ' && character !== '\t' && character !== '>') break;
          index += 1;
        }
        return index < source.length && source[index] === first ? index : after;
      };
      // Masked-source line endings, in order. CRLF counts as one break.
      const newlines: { start: number; end: number; literal?: boolean }[] = [];
      for (let index = rawStart; index < rawEnd; index += 1) {
        // Escaped ampersands stay literal; character references can decode to
        // newline characters without representing source soft breaks.
        if (masked[index] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(masked[index + 1] ?? '')) {
          index += 1;
          continue;
        }
        if (masked[index] === '&') {
          const entity = /^&(?:#(?:[xX][\da-fA-F]{1,6}|\d{1,7})|NewLine);/.exec(masked.slice(index, Math.min(rawEnd, index + 34)))?.[0];
          if (entity) {
            const decoded = entity === '&NewLine;' ? 10 : entity[2].toLowerCase() === 'x'
              ? Number.parseInt(entity.slice(3, -1), 16) : Number.parseInt(entity.slice(2, -1), 10);
            if (decoded === 10 || decoded === 13) newlines.push({ start: index, end: index + entity.length, literal: true });
            index += entity.length - 1;
            continue;
          }
        }
        if (masked[index] === '\r') {
          const end = index + 1 < rawEnd && masked[index + 1] === '\n' ? index + 2 : index + 1;
          newlines.push({ start: index, end });
          index = end - 1;
        } else if (masked[index] === '\n') {
          newlines.push({ start: index, end: index + 1 });
        }
      }
      if (!newlines.length) return [node('text', from, to, { value })];
      const result: LocalNode[] = [];
      let segmentValue = 0;
      let sourceStart = from;
      let next = 0;
      for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character !== '\n' && character !== '\r') continue;
        // Some parsers retain CRLF inside text values; treat it as one break.
        const lineEnding = newlines[next];
        if (lineEnding === undefined) break;
        next += 1;
        const valueEnd = !lineEnding.literal && character === '\r' && value[index + 1] === '\n' ? index + 2 : index + 1;
        if (lineEnding.literal) continue;
        const breakStart = sourceAt(lineEnding.start, sourceStart);
        const breakEnd = breakStart + (lineEnding.end - lineEnding.start);
        if (index > segmentValue) {
          result.push(node('text', sourceStart, breakStart, { value: value.slice(segmentValue, index) }));
        }
        result.push(node('break', breakStart, breakEnd));
        segmentValue = valueEnd;
        sourceStart = segmentSource(sourceAt(lineEnding.end, breakEnd), value[valueEnd]);
        index = valueEnd - 1;
      }
      if (segmentValue < value.length) {
        result.push(node('text', sourceStart, to, { value: value.slice(segmentValue) }));
      }
      return result;
    }
    /**
     * remark derives an image alt from its label text, so lexical tokens in the
     * label leave their generated surrogate (and emphasis guards) in the alt.
     * Restore each parser-owned marker to the token's original source text;
     * literal source markers are reserved and never match a generated slot.
     */
    let markerSlots: Map<string, { node: LocalNode }> | undefined;
    function restoreAlt(alt: string): string {
      if (alt.indexOf(MARK_OPEN) < 0) return alt;
      markerSlots ??= new Map([...markers.values()].map(slot => [slot.marker, slot]));
      return alt.replace(new RegExp(`${MARK_BOUNDARY}?(${MARK_OPEN}[0-9]+${MARK_CLOSE})${MARK_BOUNDARY}?`, 'g'), (whole, marker: string) => {
        const slot = markerSlots!.get(marker);
        return slot ? source.slice(slot.node.range.start, slot.node.range.end) : whole;
      });
    }
    function transform(raw: any, children?: LocalNode[]): LocalNode[] {
      const from = sourceAt(raw.position?.start?.offset ?? 0, start);
      const to = sourceAt(raw.position?.end?.offset ?? masked.length, end);
      if(raw.type==='rmdFastBlock') {
        const plan=raw.plan as FastMarkdownPlan,base=raw.position.start.offset;
        // Reuse hints are consumed per parse and never mutate the plan.
        fastPlans.add(plan);
        const overflow=plan.overflowAt(maxSyntaxNodes-readNodeCount());
        if(overflow)throw new LocalBudgetError('local.budget',`Syntax nodes exceed the limit of ${maxSyntaxNodes}.`,sourceAt(base+overflow.start,from),sourceAt(base+overflow.end,to),'local.budget.nodes',{limit:maxSyntaxNodes});
        const emitted=plan.emit((type,begin,finish,extra)=>{
          if(type==='rmdOpaque'){
            const slot=markers.get(base+begin);
            if(!slot||slot.node.type!=='interpolation'||slot.end!==base+finish||slot.marker!==extra?.value)throw new Error('Invalid interpolation placeholder');
            markers.delete(base+begin);return slot.node;
          }
          return node(type,sourceAt(base+begin,from),sourceAt(base+finish,to),extra);
        });
        // 与 remark 路径一致：表格单元格内插值的 `\|` 还原为 `|`。
        for(const block of emitted)if(block.type==='table'&&block.children)unescapeTablePipes(block.children);
        return emitted;
      }
      if (raw.type === 'image') {
        const slot = markers.get(raw.position?.start?.offset);
        if (slot && raw.position.end.offset === slot.end
          && raw.url === 'rmd-internal:placeholder' && raw.alt === slot.marker) {
          markers.delete(raw.position.start.offset);
          return slot.node.type === 'comment' ? [] : [slot.node];
        }
      }
      if (raw.type === 'text') {
        // Boundary guards are always at text-node edges beside the generated
        // image. Remove only guards at parser-owned offsets; identical literal
        // or entity-decoded characters in the source remain ordinary text.
        let begin = raw.position.start.offset, finish = raw.position.end.offset;
        let value = raw.value as string;
        while (begin < finish && emphasisBoundaries.has(begin)) { begin++; value = value.slice(1); }
        while (finish > begin && emphasisBoundaries.has(finish - 1)) { finish--; value = value.slice(0, -1); }
        if (begin !== raw.position.start.offset || finish !== raw.position.end.offset) {
          raw = { ...raw, value, position: { start: { offset: begin }, end: { offset: finish } } };
          return textNodes(raw, sourceAt(begin, from), sourceAt(finish, to));
        }
        return textNodes(raw, from, to);
      }
      // Footnote nodes normally arrive through lexical tokens. This branch only
      // covers a remark-parsed node (hand-built Markdown fragments); it keeps
      // the original identifier/label instead of degrading to source text.
      if (raw.type === 'footnoteReference' || raw.type === 'footnoteDefinition') {
        const label = typeof raw.label === 'string' && raw.label ? raw.label : String(raw.identifier ?? '');
        const identifier = normalizeFootnoteIdentifier(String(raw.identifier ?? label));
        if (raw.type === 'footnoteDefinition') {
          return [node('footnoteDefinition', from, to, { identifier, label, children: children ?? [] })];
        }
        return [node('footnoteReference', from, to, { identifier, label })];
      }
      if (raw.type === 'paragraph' && children?.length === 1 && (children[0].type === 'math' || children[0].type === 'fallback' || children[0].type === 'footnoteDefinition' || BLOCK_HTML_RESULTS.has(children[0].type) || ((children[0].type === 'component' || children[0].type === 'hostComponent') && !isInlineName(children[0].name!)))) return children;
      if (raw.type === 'paragraph' && !children?.length) return [];
      if (raw.type === 'html') {
        if (options.literalHtml) {
          // Footnote bodies show controls, interpolation and stray HTML as text,
          // so a malformed tag can never fail the surrounding document.
          return typeof raw.value === 'string' && raw.value
            ? [node('text', from, to, { value: raw.value })]
            : [];
        }
        error('local.html', { key: 'local.html' }, from, to);
        return [];
      }
      const result = node(raw.type, from, to);
      for (const key of ['value', 'depth', 'ordered', 'start', 'checked', 'url', 'title', 'alt', 'lang', 'align'] as const) if (raw[key] !== undefined) (result as any)[key] = raw[key];
      if (typeof result.alt === 'string') result.alt = restoreAlt(result.alt);
      if (children) result.children = children;
      if (raw.type === 'table' && result.children) unescapeTablePipes(result.children);
      return [result];
    }
    // Preserve postorder node allocation without consuming the JavaScript
    // call stack for each Markdown container and its flatMap callback.
    const frames: { raw: any; index: number; children?: LocalNode[] }[] = [
      { raw: tree, index: 0, children: [] },
    ];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      if (frame.raw.children && frame.index < frame.raw.children.length) {
        const raw = frame.raw.children[frame.index++];
        frames.push({ raw, index: 0, children: raw.children ? [] : undefined });
        continue;
      }
      frames.pop();
      if (!frames.length) return frame.children ?? [];
      const output = transform(frame.raw, frame.children);
      for (const child of output) frames[frames.length - 1].children!.push(child);
    }
    return [];
  }

  return convert;
}
