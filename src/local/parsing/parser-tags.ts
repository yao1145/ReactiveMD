import type { NormalizedComponent } from '../compilation/component-kernel';
import type { LocalParserHtmlCapability } from './parser-capabilities';
import { SourceContext } from '../source/source-context';
import {
  HTML_NAMES,
  type ConvertOptions,
  type CreateNode,
  type ParseDiagnostic,
  type RegionOptions,
  type RegionResult,
  type Token,
} from './parser-internals';
import type { LocalNode } from '../types';
import {
  HTML_INLINE_NODE_TYPES,
  HTML_RAW_TEXT_ELEMENTS,
  HTML_VOID_ELEMENTS,
  htmlAlignValue,
  htmlCommentEnd,
  htmlTagEnd,
  isHtmlAttributeNameAllowed,
  isValidHtmlAttributeValue,
} from '../html/html-policy';
import { normalizeFootnoteIdentifier } from './footnotes';
import { HTML_TABLE_NAMES } from '../html/html-table-names';
import { scanHtmlAttributes } from './html-attributes';
import { LOCAL_HTML_ALIGN_ELEMENTS } from '../html/html-names';
import { normalizeHtmlDetailsChildren } from '../html/html-details';
import { scanInterpolationEnd } from './lexical';

interface HtmlNodeContext {
  footnote: boolean;
  container: boolean;
  indent: number;
  stripBlockquote: boolean;
  depth: number;
}

interface TagScannerOptions {
  source: string;
  strict: boolean;
  known: ReadonlyMap<string, NormalizedComponent>;
  htmlSupport?: LocalParserHtmlCapability;
  decodeEntities: (value: string) => string;
  decodeAttribute: (value: string) => string;
  sourceContext: SourceContext;
  node: CreateNode;
  codeEndAt: (offset: number) => number | null;
  error: ParseDiagnostic;
  region: (start: number, end: number, parent?: string, openStart?: number, openEnd?: number, depth?: number, options?: RegionOptions) => RegionResult;
  convert: (start: number, end: number, tokens: Token[], indent?: number, options?: ConvertOptions) => LocalNode[];
}

export function createTagScanner({
  source, strict, known, htmlSupport, decodeEntities, decodeAttribute, sourceContext,
  node, codeEndAt, error, region, convert,
}: TagScannerOptions) {
  function decode(value: string) {
    return value.replace(/&(quot|apos|amp|lt|gt);/g, (_, key: string) => ({ quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' })[key]!);
  }
  function attributes(raw: string, offset: number): Record<string, string> {
    const attrs: Record<string, string> = Object.create(null);
    let i = 0;
    while (i < raw.length) {
      while (i < raw.length && /\s/.test(raw[i])) i++;
      if (i >= raw.length || raw[i] === '/') break;
      const start = i;
      const match = /^[A-Za-z][A-Za-z0-9_-]*/.exec(raw.slice(i));
      if (!match) {
        error('local.attribute', { key: 'local.attribute.format' }, offset + i, undefined);
        while (i < raw.length && !/\s/.test(raw[i])) i++;
        continue;
      }
      const name = match[0]; i += name.length;
      if (name.length > MAX_LOCAL_NAME_LENGTH) {
        error('local.budget.name', { key: 'local.budget.name.attribute', params: { limit: MAX_LOCAL_NAME_LENGTH } }, offset + start, offset + i);
      } else if (!ATTR_NAME.test(name)) {
        error('local.attribute.name', { key: 'local.attribute.name', params: { name } }, offset + start, offset + i);
      }
      while (i < raw.length && /\s/.test(raw[i])) i++;
      let value = 'true';
      if (raw[i] === '=') {
        i++; while (i < raw.length && /\s/.test(raw[i])) i++;
        const quote = raw[i++];
        if (quote !== '"' && quote !== "'") { error('local.attribute', { key: 'local.attribute.value-quoted', params: { name } }, offset + Math.max(0, i - 1), undefined); break; }
        const end = raw.indexOf(quote, i);
        if (end < 0) { error('local.attribute', { key: 'local.attribute.closing-quote', params: { name } }, offset + Math.max(0, i - 1), undefined); break; }
        value = decode(raw.slice(i, end)); i = end + 1;
      }
      if (Object.hasOwn(attrs, name)) error('local.attribute.duplicate', { key: 'local.attribute.duplicate', params: { name } }, offset + start, offset + i);
      else attrs[name] = value;
      if (i < raw.length && !/\s|\//.test(raw[i])) { error('local.attribute', { key: 'local.attribute.separator' }, offset + i, undefined); break; }
    }
    return attrs;
  }
  function tagAt(start: number, limit: number) {
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/.exec(source.slice(start, limit));
    if (!match) return null;
    const head = start + match[0].length;
    // A prose fragment such as `<y` must never borrow a `>` from a later
    // line. Unknown names followed by whitespace are therefore line-bounded;
    // known containers keep their documented multi-line attribute syntax.
    let scanLimit = limit;
    const boundary = source[head];
    if ((boundary === ' ' || boundary === '\t' || boundary === '\n' || boundary === '\r')
      && !known.has(match[2].toLowerCase()) && !beginsLine(start)) {
      const newline = source.indexOf('\n', head);
      if (newline >= 0) scanLimit = Math.min(limit, newline);
    }
    const close = htmlTagEnd(source, head, scanLimit);
    const name = match[2];
    if (close < 0) return { name, closing: !!match[1], self: false, start, end: scanLimit, attrs: {}, head, unclosed: true };
    const end = close - 1;
    if (name.length > MAX_LOCAL_NAME_LENGTH) {
      error('local.budget.name', { key: 'local.budget.name.tag', params: { limit: MAX_LOCAL_NAME_LENGTH } }, start, start + 1 + name.length);
    }
    const rest = source.slice(head, end);
    if (match[1]) {
      if (rest.trim()) error('local.tag.closing', { key: 'local.tag.closing', params: { name } }, start, close);
      return { name, closing: true, self: false, start, end: close, attrs: {}, head, unclosed: false };
    }
    return { name, closing: false, self: /\/\s*$/.test(rest), start, end: close, attrs: known.has(name.toLowerCase()) ? attributes(rest, head) : {}, head, unclosed: false };
  }
  /**
   * Silent tag boundary reader used for unknown components. Their attributes
   * are inert, so they must never reach `attributes()` or emit diagnostics.
   */
  function scanTag(start: number, limit: number) {
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/.exec(source.slice(start, limit));
    if (!match) return null;
    const head = start + match[0].length;
    let scanLimit = limit;
    const boundary = source[head];
    if ((boundary === ' ' || boundary === '\t' || boundary === '\n' || boundary === '\r')
      && !known.has(match[2].toLowerCase()) && !beginsLine(start)) {
      const newline = source.indexOf('\n', head);
      if (newline >= 0) scanLimit = Math.min(limit, newline);
    }
    const close = htmlTagEnd(source, head, scanLimit);
    if (close < 0) return null;
    const rest = source.slice(head, close - 1);
    return { name: match[2], closing: !!match[1], self: !match[1] && /\/\s*$/.test(rest), end: close };
  }
  /** Keep an unclosed HTML fragment local to its paragraph. */
  function htmlLiteralEnd(start: number, limit: number, parent?: string, rawName?: string): number {
    if (!strict && rawName && HTML_RAW_TEXT_ELEMENTS.has(rawName.toLowerCase())) return limit;
    const boundary = /\r?\n[\t ]*\r?\n/.exec(source.slice(start, limit));
    let stop = boundary ? start + boundary.index : limit;
    if (parent) {
      const closing = new RegExp(`</${parent}\\s*>`, 'g');
      closing.lastIndex = start;
      const match = closing.exec(source);
      if (match && match.index < stop) stop = match.index;
    }
    return stop;
  }
  function beginsLine(offset: number): boolean {
    const lineStart = sourceContext.lineStartAt(offset);
    return /^[ \t]*$/.test(source.slice(lineStart, offset));
  }
  /** Label and normalized identifier of `[^label]` at `start`, if present. */
  function footnoteLabelAt(start: number, limit: number): { label: string; identifier: string; openEnd: number; closeEnd: number } | null {
    if (source[start] !== '[' || source[start + 1] !== '^') return null;
    let close = start + 2;
    const stop = Math.min(limit, start + 2 + MAX_FOOTNOTE_LABEL_LENGTH);
    for (; close < stop; close++) {
      const character = source[close];
      if (character === '\\' && /[!-/:-@\[\]\\^_`{|}~]/.test(source[close + 1] ?? '')) { close += 1; continue; }
      if (character === ']') break;
      if (character === '[' || character === '\n' || character === '\r') return null;
    }
    if (close >= stop || source[close] !== ']') return null;
    const label = source.slice(start + 2, close);
    if (!label.trim()) return null;
    const identifier = normalizeFootnoteIdentifier(label);
    return identifier ? { label, identifier, openEnd: start + 2, closeEnd: close + 1 } : null;
  }
  /** A definition marker `[^label]:` at `start`; positions are source offsets. */
  function definitionLabelAt(start: number): { label: string; identifier: string; bodyStart: number } | null {
    const found = footnoteLabelAt(start, source.length);
    if (!found || source[found.closeEnd] !== ':') return null;
    return { label: found.label, identifier: found.identifier, bodyStart: found.closeEnd + 1 };
  }
  /** Basic HTML tag shape (name only); attributes are validated by the caller. */
  function htmlTagAt(start: number, limit: number, tableContext = false) {
    if (htmlSupport === undefined) return null;
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/.exec(source.slice(start, Math.min(limit, start + 64)));
    if (!match) return null;
    const lower = match[2].toLowerCase();
    if (!HTML_NAMES.has(lower) && !(tableContext && HTML_TABLE_NAMES.has(lower))) return null;
    const head = start + match[0].length;
    const close = htmlTagEnd(source, head, limit);
    if (close < 0) return null;
    const end = close - 1;
    const rest = source.slice(head, end);
    const closing = Boolean(match[1]);
    const scan = closing ? { attrs: Object.create(null), entries: [], invalid: [] } : scanHtmlAttributes(rest, head, decodeAttribute);
    return {
      lower,
      closing,
      self: !closing && /\/\s*$/.test(rest),
      rest,
      attrs: scan.attrs,
      entries: scan.entries,
      invalid: scan.invalid,
      start,
      head,
      end: end + 1,
    };
  }
  /** Matching close of a paired basic HTML tag, nesting same-name tags. */
  function htmlCloseEnd(start: number, name: string, limit: number, insideContainer: boolean): { start: number; end: number } | null {
    let depth = 1;
    for (let i = start; i < limit;) {
      if (!insideContainer) {
        const codeEnd = codeEndAt(i);
        if (codeEnd !== null && codeEnd > i) { i = Math.min(codeEnd, limit); continue; }
      }
      const shield = protectedEnd(i, limit, insideContainer);
      if (shield !== null) { i = shield; continue; }
      if (source.startsWith('<!--', i)) {
        i = htmlCommentEnd(source, i, limit);
        continue;
      }
      if (source[i] === '<') {
        const tag = htmlTagAt(i, limit);
        if (tag) {
          if (tag.lower === name) {
            if (tag.closing) {
              depth -= 1;
              if (depth === 0) return { start: i, end: tag.end };
            } else if (!tag.self && !HTML_VOID_ELEMENTS.has(name)) {
              depth += 1;
            }
          } else if (!tag.closing && (tag.lower === 'pre' || tag.lower === 'code') && !HTML_VOID_ELEMENTS.has(tag.lower)) {
            // Raw code content is inert: tags inside it never change the
            // nesting of the surrounding HTML container.
            const inner = htmlCloseEnd(tag.end, tag.lower, limit, insideContainer);
            if (inner) { i = inner.end; continue; }
          }
          i = tag.end;
          continue;
        }
      }
      i++;
    }
    return null;
  }
  /** P0 attribute policy. Any unsupported name or unsafe value degrades the whole tag to source. */
  function selectHtmlAttributes(lower: string, tag: ReturnType<typeof htmlTagAt> & {}): { ok: true; attrs: Record<string, string> } | { ok: false; attr: string } {
    if (!tag) return { ok: false, attr: '' };
    const attrs: Record<string, string> = Object.create(null);
    if (tag.invalid.length) return { ok: false, attr: tag.invalid[0].name };
    for (const entry of tag.entries) {
      const name = entry.name;
      if (!isHtmlAttributeNameAllowed(lower, name)) return { ok: false, attr: name };
      // Duplicates are still validated, but the first occurrence wins as in HTML.
      const first = !Object.hasOwn(attrs, name);
      if (name === 'align' && LOCAL_HTML_ALIGN_ELEMENTS.has(lower)) {
        const align = htmlAlignValue(lower, entry.value);
        if (!align) return { ok: false, attr: name };
        if (first) attrs.align = align;
        continue;
      }
      if (!isValidHtmlAttributeValue(name, entry.value)) return { ok: false, attr: name };
      if (first) attrs[name] = entry.value;
    }
    if (lower === 'details' && Object.hasOwn(attrs, 'open')) attrs.open = 'true';
    return { ok: true, attrs };
  }
  /** Inline children of an HTML formatting element, unwrapping one paragraph. */
  function inlineHtmlChildren(nodes: LocalNode[]): LocalNode[] {
    return nodes.length === 1 && nodes[0].type === 'paragraph' ? nodes[0].children ?? [] : nodes;
  }
  function flattenParagraphs(nodes: LocalNode[]): LocalNode[] {
    return nodes.flatMap((child) => (child.type === 'paragraph' ? child.children ?? [] : [child]));
  }
  /**
   * Convert one P0 HTML element. Paired containers keep every Markdown,
   * formula, interpolation and ReactiveMD token their body produced; `<code>`
   * and `<pre>` stay raw and inert, and details/summary keep rich children.
   */
  function buildHtmlNode(
    tag: { lower: string; start: number; head: number; end: number },
    close: { start: number; end: number },
    attrs: Record<string, string>,
    context: HtmlNodeContext,
  ): LocalNode {
    const start = tag.start;
    const end = close.end;
    const bodyNodes = (): LocalNode[] => {
      const body = region(tag.end, close.start, undefined, start, tag.end, context.depth + 1, {
        footnote: context.footnote,
        indent: context.indent,
        container: context.container,
        definitions: [],
        stripBlockquote: context.stripBlockquote,
      });
      return convert(tag.end, close.start, body.tokens, context.indent, {
        literalHtml: context.footnote,
        stripBlockquote: context.stripBlockquote,
      });
    };
    const inline = (): LocalNode[] => inlineHtmlChildren(bodyNodes());
    const listItems = (nodes: LocalNode[]): LocalNode[] => {
      const items: LocalNode[] = [];
      for (const child of nodes) {
        if (child.type === 'list') {
          for (const item of child.children ?? []) if (item.type === 'listItem') items.push(item);
          continue;
        }
        if (child.type === 'listItem') {
          items.push(child);
          continue;
        }
        if (child.type === 'comment' || (child.type === 'text' && !(child.value ?? '').trim())) continue;
        items.push(node('listItem', child.range.start, child.range.end, {
          children: child.type === 'paragraph' ? child.children ?? [] : [child],
        }));
      }
      return items;
    };

    switch (tag.lower) {
      case 'code': {
        // Raw content: `{{ }}`, Markdown and tags stay literal; entities decode.
        return node('inlineCode', start, end, { value: decodeEntities(source.slice(tag.end, close.start)) });
      }
      case 'pre': {
        const raw = source.slice(tag.end, close.start);
        const wrapped = /^<code(?:\s[^>]*)?>([\s\S]*)<\/code>$/.exec(raw);
        return node('code', start, end, {
          value: decodeEntities(wrapped ? wrapped[1] : raw),
          attrs,
        });
      }
      case 'summary':
        return node('summary', start, end, { attrs, children: inline() });
      case 'details': {
        return node('details', start, end, {
          attrs,
          children: normalizeHtmlDetailsChildren(bodyNodes()),
        });
      }
      case 'p':
        return node('paragraph', start, end, { attrs, children: flattenParagraphs(bodyNodes()) });
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return node('heading', start, end, {
          depth: Number(tag.lower.slice(1)),
          attrs,
          children: flattenParagraphs(bodyNodes()),
        });
      case 'div':
        return node('div', start, end, { attrs, children: bodyNodes() });
      case 'blockquote':
        return node('blockquote', start, end, { attrs, children: bodyNodes() });
      case 'ul':
      case 'ol': {
        const ordered = tag.lower === 'ol';
        const rawStart = attrs.start;
        const startNumber = ordered && rawStart !== undefined ? Number(rawStart) : undefined;
        return node('list', start, end, {
          ordered,
          ...(ordered && startNumber !== undefined && Number.isFinite(startNumber) ? { start: startNumber } : {}),
          attrs,
          children: listItems(bodyNodes()),
        });
      }
      case 'li': {
        const nodes = bodyNodes();
        return node('listItem', start, end, {
          attrs,
          children: nodes.length === 1 && nodes[0].type === 'paragraph'
            ? nodes[0].children ?? []
            : nodes,
        });
      }
      case 'a': {
        if (attrs.href === undefined) {
          return node('span', start, end, { attrs, children: inline() });
        }
        return node('link', start, end, {
          url: attrs.href,
          title: attrs.title ?? null,
          attrs,
          children: inline(),
        });
      }
      case 'span':
        return node('span', start, end, { attrs, children: inline() });
      default:
        return node(HTML_INLINE_NODE_TYPES[tag.lower] ?? tag.lower, start, end, {
          attrs,
          children: inline(),
        });
    }
  }
  const ROOT_FENCE_LINE = /^ {0,3}$/;
  const CONTAINER_FENCE_LINE = /^[ \t]*$/;
  function protectedEnd(i: number, end: number, insideContainer: boolean): number | null {
    const character = source[i];
    if (character === '\\') return Math.min(end, i + 2);
    if (character !== '`' && character !== '~') return null;
    // Recognize fenced code at a Markdown line boundary, including container indentation.
    const lineStart = sourceContext.lineStartAt(i);
    if ((insideContainer ? CONTAINER_FENCE_LINE : ROOT_FENCE_LINE).test(source.slice(lineStart, i))) {
      // CommonMark: a backtick fence's info string cannot contain a backtick;
      // such a line is ordinary paragraph text (a code span at most).
      const fence = /^(?:(`{3,})[^`\n]*|(~{3,})[^\n]*)(?:\n|$)/.exec(source.slice(i, end));
      if (fence) {
        const run = fence[1] ?? fence[2];
        const prefix = insideContainer ? '[ \\t]*' : ' {0,3}';
        const close = new RegExp(`^${prefix}${run[0]}{${run.length},}[ \\t]*\\r?$`, 'gm');
        close.lastIndex = i + fence[0].length;
        const match = close.exec(source);
        return match && match.index < end ? Math.min(end, match.index + match[0].length) : end;
      }
    }
    if (character === '`') {
      const ticks = /^`+/.exec(source.slice(i, end))![0];
      let next = source.indexOf(ticks, i + ticks.length);
      while (next >= 0 && next < end) {
        if (source[next - 1] !== '`' && source[next + ticks.length] !== '`') return next + ticks.length;
        next = source.indexOf(ticks, next + ticks.length);
      }
      return i + ticks.length;
    }
    return null;
  }
  /**
   * Find the matching close of an unknown paired tag. Only the tag's own name
   * changes depth; nested unknowns, attributes, comments, code and escapes are
   * opaque, so malformed content inside cannot produce document-wide errors.
   */
  function unknownTagEnd(start: number, name: string, limit: number, insideContainer: boolean, ignoreCase = false): { start: number; end: number } | null {
    let depth = 1;
    for (let i = start; i < limit;) {
      if (!insideContainer) {
        const codeEnd = codeEndAt(i);
        if (codeEnd !== null && codeEnd > i) { i = Math.min(codeEnd, limit); continue; }
      }
      const shield = protectedEnd(i, limit, insideContainer);
      if (shield !== null) { i = shield; continue; }
      if (source.startsWith('<!--', i)) {
        i = htmlCommentEnd(source, i, limit);
        continue;
      }
      if (source[i] === '<') {
        const tag = scanTag(i, limit);
        if (tag) {
          if (tag.name === name || (ignoreCase && tag.name.toLowerCase() === name.toLowerCase())) {
            if (tag.closing) {
              depth -= 1;
              if (depth === 0) return { start: i, end: tag.end };
            } else if (!tag.self) {
              depth += 1;
            }
          }
          i = tag.end;
          continue;
        }
      }
      i++;
    }
    return null;
  }
  function interpolationEnd(start: number, end: number) {
    return scanInterpolationEnd(source, start, end);
  }
  /**
   * Common leading indentation of the lines owned by a container. Fenced code
   * content is ignored so an unindented code sample does not cancel dedenting.
   */
  function commonIndent(start: number, end: number): number {
    let indent = Number.POSITIVE_INFINITY;
    let fenceChar = '', fenceLength = 0;
    let pos = start;
    while (pos < end) {
      const lineEnd = source.indexOf('\n', pos);
      const stop = lineEnd < 0 || lineEnd > end ? end : lineEnd;
      const text = source.slice(pos, stop);
      const atLineStart = sourceContext.lineStartAt(pos) === pos;
      if (atLineStart) {
        if (fenceChar) {
          if (new RegExp(`^[ \\t]*${fenceChar}{${fenceLength},}[ \\t]*\\r?$`).test(text)) fenceChar = '';
        } else {
          const open = /^([ \t]*)(`{3,}(?=[^`]*$)|~{3,})/.exec(text);
          if (open) {
            indent = Math.min(indent, open[1].length);
            fenceChar = open[2][0]; fenceLength = open[2].length;
          } else if (text.trim() !== '') {
            indent = Math.min(indent, /^[ \t]*/.exec(text)![0].length);
          }
        }
      }
      if (stop >= end) break;
      pos = stop + 1;
    }
    return Number.isFinite(indent) ? indent : 0;
  }
  return {
    tagAt, scanTag, htmlLiteralEnd, beginsLine, footnoteLabelAt, definitionLabelAt,
    htmlTagAt, htmlCloseEnd, selectHtmlAttributes, buildHtmlNode, protectedEnd,
    unknownTagEnd, interpolationEnd, commonIndent,
  };
}

const TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const ATTR_NAME = TAG_NAME;

const MAX_LOCAL_NAME_LENGTH = 128;

const MAX_FOOTNOTE_LABEL_LENGTH = 1_000;
