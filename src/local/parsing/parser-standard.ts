import remarkGfm from 'remark-gfm';
import { html as nativeHtml } from 'parse5';
import { decodeLocalHtmlAttribute, decodeLocalHtmlEntities } from '../html/html-entities';
import { readHtmlTable } from '../html/html-table';
import { recoverLocalHtml } from '../html/html-recovery';
import { scanMarkdownStructure } from '../markdown/markdown-structure';
import type { LocalParserCapabilities } from './parser-capabilities';

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
