/**
 * P0 native HTML tag names. The parser handles these before component tags, and
 * host component schemas may not reuse them because document parsing would
 * never dispatch such a tag to a host component.
 */
export const LOCAL_HTML_NAMES: ReadonlySet<string> = new Set([
  'b', 'strong', 'i', 'em', 's', 'del', 'u', 'mark', 'sup', 'sub',
  'br', 'hr', 'img',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'span', 'details', 'summary', 'blockquote',
  'code', 'pre', 'ul', 'ol', 'li', 'a',
]);

/** Legacy text alignment accepted as a bounded HTML attribute, without CSS. */
export const LOCAL_HTML_ALIGN_ELEMENTS: ReadonlySet<string> = new Set([
  'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

export function localHtmlAlign(value: string): 'left' | 'center' | 'right' | 'justify' | null {
  const align = value.trim().toLowerCase();
  return align === 'left' || align === 'center' || align === 'right' || align === 'justify' ? align : null;
}
