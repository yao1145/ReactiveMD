/**
 * Author CSS for independent documents.
 *
 * Two consumers share this module:
 *
 * - Component roots pass a declaration list (`css="max-width: 24rem"`) to
 *   `parseAuthorDeclarations`, which yields React style keys. Values keep a
 *   serializable `!important` suffix; interactive application should use
 *   `parseAuthorPriority` and `element.style.setProperty(name, value,
 *   'important')`, while SSR emits the same declaration text. React key names
 *   also make the record JSON-serializable without a second representation.
 * - Document `<css>` blocks pass a stylesheet to `scopeAuthorStyles`, which
 *   emits a single `@scope` rule rooted at the enclosing document or at a
 *   trusted selector, bounded by nested document roots.
 *
 * Everything here is pure string work. It runs unchanged in Node during SSR,
 * in a Worker, and in the browser; it never reads the DOM, and it never loads
 * an external resource. Unsupported constructs are dropped rather than
 * reinterpreted, so a hostile declaration cannot escape the `style` text or
 * the scope.
 */

/** Same inline image surface as the native HTML sanitizer. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

/**
 * Attribute marking a mounted document root. Nested roots carrying it bound
 * the generated scope, so an inner document keeps its own author styles.
 */
export const LOCAL_AUTHOR_DOCUMENT_MARKER = '[data-rmd-document]';

/** Value constructs that would fetch or execute something outside the document. */
const UNSAFE_VALUE_TOKENS = [
  '@import',
  'expression(',
  'javascript:',
  'vbscript:',
  '-moz-binding',
  'behavior:',
  'image-set(',
  '-webkit-image-set(',
] as const;

/** At-rules kept inside the document scope; all others are dropped. */
const SCOPED_AT_RULES = new Set(['media', 'supports', 'container', 'starting-style']);

/** Rules registering page-global names or resources; unsupported for now. */
const GLOBAL_AT_RULES = new Set([
  'import', 'charset', 'namespace', 'font-face', 'font-feature-values',
  'font-palette-values', 'keyframes', '-webkit-keyframes', 'page', 'property',
  'counter-style', 'viewport', 'custom-media', 'custom-selector', 'position-try',
  'layer', 'scope',
]);

const MAX_SCOPE_DEPTH = 4;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface AuthorCssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

interface CssChunk {
  readonly prelude: string;
  readonly block: string | null;
  readonly start: number;
  readonly blockStart: number;
}

/**
 * Split a component `css` attribute into React style keys.
 *
 * Invalid declarations, unsupported property names and any value that would
 * load an external resource are skipped individually; the rest of the list is
 * still accepted. Duplicate properties follow CSS cascade order, including
 * `!important` precedence.
 */
export function parseAuthorDeclarations(source: string): Readonly<Record<string, string>> {
  const declarations: Record<string, string> = {};
  const important: Record<string, boolean> = {};
  for (const part of splitTopLevel(stripComments(source), ';')) {
    const declaration = readDeclaration(part);
    if (!declaration) continue;
    const key = reactPropertyName(declaration.property);
    if (!key || !REACT_KEY.test(key)) continue;
    if (important[key] && !declaration.important) continue;
    important[key] = declaration.important;
    // A winning declaration belongs at its own source position. A shorthand
    // between the old and new occurrences can affect the same longhand.
    delete declarations[key];
    declarations[key] = declaration.important ? `${declaration.value} !important` : declaration.value;
  }
  return Object.freeze(declarations);
}

/** React's property object cannot express repeated declarations with fallback values. */
export function serializeAuthorDeclarationFallbacks(source: string): string | undefined {
  const declarations: string[] = [];
  const properties = new Set<string>();
  let repeated = false;
  for (const part of splitTopLevel(stripComments(source), ';')) {
    const declaration = readDeclaration(part);
    if (!declaration) continue;
    if (properties.has(declaration.property)) repeated = true;
    properties.add(declaration.property);
    declarations.push(`${declaration.property}:${declaration.value}${declaration.important ? ' !important' : ''};`);
  }
  return repeated ? declarations.join('') : undefined;
}

/** Split a serialized declaration value from its `!important` suffix. */
export function parseAuthorPriority(value: string): { value: string; important: boolean } {
  const match = /^([\s\S]*?)\s*!\s*important\s*$/i.exec(value.trim());
  return match
    ? { value: match[1].trimEnd(), important: true }
    : { value: value.trim(), important: false };
}

/**
 * Scope an author stylesheet to one mounted document.
 *
 * With no selector, the style element's parent is the scope root. An explicit
 * selector is validated for serialization. The lower bound excludes nested document
 * roots marked `[data-rmd-document]` together with their descendants, so an
 * inner document keeps its own author styles. Inherited properties still flow
 * in from the outer document by normal CSS inheritance.
 *
 * Returns an empty string when the stylesheet or selector yields nothing
 * usable. The result escapes style end tags while preserving CSS operators.
 */
export function scopeAuthorStyles(source: string, selector?: string): string {
  const root = selector === undefined ? ':scope' : normalizeScopeSelector(selector);
  if (!root) return '';
  const rules = scopeBlocks(source, 0);
  if (rules.length === 0) return '';
  const limit = `${root} ${LOCAL_AUTHOR_DOCUMENT_MARKER}`;
  const start = selector === undefined ? '' : ` (${root})`;
  const scoped = `@scope${start} to (${limit}) {\n${indent(rules.join('\n'))}\n}`;
  return safeForStyleText(scoped);
}

/** Locate unsupported global rules without rewriting comments or line endings. */
export function unsupportedAuthorCssRules(source: string, maxIssues: number) {
  const issues: { name: string; start: number; end: number }[] = [];
  function collect(text: string, offset: number, depth: number): void {
    if (depth > MAX_SCOPE_DEPTH) return;
    for (const chunk of readChunks(text)) {
      if (issues.length >= maxIssues) return;
      const name = /^@([A-Za-z-]+)/.exec(chunk.prelude)?.[1];
      if (!name) continue;
      const lower = name.toLowerCase();
      if (GLOBAL_AT_RULES.has(lower)) {
        const start = offset + chunk.start;
        issues.push({ name, start, end: start + name.length + 1 });
      } else if (SCOPED_AT_RULES.has(lower) && chunk.block !== null) {
        collect(chunk.block, offset + chunk.blockStart, depth + 1);
      }
    }
  }
  collect(source, 0, 0);
  return issues;
}

/* --------------------------------------------------------------- declaration */

const REACT_KEY = /^(?:--[\w-]+|[A-Za-z][\w$]*)$/;
const PROPERTY = /^(?:--[A-Za-z0-9_-]+|-{0,2}[A-Za-z][A-Za-z0-9-]*)$/;

function readDeclaration(text: string): AuthorCssDeclaration | null {
  const colon = firstTopLevelColon(text);
  if (colon < 1) return null;
  let property = text.slice(0, colon).trim();
  const rawValue = text.slice(colon + 1).trim();
  if (!PROPERTY.test(property) || rawValue === '') return null;
  if (!property.startsWith('--')) property = property.toLowerCase();
  const parsed = parseAuthorPriority(rawValue);
  if (!safeDeclarationValue(parsed.value)) return null;
  if (!parsed.important && /!\s*important\b/i.test(parsed.value)) return null;
  return { property, value: parsed.value, important: parsed.important };
}

function reactPropertyName(property: string): string | null {
  if (property.startsWith('--')) return property;
  const vendor = property.startsWith('-');
  const bare = property.replace(/^-+/, '');
  if (!bare) return null;
  const camel = bare.replace(/-+([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
  return vendor ? camel.charAt(0).toUpperCase() + camel.slice(1) : camel;
}

/**
 * Accept only values that are inert inside the style text and fetch nothing.
 * CSS escapes are decoded first, so `u\72 l(https://…)` is treated as `url()`.
 */
function safeDeclarationValue(value: string): boolean {
  if (value === '' || CONTROL_CHARACTERS.test(value)) return false;
  // `;` and `{}` outside strings and functions would start a new declaration
  // or rule. Angle brackets are legal in values (and in media queries);
  // serializers escape them, and scoped output escapes every `<`.
  const outer = scanOutside(value);
  if (outer.separator || outer.unbalanced) return false;
  const decoded = decodeCssEscapes(value);
  const lower = decoded.toLowerCase();
  if (UNSAFE_VALUE_TOKENS.some((token) => lower.includes(token))) return false;
  for (const url of urlArguments(decoded)) {
    if (!DATA_IMAGE.test(url.replace(/\s+/g, ''))) return false;
  }
  return true;
}

/** Report unsafe separators, unbalanced quotes/brackets, and markup queued to end a style element. */
function scanOutside(value: string): { separator: boolean; unbalanced: boolean } {
  let quote = '';
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') {
      depth -= 1;
      if (depth < 0) return { separator: true, unbalanced: true };
    } else if (depth === 0 && (character === ';' || character === '{' || character === '}')) {
      return { separator: true, unbalanced: false };
    }
  }
  return { separator: false, unbalanced: quote !== '' || depth !== 0 };
}

/** Contents of every `url(...)` occurrence, quotes removed. */
function urlArguments(value: string): string[] {
  const found: string[] = [];
  const pattern = /url\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    let index = match.index + match[0].length;
    let quote = '';
    let argument = '';
    while (index < value.length) {
      const character = value[index];
      if (quote) {
        if (character === '\\' && index + 1 < value.length) {
          argument += value[index + 1];
          index += 2;
          continue;
        }
        if (character === quote) {
          quote = '';
          index += 1;
          continue;
        }
        argument += character;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ')') {
        break;
      } else {
        argument += character;
      }
      index += 1;
    }
    found.push(argument.trim());
  }
  return found;
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g, (_match, hex: string, character: string) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return code === 0 || code > 0x10ffff ? '�' : String.fromCodePoint(code);
    }
    return character ?? '';
  });
}

/* --------------------------------------------------------------- stylesheet */

function scopeBlocks(source: string, depth: number): string[] {
  if (depth > MAX_SCOPE_DEPTH) return [];
  const rules: string[] = [];
  for (const chunk of readChunks(stripComments(source))) {
    if (chunk.prelude.startsWith('@')) {
      const name = /^@([A-Za-z-]+)/.exec(chunk.prelude)?.[1]?.toLowerCase();
      if (!name || GLOBAL_AT_RULES.has(name) || !SCOPED_AT_RULES.has(name)) continue;
      if (chunk.block === null) continue;
      const params = safeAtRuleParams(chunk.prelude.slice(name.length + 1));
      if (params === null) continue;
      const inner = scopeBlocks(chunk.block, depth + 1);
      if (inner.length === 0) continue;
      const header = params ? `@${name} ${params}` : `@${name}`;
      rules.push(`${header} {\n${indent(inner.join('\n'))}\n}`);
      continue;
    }
    if (chunk.block === null) continue;
    const selectors = splitTopLevel(chunk.prelude, ',')
      .map((selector) => selector.trim())
      .filter(scopedSelector);
    if (selectors.length === 0) continue;
    const declarations = declarationBlock(chunk.block);
    if (declarations.length === 0) continue;
    rules.push(`${selectors.join(', ')} {\n${indent(declarations.join('\n'))}\n}`);
  }
  return rules;
}

function declarationBlock(block: string): string[] {
  const lines: string[] = [];
  for (const part of splitTopLevel(block, ';')) {
    const declaration = readDeclaration(part);
    if (!declaration) continue;
    lines.push(`${declaration.property}: ${declaration.value}${declaration.important ? ' !important' : ''};`);
  }
  return lines;
}

/** Selectors that could match outside the mounted root keep their meaning only when scoped. */
function scopedSelector(selector: string): boolean {
  if (selector === '' || selector.length > 512) return false;
  if (/[{}@;]/.test(selector) || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(selector)) return false;
  if (/:root\b/i.test(selector)) return false;
  // Element selectors for the page roots would cross the document boundary.
  if (/(^|[\s>+~,])(?:html|body)(?:$|[\s.#:[>+~,])/i.test(selector)) return false;
  return true;
}

function safeAtRuleParams(params: string): string | null {
  const trimmed = params.trim();
  if (!trimmed) return '';
  if (/[{}]/.test(trimmed) || CONTROL_CHARACTERS.test(trimmed)) return null;
  const decoded = decodeCssEscapes(trimmed).toLowerCase();
  if (UNSAFE_VALUE_TOKENS.some((token) => decoded.includes(token))) return null;
  for (const url of urlArguments(decoded)) {
    if (!DATA_IMAGE.test(url.replace(/\s+/g, ''))) return null;
  }
  return trimmed;
}

function normalizeScopeSelector(selector: string): string {
  const trimmed = selector.trim();
  if (trimmed === '' || trimmed.length > 512) return '';
  // The selector is already trusted; reject only text that could end the
  // generated @scope prelude or the surrounding style element.
  if (/[{}<>@;]|\/\*|[\u0000-\u001f\u007f]/.test(trimmed)) return '';
  const pairs: Record<string, string> = { ']': '[', ')': '(' };
  const open: string[] = [];
  for (const character of trimmed) {
    if (character === '[' || character === '(') open.push(character);
    else if (pairs[character]) {
      if (open.pop() !== pairs[character]) return '';
    }
  }
  if (open.length > 0) return '';
  // A dangling combinator would make the produced @scope invalid.
  if (/[\s>+~,]$/.test(trimmed)) return '';
  return trimmed;
}

/** Escape the HTML raw-text closing token while keeping CSS's range syntax. */
function safeForStyleText(css: string): string {
  return css.replace(/\u0000/g, '�').replace(/<(?=\/style[\t\n\f\r />])/gi, '\\3c ');
}

function indent(text: string): string {
  return text.split('\n').map((line) => line ? `  ${line}` : line).join('\n');
}

/* --------------------------------------------------------------- scanning */

function stripComments(source: string): string {
  let output = '';
  let quote = '';
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (quote) {
      output += character;
      if (character === '\\' && index + 1 < source.length) {
        output += source[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) quote = '';
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      current += character;
      if (character === '\\' && index + 1 < text.length) {
        current += text[index + 1];
        index += 1;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && character === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function firstTopLevelColon(text: string): number {
  let quote = '';
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ':' && depth === 0) return index;
  }
  return -1;
}

function blockEnd(source: string, open: number): number {
  let level = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) return -1;
      index = close + 1;
      continue;
    }
    if (character === '{') level += 1;
    else if (character === '}') {
      level -= 1;
      if (level === 0) return index;
    }
  }
  return -1;
}

/**
 * Read a stylesheet into top-level statements and blocks. CSS comments must be
 * removed beforehand. An unterminated block or a stray `}` stops the scan with
 * what was already accepted, matching stylesheet error recovery.
 */
function readChunks(source: string): CssChunk[] {
  const chunks: CssChunk[] = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length) {
      if (/\s/.test(source[index])) index += 1;
      else if (source.startsWith('/*', index)) {
        const close = source.indexOf('*/', index + 2);
        index = close < 0 ? source.length : close + 2;
      } else break;
    }
    if (index >= source.length) break;
    const start = index;
    let quote = '';
    let terminator = '';
    while (index < source.length) {
      const character = source[index];
      if (quote) {
        if (character === '\\') index += 2;
        else {
          if (character === quote) quote = '';
          index += 1;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        index += 1;
        continue;
      }
      if (character === '/' && source[index + 1] === '*') {
        const close = source.indexOf('*/', index + 2);
        index = close < 0 ? source.length : close + 2;
        continue;
      }
      if (character === '{' || character === ';' || character === '}') {
        terminator = character;
        break;
      }
      index += 1;
    }
    const prelude = source.slice(start, index).trim();
    if (terminator === '{') {
      const close = blockEnd(source, index);
      if (close < 0) {
        if (prelude) chunks.push({ prelude, block: null, start, blockStart: index + 1 });
        break;
      }
      if (prelude) chunks.push({ prelude, block: source.slice(index + 1, close), start, blockStart: index + 1 });
      index = close + 1;
      continue;
    }
    if (prelude) chunks.push({ prelude, block: null, start, blockStart: index });
    if (terminator === '') break;
    index += 1;
  }
  return chunks;
}
