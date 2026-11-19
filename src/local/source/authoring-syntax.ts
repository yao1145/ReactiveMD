import type { LocalNode, SourceRange } from '../types';
import { LOCAL_HTML_NAMES } from '../html/html-names';
import { HTML_TABLE_NAMES } from '../html/html-table';
import { RESERVED_NAMES } from '../evaluation/expression/compile';

export interface RawAttribute {
  name: string;
  nameRange: SourceRange;
  /** Content between the quotes, without the quotes themselves. */
  valueRange?: SourceRange;
  quoteStart?: number;
  quoteEnd?: number;
  unquoted?: boolean;
}

export interface RawTag {
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

export function readTagAt(source: string, start: number): RawTag | null {
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

export function closingTagOf(source: string, node: LocalNode, openingEnd: number): RawTag | null {
  if (node.range.end <= openingEnd) return null;
  const start = source.lastIndexOf('</', node.range.end - 1);
  if (start < openingEnd) return null;
  const tag = readTagAt(source, start);
  if (!tag || !tag.closing || tag.end > node.range.end) return null;
  if (tag.name !== node.name && !((LOCAL_HTML_NAMES.has(tag.name.toLowerCase()) || HTML_TABLE_NAMES.has(tag.name.toLowerCase()))
    && tag.name.toLowerCase() === node.name?.toLowerCase())) return null;
  return tag;
}

export interface RawInterpolation {
  /** Start of `{{`. */
  start: number;
  /** Offset just past `}}`. */
  end: number;
  innerStart: number;
  innerEnd: number;
}

/** Mirrors the compiler's attribute-template scanner, including `\{{` escapes. */
export function rawInterpolations(source: string, start: number, end: number): RawInterpolation[] {
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
export function decodedAttribute(source: string, range: SourceRange): { text: string; offsets: number[] } {
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

export interface IdentifierRange {
  name: string;
  range: SourceRange;
}

/** Identifiers that are real references: strings, literals, functions are skipped. */
export function expressionIdentifiers(source: string, start: number, end: number): IdentifierRange[] {
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

export function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

export function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

export function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}
