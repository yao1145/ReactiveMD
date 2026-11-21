import { htmlTagEnd } from '../html/html-policy';
import type { SourceRange } from '../types';

/** Repair the first Markdown code range that crosses a raw author block's end. */
export function maskLeakingAuthorBody(
  source: string,
  code: readonly SourceRange[],
  definitions: readonly SourceRange[],
  registered: { has(name: string): boolean },
  from: number,
): { source: string; end: number } | undefined {
  if (!code.length) return;
  const tags = /^[\t ]*<(css|javascript)(?=[\s/>])/gm;
  tags.lastIndex = from;
  let codeIndex = 0;
  let definitionIndex = 0;
  for (const match of source.matchAll(tags)) {
    const name = match[1];
    if (registered.has(name)) continue;
    const start = match.index + match[0].indexOf('<');
    while (code[codeIndex]?.end <= start) codeIndex++;
    while (definitions[definitionIndex]?.end <= start) definitionIndex++;
    if (code[codeIndex]?.start <= start || definitions[definitionIndex]?.start <= start) continue;
    const head = match.index + match[0].length;
    const body = htmlTagEnd(source, head, source.length);
    if (body < 0 || /\/\s*>$/.test(source.slice(head, body))) continue;
    const closeTag = new RegExp(`</${name}\\s*>`, 'ig');
    closeTag.lastIndex = body;
    const close = closeTag.exec(source);
    if (!close) continue;
    const end = closeTag.lastIndex;
    for (let index = codeIndex; code[index]?.start < close.index; index++) {
      const range = code[index];
      if (range.start < body || range.end <= end) continue;
      // Keep source positions and line endings. The region scanner still
      // reads and emits the original declaration body.
      return { source: source.slice(0, body) + source.slice(body, close.index).replace(/[^\r\n]/g, ' ') + source.slice(close.index), end };
    }
  }
}
