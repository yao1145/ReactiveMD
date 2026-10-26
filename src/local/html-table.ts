import { parseFragment } from 'parse5';
import type { LocalNode, SourceRange } from './types';
import { localHtmlAlign } from './html-names';

/** Contextual names: they do not reserve new component names globally. */
export const HTML_TABLE_NAMES: ReadonlySet<string> = new Set([
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

export const HTML_TABLE_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  colgroup: new Set(['span']), col: new Set(['span']),
  td: new Set(['colspan', 'rowspan', 'headers', 'align']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'align']),
};

export function validHtmlTableValue(name: string, value: string): boolean {
  const text = value.trim();
  if (['colspan', 'rowspan', 'span'].includes(name)) {
    return /^\d{1,5}$/.test(text) && Number(text) <= (name === 'rowspan' ? 65534 : 1000)
      && Number(text) >= (name === 'rowspan' ? 0 : 1);
  }
  if (name === 'align') return localHtmlAlign(value) !== null;
  if (name === 'scope') return ['row', 'col', 'rowgroup', 'colgroup'].includes(text.toLowerCase());
  return true;
}

const CHILDREN: Readonly<Record<string, readonly string[]>> = {
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot'], colgroup: ['col'],
  thead: ['tr'], tbody: ['tr'], tfoot: ['tr'], tr: ['th', 'td'], col: [],
};

export type HtmlTableProblem = 'structure' | 'mixed' | 'attribute' | 'value' | 'unclosed';
interface Hooks {
  shield(offset: number, end: number): number | null;
  budget(offset: number, tokens: number): void;
  node(type: string, start: number, end: number, extra: Partial<LocalNode>): LocalNode;
  attributes(tag: string, start: number, end: number): Record<string, string>;
  content(start: number, end: number): LocalNode[];
  problem(kind: HtmlTableProblem, start: number, end: number, tag?: string, name?: string): void;
}

function tagAt(source: string, start: number, limit: number) {
  const match = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/.exec(source.slice(start, start + 80));
  if (!match) return null;
  let quote = '';
  for (let i = start + match[0].length; i < limit; i++) {
    const ch = source[i];
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return { name: match[2].toLowerCase(), closing: Boolean(match[1]), end: i + 1 };
  }
  return null;
}

/** Shield formulas just as prose does, so example tags inside math are inert. */
function mathEnd(source: string, start: number, limit: number): number | null {
  let open = '', close = '';
  if (source.startsWith('\\(', start)) { open = '\\('; close = '\\)'; }
  else if (source.startsWith('\\[', start)) { open = '\\['; close = '\\]'; }
  else if (source[start] === '$') { open = source[start + 1] === '$' ? '$$' : '$'; close = open; }
  if (!open) return null;
  for (let i = start + open.length; i < limit; i++) {
    if (source.startsWith(close, i)) {
      if (open === '$' && (/^\s|\s$/.test(source.slice(start + 1, i)) || /\d/.test(source[i + 1] ?? ''))) return null;
      return i + close.length;
    }
    if (source[i] === '\\') i++;
    if (open === '$' && source[i] === '\n') return null;
  }
  return open === '$' ? null : limit;
}

/**
 * Parse only the table skeleton with the HTML parser. Cell/caption bodies are
 * opaque spaces of equal length, then parsed from the original source through
 * the normal ReactiveMD pipeline. This preserves offsets and avoids HTML's
 * foster-parenting of Markdown, custom controls or example tags in code.
 */
export function readHtmlTable(source: string, start: number, limit: number, hooks: Hooks): { node: LocalNode; end: number } | null {
  const first = tagAt(source, start, limit);
  if (!first || first.closing || first.name !== 'table') return null;
  let depth = 0, count = 0, finish = limit, closed = false, candidate = false;
  const tags: { start: number; end: number }[] = [];
  for (let i = start; i < limit;) {
    const math = mathEnd(source, i, limit);
    if (math !== null) { i = math; continue; }
    const shield = hooks.shield(i, limit);
    if (shield !== null) { i = shield; continue; }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      i = end < 0 ? limit : Math.min(limit, end + 3);
      continue;
    }
    if (source[i] !== '<') { i++; continue; }
    const tag = tagAt(source, i, limit);
    if (!tag) { i++; continue; }
    if (!tag.closing && ['pre', 'code', 'script', 'style'].includes(tag.name)) {
      const close = new RegExp(`</${tag.name}\\s*>`, 'gi');
      close.lastIndex = tag.end;
      const found = close.exec(source);
      i = found && found.index < limit ? found.index + found[0].length : limit;
      continue;
    }
    if (HTML_TABLE_NAMES.has(tag.name)) {
      tags.push({ start: i, end: tag.end });
      count++;
      if (tag.name !== 'table') candidate = true;
      if (candidate) hooks.budget(i, count);
      if (tag.name === 'table') {
        depth += tag.closing ? -1 : 1;
        if (depth === 0) { finish = tag.end; closed = true; break; }
      }
    }
    i = tag.end;
  }
  if (!candidate) return null;
  if (!closed) hooks.problem('unclosed', start, finish, 'table');
  const masked = source.slice(start, finish).replace(/[^\r\n]/g, ' ').split('');
  for (const tag of tags) for (let i = tag.start; i < tag.end; i++) masked[i - start] = source[i];
  const tree: any = parseFragment(masked.join(''), { sourceCodeLocationInfo: true });
  const root = tree.childNodes.find((n: any) => n.tagName === 'table');
  if (!root) {
    hooks.problem('structure', start, finish);
    return { node: hooks.node('htmlTable', start, finish, { children: [] }), end: finish };
  }
  const bounds = (element: any): SourceRange => {
    const location = element.sourceCodeLocation;
    if (location) return { start: start + location.startOffset, end: start + location.endOffset };
    const children = (element.childNodes ?? []).filter((n: any) => n.tagName);
    return children.length ? { start: bounds(children[0]).start, end: bounds(children.at(-1)).end } : { start, end: start };
  };
  const blank = (from: number, to: number) => !source.slice(from, to).replace(/<!--[\s\S]*?-->/g, '').trim();
  const convert = (element: any, level: number): LocalNode => {
    const name = element.tagName as string;
    const location = element.sourceCodeLocation;
    const range = bounds(element);
    if (level > 120) {
      hooks.problem('structure', range.start, range.end, name);
      return hooks.node('htmlTableElement', range.start, range.end, { name, children: [] });
    }
    const attrs = location?.startTag ? hooks.attributes(name, start + location.startTag.startOffset, start + location.startTag.endOffset) : {};
    let children: LocalNode[];
    const bodyStart = location?.startTag ? start + location.startTag.endOffset : range.start;
    const bodyEnd = location?.endTag ? start + location.endTag.startOffset : range.end;
    const structuralChildren = (element.childNodes ?? []).filter((n: any) => n.tagName);
    if (name === 'table' && ['caption', 'thead', 'tfoot'].some(tag => structuralChildren.filter((n: any) => n.tagName === tag).length > 1)) {
      hooks.problem('structure', range.start, range.end, name);
    }
    if (name === 'colgroup' && attrs.span !== undefined && structuralChildren.length > 0) {
      hooks.problem('structure', range.start, range.end, name);
    }
    if (name === 'td' || name === 'th' || name === 'caption') {
      children = hooks.content(bodyStart, bodyEnd);
    } else {
      children = [];
      let cursor = bodyStart;
      for (const child of structuralChildren) {
        const childRange = bounds(child);
        if (!blank(cursor, childRange.start)) hooks.problem('mixed', cursor, childRange.start, name);
        if (!(CHILDREN[name] ?? []).includes(child.tagName)) hooks.problem('structure', childRange.start, childRange.end, name);
        else children.push(convert(child, level + 1));
        cursor = childRange.end;
      }
      if (!blank(cursor, bodyEnd)) hooks.problem('mixed', cursor, bodyEnd, name);
    }
    return hooks.node(name === 'table' ? 'htmlTable' : 'htmlTableElement', range.start, range.end, { name, attrs, children });
  };
  return { node: convert(root, 0), end: finish };
}
