import { defaultTreeAdapter, parseFragment, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { localHtmlSandbox, sanitizeLocalHtmlDocument } from './local/html';
import { readLocalCompileOptions } from './local/options';
import { portableCompileOptions } from './local/portable-options';
import type { LocalExtensionRequirements } from './sdk/types';
import { validateLocalExtensionRequirements } from './export/requirements';
import {
  localSourceDigest,
  resolveLocalState,
  type LocalStateFile,
  type LocalStateGenerator,
} from './local/state';
import type { Diagnostic, LocalCompileOptions, LocalDocument, LocalHtmlPolicy, LocalValue } from './local/types';

/** Version of the single-file HTML envelope, not of the document syntax. */
export const SHAREABLE_HTML_FORMAT = 'reactive-md-html/v1' as const;

export type ShareableHtmlMode = 'interactive' | 'static';
export type ShareableAssetMode = 'inline' | 'omit';

export interface ShareableMountPayload {
  version: 1;
  target: string;
  source: string;
  state: LocalStateFile;
  locale: 'en' | 'zh';
  colorScheme: 'light' | 'dark' | 'auto';
  hydrate: boolean;
  /** Capability flags and limits the document was compiled with. */
  compileOptions?: LocalCompileOptions;
  /** Installed component contracts required before applying saved state. */
  extensions?: LocalExtensionRequirements;
  /** Verified relative image URL -> inline raster data URL. */
  images?: Readonly<Record<string, string>>;
}

export interface ShareableHtmlOptions {
  /** Plain text title; it is escaped by this function. */
  title: string;
  source: string;
  state: LocalStateFile;
  /** Already rendered by the trusted React renderer in static mode. */
  staticMarkup: string;
  /** Trusted host stylesheet, normally the built reactive-md.css. */
  css: string;
  mode: ShareableHtmlMode;
  /** Required for interactive output; the standalone IIFE source. */
  runtimeScript?: string;
  locale?: 'en' | 'zh';
  colorScheme?: 'light' | 'dark' | 'auto';
  generator?: LocalStateGenerator;
  assets?: ShareableAssetMode;
  /** Diagnostics shown in authoring tools; the HTML only records the count. */
  imageCount?: number;
  /** Verified relative image URLs and their inline raster data URLs. */
  images?: Readonly<Record<string, string>>;
  notices?: string;
  targetId?: string;
  /**
   * Routing capabilities granted by the host and used to compile this exact
   * document. Interactive exports replay them; static native exports are
   * re-sanitized with author JavaScript forced off.
   */
  compileOptions?: LocalCompileOptions;
  /** Companion component requirements, separate from the v1 state format. */
  extensions?: LocalExtensionRequirements;
}

export interface LocalStateBaselineResult {
  document: LocalDocument;
  state: Readonly<Record<string, LocalValue>>;
}

export type LocalStateBaselineOutcome =
  | { ok: true; baseline: LocalStateBaselineResult }
  | { ok: false; diagnostics: Diagnostic[] };

const TARGET_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const LANG_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const CONTROL_TEXT = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_EMBEDDED_IMAGES = 64;
// Base64 plus per-entry prefixes must still fit the CLI's 24 MiB raw budget.
const MAX_EMBEDDED_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_KEY_LENGTH = 4096;

function escapeHtml(value: string, attribute = false): string {
  let escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  if (attribute) {
    escaped = escaped.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  return escaped;
}

function escapeStyle(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

function escapeScript(script: string): string {
  return script
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
}

function escapeMeta(value: string): string {
  return escapeHtml(value, true);
}

/** Escape JSON so it cannot terminate its script element or form HTML text. */
export function serializeForScript(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new TypeError('Cannot serialize a non-JSON value for an inline script.');
  return json.replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      default:
        return '\\u2029';
    }
  });
}

function cloneValue(value: LocalValue): LocalValue {
  return Array.isArray(value) ? value.slice() : value;
}

/**
 * Validate host compile options and emit only the values that affect routing
 * and budgets. Unknown or inherited keys never reach the exported payload.
 */
function normalizeCompileOptions(input: LocalCompileOptions | undefined): LocalCompileOptions | undefined {
  try { return portableCompileOptions(input); }
  catch (error) {
    throw new TypeError(`createShareableHtml received invalid compileOptions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Remove author/host scripts from the trusted static wrapper markup. */
function stripScriptElements(parent: DefaultTreeAdapterTypes.ParentNode): void {
  const next: DefaultTreeAdapterTypes.ChildNode[] = [];
  for (const child of parent.childNodes) {
    if (defaultTreeAdapter.isElementNode(child)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'script') continue;
      if (tag === 'template') {
        stripScriptElements(defaultTreeAdapter.getTemplateContent(child as DefaultTreeAdapterTypes.Template));
      } else {
        stripScriptElements(child);
      }
    }
    next.push(child);
  }
  parent.childNodes = next;
}

/** Point every wrapper iframe at the re-sanitized static document. */
function rewriteFrameSrcdoc(
  parent: DefaultTreeAdapterTypes.ParentNode,
  srcdoc: string,
  sandbox: string,
): boolean {
  let found = false;
  for (const child of parent.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    if (child.tagName.toLowerCase() === 'iframe') {
      const attrs = child.attrs.filter((attribute) => {
        const name = attribute.name.toLowerCase();
        return name !== 'srcdoc' && name !== 'sandbox';
      });
      attrs.push({ name: 'srcdoc', value: srcdoc });
      attrs.push({ name: 'sandbox', value: sandbox });
      child.attrs = attrs;
      found = true;
    }
    if (rewriteFrameSrcdoc(child, srcdoc, sandbox)) found = true;
  }
  return found;
}

function serializeFragment(fragment: DefaultTreeAdapterTypes.DocumentFragment): string {
  let output = '';
  for (const child of fragment.childNodes) output += serializeOuter(child, { scriptingEnabled: false });
  return output;
}

/**
 * Rebuild the native static wrapper around a document sanitized with author
 * JavaScript disabled. A caller-supplied `staticMarkup` may have been rendered
 * with scripts enabled, so its iframe bodies (and any scripts) are replaced
 * instead of trusted. The generated iframe never gains same-origin or script
 * capabilities in static mode.
 */
function nativeStaticExportMarkup(
  staticMarkup: string,
  documentMarkup: string,
  sandbox: string,
): string {
  try {
    const fragment = parseFragment(staticMarkup, { scriptingEnabled: false });
    stripScriptElements(fragment);
    if (rewriteFrameSrcdoc(fragment, documentMarkup, sandbox)) return serializeFragment(fragment);
  } catch {
    /* Fall through to the generated wrapper. */
  }
  return `<div class="reactive-md-native-document"><iframe class="reactive-md-native-frame" title="Reactive MD document" sandbox="${escapeHtml(sandbox, true)}" style="display:block;width:100%;min-height:60vh;border:0;background:#fff" srcdoc="${escapeHtml(documentMarkup, true)}"></iframe></div>`;
}

/** Outer envelope CSP; a native export needs to own exactly one srcdoc frame. */
function envelopePolicy(interactive: boolean, nativePolicy?: LocalHtmlPolicy): string {
  const extended = nativePolicy?.enableExtendedHtml === true;
  // The enclosing policy is inherited by srcdoc. Keep its grants compatible
  // with the inner document, which applies the precise author capabilities.
  const frame = nativePolicy
    ? `frame-src about:${extended ? ' data: blob: http: https:' : ''}`
    : "frame-src 'none'";
  const base = extended ? "base-uri 'self' http: https:" : "base-uri 'none'";
  const form = extended ? 'form-action http: https:' : "form-action 'none'";
  return interactive
    ? `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; ${frame}; ${base}; ${form}`
    : `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; ${frame}; ${base}; ${form}`;
}

function embeddedImages(images: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined {
  if (images === undefined) return undefined;
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    throw new TypeError('images must be an object mapping relative URLs to data: image URLs.');
  }
  const entries = Object.entries(images);
  if (entries.length > MAX_EMBEDDED_IMAGES) {
    throw new RangeError(`images cannot contain more than ${MAX_EMBEDDED_IMAGES} entries.`);
  }
  let total = 0;
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_IMAGE_KEY_LENGTH || CONTROL_TEXT.test(key) || key === '__proto__') {
      throw new TypeError('Every image key must be a bounded, control-free URL.');
    }
    if (typeof value !== 'string' || !DATA_IMAGE.test(value)) {
      throw new TypeError(`The image map for "${key}" must contain a base64 PNG, JPEG, GIF or WebP data URL.`);
    }
    total += value.length;
    if (total > MAX_EMBEDDED_IMAGE_BYTES) {
      throw new RangeError('The embedded image map exceeds the 40 MiB budget.');
    }
  }
  return Object.fromEntries(entries);
}

/**
 * Rebase public binding defaults onto a validated exported state. The exported
 * document then has one baseline for first render, refresh and Reset instead of
 * silently resetting a shared export to values the author did not select.
 */
export function resolveLocalStateBaseline(
  document: LocalDocument,
  state: LocalStateFile,
): LocalStateBaselineOutcome {
  const resolved = resolveLocalState(document, state);
  if (!resolved.ok) return resolved;

  const bindings: LocalDocument['bindings'] = {};
  for (const [key, binding] of Object.entries(document.bindings)) {
    bindings[key] = Object.hasOwn(resolved.state, key)
      ? { ...binding, initial: cloneValue(resolved.state[key]) }
      : binding;
  }
  const initialState: Record<string, LocalValue> = { ...document.initialState };
  for (const [key, value] of Object.entries(resolved.state)) {
    initialState[key] = cloneValue(value);
  }

  return {
    ok: true,
    baseline: {
      document: { ...document, bindings, initialState },
      state: resolved.state,
    },
  };
}

const EXPORT_SHELL_CSS = `
:root { color-scheme: light; background: #f5f7fb; }
html, body { margin: 0; }
body.reactive-md-export {
  min-height: 100vh;
  padding: clamp(16px, 4vw, 48px);
  background: #f5f7fb;
  color: #17233d;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.reactive-md-export-root { max-width: 840px; margin: 0 auto; }
@media print {
  :root, html, body.reactive-md-export { background: #fff !important; }
  body.reactive-md-export { min-height: 0; padding: 0 !important; }
  .reactive-md-export-root { max-width: none !important; margin: 0 !important; }
}
`;

/**
 * Build the deterministic single-file HTML envelope. Caller-provided markup and
 * runtime code are trusted build artifacts; all metadata and JSON are escaped.
 */
export function createShareableHtml(options: ShareableHtmlOptions): string {
  const targetId = options.targetId ?? 'reactive-md-document';
  if (!TARGET_ID.test(targetId)) {
    throw new TypeError('targetId must start with a letter and contain only letters, digits, underscores or hyphens.');
  }
  const mode: ShareableHtmlMode = options.mode === 'static' ? 'static' : 'interactive';
  if (!options.staticMarkup.trim()) {
    throw new TypeError('createShareableHtml requires rendered document markup.');
  }
  if (!options.css.trim()) {
    throw new TypeError('createShareableHtml requires the document stylesheet.');
  }
  if (options.state.sourceDigest !== localSourceDigest(options.source)) {
    throw new Error('The state file does not belong to the exported source.');
  }
  if (mode === 'interactive' && !options.runtimeScript?.trim()) {
    throw new TypeError('Interactive HTML requires the standalone runtime script.');
  }

  const compileOptions = normalizeCompileOptions(options.compileOptions);
  const extensionErrors = validateLocalExtensionRequirements(options.extensions, compileOptions?.config);
  if (extensionErrors.length) throw new TypeError(extensionErrors.map(item => item.message).join(' '));
  const optionCheck = readLocalCompileOptions(compileOptions);
  if (!optionCheck.ok) {
    // normalizeCompileOptions already validated the same payload.
    throw new TypeError(`createShareableHtml received invalid compileOptions: ${optionCheck.message}`);
  }
  const native = optionCheck.htmlActive;

  let staticMarkup = options.staticMarkup;
  if (native && (mode === 'static' || !optionCheck.html.enableJavaScript)) {
    // Static native exports keep the native route but never run author code.
    // Regenerate the frame from the grammar-sanitized source instead of
    // trusting caller markup that may still contain enabled author scripts.
    // Interactive exports without the JavaScript grant are rebuilt for the
    // same reason before the runtime hydrates over them.
    const staticPolicy: LocalHtmlPolicy = {
      enableCss: optionCheck.html.enableCss,
      enableJavaScript: false,
      enableExtendedHtml: optionCheck.html.enableExtendedHtml,
    };
    const sanitized = sanitizeLocalHtmlDocument(options.source, staticPolicy, optionCheck.maxSyntaxNodes);
    if (!sanitized.markup) {
      throw new Error('The native HTML document could not be regenerated without author JavaScript.');
    }
    staticMarkup = nativeStaticExportMarkup(
      options.staticMarkup,
      sanitized.markup,
      localHtmlSandbox(staticPolicy),
    );
  }

  const locale = options.locale === 'zh' ? 'zh' : 'en';
  const lang = locale === 'zh' ? 'zh-CN' : 'en';
  const colorScheme = options.colorScheme === 'light' || options.colorScheme === 'dark'
    ? options.colorScheme
    : 'auto';
  const assets = options.assets === 'omit' ? 'omit' : 'inline';
  const generator = options.generator ?? { name: 'reactive-md', version: 'unknown' };
  const images = embeddedImages(options.images);
  const imageCount = Number.isSafeInteger(options.imageCount) && (options.imageCount ?? 0) > 0
    ? String(options.imageCount)
    : String(Object.keys(images ?? {}).length);

  const interactive = mode === 'interactive';
  const payload: ShareableMountPayload = {
    version: 1,
    target: targetId,
    source: options.source,
    state: options.state,
    locale,
    colorScheme,
    hydrate: true,
    ...(compileOptions === undefined ? {} : { compileOptions }),
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(images ? { images } : {}),
  };

  const policy = envelopePolicy(interactive, native ? optionCheck.html : undefined);

  const payloadScript = interactive
    ? `<script type="application/reactive-md+json" data-reactive-md-auto>${serializeForScript(payload)}</script>
<script>${escapeScript(options.runtimeScript!)}</script>`
    : '';
  const notices = options.notices?.trim()
    ? `<template id="reactive-md-notices"><pre>${escapeHtml(options.notices)}</pre></template>`
    : '';
  const extensionMetadata = !interactive && options.extensions
    ? `<template id="reactive-md-extensions">${escapeHtml(JSON.stringify(options.extensions))}</template>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(LANG_TAG.test(lang) ? lang : 'en', true)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${escapeMeta(policy)}">
<meta name="generator" content="${escapeMeta(`${generator.name} ${generator.version}`)}">
<meta name="reactive-md-html-format" content="${SHAREABLE_HTML_FORMAT}">
<meta name="reactive-md-syntax" content="${escapeMeta(options.state.syntax)}">
<meta name="reactive-md-output" content="${mode}">
<meta name="reactive-md-state" content="${escapeMeta(options.state.sourceDigest)}">
<meta name="reactive-md-images" content="${assets}">
<meta name="reactive-md-image-count" content="${imageCount}">
<title>${escapeHtml(options.title || 'Reactive MD document')}</title>
<style>${escapeStyle(options.css)}${EXPORT_SHELL_CSS}</style>
</head>
<body class="reactive-md-export">
<div id="${targetId}" class="reactive-md-export-root">${staticMarkup}</div>
${payloadScript}
${extensionMetadata}
${notices}
</body>
</html>
`;
}
