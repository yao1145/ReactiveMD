import { LOCAL_HTML_ALIGN_ELEMENTS, LOCAL_HTML_ANCHOR_ATTRIBUTES, localHtmlAlign } from './html-names';
import { HTML_TABLE_ATTRIBUTES, validHtmlTableValue } from './html-table';

/**
 * Shared P0 HTML policy and raw tag scanning.
 *
 * The strict Markdown parser, the structural recovery planner and the isolated
 * HTML repair pass must agree on which tags, attributes and URL shapes are
 * accepted. Keeping the tables and the lexical scanners here means a change to
 * the accepted surface reaches every consumer, while each pass keeps its own
 * structural decisions.
 */

/** Inline P0 names and the Markdown node type they lower to. */
export const HTML_INLINE_NODE_TYPES: Readonly<Record<string, string>> = {
  b: 'strong',
  strong: 'strong',
  i: 'emphasis',
  em: 'emphasis',
  s: 'delete',
  del: 'delete',
  u: 'underline',
  mark: 'mark',
  sup: 'sup',
  sub: 'sub',
};

/** Elements with no end tag in HTML, including the table-only `col`. */
export const HTML_VOID_ELEMENTS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'col']);

/** Raw-text elements: markup-looking text inside them is inert source. */
export const HTML_RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'pre', 'code', 'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext',
]);

/** Attributes accepted on every P0 element. */
export const HTML_GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set(['id', 'title', 'lang', 'dir']);

/** Per-tag attribute surface beyond globals, ARIA and `data-*`. */
export const HTML_TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: LOCAL_HTML_ANCHOR_ATTRIBUTES,
  img: new Set(['src', 'alt', 'width', 'height']),
  ol: new Set(['start']),
  details: new Set(['open']),
  ...HTML_TABLE_ATTRIBUTES,
};

/**
 * End offset (exclusive) of the tag starting at `from`, honoring quoted
 * attribute values. Returns -1 when no `>` is found before `limit`.
 */
export function htmlTagEnd(source: string, from: number, limit: number): number {
  let quote = '';
  for (let index = from; index < limit; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

/**
 * End offset of the comment starting at `start`. `<!-->` and `<!--->` are
 * empty comments that end at their first `>`; searching only for `-->` would
 * hide following markup from the validator.
 */
export function htmlCommentEnd(source: string, start: number, limit: number): number {
  if (source.startsWith('<!-->', start)) return Math.min(limit, start + 5);
  if (source.startsWith('<!--->', start)) return Math.min(limit, start + 6);
  const close = source.indexOf('-->', start + 4);
  return close < 0 || close + 3 > limit ? limit : close + 3;
}

/** URL comparison form: trimmed with embedded controls and spaces removed. */
export function normalizedHtmlUrl(value: string): string {
  return value.trim().replace(/[\u0000- ]+/g, '');
}

/** True when a URL scheme would escape the accepted P0 link/image surface. */
export function unsafeHtmlUrl(value: string, kind: 'link' | 'image'): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalizedHtmlUrl(value));
  if (!scheme) return false;
  const name = scheme[1].toLowerCase();
  if (kind === 'image') return name !== 'http' && name !== 'https';
  return name !== 'http' && name !== 'https' && name !== 'mailto' && name !== 'tel';
}

/**
 * Attribute-name policy. `align` is handled separately because callers
 * normalize it; `class`, `style` and event handlers never activate.
 */
export function isHtmlAttributeNameAllowed(tag: string, name: string): boolean {
  if (name === 'class' || name === 'style' || /^on[a-z]/i.test(name)) return false;
  if (name === 'align' && LOCAL_HTML_ALIGN_ELEMENTS.has(tag)) return true;
  if (HTML_GLOBAL_ATTRIBUTES.has(name)) return true;
  if (/^aria-[a-z0-9_.-]+$/.test(name) || /^data-[a-z0-9_.-]+$/.test(name)) return true;
  return HTML_TAG_ATTRIBUTES[tag]?.has(name) ?? false;
}

/** Value policy shared by inline HTML and isolated HTML repair. */
export function isValidHtmlAttributeValue(name: string, value: string): boolean {
  if (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(value.trim().toLowerCase())) return false;
  if (name === 'id' && value.trim() === '') return false;
  if ((name === 'width' || name === 'height') && !/^\d{1,6}$/.test(value.trim())) return false;
  if (name === 'start' && !/^-?\d{1,9}$/.test(value.trim())) return false;
  if (!validHtmlTableValue(name, value)) return false;
  if (name === 'href' && unsafeHtmlUrl(value, 'link')) return false;
  if (name === 'src' && unsafeHtmlUrl(value, 'image')) return false;
  return true;
}

/** Normalized `align` value for a tag that declares it, or null. */
export function htmlAlignValue(tag: string, value: string): string | null {
  return LOCAL_HTML_ALIGN_ELEMENTS.has(tag) ? localHtmlAlign(value) : null;
}
