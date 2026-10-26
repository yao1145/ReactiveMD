import { defaultTreeAdapter, parse, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { localDiagnosticDetails } from './diagnostics';
import { MAX_LOCAL_DIAGNOSTICS } from './limits';
import type { Diagnostic, LocalHtmlPolicy } from './types';
import { LOCAL_HTML_ALIGN_ELEMENTS, localHtmlAlign } from './html-names';
import { HTML_TABLE_NAMES, HTML_TABLE_ATTRIBUTES, validHtmlTableValue } from './html-table';

type PElement = DefaultTreeAdapterTypes.Element;
type PParent = DefaultTreeAdapterTypes.ParentNode;
type PChild = DefaultTreeAdapterTypes.ChildNode;
type PAttribute = { name: string; value: string; namespace?: string; prefix?: string };

const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Safe P0 elements shared by the Markdown embedding path and native mode. */
const P0_ELEMENTS = new Set([
  'b', 'strong', 'i', 'em', 's', 'del', 'u', 'mark', 'sup', 'sub',
  'br', 'hr',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'span',
  'details', 'summary',
  'blockquote',
  'code', 'pre',
  'ul', 'ol', 'li',
  'a', 'img',
  ...HTML_TABLE_NAMES,
]);

/** Structural wrappers the HTML parser inserts for a whole document. */
const WRAPPER_ELEMENTS = new Set(['html', 'head', 'body']);

/** Elements that can never run as markup, even with the extended gate. */
const ALWAYS_DENIED = new Set(['frameset', 'frame', 'noframes', 'applet']);

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const ANIMATION_ELEMENTS = new Set([
  'animate', 'animatemotion', 'animatetransform', 'set', 'discard',
]);

/** SVG presentation properties double as author CSS entry points. */
const PRESENTATION_ATTRIBUTES = new Set([
  'alignment-baseline', 'baseline-shift', 'clip', 'clip-path', 'clip-rule',
  'color', 'color-interpolation', 'color-interpolation-filters',
  'color-rendering', 'cursor', 'direction', 'display', 'dominant-baseline',
  'fill', 'fill-opacity', 'fill-rule', 'filter', 'flood-color', 'flood-opacity',
  'font', 'font-family', 'font-size', 'font-size-adjust', 'font-stretch',
  'font-style', 'font-variant', 'font-weight', 'glyph-orientation-horizontal',
  'glyph-orientation-vertical', 'image-rendering', 'kerning', 'letter-spacing',
  'lighting-color', 'marker', 'marker-end', 'marker-mid', 'marker-start',
  'mask', 'opacity', 'overflow', 'paint-order', 'pointer-events',
  'shape-rendering', 'stop-color', 'stop-opacity', 'stroke', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-width', 'text-anchor', 'text-decoration',
  'text-rendering', 'transform-origin', 'unicode-bidi', 'vector-effect',
  'visibility', 'word-spacing', 'writing-mode',
]);

const P0_GLOBAL_ATTRIBUTES = new Set(['id', 'class', 'title', 'lang', 'dir']);
const LEGACY_PRESENTATION_ATTRIBUTES = new Set([
  'align', 'bgcolor', 'background', 'face', 'text', 'link', 'alink', 'vlink',
  'border', 'cellpadding', 'cellspacing', 'frame', 'rules', 'hspace', 'vspace',
]);
const P0_TAG_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt', 'width', 'height']),
  ol: new Set(['start']),
  details: new Set(['open']),
  ...HTML_TABLE_ATTRIBUTES,
  // These elements are admitted by their own capability before attributes are
  // checked. Keep their execution/media semantics independent of extended HTML.
  script: new Set(['type', 'src', 'async', 'defer', 'nomodule', 'crossorigin', 'integrity', 'referrerpolicy']),
  style: new Set(['type', 'media']),
  link: new Set(['rel', 'href', 'type', 'media', 'crossorigin', 'integrity', 'referrerpolicy', 'disabled']),
};

const URL_ATTRIBUTES: Record<string, 'link' | 'image' | 'frame' | 'media' | 'form' | 'source'> = {
  href: 'link',
  action: 'form',
  formaction: 'form',
  poster: 'image',
  background: 'image',
  data: 'frame',
  src: 'source',
  cite: 'link',
  longdesc: 'link',
};

const MAX_HTML_SRCDOC_DEPTH = 4;

export interface LocalHtmlSanitizeResult {
  markup: string;
  diagnostics: Diagnostic[];
}

interface LineIndex {
  readonly starts: number[];
}

interface SanitizeState {
  readonly policy: LocalHtmlPolicy;
  readonly source: string;
  readonly lines: LineIndex;
  readonly diagnostics: Diagnostic[];
  readonly maxNodes: number;
  readonly depth: number;
  readonly budget: { nodes: number };
  bodyFallbacks: string[];
  stopped: boolean;
}

class HtmlBudgetError extends Error {
  constructor(readonly start: number, readonly end: number, readonly limit: number) {
    super(`Syntax nodes exceed the limit of ${limit}.`);
    this.name = 'HtmlBudgetError';
  }
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function position(state: SanitizeState, start: number, end: number): { start: number; end: number; line: number; column: number } {
  const length = state.source.length;
  const safeStart = Math.max(0, Math.min(length, start));
  const safeEnd = Math.max(safeStart, Math.min(length, Math.max(safeStart, end)));
  let low = 0;
  let high = state.lines.starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (state.lines.starts[middle] <= safeStart) low = middle;
    else high = middle - 1;
  }
  return {
    start: safeStart,
    end: safeEnd,
    line: low + 1,
    column: safeStart - state.lines.starts[low] + 1,
  };
}

function warn(
  state: SanitizeState,
  code: string,
  message: string,
  start: number,
  end: number,
  details?: { key: string; params?: Record<string, unknown> },
): void {
  if (state.diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) return;
  const place = position(state, start, end);
  const bounded = localDiagnosticDetails(details?.key ?? code, details?.params);
  state.diagnostics.push({
    code,
    message,
    severity: 'warning',
    range: { start: place.start, end: place.end },
    line: place.line,
    column: place.column,
    messageKey: bounded.key,
    ...(bounded.params ? { params: bounded.params } : {}),
  });
}

function elementRange(element: PElement, state: SanitizeState): { start: number; end: number } {
  const location = element.sourceCodeLocation;
  const start = location && Number.isInteger(location.startOffset) ? location.startOffset : 0;
  const end = location && Number.isInteger(location.endOffset) ? location.endOffset : start;
  return { start: Math.max(0, Math.min(state.source.length, start)), end: Math.max(0, Math.min(state.source.length, end)) };
}

function attributeRange(element: PElement, attribute: PAttribute, state: SanitizeState): { start: number; end: number } {
  const location = element.sourceCodeLocation;
  const attrs = location?.attrs;
  const found = attrs && (attrs[attribute.name] ?? (attribute.prefix ? attrs[`${attribute.prefix}:${attribute.name}`] : undefined));
  if (found && Number.isInteger(found.startOffset) && Number.isInteger(found.endOffset)) {
    return { start: found.startOffset, end: found.endOffset };
  }
  return elementRange(element, state);
}

function countNode(state: SanitizeState, start: number, end: number): void {
  state.budget.nodes += 1;
  if (state.budget.nodes > state.maxNodes) throw new HtmlBudgetError(start, end, state.maxNodes);
}

function fallbackSource(element: PElement, state: SanitizeState): string {
  const range = elementRange(element, state);
  return state.source.slice(range.start, range.end).replace(/\u0000/g, '�');
}

function makeText(value: string): DefaultTreeAdapterTypes.TextNode {
  return defaultTreeAdapter.createTextNode(value.replace(/\u0000/g, '�'));
}

function normalizedUrl(value: string): string {
  return value.replace(/[\u0000- \u007f-\u009f]+/g, '');
}

function schemeOf(value: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalizedUrl(value));
  return match ? match[1].toLowerCase() : null;
}

function safeUrl(value: string, kind: 'link' | 'image' | 'frame' | 'media' | 'form' | 'source'): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  const scheme = schemeOf(trimmed);
  if (scheme === null) return true;
  if (scheme === 'javascript' || scheme === 'vbscript') return false;
  if (scheme === 'data') {
    if (kind !== 'image') return false;
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(trimmed.replace(/\s+/g, ''));
  }
  if (scheme === 'http' || scheme === 'https') return true;
  if (kind === 'link' && (scheme === 'mailto' || scheme === 'tel')) return true;
  // Relative fragments are handled above; unknown schemes stay rejected.
  return false;
}

function isUrlAttribute(name: string): boolean {
  return Object.hasOwn(URL_ATTRIBUTES, name) || name === 'xlink:href';
}

function urlKind(name: string, tag: string): 'link' | 'image' | 'frame' | 'media' | 'form' | 'source' {
  if ((name === 'href' || name === 'xlink:href') && tag === 'image') return 'image';
  if (name === 'href' && tag === 'base') return 'source';
  if (name === 'xlink:href') return 'link';
  if (name === 'src') {
    if (tag === 'img' || tag === 'image') return 'image';
    if (tag === 'iframe' || tag === 'frame' || tag === 'embed') return 'frame';
    if (tag === 'audio' || tag === 'video' || tag === 'source' || tag === 'track') return 'media';
    return 'source';
  }
  return URL_ATTRIBUTES[name] ?? 'source';
}

function allowedP0Attribute(tag: string, name: string): boolean {
  if (P0_GLOBAL_ATTRIBUTES.has(name)) return true;
  if (name.startsWith('aria-') || name.startsWith('data-')) return true;
  return P0_TAG_ATTRIBUTES[tag]?.has(name) ?? false;
}

function isEventHandler(name: string): boolean {
  return /^on[a-z]/i.test(name);
}

function isPresentationAttribute(name: string, html: boolean): boolean {
  if (PRESENTATION_ATTRIBUTES.has(name)) return true;
  return html && LEGACY_PRESENTATION_ATTRIBUTES.has(name);
}

/** The sandbox always keeps author documents separate from their host. */
export function localHtmlSandbox(policy: LocalHtmlPolicy): string {
  return [
    ...(policy.enableJavaScript ? ['allow-scripts'] : []),
    ...(policy.enableExtendedHtml ? ['allow-forms'] : []),
  ].join(' ');
}

function sanitizeSandbox(value: string, policy: LocalHtmlPolicy): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((token) => {
    const normalized = token.toLowerCase();
    if (normalized === 'allow-same-origin') return false;
    if (normalized === 'allow-top-navigation' || normalized === 'allow-top-navigation-by-user-activation') return false;
    if (normalized === 'allow-parent-navigation') return false;
    if (normalized === 'allow-popups' || normalized === 'allow-popups-to-escape-sandbox') return false;
    if (normalized === 'allow-modals' || normalized === 'allow-downloads') return false;
    if (normalized === 'allow-orientation-lock' || normalized === 'allow-pointer-lock') return false;
    if (normalized === 'allow-presentation') return false;
    if (normalized === 'allow-forms') return policy.enableExtendedHtml;
    if (normalized === 'allow-scripts') return policy.enableJavaScript;
    return false;
  });
  return kept.join(' ');
}

function findChildElement(parent: PParent, tag: string): PElement | null {
  for (const child of parent.childNodes) {
    if (defaultTreeAdapter.isElementNode(child) && child.tagName.toLowerCase() === tag) return child;
  }
  return null;
}

function serializeChildren(parent: PParent): string {
  let output = '';
  for (const child of parent.childNodes) output += serializeOuter(child, { scriptingEnabled: false });
  return output;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Resources stay offline; extended HTML permits explicit HTTP(S) form submissions. */
export function localHtmlContentSecurityPolicy(policy: LocalHtmlPolicy): string {
  const directives = [
    "default-src 'none'",
    policy.enableExtendedHtml ? "base-uri 'self' http: https:" : "base-uri 'none'",
    policy.enableExtendedHtml ? 'form-action http: https:' : "form-action 'none'",
    "object-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "font-src data:",
    "img-src data:",
    policy.enableCss ? "style-src 'unsafe-inline'" : "style-src 'none'",
    policy.enableJavaScript ? "script-src 'unsafe-inline'" : "script-src 'none'",
    policy.enableExtendedHtml ? 'frame-src about: data: blob:' : "frame-src 'none'",
  ];
  return directives.join('; ');
}

function shell(state: SanitizeState, document: DefaultTreeAdapterTypes.Document): string {
  const html = findChildElement(document, 'html');
  const head = html ? findChildElement(html, 'head') : null;
  const body = html ? findChildElement(html, 'body') : null;
  const headExtra = head ? serializeChildren(head) : '';
  let bodyMarkup = body ? serializeChildren(body) : (html ? serializeChildren(html) : serializeChildren(document));
  if (state.bodyFallbacks.length > 0) {
    const fallbackMarkup = state.bodyFallbacks
      .map((value) => serializeOuter(makeText(value), { scriptingEnabled: false }))
      .join('');
    bodyMarkup = fallbackMarkup + bodyMarkup;
  }
  const csp = escapeAttribute(localHtmlContentSecurityPolicy(state.policy));
  const attributes = (element: PElement | null) => (element?.attrs ?? [])
    .map(attribute => ` ${attribute.prefix ? `${attribute.prefix}:` : ''}${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
  return `<!doctype html><html${attributes(html)}><head${attributes(head)}><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${headExtra}</head><body${attributes(body)}>${bodyMarkup}</body></html>`;
}

function sanitizeSrcdoc(value: string, state: SanitizeState): string {
  if (state.depth >= MAX_HTML_SRCDOC_DEPTH) return '';
  let document: DefaultTreeAdapterTypes.Document;
  try {
    document = parse(value, { scriptingEnabled: false, sourceCodeLocationInfo: false });
  } catch {
    return '';
  }
  const nested: SanitizeState = {
    ...state,
    source: value,
    lines: { starts: lineStarts(value) },
    depth: state.depth + 1,
    bodyFallbacks: [],
    // Diagnostics and the node budget stay shared with the outer document.
  };
  try {
    const html = findChildElement(document, 'html');
    if (html) {
      cleanAttributes(html, 'html', true, nested);
      cleanParent(html, nested, false);
    }
    return shell(nested, document);
  } catch (error) {
    if (error instanceof HtmlBudgetError) throw error;
    return '';
  }
}

function cleanAttributes(element: PElement, tag: string, html: boolean, state: SanitizeState): void {
  const location = element.sourceCodeLocation;
  const kept: PAttribute[] = [];
  let sandboxed = false;
  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase();
    const fullName = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
    const range = attributeRange(element, attribute, state);

    if (html && HTML_TABLE_NAMES.has(tag) && !validHtmlTableValue(name, attribute.value)) {
      warn(state, 'local.html.table', `Invalid value for ${name} on native HTML <${tag}>.`, range.start, range.end, {
        key: 'html.table.value', params: { name, tag },
      });
      continue;
    }

    if (html && name === 'align' && LOCAL_HTML_ALIGN_ELEMENTS.has(tag)) {
      const align = localHtmlAlign(attribute.value);
      if (align) {
        kept.push({ ...attribute, value: align });
      } else {
        warn(state, 'local.html.attribute', 'HTML attribute align requires left, center, right or justify.', range.start, range.end, {
          key: 'local.html.attribute', params: { name: fullName, tag },
        });
      }
      continue;
    }

    if (isEventHandler(name)) {
      if (!state.policy.enableJavaScript) {
        warn(state, 'local.html.capability', `Author event handler attribute ${fullName} was disabled by the compile options.`, range.start, range.end, {
          key: 'local.html.capability', params: { feature: 'event handlers' },
        });
        continue;
      }
      kept.push(attribute);
      continue;
    }

    if (name === 'style' || isPresentationAttribute(name, html)) {
      if (!state.policy.enableCss) {
        warn(state, 'local.html.capability', `Author style attribute ${fullName} was disabled by the compile options.`, range.start, range.end, {
          key: 'local.html.capability', params: { feature: 'CSS' },
        });
        continue;
      }
      kept.push(attribute);
      continue;
    }

    if (name === 'srcset' || name === 'imagesrcset') {
      warn(state, 'local.html.unsafe-url', `Unsafe URL in attribute ${fullName} was removed.`, range.start, range.end, {
        key: 'local.html.unsafe-url', params: { name: fullName },
      });
      continue;
    }

    if (name === 'srcdoc' && tag === 'iframe') {
      const sanitized = sanitizeSrcdoc(attribute.value, state);
      if (sanitized === '') continue;
      attribute.value = sanitized;
      kept.push(attribute);
      continue;
    }

    if (name === 'sandbox' && tag === 'iframe') {
      attribute.value = sanitizeSandbox(attribute.value, state.policy);
      sandboxed = true;
      kept.push(attribute);
      continue;
    }

    if (isUrlAttribute(name) && !safeUrl(attribute.value, urlKind(name, tag))) {
      warn(state, 'local.html.unsafe-url', `Unsafe URL in attribute ${fullName} was removed.`, range.start, range.end, {
        key: 'local.html.unsafe-url', params: { name: fullName },
      });
      continue;
    }

    if (name === 'target' && /^_(?:top|parent)$/i.test(attribute.value.trim())) {
      warn(state, 'local.html.capability', `Navigation target ${attribute.value} was disabled.`, range.start, range.end, {
        key: 'local.html.capability', params: { feature: 'top-level navigation' },
      });
      continue;
    }

    if (!state.policy.enableExtendedHtml && !allowedP0Attribute(tag, name)) {
      warn(state, 'local.html.attribute', `HTML attribute ${fullName} on <${tag}> is not supported; the element is shown as source.`, range.start, range.end, {
        key: 'local.html.attribute', params: { name: fullName, tag },
      });
      continue;
    }

    kept.push(attribute);
  }

  if (tag === 'iframe' && !sandboxed) {
    kept.push({ name: 'sandbox', value: localHtmlSandbox(state.policy) });
  }
  element.attrs = kept;
  void location;
}

function cleanElement(element: PElement, state: SanitizeState, inHead: boolean): PChild[] {
  const range = elementRange(element, state);
  countNode(state, range.start, range.end);
  const tag = element.tagName.toLowerCase();
  const html = element.namespaceURI === HTML_NS;

  if (ALWAYS_DENIED.has(tag)) {
    state.bodyFallbacks.push(fallbackSource(element, state));
    warn(state, 'local.html.extended', `HTML element <${tag}> requires enableExtendedHtml in this mode; it is shown as source.`, range.start, range.end, {
      key: 'local.html.extended', params: { name: tag },
    });
    return [];
  }

  if (!html && !state.policy.enableCss && ANIMATION_ELEMENTS.has(tag)) {
    warn(state, 'local.html.capability', `Author animation <${tag}> was disabled by the compile options.`, range.start, range.end, {
      key: 'local.html.capability', params: { feature: 'animation' },
    });
    return [];
  }

  if (tag === 'script') {
    if (!state.policy.enableJavaScript) {
      warn(state, 'local.html.capability', 'Author JavaScript was disabled by the compile options.', range.start, range.end, {
        key: 'local.html.capability', params: { feature: 'JavaScript' },
      });
      return [];
    }
    cleanAttributes(element, tag, html, state);
    return [element];
  }

  if (tag === 'style') {
    if (!state.policy.enableCss) {
      warn(state, 'local.html.capability', 'Author CSS was disabled by the compile options.', range.start, range.end, {
        key: 'local.html.capability', params: { feature: 'CSS' },
      });
      return [];
    }
    cleanAttributes(element, tag, html, state);
    return [element];
  }

  if (tag === 'link') {
    const rel = element.attrs.find((attribute) => attribute.name.toLowerCase() === 'rel')?.value.toLowerCase() ?? '';
    if (rel.split(/\s+/).includes('stylesheet')) {
      if (!state.policy.enableCss) {
        warn(state, 'local.html.capability', 'Author CSS was disabled by the compile options.', range.start, range.end, {
          key: 'local.html.capability', params: { feature: 'CSS' },
        });
        return [];
      }
      cleanAttributes(element, tag, html, state);
      return [element];
    }
    if (!state.policy.enableExtendedHtml) {
      return disallowed(element, state);
    }
    cleanAttributes(element, tag, html, state);
    return [element];
  }

  if (tag === 'meta') {
    if (!state.policy.enableExtendedHtml) return disallowed(element, state);
    const httpEquiv = element.attrs.find((attribute) => attribute.name.toLowerCase() === 'http-equiv')?.value.trim().toLowerCase() ?? '';
    if (httpEquiv === 'refresh' || httpEquiv === 'content-security-policy' || httpEquiv === 'set-cookie') {
      warn(state, 'local.html.capability', `Author metadata ${httpEquiv} was disabled.`, range.start, range.end, {
        key: 'local.html.capability', params: { feature: 'document metadata' },
      });
      return [];
    }
    cleanAttributes(element, tag, html, state);
    return [element];
  }

  if ((tag === 'title' || tag === 'html' || tag === 'head' || tag === 'body') && !state.policy.enableExtendedHtml && tag === 'title') {
    return disallowed(element, state, inHead);
  }

  const allowed = html
    ? P0_ELEMENTS.has(tag) || WRAPPER_ELEMENTS.has(tag) || state.policy.enableExtendedHtml
    : state.policy.enableExtendedHtml;
  if (!allowed) return disallowed(element, state, inHead);

  cleanAttributes(element, tag, html, state);

  if (tag === 'template') {
    const content = defaultTreeAdapter.getTemplateContent(element as DefaultTreeAdapterTypes.Template);
    cleanParent(content, state, false);
    return [element];
  }

  cleanParent(element, state, inHead);
  return [element];
}

function disallowed(element: PElement, state: SanitizeState, inHead = false): PChild[] {
  const tag = element.tagName.toLowerCase();
  const range = elementRange(element, state);
  warn(state, 'local.html.extended', `HTML element <${tag}> requires enableExtendedHtml in this mode; it is shown as source.`, range.start, range.end, {
    key: 'local.html.extended', params: { name: tag },
  });
  // Head metadata cannot display; append escaped source to the body instead.
  if (inHead) {
    state.bodyFallbacks.push(fallbackSource(element, state));
    return [];
  }
  return [makeText(fallbackSource(element, state))];
}

function cleanParent(parent: PParent, state: SanitizeState, inHead: boolean): void {
  const next: PChild[] = [];
  for (const child of parent.childNodes) {
    if (defaultTreeAdapter.isTextNode(child)) {
      countNode(state, 0, 0);
      next.push(child);
      continue;
    }
    if (defaultTreeAdapter.isCommentNode(child)) {
      countNode(state, 0, 0);
      next.push(child);
      continue;
    }
    if (defaultTreeAdapter.isDocumentTypeNode(child)) continue;
    if (defaultTreeAdapter.isElementNode(child)) {
      const childTag = child.tagName.toLowerCase();
      const childHead = inHead || childTag === 'head';
      next.push(...cleanElement(child, state, childHead));
      continue;
    }
  }
  parent.childNodes = next;
}

/**
 * Parse, sanitize and serialize a whole native HTML document. The result is a
 * complete document string suitable for a sandboxed `srcdoc` iframe.
 */
export function sanitizeLocalHtmlDocument(source: string, policy: LocalHtmlPolicy, maxSyntaxNodes: number): LocalHtmlSanitizeResult {
  const diagnostics: Diagnostic[] = [];
  const state: SanitizeState = {
    policy,
    source,
    lines: { starts: lineStarts(source) },
    diagnostics,
    maxNodes: maxSyntaxNodes,
    depth: 0,
    budget: { nodes: 0 },
    bodyFallbacks: [],
    stopped: false,
  };

  let document: DefaultTreeAdapterTypes.Document;
  try {
    document = parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true });
  } catch (error) {
    return {
      markup: shell(state, defaultTreeAdapter.createDocument()),
      diagnostics: [{
        code: 'local.parse',
        message: `Cannot parse the HTML document: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        range: { start: 0, end: 0 },
        line: 1,
        column: 1,
        messageKey: 'local.parse.document',
        params: { detail: error instanceof Error ? error.message : String(error) },
      }],
    };
  }

  try {
    const html = findChildElement(document, 'html');
    if (html) {
      cleanAttributes(html, 'html', true, state);
      cleanParent(html, state, false);
    } else {
      cleanParent(document, state, false);
    }
  } catch (error) {
    if (error instanceof HtmlBudgetError) {
      const place = position(state, error.start, error.end);
      return {
        markup: '',
        diagnostics: [{
          code: 'local.budget',
          message: error.message,
          severity: 'error',
          range: { start: place.start, end: place.end },
          line: place.line,
          column: place.column,
          messageKey: 'local.budget.nodes',
          params: { limit: error.limit },
        }],
      };
    }
    return {
      markup: '',
      diagnostics: [{
        code: 'local.parse',
        message: `Cannot parse the HTML document: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        range: { start: 0, end: 0 },
        line: 1,
        column: 1,
        messageKey: 'local.parse.document',
        params: { detail: error instanceof Error ? error.message : String(error) },
      }],
    };
  }

  return { markup: shell(state, document), diagnostics };
}

export const LOCAL_HTML_P0_ELEMENTS = P0_ELEMENTS;
export const LOCAL_HTML_VOID_ELEMENTS = VOID_ELEMENTS;
