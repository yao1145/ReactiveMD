import { defaultTreeAdapter, parseFragment } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

/**
 * Structural markers emitted by the renderer when an extension cannot render.
 * Text that merely contains these names (prose, inline code, attribute
 * examples) is not an error, so the check reads the parsed DOM instead of
 * scanning the serialized string.
 */
export type UnavailableExtensionReason = 'extension-error' | 'sdk-unavailable';

export interface UnavailableExtensionMarkup {
  /** `extension-error` is the document-level alert block; `sdk-unavailable` a component placeholder. */
  readonly reason: UnavailableExtensionReason;
  /** Host component tag name when the placeholder records one. */
  readonly component?: string;
  /** Renderer-supplied messages, bounded for diagnostics. */
  readonly detail?: string;
}

const ERROR_ATTRIBUTE = 'data-rmd-extension-error';
const ERROR_FLAG_ATTRIBUTE = 'data-local-extension-error';
const HOST_COMPONENT_ATTRIBUTE = 'data-local-host-component';
const SDK_UNAVAILABLE_CLASS = 'local-sdk-unavailable';
const MAX_DETAIL_LENGTH = 300;

/**
 * A real marker always serializes one of these literals. The cheap check keeps
 * the common case (no unavailable component) from paying for a parse5 pass over
 * every static export. HTML tag and attribute names are case-insensitive.
 */
const MARKER_TOKENS = /(?:data-rmd-extension-error|data-local-extension-error|local-sdk-unavailable)/i;

function attributeValue(
  element: DefaultTreeAdapterTypes.Element,
  name: string,
): string | undefined {
  for (const attribute of element.attrs) {
    // HTML attribute names are lowercased by the parser; foreign content is not.
    if (attribute.name.toLowerCase() === name) return attribute.value;
  }
  return undefined;
}

function hasClassToken(element: DefaultTreeAdapterTypes.Element, token: string): boolean {
  const value = attributeValue(element, 'class');
  return value !== undefined && value.split(/\s+/).includes(token);
}

function boundedDetail(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function inspectElement(element: DefaultTreeAdapterTypes.Element): UnavailableExtensionMarkup | undefined {
  const errorMessage = attributeValue(element, ERROR_ATTRIBUTE);
  if (errorMessage !== undefined) {
    const detail = boundedDetail(errorMessage);
    return { reason: 'extension-error', ...(detail === undefined ? {} : { detail }) };
  }
  // The document-level alert flag is only produced by parsing an actual
  // attribute, so plain text or attribute examples never reach this branch.
  if (attributeValue(element, ERROR_FLAG_ATTRIBUTE) !== undefined) return { reason: 'extension-error' };
  // The SDK failure placeholder carries the marker class and the host
  // component attribute together. Requiring the pair (not either alone) keeps
  // an author's ordinary class or attribute example from matching.
  const hostComponent = attributeValue(element, HOST_COMPONENT_ATTRIBUTE);
  if (hostComponent !== undefined && hasClassToken(element, SDK_UNAVAILABLE_CLASS)) {
    const component = boundedDetail(hostComponent);
    return { reason: 'sdk-unavailable', ...(component === undefined ? {} : { component }) };
  }
  return undefined;
}

/**
 * Find the first unavailable-extension marker in rendered static markup.
 * Traverses in document order, including `<template>` contents. Text nodes,
 * attribute examples and `srcdoc` payloads are not inspected.
 */
export function findUnavailableExtensionMarkup(markup: string): UnavailableExtensionMarkup | null {
  if (typeof markup !== 'string' || markup.trim() === '') return null;
  if (!MARKER_TOKENS.test(markup)) return null;
  let fragment: DefaultTreeAdapterTypes.DocumentFragment;
  try {
    fragment = parseFragment(markup, { scriptingEnabled: false });
  } catch {
    // parse5 is resilient for strings; an unexpected parser failure means the
    // markup cannot be attributed to a renderer node.
    return null;
  }
  // Explicit stack: caller markup may nest deeper than the JS call stack.
  // Nodes are pushed in reverse so popping visits them in document order.
  const stack: DefaultTreeAdapterTypes.ChildNode[] = [];
  pushChildren(fragment, stack);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!defaultTreeAdapter.isElementNode(node)) continue;
    const found = inspectElement(node);
    if (found) return found;
    const children = node.tagName.toLowerCase() === 'template'
      ? defaultTreeAdapter.getTemplateContent(node as DefaultTreeAdapterTypes.Template).childNodes
      : node.childNodes;
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return null;
}

function pushChildren(
  parent: DefaultTreeAdapterTypes.ParentNode,
  stack: DefaultTreeAdapterTypes.ChildNode[],
): void {
  for (let index = parent.childNodes.length - 1; index >= 0; index -= 1) stack.push(parent.childNodes[index]);
}

/** One-line diagnostic text for a marker found by {@link findUnavailableExtensionMarkup}. */
export function unavailableExtensionMessage(marker: UnavailableExtensionMarkup): string {
  if (marker.reason === 'sdk-unavailable') {
    return marker.component
      ? `Rendered output leaves host component <${marker.component}> unavailable.`
      : 'Rendered output leaves a host component unavailable.';
  }
  return marker.detail
    ? `Rendered output contains an unavailable extension component: ${marker.detail}`
    : 'Rendered output contains an unavailable extension component.';
}
