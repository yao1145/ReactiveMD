import {
  LOCAL_THEME_PROTOCOL,
  isLocalThemeName,
  type LocalThemeDefinition,
} from '../local/theme/theme';

/**
 * Preview theme-package contract.
 *
 * A theme package is plain, serializable data: identity plus a bounded list of
 * inline CSS resources. CSS is scoped to the document root that selects the
 * theme (`[data-rmd-theme="name"]`) so one document instance can never restyle
 * its host page or another instance. Phase one supports inline CSS only, with
 * `data:` URLs and no network resources.
 *
 * `defineLocalTheme` validates and freezes a package. `composeLocalTheme`
 * derives a new theme from a base package plus ordered overrides; every base
 * selector is retargeted to the composed theme name. `collectLocalThemeCss`
 * returns the concatenated stylesheet in resource order, ready for a `<style>`
 * element or an export asset list.
 *
 * `@font-face` is supported without leaking a global family name: every
 * declared family is rewritten to a deterministic family that includes the
 * theme name, and matching `font-family` / `font` references in every resource
 * are rewritten to the same family. Composing under a new name redirects the
 * generated families as well.
 */

export interface LocalStyleResource {
  readonly id: string;
  readonly css: string;
}

export interface LocalThemePackage extends LocalThemeDefinition {
  /** Stable package identity, independent from the document theme name. */
  readonly id: string;
  /** Package implementation version, for requirement checks. */
  readonly version: string;
  /** Inline CSS resources in stylesheet order. */
  readonly css: readonly LocalStyleResource[];
}

export interface LocalThemeInput {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Defaults to `reactive-md-theme-1`; any other value is rejected. */
  readonly protocol?: typeof LOCAL_THEME_PROTOCOL;
  /** Defaults to both light and dark; both are required. */
  readonly colorSchemes?: readonly ('light' | 'dark')[];
  readonly css: readonly LocalStyleResource[];
}

export interface LocalThemeCompositionInput {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly base: LocalThemePackage;
  /** Ordered resources appended after the base theme. */
  readonly overrides: readonly LocalStyleResource[];
}

const MAX_THEME_PACKAGE_ID_LENGTH = 128;
const MAX_THEME_RESOURCE_COUNT = 32;
const MAX_STYLE_RESOURCE_ID_LENGTH = 128;
const MAX_THEME_RESOURCE_CSS_LENGTH = 262_144;
const MAX_THEME_TOTAL_CSS_LENGTH = 524_288;
const THEME_PACKAGE_ID = /^[a-z][a-z0-9]*(?:[-./][a-z0-9]+)*$/;
// Resource ids also identify external files and build outputs, so dotted and
// namespaced ids (for example "example/paper.css") are accepted.
const STYLE_RESOURCE_ID = /^[a-z][a-z0-9._/-]*$/;
const THEME_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const THEME_SCOPE_AT_START = /^\[\s*data-rmd-theme\s*=\s*(?:"[^"]*"|'[^']*'|[^\]]*?)\s*\]/;
const HOST_GLOBAL_SELECTOR = /^(?::root|html|body)(?![A-Za-z0-9_-])/i;
const CONDITIONAL_AT_RULES = new Set([
  'media',
  'supports',
  'layer',
  'container',
  'scope',
  'starting-style',
]);
const MAX_FONT_FAMILY_NAME_BYTES = 256;
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
]);
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SYSTEM_FONT_KEYWORDS = new Set([
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar',
]);
const FONT_SIZE_KEYWORDS = new Set([
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'smaller',
  'larger',
]);
/** Generated family names carry the theme name and an injective encoding. */
const GENERATED_FONT_FAMILY = /^rmd-theme-([a-z][a-z0-9-]*)-font-([0-9a-f]+)$/;

function themeError(path: string, message: string): Error {
  return new Error(`Invalid local theme ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw themeError(path, 'must be an object.');
  return value;
}

function readThemeId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw themeError(path, 'must be a non-empty string.');
  }
  if (value.length > MAX_THEME_PACKAGE_ID_LENGTH) {
    throw themeError(path, `must not exceed ${MAX_THEME_PACKAGE_ID_LENGTH} characters.`);
  }
  if (!THEME_PACKAGE_ID.test(value)) {
    throw themeError(path, `"${value}" must be lowercase, start with a letter and use "-", "." or "/" only as separators.`);
  }
  return value;
}

function readThemeName(value: unknown, path: string): string {
  if (!isLocalThemeName(value)) {
    throw themeError(path, 'must be a lowercase kebab-case name that starts with a letter.');
  }
  if (value === 'default') {
    throw themeError(path, 'must not replace the reserved built-in "default" theme.');
  }
  return value;
}

function readThemeVersion(value: unknown, path: string): string {
  if (typeof value !== 'string' || !THEME_VERSION.test(value)) {
    throw themeError(path, 'must be a semantic version such as "1.0.0".');
  }
  return value;
}

function readColorSchemes(value: unknown, path: string): readonly ('light' | 'dark')[] {
  if (value === undefined) return Object.freeze(['light', 'dark'] as const);
  if (!Array.isArray(value)) throw themeError(path, 'must be an array of "light" and "dark".');
  const schemes: ('light' | 'dark')[] = [];
  for (const entry of value) {
    if (entry !== 'light' && entry !== 'dark') {
      throw themeError(path, 'may only contain "light" and "dark".');
    }
    if (schemes.includes(entry)) throw themeError(path, `must not repeat "${entry}".`);
    schemes.push(entry);
  }
  if (!schemes.includes('light') || !schemes.includes('dark')) {
    throw themeError(path, 'must declare both "light" and "dark".');
  }
  return Object.freeze(schemes);
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    if (css[index] === '\\') {
      index += 2;
      continue;
    }
    if (css[index] === quote) return index + 1;
    index += 1;
  }
  return css.length;
}

function skipBalanced(css: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    const character = css[index];
    if (character === '"' || character === "'") {
      index = skipString(css, index) - 1;
      continue;
    }
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = (end < 0 ? css.length : end + 2) - 1;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return css.length;
}

/** Read a `url(...)` value and return the trimmed target plus the end offset. */
function readUrlValue(css: string, start: number, path: string): { value: string; end: number } {
  let cursor = start + 3; // just past "url"
  while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
  if (css[cursor] !== '(') throw themeError(path, 'has a malformed url() value.');
  cursor += 1;
  while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
  const quote = css[cursor];
  if (quote === '"' || quote === "'") {
    const close = css.indexOf(quote, cursor + 1);
    if (close < 0) throw themeError(path, 'has an unterminated url() string.');
    const value = css.slice(cursor + 1, close);
    cursor = close + 1;
    while (cursor < css.length && /\s/.test(css[cursor])) cursor += 1;
    if (css[cursor] !== ')') throw themeError(path, 'has a malformed url() value.');
    return { value: value.trim(), end: cursor + 1 };
  }
  const close = css.indexOf(')', cursor);
  if (close < 0) throw themeError(path, 'has an unterminated url() value.');
  return { value: css.slice(cursor, close).trim(), end: close + 1 };
}

/** Read the argument body of a function at `start`, e.g. `image-set(...)`. */
function readFunctionBody(css: string, start: number, name: string, path: string): { body: string; end: number } {
  let open = start;
  while (open < css.length && css[open] !== '(') open += 1;
  if (open >= css.length) throw themeError(path, `has a malformed ${name}() value.`);
  const end = skipBalanced(css, open, '(', ')');
  if (end <= open + 1 || css[end - 1] !== ')') {
    throw themeError(path, `has an unterminated ${name}() value.`);
  }
  return { body: css.slice(open + 1, end - 1), end };
}

/**
 * `image-set("https://…")` fetches an image without a `url()` token. Phase-one
 * themes may only use inline `data:` entries, in either string or url() form.
 */
function assertImageSetEntries(body: string, path: string): void {
  let index = 0;
  while (index < body.length) {
    const character = body[index];
    if (character === '"' || character === "'") {
      const end = skipString(body, index);
      if (end > body.length || body[end - 1] !== character) {
        throw themeError(path, 'has an unterminated image-set() string.');
      }
      const value = body.slice(index + 1, end - 1).trim();
      if (!/^data:/i.test(value)) {
        throw themeError(path, 'image-set() entries must be inline data: URLs; network and file URLs are not allowed.');
      }
      index = end;
      continue;
    }
    if (character === '/' && body[index + 1] === '*') {
      const end = body.indexOf('*/', index + 2);
      index = end < 0 ? body.length : end + 2;
      continue;
    }
    index += 1;
  }
}


/**
 * Reject CSS that could escape the inline stylesheet or fetch a remote
 * resource. Only `data:` URLs are accepted in phase one.
 */
function assertSafeCss(css: string, path: string, allowFragments = false): void {
  if (css.toLowerCase().includes('</style')) {
    throw themeError(path, 'must not contain a closing style tag.');
  }
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '"' || character === "'") {
      index = skipString(css, index);
      continue;
    }
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    if (character === '\\') {
      throw themeError(path, 'must not use CSS escapes outside strings; escaped tokens can disguise url() or @import.');
    }
    if (character === '@' && /^@import\b/i.test(css.slice(index, index + 8))) {
      throw themeError(path, 'must not use @import; inline every resource.');
    }
    if ((character === 'i' || character === 'I' || character === '-')
      && /^(?:-webkit-)?image-set\s*\(/i.test(css.slice(index, index + 24))) {
      const { body } = readFunctionBody(css, index, 'image-set', path);
      assertImageSetEntries(body, path);
      index += 1;
      continue;
    }
    if ((character === 'u' || character === 'U') && /^url\s*\(/i.test(css.slice(index, index + 12))) {
      const url = readUrlValue(css, index, path);
      if (!/^data:/i.test(url.value) && !(allowFragments && url.value.startsWith('#'))) {
        throw themeError(path, 'may only reference data: URLs; network and file URLs are not allowed.');
      }
      index = url.end;
      continue;
    }
    if ((character === 'e' || character === 'E') && /^expression\s*\(/i.test(css.slice(index, index + 16))) {
      throw themeError(path, 'must not use CSS expression().');
    }
    index += 1;
  }
}

/** Network-free literal CSS for component resources as well as theme packages. */
export function isLocalInlineCss(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) return false;
  try { assertSafeCss(value, 'css', true); return true; } catch { return false; }
}

function splitSelectors(prelude: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < prelude.length; index += 1) {
    const character = prelude[index];
    if (character === '"' || character === "'") {
      index = skipString(prelude, index) - 1;
      continue;
    }
    if (character === '/' && prelude[index + 1] === '*') {
      const end = prelude.indexOf('*/', index + 2);
      index = (end < 0 ? prelude.length : end + 2) - 1;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '(') parentheses += 1;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(prelude.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(prelude.slice(start));
  return selectors;
}

function scopeSelector(selector: string, name: string): string {
  const trimmed = selector.trim();
  const scope = `[data-rmd-theme="${name}"]`;
  const existing = THEME_SCOPE_AT_START.exec(trimmed);
  if (existing) return `${scope}${trimmed.slice(existing[0].length)}`;
  return `${scope} ${trimmed}`;
}

function skipTrivia(input: string, start: number): number {
  let index = start;
  while (index < input.length) {
    if (/\s/.test(input[index])) {
      index += 1;
      continue;
    }
    if (input[index] === '/' && input[index + 1] === '*') {
      const end = input.indexOf('*/', index + 2);
      index = end < 0 ? input.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

/** Reject relative selectors in `:has()` that target siblings of the theme root. */
function assertHasNoSiblingSelectors(selector: string, rootEnd: number): void {
  const lower = selector.toLowerCase();
  const pattern = /:has\s*\(/g;
  for (let match = pattern.exec(lower); match; match = pattern.exec(lower)) {
    pattern.lastIndex = match.index + 1;
    // Only a :has() on the root compound can reach a sibling of the document.
    if (match.index >= rootEnd) continue;
    const open = match.index + match[0].length - 1;
    const end = skipBalanced(selector, open, '(', ')');
    const body = selector.slice(open + 1, Math.max(open + 1, end - 1));
    for (const part of splitSelectors(body)) {
      if (/^\s*[+~]/.test(part)) {
        throw themeError(
          'theme.css',
          `selector "${selector.trim()}" uses :has() with a sibling combinator that can escape the theme root.`,
        );
      }
    }
  }
}

/**
 * A selector that starts at the theme root may not continue with a sibling
 * combinator: `[data-rmd-theme="paper"] + .host` would restyle an element
 * outside the document root.
 */
function assertNoSiblingEscape(selector: string): void {
  const trimmed = selector.trim();
  if (trimmed === '') return;
  if (trimmed[0] === '+' || trimmed[0] === '~') {
    throw themeError('theme.css', `selector "${trimmed}" begins with a sibling combinator and cannot be scoped.`);
  }
  const scope = THEME_SCOPE_AT_START.exec(trimmed);
  if (scope) {
    let index = scope[0].length;
    while (index < trimmed.length) {
      const character = trimmed[index];
      if (/\s/.test(character) || character === '+' || character === '~' || character === '>' || character === ',') break;
      if (character === '[') {
        index = skipBalanced(trimmed, index, '[', ']');
        continue;
      }
      if (character === '(') {
        index = skipBalanced(trimmed, index, '(', ')');
        continue;
      }
      index += 1;
    }
    const combinator = skipTrivia(trimmed, index);
    if (trimmed[combinator] === '+' || trimmed[combinator] === '~') {
      throw themeError(
        'theme.css',
        `selector "${trimmed}" uses a sibling combinator that can escape the theme root.`,
      );
    }
    assertHasNoSiblingSelectors(trimmed, index);
  }
}

function scopeSelectorList(prelude: string, name: string): string {
  const selectors = splitSelectors(prelude).map((selector) => selector.trim()).filter(Boolean);
  if (selectors.length === 0) return prelude.trim();
  for (const selector of selectors) {
    if (HOST_GLOBAL_SELECTOR.test(selector)) {
      throw themeError(
        'theme.css',
        `selector "${selector}" targets the host document; scope it under the theme root instead.`,
      );
    }
    assertNoSiblingEscape(selector);
  }
  return selectors.map((selector) => scopeSelector(selector, name)).join(', ');
}

function findBlockEnd(css: string, start: number): number {
  let depth = 1;
  for (let index = start; index < css.length; index += 1) {
    const character = css[index];
    if (character === '"' || character === "'") {
      index = skipString(css, index) - 1;
      continue;
    }
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = (end < 0 ? css.length : end + 2) - 1;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return css.length;
}

function normalizeFontFamily(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function utf8String(bytes: readonly number[]): string | null {
  let result = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index];
    let code: number;
    let length: number;
    if (first <= 0x7f) {
      code = first;
      length = 1;
    } else if (first >= 0xc2 && first <= 0xdf) {
      code = first & 0x1f;
      length = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      code = first & 0x0f;
      length = 3;
    } else if (first >= 0xf0 && first <= 0xf4) {
      code = first & 0x07;
      length = 4;
    } else {
      return null;
    }
    if (index + length > bytes.length) return null;
    for (let offset = 1; offset < length; offset += 1) {
      const continuation = bytes[index + offset];
      if ((continuation & 0xc0) !== 0x80) return null;
      code = (code << 6) | (continuation & 0x3f);
    }
    if (length === 3 && (code < 0x800 || (code >= 0xd800 && code <= 0xdfff))) return null;
    if (length === 4 && (code < 0x10000 || code > 0x10ffff)) return null;
    result += String.fromCodePoint(code);
    index += length;
  }
  return result;
}

/** A deterministic, theme-scoped family name; the hex suffix is invertible. */
function generatedFontFamily(themeName: string, family: string): string {
  const hex = utf8Bytes(family).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `rmd-theme-${themeName}-font-${hex}`;
}

/** Recognise a family produced here and recover its original normalized name. */
function readGeneratedFontFamily(value: string): { themeName: string; original: string } | null {
  const match = GENERATED_FONT_FAMILY.exec(value);
  if (!match || match[2].length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let index = 0; index < match[2].length; index += 2) {
    bytes.push(Number.parseInt(match[2].slice(index, index + 2), 16));
  }
  const original = utf8String(bytes);
  if (original === null || original.length === 0) return null;
  // Only our own canonical encoding counts; an author's lookalike stays literal.
  if (normalizeFontFamily(original) !== original) return null;
  return { themeName: match[1], original };
}

interface CssValueToken {
  readonly type: 'ident' | 'string' | 'function' | 'number' | 'dimension' | 'percentage' | 'delimiter' | 'comma';
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly stringValue: string;
}

function isIdentChar(character: string | undefined): boolean {
  if (character === undefined) return false;
  return /[A-Za-z0-9_-]/.test(character) || (character.codePointAt(0) as number) >= 0x80;
}

function isIdentStart(css: string, index: number): boolean {
  const character = css[index];
  if (character === undefined) return false;
  if (/[A-Za-z_]/.test(character)) return true;
  if ((character.codePointAt(0) as number) >= 0x80) return true;
  if (character === '-') {
    const next = css[index + 1];
    return next !== undefined && (isIdentChar(next) || next === '-');
  }
  return false;
}

function startsNumber(css: string, index: number): boolean {
  const character = css[index];
  if (character === undefined) return false;
  if (character >= '0' && character <= '9') return true;
  const next = css[index + 1];
  if (character === '+' || character === '-') {
    return next !== undefined && ((next >= '0' && next <= '9') || next === '.');
  }
  if (character === '.') return next !== undefined && next >= '0' && next <= '9';
  return false;
}

/** Tokenize a declaration value without interpreting functions other than URL. */
function tokenizeCssValue(value: string): CssValueToken[] {
  const tokens: CssValueToken[] = [];
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2);
      index = end < 0 ? value.length : end + 2;
      continue;
    }
    const start = index;
    if (character === '"' || character === "'") {
      const end = skipString(value, index);
      tokens.push({
        type: 'string',
        text: value.slice(start, end),
        start,
        end,
        name: '',
        stringValue: value.slice(start + 1, Math.max(start + 1, end - 1)),
      });
      index = end;
      continue;
    }
    if (character === ',') {
      tokens.push({ type: 'comma', text: ',', start, end: index + 1, name: '', stringValue: '' });
      index += 1;
      continue;
    }
    if (startsNumber(value, index)) {
      let end = index;
      if (value[end] === '+' || value[end] === '-') end += 1;
      while (value[end] >= '0' && value[end] <= '9') end += 1;
      if (value[end] === '.') {
        end += 1;
        while (value[end] >= '0' && value[end] <= '9') end += 1;
      }
      if (value[end] === 'e' || value[end] === 'E') {
        const exponentStart = end;
        end += 1;
        if (value[end] === '+' || value[end] === '-') end += 1;
        const digitsStart = end;
        while (value[end] >= '0' && value[end] <= '9') end += 1;
        if (end === digitsStart) end = exponentStart;
      }
      let type: CssValueToken['type'] = 'number';
      if (value[end] === '%') {
        end += 1;
        type = 'percentage';
      } else if (isIdentStart(value, end)) {
        end += 1;
        while (isIdentChar(value[end])) end += 1;
        type = 'dimension';
      }
      tokens.push({ type, text: value.slice(start, end), start, end, name: '', stringValue: '' });
      index = end;
      continue;
    }
    if (isIdentStart(value, index)) {
      let end = index + 1;
      while (isIdentChar(value[end])) end += 1;
      const name = value.slice(index, end).toLowerCase();
      if (value[end] === '(') {
        const close = skipBalanced(value, end, '(', ')');
        const tokenEnd = Math.min(close, value.length);
        tokens.push({ type: 'function', text: value.slice(index, tokenEnd), start, end: tokenEnd, name, stringValue: '' });
        index = tokenEnd;
        continue;
      }
      tokens.push({ type: 'ident', text: value.slice(index, end), start, end, name, stringValue: '' });
      index = end;
      continue;
    }
    if (character === '(') {
      const close = skipBalanced(value, index, '(', ')');
      const end = Math.min(close, value.length);
      tokens.push({ type: 'function', text: value.slice(index, end), start, end, name: '', stringValue: '' });
      index = end;
      continue;
    }
    tokens.push({ type: 'delimiter', text: character, start, end: index + 1, name: '', stringValue: '' });
    index += 1;
  }
  return tokens;
}

interface ParsedFamily {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

function isWhitespaceOnly(value: string): boolean {
  return value.trim() === '';
}

/**
 * Read one `<family-name>`: a quoted string or an unquoted ident sequence.
 * Returns null for system/generic/CSS-wide keywords and for syntax this
 * validator cannot resolve (var(), mixed tokens, comments inside the name).
 */
function parseCssFamily(segment: string): ParsedFamily | null {
  const tokens = tokenizeCssValue(segment);
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && tokens[0].type === 'string') {
    const key = normalizeFontFamily(tokens[0].stringValue);
    if (key === '') return null;
    return { key, start: tokens[0].start, end: tokens[0].end };
  }
  if (tokens[0].type === 'string') return null;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'ident') return null;
    if (index > 0 && !isWhitespaceOnly(segment.slice(tokens[index - 1].end, tokens[index].start))) {
      return null;
    }
  }
  if (tokens.length === 1) {
    if (CSS_WIDE_KEYWORDS.has(tokens[0].name) || GENERIC_FONT_FAMILIES.has(tokens[0].name)) return null;
  }
  const key = normalizeFontFamily(tokens.map((token) => token.text).join(' '));
  if (key === '') return null;
  return {
    key,
    start: tokens[0].start,
    end: tokens[tokens.length - 1].end,
  };
}

interface ValueSegment {
  readonly start: number;
  readonly end: number;
}

/** Split a declaration value on top-level commas, preserving offsets. */
function splitValueSegments(value: string): ValueSegment[] {
  const segments: ValueSegment[] = [];
  let start = 0;
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (character === '"' || character === "'") {
      index = skipString(value, index);
      continue;
    }
    if (character === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2);
      index = end < 0 ? value.length : end + 2;
      continue;
    }
    if (character === '(' || character === '[') {
      index = skipBalanced(value, index, character, character === '(' ? ')' : ']');
      continue;
    }
    if (character === ',') {
      segments.push({ start, end: index });
      start = index + 1;
    }
    index += 1;
  }
  segments.push({ start, end: value.length });
  return segments;
}

function splitTrailingImportant(value: string): { body: string; important: string } {
  const tokens = tokenizeCssValue(value);
  if (tokens.length < 2) return { body: value, important: '' };
  const last = tokens[tokens.length - 1];
  const marker = tokens[tokens.length - 2];
  if (last.type !== 'ident' || last.name !== 'important') return { body: value, important: '' };
  if (marker.type !== 'delimiter' || marker.text !== '!') return { body: value, important: '' };
  if (!isWhitespaceOnly(value.slice(marker.end, last.start))) {
    return { body: value, important: '' };
  }
  return { body: value.slice(0, marker.start), important: value.slice(marker.start) };
}

interface TextReplacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function applyReplacements(value: string, replacements: readonly TextReplacement[]): string {
  if (replacements.length === 0) return value;
  const ordered = [...replacements].sort((left, right) => left.start - right.start);
  let result = '';
  let index = 0;
  for (const replacement of ordered) {
    if (replacement.start < index) continue;
    result += value.slice(index, replacement.start) + replacement.text;
    index = replacement.end;
  }
  return result + value.slice(index);
}

function quotedFamily(family: string): string {
  return `"${family}"`;
}

/** Rewrite only family entries that are declared by this theme. */
function rewriteFontFamilyList(value: string, families: ReadonlyMap<string, string>): string {
  const { body, important } = splitTrailingImportant(value);
  const segments = splitValueSegments(body);
  const replacements: TextReplacement[] = [];
  for (const segment of segments) {
    const parsed = parseCssFamily(body.slice(segment.start, segment.end));
    if (!parsed) continue;
    const target = families.get(parsed.key);
    if (!target) continue;
    replacements.push({
      start: segment.start + parsed.start,
      end: segment.start + parsed.end,
      text: quotedFamily(target),
    });
  }
  return applyReplacements(body, replacements) + important;
}

/** Locate the family list inside a `font` shorthand, or null if unsupported. */
function findFontFamilyStart(value: string): number | null {
  const tokens = tokenizeCssValue(value);
  if (tokens.length === 0) return null;
  if (
    tokens.length === 1
    && tokens[0].type === 'ident'
    && (SYSTEM_FONT_KEYWORDS.has(tokens[0].name) || CSS_WIDE_KEYWORDS.has(tokens[0].name))
  ) {
    return null;
  }
  let sizeIndex = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'dimension' || token.type === 'percentage') {
      sizeIndex = index;
      break;
    }
    if (token.type === 'ident' && FONT_SIZE_KEYWORDS.has(token.name)) {
      sizeIndex = index;
      break;
    }
    if (token.type === 'number' && Number(token.text) === 0) {
      sizeIndex = index;
      break;
    }
    if (token.type === 'function') {
      const next = tokens[index + 1];
      if (next?.type === 'delimiter' && next.text === '/') {
        sizeIndex = index;
        break;
      }
    }
  }
  if (sizeIndex < 0) return null;
  let familyIndex = sizeIndex + 1;
  const slash = tokens[familyIndex];
  if (slash?.type === 'delimiter' && slash.text === '/') familyIndex += 2;
  if (familyIndex >= tokens.length) return null;
  return tokens[familyIndex].start;
}

function rewriteFontShorthand(value: string, families: ReadonlyMap<string, string>): string | null {
  const { body, important } = splitTrailingImportant(value);
  const familyStart = findFontFamilyStart(body);
  if (familyStart === null) return null;
  const family = rewriteFontFamilyList(body.slice(familyStart), families);
  return `${body.slice(0, familyStart)}${family}${important}`;
}

interface DeclarationSpan {
  readonly name: string;
  readonly valueStart: number;
  readonly valueEnd: number;
}

/** Read top-level declarations of a rule body; nested blocks stay untouched. */
function scanDeclarations(body: string): DeclarationSpan[] {
  const declarations: DeclarationSpan[] = [];
  let index = 0;
  while (index < body.length) {
    const character = body[index];
    if (/\s/.test(character) || character === ';' || character === '}') {
      index += 1;
      continue;
    }
    if (character === '/' && body[index + 1] === '*') {
      const end = body.indexOf('*/', index + 2);
      index = end < 0 ? body.length : end + 2;
      continue;
    }
    if (character === '{') {
      index = findBlockEnd(body, index + 1) + 1;
      continue;
    }
    const declarationStart = index;
    let cursor = index;
    while (cursor < body.length) {
      const current = body[cursor];
      if (current === '"' || current === "'") {
        cursor = skipString(body, cursor);
        continue;
      }
      if (current === '/' && body[cursor + 1] === '*') {
        const end = body.indexOf('*/', cursor + 2);
        cursor = end < 0 ? body.length : end + 2;
        continue;
      }
      if (current === '(' || current === '[') {
        cursor = skipBalanced(body, cursor, current, current === '(' ? ')' : ']');
        continue;
      }
      if (current === ':' || current === ';' || current === '{' || current === '}') break;
      cursor += 1;
    }
    if (cursor >= body.length) break;
    if (body[cursor] !== ':') {
      if (body[cursor] === '{') {
        index = findBlockEnd(body, cursor + 1) + 1;
      } else {
        index = cursor + 1;
      }
      continue;
    }
    const name = body.slice(declarationStart, cursor).trim().toLowerCase();
    const valueStart = cursor + 1;
    let valueEnd = valueStart;
    while (valueEnd < body.length) {
      const current = body[valueEnd];
      if (current === '"' || current === "'") {
        valueEnd = skipString(body, valueEnd);
        continue;
      }
      if (current === '/' && body[valueEnd + 1] === '*') {
        const end = body.indexOf('*/', valueEnd + 2);
        valueEnd = end < 0 ? body.length : end + 2;
        continue;
      }
      if (current === '(' || current === '[') {
        valueEnd = skipBalanced(body, valueEnd, current, current === '(' ? ')' : ']');
        continue;
      }
      if (current === ';' || current === '{' || current === '}') break;
      valueEnd += 1;
    }
    if (name !== '') declarations.push({ name, valueStart, valueEnd });
    index = valueEnd;
    if (body[valueEnd] === ';') index = valueEnd + 1;
  }
  return declarations;
}

function rewriteDeclarationBody(body: string, families: ReadonlyMap<string, string>): string {
  const replacements: TextReplacement[] = [];
  for (const declaration of scanDeclarations(body)) {
    const familyProperty = declaration.name === 'font-family' || declaration.name === '--font-sans' || declaration.name === '--font-mono';
    if (!familyProperty && declaration.name !== 'font') continue;
    const value = body.slice(declaration.valueStart, declaration.valueEnd);
    const rewritten = familyProperty
      ? rewriteFontFamilyList(value, families)
      : rewriteFontShorthand(value, families);
    if (rewritten === null || rewritten === value) continue;
    replacements.push({ start: declaration.valueStart, end: declaration.valueEnd, text: rewritten });
  }
  return applyReplacements(body, replacements);
}

/** Walk every `@font-face` block, including those nested in conditional rules. */
function visitFontFaces(
  css: string,
  path: string,
  visit: (body: string, path: string) => void,
): void {
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (/\s/.test(character) || character === ';' || character === '}') {
      index += 1;
      continue;
    }
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    if (character === '{') {
      index = findBlockEnd(css, index + 1) + 1;
      continue;
    }
    const start = index;
    let cursor = index;
    while (cursor < css.length) {
      const current = css[cursor];
      if (current === '"' || current === "'") {
        cursor = skipString(css, cursor);
        continue;
      }
      if (current === '/' && css[cursor + 1] === '*') {
        const end = css.indexOf('*/', cursor + 2);
        cursor = end < 0 ? css.length : end + 2;
        continue;
      }
      if (current === '(' || current === '[') {
        cursor = skipBalanced(css, cursor, current, current === '(' ? ')' : ']');
        continue;
      }
      if (current === '{' || current === ';' || current === '}') break;
      cursor += 1;
    }
    if (cursor >= css.length) break;
    if (css[cursor] !== '{') {
      index = cursor + 1;
      continue;
    }
    const end = findBlockEnd(css, cursor + 1);
    const head = css.slice(start, cursor).trim();
    if (head.startsWith('@')) {
      const atName = (/^@([A-Za-z-]+)/.exec(head)?.[1] ?? '').toLowerCase();
      if (atName === 'font-face') {
        visit(css.slice(cursor + 1, end), path);
      } else if (CONDITIONAL_AT_RULES.has(atName)) {
        visitFontFaces(css.slice(cursor + 1, end), path, visit);
      }
    }
    index = Math.min(end + 1, css.length);
  }
}

/** Validate and return the single declared family name of one `@font-face`. */
function readFontFaceFamily(body: string, path: string): string {
  const declarations = scanDeclarations(body).filter((declaration) => declaration.name === 'font-family');
  if (declarations.length === 0) {
    throw themeError(path, '@font-face must declare a font-family descriptor.');
  }
  if (declarations.length > 1) {
    throw themeError(path, '@font-face may declare font-family only once.');
  }
  const value = body.slice(declarations[0].valueStart, declarations[0].valueEnd);
  const { body: core, important } = splitTrailingImportant(value);
  if (important !== '') {
    throw themeError(path, '@font-face descriptors must not use !important.');
  }
  if (splitValueSegments(core).length !== 1) {
    throw themeError(path, '@font-face font-family must be a single family name, not a list.');
  }
  const parsed = parseCssFamily(core);
  if (!parsed) {
    throw themeError(
      path,
      '@font-face font-family must be one quoted or unquoted family name; generic families, keywords, var() and other functions are not allowed.',
    );
  }
  if (utf8Bytes(readGeneratedFontFamily(parsed.key)?.original ?? parsed.key).length > MAX_FONT_FAMILY_NAME_BYTES) {
    throw themeError(path, `@font-face font-family must not exceed ${MAX_FONT_FAMILY_NAME_BYTES} UTF-8 bytes.`);
  }
  return parsed.key;
}

/**
 * Build the family mapping for a whole package. Declared families are read
 * from every resource first, so a reference in one resource resolves against a
 * `@font-face` declared in another.
 */
function buildFontFamilyMap(
  resources: readonly LocalStyleResource[],
  themeName: string,
  path: string,
): ReadonlyMap<string, string> {
  const families = new Map<string, string>();
  for (const resource of resources) {
    visitFontFaces(resource.css, path, (body, facePath) => {
      const declared = readFontFaceFamily(body, facePath);
      const generated = readGeneratedFontFamily(declared);
      const original = generated ? generated.original : declared;
      const target = generatedFontFamily(themeName, original);
      const existing = families.get(declared);
      if (existing !== undefined && existing !== target) {
        throw themeError(facePath, `@font-face family "${declared}" maps to more than one name.`);
      }
      families.set(declared, target);
      families.set(original, target);
    });
  }
  return families;
}

function rewriteFontFaceBody(
  body: string,
  families: ReadonlyMap<string, string>,
  path: string,
): string {
  const declarations = scanDeclarations(body).filter((declaration) => declaration.name === 'font-family');
  if (declarations.length !== 1) {
    throw themeError(path, '@font-face must declare exactly one font-family descriptor.');
  }
  const declaration = declarations[0];
  const value = body.slice(declaration.valueStart, declaration.valueEnd);
  const { body: core } = splitTrailingImportant(value);
  if (splitValueSegments(core).length !== 1) {
    throw themeError(path, '@font-face font-family must be a single family name, not a list.');
  }
  const parsed = parseCssFamily(core);
  if (!parsed) {
    throw themeError(path, '@font-face has an unsupported font-family descriptor.');
  }
  const target = families.get(parsed.key);
  if (target === undefined) {
    throw themeError(path, `@font-face family "${parsed.key}" was not registered.`);
  }
  return applyReplacements(body, [{
    start: declaration.valueStart + parsed.start,
    end: declaration.valueStart + parsed.end,
    text: quotedFamily(target),
  }]);
}

const EMPTY_FONT_FAMILIES: ReadonlyMap<string, string> = new Map();

function transformCss(css: string, name: string, families: ReadonlyMap<string, string> = EMPTY_FONT_FAMILIES): string {
  let result = '';
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      const stop = end < 0 ? css.length : end + 2;
      result += css.slice(index, stop);
      index = stop;
      continue;
    }
    if (/\s/.test(character) || character === ';' || character === '}') {
      result += character;
      index += 1;
      continue;
    }
    const preludeStart = index;
    let cursor = index;
    while (cursor < css.length) {
      const current = css[cursor];
      if (current === '"' || current === "'") {
        cursor = skipString(css, cursor);
        continue;
      }
      if (current === '/' && css[cursor + 1] === '*') {
        const end = css.indexOf('*/', cursor + 2);
        cursor = end < 0 ? css.length : end + 2;
        continue;
      }
      if (current === '(') {
        cursor = skipBalanced(css, cursor, '(', ')');
        continue;
      }
      if (current === '[') {
        cursor = skipBalanced(css, cursor, '[', ']');
        continue;
      }
      if (current === '{' || current === ';' || current === '}') break;
      cursor += 1;
    }
    if (cursor >= css.length) {
      result += css.slice(preludeStart);
      break;
    }
    const prelude = css.slice(preludeStart, cursor);
    const delimiter = css[cursor];
    if (delimiter === ';' || delimiter === '}') {
      result += prelude + delimiter;
      index = cursor + 1;
      continue;
    }
    const end = findBlockEnd(css, cursor + 1);
    const body = css.slice(cursor + 1, end);
    const head = prelude.trim();
    if (head.startsWith('@')) {
      const atName = (/^@([A-Za-z-]+)/.exec(head)?.[1] ?? '').toLowerCase();
      if (atName === 'import') throw themeError('theme.css', 'must not use @import.');
      if (atName === 'keyframes' || atName.endsWith('-keyframes')) {
        throw themeError(
          'theme.css',
          `@${atName} declares a global name; phase one only supports document-scoped CSS.`,
        );
      }
      if (atName === 'font-face') {
        result += `${head} {${rewriteFontFaceBody(body, families, 'theme.css')}}`;
      } else {
        const inner = CONDITIONAL_AT_RULES.has(atName) ? transformCss(body, name, families) : body;
        result += `${head} {${inner}}`;
      }
    } else {
      result += `${scopeSelectorList(head, name)} {${rewriteDeclarationBody(body, families)}}`;
    }
    index = Math.min(end + 1, css.length);
  }
  return result;
}

/** Scope every rule in `css` to the document root that selects `name`. */
function scopeCss(
  css: string,
  name: string,
  families: ReadonlyMap<string, string> = EMPTY_FONT_FAMILIES,
): string {
  return transformCss(css, name, families);
}

interface ReadResources {
  readonly resources: readonly LocalStyleResource[];
  readonly totalLength: number;
}

function readStyleResources(value: unknown, path: string): ReadResources {
  if (!Array.isArray(value)) throw themeError(path, 'must be an array of { id, css } resources.');
  if (value.length > MAX_THEME_RESOURCE_COUNT) {
    throw themeError(path, `may contain at most ${MAX_THEME_RESOURCE_COUNT} resources.`);
  }
  const ids = new Set<string>();
  const resources: LocalStyleResource[] = [];
  let totalLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    const lead = `${path}[${index}]`;
    if (!isRecord(entry)) throw themeError(lead, 'must be an object.');
    const id = entry.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw themeError(`${lead}.id`, 'must be a non-empty string.');
    }
    if (id.length > MAX_STYLE_RESOURCE_ID_LENGTH) {
      throw themeError(`${lead}.id`, `must not exceed ${MAX_STYLE_RESOURCE_ID_LENGTH} characters.`);
    }
    if (!STYLE_RESOURCE_ID.test(id)) {
      throw themeError(`${lead}.id`, `"${id}" must start with a letter and use letters, digits, ".", "_", "-" or "/".`);
    }
    if (ids.has(id)) throw themeError(`${lead}.id`, `"${id}" is declared more than once.`);
    ids.add(id);
    const css = entry.css;
    if (typeof css !== 'string') throw themeError(`${lead}.css`, 'must be a string.');
    if (css.length > MAX_THEME_RESOURCE_CSS_LENGTH) {
      throw themeError(`${lead}.css`, `must not exceed ${MAX_THEME_RESOURCE_CSS_LENGTH} characters.`);
    }
    totalLength += css.length;
    if (totalLength > MAX_THEME_TOTAL_CSS_LENGTH) {
      throw themeError(path, `must not exceed ${MAX_THEME_TOTAL_CSS_LENGTH} characters in total.`);
    }
    assertSafeCss(css, `${lead}.css`);
    resources.push(Object.freeze({ id, css }));
  }
  return { resources: Object.freeze(resources), totalLength };
}

function freezePackage(input: {
  id: string;
  name: string;
  version: string;
  protocol: typeof LOCAL_THEME_PROTOCOL;
  colorSchemes: readonly ('light' | 'dark')[];
  css: readonly LocalStyleResource[];
}): LocalThemePackage {
  return Object.freeze({
    id: input.id,
    name: input.name,
    version: input.version,
    protocol: input.protocol,
    colorSchemes: Object.freeze([...input.colorSchemes]),
    css: Object.freeze(input.css.map((resource) => Object.freeze({
      id: resource.id,
      css: resource.css,
    }))),
  });
}

function readPackage(value: unknown, path: string): LocalThemePackage {
  const record = requireRecord(value, path);
  const id = readThemeId(record.id, `${path}.id`);
  const name = readThemeName(record.name, `${path}.name`);
  const version = readThemeVersion(record.version, `${path}.version`);
  if (record.protocol !== LOCAL_THEME_PROTOCOL) {
    throw themeError(`${path}.protocol`, `must be "${LOCAL_THEME_PROTOCOL}".`);
  }
  const colorSchemes = readColorSchemes(record.colorSchemes, `${path}.colorSchemes`);
  const { resources } = readStyleResources(record.css, `${path}.css`);
  return freezePackage({
    id,
    name,
    version,
    protocol: LOCAL_THEME_PROTOCOL,
    colorSchemes,
    css: resources,
  });
}

/**
 * Validate, scope and freeze a theme package. The input is cloned; the result
 * and every nested resource are frozen.
 */
export function defineLocalTheme(input: LocalThemeInput): LocalThemePackage {
  const record = requireRecord(input as unknown, 'input');
  const id = readThemeId(record.id, 'theme.id');
  const name = readThemeName(record.name, 'theme.name');
  const version = readThemeVersion(record.version, 'theme.version');
  const protocol = record.protocol === undefined ? LOCAL_THEME_PROTOCOL : record.protocol;
  if (protocol !== LOCAL_THEME_PROTOCOL) {
    throw themeError('theme.protocol', `must be "${LOCAL_THEME_PROTOCOL}".`);
  }
  const colorSchemes = readColorSchemes(record.colorSchemes, 'theme.colorSchemes');
  const { resources } = readStyleResources(record.css, 'theme.css');
  const families = buildFontFamilyMap(resources, name, 'theme.css');
  const scoped = resources.map((resource) => Object.freeze({
    id: resource.id,
    css: scopeCss(resource.css, name, families),
  }));
  return freezePackage({
    id,
    name,
    version,
    protocol: LOCAL_THEME_PROTOCOL,
    colorSchemes,
    css: scoped,
  });
}

/**
 * Compose a base theme with ordered overrides under a new theme name.
 *
 * Base selectors are retargeted from the base theme root to the composed
 * theme root, so the result is a self-contained package that documents can
 * select with `<theme name="...">`. Overrides follow the base resources in
 * order and may not repeat an existing resource id.
 */
export function composeLocalTheme(input: LocalThemeCompositionInput): LocalThemePackage {
  const record = requireRecord(input as unknown, 'input');
  const id = readThemeId(record.id, 'theme.id');
  const name = readThemeName(record.name, 'theme.name');
  const version = readThemeVersion(record.version, 'theme.version');
  const base = readPackage(record.base, 'theme.base');
  const overrides = readStyleResources(record.overrides, 'theme.overrides');
  const families = buildFontFamilyMap(
    [...base.css, ...overrides.resources],
    name,
    'theme.css',
  );

  const ids = new Set(base.css.map((resource) => resource.id));
  for (const resource of overrides.resources) {
    if (ids.has(resource.id)) {
      throw themeError(
        'theme.overrides',
        `resource "${resource.id}" is already declared by the base theme.`,
      );
    }
    ids.add(resource.id);
  }

  const css = [
    ...base.css.map((resource) => Object.freeze({
      id: resource.id,
      css: scopeCss(resource.css, name, families),
    })),
    ...overrides.resources.map((resource) => Object.freeze({
      id: resource.id,
      css: scopeCss(resource.css, name, families),
    })),
  ];
  let total = 0;
  for (const resource of css) {
    total += resource.css.length;
    if (total > MAX_THEME_TOTAL_CSS_LENGTH) {
      throw themeError('theme.css', `must not exceed ${MAX_THEME_TOTAL_CSS_LENGTH} characters in total.`);
    }
  }

  return freezePackage({
    id,
    name,
    version,
    protocol: base.protocol,
    colorSchemes: base.colorSchemes,
    css,
  });
}

/**
 * Concatenate the package stylesheet in resource order. The returned text has
 * already been scoped at define/compose time.
 */
export function collectLocalThemeCss(theme: LocalThemePackage): string {
  const record = requireRecord(theme as unknown, 'theme');
  const { resources } = readStyleResources(record.css, 'theme.css');
  return resources.map((resource) => resource.css).join('\n');
}
