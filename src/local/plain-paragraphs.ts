import type { LocalNode } from './types';

type CreateNode = (type: string, start: number, end: number, extra?: Partial<LocalNode>) => LocalNode;

/**
 * Parse the text-only subset without allocating Markdown tokenizer events.
 * Validate the entire input before constructing nodes: a later definition,
 * delimiter or indented line can change the meaning of earlier paragraphs.
 * Ambiguous inputs return undefined and use the ordinary Markdown pipeline.
 */
export function parsePlainParagraphs(
  source: string,
  markdownBreaks: boolean,
  node: CreateNode,
): LocalNode[] | undefined {
  if (
    /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\ufeff\\`*_{}\[\]<>!~&|$@]/.test(source)
    || /(?:^|[\r\n])(?:[ #>+=-]|\d{1,9}[.)](?: |[\r\n]|$))/.test(source)
    || / [\r\n]/.test(source)
    || source.includes('://') || /www\./i.test(source)
  ) return undefined;

  const nodes: LocalNode[] = [];
  let paragraphStart = -1;
  let paragraphEnd = 0;
  function finishParagraph(): void {
    if (paragraphStart < 0) return;
    // Markdown retains the paragraph's trailing spaces in its range, while
    // the text child's range and value end before them.
    let textEnd = paragraphEnd;
    while (source[textEnd - 1] === ' ') textEnd--;
    const children: LocalNode[] = [];
    if (markdownBreaks) {
      let segment = paragraphStart;
      for (let i = segment; i < textEnd; i++) {
        if (source[i] !== '\r' && source[i] !== '\n') continue;
        if (i > segment) children.push(node('text', segment, i, { value: source.slice(segment, i) }));
        const end = source[i] === '\r' && source[i + 1] === '\n' ? i + 2 : i + 1;
        children.push(node('break', i, end));
        segment = end;
        i = end - 1;
      }
      if (segment < textEnd) children.push(node('text', segment, textEnd, { value: source.slice(segment, textEnd) }));
    } else {
      children.push(node('text', paragraphStart, textEnd, { value: source.slice(paragraphStart, textEnd) }));
    }
    nodes.push(node('paragraph', paragraphStart, paragraphEnd, { children }));
    paragraphStart = -1;
  }
  for (let start = 0; start < source.length;) {
    let end = start;
    while (end < source.length && source[end] !== '\r' && source[end] !== '\n') end++;
    if (end === start) finishParagraph();
    else {
      if (paragraphStart < 0) paragraphStart = start;
      paragraphEnd = end;
    }
    start = source[end] === '\r' && source[end + 1] === '\n' ? end + 2 : end + 1;
  }
  finishParagraph();
  return nodes;
}
