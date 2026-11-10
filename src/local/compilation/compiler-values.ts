import type { LocalNode } from '../contracts/types';
import type { AttrMap, Entry } from './compiler-structure';

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseNumberText(raw: string): number | null {
  const text = raw.trim();
  if (!NUMBER_TEXT.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isWhitespaceNode(node: LocalNode): boolean {
  return (
    node.type === 'comment' ||
    (node.type === 'text' && !(node.value ?? '').trim()) ||
    (node.type === 'paragraph' && !node.children?.length && !(node.value ?? '').trim())
  );
}

export function meaningful(nodes: LocalNode[] | undefined): LocalNode[] {
  return (nodes ?? []).filter((node) => !isWhitespaceNode(node));
}

export function hasComponent(node: LocalNode): boolean {
  if (node.type === 'component') return true;
  return (node.children ?? []).some(hasComponent);
}

/** Static numeric attribute value, or the manifest prop default. */
export function numberValue(
  entry: Entry,
  attrs: AttrMap,
  name: string | undefined,
): number | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'number' ? info.value : undefined;
  const fallback = entry.kernel.props[name]?.default;
  return typeof fallback === 'number' ? fallback : undefined;
}

/** Static string attribute value, or the manifest prop default. */
export function staticAttributeString(
  entry: Entry,
  attrs: AttrMap,
  name: string | undefined,
): string | undefined {
  if (name === undefined) return undefined;
  const info = attrs[name];
  if (info) return !info.dynamic && typeof info.value === 'string' ? info.value : undefined;
  const fallback = entry.kernel.props[name]?.default;
  return typeof fallback === 'string' ? fallback : undefined;
}
