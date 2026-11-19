import type { LanguageFn } from 'highlight.js';

/** Cattca embeds command blocks in Markdown narrative. */
export const cattca: LanguageFn = hljs => ({
  name: 'Cattca',
  subLanguage: 'markdown',
  contains: [
    hljs.C_BLOCK_COMMENT_MODE,
    {
      begin: /<\//,
      end: /\/>/,
      relevance: 10,
      keywords: {
        keyword: 'let set apply label goto if exit input case text log random',
        literal: 'true false null undefined',
      },
      contains: [
        hljs.C_BLOCK_COMMENT_MODE,
        hljs.QUOTE_STRING_MODE,
        hljs.APOS_STRING_MODE,
        hljs.C_NUMBER_MODE,
        {scope: 'operator', match: /->|===?|!==?|<=?|>=?|&&|\|\||[+*/%!-]/},
      ],
    },
  ],
});

/** Highlight Mermaid source as code; rendering diagrams is a separate feature. */
export const mermaid: LanguageFn = hljs => ({
  name: 'Mermaid',
  aliases: ['mmd'],
  keywords: {
    keyword: 'graph flowchart sequenceDiagram classDiagram stateDiagram stateDiagram-v2 '
      + 'erDiagram gantt pie journey gitGraph mindmap timeline quadrantChart '
      + 'requirementDiagram sankey-beta xychart-beta block-beta packet-beta architecture-beta '
      + 'subgraph end direction participant actor activate deactivate loop alt else opt par and '
      + 'critical break rect Note note over left right of as autonumber title accTitle accDescr '
      + 'section class classDef style linkStyle click callback href state fork join choice '
      + 'dateFormat axisFormat excludes todayMarker milestone done active after',
    literal: 'TD TB BT LR RL true false',
  },
  contains: [
    {scope: 'meta', begin: /%%\{/, end: /\}%%/},
    hljs.COMMENT(/%%/, /$/),
    hljs.QUOTE_STRING_MODE,
    hljs.APOS_STRING_MODE,
    {scope: 'string', begin: /\[/, end: /\]/, contains: [hljs.QUOTE_STRING_MODE]},
    {scope: 'operator', match: /(?:<\|?|[ox])?[-=.]{1,3}(?:>|\|>|[ox])?|:::/},
    hljs.C_NUMBER_MODE,
  ],
});

/** Vue SFCs combine HTML templates, JavaScript/TypeScript and CSS/SCSS. */
export const vue: LanguageFn = hljs => ({
  name: 'Vue',
  disableAutodetect: true,
  subLanguage: 'xml',
  contains: [
    hljs.COMMENT(/<!--/, /-->/),
    {
      begin: /<script\b(?=[^>]*\blang\s*=\s*["'](?:ts|typescript)["'])[^>]*>/,
      end: /<\/script\s*>/,
      excludeBegin: true,
      excludeEnd: true,
      subLanguage: 'typescript',
    },
    {
      begin: /<script\b[^>]*>/,
      end: /<\/script\s*>/,
      excludeBegin: true,
      excludeEnd: true,
      subLanguage: 'javascript',
    },
    {
      begin: /<style\b(?=[^>]*\blang\s*=\s*["']scss["'])[^>]*>/,
      end: /<\/style\s*>/,
      excludeBegin: true,
      excludeEnd: true,
      subLanguage: 'scss',
    },
    {
      begin: /<style\b[^>]*>/,
      end: /<\/style\s*>/,
      excludeBegin: true,
      excludeEnd: true,
      subLanguage: 'css',
    },
    {
      begin: /\{\{/,
      end: /\}\}/,
      excludeBegin: true,
      excludeEnd: true,
      subLanguage: 'javascript',
    },
  ],
});
