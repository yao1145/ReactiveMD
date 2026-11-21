import { HTML_RAW_TEXT_ELEMENTS, htmlCommentEnd, htmlTagEnd } from '../html/html-policy';
import type { SourceRange } from '../types';

export const EXTENDED_HTML_NAMES: ReadonlySet<string> = new Set(['iframe', 'dl', 'section', 'figure', 'figcaption']);

/** Native fragments use HTML lexical boundaries even when their text resembles Markdown. */
export function opaqueHtmlClose(source: string, from: number, name: string, limit: number): SourceRange | null {
  if (name === 'css' || name === 'javascript' || HTML_RAW_TEXT_ELEMENTS.has(name)) {
    const close = new RegExp(`</${name}\\s*>`, 'ig');
    close.lastIndex = from;
    const match = close.exec(source);
    return match && close.lastIndex <= limit ? { start: match.index, end: close.lastIndex } : null;
  }
  const tag = /<(\/?)([a-z][a-z0-9_-]*)(?=[\s/>])/iy;
  let depth = 1;
  let cursor = from;
  for (;;) {
    const start = source.indexOf('<', cursor);
    if (start < 0 || start >= limit) return null;
    if (source.startsWith('<!--', start)) {
      cursor = htmlCommentEnd(source, start, limit);
      continue;
    }
    tag.lastIndex = start;
    const match = tag.exec(source);
    if (!match) { cursor = start + 1; continue; }
    const end = htmlTagEnd(source, tag.lastIndex, limit);
    if (end < 0) return null;
    cursor = end;
    const lower = match[2].toLowerCase();
    if (lower === name && match[1] && --depth === 0) return { start, end };
    if (match[1] || /\/\s*>$/.test(source.slice(tag.lastIndex, end))) continue;
    if (lower === name) depth++;
    else if (HTML_RAW_TEXT_ELEMENTS.has(lower)) {
      const close = opaqueHtmlClose(source, end, lower, limit);
      if (!close) return null;
      cursor = close.end;
    }
  }
}

/** Repair the first Markdown code range that crosses a raw author block's end. */
export function maskLeakingAuthorBody(
  source: string,
  code: readonly SourceRange[],
  definitions: readonly SourceRange[],
  registered: { has(name: string): boolean },
  from: number,
): { source: string; end: number } | undefined {
  if (!code.length) return;
  const tags = /^[\t ]*<(css|javascript|dl|section|figure|figcaption)(?=[\s/>])|<(iframe)(?=[\s/>])/gim;
  tags.lastIndex = from;
  let codeIndex = 0;
  let definitionIndex = 0;
  for (const match of source.matchAll(tags)) {
    const original = match[1] ?? match[2];
    const name = original.toLowerCase();
    if ((name === 'css' || name === 'javascript') && original !== name) continue;
    if (registered.has(name)) continue;
    const start = match.index + match[0].indexOf('<');
    while (code[codeIndex]?.end <= start) codeIndex++;
    while (definitions[definitionIndex]?.end <= start) definitionIndex++;
    if (code[codeIndex]?.start <= start || definitions[definitionIndex]?.start <= start) continue;
    const head = match.index + match[0].length;
    const body = htmlTagEnd(source, head, source.length);
    if (body < 0 || /\/\s*>$/.test(source.slice(head, body))) continue;
    const close = opaqueHtmlClose(source, body, name, source.length);
    if (!close) continue;
    for (let index = codeIndex; code[index]?.start < close.start; index++) {
      const range = code[index];
      if (range.start < body || range.end <= close.end) continue;
      // Keep source positions and line endings. The region scanner still
      // reads and emits the original declaration body.
      return {
        source: source.slice(0, body) + source.slice(body, close.start).replace(/[^\r\n]/g, ' ') + source.slice(close.start),
        end: close.end,
      };
    }
  }
}
