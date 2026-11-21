import { MAX_LOCAL_STRING_LENGTH } from '../configuration/limits';
import type {
  Diagnostic,
  LocalNode,
  LocalRecovery,
  LocalVersionDeclaration,
  SourceRange,
} from '../types';
import { ParseWorkBudget } from './parse-budget';
import type { NormalizedComponent } from '../configuration/component-kernel';
import type { LocalParserCapabilities, LocalParserHtmlCapability } from './parser-capabilities';
import { MappedSource, SourceContext } from '../source/source-context';
import type { ParserWork } from './parser-core';
import {
  BLOCK_HTML_RESULTS,
  HTML_NAMES,
  LocalBudgetError,
  NATIVE_HTML_VOID,
  type ConvertOptions,
  type CreateNode,
  type DefinitionRange,
  type ParseDiagnostic,
  type ParseMarkdown,
  type RegionOptions,
  type RegionResult,
  type Token,
} from './parser-internals';
import type { createTagScanner } from './parser-tags';
import { markdownTreeFacts } from './markdown-blocks';
import { HTML_RAW_TEXT_ELEMENTS, HTML_VOID_ELEMENTS, htmlCommentEnd } from '../html/html-policy';
import { LOCAL_SYNTAX_VERSION } from '../types';
import {
  isThemeTagAt,
  skipThemePrefix,
  standaloneTheme,
  themeNameFrom,
  themeTagAt,
} from './theme-declaration';
import { HTML_TABLE_NAMES } from '../html/html-table-names';
import { closestName } from '../configuration/schema-core';

const TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const HTML_BLOCK = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'details', 'blockquote', 'pre', 'ul', 'ol', 'li',
]);

const MAX_LOCAL_NAME_LENGTH = 128;

/** Conditional document declaration names. A registered component wins first. */
const DECLARATION_NAMES: ReadonlySet<string> = new Set(['css', 'javascript']);

/**
 * Additive native HTML subtrees recognized beyond the basic mixed surface.
 * Registered RMD tags and the basic P0 names always take precedence, so these
 * are only reached when no component owns the name.
 */
const EXTENDED_HTML_NAMES: ReadonlySet<string> = new Set([
  'iframe', 'dl', 'section', 'figure', 'figcaption',
]);

/** Displayed math source, in UTF-16 code units, per formula. */
const MAX_DISPLAY_MATH_SOURCE = Math.min(50_000, MAX_LOCAL_STRING_LENGTH);

/** Component nesting depth, counted per parse call chain. */
const MAX_COMPONENT_DEPTH = 100;

// Markdown destinations use backslashes to escape parentheses/brackets.
// Only labels are prose; a destination, title, or image is never TeX.
function inMathLiteral(ranges: readonly SourceRange[], offset: number): boolean {
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (offset < range.start) high = middle - 1;
    else if (offset >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

export interface DocumentHeaders {
  theme?: string;
  themeRange?: SourceRange;
  themeHeaders: number;
  headerCursor: number;
  versionDeclaration?: LocalVersionDeclaration;
  versionHeaders: number;
}

interface RegionScannerOptions {
  source: string;
  diagnostics: Diagnostic[];
  maxSyntaxNodes: number;
  strict: boolean;
  budget: ParseWorkBudget;
  known: ReadonlyMap<string, NormalizedComponent>;
  externalNames: ReadonlySet<string>;
  unmountedLeafNames: ReadonlySet<string>;
  suggestionNames: string[];
  htmlSupport?: LocalParserHtmlCapability;
  nativeHtmlNames: ReadonlySet<string>;
  sourceContext: SourceContext;
  work: ParserWork;
  ensureDepth: (text: string) => void;
  parseMarkdown: ParseMarkdown;
  node: CreateNode;
  codeRanges: SourceRange[];
  recoveryRanges: readonly SourceRange[];
  recoveries: LocalRecovery[];
  rootMathLiterals: SourceRange[];
  rootDefinitionRanges: DefinitionRange[];
  error: ParseDiagnostic;
  warning: ParseDiagnostic;
  headers: DocumentHeaders;
  scanner: ReturnType<typeof createTagScanner>;
  convert: (start: number, end: number, tokens: Token[], indent?: number, options?: ConvertOptions) => LocalNode[];
}

export function createRegionScanner({
  source, diagnostics, maxSyntaxNodes, strict, budget, known, externalNames,
  unmountedLeafNames, suggestionNames, htmlSupport, nativeHtmlNames, sourceContext,
  work, ensureDepth, parseMarkdown, node, codeRanges, recoveryRanges, recoveries,
  rootMathLiterals, rootDefinitionRanges, error, warning, headers, scanner, convert,
}: RegionScannerOptions) {
  const {
    tagAt, scanTag, htmlLiteralEnd, beginsLine, footnoteLabelAt, definitionLabelAt,
    htmlTagAt, htmlCloseEnd, selectHtmlAttributes, buildHtmlNode, protectedEnd,
    unknownTagEnd, interpolationEnd, commonIndent,
  } = scanner;
  let codeIndex = 0;
  /** A top-level `<javascript>` ends the leading CSS region. */
  let scriptSeen = false;
  /**
   * Once the leading metadata region is broken by body content, no later
   * declaration can join it. Caching that fact keeps repeated late blocks from
   * rescanning the same prefix.
   */
  let headerBlocked = false;

  /**
   * True when only leading metadata separates `headerCursor` from `offset`.
   * The scan is limited to `offset`, so the element at `offset` is not part of
   * its own prefix.
   */
  function inHeaderPrefix(offset: number): boolean {
    if (headerBlocked) return false;
    if (headerSkip(headers.headerCursor, offset) === offset) return true;
    headerBlocked = true;
    return false;
  }

  /** Declaration blocks sit on their own line; a leading BOM is not content. */
  function declarationLineStart(offset: number): boolean {
    const start = sourceContext.lineStartAt(offset);
    for (let index = start; index < offset; index += 1) {
      const code = source.charCodeAt(index);
      if (code !== 0xfeff && code !== 0x20 && code !== 0x09) return false;
    }
    return true;
  }

  /** First `</name>` after `from`, as raw-text content requires. */
  function rawClose(from: number, name: string, limit: number): { start: number; end: number } | null {
    const closing = new RegExp(`</${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'i');
    const match = closing.exec(source.slice(from, limit));
    return match ? { start: from + match.index, end: from + match.index + match[0].length } : null;
  }

  /**
   * Leading metadata may mix whitespace, comments, `<theme>` declarations and
   * document CSS blocks. Returns the offset reached, or -1 for an unterminated
   * comment (the prefix is then unsafe). The syntax declaration must precede
   * the theme, so its placement check disables theme skipping.
   */
  function headerSkip(from: number, to: number, skipThemes = true): number {
    let index = from;
    while (index < to) {
      const character = source[index];
      if (character.charCodeAt(0) === 0xfeff || character === ' ' || character === '\t'
        || character === '\r' || character === '\n') {
        index += 1;
        continue;
      }
      if (source.startsWith('<!--', index)) {
        const close = source.indexOf('-->', index + 4);
        if (close < 0 || close + 3 > to) return -1;
        index = close + 3;
        continue;
      }
      if (skipThemes && isThemeTagAt(source, index)) {
        const theme = themeTagAt(source, index, to);
        if (theme && !theme.closing && !theme.unclosed && standaloneTheme(source, theme)) {
          index = theme.end;
          continue;
        }
        return index;
      }
      const css = declarationAt(index, to);
      if (css && css.name === 'css' && css.close && !known.has('css')) {
        index = css.close.end;
        continue;
      }
      break;
    }
    return index;
  }

  /**
   * Read a document declaration (`<css>` / `<javascript>`). The body is an
   * exact source slice: no trimming, dedenting or line-ending changes, so
   * every following offset still points at the original document.
   */
  function declarationAt(start: number, limit: number): {
    name: 'css' | 'javascript';
    open: { end: number; self: boolean };
    close: { start: number; end: number } | null;
  } | null {
    const match = /^<(css|javascript)(?=[\s/>])/.exec(source.slice(start, Math.min(limit, start + 16)));
    if (!match) return null;
    const name = match[1] as 'css' | 'javascript';
    const scanned = scanTag(start, limit);
    if (!scanned || scanned.closing) return null;
    // A self-closing declaration never borrows a later closing tag.
    return {
      name,
      open: { end: scanned.end, self: scanned.self },
      close: scanned.self ? null : rawClose(scanned.end, name, limit),
    };
  }

  function region(start: number, end: number, parent?: string, openStart = start, openEnd = start, depth = 0, options: RegionOptions = {}): RegionResult {
    const tokens: Token[] = [];
    if (end > start) budget.charge(end - start, start, end);
    work.maxComponentDepth=Math.max(work.maxComponentDepth,depth);
    if (depth > MAX_COMPONENT_DEPTH) {
      throw new LocalBudgetError('local.budget','Component nesting exceeds the 100-level limit.',openStart,openEnd,'local.budget.nesting',{limit:MAX_COMPONENT_DEPTH});
    }
    const footnoteMode = options.footnote === true;
    const insideContainer = options.container ?? parent !== undefined;
    let contentIndent = options.indent ?? 0;
    // Raw component tags can hide footnote definitions from the document's
    // first Markdown pass. Re-scan each dedented body for definition ranges so
    // a definition inside a container still becomes a real footnote node.
    let regionDefinitions: readonly DefinitionRange[] = options.definitions ?? rootDefinitionRanges;
    let mathLiterals: readonly SourceRange[] = rootMathLiterals;
    // 根层代码块来自全文 Markdown 解析；容器正文被组件标签遮住，需按去缩进
    // 后的正文重新确定代码块（缩进代码、引用/列表里的围栏），使其保持原文。
    let containerCode: readonly SourceRange[] = [];
    if (parent) {
      const bodyEnd = unknownTagEnd(start, parent, end, true)?.start ?? end;
      const indent = commonIndent(start, bodyEnd);
      contentIndent = indent;
      const mapped = new MappedSource(sourceContext);
      mapped.original(start, bodyEnd, indent); mapped.finish(bodyEnd);
      work.mappingSegments+=mapped.segmentCount;
      const text = mapped.text();
      // Definitions/images need `[`, autolinks need a protocol, `www.` or an
      // email `@`. Code blocks need four columns of indentation or a fence
      // after a quote/list prefix (line-leading fences are already shielded
      // lexically). Without these features there are no facts to find.
      // Retain the same deterministic work/depth charges on this shortcut.
      let facts:{definitions:SourceRange[];mathLiterals:SourceRange[];codeRanges:SourceRange[]};
      if(!/[\[:@]|www\./i.test(text)&&!/^[ \t>*+\-0-9.)]*(?: {4}|\t|`{3}|~{3})/m.test(text)){
        budget.charge(text.length+1,0,Math.max(1,text.length));
        ensureDepth(text);
        facts={definitions:[],mathLiterals:[],codeRanges:[]};
      }else facts=markdownTreeFacts(parseMarkdown(text),false);
      const translate=(range:SourceRange):SourceRange=>({start:mapped.at(range.start,bodyEnd),end:mapped.at(range.end,bodyEnd)});
      const found=facts.definitions.map(translate).filter(range=>range.end>range.start);
      const literals=facts.mathLiterals.map(translate);
      mathLiterals = literals.sort((a, b) => a.start - b.start);
      containerCode = facts.codeRanges.map(translate)
        .filter(range => range.end > range.start && range.start >= start && range.end <= bodyEnd)
        .sort((a, b) => a.start - b.start);
      regionDefinitions = found
        .filter(range => range.start >= start && range.end <= bodyEnd)
        .sort((a, b) => a.start - b.start || b.end - a.end);
    } else if (start > 0 && options.definitions !== undefined && !footnoteMode) {
      // HTML bodies can be opaque to the root Markdown pass, just like
      // component bodies. Discover destinations without changing note scope.
      const literals=markdownTreeFacts(parseMarkdown(source.slice(start,end))).mathLiterals.map(range=>({start:range.start+start,end:range.end+start}));
      mathLiterals = literals.sort((a, b) => a.start - b.start);
    }
    let definitionIndex = 0;
    let containerCodeIndex = 0;
    // Recovery spans are single literal tokens: their content is never
    // re-parsed for components, bindings, interpolation, math or Markdown.
    let recoveryIndex = 0;
    while (recoveryIndex < recoveryRanges.length && recoveryRanges[recoveryIndex].end <= start) recoveryIndex += 1;
    for (let i = start; i < end;) {
      while (recoveryIndex < recoveryRanges.length && recoveryRanges[recoveryIndex].end <= i) recoveryIndex += 1;
      const recovery = recoveryRanges[recoveryIndex];
      if (recovery && recovery.start <= i && i < recovery.end) {
        const stop = Math.min(end, recovery.end);
        tokens.push({
          start: i,
          end: stop,
          block: beginsLine(i),
          node: node('fallback', i, stop, { value: source.slice(i, stop) }),
        });
        i = stop;
        continue;
      }
      if (!insideContainer) {
        while (codeRanges[codeIndex]?.end <= i) codeIndex++;
        const code = codeRanges[codeIndex];
        if (code && code.start <= i) { i = code.end; continue; }
      } else if (containerCode.length) {
        while (containerCode[containerCodeIndex]?.end <= i) containerCodeIndex++;
        const code = containerCode[containerCodeIndex];
        if (code && code.start <= i) { i = code.end; continue; }
      }
      // Definitions are real Markdown blocks even when the surrounding
      // component tag hides them from the document-wide Markdown pass.
      while (regionDefinitions[definitionIndex]?.end <= i) definitionIndex++;
      const definition = regionDefinitions[definitionIndex];
      if (definition && definition.start === i) {
        let labelStart = i;
        let marker = definitionLabelAt(labelStart);
        // Block positions may include up to three leading spaces before `[`.
        while (!marker && labelStart - i < 4 && labelStart < definition.end
          && (source[labelStart] === ' ' || source[labelStart] === '\t')) {
          labelStart += 1;
          marker = definitionLabelAt(labelStart);
        }
        if (marker && marker.bodyStart <= definition.end) {
          const lineStart = sourceContext.lineStartAt(labelStart);
          const prefix = source.slice(lineStart, labelStart);
          const quotePrefix = /^(?:[ \t]{0,3}>[ \t]?)+/.exec(prefix)?.[0] ?? '';
          const definitionIndent = /^[ \t]*/.exec(prefix.slice(quotePrefix.length))![0].length;
          const bodyIndent = definitionIndent + 4;
          const body = region(marker.bodyStart, definition.end, undefined, marker.bodyStart, marker.bodyStart, depth + 1, {
            footnote: true,
            indent: bodyIndent,
            container: insideContainer || definitionIndent > 0,
            definitions: [],
            stripBlockquote: quotePrefix.length > 0,
          });
          const children = convert(marker.bodyStart, definition.end, body.tokens, bodyIndent, { literalHtml: true, stripBlockquote: quotePrefix.length > 0 });
          tokens.push({
            start: definition.start,
            end: definition.end,
            block: true,
            node: node('footnoteDefinition', definition.start, definition.end, {
              identifier: marker.identifier,
              label: marker.label,
              children,
            }),
          });
          i = definition.end;
          definitionIndex += 1;
          continue;
        }
        // A malformed definition keeps its source as ordinary Markdown text.
        definitionIndex += 1;
      }
      // TeX-style delimiters precede Markdown backslash escapes. Code ranges,
      // fences and inline-code spans are still shielded by the surrounding
      // scan. Plot deliberately retains its $$...$$-only body grammar.
      // Imported Markdown sometimes retains escaped display wrappers. Only
      // accept padded \\[ ... \\] wrappers so ordinary escaped brackets stay literal.
      const escapedDisplay = source.startsWith('\\\\[', i) && /\s/.test(source[i + 3] ?? '');
      if (!footnoteMode && parent !== 'plot' && source[i] === '\\'
        && (source[i + 1] === '(' || source[i + 1] === '[' || escapedDisplay) && !inMathLiteral(mathLiterals, i)) {
        const display = escapedDisplay || source[i + 1] === '[';
        const delimiterLength = escapedDisplay ? 3 : 2;
        const closing = display ? ']' : ')';
        let stop = i + delimiterLength;
        while (stop < end) {
          if (source[stop] === '\\') {
            if (escapedDisplay
              ? source.startsWith('\\\\]', stop) && stop + 2 < end && /\s/.test(source[stop - 1] ?? '')
              : source[stop + 1] === closing && stop + 1 < end) break;
            stop += 2;
          } else stop++;
        }
        if (stop >= end) {
          error('local.math.unclosed', { key: 'local.math.unclosed' }, i, end);
          i = end;
          continue;
        }
        const finish = stop + delimiterLength;
        let value = source.slice(i + delimiterLength, stop);
        if (value.length > MAX_DISPLAY_MATH_SOURCE) {
          error('local.budget.math', { key: 'local.budget.math', params: { limit: MAX_DISPLAY_MATH_SOURCE } }, i, finish);
          value = value.slice(0, MAX_DISPLAY_MATH_SOURCE);
        }
        tokens.push({ start: i, end: finish, node: node(display ? 'math' : 'inlineMath', i, finish, { value }) });
        i = finish;
        continue;
      }
      const shield = protectedEnd(i, end, insideContainer);
      if (shield !== null) { i = shield; continue; }
      if (source.startsWith('<!--', i)) {
        const stop = htmlCommentEnd(source, i, end);
        const comment = source.slice(i, stop);
        if (!footnoteMode && /^<!--\s*reactive-md(?=[\s:]|-->|$)/i.test(comment)) {
          headers.versionHeaders += 1;
          const lineStart = sourceContext.lineStartAt(i);
          const nextLine = source.indexOf('\n', stop);
          const standalone = /^\s*$/.test(source.slice(lineStart, i))
            && /^\s*$/.test(source.slice(stop, nextLine < 0 ? source.length : nextLine));
          const match = /^<!--[ \t]*reactive-md:[ \t]*(local-draft-[1-9][0-9]*)[ \t]*-->$/.exec(comment);
          if (headers.versionHeaders > 1) {
            error('local.version.duplicate', 'Only one source syntax declaration is allowed.', i, stop);
          } else if (!match || /[\r\n]/.test(comment)) {
            error('local.version.malformed', `Use <!-- reactive-md: ${LOCAL_SYNTAX_VERSION} --> on one line.`, i, stop);
          } else {
            headers.versionDeclaration = { version: match[1], range: { start: i, end: stop } };
            // The syntax declaration must precede the theme: skipping themes
            // here would accept a swapped header order.
            if (parent !== undefined || !standalone || skipThemePrefix(source, 0, i) !== i) {
              error('local.version.placement', 'The syntax declaration must be on its own line before the theme and document body.', i, stop);
            } else if (match[1] !== LOCAL_SYNTAX_VERSION) {
              error('local.version.unsupported', {
                key: 'local.version.unsupported', params: { declared: match[1], supported: LOCAL_SYNTAX_VERSION },
              }, i, stop);
            }
          }
        }
        tokens.push({ start: i, end: stop, node: node('comment', i, stop) }); i = stop; continue;
      }
      if (!footnoteMode && source.startsWith('{{', i)) {
        const stop = interpolationEnd(i, end);
        if (stop < 0) { error('local.interpolation', { key: 'local.interpolation.unclosed' }, i, end); i += 2; continue; }
        tokens.push({ start: i, end: stop, node: node('interpolation', i, stop, { value: source.slice(i + 2, stop - 2).trim() }) }); i = stop; continue;
      }
      if (!footnoteMode && source[i] === '$') {
        const display = source[i + 1] === '$', delimiter = display ? '$$' : '$';
        if (display) {
          let stop = i + delimiter.length;
          for (; stop < end; stop++) {
            if (source[stop] === '\\') { stop++; continue; }
            if (source.startsWith(delimiter, stop)) break;
          }
          if (stop >= end || !source.startsWith(delimiter, stop)) { error('local.math.unclosed', { key: 'local.math.unclosed' }, i, undefined); i += delimiter.length; continue; }
          let value = source.slice(i + delimiter.length, stop);
          if (value.length > MAX_DISPLAY_MATH_SOURCE) {
            error('local.budget.math', { key: 'local.budget.math', params: { limit: MAX_DISPLAY_MATH_SOURCE } }, i, stop + delimiter.length);
            value = value.slice(0, MAX_DISPLAY_MATH_SOURCE);
          }
          const finish = stop + delimiter.length;
          tokens.push({ start: i, end: finish, node: node('math', i, finish, { value }) }); i = finish; continue;
        }
        // A single dollar only opens inline math at an explainable boundary.
        // Currency such as `$5 and $10` stays literal: the closer must not be
        // immediately followed by a digit, and the content must contain a
        // non-whitespace character. The first `$` that fails this boundary ends the current
        // match, so a later, well-formed formula is still recognized on its own.
        let stop = i + 1;
        let close = -1;
        for (; stop < end; stop++) {
          const character = source[stop];
          if (character === '\\') { stop++; continue; }
          if (character === '\n' || character === '\r') break;
          if (character !== '$') continue;
          const value = source.slice(i + 1, stop);
          const after = source[stop + 1];
          if (!value.trim()) break;
          // A tight numeric opener followed by prose is a price, not a formula.
          // Do not consume the opening `$` of a later formula as its closer.
          if (/\s$/.test(value) && /^\d[\d.,]*(?:[，、；：。！？]|[.,;:!?]\s|\s+(?:and|or|to|each|per|for)\b)/i.test(value)) break;
          if (after !== undefined && after >= '0' && after <= '9') break;
          close = stop;
          break;
        }
        if (close < 0) { i += 1; continue; }
        let value = source.slice(i + 1, close);
        if (value.length > MAX_DISPLAY_MATH_SOURCE) {
          error('local.budget.math', { key: 'local.budget.math', params: { limit: MAX_DISPLAY_MATH_SOURCE } }, i, close + 1);
          value = value.slice(0, MAX_DISPLAY_MATH_SOURCE);
        }
        const finish = close + 1;
        tokens.push({ start: i, end: finish, node: node('inlineMath', i, finish, { value }) }); i = finish; continue;
      }
      if (source[i] === '[') {
        const reference = footnoteLabelAt(i, end);
        // `[^label]:` only opens a definition at the start of a line; anywhere
        // else it is an ordinary footnote call followed by a colon.
        if (reference && (source[reference.closeEnd] !== ':' || !beginsLine(i))) {
          tokens.push({
            start: i,
            end: reference.closeEnd,
            node: node('footnoteReference', i, reference.closeEnd, {
              identifier: reference.identifier,
              label: reference.label,
            }),
          });
          i = reference.closeEnd;
          continue;
        }
      }
      if (source[i] === '<') {
        // Document declarations are line-leading blocks and conditional names:
        // a registered component with the same tag always wins. A declaration
        // name inside running prose is inert source.
        const declared = footnoteMode ? null : declarationAt(i, end);
        const atLine = declared !== null && declarationLineStart(i);
        // A declaration never swallows its enclosing container's close tag.
        let declarationClose: { start: number; end: number } | null = null;
        if (declared) {
          const raw = declared.close;
          const parentClose = parent === undefined ? null : rawClose(i, parent, end);
          declarationClose = raw && (!parentClose || raw.end <= parentClose.start) ? raw : null;
        }
        if (declared && !atLine && !known.has(declared.name)) {
          // A declaration inside running prose never splits the paragraph's
          // Markdown: only a single-line block is claimed as a whole.
          const inline = declarationClose !== null
            && !/\r?\n[\t ]*\r?\n/.test(source.slice(declared.open.end, declarationClose.start));
          const stop = inline ? declarationClose!.end : declared.open.end;
          warning('local.author.placement', { key: 'local.author.placement' }, i, stop);
          tokens.push({ start: i, end: stop, block: false, node: node('fallback', i, stop, { value: source.slice(i, stop) }) });
          i = stop;
          continue;
        }
        if (declared && atLine && !known.has(declared.name)) {
          // Declarations must be standalone, leading (CSS) or top-level
          // (JavaScript); anything else stays inert source with a warning.
          const top = parent === undefined && depth === 0;
          const header = top && !scriptSeen && inHeaderPrefix(i);
          const block = declarationClose ? declarationClose.end : (declared.open.self ? declared.open.end : end);
          const legal = declared.name === 'javascript' ? top : header;
          const fallback = () => {
            tokens.push({ start: i, end: block, block: true, node: node('fallback', i, block, { value: source.slice(i, block) }) });
            i = block;
          };
          if (declared.open.self) {
            warning('local.author.placement', { key: 'local.author.placement' }, i, declared.open.end);
            fallback();
            continue;
          }
          if (!declarationClose) {
            // An in-progress declaration only claims its own fragment; later
            // healthy nodes keep compiling from the recovery boundary.
            const stop = htmlLiteralEnd(declared.open.end, end, parent);
            warning('local.author.unclosed', { key: 'local.author.unclosed', params: { name: declared.name } }, i, stop);
            tokens.push({ start: i, end: stop, block: true, node: node('fallback', i, stop, { value: source.slice(i, stop) }) });
            i = stop;
            continue;
          }
          if (!legal) {
            warning(declared.name === 'css' ? 'local.author.css-placement' : 'local.author.script-placement',
              { key: declared.name === 'css' ? 'local.author.css-placement' : 'local.author.script-placement' },
              i, declarationClose.end);
            fallback();
            continue;
          }
          if (declared.name === 'javascript' && top) scriptSeen = true;
          const type = declared.name === 'css' ? 'authorCss' : 'authorJavaScript';
          tokens.push({
            start: i,
            end: declarationClose.end,
            block: true,
            node: node(type, i, declarationClose.end, { value: source.slice(declared.open.end, declarationClose.start) }),
          });
          // Only a declaration still contiguous with the leading region
          // advances the cursor; a mid-body script must not make a later theme
          // look like leading metadata.
          if (header) headers.headerCursor = declarationClose.end;
          i = declarationClose.end;
          continue;
        }
        if (htmlSupport) {
        const htmlDiagnosticStart = diagnostics.length;
        let invalidNativeTable = false;
        let nativeTable: ReturnType<NonNullable<LocalParserCapabilities['html']>['readTable']>;
        try {
          nativeTable = htmlSupport.readTable(source, i, end, {
          shield: (offset: number, limit: number) => {
            if (source.startsWith('{{', offset)) {
              const finish = interpolationEnd(offset, limit);
              if (finish >= 0) return finish;
            }
            if (source[offset] === '<') {
              const tag = scanTag(offset, limit);
              if (tag && !tag.closing && !HTML_TABLE_NAMES.has(tag.name.toLowerCase())
                && !HTML_NAMES.has(tag.name.toLowerCase()) && !known.has(tag.name.toLowerCase())) {
                const close = unknownTagEnd(tag.end, tag.name, limit, insideContainer);
                if (close) return close.end;
              }
            }
            return protectedEnd(offset, limit, insideContainer);
          },
          budget: (offset: number, count: number) => {
            if (count > maxSyntaxNodes * 2) throw new LocalBudgetError('local.budget', `Syntax nodes exceed the limit of ${maxSyntaxNodes}.`, offset, offset + 1, 'local.budget.nodes', { limit: maxSyntaxNodes });
          },
          node,
          problem: (kind: string, from: number, to: number, tag?: string, name?: string) => {
            invalidNativeTable = true;
            const key = `html.table.${kind}`;
            const params = { tag: tag ?? 'table', name: name ?? '' };
            warning('local.html.fallback', { key, params }, from, to);
          },
          attributes: (name: string, from: number, to: number) => {
            const tag = htmlTagAt(from, to, true);
            const selected = tag && selectHtmlAttributes(name, tag);
            if (!selected || !selected.ok) {
              invalidNativeTable = true;
              const attribute = selected && !selected.ok ? selected.attr : '';
              const key = `html.table.${['colspan', 'rowspan', 'span', 'scope', 'align'].includes(attribute) ? 'value' : 'attribute'}`;
              const params = { tag: name, name: attribute };
              warning('local.html.fallback', { key, params }, from, to);
              return {};
            }
            return selected.attrs;
          },
          content: (from: number, to: number) => {
            const body = region(from, to, undefined, from, from, depth + 1, { ...options, definitions: [] });
            return convert(from, to, body.tokens, commonIndent(from, to), { literalHtml: footnoteMode, stripBlockquote: options.stripBlockquote === true });
          },
          });
        } catch (cause) {
          if (cause instanceof LocalBudgetError) throw cause;
          const opening = scanTag(i, end);
          if (!opening || opening.closing || opening.name.toLowerCase() !== 'table') throw cause;
          const stop = unknownTagEnd(opening.end, opening.name, end, insideContainer, true)?.end ?? htmlLiteralEnd(opening.end, end, parent);
          const retained = diagnostics.slice(htmlDiagnosticStart).filter(d => d.code.startsWith('local.budget'));
          diagnostics.splice(htmlDiagnosticStart, diagnostics.length - htmlDiagnosticStart, ...retained);
          warning('local.html.fallback', {key: 'local.html.fallback'}, i, stop);
          nativeTable = {node: node('fallback', i, stop, {value: source.slice(i, stop)}), end: stop};
          invalidNativeTable = false;
        }
        if (nativeTable) {
          if (invalidNativeTable) {
            // Discard diagnostics from content that will now be shown literally.
            // Resource budgets remain fatal, including those hit in nested cells.
            const retained = diagnostics.slice(htmlDiagnosticStart).filter(d => d.code === 'local.html.fallback' || d.code.startsWith('local.budget'));
            diagnostics.splice(htmlDiagnosticStart, diagnostics.length - htmlDiagnosticStart, ...retained);
          }
          tokens.push({ start: i, end: nativeTable.end, block: true, node: invalidNativeTable
            ? node('fallback', i, nativeTable.end, {value: source.slice(i, nativeTable.end)}) : nativeTable.node });
          i = nativeTable.end;
          continue;
        }
        }
        const html = htmlTagAt(i, end);
        if (html) {
          if (html.closing) {
            // A stray closing tag is inert source, never a structural error.
            warning('local.html.fallback', {key: 'local.html.fallback'}, i, html.end);
            tokens.push({ start: i, end: html.end, block: false, node: node('fallback', i, html.end, { value: source.slice(i, html.end) }) });
            i = html.end;
            continue;
          }
          const selection = selectHtmlAttributes(html.lower, html);
          if (!selection.ok) {
            const stop = html.self || HTML_VOID_ELEMENTS.has(html.lower)
              ? html.end
              : (htmlCloseEnd(html.end, html.lower, end, insideContainer)?.end ?? htmlLiteralEnd(html.end, end, parent, html.lower));
            warning('local.html.fallback', {key: 'local.html.fallback.attribute', params: {name: selection.attr}}, i, stop);
            tokens.push({ start: i, end: stop, block: false, node: node('fallback', i, stop, { value: source.slice(i, stop) }) });
            i = stop;
            continue;
          }
          const attrs = selection.attrs;
          if (HTML_VOID_ELEMENTS.has(html.lower)) {
            if (html.lower === 'br') {
              tokens.push({ start: i, end: html.end, node: node('break', i, html.end, { attrs }) });
            } else if (html.lower === 'hr') {
              const block = true;
              tokens.push({ start: i, end: html.end, ...(block ? { block: true } : {}), node: node('thematicBreak', i, html.end, { attrs }) });
            } else {
              const width = attrs.width !== undefined ? Number(attrs.width) : undefined;
              const height = attrs.height !== undefined ? Number(attrs.height) : undefined;
              tokens.push({
                start: i,
                end: html.end,
                node: node('image', i, html.end, {
                  url: attrs.src,
                  alt: attrs.alt ?? '',
                  title: attrs.title ?? null,
                  ...(width !== undefined ? { width } : {}),
                  ...(height !== undefined ? { height } : {}),
                  attrs,
                }),
              });
            }
            i = html.end;
            continue;
          }
          const close = htmlCloseEnd(html.end, html.lower, end, insideContainer);
          if (!close) {
            const stop = htmlLiteralEnd(html.end, end, parent, html.lower);
            if (!strict && htmlSupport) {
              budget.charge(stop - i, i, stop);
              const repaired = htmlSupport.recoverFragment(source, i, stop, node, new Set(known.keys()));
              if (repaired) {
                recoveries.push(repaired.recovery);
                for (const child of repaired.nodes) tokens.push({
                  start: child.range.start, end: child.range.end,
                  block: HTML_BLOCK.has(html.lower) || BLOCK_HTML_RESULTS.has(child.type), node: child,
                });
              } else {
                recoveries.push({ code: 'local.html.literal', causeRange: { start: i, end: html.end },
                  affectedRange: { start: i, end: stop }, action: 'literal-fallback', boundary: 'fragment' });
                tokens.push({ start: i, end: stop, block: beginsLine(i), node: node('fallback', i, stop, { value: source.slice(i, stop) }) });
              }
              i = stop;
              continue;
            }
            warning('local.html.fallback', {key: 'local.html.fallback'}, i, stop);
            tokens.push({ start: i, end: stop, block: beginsLine(i), node: node('fallback', i, stop, { value: source.slice(i, stop) }) });
            i = stop;
            continue;
          }
          const block = HTML_BLOCK.has(html.lower);
          const built = buildHtmlNode(html, close, attrs, {
            footnote: footnoteMode,
            container: insideContainer,
            indent: contentIndent,
            stripBlockquote: options.stripBlockquote === true,
            depth,
          });
          tokens.push({ start: i, end: close.end, ...(block ? { block: true } : {}), node: built });
          i = close.end;
          continue;
        }
        if (footnoteMode) { i += 1; continue; }
        const metadata = isThemeTagAt(source, i) ? themeTagAt(source, i, end) : null;
        if (metadata) {
          const inHeader = parent === undefined && !scriptSeen && inHeaderPrefix(i);
          if (inHeader) {
            headers.themeHeaders += 1;
            if (headers.themeHeaders === 1) headers.themeRange = { start: metadata.start, end: metadata.end };
            if (metadata.unclosed) {
              warning('local.theme.malformed', { key: 'local.theme.malformed.unclosed' }, i, metadata.end);
            } else if (metadata.closing) {
              warning('local.theme.malformed', { key: 'local.theme.malformed.closing' }, i, metadata.end);
            } else if (!standaloneTheme(source, metadata)) {
              warning('local.theme.malformed', { key: 'local.theme.malformed.placement' }, i, metadata.end);
            } else if (headers.themeHeaders > 1) {
              warning('local.theme.duplicate', { key: 'local.theme.duplicate.declaration' }, i, metadata.end);
            } else {
              const parsedTheme = themeNameFrom(metadata.rest);
              if (parsedTheme.code) warning(parsedTheme.code, parsedTheme.message ?? 'Invalid theme declaration.', i, metadata.end, {
                key: parsedTheme.key ?? parsedTheme.code,
                ...(parsedTheme.params ? { params: parsedTheme.params } : {}),
              });
              else headers.theme = parsedTheme.name;
            }
            headers.headerCursor = metadata.end;
            // A comment token is dropped by convert(), removing the metadata
            // while every following source offset, line and column stays as is.
            tokens.push({ start: i, end: metadata.end, block: true, node: node('comment', i, metadata.end) });
            i = metadata.end;
            continue;
          }
          const lateCode = parent === undefined ? 'local.theme.late' : 'local.theme.nested';
          const lateMessage = parent === undefined
            ? 'Theme declarations after document content are ignored.'
            : 'Theme declarations inside document content are ignored.';
          // Only the declaration tag itself is inert. Its surrounding content
          // (including healthy controls) keeps compiling and stays interactive.
          warning(lateCode, lateMessage, i, metadata.end, { key: lateCode });
          tokens.push({ start: i, end: metadata.end, block: false, node: node('fallback', i, metadata.end, { value: source.slice(i, metadata.end) }) });
          i = metadata.end;
          continue;
        }
        const scanned = scanTag(i, end);
        if (scanned && !footnoteMode && scanned.closing
          && !known.has(scanned.name.toLowerCase()) && DECLARATION_NAMES.has(scanned.name.toLowerCase())) {
          // A stray close only claims itself; the rest of the document keeps
          // compiling instead of failing on an unknown root close tag.
          warning('local.author.placement', { key: 'local.author.placement' }, i, scanned.end);
          tokens.push({ start: i, end: scanned.end, block: false, node: node('fallback', i, scanned.end, { value: source.slice(i, scanned.end) }) });
          i = scanned.end;
          continue;
        }
        // Registered components own a declaration name; the declaration is only
        // conditional and never replaces the component or its bindings.
        if (scanned && !footnoteMode && known.has(scanned.name.toLowerCase())
          && DECLARATION_NAMES.has(scanned.name.toLowerCase()) && !scanned.closing) {
          warning('local.author.component-conflict', { key: 'local.author.component-conflict', params: { name: scanned.name } }, i, scanned.end);
        }
        // Extended subtrees are recognized after registered components and
        // basic HTML. Iframes may also appear within a paragraph. Recognition does not
        // depend on the sanitizer being installed; a missing fragment service
        // only affects the compiled fragment, never parsing.
        const lowerName = scanned?.name.toLowerCase() ?? '';
        if (!footnoteMode && scanned && !scanned.closing && lowerName
          && EXTENDED_HTML_NAMES.has(lowerName) && !HTML_NAMES.has(lowerName)
          && !known.has(lowerName) && !NATIVE_HTML_VOID.has(lowerName)
          && (lowerName === 'iframe' || beginsLine(i))) {
          const close = scanned.self ? { start: scanned.end, end: scanned.end }
            : HTML_RAW_TEXT_ELEMENTS.has(lowerName)
              ? rawClose(scanned.end, lowerName, end)
              : unknownTagEnd(scanned.end, scanned.name, end, insideContainer, true);
          // An unpaired subtree or one that would cross its container's close
          // falls through to the ordinary native fallback below.
          const parentClose = parent === undefined ? null : rawClose(i, parent, end);
          if (close && (!parentClose || close.end <= parentClose.start)) {
            tokens.push({ start: i, end: close.end, block: beginsLine(i), node: node('extendedHtmlRaw', i, close.end, { value: source.slice(i, close.end) }) });
            i = close.end;
            continue;
          }
        }
        if (scanned && !known.has(scanned.name.toLowerCase()) && nativeHtmlNames.has(scanned.name.toLowerCase())) {
          const paired = !scanned.closing && !scanned.self && !NATIVE_HTML_VOID.has(scanned.name.toLowerCase())
            ? unknownTagEnd(scanned.end, scanned.name, end, insideContainer, true) : null;
          const rawFallback = !strict && !scanned.closing && !scanned.self && HTML_RAW_TEXT_ELEMENTS.has(scanned.name.toLowerCase())
            && (!paired || scanned.name.toLowerCase() === 'plaintext');
          const stop = scanned.closing || scanned.self || NATIVE_HTML_VOID.has(scanned.name.toLowerCase())
            ? scanned.end : rawFallback ? end : (paired?.end ?? htmlLiteralEnd(scanned.end, end, parent, scanned.name));
          if (rawFallback) recoveries.push({ code: 'local.html.literal', causeRange: { start: i, end: scanned.end },
            affectedRange: { start: i, end: stop }, action: 'literal-fallback', boundary: stop === source.length ? 'eof' : 'fragment' });
          else warning('local.html.fallback', {key: 'local.html.fallback'}, i, stop);
          tokens.push({start: i, end: stop, block: beginsLine(i), node: node('fallback', i, stop, {value: source.slice(i, stop)})});
          i = stop;
          continue;
        }
        if (
          scanned && !scanned.closing && TAG_NAME.test(scanned.name)
          && scanned.name.length <= MAX_LOCAL_NAME_LENGTH && !known.has(scanned.name)
        ) {
          const stop = scanned.self || unmountedLeafNames.has(scanned.name)
            ? scanned.end
            : (unknownTagEnd(scanned.end, scanned.name, end, insideContainer)?.end ?? null);
          if (stop === null) {
            if (!beginsLine(i)) {
              // A lone `<name>` inside running prose is ordinary text, not a
              // malformed component that should fail the whole document.
              tokens.push({ start: i, end: scanned.end, block: false, node: node('text', i, scanned.end, { value: source.slice(i, scanned.end) }) });
              i = scanned.end;
              continue;
            }
            // A line-leading unknown tag without a reliable same-name boundary
            // stays fatal.
            error('local.tag.unclosed', { key: 'local.tag.unclosed.pair', params: { name: scanned.name } }, i, scanned.end);
            i = scanned.end;
            continue;
          }
          const suggestion = closestName(scanned.name, suggestionNames);
          warning('local.component.unknown', {
              key: suggestion ? 'local.component.unknown.suggestion' : 'local.component.unknown',
              params: suggestion ? { name: scanned.name, suggestion } : { name: scanned.name },
            }, i, stop);
          tokens.push({
            start: i,
            end: stop,
            block: beginsLine(i),
            node: node('fallback', i, stop, { value: source.slice(i, stop) }),
          });
          i = stop;
          continue;
        }
        const tag = tagAt(i, end);
        if (tag) {
          if (tag.unclosed) {
            if (!known.has(tag.name.toLowerCase()) && nativeHtmlNames.has(tag.name.toLowerCase())) {
              const stop = htmlLiteralEnd(tag.head, end, parent, tag.name);
              if (!strict && HTML_RAW_TEXT_ELEMENTS.has(tag.name.toLowerCase())) recoveries.push({ code: 'local.html.literal',
                causeRange: { start: i, end: tag.head }, affectedRange: { start: i, end: stop },
                action: 'literal-fallback', boundary: stop === source.length ? 'eof' : 'fragment' });
              else warning('local.html.fallback', {key: 'local.html.fallback'}, i, stop);
              tokens.push({start: i, end: stop, block: beginsLine(i), node: node('fallback', i, stop, {value: source.slice(i, stop)})});
              i = stop;
              continue;
            }
            if (!known.has(tag.name.toLowerCase()) && !beginsLine(i)) {
              // `<y` in `x<y` and similar prose fragments are literal text.
              tokens.push({ start: i, end: tag.head, block: false, node: node('text', i, tag.head, { value: source.slice(i, tag.head) }) });
              i = tag.head;
              continue;
            }
            error('local.tag.unclosed', { key: 'local.tag.unclosed.open', params: { name: tag.name } }, i, end);
            i = end;
            continue;
          }
          if (!TAG_NAME.test(tag.name) && !known.has(tag.name.toLowerCase())) {
            // Uppercase prose such as `Array<T>` never reaches remark as HTML.
            tokens.push({ start: i, end: tag.end, block: false, node: node('text', i, tag.end, { value: source.slice(i, tag.end) }) });
            i = tag.end;
            continue;
          }
          if (!TAG_NAME.test(tag.name)) {
            error('local.tag.name', { key: 'local.tag.name', params: { name: tag.name } }, i, i + 1 + tag.name.length);
          }
          if (tag.closing) {
            if (tag.name === parent) return { tokens, end: tag.end, contentEnd: i, indent: commonIndent(start, i) };
            if (externalNames.has(tag.name) && known.get(tag.name)?.form === 'leaf') {
              error('local.host.structure', { key: 'local.host.structure.leaf', params: { component: tag.name } }, i, tag.end);
              i = tag.end;
              continue;
            }
            error('local.tag.mismatch', {
              key: parent ? 'local.tag.mismatch.parent' : 'local.tag.mismatch.root',
              params: parent ? { name: tag.name, parent } : { name: tag.name },
            }, i, tag.end); i = tag.end; continue;
          }
          // Registry forms decide tag shape for builtins, external manifests and
          // legacy host adapters alike.
          const schema = known.get(tag.name);
          const isHost = externalNames.has(tag.name);
          const hostForm = isHost ? schema?.form : undefined;
          const paired = schema !== undefined ? schema.form !== 'leaf' : true;
          const inline = schema?.form === 'inline';
          const empty = !paired || tag.self;
          if (tag.self && paired) error('local.tag.shape', { key: 'local.tag.shape', params: { name: tag.name } }, i, tag.end);
          if (empty) { tokens.push({ start: i, end: tag.end, ...(isHost ? { block: beginsLine(i) } : {}), node: node(isHost ? 'hostComponent' : 'component', i, tag.end, { name: tag.name, attrs: tag.attrs, children: [], ...(isHost ? { hostForm } : {}) }) }); i = tag.end; continue; }
          const nested = region(tag.end, end, tag.name, i, tag.end, depth + 1);
          const children = convert(tag.end, nested.contentEnd, nested.tokens, inline ? 0 : nested.indent);
          const component = node(isHost ? 'hostComponent' : 'component', i, nested.end, { name: tag.name, attrs: tag.attrs, children: inline && children.length === 1 && children[0].type === 'paragraph' ? children[0].children ?? [] : children, ...(isHost ? { hostForm } : {}) });
          tokens.push({ start: i, end: nested.end, ...(isHost ? { block: beginsLine(i) } : {}), node: component }); i = nested.end; continue;
        }
      }
      i++;
    }
    if (parent) error('local.tag.unclosed', { key: 'local.tag.unclosed.pair', params: { name: parent } }, openStart, Math.min(source.length, Math.max(openEnd, openStart + 1)));
    return { tokens, end, contentEnd: end, indent: parent ? commonIndent(start, end) : 0 };
  }

  return region;
}
