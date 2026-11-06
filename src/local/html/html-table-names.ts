import { localHtmlAlign } from './html-names';

/**
 * Theme-free table vocabulary shared by the parser, HTML policy and audit
 * passes. Kept separate from `html-table.ts` so importing the accepted names
 * never pulls the HTML parser into a compiler assembly that does not use it.
 */

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
