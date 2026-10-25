import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Diagnostic } from './types';
import type { LocalCompileOptions, LocalNode, LocalVersionDeclaration, SourceRange } from './types';
import { LOCAL_SYNTAX_VERSION } from './version';
import { localDiagnosticDetails, type LocalDiagnosticDetails } from './diagnostics';
import { localComponentNames, suggestComponent } from './schema';
import { isLocalThemeName } from './theme';
import { normalizeFootnoteIdentifier } from './footnotes';
import {
  DEFAULT_MAX_LOCAL_SYNTAX_NODES,
  MAX_LOCAL_DOCUMENT_LENGTH,
  MAX_LOCAL_DIAGNOSTICS,
  MAX_LOCAL_DIAGNOSTIC_LENGTH,
  MAX_LOCAL_STRING_LENGTH,
} from './limits';

/* Tag shapes come from the component schema; tests/schema-shapes.test.ts
 * pins the accepted syntax against the original literal lists. */
const VOID = new Set(localComponentNames('leaf'));
const PAIRED = new Set([...localComponentNames('container'), ...localComponentNames('inline')]);
const INLINE = new Set(localComponentNames('inline'));
const KNOWN = new Set([...VOID, ...PAIRED]);
/** Private-use sentinels keep source tokens opaque while Markdown is parsed. */
const MARK_OPEN = String.fromCharCode(0xe000);
const MARK_CLOSE = String.fromCharCode(0xe001);
const TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ATTR_NAME = TAG_NAME;
/** The only basic HTML names accepted, mapped to ordinary Markdown node types. */
const HTML_INLINE: Readonly<Record<string, string>> = {
  b: 'strong',
  i: 'emphasis',
  s: 'delete',
  u: 'underline',
  mark: 'mark',
};
const HTML_NAMES = new Set([...Object.keys(HTML_INLINE), 'br']);
/** Names longer than this are rejected and never fed to suggestion search. */
const MAX_LOCAL_NAME_LENGTH = 128;
/** Displayed math source, in UTF-16 code units, per formula. */
const MAX_DISPLAY_MATH_SOURCE = Math.min(50_000, MAX_LOCAL_STRING_LENGTH);
/** Component nesting depth, counted per parse call chain. */
const MAX_COMPONENT_DEPTH = 100;
/** Footnote labels longer than this are treated as ordinary text. */
const MAX_FOOTNOTE_LABEL_LENGTH = 1_000;
const markdown = unified().use(remarkParse).use(remarkGfm);
interface Token { start: number; end: number; block?: boolean; node: LocalNode }
interface RegionResult { tokens: Token[]; end: number; contentEnd: number; indent: number }
/** Source range of one `[^label]:` definition block. */
interface DefinitionRange { start: number; end: number }
interface RegionOptions {
  /** Footnote bodies keep controls, interpolations and math as literal text. */
  footnote?: boolean;
  /** Base indentation removed from continuation lines when converting. */
  indent?: number;
  /** Container bodies use container-aware code fence detection. */
  container?: boolean;
  /** Definition blocks visible to this region. */
  definitions?: readonly DefinitionRange[];
  stripBlockquote?: boolean;
}
interface ConvertOptions {
  /** Show raw HTML as text instead of diagnosing it (footnote bodies). */
  literalHtml?: boolean;
  /** Strip the enclosing Markdown quote markers before dedenting a note. */
  stripBlockquote?: boolean;
}
export interface ParsedLocal {
  nodes: LocalNode[];
  diagnostics: Diagnostic[];
  versionDeclaration?: LocalVersionDeclaration;
  /** Declared theme name, when the leading declaration is valid. */
  theme?: string;
  /** Source range of the first leading theme declaration, valid or not. */
  themeRange?: SourceRange;
}

class LocalBudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly start: number,
    readonly end: number,
    readonly key: string = code,
    readonly params?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = 'LocalBudgetError';
  }
}

function syntaxNodeLimit(options: LocalCompileOptions | undefined): number | { message: string; key: string } {
  if (options === undefined) return DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return { message: 'Compile options must be an object.', key: 'local.options.invalid.object' };
  }
  const limits = options.limits;
  if (limits === undefined) return DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) {
    return { message: 'Compile option limits must be an object.', key: 'local.options.invalid.limits' };
  }
  const value = limits.maxSyntaxNodes;
  if (value === undefined) return DEFAULT_MAX_LOCAL_SYNTAX_NODES;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return {
      message: 'Compile option limits.maxSyntaxNodes must be a positive safe integer.',
      key: 'local.options.invalid.max-syntax-nodes',
    };
  }
  return value;
}

/** A lexical pass shields code before recognizing local tags, interpolation and math. */
export function parseLocal(source: string, options?: LocalCompileOptions): ParsedLocal {
  const diagnostics: Diagnostic[] = [];
  if (typeof source !== 'string' || source.length > MAX_LOCAL_DOCUMENT_LENGTH) {
    const details = typeof source === 'string'
      ? localDiagnosticDetails('local.budget.document', { limit: MAX_LOCAL_DOCUMENT_LENGTH })
      : localDiagnosticDetails('local.parse.source');
    return { nodes: [], diagnostics: [{
      code: typeof source === 'string' ? 'local.budget' : 'local.parse',
      message: typeof source === 'string' ? `Document exceeds the ${MAX_LOCAL_DOCUMENT_LENGTH}-character limit.` : 'Document source must be a string.',
      severity: 'error', range: { start: 0, end: typeof source === 'string' && source.length ? 1 : 0 }, line: 1, column: 1,
      messageKey: details.key, ...(details.params ? { params: details.params } : {}),
    }] };
  }
  const maxSyntaxNodes = syntaxNodeLimit(options);
  if (typeof maxSyntaxNodes !== 'number') {
    return { nodes: [], diagnostics: [{
      code: 'local.options.invalid', message: maxSyntaxNodes.message, severity: 'error',
      range: { start: 0, end: 0 }, line: 1, column: 1, messageKey: maxSyntaxNodes.key,
    }] };
  }
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  let serial = 0;
  let nodeCount = 0;
  let markerSerial = 0;
  const reservedMarkers = new Set(source.match(new RegExp(MARK_OPEN + '[0-9]+' + MARK_CLOSE, 'g')) ?? []);
  const codeRanges: { start: number; end: number }[] = [];
  /** Root-level footnote definitions, located by the Markdown parser. */
  const rootDefinitions: DefinitionRange[] = [];
  const sourceBomOffset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  /**
   * The first Markdown pass decides what is literal code and where footnote
   * definitions begin and end. Code stays opaque to the local lexical pass;
   * definitions are re-parsed separately so their bodies can keep controls and
   * interpolations inert while still formatting safe Markdown.
   */
  const findShielded = (raw: any): void => {
    if (raw.type === 'code') {
      codeRanges.push({ start: raw.position.start.offset + sourceBomOffset, end: raw.position.end.offset + sourceBomOffset });
    } else if (raw.type === 'footnoteDefinition') {
      const start = raw.position?.start?.offset;
      const end = raw.position?.end?.offset;
      if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
        rootDefinitions.push({ start: start + sourceBomOffset, end: end + sourceBomOffset });
      }
    }
    for (const child of raw.children ?? []) findShielded(child);
  };
  try {
    findShielded(markdown.parse(source.slice(sourceBomOffset)));
  } catch {
    error('local.parse', 'Cannot parse the Markdown document.', 0, undefined, { key: 'local.parse.markdown' });
    return { nodes: [], diagnostics };
  }
  rootDefinitions.sort((a, b) => a.start - b.start || b.end - a.end);
  const rootDefinitionRanges: DefinitionRange[] = [];
  for (const range of rootDefinitions) {
    const last = rootDefinitionRanges[rootDefinitionRanges.length - 1];
    if (last && range.start < last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      rootDefinitionRanges.push({ ...range });
    }
  }
  const codeEndAt = (offset: number): number | null => {
    let low = 0;
    let high = codeRanges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const range = codeRanges[middle];
      if (offset < range.start) high = middle - 1;
      else if (offset >= range.end) low = middle + 1;
      else return range.end;
    }
    return null;
  };
  let codeIndex = 0;
  const node = (type: string, start: number, end: number, extra: Partial<LocalNode> = {}): LocalNode => {
    if (nodeCount >= maxSyntaxNodes) {
      throw new LocalBudgetError('local.budget', `Syntax nodes exceed the limit of ${maxSyntaxNodes}.`, start, end, 'local.budget.nodes', { limit: maxSyntaxNodes });
    }
    nodeCount += 1;
    return { type, id: `local-${serial++}`, range: { start, end }, ...extra };
  };
  function diagnostic(
    code: string,
    message: string,
    severity: 'error' | 'warning',
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
  ) {
    if (diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) {
      // Warnings must never crowd out a real error: once the budget is full a
      // new error replaces the newest warning that is still disposable.
      if (severity === 'warning') return;
      let index = diagnostics.length - 1;
      while (index >= 0 && diagnostics[index].severity !== 'warning') index -= 1;
      if (index < 0) return;
      diagnostics.splice(index, 1);
    }
    const safeStart = Math.max(0, Math.min(source.length, start));
    const safeEnd = Math.max(safeStart, Math.min(source.length, Math.max(safeStart, end)));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= safeStart) low = middle;
      else high = middle - 1;
    }
    const line = low + 1;
    const text = message.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
      ? `${message.slice(0, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
      : message;
    const bounded = localDiagnosticDetails(details?.key ?? code, details?.params);
    diagnostics.push({
      code,
      message: text,
      severity,
      range: { start: safeStart, end: safeEnd },
      line,
      column: safeStart - lineStarts[low] + 1,
      messageKey: bounded.key,
      ...(bounded.params ? { params: bounded.params } : {}),
    });
  }
  function error(
    code: string,
    message: string,
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
  ) {
    diagnostic(code, message, 'error', start, end, details);
  }
  function warning(
    code: string,
    message: string,
    start: number,
    end = start + 1,
    details?: LocalDiagnosticDetails,
  ) {
    diagnostic(code, message, 'warning', start, end, details);
  }

  /* ---------------------------------------------------------- theme header */

  /**
   * Theme declarations are document metadata. Only a leading, standalone
   * `<theme name="...">` is consumed; it is replaced with a dropped comment
   * token so every remaining source offset, line and column stays original.
   * Malformed, repeated, late and nested declarations warn but never stop the
   * body from compiling, and theme never enters the component schema.
   */
  let theme: string | undefined;
  let themeRange: SourceRange | undefined;
  let themeHeaders = 0;
  let headerCursor = 0;
  let versionDeclaration: LocalVersionDeclaration | undefined;
  let versionHeaders = 0;

  interface ThemeTag { start: number; end: number; rest: string; closing: boolean; selfClosing: boolean; unclosed: boolean }

  /** Cheap pre-check so ordinary `<` characters never pay for a tag scan. */
  function isThemeTagAt(index: number): boolean {
    const closing = source.startsWith('</theme', index);
    const opening = !closing && source.startsWith('<theme', index);
    if (!closing && !opening) return false;
    const boundary = source[index + (closing ? 7 : 6)];
    return boundary !== undefined && (boundary === '>' || boundary === '/' || /\s/.test(boundary));
  }

  function themeTagAt(start: number, limit: number): ThemeTag | null {
    const match = /^<(\/?)theme(?=[\s/>])/.exec(source.slice(start, limit));
    if (!match) return null;
    const nameEnd = start + match[0].length;
    // Metadata occupies one source line. A missing bracket must never borrow
    // the next component's closing bracket and consume that component.
    const newline = source.indexOf('\n', nameEnd);
    const lineEnd = newline < 0 ? limit : Math.min(limit, newline);
    let quote = '';
    let index = nameEnd;
    for (; index < lineEnd; index += 1) {
      const character = source[index];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    const closing = Boolean(match[1]);
    if (index >= lineEnd) {
      // An unclosed declaration only claims its own line so the following
      // controls survive the malformed metadata.
      const stop = lineEnd;
      return { start, end: stop, rest: source.slice(nameEnd, stop), closing, selfClosing: false, unclosed: true };
    }
    const rest = source.slice(nameEnd, index);
    return { start, end: index + 1, rest, closing, selfClosing: /\/\s*$/.test(rest), unclosed: false };
  }

  /** Whitespace, BOM and leading comments may precede the declaration. */
  function skipThemePrefix(from: number, to: number): number {
    let index = from;
    while (index < to) {
      const character = source[index];
      if (character.charCodeAt(0) === 0xfeff || character === ' ' || character === '\t' || character === '\r' || character === '\n') {
        index += 1;
        continue;
      }
      if (source.startsWith('<!--', index)) {
        const close = source.indexOf('-->', index + 4);
        if (close < 0 || close + 3 > to) return -1;
        index = close + 3;
        continue;
      }
      break;
    }
    return index;
  }

  function standaloneTheme(tag: ThemeTag): boolean {
    if (tag.unclosed) return false;
    let index = tag.end;
    while (index < source.length && (source[index] === ' ' || source[index] === '\t' || source[index] === '\r')) index += 1;
    return index >= source.length || source[index] === '\n';
  }

  function themeNameFrom(rest: string): { name?: string; code?: string; key?: string; params?: Record<string, string | number>; message?: string } {
    if (/\{\{|\}\}/.test(rest)) {
      return {
        code: 'local.theme.expression',
        key: 'local.theme.expression',
        message: 'Theme names must be static text, not expressions.',
      };
    }
    const body = rest.replace(/\/\s*$/, '');
    const match = /^\s*name\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(body);
    if (!match) {
      if (!/\bname\s*=/.test(body)) {
        return {
          code: 'local.theme.name',
          key: 'local.theme.name.missing',
          message: 'A theme declaration requires a quoted name attribute.',
        };
      }
      return {
        code: 'local.theme.attribute',
        key: 'local.theme.attribute',
        message: 'Theme declarations only accept a quoted name attribute.',
      };
    }
    const name = match[1] ?? match[2] ?? '';
    if (!isLocalThemeName(name)) {
      return {
        code: 'local.theme.name',
        key: 'local.theme.name.invalid',
        params: { name, limit: 64 },
        message: `Theme name "${name}" must use lowercase letters, digits and single hyphens (maximum 64 characters).`,
      };
    }
    return { name };
  }

  function decode(value: string) {
    return value.replace(/&(quot|apos|amp|lt|gt);/g, (_, key: string) => ({ quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' })[key]!);
  }
  function attributes(raw: string, offset: number): Record<string, string> {
    const attrs: Record<string, string> = Object.create(null);
    let i = 0;
    while (i < raw.length) {
      while (i < raw.length && /\s/.test(raw[i])) i++;
      if (i >= raw.length || raw[i] === '/') break;
      const start = i;
      const match = /^[A-Za-z][A-Za-z0-9_-]*/.exec(raw.slice(i));
      if (!match) {
        error('local.attribute', 'Attribute names must use lowercase kebab-case.', offset + i, undefined, { key: 'local.attribute.format' });
        while (i < raw.length && !/\s/.test(raw[i])) i++;
        continue;
      }
      const name = match[0]; i += name.length;
      if (name.length > MAX_LOCAL_NAME_LENGTH) {
        error('local.budget.name', `Attribute name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`, offset + start, offset + i, { key: 'local.budget.name.attribute', params: { limit: MAX_LOCAL_NAME_LENGTH } });
      } else if (!ATTR_NAME.test(name)) {
        error('local.attribute.name', `Attribute name ${name} must use lowercase kebab-case.`, offset + start, offset + i, { key: 'local.attribute.name', params: { name } });
      }
      while (i < raw.length && /\s/.test(raw[i])) i++;
      let value = 'true';
      if (raw[i] === '=') {
        i++; while (i < raw.length && /\s/.test(raw[i])) i++;
        const quote = raw[i++];
        if (quote !== '"' && quote !== "'") { error('local.attribute', `Attribute ${name} value must be quoted.`, offset + Math.max(0, i - 1), undefined, { key: 'local.attribute.value-quoted', params: { name } }); break; }
        const end = raw.indexOf(quote, i);
        if (end < 0) { error('local.attribute', `Attribute ${name} is missing a closing quote.`, offset + Math.max(0, i - 1), undefined, { key: 'local.attribute.closing-quote', params: { name } }); break; }
        value = decode(raw.slice(i, end)); i = end + 1;
      }
      if (Object.hasOwn(attrs, name)) error('local.attribute.duplicate', `Duplicate attribute ${name}.`, offset + start, offset + i, { key: 'local.attribute.duplicate', params: { name } });
      else attrs[name] = value;
      if (i < raw.length && !/\s|\//.test(raw[i])) { error('local.attribute', 'Attributes must be separated by whitespace.', offset + i, undefined, { key: 'local.attribute.separator' }); break; }
    }
    return attrs;
  }
  function tagAt(start: number, limit: number) {
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/.exec(source.slice(start, limit));
    if (!match) return null;
    const head = start + match[0].length;
    // A prose fragment such as `<y` must never borrow a `>` from a later
    // line. Unknown names followed by whitespace are therefore line-bounded;
    // known containers keep their documented multi-line attribute syntax.
    let scanLimit = limit;
    const boundary = source[head];
    if ((boundary === ' ' || boundary === '\t' || boundary === '\n' || boundary === '\r')
      && !KNOWN.has(match[2].toLowerCase()) && !beginsLine(start)) {
      const newline = source.indexOf('\n', head);
      if (newline >= 0) scanLimit = Math.min(limit, newline);
    }
    let quote = '', end = head;
    for (; end < scanLimit; end++) {
      const c = source[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const name = match[2];
    if (end >= scanLimit) return { name, closing: !!match[1], self: false, start, end: scanLimit, attrs: {}, head, unclosed: true };
    if (name.length > MAX_LOCAL_NAME_LENGTH) {
      error('local.budget.name', `Tag name exceeds the ${MAX_LOCAL_NAME_LENGTH}-character limit.`, start, start + 1 + name.length, { key: 'local.budget.name.tag', params: { limit: MAX_LOCAL_NAME_LENGTH } });
    }
    const rest = source.slice(head, end);
    if (match[1]) {
      if (rest.trim()) error('local.tag.closing', `Closing tag </${name}> cannot have attributes.`, start, end + 1, { key: 'local.tag.closing', params: { name } });
      return { name, closing: true, self: false, start, end: end + 1, attrs: {}, head, unclosed: false };
    }
    return { name, closing: false, self: /\/\s*$/.test(rest), start, end: end + 1, attrs: KNOWN.has(name.toLowerCase()) ? attributes(rest, head) : {}, head, unclosed: false };
  }
  /**
   * Silent tag boundary reader used for unknown components. Their attributes
   * are inert, so they must never reach `attributes()` or emit diagnostics.
   */
  function scanTag(start: number, limit: number) {
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*)(?=[\s/>])/.exec(source.slice(start, limit));
    if (!match) return null;
    const head = start + match[0].length;
    let scanLimit = limit;
    const boundary = source[head];
    if ((boundary === ' ' || boundary === '\t' || boundary === '\n' || boundary === '\r')
      && !KNOWN.has(match[2].toLowerCase()) && !beginsLine(start)) {
      const newline = source.indexOf('\n', head);
      if (newline >= 0) scanLimit = Math.min(limit, newline);
    }
    let quote = '', end = head;
    for (; end < scanLimit; end++) {
      const c = source[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end >= scanLimit) return null;
    const rest = source.slice(head, end);
    return { name: match[2], closing: !!match[1], self: !match[1] && /\/\s*$/.test(rest), end: end + 1 };
  }
  function beginsLine(offset: number): boolean {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    return /^[ \t]*$/.test(source.slice(lineStart, offset));
  }
  /** Label and normalized identifier of `[^label]` at `start`, if present. */
  function footnoteLabelAt(start: number, limit: number): { label: string; identifier: string; openEnd: number; closeEnd: number } | null {
    if (source[start] !== '[' || source[start + 1] !== '^') return null;
    let close = start + 2;
    const stop = Math.min(limit, start + 2 + MAX_FOOTNOTE_LABEL_LENGTH);
    for (; close < stop; close++) {
      const character = source[close];
      if (character === '\\' && /[!-/:-@\[\]\\^_`{|}~]/.test(source[close + 1] ?? '')) { close += 1; continue; }
      if (character === ']') break;
      if (character === '[' || character === '\n' || character === '\r') return null;
    }
    if (close >= stop || source[close] !== ']') return null;
    const label = source.slice(start + 2, close);
    if (!label.trim()) return null;
    const identifier = normalizeFootnoteIdentifier(label);
    return identifier ? { label, identifier, openEnd: start + 2, closeEnd: close + 1 } : null;
  }
  /** A definition marker `[^label]:` at `start`; positions are source offsets. */
  function definitionLabelAt(start: number): { label: string; identifier: string; bodyStart: number } | null {
    const found = footnoteLabelAt(start, source.length);
    if (!found || source[found.closeEnd] !== ':') return null;
    return { label: found.label, identifier: found.identifier, bodyStart: found.closeEnd + 1 };
  }
  /** Basic HTML tag shape (name only); attributes are rejected by `htmlTagValid`. */
  function htmlTagAt(start: number, limit: number) {
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/.exec(source.slice(start, Math.min(limit, start + 64)));
    if (!match) return null;
    const lower = match[2].toLowerCase();
    if (!HTML_NAMES.has(lower)) return null;
    // Accepted forms are attribute-free, so a tag never spans a line break.
    const newline = source.indexOf('\n', start + match[0].length);
    const scanLimit = newline >= 0 ? Math.min(limit, newline) : limit;
    let quote = '', end = start + match[0].length;
    for (; end < scanLimit; end++) {
      const c = source[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end >= scanLimit) return null;
    return { lower, closing: Boolean(match[1]), rest: source.slice(start + match[0].length, end), end: end + 1 };
  }
  /** Only attribute-free paired tags and attribute-free `br` variants are valid. */
  function htmlTagValid(tag: { lower: string; closing: boolean; rest: string }): boolean {
    if (tag.closing) return tag.rest.trim() === '';
    if (tag.lower === 'br') return /^\s*\/?\s*$/.test(tag.rest);
    return tag.rest.trim() === '';
  }
  /** Matching close of a paired basic HTML tag, nesting same-name tags. */
  function htmlCloseEnd(start: number, name: string, limit: number, insideContainer: boolean): { start: number; end: number } | null {
    let depth = 1;
    for (let i = start; i < limit;) {
      if (!insideContainer) {
        const codeEnd = codeEndAt(i);
        if (codeEnd !== null && codeEnd > i) { i = Math.min(codeEnd, limit); continue; }
      }
      const shield = protectedEnd(i, limit, insideContainer);
      if (shield !== null) { i = shield; continue; }
      if (source.startsWith('<!--', i)) {
        const close = source.indexOf('-->', i + 4);
        i = close < 0 || close + 3 > limit ? limit : close + 3;
        continue;
      }
      if (source[i] === '<') {
        const tag = htmlTagAt(i, limit);
        if (tag) {
          if (tag.lower === name && htmlTagValid(tag)) {
            if (tag.closing) {
              depth -= 1;
              if (depth === 0) return { start: i, end: tag.end };
            } else if (name !== 'br' && !/^\s*\/\s*$/.test(tag.rest)) {
              depth += 1;
            }
          }
          i = tag.end;
          continue;
        }
      }
      i++;
    }
    return null;
  }
  const ROOT_FENCE_LINE = /^ {0,3}$/;
  const CONTAINER_FENCE_LINE = /^[ \t]*$/;
  function protectedEnd(i: number, end: number, insideContainer: boolean): number | null {
    const character = source[i];
    if (character === '\\') return Math.min(end, i + 2);
    if (character !== '`' && character !== '~') return null;
    // Recognize fenced code at a Markdown line boundary, including container indentation.
    const lineStart = source.lastIndexOf('\n', i - 1) + 1;
    if ((insideContainer ? CONTAINER_FENCE_LINE : ROOT_FENCE_LINE).test(source.slice(lineStart, i))) {
      const fence = /^(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(i, end));
      if (fence) {
        const prefix = insideContainer ? '[ \\t]*' : ' {0,3}';
        const close = new RegExp(`^${prefix}${fence[1][0]}{${fence[1].length},}[ \\t]*\\r?$`, 'gm');
        close.lastIndex = i + fence[0].length;
        const match = close.exec(source);
        return match && match.index < end ? Math.min(end, match.index + match[0].length) : end;
      }
    }
    if (character === '`') {
      const ticks = /^`+/.exec(source.slice(i, end))![0];
      let next = source.indexOf(ticks, i + ticks.length);
      while (next >= 0 && next < end) {
        if (source[next - 1] !== '`' && source[next + ticks.length] !== '`') return next + ticks.length;
        next = source.indexOf(ticks, next + ticks.length);
      }
      return i + ticks.length;
    }
    return null;
  }
  /**
   * Find the matching close of an unknown paired tag. Only the tag's own name
   * changes depth; nested unknowns, attributes, comments, code and escapes are
   * opaque, so malformed content inside cannot produce document-wide errors.
   */
  function unknownTagEnd(start: number, name: string, limit: number, insideContainer: boolean): { start: number; end: number } | null {
    let depth = 1;
    for (let i = start; i < limit;) {
      if (!insideContainer) {
        const codeEnd = codeEndAt(i);
        if (codeEnd !== null && codeEnd > i) { i = Math.min(codeEnd, limit); continue; }
      }
      const shield = protectedEnd(i, limit, insideContainer);
      if (shield !== null) { i = shield; continue; }
      if (source.startsWith('<!--', i)) {
        const close = source.indexOf('-->', i + 4);
        i = close < 0 || close + 3 > limit ? limit : close + 3;
        continue;
      }
      if (source[i] === '<') {
        const tag = scanTag(i, limit);
        if (tag) {
          if (tag.name === name) {
            if (tag.closing) {
              depth -= 1;
              if (depth === 0) return { start: i, end: tag.end };
            } else if (!tag.self) {
              depth += 1;
            }
          }
          i = tag.end;
          continue;
        }
      }
      i++;
    }
    return null;
  }
  function interpolationEnd(start: number, end: number) {
    let quote = '';
    for (let i = start + 2; i < end - 1; i++) {
      const c = source[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '}' && source[i + 1] === '}') return i + 2;
    }
    return -1;
  }
  /**
   * Common leading indentation of the lines owned by a container. Fenced code
   * content is ignored so an unindented code sample does not cancel dedenting.
   */
  function commonIndent(start: number, end: number): number {
    let indent = Number.POSITIVE_INFINITY;
    let fenceChar = '', fenceLength = 0;
    let pos = start;
    while (pos < end) {
      const lineEnd = source.indexOf('\n', pos);
      const stop = lineEnd < 0 || lineEnd > end ? end : lineEnd;
      const text = source.slice(pos, stop);
      const atLineStart = source.lastIndexOf('\n', pos - 1) + 1 === pos;
      if (atLineStart) {
        if (fenceChar) {
          if (new RegExp(`^[ \\t]*${fenceChar}{${fenceLength},}[ \\t]*\\r?$`).test(text)) fenceChar = '';
        } else {
          const open = /^([ \t]*)(`{3,}|~{3,})/.exec(text);
          if (open) {
            indent = Math.min(indent, open[1].length);
            fenceChar = open[2][0]; fenceLength = open[2].length;
          } else if (text.trim() !== '') {
            indent = Math.min(indent, /^[ \t]*/.exec(text)![0].length);
          }
        }
      }
      if (stop >= end) break;
      pos = stop + 1;
    }
    return Number.isFinite(indent) ? indent : 0;
  }
  function region(start: number, end: number, parent?: string, openStart = start, openEnd = start, depth = 0, options: RegionOptions = {}): RegionResult {
    const tokens: Token[] = [];
    if (depth > MAX_COMPONENT_DEPTH) {
      error('local.budget', 'Component nesting exceeds the 100-level limit.', openStart, openEnd, { key: 'local.budget.nesting', params: { limit: MAX_COMPONENT_DEPTH } });
      return { tokens, end, contentEnd: start, indent: 0 };
    }
    const footnoteMode = options.footnote === true;
    const insideContainer = options.container ?? parent !== undefined;
    let contentIndent = options.indent ?? 0;
    // Raw component tags can hide footnote definitions from the document's
    // first Markdown pass. Re-scan each dedented body for definition ranges so
    // a definition inside a container still becomes a real footnote node.
    let regionDefinitions: readonly DefinitionRange[] = options.definitions ?? rootDefinitionRanges;
    if (parent) {
      const bodyEnd = unknownTagEnd(start, parent, end, true)?.start ?? end;
      const indent = commonIndent(start, bodyEnd);
      contentIndent = indent;
      let text = '';
      const offsets: number[] = [];
      for (let i = start; i < bodyEnd;) {
        if (i === 0 || source[i - 1] === '\n') {
          let skipped = 0;
          while (skipped < indent && i < bodyEnd && /[ \t]/.test(source[i])) { i++; skipped++; }
        }
        if (i >= bodyEnd) break;
        offsets.push(i);
        text += source[i++];
      }
      offsets.push(bodyEnd);
      const found: DefinitionRange[] = [];
      const visit = (raw: any): void => {
        if (raw.type === 'footnoteDefinition') {
          const from = offsets[raw.position.start.offset];
          const to = offsets[raw.position.end.offset];
          if (Number.isInteger(from) && Number.isInteger(to) && to > from) found.push({ start: from, end: to });
          return;
        }
        for (const child of raw.children ?? []) visit(child);
      };
      visit(markdown.parse(text));
      regionDefinitions = found
        .filter(range => range.start >= start && range.end <= bodyEnd)
        .sort((a, b) => a.start - b.start || b.end - a.end);
    }
    let definitionIndex = 0;
    for (let i = start; i < end;) {
      if (!insideContainer) {
        while (codeRanges[codeIndex]?.end <= i) codeIndex++;
        const code = codeRanges[codeIndex];
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
          const lineStart = source.lastIndexOf('\n', labelStart - 1) + 1;
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
      const shield = protectedEnd(i, end, insideContainer);
      if (shield !== null) { i = shield; continue; }
      if (source.startsWith('<!--', i)) {
        const close = source.indexOf('-->', i + 4), stop = close < 0 ? end : Math.min(end, close + 3);
        const comment = source.slice(i, stop);
        if (!footnoteMode && /^<!--\s*reactive-md(?=[\s:]|-->|$)/i.test(comment)) {
          versionHeaders += 1;
          const lineStart = source.lastIndexOf('\n', i - 1) + 1;
          const nextLine = source.indexOf('\n', stop);
          const standalone = /^\s*$/.test(source.slice(lineStart, i))
            && /^\s*$/.test(source.slice(stop, nextLine < 0 ? source.length : nextLine));
          const match = /^<!--[ \t]*reactive-md:[ \t]*(local-draft-[1-9][0-9]*)[ \t]*-->$/.exec(comment);
          if (versionHeaders > 1) {
            error('local.version.duplicate', 'Only one source syntax declaration is allowed.', i, stop);
          } else if (!match || close < 0 || /[\r\n]/.test(comment)) {
            error('local.version.malformed', 'Use <!-- reactive-md: local-draft-2 --> on one line.', i, stop);
          } else {
            versionDeclaration = { version: match[1], range: { start: i, end: stop } };
            if (parent !== undefined || !standalone || skipThemePrefix(0, i) !== i) {
              error('local.version.placement', 'The syntax declaration must be on its own line before the theme and document body.', i, stop);
            } else if (match[1] !== LOCAL_SYNTAX_VERSION) {
              error('local.version.unsupported', `This reader accepts ${LOCAL_SYNTAX_VERSION}; migrate ${match[1]} or use a compatible reader.`, i, stop, {
                key: 'local.version.unsupported', params: { declared: match[1], supported: LOCAL_SYNTAX_VERSION },
              });
            }
          }
        }
        tokens.push({ start: i, end: stop, node: node('comment', i, stop) }); i = stop; continue;
      }
      if (!footnoteMode && source.startsWith('{{', i)) {
        const stop = interpolationEnd(i, end);
        if (stop < 0) { error('local.interpolation', 'Interpolation is missing }}.', i, end, { key: 'local.interpolation.unclosed' }); i += 2; continue; }
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
          if (stop >= end || !source.startsWith(delimiter, stop)) { error('local.math.unclosed', 'Formula is missing its closing delimiter.', i, undefined, { key: 'local.math.unclosed' }); i += delimiter.length; continue; }
          let value = source.slice(i + delimiter.length, stop);
          if (value.length > MAX_DISPLAY_MATH_SOURCE) {
            error('local.budget.math', `Formula exceeds the ${MAX_DISPLAY_MATH_SOURCE}-character limit.`, i, stop + delimiter.length, { key: 'local.budget.math', params: { limit: MAX_DISPLAY_MATH_SOURCE } });
            value = value.slice(0, MAX_DISPLAY_MATH_SOURCE);
          }
          const finish = stop + delimiter.length;
          tokens.push({ start: i, end: finish, node: node('math', i, finish, { value }) }); i = finish; continue;
        }
        // A single dollar only opens inline math at an explainable boundary.
        // Currency such as `$5 and $10` stays literal: the closer must not be
        // immediately followed by a digit, and the content may not touch
        // whitespace. The first `$` that fails this boundary ends the current
        // match, so a later, well-formed formula is still recognized on its own.
        let stop = i + 1;
        let close = -1;
        for (; stop < end; stop++) {
          const character = source[stop];
          if (character === '\\') { stop++; continue; }
          if (character === '\n') break;
          if (character !== '$') continue;
          const value = source.slice(i + 1, stop);
          const after = source[stop + 1];
          if (!value || /^\s/.test(value) || /\s$/.test(value)) break;
          if (after !== undefined && after >= '0' && after <= '9') break;
          close = stop;
          break;
        }
        if (close < 0) { i += 1; continue; }
        let value = source.slice(i + 1, close);
        if (value.length > MAX_DISPLAY_MATH_SOURCE) {
          error('local.budget.math', `Formula exceeds the ${MAX_DISPLAY_MATH_SOURCE}-character limit.`, i, close + 1, { key: 'local.budget.math', params: { limit: MAX_DISPLAY_MATH_SOURCE } });
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
        const html = htmlTagAt(i, end);
        if (html) {
          if (!htmlTagValid(html)) {
            const stop = !html.closing && html.lower !== 'br'
              ? (htmlCloseEnd(html.end, html.lower, end, insideContainer)?.end ?? html.end)
              : html.end;
            warning('local.html', 'HTML attributes are not supported; the tag is shown as source.', i, stop, { key: 'local.html' });
            tokens.push({ start: i, end: stop, block: false, node: node('fallback', i, stop, { value: source.slice(i, stop) }) });
            i = stop;
            continue;
          }
          if (html.closing) {
            // A stray closing tag is inert source, never a structural error.
            tokens.push({ start: i, end: html.end, block: false, node: node('fallback', i, html.end, { value: source.slice(i, html.end) }) });
            i = html.end;
            continue;
          }
          if (html.lower === 'br') {
            tokens.push({ start: i, end: html.end, node: node('break', i, html.end) });
            i = html.end;
            continue;
          }
          const close = htmlCloseEnd(html.end, html.lower, end, insideContainer);
          if (!close) {
            // An unclosed formatting tag in running text stays literal prose.
            tokens.push({ start: i, end: html.end, block: false, node: node('text', i, html.end, { value: source.slice(i, html.end) }) });
            i = html.end;
            continue;
          }
          const body = region(html.end, close.start, undefined, i, html.end, depth + 1, {
            footnote: footnoteMode,
            indent: contentIndent,
            container: insideContainer,
            definitions: [],
            stripBlockquote: options.stripBlockquote,
          });
          const children = convert(html.end, close.start, body.tokens, contentIndent, { literalHtml: footnoteMode, stripBlockquote: options.stripBlockquote });
          const inline = children.length === 1 && children[0].type === 'paragraph' ? children[0].children ?? [] : children;
          tokens.push({ start: i, end: close.end, node: node(HTML_INLINE[html.lower], i, close.end, { children: inline }) });
          i = close.end;
          continue;
        }
        if (footnoteMode) { i += 1; continue; }
        const metadata = isThemeTagAt(i) ? themeTagAt(i, end) : null;
        if (metadata) {
          const inHeader = parent === undefined && skipThemePrefix(headerCursor, i) === i;
          if (inHeader) {
            themeHeaders += 1;
            if (themeHeaders === 1) themeRange = { start: metadata.start, end: metadata.end };
            if (metadata.unclosed) {
              warning('local.theme.malformed', 'Theme declaration is missing >.', i, metadata.end, { key: 'local.theme.malformed.unclosed' });
            } else if (metadata.closing) {
              warning('local.theme.malformed', 'A theme declaration cannot be a closing tag.', i, metadata.end, { key: 'local.theme.malformed.closing' });
            } else if (!standaloneTheme(metadata)) {
              warning('local.theme.malformed', 'A theme declaration must be on its own line before the document content.', i, metadata.end, { key: 'local.theme.malformed.placement' });
            } else if (themeHeaders > 1) {
              warning('local.theme.duplicate', 'Only one theme declaration is allowed before the document content; this declaration is ignored.', i, metadata.end, { key: 'local.theme.duplicate.declaration' });
            } else {
              const parsedTheme = themeNameFrom(metadata.rest);
              if (parsedTheme.code) warning(parsedTheme.code, parsedTheme.message ?? 'Invalid theme declaration.', i, metadata.end, {
                key: parsedTheme.key ?? parsedTheme.code,
                ...(parsedTheme.params ? { params: parsedTheme.params } : {}),
              });
              else theme = parsedTheme.name;
            }
            headerCursor = metadata.end;
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
        if (
          scanned && !scanned.closing && TAG_NAME.test(scanned.name)
          && scanned.name.length <= MAX_LOCAL_NAME_LENGTH && !KNOWN.has(scanned.name)
        ) {
          const stop = scanned.self ? scanned.end : (unknownTagEnd(scanned.end, scanned.name, end, insideContainer)?.end ?? null);
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
            error('local.tag.unclosed', `<${scanned.name}> is missing </${scanned.name}>.`, i, scanned.end, { key: 'local.tag.unclosed.pair', params: { name: scanned.name } });
            i = scanned.end;
            continue;
          }
          const suggestion = suggestComponent(scanned.name);
          warning(
            'local.component.unknown',
            `Unknown component <${scanned.name}>. ${suggestion ? `Did you mean <${suggestion}>?` : 'This mode only accepts local interaction components.'}`,
            i,
            stop,
            {
              key: suggestion ? 'local.component.unknown.suggestion' : 'local.component.unknown',
              params: suggestion ? { name: scanned.name, suggestion } : { name: scanned.name },
            },
          );
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
            if (!KNOWN.has(tag.name.toLowerCase()) && !beginsLine(i)) {
              // `<y` in `x<y` and similar prose fragments are literal text.
              tokens.push({ start: i, end: tag.head, block: false, node: node('text', i, tag.head, { value: source.slice(i, tag.head) }) });
              i = tag.head;
              continue;
            }
            error('local.tag.unclosed', `Tag ${tag.name} is missing >.`, i, end, { key: 'local.tag.unclosed.open', params: { name: tag.name } });
            i = end;
            continue;
          }
          if (!TAG_NAME.test(tag.name) && !KNOWN.has(tag.name.toLowerCase())) {
            // Uppercase prose such as `Array<T>` never reaches remark as HTML.
            tokens.push({ start: i, end: tag.end, block: false, node: node('text', i, tag.end, { value: source.slice(i, tag.end) }) });
            i = tag.end;
            continue;
          }
          if (!TAG_NAME.test(tag.name)) {
            error('local.tag.name', `Tag name ${tag.name} must use lowercase kebab-case.`, i, i + 1 + tag.name.length, { key: 'local.tag.name', params: { name: tag.name } });
          }
          if (tag.closing) {
            if (tag.name === parent) return { tokens, end: tag.end, contentEnd: i, indent: commonIndent(start, i) };
            error('local.tag.mismatch', `Closing tag </${tag.name}> does not match ${parent ? `<${parent}>` : 'the document root'}.`, i, tag.end, {
              key: parent ? 'local.tag.mismatch.parent' : 'local.tag.mismatch.root',
              params: parent ? { name: tag.name, parent } : { name: tag.name },
            }); i = tag.end; continue;
          }
          const empty = VOID.has(tag.name) || tag.self;
          if (tag.self && PAIRED.has(tag.name)) error('local.tag.shape', `<${tag.name}> requires a closing tag.`, i, tag.end, { key: 'local.tag.shape', params: { name: tag.name } });
          if (empty) { tokens.push({ start: i, end: tag.end, node: node('component', i, tag.end, { name: tag.name, attrs: tag.attrs, children: [] }) }); i = tag.end; continue; }
          const nested = region(tag.end, end, tag.name, i, tag.end, depth + 1);
          const children = convert(tag.end, nested.contentEnd, nested.tokens, INLINE.has(tag.name) ? 0 : nested.indent);
          const component = node('component', i, nested.end, { name: tag.name, attrs: tag.attrs, children: INLINE.has(tag.name) && children.length === 1 && children[0].type === 'paragraph' ? children[0].children ?? [] : children });
          tokens.push({ start: i, end: nested.end, node: component }); i = nested.end; continue;
        }
      }
      i++;
    }
    if (parent) error('local.tag.unclosed', `<${parent}> is missing </${parent}>.`, openStart, Math.min(source.length, Math.max(openEnd, openStart + 1)), { key: 'local.tag.unclosed.pair', params: { name: parent } });
    return { tokens, end, contentEnd: end, indent: parent ? commonIndent(start, end) : 0 };
  }
  function convert(start: number, end: number, tokens: Token[], indent = 0, options: ConvertOptions = {}): LocalNode[] {
    let masked = '', cursor = start;
    const offsets: number[] = [];
    const markers = new Map<number, { marker: string; end: number; node: LocalNode }>();
    const skipCache = new Map<number, number>();
    function lineSkip(absolute: number) {
      const lineStart = source.lastIndexOf('\n', absolute - 1) + 1;
      let skip = skipCache.get(lineStart);
      if (skip === undefined) {
        skip = options.stripBlockquote ? (/^(?:[ \t]{0,3}>[ \t]?)+/.exec(source.slice(lineStart))?.[0].length ?? 0) : 0;
        let indentation = 0;
        while (indentation < indent && (source[lineStart + skip] === ' ' || source[lineStart + skip] === '\t')) { skip++; indentation++; }
        skipCache.set(lineStart, skip);
      }
      return { lineStart, skip };
    }
    function append(text: string, from: number, linear: boolean) {
      // Remove a file BOM before calculating generated marker indices. remark
      // ignores it, while this mapping retains original source coordinates.
      if (linear && from === 0 && text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
        from += 1;
      }
      if (linear && indent > 0) {
        for (let j = 0; j < text.length; j++) {
          const absolute = from + j;
          const { lineStart, skip } = lineSkip(absolute);
          if (absolute < lineStart + skip) continue;
          masked += text[j]; offsets.push(absolute);
        }
        return;
      }
      masked += text;
      for (let j = 0; j < text.length; j++) offsets.push(linear ? from + j : from);
    }
    for (const token of tokens) {
      append(source.slice(cursor, token.start), cursor, true);
      let marker: string;
      do { marker = MARK_OPEN + markerSerial++ + MARK_CLOSE; } while (reservedMarkers.has(marker));
      const block = token.block ?? (token.node.type === 'math' || (token.node.type === 'component' && !INLINE.has(token.node.name!)));
      if (block) append('\n\n', token.start, false);
      const markerStart = masked.length;
      // A generated Markdown image has its own source range. Restore only this
      // exact range; entity decoding and adjacent code cannot forge a node.
      append(`![${marker}](rmd-internal:placeholder)`, token.start, false);
      markers.set(markerStart, { marker, end: masked.length, node: token.node });
      if (block) append('\n\n', token.end, false);
      cursor = token.end;
    }
    append(source.slice(cursor, end), cursor, true); offsets.push(end);
    const tree = markdown.parse(masked) as any;
    function unescapeTablePipes(nodes: LocalNode[]) {
      for (const child of nodes) {
        if (child.type === 'interpolation' && child.value !== undefined) child.value = child.value.replace(/\\\|/g, '|');
        if (child.children) unescapeTablePipes(child.children);
      }
    }
    function transform(raw: any): LocalNode[] {
      const from = offsets[raw.position?.start?.offset ?? 0] ?? start;
      const to = offsets[raw.position?.end?.offset ?? masked.length] ?? end;
      if (raw.type === 'image') {
        const slot = markers.get(raw.position?.start?.offset);
        if (slot && raw.position.end.offset === slot.end
          && raw.url === 'rmd-internal:placeholder' && raw.alt === slot.marker) {
          markers.delete(raw.position.start.offset);
          return slot.node.type === 'comment' ? [] : [slot.node];
        }
      }
      if (raw.type === 'text') {
        return raw.value ? [node('text', from, to, { value: raw.value })] : [];
      }
      // Footnote nodes normally arrive through lexical tokens. This branch only
      // covers a remark-parsed node (hand-built Markdown fragments); it keeps
      // the original identifier/label instead of degrading to source text.
      if (raw.type === 'footnoteReference' || raw.type === 'footnoteDefinition') {
        const label = typeof raw.label === 'string' && raw.label ? raw.label : String(raw.identifier ?? '');
        const identifier = normalizeFootnoteIdentifier(String(raw.identifier ?? label));
        if (raw.type === 'footnoteDefinition') {
          const definitionChildren = raw.children?.flatMap(transform);
          return [node('footnoteDefinition', from, to, { identifier, label, children: definitionChildren ?? [] })];
        }
        return [node('footnoteReference', from, to, { identifier, label })];
      }
      const children = raw.children?.flatMap(transform);
      if (raw.type === 'paragraph' && children?.length === 1 && (children[0].type === 'math' || children[0].type === 'fallback' || children[0].type === 'footnoteDefinition' || (children[0].type === 'component' && !INLINE.has(children[0].name!)))) return children;
      if (raw.type === 'paragraph' && !children?.length) return [];
      if (raw.type === 'html') {
        if (options.literalHtml) {
          // Footnote bodies show controls, interpolation and stray HTML as text,
          // so a malformed tag can never fail the surrounding document.
          return typeof raw.value === 'string' && raw.value
            ? [node('text', from, to, { value: raw.value })]
            : [];
        }
        error('local.html', 'Raw HTML is not part of the local interaction syntax.', from, to, { key: 'local.html' });
        return [];
      }
      const result = node(raw.type, from, to);
      for (const key of ['value', 'depth', 'ordered', 'start', 'checked', 'url', 'title', 'alt', 'lang', 'align'] as const) if (raw[key] !== undefined) (result as any)[key] = raw[key];
      if (children) result.children = children;
      if (raw.type === 'table' && result.children) unescapeTablePipes(result.children);
      return [result];
    }
    return tree.children.flatMap(transform);
  }
  /**
   * Undefined references stay visible as their original source. Definitions
   * are first-class nodes, so resolution happens once the whole tree (including
   * container bodies) exists; the first definition of an identifier wins for
   * the renderer, which receives every definition node unchanged.
   */
  function resolveFootnoteReferences(nodes: LocalNode[]): void {
    const defined = new Set<string>();
    const collect = (list: LocalNode[]): void => {
      for (const item of list) {
        if (item.type === 'footnoteDefinition' && item.identifier) defined.add(item.identifier);
        if (item.children) collect(item.children);
      }
    };
    collect(nodes);
    const resolve = (list: LocalNode[]): void => {
      for (const item of list) {
        if (item.type === 'footnoteReference' && (!item.identifier || !defined.has(item.identifier))) {
          item.type = 'text';
          item.value = source.slice(item.range.start, item.range.end);
          delete item.identifier;
          delete item.label;
        }
        if (item.children) resolve(item.children);
      }
    };
    resolve(nodes);
  }
  try {
    const result = region(0, source.length);
    const nodes = convert(0, source.length, result.tokens);
    resolveFootnoteReferences(nodes);
    return {
      nodes,
      diagnostics,
      ...(versionDeclaration ? { versionDeclaration } : {}),
      ...(theme !== undefined ? { theme } : {}),
      ...(themeRange ? { themeRange } : {}),
    };
  } catch (cause) {
    if (cause instanceof LocalBudgetError) {
      error(cause.code, cause.message, cause.start, cause.end, {
        key: cause.key,
        params: cause.params,
      });
      return { nodes: [], diagnostics };
    }
    error('local.parse', `Cannot parse document: ${cause instanceof Error ? cause.message : String(cause)}`, 0, undefined, {
      key: 'local.parse.document',
      params: { detail: cause instanceof Error ? cause.message : String(cause) },
    });
    return { nodes: [], diagnostics };
  }
}
