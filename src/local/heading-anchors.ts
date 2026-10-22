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
          if (Array.isArray(value)) return '无法计算';
          return value === null ? '' : String(value);
        } catch {
          return '无法计算';
        }
      default:
        return headingText(node.children, initialState);
    }
  }).join('');
}

function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s+/g, '-') || 'section';
}

/** Author fragments use source initial values, so editing parameters preserves navigation. */
export function createHeadingAnchors(document: LocalDocument, namespace: string) {
  const ids = new Map<LocalNode, string>();
  const targets = new Map<string, string>();
  const nextSuffix = new Map<string, number>();

  function visit(nodes: LocalNode[]) {
    for (const node of nodes) {
      if (node.type === 'heading') {
        const base = headingSlug(headingText(node.children, document.initialState));
        let slug = base;
        let suffix = nextSuffix.get(base) ?? 0;
        while (targets.has(slug)) {
          suffix += 1;
          slug = `${base}-${suffix}`;
        }
        nextSuffix.set(base, suffix);
        const id = `${namespace}-${slug}`;
        ids.set(node, id);
        targets.set(slug, id);
      }
      if (node.children) visit(node.children);
    }
  }
  visit(document.nodes);

  return {
    ids,
    resolve(href: string): string {
      if (!href.startsWith('#')) return href;
      try {
        const target = targets.get(decodeURIComponent(href.slice(1)));
        return target ? `#${target}` : href;
      } catch {
        return href;
      }
    },
  };
}
