import { defaultTreeAdapter, parse, serialize } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

type PElement = DefaultTreeAdapterTypes.Element;
type PParent = DefaultTreeAdapterTypes.ParentNode;
type PChild = DefaultTreeAdapterTypes.ChildNode;

/** Wrapper classes emitted by createShareableHtml / the native static export. */
const NATIVE_WRAPPER_CLASS = 'reactive-md-native-document';
const NATIVE_FRAME_CLASS = 'reactive-md-native-frame';
const EXPORT_ROOT_CLASS = 'reactive-md-export-root';
const FRAGMENT_FRAME_CLASS = 'local-extended-fragment-frame';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const PRINT_FRAGMENT_TAGS = new Set([
  'article', 'section', 'header', 'footer', 'div', 'p', 'span', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'br', 'hr',
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'sub', 'sup', 'img',
  'dl', 'dd', 'dt', 'ol', 'ul', 'li', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);
const PRINT_FRAGMENT_ATTRIBUTES = new Set(['alt', 'title', 'dir', 'lang', 'start', 'colspan', 'rowspan', 'scope']);
const INLINE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i;

/** Only engine-generated envelopes carry this format marker. */
const ENGINE_FORMAT = /^reactive-md-html\/v[0-9]+$/;
const ENGINE_DOCTYPE = /^\s*<!doctype html>/i;

/** Elements that would execute or fetch when moved out of the sandbox. */
const FORBIDDEN_ELEMENTS = new Set(['script', 'base', 'link']);
/** Attributes that make a browser fetch another document or resource. */
const FETCHING_ATTRIBUTES = new Set(['src', 'srcset', 'poster', 'data', 'xlink:href', 'background']);

function isElement(node: PChild): node is PElement {
  return defaultTreeAdapter.isElementNode(node);
}

function isText(node: PChild): node is DefaultTreeAdapterTypes.TextNode {
  return defaultTreeAdapter.isTextNode(node);
}

function templateContent(element: PElement): DefaultTreeAdapterTypes.DocumentFragment {
  return defaultTreeAdapter.getTemplateContent(element as DefaultTreeAdapterTypes.Template);
}

function attribute(element: PElement, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name.toLowerCase() === name)?.value;
}

function classTokens(element: PElement): string[] {
  const value = attribute(element, 'class');
  return value === undefined ? [] : value.split(/\s+/).filter(Boolean);
}

function hasClass(element: PElement, name: string): boolean {
  return classTokens(element).includes(name);
}

function firstElement(parent: PParent, tag: string): PElement | null {
  for (const child of parent.childNodes) {
    if (isElement(child) && child.tagName.toLowerCase() === tag) return child;
  }
  return null;
}

function metaContent(head: PElement, name: string): string | undefined {
  for (const meta of head.childNodes) {
    if (!isElement(meta) || meta.tagName !== 'meta') continue;
    if (attribute(meta, 'name')?.trim().toLowerCase() === name) return attribute(meta, 'content');
  }
  return undefined;
}

/**
 * True only for the shell createShareableHtml emits around a static native
 * document. Author markup cannot supply these engine metadata names, the
 * export root class and the wrapper together by accident.
 */
function isStaticEngineShell(head: PElement): boolean {
  const format = metaContent(head, 'reactive-md-html-format');
  return format !== undefined && ENGINE_FORMAT.test(format.trim())
    && metaContent(head, 'reactive-md-output')?.trim().toLowerCase() === 'static';
}

function onlyElement(parent: PElement): PElement | null {
  const children = parent.childNodes.filter((child) => !(isText(child) && child.value.trim() === ''));
  if (children.length !== 1) return null;
  return isElement(children[0]) ? children[0] : null;
}

/** Match the static export's direct native wrapper and sandboxed srcdoc. */
function nativeFrame(body: PElement): string | undefined {
  const root = body.childNodes.find((node) => isElement(node) && hasClass(node, EXPORT_ROOT_CLASS));
  if (!root || !isElement(root)) return undefined;
  const wrapper = onlyElement(root);
  if (!wrapper || !hasClass(wrapper, NATIVE_WRAPPER_CLASS)) return undefined;
  const frame = onlyElement(wrapper);
  if (!frame || frame.tagName !== 'iframe' || !hasClass(frame, NATIVE_FRAME_CLASS)) return undefined;
  const sandbox = attribute(frame, 'sandbox');
  if (sandbox === undefined || /\ballow-(?:same-origin|scripts)\b/i.test(sandbox)) return undefined;
  return attribute(frame, 'srcdoc');
}

function hasContentSecurityPolicy(head: PElement): boolean {
  return head.childNodes.some((node) => isElement(node) && node.tagName === 'meta'
    && attribute(node, 'http-equiv')?.trim().toLowerCase() === 'content-security-policy');
}

function hasRemoteCandidate(value: string): boolean {
  // CSS URLs may list several candidates; one remote entry is enough.
  return value.split(/[\s,]+/).some((candidate) => {
    const url = candidate.trim();
    if (url === '' || url.startsWith('#') || url.startsWith('//')) return url.startsWith('//');
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase();
    return scheme !== undefined && scheme !== 'data' && scheme !== 'about';
  });
}

/**
 * Remove everything that would run or fetch from the promoted document. The
 * shell CSP still blocks this, but a printed page should not carry executable
 * or remote payloads out of the sandbox at all.
 */
function scrub(nodes: PChild[]): PChild[] {
  const kept: PChild[] = [];
  for (const node of nodes) {
    if (!isElement(node)) {
      kept.push(node);
      continue;
    }
    const tag = node.tagName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tag) || (tag === 'meta' && attribute(node, 'http-equiv') !== undefined)) continue;
    node.attrs = node.attrs.filter((entry) => {
      const name = entry.name.toLowerCase();
      if (name.startsWith('on')) return false;
      if (!FETCHING_ATTRIBUTES.has(name)) return true;
      return !hasRemoteCandidate(entry.value);
    });
    if (tag === 'template') {
      const content = templateContent(node);
      content.childNodes = scrub(content.childNodes);
    }
    node.childNodes = scrub(node.childNodes);
    kept.push(node);
  }
  return kept;
}

function printableFrame(frame: PElement, depth: number): PChild[] {
  const srcdoc = attribute(frame, 'srcdoc');
  const sandbox = attribute(frame, 'sandbox');
  if (srcdoc && sandbox !== undefined && !/\ballow-(?:same-origin|scripts)\b/i.test(sandbox) && depth < 5) {
    const root = firstElement(parse(srcdoc, { scriptingEnabled: false }), 'html');
    const head = root && firstElement(root, 'head');
    const body = root && firstElement(root, 'body');
    if (head && body && hasContentSecurityPolicy(head)) return printableFragment(body.childNodes, depth + 1);
  }
  const title = attribute(frame, 'title');
  return title ? [{ nodeName: '#text', value: title, parentNode: null }] : [];
}

/** Promote only inert HTML, plain text and inline raster images out of frames. */
function printableFragment(nodes: readonly PChild[], depth: number): PChild[] {
  const result: PChild[] = [];
  for (const node of nodes) {
    if (isText(node)) { result.push(node); continue; }
    if (!isElement(node) || node.namespaceURI !== HTML_NS) continue;
    if (node.tagName === 'iframe') {
      const block = defaultTreeAdapter.createElement('div', node.namespaceURI, []);
      for (const child of printableFrame(node, depth)) defaultTreeAdapter.appendChild(block, child);
      result.push(block);
      continue;
    }
    if (FORBIDDEN_ELEMENTS.has(node.tagName) || node.tagName === 'style' || node.tagName === 'template') continue;
    const children = printableFragment(node.childNodes, depth);
    if (!PRINT_FRAGMENT_TAGS.has(node.tagName)) { result.push(...children); continue; }
    node.attrs = node.attrs.filter(({ name, value, namespace }) => !namespace && (PRINT_FRAGMENT_ATTRIBUTES.has(name)
      || node.tagName === 'img' && name === 'src' && INLINE_IMAGE.test(value)));
    node.childNodes = children;
    result.push(node);
  }
  return result;
}

function expandExtendedPrintFrames(root: PParent): boolean {
  let changed = false;
  for (const child of root.childNodes) {
    if (!isElement(child)) continue;
    if (attribute(child, 'data-extended-html') !== 'sandbox') {
      if (expandExtendedPrintFrames(child)) changed = true;
      continue;
    }
    const frame = onlyElement(child);
    if (!frame || frame.tagName !== 'iframe' || !hasClass(frame, FRAGMENT_FRAME_CLASS)) continue;
    child.childNodes = printableFrame(frame, 0);
    changed = true;
  }
  return changed;
}

/**
 * Move a static native document out of its preview frame so Chromium can
 * paginate the body. Keep the author's HTML and body attributes, along with
 * the export's print styles and restrictions on resource loading.
 */
export function prepareLocalPrintHtml(html: string): string {
  const hasNativeFrame = html.includes(NATIVE_WRAPPER_CLASS) && html.includes(NATIVE_FRAME_CLASS);
  if (!hasNativeFrame && !html.includes(FRAGMENT_FRAME_CLASS)) return html;
  const parsed = parse(html, { scriptingEnabled: false });
  const shell = firstElement(parsed, 'html');
  const head = shell && firstElement(shell, 'head');
  const body = shell && firstElement(shell, 'body');
  if (!head || !body || !isStaticEngineShell(head)) return html;

  const markup = nativeFrame(body);
  if (!markup || !ENGINE_DOCTYPE.test(markup)) {
    const root = body.childNodes.find(node => isElement(node) && hasClass(node, EXPORT_ROOT_CLASS));
    return root && isElement(root) && expandExtendedPrintFrames(root) ? serialize(parsed, { scriptingEnabled: false }) : html;
  }
  const native = parse(markup, { scriptingEnabled: false });
  const root = firstElement(native, 'html');
  const nativeHead = root && firstElement(root, 'head');
  const nativeBody = root && firstElement(root, 'body');
  if (!nativeHead || !nativeBody || !hasContentSecurityPolicy(nativeHead)) return html;

  const policy = defaultTreeAdapter.createElement('meta', head.namespaceURI, [
    { name: 'http-equiv', value: 'Content-Security-Policy' },
    {
      name: 'content',
      value: "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; "
        + "frame-src about: data: blob:; base-uri 'none'; form-action 'none'",
    },
  ]);
  // The native sanitizer has already applied the author's CSS grant. The
  // print page also needs the export stylesheet, including the default @page.
  const styles = head.childNodes.filter(node => isElement(node) && node.tagName === 'style');
  const nativeStyles = nativeHead.childNodes.filter(node => isElement(node) && node.tagName === 'style');
  const metadata = head.childNodes.filter(node => isElement(node) && (node.tagName === 'meta' || node.tagName === 'title')
    && attribute(node, 'http-equiv')?.toLowerCase() !== 'refresh');
  nativeHead.childNodes = [policy, ...metadata, ...styles, ...scrub(nativeStyles)];
  nativeBody.childNodes = scrub(nativeBody.childNodes);
  return serialize(native, { scriptingEnabled: false });
}

/**
 * Wait for fonts and every image before printing, and return readable labels
 * for images Chromium could not decode. Labels use alt text, or the 1-based
 * document index when alt is empty; they never contain the image source, so a
 * data URI never reaches a diagnostic.
 *
 * The function only reads the global `document` and declares every constant
 * inline, which lets `page.evaluate(waitForLocalPrintImages)` serialize it into
 * the page. A host printing a document that lives in an iframe can pass that
 * frame's document.
 */
export async function waitForLocalPrintImages(target?: Document | void): Promise<readonly string[]> {
  const controlText = /[\u0000-\u001f\u007f-\u009f]/g;
  const labelLimit = 120;
  const decodeTimeoutMs = 15_000;
  const label = (image: { readonly alt?: unknown }, index: number): string => {
    const raw = typeof image.alt === 'string' ? image.alt.replace(controlText, ' ').trim() : '';
    // An alt that happens to be a URL is not a readable label, and a data URI
    // must never reach a diagnostic.
    const clean = raw === '' || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') ? '' : raw;
    const text = clean === '' ? `#${index + 1}` : clean;
    return text.length > labelLimit ? `${text.slice(0, labelLimit - 3)}...` : text;
  };
  const doc = target ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) return [];
  const images = Array.from(doc.images ?? []);
  for (const image of images) {
    try {
      image.loading = 'eager';
    } catch {
      /* Older engines expose no loadable loading property. */
    }
  }
  const fonts = doc.fonts;
  if (fonts && typeof fonts.ready?.then === 'function') {
    try {
      await fonts.ready;
    } catch {
      /* Font loading failures must not block the print. */
    }
  }
  const decoded = await Promise.all(images.map(async (image) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A raster that never settles must not hang the print. Decode errors and
      // timeouts mean the same thing here: the image cannot be printed.
      await Promise.race([
        image.decode(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('image decode timed out')), decodeTimeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }));
  const broken: string[] = [];
  decoded.forEach((ok, index) => {
    if (!ok) broken.push(label(images[index], index));
  });
  return broken;
}
