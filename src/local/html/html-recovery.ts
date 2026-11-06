import { defaultTreeAdapter, html as parse5Html, parseFragment } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import type { LocalNode, LocalRecovery, SourceRange } from '../contracts/types';
import {
  LOCAL_HTML_ALIGN_ELEMENTS,
  LOCAL_HTML_ANCHOR_ATTRIBUTES,
  LOCAL_HTML_NAMES,
  localHtmlAlign,
} from './html-names';
import { HTML_TABLE_ATTRIBUTES, HTML_TABLE_NAMES, validHtmlTableValue } from './html-table';

type PElement = DefaultTreeAdapterTypes.Element;
type PChild = DefaultTreeAdapterTypes.ChildNode;
type ElementLocation = NonNullable<PElement['sourceCodeLocation']>;

/**
 * Fields contributed by the recovery pass itself. They are declared here as an
 * intersection so this module can be merged before `types.ts` grows the
 * optional `LocalNode` fields; the final `LocalNode` shape remains the public
 * contract.
 */
type RecoveryNodeExtra = Partial<LocalNode> & {
  synthetic?: boolean;
  syntheticBoundary?: SourceRange;
};

const HTML_NS = parse5Html.NS.HTML;

const WRAPPER_ELEMENTS = new Set(['html', 'head', 'body']);

/** Inline P0 names share the Markdown parser's mapping. */
const HTML_INLINE: Readonly<Record<string, string>> = {
  b: 'strong',
  strong: 'strong',
  i: 'emphasis',
  em: 'emphasis',
  s: 'delete',
  del: 'delete',
  u: 'underline',
  mark: 'mark',
  sup: 'sup',
  sub: 'sub',
};

/** Elements with no end tag in HTML. */
const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'col']);

const GLOBAL_ATTRIBUTES = new Set(['id', 'title', 'lang', 'dir']);

/** The same P0 attribute surface as the embedded native-HTML parser. */
const P0_TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: LOCAL_HTML_ANCHOR_ATTRIBUTES,
  img: new Set(['src', 'alt', 'width', 'height']),
  ol: new Set(['start']),
  details: new Set(['open']),
  ...HTML_TABLE_ATTRIBUTES,
};

const TABLE_CONTEXT_NAMES: ReadonlySet<string> = HTML_TABLE_NAMES;

const TABLE_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot'],
  colgroup: ['col'],
  thead: ['tr'],
  tbody: ['tr'],
  tfoot: ['tr'],
  tr: ['th', 'td'],
  col: [],
};

const MAX_DEPTH = 100;

interface ScannedTag {
  name: string;
  closing: boolean;
  self: boolean;
  start: number;
  end: number;
}

interface ScanResult {
  tableMode: boolean;
  contextTag: string | null;
  strayClose: ScannedTag | null;
  unclosed: ScannedTag | null;
}

function tagEndAt(source: string, from: number, limit: number): number {
  let quote = '';
  for (let index = from; index < limit; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

function commentEndAt(source: string, start: number, limit: number): number {
  // `<!-->` and `<!--->` are empty comments that end at their first `>`;
  // searching only for `-->` would hide following markup from the validator.
  if (source.startsWith('<!-->', start)) return Math.min(limit, start + 5);
  if (source.startsWith('<!--->', start)) return Math.min(limit, start + 6);
  const close = source.indexOf('-->', start + 4);
  return close < 0 || close + 3 > limit ? limit : close + 3;
}

/**
 * Validate the raw fragment before handing it to the HTML parser. This pass
 * enforces the P0 surface and refuses fragments that carry ReactiveMD
 * semantics (registered component tags or interpolation) which local HTML
 * repair cannot own.
 */
function scanFragment(
  source: string,
  start: number,
  end: number,
  componentNames: ReadonlySet<string>,
  contextTag: string | undefined,
): ScanResult | null {
  const context = contextTag === undefined ? null : contextTag.toLowerCase();
  if (context !== null && !LOCAL_HTML_NAMES.has(context) && !HTML_TABLE_NAMES.has(context)) return null;
  const contextTable = context !== null && TABLE_CONTEXT_NAMES.has(context);

  const stack: ScannedTag[] = [];
  let strayClose: ScannedTag | null = null;
  let tableMode = contextTable;
  let index = start;

  while (index < end) {
    const next = source.indexOf('<', index);
    const textEnd = next < 0 || next >= end ? end : next;
    if (source.slice(index, textEnd).includes('{{')) return null;
    if (next < 0 || next >= end) break;
    index = next;

    if (source.startsWith('<!--', index)) {
      index = commentEndAt(source, index, end);
      continue;
    }

    const head = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(source.slice(index, Math.min(end, index + 80)));
    if (!head) {
      index += 1;
      continue;
    }
    const afterName = index + head[0].length;
    const following = source[afterName];
    if (!(following === '>' || following === '/' || (following !== undefined && /\s/.test(following)))) {
      index = afterName;
      continue;
    }

    const name = head[2].toLowerCase();
    const closing = head[1] === '/';
    const tagEnd = tagEndAt(source, afterName, end);
    if (tagEnd < 0) return null;
    const tag: ScannedTag = {
      name,
      closing,
      self: !closing && /\/\s*$/.test(source.slice(afterName, tagEnd - 1)),
      start: index,
      end: tagEnd,
    };

    if (componentNames.has(name)) return null;

    if (closing) {
      if (name !== 'table' && !HTML_TABLE_NAMES.has(name) && !LOCAL_HTML_NAMES.has(name)) return null;
      if (name !== 'table' && HTML_TABLE_NAMES.has(name) && !contextTable && !stack.some(open => open.name === 'table')) return null;
      let matched = -1;
      for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
        if (stack[cursor].name === name) {
          matched = cursor;
          break;
        }
      }
      if (matched >= 0) stack.length = matched;
      else strayClose ??= tag;
      index = tag.end;
      continue;
    }

    if (name === 'table') {
      tableMode = true;
    } else if (HTML_TABLE_NAMES.has(name)) {
      if (!contextTable && !stack.some(open => open.name === 'table')) return null;
    } else if (!LOCAL_HTML_NAMES.has(name)) {
      return null;
    }
    if (WRAPPER_ELEMENTS.has(name)) return null;

    if (!VOID_ELEMENTS.has(name) && !tag.self) {
      if (name === 'code' || name === 'pre') {
        // The whole body is inert source text; nothing inside may activate.
        const close = new RegExp(`</${name}\\s*>`, 'gi');
        close.lastIndex = tag.end;
        const found = close.exec(source);
        if (found && found.index < end) {
          index = found.index + found[0].length;
          continue;
        }
        stack.push(tag);
        index = end;
        continue;
      }
      stack.push(tag);
    }
    index = tag.end;
  }

  if (stack.length > 0) return { tableMode, contextTag: context, strayClose, unclosed: stack[0] };
  return { tableMode, contextTag: context, strayClose, unclosed: null };
}

/** Decode character references with browser grammar, never activating markup. */
function decodeHtmlEntities(value: string): string {
  if (!value.includes('&')) return value.replace(/\u0000/g, '�');
  try {
    const fragment = parseFragment(value.replace(/</g, '&lt;'), { scriptingEnabled: false });
    let text = '';
    const walk = (node: any): void => {
      if (node.nodeName === '#text') {
        text += node.value;
        return;
      }
      for (const child of node.childNodes ?? []) walk(child);
      if (node.content?.childNodes) for (const child of node.content.childNodes) walk(child);
    };
    for (const child of fragment.childNodes) walk(child);
    return text.replace(/\u0000/g, '�');
  } catch {
    return value.replace(/\u0000/g, '�');
  }
}

function normalizedUrl(value: string): string {
  return value.trim().replace(/[\u0000- ]+/g, '');
}

function unsafeUrl(value: string, kind: 'link' | 'image'): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalizedUrl(value));
  if (!scheme) return false;
  const name = scheme[1].toLowerCase();
  if (kind === 'image') return name !== 'http' && name !== 'https';
  return name !== 'http' && name !== 'https' && name !== 'mailto' && name !== 'tel';
}

/** Attribute validation mirrors the embedded P0 policy; any doubt rejects the fragment. */
function readAttributes(tag: string, element: PElement): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  for (const attribute of element.attrs) {
    if (attribute.prefix || attribute.namespace) return null;
    // An attribute cannot preserve a ReactiveMD expression boundary; taking
    // the fragment as HTML would silently turn it into a literal string.
    if (attribute.value.includes('{{')) return null;
    const name = attribute.name.toLowerCase();
    if (name === 'class' || name === 'style' || /^on[a-z]/i.test(name)) return null;
    if (name === 'align' && LOCAL_HTML_ALIGN_ELEMENTS.has(tag)) {
      const align = localHtmlAlign(attribute.value);
      if (!align) return null;
      attrs.align = align;
      continue;
    }
    const global = GLOBAL_ATTRIBUTES.has(name);
    const aria = /^aria-[a-z0-9_.-]+$/.test(name);
    const data = /^data-[a-z0-9_.-]+$/.test(name);
    const specific = P0_TAG_ATTRIBUTES[tag]?.has(name) ?? false;
    if (!global && !aria && !data && !specific) return null;
    if (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(attribute.value.trim().toLowerCase())) return null;
    if (name === 'id' && attribute.value.trim() === '') return null;
    if ((name === 'width' || name === 'height') && !/^\d{1,6}$/.test(attribute.value.trim())) return null;
    if (name === 'start' && !/^-?\d{1,9}$/.test(attribute.value.trim())) return null;
    if (!validHtmlTableValue(name, attribute.value)) return null;
    if ((name === 'href' || name === 'src') && unsafeUrl(attribute.value, name === 'src' ? 'image' : 'link')) return null;
    attrs[name] = attribute.value;
  }
  if (tag === 'details' && Object.hasOwn(attrs, 'open')) attrs.open = 'true';
  return attrs;
}

/**
 * Recover an isolated HTML fragment inside `[start, end)`.
 *
 * The caller passes a range already confirmed to need structural repair. The
 * function parses only that slice, maps the repaired tree to the existing
 * `LocalNode` model through `createNode`, and never writes the source back.
 * Anything outside the supported P0 surface, any registered component tag,
 * and any interpolation that cannot be kept inert returns `null`, which tells
 * the caller to fall back to literal text for the whole range.
 */
export function recoverLocalHtml(
  source: string,
  start: number,
  end: number,
  createNode: (type: string, start: number, end: number, extra?: Partial<LocalNode>) => LocalNode,
  componentNames: ReadonlySet<string>,
  contextTag?: string,
): { nodes: LocalNode[]; recovery: LocalRecovery; end: number } | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > source.length || end <= start) return null;

  const scan = scanFragment(source, start, end, componentNames, contextTag);
  if (scan === null) return null;

  const length = end - start;
  const clamp = (offset: number): number => Math.max(0, Math.min(length, offset));
  const absolute = (offset: number): number => start + clamp(offset);

  // Concrete defects (missing close, stray close) are better cause markers
  // than a synthesized node span, so they are ranked first.
  const evidence: SourceRange[] = [];
  const syntheticEvidence: SourceRange[] = [];
  if (scan.strayClose) evidence.push({ start: scan.strayClose.start, end: scan.strayClose.end });
  if (scan.unclosed) evidence.push({ start: scan.unclosed.start, end: scan.unclosed.end });

  const tableMode = scan.tableMode;
  const options = { scriptingEnabled: false, sourceCodeLocationInfo: true };
  const html = source.slice(start, end);
  // parse5 accepts malformed HTML. A thrown exception is an implementation
  // failure and must reach the compiler's failed-result path.
  const fragment = scan.contextTag === null
    ? parseFragment(html, options)
    : parseFragment(defaultTreeAdapter.createElement(scan.contextTag, HTML_NS, []), html, options);

  function locationRange(location: ElementLocation): SourceRange | null {
    if (!Number.isInteger(location.startOffset) || !Number.isInteger(location.endOffset)) return null;
    const from = absolute(location.startOffset);
    const to = absolute(location.endOffset);
    return to < from ? null : { start: from, end: to };
  }

  function spanOf(nodes: readonly LocalNode[]): SourceRange | null {
    if (nodes.length === 0) return null;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const child of nodes) {
      from = Math.min(from, child.range.start);
      to = Math.max(to, child.range.end);
    }
    return { start: Math.max(start, from), end: Math.min(end, Math.max(from, to)) };
  }

  function syntheticRange(children: readonly LocalNode[], anchor: number): SourceRange {
    return spanOf(children) ?? { start: Math.max(start, Math.min(end, anchor)), end: Math.max(start, Math.min(end, anchor)) };
  }

  function markSynthetic(extra: RecoveryNodeExtra, range: SourceRange): void {
    extra.synthetic = true;
    extra.syntheticBoundary = { start: range.start, end: range.end };
    syntheticEvidence.push({ start: range.start, end: range.end });
  }

  function finishChildren(tag: string, input: LocalNode[]): LocalNode[] | null {
    const children = input;
    if (tag === 'details') {
      const summary = children.findIndex((child) => child.type === 'summary');
      if (summary > 0) {
        const [node] = children.splice(summary, 1);
        children.unshift(node);
      }
      return children;
    }
    if (tag === 'li' && children.length === 1 && children[0].type === 'paragraph') {
      return children[0].children ?? [];
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = children.filter((child) => !(child.type === 'comment'
        || (child.type === 'text' && !(child.value ?? '').trim())));
      return items.every((child) => child.type === 'listItem') ? items : null;
    }
    return children;
  }

  function convertChildren(element: PElement, tag: string, depth: number, anchor: number): LocalNode[] | null {
    const children: LocalNode[] = [];
    let cursor = Number.NEGATIVE_INFINITY;
    for (const child of element.childNodes) {
      const converted = convertChild(child, depth + 1, anchor);
      if (converted === null) return null;
      if (converted === undefined) continue;
      if (converted.range.start < cursor) return null;
      cursor = converted.range.end;
      children.push(converted);
    }
    return finishChildren(tag, children);
  }

  function convertChild(child: PChild, depth: number, anchor: number): LocalNode | null | undefined {
    if (defaultTreeAdapter.isTextNode(child)) {
      const location = child.sourceCodeLocation;
      if (!location) return null;
      const range = locationRange(location);
      if (range === null) return null;
      if (range.start === range.end) return undefined;
      // Entity decoding may produce an expression opener from source that the
      // raw pre-scan could not see. Never let repair activate interpolation.
      if (child.value.includes('{{')) return null;
      return createNode('text', range.start, range.end, { value: child.value.replace(/\u0000/g, '�') });
    }
    if (defaultTreeAdapter.isCommentNode(child)) {
      const location = child.sourceCodeLocation;
      if (!location) return null;
      const range = locationRange(location);
      if (range === null) return null;
      return createNode('comment', range.start, range.end);
    }
    if (defaultTreeAdapter.isElementNode(child)) return convertElement(child, depth, anchor);
    return null;
  }

  function elementExtra(
    tag: string,
    attrs: Record<string, string>,
    children: LocalNode[],
  ): RecoveryNodeExtra {
    const extra: RecoveryNodeExtra = { attrs, children };
    if (tag === 'a') {
      if (attrs.href === undefined) extra.type = 'span';
      else {
        extra.type = 'link';
        extra.url = attrs.href;
        extra.title = attrs.title ?? null;
      }
      return extra;
    }
    if (/^h[1-6]$/.test(tag)) {
      extra.type = 'heading';
      extra.depth = Number(tag.slice(1));
      return extra;
    }
    if (tag === 'ul' || tag === 'ol') {
      extra.type = 'list';
      extra.ordered = tag === 'ol';
      const first = attrs.start === undefined ? undefined : Number(attrs.start);
      if (tag === 'ol' && first !== undefined && Number.isFinite(first)) extra.start = first;
      return extra;
    }
    if (tag === 'p') extra.type = 'paragraph';
    else if (tag === 'div') extra.type = 'div';
    else if (tag === 'blockquote') extra.type = 'blockquote';
    else if (tag === 'details') extra.type = 'details';
    else if (tag === 'li') extra.type = 'listItem';
    else extra.type = HTML_INLINE[tag] ?? tag;
    return extra;
  }

  function convertElement(element: PElement, depth: number, anchor: number): LocalNode | null {
    if (depth > MAX_DEPTH) return null;
    if (element.namespaceURI !== HTML_NS) return null;
    const tag = element.tagName.toLowerCase();
    if (WRAPPER_ELEMENTS.has(tag)) return null;
    if (!LOCAL_HTML_NAMES.has(tag) && !(tableMode && HTML_TABLE_NAMES.has(tag))) return null;

    const location = element.sourceCodeLocation;
    const synthetic = !location;
    const attrs = readAttributes(tag, element);
    if (attrs === null) return null;

    if (tag === 'br' || tag === 'hr' || tag === 'img') {
      if (!location) return null;
      const range = locationRange(location);
      if (range === null) return null;
      if (tag === 'br') return createNode('break', range.start, range.end, { attrs });
      if (tag === 'hr') return createNode('thematicBreak', range.start, range.end, { attrs });
      const width = attrs.width === undefined ? undefined : Number(attrs.width);
      const height = attrs.height === undefined ? undefined : Number(attrs.height);
      return createNode('image', range.start, range.end, {
        attrs,
        url: attrs.src,
        alt: attrs.alt ?? '',
        title: attrs.title ?? null,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      });
    }

    if (tag === 'code' || tag === 'pre') {
      if (!location || !location.startTag) return null;
      const range = locationRange(location);
      if (range === null) return null;
      const bodyStart = absolute(location.startTag.endOffset);
      const bodyEnd = location.endTag ? absolute(location.endTag.startOffset) : absolute(location.endOffset);
      if (bodyEnd < bodyStart) return null;
      const raw = source.slice(bodyStart, bodyEnd);
      if (location.endTag === undefined) {
        evidence.push({ start: absolute(location.startTag.startOffset), end: absolute(location.startTag.endOffset) });
      }
      if (tag === 'pre') {
        const wrapped = /^<code(?:\s[^>]*)?>([\s\S]*)<\/code>$/.exec(raw);
        return createNode('code', range.start, range.end, {
          attrs,
          value: decodeHtmlEntities(wrapped ? wrapped[1] : raw),
        });
      }
      return createNode('inlineCode', range.start, range.end, { attrs, value: decodeHtmlEntities(raw) });
    }

    if (HTML_TABLE_NAMES.has(tag)) return convertTableElement(element, tag, attrs, depth, anchor, location);

    const children = convertChildren(element, tag, depth, anchor);
    if (children === null) return null;

    const extra = elementExtra(tag, attrs, children);
    let range: SourceRange;
    if (synthetic) {
      range = syntheticRange(children, anchor);
      markSynthetic(extra, range);
    } else {
      const measured = locationRange(location as ElementLocation);
      if (measured === null) return null;
      range = measured;
      if (!location?.endTag && location?.startTag) {
        evidence.push({ start: absolute(location.startTag.startOffset), end: absolute(location.startTag.endOffset) });
      }
    }
    return createNode(extra.type ?? tag, range.start, range.end, extra);
  }

  function convertTableStructure(element: PElement, tag: string, depth: number, anchor: number): LocalNode[] | null {
    const allowed = TABLE_CHILDREN[tag];
    if (allowed === undefined) return null;
    const children: LocalNode[] = [];
    let cursor = Number.NEGATIVE_INFINITY;
    for (const child of element.childNodes) {
      if (defaultTreeAdapter.isTextNode(child)) {
        if (!child.value.trim()) continue;
        return null;
      }
      if (defaultTreeAdapter.isCommentNode(child)) continue;
      if (!defaultTreeAdapter.isElementNode(child)) return null;
      if (child.namespaceURI !== HTML_NS) return null;
      const childTag = child.tagName.toLowerCase();
      if (!allowed.includes(childTag)) return null;
      const childAttrs = readAttributes(childTag, child);
      if (childAttrs === null) return null;
      const converted = convertTableElement(child, childTag, childAttrs, depth + 1, anchor, child.sourceCodeLocation);
      if (converted === null) return null;
      if (converted.range.start < cursor) return null;
      cursor = converted.range.end;
      children.push(converted);
    }
    return children;
  }

  function convertTableElement(
    element: PElement,
    tag: string,
    attrs: Record<string, string>,
    depth: number,
    anchor: number,
    location: ElementLocation | null | undefined,
  ): LocalNode | null {
    if (depth > MAX_DEPTH) return null;
    const synthetic = !location;
    let children: LocalNode[] | null;
    if (tag === 'td' || tag === 'th' || tag === 'caption') {
      children = convertChildren(element, tag, depth, anchor);
    } else {
      children = convertTableStructure(element, tag, depth, anchor);
    }
    if (children === null) return null;

    let range: SourceRange;
    const extra: RecoveryNodeExtra = tag === 'table'
      ? { attrs, children }
      : { attrs, children, name: tag };
    if (synthetic) {
      range = syntheticRange(children, anchor);
      markSynthetic(extra, range);
    } else {
      const measured = locationRange(location as ElementLocation);
      if (measured === null) return null;
      range = measured;
      if (!location?.endTag && !VOID_ELEMENTS.has(tag) && location?.startTag) {
        evidence.push({ start: absolute(location.startTag.startOffset), end: absolute(location.startTag.endOffset) });
      }
    }
    return createNode(tag === 'table' ? 'htmlTable' : 'htmlTableElement', range.start, range.end, extra);
  }

  const nodes: LocalNode[] = [];
  let cursor = Number.NEGATIVE_INFINITY;
  for (const child of fragment.childNodes) {
    const converted = convertChild(child, 0, start);
    if (converted === null) return null;
    if (converted === undefined) continue;
    if (converted.range.start < cursor) return null;
    if (converted.range.start < start || converted.range.end > end) return null;
    cursor = converted.range.end;
    nodes.push(converted);
  }
  if (nodes.length === 0) return null;
  const meaningful = nodes.some((child) => !(child.type === 'comment'
    || (child.type === 'text' && !(child.value ?? '').trim())));
  if (!meaningful) return null;

  evidence.sort((left, right) => left.start - right.start || left.end - right.end);
  syntheticEvidence.sort((left, right) => left.start - right.start || left.end - right.end);
  const first = evidence[0] ?? syntheticEvidence[0];
  const causeStart = first === undefined ? start : Math.max(start, Math.min(end, first.start));
  const causeEnd = first === undefined
    ? causeStart
    : Math.max(causeStart, Math.min(end, first.end));
  const recovery: LocalRecovery = {
    code: 'local.html.repair',
    causeRange: { start: causeStart, end: causeEnd },
    affectedRange: { start, end },
    action: 'html-repair',
    boundary: 'fragment',
  };

  return { nodes, recovery, end };
}
