import { parseFragment } from 'parse5';

/**
 * Decode character references with the browser grammar, never activating
 * markup. This is the shared implementation for the strict HTML parser and
 * the isolated HTML repair pass; `replaceNul` keeps the repaired tree free of
 * NUL characters.
 */
export function decodeLocalHtmlEntities(value: string, replaceNul = false): string {
  const clean = (text: string): string => replaceNul ? text.replace(/\u0000/g, '�') : text;
  if (!value.includes('&')) return clean(value);
  try {
    const fragment = parseFragment(value.replace(/</g, '&lt;'), { scriptingEnabled: false });
    let text = '';
    const walk = (node: any): void => {
      if (node.nodeName === '#text') {
        text += node.value;
        return;
      }
      for (const child of node.childNodes ?? []) walk(child);
      if (node.content?.childNodes) for (const child of node.content.childNodes) walk(child);
    };
    for (const child of fragment.childNodes) walk(child);
    return clean(text);
  } catch {
    return clean(value);
  }
}
