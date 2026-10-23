import { compileExpression } from './expression';
import type { LocalDocument, LocalNode, LocalValue } from './types';

function headingText(nodes: LocalNode[] | undefined, initialState: Record<string, LocalValue>): string {
  return (nodes ?? []).map((node): string => {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
      case 'inlineMath':
      case 'fallback':
        return node.value ?? '';
      case 'image':
        return node.alt ?? '';
      case 'break':
        return ' ';
      case 'interpolation':
        try {
          const value = compileExpression(node.value ?? '').evaluate(initialState);
          if (Array.isArray(value)) return 'Cannot compute';
          return value === null ? '' : String(value);
        } catch {
          return 'Cannot compute';
        }
      default:
        return headingText(node.children, initialState);
    }
  }).join('');
}

function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s+/g, '-') || 'section';
}

function explicitAnchorId(node: LocalNode): string | undefined {
  if (node.type !== 'component' || node.name !== 'anchor') return undefined;
  const id = node.attrs?.id;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  // The compiler rejects the malformed cases; this defensive shape check keeps
  // a hand-built tree from emitting an empty pool of colliding ids.
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) ? id : undefined;
}

/**
 * Heading slugs and explicit `<anchor>` ids share one per-render-instance
 * namespace. Author fragments (`#result`) resolve against either kind of
 * target, and `<jump to="result">` asks for the already-namespaced DOM id via
 * `targetId`, so the renderer never has to query the global document.
 *
 * Fragments use source initial values, so editing parameters preserves
 * navigation.
 */
export function createHeadingAnchors(document: LocalDocument, namespace: string, includeExplicitAnchors = true) {
  const ids = new Map<LocalNode, string>();
  const anchorIds = new Map<LocalNode, string>();
  const targets = new Map<string, string>();
  const nextSuffix = new Map<string, number>();

  function claim(base: string): { slug: string; id: string } {
    let slug = base;
    let suffix = nextSuffix.get(base) ?? 0;
    while (targets.has(slug)) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }
    nextSuffix.set(base, suffix);
    const id = `${namespace}-${slug}`;
    targets.set(slug, id);
    return { slug, id };
  }

  function visit(nodes: LocalNode[]) {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const base = headingSlug(headingText(node.children, document.initialState));
        ids.set(node, claim(base).id);
      } else if (includeExplicitAnchors) {
        const explicit = explicitAnchorId(node);
        if (explicit) anchorIds.set(node, claim(explicit).id);
      }
      if (node.children) visit(node.children);
    }
  }
  visit(document.nodes);

  function lookup(fragment: string): string | undefined {
    if (fragment.length === 0) return undefined;
    const direct = targets.get(fragment);
    if (direct) return direct;
    try {
      return targets.get(decodeURIComponent(fragment));
    } catch {
      return undefined;
    }
  }

  return {
    ids,
    anchorIds,
    /** Namespaced DOM id for a static jump/anchor target slug, if it exists. */
    targetId(to: string): string | undefined {
      return lookup(to);
    },
    resolve(href: string): string {
      if (!href.startsWith('#')) return href;
      const target = lookup(href.slice(1));
      return target ? `#${target}` : href;
    },
  };
}
