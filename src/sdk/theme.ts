import {
  LOCAL_THEME_PROTOCOL,
  isLocalThemeName,
  type LocalThemeDefinition,
} from '../local/theme';

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

function transformCss(css: string, name: string): string {
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
      if (atName === 'font-face' || atName === 'keyframes' || atName.endsWith('-keyframes')) {
        throw themeError(
          'theme.css',
          `@${atName} declares a global name; phase one only supports document-scoped CSS.`,
        );
      }
      const inner = CONDITIONAL_AT_RULES.has(atName) ? transformCss(body, name) : body;
      result += `${head} {${inner}}`;
    } else {
      result += `${scopeSelectorList(head, name)} {${body}}`;
    }
    index = Math.min(end + 1, css.length);
  }
  return result;
}

/** Scope every rule in `css` to the document root that selects `name`. */
function scopeCss(css: string, name: string): string {
  return transformCss(css, name);
}

interface ReadResources {
  readonly resources: readonly LocalStyleResource[];
  readonly totalLength: number;
}

function readStyleResources(value: unknown, path: string, themeName: string | null): ReadResources {
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
    resources.push(Object.freeze({
      id,
      css: themeName === null ? css : scopeCss(css, themeName),
    }));
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
  const { resources } = readStyleResources(record.css, `${path}.css`, null);
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
  const { resources } = readStyleResources(record.css, 'theme.css', name);
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
  const overrides = readStyleResources(record.overrides, 'theme.overrides', name);

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
      css: scopeCss(resource.css, name),
    })),
    ...overrides.resources,
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
  const { resources } = readStyleResources(record.css, 'theme.css', null);
  return resources.map((resource) => resource.css).join('\n');
}
