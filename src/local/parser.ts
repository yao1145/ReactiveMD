import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Diagnostic } from './types';
import type { LocalCompileOptions, LocalNode } from './types';
import {
  DEFAULT_MAX_LOCAL_SYNTAX_NODES,
  MAX_LOCAL_DOCUMENT_LENGTH,
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_DIAGNOSTIC_LENGTH,
  MAX_LOCAL_STRING_LENGTH,
} from './limits';

const VOID = new Set('input textarea number slider toggle checkbox date counter timer progress edge'.split(' '));
const PAIRED = new Set('panel card grid tabs tab accordion disclosure if alert badge tooltip select choices radio-group checklist table chart plot timeline diagram node option'.split(' '));
const INLINE = new Set(['badge', 'tooltip']);
/** Private-use sentinels keep source tokens opaque while Markdown is parsed. */
const MARK_OPEN = String.fromCharCode(0xe000);
const MARK_CLOSE = String.fromCharCode(0xe001);
const TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ATTR_NAME = TAG_NAME;
/** Names longer than this are rejected and never fed to suggestion search. */
const MAX_LOCAL_NAME_LENGTH = 128;
/** Displayed math is parsed by the math view; keep its source comparable to math.ts. */
const MAX_DISPLAY_MATH_SOURCE = Math.min(50_000, MAX_LOCAL_STRING_LENGTH);
const markdown = unified().use(remarkParse).use(remarkGfm);
interface Token { start: number; end: number; node: LocalNode }
interface RegionResult { tokens: Token[]; end: number; contentEnd: number; indent: number }

class LocalBudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
    this.name = 'LocalBudgetError';
  }
}

function syntaxNodeLimit(options: LocalCompileOptions | undefined): number | string {
  if (options === undefined) return DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return '编译选项 options 必须是对象。';
  }
  const limits = options.limits;
  if (limits === undefined) return DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) {
    return '编译选项 limits 必须是对象。';
  }
  const value = limits.maxSyntaxNodes;
  if (value === undefined) return DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return '编译选项 limits.maxSyntaxNodes 必须是正的安全整数。';
  }
  return value;
}

/** A lexical pass shields code before recognizing local tags, interpolation and math. */
export function parseLocal(source: string, options?: LocalCompileOptions): { nodes: LocalNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    return { nodes: [], diagnostics: [{
      code: typeof source === 'string' ? 'local.budget' : 'local.parse',
      message: typeof source === 'string' ? `文档超过 ${MAX_LOCAL_DOCUMENT_LENGTH} 字符上限。` : '文档源码必须是字符串。',
      severity: 'error', range: { start: 0, end: typeof source === 'string' && source.length ? 1 : 0 }, line: 1, column: 1,
    }] };
  }
  const maxSyntaxNodes = syntaxNodeLimit(options);
  if (typeof maxSyntaxNodes === 'string') {
    return { nodes: [], diagnostics: [{
      code: 'local.options.invalid', message: maxSyntaxNodes, severity: 'error',
      range: { start: 0, end: 0 }, line: 1, column: 1,
    }] };
  }
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  let serial = 0;
  let nodeCount = 0;
  let markerSerial = 0;
  const reservedMarkers = new Set(source.match(new RegExp(MARK_OPEN + '[0-9]+' + MARK_CLOSE, 'g')) ?? []);
  const codeRanges: { start: number; end: number }[] = [];
  const findCode = (raw: any): void => {
    if (raw.type === 'code') codeRanges.push({ start: raw.position.start.offset, end: raw.position.end.offset });
    for (const child of raw.children ?? []) findCode(child);
  };
  try {
    findCode(markdown.parse(source));
  } catch {
    error('local.parse', '无法解析 Markdown 文档。', 0);
    return { nodes: [], diagnostics };
  }
  let codeIndex = 0;
  const node = (type: string, start: number, end: number, extra: Partial<LocalNode> = {}): LocalNode => {
    if (nodeCount >= maxSyntaxNodes) {
      throw new LocalBudgetError('local.budget', `语法节点超过 ${maxSyntaxNodes} 个上限。`, start, end);
    }
    nodeCount += 1;
    return { type, id: `local-${serial++}`, range: { start, end }, ...extra };
  };
  function error(code: string, message: string, start: number, end = start + 1) {
    if (diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) return;
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
      ? `${message.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
      : message;
    diagnostics.push({
      code,
      message: text,
      severity: 'error',
      range: { start: safeStart, end: safeEnd },
      line,
      column: safeStart - lineStarts[low] + 1,
    });
  }
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
        error('local.attribute', '属性名必须使用小写 kebab-case。', offset + i);
        while (i < raw.length && !/\s/.test(raw[i])) i++;
        continue;
      }
      const name = match[0]; i += name.length;
      if (name.length > MAX_LOCAL_NAME_LENGTH) {
        error('local.budget.name', `属性名超过 ${MAX_LOCAL_NAME_LENGTH} 字符上限。`, offset + start, offset + i);
      } else if (!ATTR_NAME.test(name)) {
        error('local.attribute.name', `属性名 ${name} 必须使用小写 kebab-case。`, offset + start, offset + i);
      }
      while (i < raw.length && /\s/.test(raw[i])) i++;
      let value = 'true';
      if (raw[i] === '=') {
        i++; while (i < raw.length && /\s/.test(raw[i])) i++;
        const quote = raw[i++];
        if (quote !== '"' && quote !== "'") { error('local.attribute', `属性 ${name} 的值需要引号。`, offset + Math.max(0, i - 1)); break; }
        const end = raw.indexOf(quote, i);
        if (end < 0) { error('local.attribute', `属性 ${name} 缺少结束引号。`, offset + Math.max(0, i - 1)); break; }
        value = decode(raw.slice(i, end)); i = end + 1;
      }
      if (Object.hasOwn(attrs, name)) error('local.attribute.duplicate', `属性 ${name} 重复。`, offset + start, offset + i);
      else attrs[name] = value;
      if (i < raw.length && !/\s|\//.test(raw[i])) { error('local.attribute', '属性之间需要空白。', offset + i); break; }
    }
    return attrs;
  }
  function tagAt(start: number, limit: number) {
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/.exec(source.slice(start, limit));
    if (!match) return null;
    let quote = '', end = start + match[0].length;
    for (; end < limit; end++) {
      const c = source[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end >= limit) { error('local.tag.unclosed', `标签 ${match[2]} 缺少 >。`, start, limit); return null; }
    const name = match[2];
    if (name.length > MAX_LOCAL_NAME_LENGTH) {
      error('local.budget.name', `标签名超过 ${MAX_LOCAL_NAME_LENGTH} 字符上限。`, start, start + 1 + name.length);
    }
    const rest = source.slice(start + match[0].length, end);
    if (match[1]) {
      if (rest.trim()) error('local.tag.closing', `结束标签 </${name}> 不能带属性。`, start, end + 1);
      return { name, closing: true, self: false, start, end: end + 1, attrs: {} };
    }
    if (!TAG_NAME.test(name)) error('local.tag.name', `标签名 ${name} 使用小写 kebab-case。`, start, start + 1 + name.length);
    return { name, closing: false, self: /\/\s*$/.test(rest), start, end: end + 1, attrs: attributes(rest, start + match[0].length) };
  }
  const ROOT_FENCE_LINE = /^ {0,3}$/;
  const CONTAINER_FENCE_LINE = /^[ \t]*$/;
  function protectedEnd(i: number, end: number, insideContainer: boolean): number | null {
    const character = source[i];
    if (character === '\\') return Math.min(end, i + 2);
    if (character !== '`' && character !== '~') return null;
    // Recognize fenced code at a Markdown line boundary, including container indentation.
    const lineStart = source.lastIndexOf('\n', i - 1) + 1;
    if ((insideContainer ? CONTAINER_FENCE_LINE : ROOT_FENCE_LINE).test(source.slice(lineStart, i))) {
      const fence = /^(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(i, end));
      if (fence) {
        const prefix = insideContainer ? '[ \\t]*' : ' {0,3}';
        const close = new RegExp(`^${prefix}${fence[1][0]}{${fence[1].length},}[ \\t]*\\r?$`, 'gm');
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
  function interpolationEnd(start: number, end: number) {
    let quote = '';
    for (let i = start + 2; i < end - 1; i++) {
      const c = source[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '}' && source[i + 1] === '}') return i + 2;
    }
    return -1;
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
      const atLineStart = source.lastIndexOf('\n', pos - 1) + 1 === pos;
      if (atLineStart) {
        if (fenceChar) {
          if (new RegExp(`^[ \\t]*${fenceChar}{${fenceLength},}[ \\t]*\\r?$`).test(text)) fenceChar = '';
        } else {
          const open = /^([ \t]*)(`{3,}|~{3,})/.exec(text);
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
  function region(start: number, end: number, parent?: string, openStart = start, openEnd = start, depth = 0): RegionResult {
    const tokens: Token[] = [];
    if (depth > 100) {
      error('local.budget', '组件嵌套超过 100 层上限。', openStart, openEnd);
      return { tokens, end, contentEnd: start, indent: 0 };
    }
    for (let i = start; i < end;) {
      if (parent === undefined) {
        while (codeRanges[codeIndex]?.end <= i) codeIndex++;
        const code = codeRanges[codeIndex];
        if (code && code.start <= i) { i = code.end; continue; }
      }
      const shield = protectedEnd(i, end, parent !== undefined);
      if (shield !== null) { i = shield; continue; }
      if (source.startsWith('<!--', i)) {
        const close = source.indexOf('-->', i + 4), stop = close < 0 ? end : Math.min(end, close + 3);
        tokens.push({ start: i, end: stop, node: node('comment', i, stop) }); i = stop; continue;
      }
      if (source.startsWith('{{', i)) {
        const stop = interpolationEnd(i, end);
        if (stop < 0) { error('local.interpolation', '插值缺少 }}。', i, end); i += 2; continue; }
        tokens.push({ start: i, end: stop, node: node('interpolation', i, stop, { value: source.slice(i + 2, stop - 2).trim() }) }); i = stop; continue;
      }
      if (source[i] === '$') {
        const display = source[i + 1] === '$', delimiter = display ? '$$' : '$';
        let stop = i + delimiter.length;
        for (; stop < end; stop++) {
          if (source[stop] === '\\') { stop++; continue; }
          if (!display && source[stop] === '\n') break;
          if (source.startsWith(delimiter, stop)) break;
        }
        if (stop >= end || !source.startsWith(delimiter, stop)) { error('local.math.unclosed', '数学公式缺少结束定界符。', i); i += delimiter.length; continue; }
        let value = source.slice(i + delimiter.length, stop);
        if (!display && (!value || /^\s|\s$/.test(value))) { error('local.math.whitespace', '行内数学内容首尾不能是空白。', i, stop + 1); }
        if (value.length > MAX_DISPLAY_MATH_SOURCE) {
          error('local.budget.math', `数学公式超过 ${MAX_DISPLAY_MATH_SOURCE} 字符上限。`, i, stop + delimiter.length);
          value = value.slice(0, MAX_DISPLAY_MATH_SOURCE);
        }
        const finish = stop + delimiter.length;
        tokens.push({ start: i, end: finish, node: node(display ? 'math' : 'inlineMath', i, finish, { value }) }); i = finish; continue;
      }
      if (source[i] === '<') {
        const tag = tagAt(i, end);
        if (tag) {
          if (tag.closing) {
            if (tag.name === parent) return { tokens, end: tag.end, contentEnd: i, indent: commonIndent(start, i) };
            error('local.tag.mismatch', `结束标签 </${tag.name}> 与${parent ? ` <${parent}>` : '文档根级'}不匹配。`, i, tag.end); i = tag.end; continue;
          }
          const empty = VOID.has(tag.name) || tag.self;
          if (tag.self && PAIRED.has(tag.name)) error('local.tag.shape', `<${tag.name}> 需要成对结束标签。`, i, tag.end);
          if (empty) { tokens.push({ start: i, end: tag.end, node: node('component', i, tag.end, { name: tag.name, attrs: tag.attrs, children: [] }) }); i = tag.end; continue; }
          const nested = region(tag.end, end, tag.name, i, tag.end, depth + 1);
          const children = convert(tag.end, nested.contentEnd, nested.tokens, INLINE.has(tag.name) ? 0 : nested.indent);
          const component = node('component', i, nested.end, { name: tag.name, attrs: tag.attrs, children: INLINE.has(tag.name) && children.length === 1 && children[0].type === 'paragraph' ? children[0].children ?? [] : children });
          tokens.push({ start: i, end: nested.end, node: component }); i = nested.end; continue;
        }
      }
      i++;
    }
    if (parent) error('local.tag.unclosed', `<${parent}> 缺少 </${parent}>。`, openStart, Math.min(source.length, Math.max(openEnd, openStart + 1)));
    return { tokens, end, contentEnd: end, indent: parent ? commonIndent(start, end) : 0 };
  }
  function convert(start: number, end: number, tokens: Token[], indent = 0): LocalNode[] {
    let masked = '', cursor = start;
    const offsets: number[] = [];
    const markers = new Map<number, { marker: string; end: number; node: LocalNode }>();
    const skipCache = new Map<number, number>();
    function lineSkip(absolute: number) {
      const lineStart = source.lastIndexOf('\n', absolute - 1) + 1;
      let skip = skipCache.get(lineStart);
      if (skip === undefined) {
        skip = 0;
        while (skip < indent && (source[lineStart + skip] === ' ' || source[lineStart + skip] === '\t')) skip++;
        skipCache.set(lineStart, skip);
      }
      return { lineStart, skip };
    }
    function append(text: string, from: number, linear: boolean) {
      if (linear && indent > 0) {
        for (let j = 0; j < text.length; j++) {
          const absolute = from + j;
          const { lineStart, skip } = lineSkip(absolute);
          if (absolute < lineStart + skip) continue;
          masked += text[j]; offsets.push(absolute);
        }
        return;
      }
      masked += text;
      for (let j = 0; j < text.length; j++) offsets.push(linear ? from + j : from);
    }
    for (const token of tokens) {
      append(source.slice(cursor, token.start), cursor, true);
      let marker: string;
      do { marker = MARK_OPEN + markerSerial++ + MARK_CLOSE; } while (reservedMarkers.has(marker));
      const block = token.node.type === 'math' || (token.node.type === 'component' && !INLINE.has(token.node.name!));
      if (block) append('\n\n', token.start, false);
      const markerStart = masked.length;
      // A generated Markdown image has its own source range. Restore only this
      // exact range; entity decoding and adjacent code cannot forge a node.
      append(`![${marker}](rmd-internal:placeholder)`, token.start, false);
      markers.set(markerStart, { marker, end: masked.length, node: token.node });
      if (block) append('\n\n', token.end, false);
      cursor = token.end;
    }
    append(source.slice(cursor, end), cursor, true); offsets.push(end);
    const tree = markdown.parse(masked) as any;
    function unescapeTablePipes(nodes: LocalNode[]) {
      for (const child of nodes) {
        if (child.type === 'interpolation' && child.value !== undefined) child.value = child.value.replace(/\\\|/g, '|');
        if (child.children) unescapeTablePipes(child.children);
      }
    }
    function transform(raw: any): LocalNode[] {
      const from = offsets[raw.position?.start?.offset ?? 0] ?? start;
      const to = offsets[raw.position?.end?.offset ?? masked.length] ?? end;
      if (raw.type === 'image') {
        const slot = markers.get(raw.position?.start?.offset);
        if (slot && raw.position.end.offset === slot.end
          && raw.url === 'rmd-internal:placeholder' && raw.alt === slot.marker) {
          markers.delete(raw.position.start.offset);
          return slot.node.type === 'comment' ? [] : [slot.node];
        }
      }
      if (raw.type === 'text') {
        return raw.value ? [node('text', from, to, { value: raw.value })] : [];
      }
      const children = raw.children?.flatMap(transform);
      if (raw.type === 'paragraph' && children?.length === 1 && (children[0].type === 'math' || (children[0].type === 'component' && !INLINE.has(children[0].name!)))) return children;
      if (raw.type === 'paragraph' && !children?.length) return [];
      if (raw.type === 'html') {
        error('local.html', '原始 HTML 不属于本地交互语法。', from, to);
        return [];
      }
      const result = node(raw.type, from, to);
      for (const key of ['value', 'depth', 'ordered', 'start', 'checked', 'url', 'title', 'alt', 'lang', 'align'] as const) if (raw[key] !== undefined) (result as any)[key] = raw[key];
      if (children) result.children = children;
      if (raw.type === 'table' && result.children) unescapeTablePipes(result.children);
      return [result];
    }
    return tree.children.flatMap(transform);
  }
  try {
    const result = region(0, source.length);
    return { nodes: convert(0, source.length, result.tokens), diagnostics };
  } catch (cause) {
    if (cause instanceof LocalBudgetError) {
      error(cause.code, cause.message, cause.start, cause.end);
      return { nodes: [], diagnostics };
    }
    error('local.parse', `无法解析文档：${cause instanceof Error ? cause.message : String(cause)}`, 0);
    return { nodes: [], diagnostics };
  }
}
