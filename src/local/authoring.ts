import { compileLocal } from './compiler';
import { RESERVED_NAMES } from './expression';
import { readLocalCompileOptions } from './options';
import { parseLocal } from './parser';
import { localLatexReferences } from './math';
import { LOCAL_HTML_NAMES } from './html-names';
import { HTML_TABLE_NAMES } from './html-table';
import {
  LOCAL_COMPONENT_NAMES,
  getLocalComponent,
  type LocalComponentSchema,
  type LocalPropSchema,
} from './schema';
import type { Diagnostic, LocalCompileOptions, LocalDocument, LocalNode, SourceRange } from './types';

/**
 * DOM-free authoring services for the local interaction syntax.
 *
 * Everything here works from the same source offsets as the parser and the
 * compiler: positions are UTF-16 code units into the original document. Active
 * syntax is taken from `parseLocal`. Code, display math, comments, escaped
 * syntax, footnotes and unknown/fallback regions produce no binding reads or
 * formatting edits; computable plot parameters use the LaTeX AST.
 *
 * Every entry point accepts the same optional `LocalCompileOptions` as the
 * preview compiler. Host components and syntax limits therefore shape analysis
 * exactly as they shape rendering, and HTML mode is treated as opaque.
 */

export interface AuthorToken {
  kind: string;
  range: SourceRange;
}

export interface AuthorBinding {
  name: string;
  declarations: SourceRange[];
  references: SourceRange[];
}

export interface AuthorAnalysis {
  tokens: AuthorToken[];
  bindings: AuthorBinding[];
  diagnostics: Diagnostic[];
}

export type AuthorCompletionKind = 'tag' | 'attribute' | 'binding' | 'value';

export interface AuthorCompletion {
  label: string;
  insertText: string;
  range: SourceRange;
  kind: AuthorCompletionKind;
  detail?: string;
}

export interface AuthorRename {
  source: string;
  edits: { range: SourceRange; text: string }[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Mirrors the compiler's repeated-name guard. */
const MAX_NAME_LENGTH = 128;
const INACTIVE_NODE_TYPES = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'fallback', 'comment', 'footnoteDefinition']);
/** Parse-level failures leave parts of the document opaque, so renaming is unsafe. */
const UNSAFE_RENAME_CODES = new Set([
  'local.version.unsupported', 'local.version.malformed', 'local.version.duplicate', 'local.version.placement',
  'local.parse',
  'local.interpolation',
  'local.tag.unclosed',
  'local.tag.mismatch',
  'local.tag.closing',
  'local.tag.shape',
  'local.attribute',
  'local.budget',
]);

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function validBindingName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && IDENTIFIER.test(name) && !RESERVED_NAMES.has(name);
}

function sortedRange(range: SourceRange): SourceRange {
  return { start: range.start, end: range.end };
}

function compileDiagnostics(source: string, options?: LocalCompileOptions): Diagnostic[] {
  try {
    return compileLocal(source, options).diagnostics;
  } catch {
    // A compiler defect must not make the editor unusable; the caller still
    // gets an empty analysis rather than a rejected promise/exception.
    return [];
  }
}

/**
 * In HTML mode the whole document is opaque native HTML: local tags and
 * interpolations are not interpreted, so authoring must not analyse, complete,
 * rename or reformat them. Invalid options are also kept opaque; the compiler
 * reports them through the normal diagnostic path.
 */
function authoringOptionMode(options: LocalCompileOptions | undefined): 'markdown' | 'html' | 'invalid' {
  const check = readLocalCompileOptions(options);
  if (!check.ok) return 'invalid';
  return check.htmlActive ? 'html' : 'markdown';
}

/* ------------------------------------------------------------------ */
/* Raw tag scanning                                                    */
/* ------------------------------------------------------------------ */

interface RawAttribute {
  name: string;
  nameRange: SourceRange;
  /** Content between the quotes, without the quotes themselves. */
  valueRange?: SourceRange;
  quoteStart?: number;
  quoteEnd?: number;
  unquoted?: boolean;
}

interface RawTag {
  start: number;
  /** Offset just past `>`. */
  end: number;
  /** Offset of `>`. */
  contentEnd: number;
  name: string;
  nameRange: SourceRange;
  closing: boolean;
  selfClosing: boolean;
  attrs: RawAttribute[];
}

const TAG_START = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/;

function readTagAt(source: string, start: number): RawTag | null {
  if (source[start] !== '<') return null;
  const match = TAG_START.exec(source.slice(start));
  if (!match) return null;
  const closing = Boolean(match[1]);
  const name = match[2];
  const nameStart = start + (closing ? 2 : 1);
  let quote = '';
  let index = start + match[0].length;
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      break;
    }
  }
  if (index >= source.length) return null;
  const contentEnd = index;
  const end = index + 1;
  if (closing) {
    return {
      start,
      end,
      contentEnd,
      name,
      nameRange: { start: nameStart, end: nameStart + name.length },
      closing: true,
      selfClosing: false,
      attrs: [],
    };
  }
  const attrs: RawAttribute[] = [];
  let cursor = nameStart + name.length;
  while (cursor < contentEnd) {
    while (cursor < contentEnd && isWhitespace(source[cursor])) cursor += 1;
    if (cursor >= contentEnd) break;
    if (source[cursor] === '/') {
      cursor += 1;
      continue;
    }
    const attrMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(source.slice(cursor, contentEnd));
    if (!attrMatch) {
      cursor += 1;
      continue;
    }
    const attrStart = cursor;
    const attrName = attrMatch[0];
    cursor += attrName.length;
    const afterName = cursor;
    let lookahead = cursor;
    while (lookahead < contentEnd && isWhitespace(source[lookahead])) lookahead += 1;
    if (source[lookahead] !== '=') {
      attrs.push({
        name: attrName,
        nameRange: { start: attrStart, end: attrStart + attrName.length },
      });
      cursor = afterName;
      continue;
    }
    cursor = lookahead + 1;
    while (cursor < contentEnd && isWhitespace(source[cursor])) cursor += 1;
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const quoteStart = cursor;
      const valueStart = cursor + 1;
      const close = source.indexOf(quote, valueStart);
      if (close < 0 || close > contentEnd) {
        // Well-formed active tags never reach this branch, but returning a
        // value up to `>` keeps partial documents useful to the editor.
        attrs.push({
          name: attrName,
          nameRange: { start: attrStart, end: attrStart + attrName.length },
          valueRange: { start: valueStart, end: contentEnd },
          quoteStart,
          quoteEnd: contentEnd,
        });
        cursor = contentEnd;
        continue;
      }
      attrs.push({
        name: attrName,
        nameRange: { start: attrStart, end: attrStart + attrName.length },
        valueRange: { start: valueStart, end: close },
        quoteStart,
        quoteEnd: close,
      });
      cursor = close + 1;
      continue;
    }
    const valueStart = cursor;
    while (cursor < contentEnd && !isWhitespace(source[cursor])) cursor += 1;
    attrs.push({
      name: attrName,
      nameRange: { start: attrStart, end: attrStart + attrName.length },
      valueRange: { start: valueStart, end: cursor },
      unquoted: true,
    });
  }
  return {
    start,
    end,
    contentEnd,
    name,
    nameRange: { start: nameStart, end: nameStart + name.length },
    closing: false,
    selfClosing: /\/\s*$/.test(source.slice(nameStart + name.length, contentEnd)),
    attrs,
  };
}

function closingTagOf(source: string, node: LocalNode, openingEnd: number): RawTag | null {
  if (node.range.end <= openingEnd) return null;
  const start = source.lastIndexOf('</', node.range.end - 1);
  if (start < openingEnd) return null;
  const tag = readTagAt(source, start);
  if (!tag || !tag.closing || tag.end > node.range.end) return null;
  if (tag.name !== node.name && !((LOCAL_HTML_NAMES.has(tag.name.toLowerCase()) || HTML_TABLE_NAMES.has(tag.name.toLowerCase()))
    && tag.name.toLowerCase() === node.name?.toLowerCase())) return null;
  return tag;
}

/* ------------------------------------------------------------------ */
/* Expression scanning                                                 */
/* ------------------------------------------------------------------ */

interface RawInterpolation {
  /** Start of `{{`. */
  start: number;
  /** Offset just past `}}`. */
  end: number;
  innerStart: number;
  innerEnd: number;
}

/** Mirrors the compiler's attribute-template scanner, including `\{{` escapes. */
function rawInterpolations(source: string, start: number, end: number): RawInterpolation[] {
  const found: RawInterpolation[] = [];
  for (let index = start; index < end; ) {
    if (source[index] === '\\' && source.startsWith('{{', index + 1)) {
      index += 3;
      continue;
    }
    if (!source.startsWith('{{', index)) {
      index += 1;
      continue;
    }
    let quote = '';
    let cursor = index + 2;
    for (; cursor < end - 1; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (character === '\\') cursor += 1;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '}' && source[cursor + 1] === '}') {
        break;
      }
    }
    if (cursor >= end - 1) break;
    found.push({ start: index, end: cursor + 2, innerStart: index + 2, innerEnd: cursor });
    index = cursor + 2;
  }
  return found;
}

/** Attribute decoding matches the parser while retaining original boundaries. */
function decodedAttribute(source: string, range: SourceRange): { text: string; offsets: number[] } {
  const entities: Record<string, string> = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
  const offsets = [range.start];
  let text = '';
  for (let cursor = range.start; cursor < range.end;) {
    const entity = source[cursor] === '&' ? /^&(quot|apos|amp|lt|gt);/.exec(source.slice(cursor, range.end)) : null;
    text += entity ? entities[entity[1]] : source[cursor];
    cursor += entity ? entity[0].length : 1;
    offsets.push(cursor);
  }
  return { text, offsets };
}

interface IdentifierRange {
  name: string;
  range: SourceRange;
}

/** Identifiers that are real references: strings, literals, functions are skipped. */
function expressionIdentifiers(source: string, start: number, end: number): IdentifierRange[] {
  const found: IdentifierRange[] = [];
  for (let index = start; index < end; ) {
    const character = source[index];
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < end) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (
      /[0-9]/.test(character)
      || (character === '.' && source[index + 1] !== undefined && /[0-9]/.test(source[index + 1]))
    ) {
      // Skip numeric literals so the exponent marker in `1e3` is not a reference.
      const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(index, end));
      if (number) {
        index += number[0].length;
        continue;
      }
    }
    if (isIdentifierStart(character)) {
      const identifierStart = index;
      index += 1;
      while (index < end && isIdentifierPart(source[index])) index += 1;
      const name = source.slice(identifierStart, index);
      let lookahead = index;
      while (lookahead < end && isWhitespace(source[lookahead])) lookahead += 1;
      if (source[lookahead] === '(') continue; // builtin function call
      if (name === 'true' || name === 'false' || name === 'null' || name === 'pi' || name === 'e') continue;
      if (RESERVED_NAMES.has(name)) continue;
      found.push({ name, range: { start: identifierStart, end: index } });
      continue;
    }
    index += 1;
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

interface AnalysisData {
  tokens: AuthorToken[];
  bindings: AuthorBinding[];
  mathReferences: IdentifierRange[];
}

function isBindAttribute(component: LocalComponentSchema, name: string): boolean {
  if (!Object.hasOwn(component.props, name)) return false;
  if (name === 'bind') return true;
  return Boolean(component.slots?.some((slot) => slot.bind === name));
}

function collectInactive(nodes: LocalNode[], out: SourceRange[] = []): SourceRange[] {
  for (const node of nodes) {
    if (INACTIVE_NODE_TYPES.has(node.type)) out.push(sortedRange(node.range));
    if (node.type !== 'fallback' && node.children) collectInactive(node.children, out);
  }
  return out;
}

// Comments are dropped by the public parser. Shield literal regions and tag
// attributes before recovering their source ranges for highlighting/completion.
function commentRanges(source: string, nodes: LocalNode[]): SourceRange[] {
  const shields = collectInactive(nodes);
  const visit = (list: LocalNode[]): void => {
    for (const node of list) {
      if (node.type === 'component' || node.type === 'hostComponent') {
        const tag = readTagAt(source, node.range.start);
        if (tag) shields.push({ start: tag.start, end: tag.end });
      }
      if (node.type !== 'fallback' && node.children) visit(node.children);
    }
  };
  visit(nodes);
  shields.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: SourceRange[] = [];
  let cursor = 0;
  let shieldIndex = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<!--', cursor);
    if (start < 0) break;
    while (shieldIndex < shields.length && shields[shieldIndex].end <= start) shieldIndex++;
    const shield = shields[shieldIndex];
    if (shield && shield.start <= start) { cursor = shield.end; continue; }
    const close = source.indexOf('-->', start + 4);
    const end = close < 0 ? source.length : close + 3;
    result.push({ start, end });
    cursor = end;
  }
  return result;
}

function authoringProps(name: string, options?: LocalCompileOptions): Readonly<Record<string, LocalPropSchema>> | undefined {
  const builtin = getLocalComponent(name);
  if (builtin) return builtin.props;
  const host = options?.hostComponents?.find(component => component.name === name);
  return host ? Object.fromEntries(Object.entries(host.props).map(([key, prop]) => [key, { ...prop, values: prop.enum }])) : undefined;
}

function buildAnalysisData(source: string, nodes: LocalNode[], options?: LocalCompileOptions,
  metadata?: Pick<LocalDocument, 'computations' | 'themeRange'>): AnalysisData {
  // Rendering removes declarations from nodes. Their source ranges let author
  // tools recover the original tags without parsing the document again.
  const recovered: LocalNode[] = [];
  if (metadata?.themeRange) recovered.push({type:'component',name:'theme',id:'author-theme',range:metadata.themeRange});
  for (const entry of Object.values(metadata?.computations ?? {})) {
    recovered.push({type:'component',name:entry.kind,id:entry.nodeId,range:entry.range});
  }
  const roots = recovered.length ? nodes.concat(recovered) : nodes;
  const visitedTags = new Set<number>();
  const tokens: AuthorToken[] = [];
  const declarations = new Map<string, SourceRange[]>();
  const references: IdentifierRange[] = [];
  const mathReferences: IdentifierRange[] = [];

  const addReference = (start: number, end: number): void => {
    for (const reference of expressionIdentifiers(source, start, end)) references.push(reference);
  };

  const addDeclaration = (name: string, range: SourceRange): void => {
    const list = declarations.get(name);
    if (list) list.push(sortedRange(range));
    else declarations.set(name, [sortedRange(range)]);
  };

  const visitComponent = (node: LocalNode, parent?: string): void => {
    if (visitedTags.has(node.range.start)) return;
    const tag = readTagAt(source, node.range.start);
    if (!tag || tag.closing) return;
    visitedTags.add(node.range.start);
    tokens.push({ kind: 'tag', range: sortedRange(tag.nameRange) });
    const component = getLocalComponent(node.name ?? '');
    const hasKey = tag.attrs.some((attribute) => attribute.name === 'key');
    for (const attribute of tag.attrs) {
      tokens.push({ kind: 'attribute', range: sortedRange(attribute.nameRange) });
      if (!attribute.valueRange) continue;
      const prop = authoringProps(node.name ?? '', options)?.[attribute.name];
      const bindAttribute = component !== undefined
        && isBindAttribute(component, attribute.name)
        && !((node.name === 'table' || node.name === 'chart') && !hasKey);
      const namedValue = (node.name === 'computed' || node.name === 'const') && attribute.name === 'name';
      const rawValue = source.slice(attribute.valueRange.start, attribute.valueRange.end);
      const decoded = decodedAttribute(source, attribute.valueRange);
      if (node.name === 'validation' && attribute.name === 'fields') {
        for (const match of decoded.text.matchAll(/\S+/g)) {
          if (!validBindingName(match[0])) continue;
          const range = { start: decoded.offsets[match.index], end: decoded.offsets[match.index + match[0].length] };
          references.push({ name: match[0], range });
          tokens.push({ kind: 'binding', range });
        }
        continue;
      }
      const segments = prop && !prop.static
        ? rawInterpolations(decoded.text, 0, decoded.text.length)
        : [];
      if (segments.length > 0) {
        let cursor = 0;
        for (const segment of segments) {
          if (segment.start > cursor) {
            tokens.push({ kind: 'string', range: { start: decoded.offsets[cursor], end: decoded.offsets[segment.start] } });
          }
          tokens.push({ kind: 'expression', range: { start: decoded.offsets[segment.start], end: decoded.offsets[segment.end] } });
          for (const reference of expressionIdentifiers(decoded.text, segment.innerStart, segment.innerEnd)) {
            if ((parent === 'data-table' && node.name === 'column' || node.name === 'data-table' && attribute.name === 'key')
              && (reference.name === 'item' || reference.name === 'index')) continue;
            references.push({ name: reference.name, range: {
              start: decoded.offsets[reference.range.start], end: decoded.offsets[reference.range.end],
            } });
          }
          cursor = segment.end;
        }
        if (cursor < decoded.text.length) {
          tokens.push({ kind: 'string', range: { start: decoded.offsets[cursor], end: attribute.valueRange.end } });
        }
        continue;
      }
      if ((bindAttribute || namedValue) && validBindingName(rawValue)) {
        tokens.push({ kind: 'binding', range: sortedRange(attribute.valueRange) });
        addDeclaration(rawValue, attribute.valueRange);
      } else if (attribute.valueRange.end > attribute.valueRange.start) {
        tokens.push({ kind: 'string', range: sortedRange(attribute.valueRange) });
      }
    }
    const close = closingTagOf(source, node, tag.end);
    if (close) tokens.push({ kind: 'tag', range: sortedRange(close.nameRange) });
  };

  const walk = (list: LocalNode[], parent?: string): void => {
    for (const node of list) {
      if ((node.type === 'component' || node.type === 'hostComponent') && node.name) visitComponent(node, parent);
      else if (node.type === 'interpolation') {
        tokens.push({ kind: 'expression', range: sortedRange(node.range) });
        addReference(node.range.start + 2, Math.max(node.range.start + 2, node.range.end - 2));
      } else if (node.type === 'math' || node.type === 'inlineMath') {
        tokens.push({ kind: 'math', range: sortedRange(node.range) });
        if (parent === 'plot' && node.type === 'math') {
          const start = node.range.start + 2;
          try {
            for (const reference of localLatexReferences(source.slice(start, node.range.end - 2))) {
              const item = { name: reference.name, range: {
                start: start + reference.range.start, end: start + reference.range.end,
              } };
              references.push(item);
              mathReferences.push(item);
            }
          } catch { /* Formula diagnostics come from the compiler. */ }
        }
      } else if (node.type === 'code' || node.type === 'inlineCode') {
        tokens.push({ kind: 'code', range: sortedRange(node.range) });
      } else if (node.type === 'comment') {
        tokens.push({ kind: 'comment', range: sortedRange(node.range) });
      }
      // Native HTML becomes div/heading/strong/etc. nodes. Recover only tags
      // represented by active nodes; code, comments and fallback stay opaque.
      if (!INACTIVE_NODE_TYPES.has(node.type) && source[node.range.start] === '<' && !visitedTags.has(node.range.start)) {
        const tag = readTagAt(source, node.range.start);
        if (tag && !tag.closing && (LOCAL_HTML_NAMES.has(tag.name.toLowerCase()) || HTML_TABLE_NAMES.has(tag.name.toLowerCase()))) {
          visitComponent({...node,name:tag.name}, parent);
        }
      }
      if (node.type !== 'fallback' && node.children) walk(node.children, node.name);
    }
  };
  walk(roots);
  for (const range of commentRanges(source, roots)) tokens.push({ kind: 'comment', range });

  // Tokens are lexical and must never overlap: attribute values split around
  // interpolation segments, and component tags contribute only names.
  tokens.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  const ordered: AuthorToken[] = [];
  for (const token of tokens) {
    if (token.range.end <= token.range.start) continue;
    const previous = ordered[ordered.length - 1];
    if (previous && token.range.start < previous.range.end) continue;
    ordered.push(token);
  }

  const bindings: AuthorBinding[] = [];
  for (const [name, ranges] of declarations) {
    const ownReferences: SourceRange[] = [];
    const seenReferences = new Set<string>();
    for (const reference of references) {
      if (reference.name !== name) continue;
      const key = `${reference.range.start}:${reference.range.end}`;
      if (!seenReferences.has(key)) {
        seenReferences.add(key);
        ownReferences.push(sortedRange(reference.range));
      }
    }
    ownReferences.sort((a, b) => a.start - b.start || a.end - b.end);
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    bindings.push({ name, declarations: ranges, references: ownReferences });
  }
  bindings.sort((a, b) => a.declarations[0].start - b.declarations[0].start || a.name.localeCompare(b.name));
  return { tokens: ordered, bindings, mathReferences };
}

/**
 * Analyze syntax, declarations/references and (by default) compiler diagnostics.
 * A supplied document must come from the same source and compile options;
 * stale-source documents are ignored. Editors with separate diagnostics may
 * omit their compilation via `diagnostics: false`.
 */
export function analyzeLocalSource(source: string, options?: LocalCompileOptions,
  settings: {document?: LocalDocument; diagnostics?: boolean} = {}): AuthorAnalysis {
  if (typeof source !== 'string') {
    return { tokens: [], bindings: [], diagnostics: [] };
  }
  if (authoringOptionMode(options) !== 'markdown') {
    return { tokens: [], bindings: [], diagnostics: settings.diagnostics === false ? [] : compileDiagnostics(source, options) };
  }
  const document = settings.document?.source === source ? settings.document : parseLocal(source, options);
  const data = buildAnalysisData(source, document.nodes, options, document);
  return { tokens: data.tokens, bindings: data.bindings, diagnostics: settings.diagnostics === false ? [] : compileDiagnostics(source, options) };
}

/* ------------------------------------------------------------------ */
/* Completion helpers                                                  */
/* ------------------------------------------------------------------ */

interface PrefixAttribute extends RawAttribute {
  nameStart: number;
  nameEnd: number;
}

interface TagPrefix {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  inValue: boolean;
  currentAttribute?: PrefixAttribute;
  attrs: PrefixAttribute[];
  partialStart: number;
}

function readTagPrefix(source: string, tagStart: number, limit: number): TagPrefix | null {
  const match = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)/.exec(source.slice(tagStart, Math.min(source.length, limit + 1)));
  if (!match) return null;
  const closing = Boolean(match[1]);
  const name = match[2];
  const nameEnd = tagStart + match[0].length;
  const attrs: PrefixAttribute[] = [];
  let inValue = false;
  let currentAttribute: PrefixAttribute | undefined;
  let selfClosing = false;
  if (!closing) {
    let cursor = nameEnd;
    while (cursor < limit) {
      while (cursor < limit && isWhitespace(source[cursor])) cursor += 1;
      if (cursor >= limit) break;
      if (source[cursor] === '/') {
        selfClosing = true;
        cursor += 1;
        continue;
      }
      const attrMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(source.slice(cursor, limit));
      if (!attrMatch) {
        cursor += 1;
        continue;
      }
      const attrName = attrMatch[0];
      const nameStart = cursor;
      cursor += attrName.length;
      const nameEndAttr = cursor;
      let lookahead = cursor;
      while (lookahead < limit && isWhitespace(source[lookahead])) lookahead += 1;
      if (source[lookahead] !== '=') {
        attrs.push({ name: attrName, nameStart, nameEnd: nameEndAttr, nameRange: { start: nameStart, end: nameEndAttr } });
        cursor = nameEndAttr;
        continue;
      }
      cursor = lookahead + 1;
      while (cursor < limit && isWhitespace(source[cursor])) cursor += 1;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        const quoteStart = cursor;
        const valueStart = cursor + 1;
        const close = source.indexOf(quote, valueStart);
        if (close < 0 || close >= limit) {
          const attribute: PrefixAttribute = {
            name: attrName,
            nameStart,
            nameEnd: nameEndAttr,
            nameRange: { start: nameStart, end: nameEndAttr },
            valueRange: { start: valueStart, end: limit },
            quoteStart,
            quoteEnd: close < 0 ? limit : close,
          };
          attrs.push(attribute);
          currentAttribute = attribute;
          inValue = true;
          cursor = limit;
          break;
        }
        attrs.push({
          name: attrName,
          nameStart,
          nameEnd: nameEndAttr,
          nameRange: { start: nameStart, end: nameEndAttr },
          valueRange: { start: valueStart, end: close },
          quoteStart,
          quoteEnd: close,
        });
        cursor = close + 1;
        continue;
      }
      const valueStart = cursor;
      while (cursor < limit && !isWhitespace(source[cursor])) cursor += 1;
      attrs.push({
        name: attrName,
        nameStart,
        nameEnd: nameEndAttr,
        nameRange: { start: nameStart, end: nameEndAttr },
        valueRange: { start: valueStart, end: cursor },
        unquoted: true,
      });
    }
  }

  let partialStart = -1;
  if (!inValue) {
    let start = limit;
    while (start > nameEnd && /[A-Za-z0-9_-]/.test(source[start - 1])) start -= 1;
    if (start > nameEnd && isWhitespace(source[start - 1])) partialStart = start;
  }
  return { name, closing, selfClosing, inValue, currentAttribute, attrs, partialStart };
}

function findOpeningTagStart(source: string, offset: number, nodes: LocalNode[]): number {
  const starts: number[] = [];
  const collect = (list: LocalNode[]): void => {
    for (const node of list) {
      if (node.type === 'component') starts.push(node.range.start);
      if (node.type !== 'fallback' && node.children) collect(node.children);
    }
  };
  collect(nodes);
  starts.sort((a, b) => a - b);
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index];
    if (start >= offset) continue;
    const tag = readTagAt(source, start);
    if (tag && offset <= tag.end) return start;
    if (tag && tag.end < offset) break;
  }
  // An unfinished tag has no node. Walk back to the nearest unclosed `<`.
  let cursor = offset;
  while (cursor > 0) {
    const start = source.lastIndexOf('<', cursor - 1);
    if (start < 0) return -1;
    if (source[start - 1] === '\\') {
      cursor = start;
      continue;
    }
    const next = source[start + 1];
    if (next !== '/' && !isIdentifierStart(next)) {
      cursor = start;
      continue;
    }
    if (hasUnquotedGreater(source, start, offset)) {
      cursor = start;
      continue;
    }
    return start;
  }
  return -1;
}

function hasUnquotedGreater(source: string, start: number, end: number): boolean {
  let quote = '';
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return true;
    }
  }
  return false;
}

function interpolationContext(source: string, offset: number): RawInterpolation | null {
  let from = offset;
  while (from > 0) {
    const open = source.lastIndexOf('{{', from - 1);
    if (open < 0) return null;
    if (source[open - 1] === '\\') {
      from = open;
      continue;
    }
    let quote = '';
    let cursor = open + 2;
    let close = -1;
    for (; cursor < source.length - 1; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (character === '\\') cursor += 1;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '}' && source[cursor + 1] === '}') {
        close = cursor;
        break;
      }
    }
    if (close >= 0 && close + 2 <= offset) {
      from = open;
      continue;
    }
    return { start: open, end: close < 0 ? source.length : close + 2, innerStart: open + 2, innerEnd: close < 0 ? source.length : close };
  }
  return null;
}

function insideExpressionString(source: string, start: number, end: number): boolean {
  let quote = '';
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    }
  }
  return quote !== '';
}

function rangeInside(ranges: SourceRange[], offset: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (offset < range.start) high = middle - 1;
    else if (offset >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

/** Extend a replacement range over an existing valid suffix, not arbitrary text. */
function completionRange(source: string, start: number, offset: number, label: string): SourceRange {
  const prefix = source.slice(start, offset);
  const rest = prefix && label.startsWith(prefix) ? label.slice(prefix.length) : '';
  const end = rest && source.startsWith(rest, offset) ? offset + rest.length : offset;
  return { start, end };
}

function bindingCompletions(source: string, offset: number, context: RawInterpolation, bindings: AuthorBinding[]): AuthorCompletion[] {
  if (insideExpressionString(source, context.innerStart, offset)) return [];
  let start = offset;
  while (start > context.innerStart && isIdentifierPart(source[start - 1])) start -= 1;
  if (source[start - 1] === '.') return [];
  const prefix = source.slice(start, offset);
  if (prefix && !isIdentifierStart(prefix[0])) return [];
  return bindings
    .filter((binding) => binding.name.startsWith(prefix))
    .map((binding) => ({
      label: binding.name,
      insertText: binding.name,
      range: completionRange(source, start, offset, binding.name),
      kind: 'binding' as const,
      detail: `${binding.declarations.length} declaration${binding.declarations.length === 1 ? '' : 's'}, ${binding.references.length} reference${binding.references.length === 1 ? '' : 's'}`,
    }));
}

function valueCompletions(source: string, offset: number, prefix: TagPrefix, options?: LocalCompileOptions): AuthorCompletion[] {
  const attribute = prefix.currentAttribute;
  if (!attribute) return [];
  const prop = authoringProps(prefix.name, options)?.[attribute.name];
  if (!prop || prop.kind !== 'enum' || !prop.values) return [];
  const valueStart = attribute.valueRange?.start ?? offset;
  const valuePrefix = source.slice(valueStart, offset);
  return prop.values
    .filter((value) => value.startsWith(valuePrefix))
    .map((value) => ({
      label: value,
      insertText: value,
      range: completionRange(source, valueStart, offset, value),
      kind: 'value' as const,
      detail: `${attribute.name} value`,
    }));
}

function attributeCompletions(source: string, offset: number, prefix: TagPrefix, options?: LocalCompileOptions): AuthorCompletion[] {
  if (prefix.closing || prefix.inValue || prefix.partialStart < 0) return [];
  const props = authoringProps(prefix.name, options);
  if (!props) return [];
  const partial = source.slice(prefix.partialStart, offset);
  if (partial && !/^[A-Za-z0-9_-]*$/.test(partial)) return [];
  const present = new Set(
    prefix.attrs
      .filter((attribute) => attribute.nameEnd < prefix.partialStart)
      .map((attribute) => attribute.name),
  );
  return Object.entries(props)
    .filter(([name]) => !present.has(name) && name.startsWith(partial))
    .map(([name, prop]) => ({
      label: name,
      insertText: name,
      range: completionRange(source, prefix.partialStart, offset, name),
      kind: 'attribute' as const,
      detail: prop.required ? `${prop.kind}, required` : prop.kind,
    }));
}

function tagCompletions(source: string, offset: number, options?: LocalCompileOptions): AuthorCompletion[] {
  const windowStart = Math.max(0, offset - 256);
  const slice = source.slice(windowStart, offset);
  const match = /<\/?([A-Za-z][A-Za-z0-9-]*)?$/.exec(slice);
  if (!match) return [];
  const start = windowStart + match.index;
  if (source[start] !== '<' || source[start - 1] === '\\') return [];
  const closing = source[start + 1] === '/';
  const nameStart = start + (closing ? 2 : 1);
  if (nameStart > offset) return [];
  const partial = match[1] ?? '';
  return [...LOCAL_COMPONENT_NAMES, ...(!closing ? options?.hostComponents?.map(component => component.name) ?? [] : [])]
    .filter((name) => name.startsWith(partial))
    .map((name) => ({
      label: name,
      insertText: name,
      range: completionRange(source, nameStart, offset, name),
      kind: 'tag' as const,
      detail: closing ? 'closing tag' : 'component',
    }));
}

/**
 * Complete tags, schema attributes, enum values and declared binding names at
 * `offset`. Replacement ranges cover an already-typed valid suffix so applying
 * a suggestion never duplicates letters. Inactive regions yield no results.
 */
export function completeLocalSource(
  source: string,
  offset: number,
  options?: LocalCompileOptions,
): AuthorCompletion[] {
  if (typeof source !== 'string' || !Number.isFinite(offset)) return [];
  if (authoringOptionMode(options) !== 'markdown') return [];
  const limit = Math.max(0, Math.min(source.length, Math.floor(offset)));
  const parsed = parseLocal(source, options);
  const inactive = [...collectInactive(parsed.nodes), ...commentRanges(source, parsed.nodes)].sort((a, b) => a.start - b.start);
  if (rangeInside(inactive, limit) || (limit === source.length && inactive.some(range => range.end === limit && range.start < limit))) return [];
  const data = buildAnalysisData(source, parsed.nodes, options);

  const interpolation = interpolationContext(source, limit);
  if (interpolation) {
    const tagStart = findOpeningTagStart(source, limit, parsed.nodes);
    if (tagStart >= 0) {
      const prefix = readTagPrefix(source, tagStart, limit);
      if (prefix?.inValue && prefix.currentAttribute) {
        const prop = authoringProps(prefix.name, options)?.[prefix.currentAttribute.name];
        if (prop?.static) return [];
      }
    }
    return bindingCompletions(source, limit, interpolation, data.bindings);
  }

  const tagStart = findOpeningTagStart(source, limit, parsed.nodes);
  if (tagStart >= 0) {
    const prefix = readTagPrefix(source, tagStart, limit);
    if (prefix?.inValue) return valueCompletions(source, limit, prefix, options);
  }
  const tags = tagCompletions(source, limit, options);
  if (tags.length > 0) return tags;
  if (tagStart >= 0) {
    const prefix = readTagPrefix(source, tagStart, limit);
    if (prefix) return attributeCompletions(source, limit, prefix, options);
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Rename                                                              */
/* ------------------------------------------------------------------ */

function applyEdits(source: string, edits: { range: SourceRange; text: string }[]): string {
  let result = '';
  let cursor = 0;
  for (const edit of edits) {
    result += source.slice(cursor, edit.range.start) + edit.text;
    cursor = edit.range.end;
  }
  return result + source.slice(cursor);
}

/**
 * Rename a declared binding and every active reference. Literal attribute
 * text, Markdown text, strings inside expressions, code, display math, comments
 * and fallback regions are preserved. Plot parameters retain their computed
 * meaning. Invalid names, collisions and structural
 * parse failures are rejected.
 */
export function renameLocalBinding(
  source: string,
  oldName: string,
  newName: string,
  options?: LocalCompileOptions,
): AuthorRename {
  if (typeof source !== 'string' || typeof oldName !== 'string' || typeof newName !== 'string') {
    throw new Error('Rename requires string arguments.');
  }
  if (authoringOptionMode(options) === 'html') {
    throw new Error('Bindings cannot be renamed in HTML mode.');
  }
  if (!validBindingName(newName)) {
    throw new Error(`"${newName}" is not a valid binding name. Use [A-Za-z_][A-Za-z0-9_]* and avoid reserved names.`);
  }
  const parsed = parseLocal(source, options);
  const data = buildAnalysisData(source, parsed.nodes, options);
  const binding = data.bindings.find((item) => item.name === oldName);
  if (!binding || binding.declarations.length === 0) {
    throw new Error(`Binding "${oldName}" is not declared in this document.`);
  }
  if (oldName === newName) return { source, edits: [] };
  if (data.bindings.some((item) => item.name === newName)) {
    throw new Error(`Binding "${newName}" already exists.`);
  }
  const unsafe = compileDiagnostics(source, options).some(
    (diagnostic) => diagnostic.severity === 'error' && UNSAFE_RENAME_CODES.has(diagnostic.code),
  );
  if (unsafe) {
    throw new Error('The document cannot be renamed safely while parse errors remain.');
  }
  const seen = new Set<string>();
  const ranges: SourceRange[] = [];
  for (const range of [...binding.declarations, ...binding.references]) {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push(sortedRange(range));
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const mathRanges = new Set(data.mathReferences.filter(item => item.name === oldName).map(item => `${item.range.start}:${item.range.end}`));
  const edits = ranges.map((range) => ({
    range: sortedRange(range),
    text: mathRanges.has(`${range.start}:${range.end}`) ? `\\mathrm{${newName}}` : newName,
  }));
  const renamed = applyEdits(source, edits);
  if (compileLocal(source, options).ok && !compileLocal(renamed, options).ok) {
    throw new Error('Rename could not preserve all binding references; the source was left unchanged.');
  }
  return { source: renamed, edits };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function formatOpeningTag(source: string, tag: RawTag): string {
  const name = source.slice(tag.nameRange.start, tag.nameRange.end);
  const attrs = tag.attrs.map((attribute) => {
    const attrName = source.slice(attribute.nameRange.start, attribute.nameRange.end);
    if (attribute.valueRange === undefined) return attrName;
    if (attribute.quoteStart !== undefined && attribute.quoteEnd !== undefined) {
      return `${attrName}=${source.slice(attribute.quoteStart, attribute.quoteEnd + 1)}`;
    }
    return attrName;
  });
  const head = attrs.length > 0 ? `<${name} ${attrs.join(' ')}` : `<${name}`;
  return tag.selfClosing ? `${head} />` : `${head}>`;
}

/**
 * Conservatively normalize whitespace inside recognized reactive tags:
 * single spaces between attributes, no spaces around `=`, no space before `>`,
 * canonical closing tags. Quotes, attribute order and values are untouched.
 * Markdown, newlines, indentation, code, math and fallback regions are not
 * modified. Any compile error leaves the document unchanged.
 */
export function formatLocalSource(source: string, options?: LocalCompileOptions): string {
  if (typeof source !== 'string') return source;
  if (authoringOptionMode(options) !== 'markdown') return source;
  let compiled: ReturnType<typeof compileLocal>;
  try {
    compiled = compileLocal(source, options);
  } catch {
    return source;
  }
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return source;
  const parsed = parseLocal(source, options);
  const edits: { start: number; end: number; text: string }[] = [];

  const visit = (nodes: LocalNode[]): void => {
    for (const node of nodes) {
      if ((node.type === 'component' || node.type === 'hostComponent') && node.name) {
        const tag = readTagAt(source, node.range.start);
        if (tag && !tag.closing && !/[\r\n]/.test(source.slice(tag.start, tag.end))) {
          const text = formatOpeningTag(source, tag);
          if (text !== source.slice(tag.start, tag.end)) {
            edits.push({ start: tag.start, end: tag.end, text });
          }
        }
        if (tag) {
          const close = closingTagOf(source, node, tag.end);
          if (close && !/[\r\n]/.test(source.slice(close.start, close.end))) {
            const name = source.slice(close.nameRange.start, close.nameRange.end);
            const text = `</${name}>`;
            if (text !== source.slice(close.start, close.end)) {
              edits.push({ start: close.start, end: close.end, text });
            }
          }
        }
      }
      if (node.type !== 'fallback' && node.children) visit(node.children);
    }
  };
  visit(parsed.nodes);

  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let result = '';
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    result += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + source.slice(cursor);
}
