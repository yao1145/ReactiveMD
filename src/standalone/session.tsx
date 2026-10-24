import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import {
  LocalDocumentView,
  type LocalImageResolver,
  type LocalUrlPolicy,
} from '../local/LocalDocumentView';
import type { LocalLocale } from '../local/locale';
import { createLocalRuntime } from '../local/runtime';
import {
  createLocalStateFile,
  type LocalStateFile,
  type LocalStateGenerator,
} from '../local/state';
import type { LocalColorScheme, LocalThemeDefinition } from '../local/theme';
import type { Diagnostic, LocalDocument, LocalRuntime } from '../local/types';
import { diagnosticsFromError, errorText, ReactiveMDMountError, standaloneDiagnostic } from './diagnostics';
import { REACTIVE_MD_DIAGNOSTICS_EVENT } from './events';
import { parseMountPayload } from './payload';
import { prepareStandaloneDocument } from './prepare';
import { REACTIVE_MD_STANDALONE_GENERATOR } from './version';

export interface ReactiveMDMountOptions {
  source: string;
  /** Versioned, shareable state; validated against the compiled source. */
  state?: LocalStateFile | string;
  locale?: LocalLocale;
  colorScheme?: LocalColorScheme;
  themes?: readonly LocalThemeDefinition[];
  urlPolicy?: LocalUrlPolicy;
  imageResolver?: LocalImageResolver;
  /** Verified relative image URL -> inline raster data URL for shareable exports. */
  images?: Readonly<Record<string, string>>;
  /** True when hydrating server-rendered static-first markup. */
  hydrate?: boolean;
  generator?: LocalStateGenerator;
}

export interface ReactiveMDHandle {
  element: HTMLElement;
  getState(): LocalStateFile;
  unmount(): void;
}

/** Internal hooks used by the Web Component; not part of the public mount API. */
export interface StandaloneHostHooks {
  /** Host-only theme override, applied to an immutable document clone. */
  theme?: string;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  onStateChange?: (state: LocalStateFile) => void;
}

export const REACTIVE_MD_MOUNTED_ATTRIBUTE = 'data-reactive-md-mounted';
const AUTO_MOUNT_SELECTOR = 'script[type="application/reactive-md+json"][data-reactive-md-auto]';
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGES = 64;

function imageCallbacks(images: Readonly<Record<string, string>> | undefined): {
  urlPolicy?: LocalUrlPolicy;
  imageResolver?: LocalImageResolver;
} {
  if (!images) return {};
  const verified = new Map<string, string>();
  for (const [url, data] of Object.entries(images).slice(0, MAX_IMAGES)) {
    if (typeof url === 'string' && url.length > 0 && typeof data === 'string' && DATA_IMAGE.test(data)) {
      verified.set(url, data);
    }
  }
  if (verified.size === 0) return {};
  return {
    urlPolicy: (url, kind) => kind === 'link' || verified.has(url),
    imageResolver: (url) => verified.get(url) ?? null,
  };
}

/** Targets mounted by this module; the attribute also covers other bundles/copies. */
const mountedElements = new WeakSet<HTMLElement>();

export function isReactiveMDMounted(element: HTMLElement): boolean {
  return mountedElements.has(element) || element.hasAttribute(REACTIVE_MD_MOUNTED_ATTRIBUTE);
}

function captureState(
  document: LocalDocument,
  runtime: LocalRuntime,
  generator: LocalStateGenerator,
): LocalStateFile {
  return createLocalStateFile(document, runtime.snapshot().state, generator);
}

function safeInvoke(callback: (() => void) | undefined): void {
  if (!callback) return;
  try {
    callback();
  } catch {
    /* Host callbacks never break the runtime. */
  }
}

/**
 * Collect a bounded set of static-first fallback markers after hydration. The
 * coordinator's `staticFirst` effect restores interactive markup; these markers
 * only exist as CSS safety nets, so removing them a frame later cannot change
 * document content or state.
 */
function clearStaticFirstMarkers(element: HTMLElement): () => void {
  const clean = (): void => {
    const article = element.querySelector('article.local-document');
    if (article) {
      article.classList.remove('local-static-first', 'reactive-md-static-first', 'reactive-md-hydrating');
      article.removeAttribute('data-static-first');
      article.removeAttribute('data-reactive-md-static-first');
    }
    element.classList.remove('local-static-first', 'reactive-md-static-first');
    element.removeAttribute('data-static-first');
  };

  if (typeof requestAnimationFrame !== 'function') {
    clean();
    return () => {};
  }

  let first = 0;
  let second = 0;
  first = requestAnimationFrame(() => {
    clean();
    second = requestAnimationFrame(clean);
  });
  return () => {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    }
  };
}

/**
 * Mount a compiled document and wrap the live runtime in a disposable handle.
 * Used by the public API and by `<reactive-md-doc>`, which supplies host hooks.
 */
export function createStandaloneMount(
  element: HTMLElement,
  options: ReactiveMDMountOptions,
  hooks: StandaloneHostHooks = {},
): ReactiveMDHandle {
  if (!element || typeof element !== 'object' || !('nodeType' in element) || !element.hasAttribute) {
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: element must be an HTMLElement.',
      [standaloneDiagnostic('standalone.element', 'element must be an HTMLElement.')],
    );
  }
  if (isReactiveMDMounted(element)) {
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: this element is already mounted.',
      [standaloneDiagnostic('standalone.mount', 'The target element already hosts a Reactive MD document.')],
    );
  }
  if (!options || typeof options !== 'object') {
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: options are required.',
      [standaloneDiagnostic('standalone.options', 'mount requires an options object with a source string.')],
    );
  }

  const prepared = prepareStandaloneDocument(options.source, options.state, hooks.theme);

  let runtime: LocalRuntime;
  try {
    runtime = createLocalRuntime(prepared.document);
  } catch (error) {
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: the interactive runtime could not be created.',
      [standaloneDiagnostic('standalone.runtime', errorText(error))],
    );
  }

  const generator = options.generator ?? REACTIVE_MD_STANDALONE_GENERATOR;
  const embeddedImages = imageCallbacks(options.images);
  const urlPolicy = options.urlPolicy ?? embeddedImages.urlPolicy;
  const imageResolver = options.imageResolver ?? embeddedImages.imageResolver;

  const capture = (): LocalStateFile => captureState(prepared.document, runtime, generator);

  let initialState: LocalStateFile;
  try {
    initialState = capture();
  } catch (error) {
    try {
      runtime.dispose();
    } catch {
      /* best effort */
    }
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: the initial state could not be captured.',
      [standaloneDiagnostic('standalone.state', errorText(error))],
    );
  }

  let disposed = false;
  const handleDiagnostics = (diagnostics: Diagnostic[]): void => {
    if (disposed) return;
    safeInvoke(hooks.onDiagnostics ? () => hooks.onDiagnostics!(diagnostics) : undefined);
  };

  const hydrating = options.hydrate === true && element.hasChildNodes();
  const view = (
    <LocalDocumentView
      document={prepared.document}
      runtime={runtime}
      onDiagnostics={handleDiagnostics}
      urlPolicy={urlPolicy}
      locale={options.locale ?? 'en'}
      themes={options.themes}
      colorScheme={options.colorScheme ?? 'auto'}
      mode="interactive"
      staticFirst={hydrating}
      imageResolver={imageResolver}
    />
  );

  if (!hydrating) {
    // createRoot is about to own the container; remove any previous fallback or
    // stale markup only after compilation and state validation succeeded.
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  let root: Root | null = null;
  try {
    root = hydrating ? hydrateRoot(element, view) : createRoot(element);
    if (!hydrating) root.render(view);
  } catch (error) {
    try {
      root?.unmount();
    } catch {
      /* best effort */
    }
    try {
      runtime.dispose();
    } catch {
      /* best effort */
    }
    throw new ReactiveMDMountError(
      'Cannot mount a Reactive MD document: React could not render the document.',
      diagnosticsFromError(error, 'standalone.render'),
    );
  }

  mountedElements.add(element);
  element.setAttribute(REACTIVE_MD_MOUNTED_ATTRIBUTE, '');

  const emitState = (): void => {
    if (disposed) return;
    let file: LocalStateFile;
    try {
      file = capture();
    } catch {
      return;
    }
    safeInvoke(hooks.onStateChange ? () => hooks.onStateChange!(file) : undefined);
  };
  const unsubscribe = hooks.onStateChange ? runtime.subscribe(emitState) : () => {};
  safeInvoke(hooks.onStateChange ? () => hooks.onStateChange!(initialState) : undefined);
  if (prepared.diagnostics.length > 0) handleDiagnostics(prepared.diagnostics);

  const cleanupStaticFirst = hydrating ? clearStaticFirstMarkers(element) : () => {};

  const unmount = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    cleanupStaticFirst();
    try {
      root?.unmount();
    } catch {
      /* React may already have unmounted the container. */
    }
    try {
      runtime.dispose();
    } catch {
      /* Disposal is best effort during unmount. */
    }
    mountedElements.delete(element);
    if (element.getAttribute(REACTIVE_MD_MOUNTED_ATTRIBUTE) === '') {
      element.removeAttribute(REACTIVE_MD_MOUNTED_ATTRIBUTE);
    }
  };

  return {
    element,
    getState(): LocalStateFile {
      if (disposed) throw new Error('This Reactive MD document has been unmounted.');
      return capture();
    },
    unmount,
  };
}

/** Mount one document into an element. Compiles and validates before touching it. */
export function mount(element: HTMLElement, options: ReactiveMDMountOptions): ReactiveMDHandle {
  return createStandaloneMount(element, options);
}

function reportAutoDiagnostics(doc: Document, target: EventTarget, diagnostics: Diagnostic[]): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    try {
      console.error(`Reactive MD: ${diagnostics.map((item) => `[${item.code}] ${item.message}`).join(' ')}`);
    } catch {
      /* logging is best effort */
    }
  }
  const CustomEventCtor = doc.defaultView?.CustomEvent;
  if (typeof CustomEventCtor !== 'function') return;
  try {
    target.dispatchEvent(new CustomEventCtor(REACTIVE_MD_DIAGNOSTICS_EVENT, {
      detail: diagnostics,
      bubbles: true,
      composed: true,
    }));
  } catch {
    /* event dispatch is best effort */
  }
}

function isHtmlElement(target: Element, doc: Document): target is HTMLElement {
  const HtmlElementCtor = doc.defaultView?.HTMLElement;
  if (HtmlElementCtor) return target instanceof HtmlElementCtor;
  return target.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

/**
 * Scan the document once for `application/reactive-md+json` auto-mount payloads.
 * Targets are resolved by id only, state is validated by `mount`, and failures
 * are isolated per payload. No MutationObserver is installed.
 */
export function mountAll(root?: ParentNode): ReactiveMDHandle[] {
  if (typeof document === 'undefined') return [];
  const scope = root ?? document;
  const scopeNode = scope as Node;
  const doc = scopeNode.nodeType === 9 ? (scope as Document) : scopeNode.ownerDocument ?? document;
  const handles: ReactiveMDHandle[] = [];

  let scripts: HTMLScriptElement[];
  try {
    scripts = Array.from(scope.querySelectorAll<HTMLScriptElement>(AUTO_MOUNT_SELECTOR));
  } catch {
    return handles;
  }

  for (const script of scripts) {
    let parsed: ReturnType<typeof parseMountPayload>;
    try {
      parsed = parseMountPayload(JSON.parse(script.textContent ?? ''));
    } catch (error) {
      reportAutoDiagnostics(doc, script, [standaloneDiagnostic(
        'standalone.payload.json',
        `The reactive-md payload is not valid JSON: ${errorText(error)}`,
      )]);
      continue;
    }

    if (!parsed.ok) {
      reportAutoDiagnostics(doc, script, parsed.diagnostics);
      continue;
    }

    const payload = parsed.payload;
    // DocumentFragment (including ShadowRoot) exposes getElementById; fall back
    // to the document for element roots. Never build a selector from the payload.
    const fragment = scope as Partial<DocumentFragment>;
    const target = (typeof fragment.getElementById === 'function'
      ? fragment.getElementById(payload.target)
      : null) ?? doc.getElementById(payload.target);
    if (!target) {
      reportAutoDiagnostics(doc, script, [standaloneDiagnostic(
        'standalone.target.missing',
        `The reactive-md payload target "#${payload.target}" was not found.`,
      )]);
      continue;
    }
    if (scopeNode !== doc && !scopeNode.contains(target)) {
      reportAutoDiagnostics(doc, script, [standaloneDiagnostic(
        'standalone.target.scope',
        'The reactive-md payload target is outside the scanned root.',
      )]);
      continue;
    }
    if (!isHtmlElement(target, doc)) {
      reportAutoDiagnostics(doc, script, [standaloneDiagnostic(
        'standalone.target.type',
        'The reactive-md payload target must be an HTML element.',
      )]);
      continue;
    }
    if (isReactiveMDMounted(target)) continue;

    try {
      handles.push(mount(target, {
        source: payload.source,
        state: payload.state,
        locale: payload.locale,
        colorScheme: payload.colorScheme,
        hydrate: payload.hydrate,
        images: payload.images,
      }));
    } catch (error) {
      reportAutoDiagnostics(doc, target, diagnosticsFromError(error));
    }
  }

  return handles;
}
