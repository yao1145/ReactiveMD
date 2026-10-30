import { compileExpression, type LocalExpression } from './expression';
import { evaluateComputations, orderComputations } from './computations';
import type { LocalDocument, LocalNode, LocalValue } from './types';
import {walkLocalNodes} from './node-walk';
import { getLocalComponentRegistry } from '../sdk/registry';
import type { LocalComponentDefinition } from '../sdk/types';

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

/** Public anchor rules used by both navigation and its memo projection. */
export function anchorRuleAttributes(document: LocalDocument, installed?: readonly LocalComponentDefinition[]): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  const definitions = installed ?? (Array.isArray(document.componentDefinitions) ? document.componentDefinitions : getLocalComponentRegistry());
  for (const definition of definitions.slice(0, 192)) {
    if (!definition || typeof definition.name !== 'string' || !Array.isArray(definition.rules)) continue;
    const rule = definition.rules.find((rule: NonNullable<LocalComponentDefinition['rules']>[number]) => rule?.kind === 'anchor');
    if (rule?.kind === 'anchor') attributes.set(definition.name, rule.id);
  }
  return attributes;
}

function explicitAnchorId(node: LocalNode, attributes: ReadonlyMap<string, string>): string | undefined {
  if (node.type !== 'component' && node.type !== 'hostComponent') return undefined;
  const attribute = attributes.get(node.name ?? '');
  if (attribute === undefined) return undefined;
  const id = node.attrs?.[attribute];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  // The compiler rejects the malformed cases; this defensive shape check keeps
  // a hand-built tree from emitting an empty pool of colliding ids.
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) ? id : undefined;
}

/**
 * A source-authored `id` (any P0 HTML node) normalised to a safe DOM id. The
 * identifier stays inside this render instance's namespace, so two documents
 * on one page can never collide or steal each other's fragments.
 */
function sourceHtmlId(node: LocalNode): string | undefined {
  if (node.type === 'component' || node.type === 'hostComponent') return undefined;
  const id = node.attrs?.id;
  if (typeof id !== 'string') return undefined;
  const normalized = id
    .trim()
    .replace(/[\u0000- \u007f-\u009f]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized === '' ? undefined : normalized;
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
export function createHeadingAnchors(document: LocalDocument, namespace: string, includeExplicitAnchors = true, installed?: readonly LocalComponentDefinition[]) {
  const attributes = anchorRuleAttributes(document, installed);
  let initialState = document.initialState;
  if (document.computations) {
    const constants: Record<string, LocalValue> = {};
    const expressions = new Map<string, LocalExpression>();
    for (const [name, meta] of Object.entries(document.computations)) {
      if (meta.kind === 'const' && Object.hasOwn(meta, 'value')) constants[name] = meta.value as LocalValue;
      try { expressions.set(name, compileExpression(meta.source)); } catch { /* Invalid hand-built metadata stays absent. */ }
    }
    const { order } = orderComputations(document.computations);
    const evaluated = evaluateComputations(document.computations, order, expressions, initialState, constants);
    initialState = { ...initialState, ...evaluated.values };
  }
  const ids = new Map<LocalNode, string>();
  const anchorIds = new Map<LocalNode, string>();
  /** Scoped DOM ids for P0 HTML nodes that author an explicit `id`. */
  const htmlIds = new Map<LocalNode, string>();
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

    for (const node of walkLocalNodes(document.nodes)) {
      if (node.type === 'heading') {
        const explicit = sourceHtmlId(node);
        const base = explicit ?? headingSlug(headingText(node.children, initialState));
        ids.set(node, claim(base).id);
      } else {
        if (includeExplicitAnchors) {
          const explicit = explicitAnchorId(node, attributes);
          if (explicit) anchorIds.set(node, claim(explicit).id);
        }
        const sourceId = sourceHtmlId(node);
        if (sourceId) htmlIds.set(node, claim(sourceId).id);
      }
    }

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
    htmlIds,
    /** Namespaced DOM id for a static jump/anchor target slug, if it exists. */
    targetId(to: string): string | undefined {
      return lookup(to);
    },
    referenceId(to: string): string {
      return lookup(to) ?? `${namespace}-${to}`;
    },
    resolve(href: string): string {
      if (!href.startsWith('#')) return href;
      const target = lookup(href.slice(1));
      return target ? `#${target}` : href;
    },
  };
}
