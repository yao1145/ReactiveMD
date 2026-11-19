import { GFM, parser as lezerParser } from '@lezer/markdown';
import type { Candidate, MarkdownStructure } from './markdown-blocks';
import remarkGfm from 'remark-gfm';
import { html as nativeHtml } from 'parse5';
import { decodeLocalHtmlAttribute, decodeLocalHtmlEntities } from '../html/html-entities';
import { readHtmlTable } from '../html/html-table';
import { recoverLocalHtml } from '../html/html-recovery';
import type { LocalParserCapabilities } from './parser-capabilities';

/**
 * Optional block-planning strategy based on `@lezer/markdown`.
 *
 * The compiler treats this as advisory: it only proposes top-level block
 * boundaries that the fast planner then re-validates. Assemblies that omit the
 * strategy still compile correctly; they parse the general document as one
 * block instead of splitting it.
 */
const lezer = lezerParser.configure(GFM);

/** Lezer is advisory only: its top-level nodes seed candidate ranges. */
export function scanMarkdownStructure(source: string): MarkdownStructure {
  let parsed: any;
  try {
    // Lezer's line reader is LF-oriented. Normalize only isolated CRs in its
    // advisory view; this keeps every UTF-16 offset and the real source intact.
    parsed = lezer.parse(source.replace(/\r(?!\n)/g, '\n'));
  } catch {
    return { candidates: [], maxDepth: 0, codeRanges: [] };
  }
  const result: Candidate[] = [];
  for (let node = parsed.topNode.firstChild; node; node = node.nextSibling) {
    result.push({ from: node.from, to: node.to, type: node.type.name });
  }
  let depth = 0, maxDepth = 0;
  const codeRanges: { start: number; end: number }[] = [];
  const containers = new Set(['Blockquote', 'BulletList', 'OrderedList']);
  parsed.iterate({
    enter(node: any) {
      if (containers.has(node.name)) { depth++; maxDepth = Math.max(maxDepth, depth); }
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') codeRanges.push({ start: node.from, end: node.to });
    },
    leave(node: any) { if (containers.has(node.name)) depth--; },
  });
  return { candidates: result, maxDepth, codeRanges };
}

/**
 * Parser abilities of the full experience: GFM syntax, native HTML support,
 * isolated HTML repair and Lezer-assisted block planning. The minimal compiler
 * never imports this module.
 */
export const STANDARD_PARSER_CAPABILITIES: LocalParserCapabilities = Object.freeze({
  markdownPlugins: Object.freeze([remarkGfm]),
  html: Object.freeze({
    nativeTagNames: new Set<string>(Object.values(nativeHtml.TAG_NAMES)),
    decodeEntities: (value: string) => decodeLocalHtmlEntities(value, true),
    decodeAttribute: decodeLocalHtmlAttribute,
    readTable: readHtmlTable,
    recoverFragment: recoverLocalHtml,
  }),
  markdownStructure: scanMarkdownStructure,
});
