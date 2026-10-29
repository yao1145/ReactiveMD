import {HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';

// Semantic author tokens and Lezer's lexical fallback use the same palette.
// Stable classes keep CSS variables responsive to light/dark/automatic themes.
export const sourceHighlightStyle=HighlightStyle.define([
  {tag:[tags.tagName,tags.angleBracket,tags.processingInstruction],class:'rmd-syntax-tag'},
  {tag:tags.attributeName,class:'rmd-syntax-attribute'},
  {tag:[tags.attributeValue,tags.string],class:'rmd-syntax-string'},
  {tag:tags.comment,class:'rmd-syntax-comment'},
  {tag:tags.monospace,class:'rmd-syntax-code'},
  {tag:[tags.heading,tags.emphasis,tags.strong,tags.strikethrough,tags.link,tags.url,tags.quote,tags.list,tags.contentSeparator,tags.meta],class:'rmd-syntax-markdown'},
]);
