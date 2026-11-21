import { defaultTreeAdapter, parse, parseFragment, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { localDiagnosticDetails } from '../configuration/diagnostics';
import { MAX_LOCAL_DIAGNOSTICS } from '../configuration/limits';
import type { Diagnostic, LocalHtmlPolicy } from '../types';
import { LOCAL_HTML_ALIGN_ELEMENTS, LOCAL_HTML_ANCHOR_ATTRIBUTES, localHtmlAlign, localHtmlLinkRel } from './html-names';
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
  a: LOCAL_HTML_ANCHOR_ATTRIBUTES,
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
/** Host frame grants accepted for one mount; extra entries are ignored. */
const MAX_FRAME_ORIGINS = 32;
/** Nested element levels accepted in one extended HTML fragment. */
const MAX_FRAGMENT_DEPTH = 64;

export interface LocalHtmlSanitizeResult {
  markup: string;
  diagnostics: Diagnostic[];
}

/** Fragment result: `markup` is absent when the fragment is not renderable. */
export interface LocalHtmlFragmentResult {
  markup?: string;
  /** Cleaned content that can be inserted without relying on frame isolation. */
  inlineSafe?: boolean;
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
  /**
   * True for a body-context fragment: there is no document shell, so an
   * element that cannot be rendered is replaced in place rather than collected
   * into the document body fallback list.
   */
  readonly fragment?: boolean;
  /**
   * Exact HTTPS origins a fragment may frame. `undefined` keeps the legacy
   * whole-document behavior (no attribute filtering, permissive CSP list);
   * an empty set denies every remote frame.
   */
  readonly frameOrigins?: ReadonlySet<string>;
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

/**
 * Resources stay offline; extended HTML permits explicit HTTP(S) form
 * submissions. Passing `frameOrigins` restricts `frame-src` to those exact
 * HTTPS origins (an empty list keeps only `about:`). `fragment` selects the
 * stricter fragment scope, which also disables the document base and form
 * submission; omitting both arguments keeps the legacy whole-document policy.
 */
export function localHtmlContentSecurityPolicy(
  policy: LocalHtmlPolicy,
  frameOrigins?: readonly string[],
  fragment = false,
): string {
  const extended = policy.enableExtendedHtml;
  const frameSources = frameOrigins !== undefined
    ? ['about:', ...normalizedFrameOrigins(frameOrigins)]
    : extended ? ['about:', 'data:', 'blob:'] : [];
  const baseUri = fragment ? "base-uri 'none'" : extended ? "base-uri 'self' http: https:" : "base-uri 'none'";
  const formAction = fragment ? "form-action 'none'" : extended ? 'form-action http: https:' : "form-action 'none'";
  const directives = [
    "default-src 'none'",
    baseUri,
    formAction,
    "object-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "font-src data:",
    "img-src data:",
    policy.enableCss ? "style-src 'unsafe-inline'" : "style-src 'none'",
    policy.enableJavaScript ? "script-src 'unsafe-inline'" : "script-src 'none'",
    frameSources.length === 0 ? "frame-src 'none'" : `frame-src ${frameSources.join(' ')}`,
  ];
  return directives.join('; ');
}

/**
 * Normalize one host frame grant to an exact HTTPS origin. Anything with a
 * path, query, fragment, user info, wildcard, non-HTTPS scheme or an invalid
 * port is rejected rather than reinterpreted.
 */
export function normalizeLocalFrameOrigin(value: string): string | null {
  if (typeof value !== 'string') return null;
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::([0-9]{1,5}))?\/?$/i.exec(value.trim());
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = match[1].toLowerCase();
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

function normalizedFrameOrigins(allowed: readonly string[]): string[] {
  const origins: string[] = [];
  if (!Array.isArray(allowed)) return origins;
  for (const entry of allowed.slice(0, MAX_FRAME_ORIGINS)) {
    const origin = normalizeLocalFrameOrigin(entry);
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/** Host grants for one mount; an empty list denies every remote frame. */
export function localHtmlFrameOrigins(allowedFrameOrigins?: readonly string[]): ReadonlySet<string> {
  return new Set(normalizedFrameOrigins(allowedFrameOrigins ?? []));
}

/** A remote frame source is accepted only when its exact origin was granted. */
function frameSourceAllowed(value: string, origins: ReadonlySet<string>): boolean {
  const trimmed = value.trim();
  if (/^about:blank$/i.test(trimmed)) return true;
  // Empty and relative sources resolve against the fragment document itself;
  // they are neither a granted remote origin nor a bounded inline document.
  if (trimmed === '') return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Credentials and non-default ports are not part of a host grant.
  if (url.username !== '' || url.password !== '') return false;
  const origin = normalizeLocalFrameOrigin(url.origin);
  return origin !== null && origins.has(origin);
}

/** Decoded `data:text/html` payloads are re-parsed as inline fragments. */
const MAX_HTML_DATA_FRAME_LENGTH = 64 * 1024;

/**
 * Decode a `data:` frame source for inline re-parsing.
 *
 * Returns `undefined` when the value is not a `data:` URL, `null` when it is a
 * `data:` URL that cannot be bounded and decoded (wrong media type, malformed
 * base64, or over budget), and the decoded HTML otherwise. A `blob:` source is
 * never decoded: it has no host registration channel in a fragment mount.
 */
function fragmentDataDocument(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!/^data:/i.test(trimmed)) return undefined;
  if (trimmed.length > MAX_HTML_DATA_FRAME_LENGTH) return null;
  const comma = trimmed.indexOf(',');
  if (comma < 0) return null;
  const meta = trimmed.slice(5, comma).toLowerCase();
  const body = trimmed.slice(comma + 1);
  const base64 = meta.endsWith(';base64');
  const media = (base64 ? meta.slice(0, -7) : meta).split(';')[0].trim();
  // Only an explicit HTML media type is rewritten as markup; anything else
  // keeps the browser's own (inert, CSP-restricted) handling.
  if (media !== 'text/html' && media !== 'application/xhtml+xml') return null;
  let decoded: string;
  try {
    if (base64) {
      const binary = atob(body.replace(/\s+/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      decoded = new TextDecoder().decode(bytes);
    } else {
      decoded = decodeURIComponent(body);
    }
  } catch {
    return null;
  }
  return decoded.length > MAX_HTML_DATA_FRAME_LENGTH ? null : decoded;
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
  const csp = escapeAttribute(localHtmlContentSecurityPolicy(
    state.policy,
    state.frameOrigins ? [...state.frameOrigins] : undefined,
    state.fragment,
  ));
  const attributes = (element: PElement | null) => (element?.attrs ?? [])
    .map(attribute => ` ${attribute.prefix ? `${attribute.prefix}:` : ''}${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
  return `<!doctype html><html${attributes(html)}><head${attributes(head)}><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${headExtra}</head><body${attributes(body)}>${bodyMarkup}</body></html>`;
}

/** Construct escaped source without invoking the parser or serializer again. */
function literalHtmlDocument(state: SanitizeState): string {
  const literal = state.source.replace(/\u0000/g, '�').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const csp = escapeAttribute(localHtmlContentSecurityPolicy(
    state.policy,
    state.frameOrigins ? [...state.frameOrigins] : undefined,
    state.fragment,
  ));
  // HTML consumes one LF immediately after <pre>; supply our own LF so every
  // newline in the original source survives reparsing.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><pre data-local-html-fallback="document">\n${literal}</pre></body></html>`;
}

function sanitizeSrcdoc(value: string, state: SanitizeState, range: {start: number; end: number}): string {
  if (state.depth >= MAX_HTML_SRCDOC_DEPTH) return '';
  const diagnosticStart = state.diagnostics.length;
  const fallback = () => {
    markLiteralDiagnostics(state, diagnosticStart);
    warn(state, 'local.html.fallback', 'Native HTML was safely converted to inert source text.', range.start, range.end);
    return literalHtmlDocument({...state, source: value});
  };
  let document: DefaultTreeAdapterTypes.Document;
  try {
    document = parse(value, { scriptingEnabled: false, sourceCodeLocationInfo: true });
  } catch {
    return fallback();
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
      const diagnosticStart = state.diagnostics.length;
      if (!cleanAttributes(html, 'html', true, nested)) {
        markLiteralDiagnostics(nested, diagnosticStart);
        return literalHtmlDocument(nested);
      }
      cleanParent(html, nested, false);
    }
    return shell(nested, document);
  } catch (error) {
    if (error instanceof HtmlBudgetError) throw error;
    return fallback();
  }
}

function cleanAttributes(element: PElement, tag: string, html: boolean, state: SanitizeState): boolean {
  const location = element.sourceCodeLocation;
  const kept: PAttribute[] = [];
  let sandboxed = false;
  let supported = true;
  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase();
    const fullName = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
    const range = attributeRange(element, attribute, state);

    if (html && HTML_TABLE_NAMES.has(tag) && !validHtmlTableValue(name, attribute.value)) {
      supported = false;
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
        supported = false;
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
      // A `data:` source already produced the inline document; first wins.
      if (kept.some(item => item.name === 'srcdoc')) continue;
      const sanitized = sanitizeSrcdoc(attribute.value, state, range);
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

    // A fragment mount frames only about:blank, inline documents and granted
    // exact HTTPS origins; author permissions may never widen the sandbox.
    const frameOrigins = state.frameOrigins;
    if (frameOrigins !== undefined && tag === 'iframe') {
      if (name === 'allow' || name === 'allowfullscreen' || name === 'allowpaymentrequest') {
        warn(state, 'local.html.capability', `Author frame permission ${fullName} was disabled.`, range.start, range.end, {
          key: 'local.html.capability', params: { feature: 'frame permission' },
        });
        continue;
      }
      if (name === 'src') {
        const inline = fragmentDataDocument(attribute.value);
        if (inline === null) {
          warn(state, 'local.html.unsafe-url', `Unsafe frame source in attribute ${fullName} was removed.`, range.start, range.end, {
            key: 'local.html.unsafe-url', params: { name: fullName },
          });
          continue;
        }
        if (inline !== undefined) {
          // Inline `data:` HTML is re-parsed and sanitized, then carried as
          // `srcdoc` so it inherits the container's sandbox and CSP.
          if (kept.some(item => item.name === 'srcdoc')) continue;
          const sanitized = sanitizeSrcdoc(inline, state, range);
          if (sanitized === '') continue;
          kept.push({ name: 'srcdoc', value: sanitized });
          continue;
        }
        if (!frameSourceAllowed(attribute.value, frameOrigins)) {
          warn(state, 'local.html.unsafe-url', `Remote frame source ${fullName} is not an allowed origin.`, range.start, range.end, {
            key: 'local.html.unsafe-url', params: { name: fullName },
          });
          continue;
        }
        // Validated against the grant list; the generic URL check below would
        // reject the granted about:blank form.
        kept.push(attribute);
        continue;
      }
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
      supported = false;
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
  if (tag === 'a') {
    const target = kept.find(attribute => attribute.name.toLowerCase() === 'target')?.value;
    const relAttribute = kept.find(attribute => attribute.name.toLowerCase() === 'rel');
    const rel = localHtmlLinkRel(relAttribute?.value, target);
    if (rel !== undefined) {
      if (relAttribute) relAttribute.value = rel;
      else kept.push({name: 'rel', value: rel});
    }
  }
  element.attrs = kept;
  void location;
  return supported;
}

function cleanElement(element: PElement, state: SanitizeState, inHead: boolean): PChild[] {
  const diagnosticStart = state.diagnostics.length;
  const range = elementRange(element, state);
  countNode(state, range.start, range.end);
  const tag = element.tagName.toLowerCase();
  const html = element.namespaceURI === HTML_NS;

  if (ALWAYS_DENIED.has(tag)) {
    if (state.fragment) {
      // Fragments have no document body to collect fallbacks into; replace the
      // element in place so authored order survives.
      warn(state, 'local.html.fallback', `HTML element <${tag}> cannot be rendered in an extended fragment; it is shown as source.`, range.start, range.end, {
        key: 'html.fallback',
      });
      return literalElement(element, state, inHead, diagnosticStart);
    }
    state.bodyFallbacks.push(fallbackSource(element, state));
    warn(state, 'local.html.fallback', `HTML element <${tag}> requires enableExtendedHtml in this mode; it is shown as source.`, range.start, range.end, {
      key: 'local.html.extended', params: { name: tag },
    });
    return [];
  }
  // A fragment cannot own a document base; the container policy already fixes
  // URL resolution to the sandbox document.
  if (state.fragment && tag === 'base') {
    warn(state, 'local.html.capability', 'Author HTML base was disabled in an extended fragment.', range.start, range.end, {
      key: 'local.html.capability', params: { feature: 'document base' },
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
    if (!cleanAttributes(element, tag, html, state)) return literalElement(element, state, inHead, diagnosticStart);
    return [element];
  }

  if (tag === 'style') {
    if (!state.policy.enableCss) {
      warn(state, 'local.html.capability', 'Author CSS was disabled by the compile options.', range.start, range.end, {
        key: 'local.html.capability', params: { feature: 'CSS' },
      });
      return [];
    }
    if (!cleanAttributes(element, tag, html, state)) return literalElement(element, state, inHead, diagnosticStart);
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
      if (!cleanAttributes(element, tag, html, state)) return literalElement(element, state, inHead, diagnosticStart);
      return [element];
    }
    if (!state.policy.enableExtendedHtml) {
      return disallowed(element, state);
    }
    if (!cleanAttributes(element, tag, html, state)) return literalElement(element, state, inHead, diagnosticStart);
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
    if (!cleanAttributes(element, tag, html, state)) return literalElement(element, state, inHead, diagnosticStart);
    return [element];
  }

  if ((tag === 'title' || tag === 'html' || tag === 'head' || tag === 'body') && !state.policy.enableExtendedHtml && tag === 'title') {
    return disallowed(element, state, inHead);
  }

  const allowed = html
    ? P0_ELEMENTS.has(tag) || WRAPPER_ELEMENTS.has(tag) || state.policy.enableExtendedHtml
    : state.policy.enableExtendedHtml;
  if (!allowed) return disallowed(element, state, inHead);

  if (!cleanAttributes(element, tag, html, state)) return literalElement(element, state, inHead, diagnosticStart);

  if (tag === 'template') {
    const content = defaultTreeAdapter.getTemplateContent(element as DefaultTreeAdapterTypes.Template);
    cleanParent(content, state, false);
    return [element];
  }

  cleanParent(element, state, inHead);
  return [element];
}

function disallowed(element: PElement, state: SanitizeState, inHead = false): PChild[] {
  const diagnosticStart = state.diagnostics.length;
  const tag = element.tagName.toLowerCase();
  const range = elementRange(element, state);
  warn(state, 'local.html.extended', `HTML element <${tag}> requires enableExtendedHtml in this mode; it is shown as source.`, range.start, range.end, {
    key: 'local.html.extended', params: { name: tag },
  });
  return literalElement(element, state, inHead, diagnosticStart);
}

function literalElement(element: PElement, state: SanitizeState, inHead: boolean, diagnosticStart: number): PChild[] {
  markLiteralDiagnostics(state, diagnosticStart);
  // Head metadata cannot display; append escaped source to the body instead.
  if (inHead) {
    state.bodyFallbacks.push(fallbackSource(element, state));
    return [];
  }
  return [makeText(fallbackSource(element, state))];
}

/** Classify only diagnostics for an element actually replaced by source text. */
function markLiteralDiagnostics(state: SanitizeState, diagnosticStart: number): void {
  for (const diagnostic of state.diagnostics.slice(diagnosticStart)) {
    if (diagnostic.severity === 'warning') {
      diagnostic.code = 'local.html.fallback';
    }
  }
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
 *
 * Host frame grants are optional; omitting them keeps the legacy behavior where
 * `frame-src` accepts `about:`, `data:` and `blob:`. Passing a list (including
 * an empty one) restricts frames to those exact HTTPS origins.
 */
export function sanitizeLocalHtmlDocument(
  source: string,
  policy: LocalHtmlPolicy,
  maxSyntaxNodes: number,
  allowedFrameOrigins?: readonly string[],
): LocalHtmlSanitizeResult {
  const diagnostics: Diagnostic[] = [];
  const state: SanitizeState = {
    policy,
    source,
    lines: { starts: lineStarts(source) },
    diagnostics,
    maxNodes: maxSyntaxNodes,
    depth: 0,
    // Passing origin grants restricts framing without changing the document
    // structure rules; the legacy call keeps the old semantics byte-for-byte.
    ...(allowedFrameOrigins === undefined ? {} : { frameOrigins: localHtmlFrameOrigins(allowedFrameOrigins) }),
    budget: { nodes: 0 },
    bodyFallbacks: [],
    stopped: false,
  };

  let document: DefaultTreeAdapterTypes.Document;
  try {
    document = parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: true });
  } catch (error) {
    return {
      markup: literalHtmlDocument(state),
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
      const diagnosticStart = state.diagnostics.length;
      if (!cleanAttributes(html, 'html', true, state)) {
        markLiteralDiagnostics(state, diagnosticStart);
        return {markup: literalHtmlDocument(state), diagnostics};
      }
      cleanParent(html, state, false);
    } else {
      cleanParent(document, state, false);
    }
    return {markup: shell(state, document), diagnostics};
  } catch (error) {
    if (error instanceof HtmlBudgetError) {
      const place = position(state, error.start, error.end);
      return {
        markup: literalHtmlDocument(state),
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
      markup: literalHtmlDocument(state),
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

}

export const LOCAL_HTML_P0_ELEMENTS = P0_ELEMENTS;
export const LOCAL_HTML_VOID_ELEMENTS = VOID_ELEMENTS;

const DIRECT_FRAGMENT_ELEMENTS = new Set([...P0_ELEMENTS, 'dl', 'dt', 'dd', 'section', 'figure', 'figcaption']);
const DIRECT_FRAGMENT_ATTRIBUTES = new Set(['class', 'title', 'lang', 'dir', 'role', 'alt', 'open', 'start', 'rowspan', 'colspan', 'scope']);

function fragmentCanRenderDirectly(fragment: PParent): boolean {
  const stack = [...fragment.childNodes];
  while (stack.length) {
    const child = stack.pop()!;
    if (defaultTreeAdapter.isTextNode(child) || defaultTreeAdapter.isCommentNode(child)) continue;
    // The direct path permits only inert HTML. URL and CSS attributes,
    // event handlers, foreign content and embedded browsing contexts depend
    // on the isolated container's additional restrictions.
    if (!defaultTreeAdapter.isElementNode(child) || child.namespaceURI !== HTML_NS
      || !DIRECT_FRAGMENT_ELEMENTS.has(child.tagName)
      || child.attrs.some(attr => attr.namespace || (!DIRECT_FRAGMENT_ATTRIBUTES.has(attr.name) && !/^aria-[a-z-]+$/.test(attr.name)))) return false;
    for (const nested of child.childNodes) stack.push(nested);
  }
  return true;
}

/** Iterative depth check; `template` content is a separate nesting branch. */
function fragmentDepthExceeded(fragment: DefaultTreeAdapterTypes.DocumentFragment, limit: number): boolean {
  const stack: Array<{ node: PParent; depth: number }> = [{ node: fragment, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    for (const child of node.childNodes) {
      if (!defaultTreeAdapter.isElementNode(child)) continue;
      if (depth + 1 > limit) return true;
      const next = child.tagName.toLowerCase() === 'template'
        ? defaultTreeAdapter.getTemplateContent(child as DefaultTreeAdapterTypes.Template)
        : child;
      stack.push({ node: next, depth: depth + 1 });
    }
  }
  return false;
}

/**
 * Parse, sanitize and serialize one extended HTML fragment. Unlike
 * `sanitizeLocalHtmlDocument` there is no document shell: the result is body
 * markup for an isolated container, and element offsets stay relative to the
 * fragment source. Every allow-list, attribute, URL, script, style and node
 * budget rule is shared with the whole-document pass.
 *
 * `markup` is absent only when the fragment cannot be rendered at all
 * (unparsable source or an exhausted node budget).
 */
export function sanitizeLocalHtmlFragment(
  source: string,
  policy: LocalHtmlPolicy,
  maxSyntaxNodes: number,
  allowedFrameOrigins?: readonly string[],
): LocalHtmlFragmentResult {
  const diagnostics: Diagnostic[] = [];
  if (typeof source !== 'string' || source.trim() === '') return { markup: '', diagnostics };
  const state: SanitizeState = {
    policy,
    source,
    lines: { starts: lineStarts(source) },
    diagnostics,
    maxNodes: maxSyntaxNodes,
    depth: 0,
    fragment: true,
    // A mount-time fragment denies every remote frame unless the host grants an
    // origin. Omitting the list (compile-time structural pass) leaves frame
    // policy to the mount, which re-sanitizes with its actual grants.
    ...(allowedFrameOrigins === undefined ? {} : { frameOrigins: localHtmlFrameOrigins(allowedFrameOrigins) }),
    budget: { nodes: 0 },
    bodyFallbacks: [],
    stopped: false,
  };

  let fragment: DefaultTreeAdapterTypes.DocumentFragment;
  try {
    fragment = parseFragment(source, { scriptingEnabled: false, sourceCodeLocationInfo: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn(state, 'local.parse', `Cannot parse the HTML fragment: ${detail}`, 0, 0, {
      key: 'local.parse.document', params: { detail },
    });
    return { diagnostics };
  }

  // The cleaners recurse; bound nesting before traversal so a hostile fragment
  // cannot exhaust the stack, and report it through the shared node budget.
  if (fragmentDepthExceeded(fragment, MAX_FRAGMENT_DEPTH)) {
    return {
      diagnostics: [{
        code: 'local.budget',
        message: `HTML fragment exceeds ${MAX_FRAGMENT_DEPTH} nested element levels.`,
        severity: 'error',
        range: { start: 0, end: source.length },
        line: 1,
        column: 1,
        messageKey: 'local.budget.nodes',
        params: { limit: MAX_FRAGMENT_DEPTH },
      }],
    };
  }

  try {
    cleanParent(fragment, state, false);
    const fallbackMarkup = state.bodyFallbacks
      .map((value) => serializeOuter(makeText(value), { scriptingEnabled: false }))
      .join('');
    return { markup: fallbackMarkup + serializeChildren(fragment), inlineSafe: fragmentCanRenderDirectly(fragment), diagnostics };
  } catch (error) {
    if (error instanceof HtmlBudgetError) {
      const place = position(state, error.start, error.end);
      return {
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
    return { diagnostics };
  }
}
