import type { LocalDocument, LocalNode } from './types';
import { localKey } from './types';
import { compileExpression, templateDependencies } from './expression';
import { compileLatex } from './math';

/**
 * Binding keys a node subtree reads. `null` marks nodes whose reads cannot be
 * decided statically; their memo boundary must re-render on every revision.
 */
export type NodeDependencies = readonly string[] | null;
export type DependencyIndex = ReadonlyMap<string, NodeDependencies>;

/**
 * Wildcard index used when no analysis is available: a missing entry means the
 * node reads cannot be decided, so it must re-render on every revision.
 */
export const EMPTY_DEPENDENCY_INDEX: DependencyIndex = new Map();

/**
 * Visual components evaluate their content through plot/table paths that this
 * static analysis does not cover, so they stay conservative (undecidable).
 */
const VISUAL_NODE_NAMES: ReadonlySet<string> = new Set([
  'table', 'chart', 'plot', 'timeline', 'diagram',
]);

const dependencyIndexCache = new WeakMap<LocalDocument, DependencyIndex>();

function addAll(target: Set<string>, values: readonly string[]): void {
  for (const value of values) target.add(value);
}

/**
 * Collects, for every node, the union of binding keys read by the node and its
 * descendants. `null` marks a subtree whose reads cannot be decided statically
 * (own analysis failure or any undecidable descendant).
 */
export function collectNodeDependencies(document: LocalDocument): DependencyIndex {
  const cached = dependencyIndexCache.get(document);
  if (cached !== undefined) return cached;

  const persisted = document.dependencies;
  if (persisted !== undefined) {
    const stored = new Map<string, NodeDependencies>(Object.entries(persisted));
    dependencyIndexCache.set(document, stored);
    return stored;
  }

  const index = new Map<string, NodeDependencies>();

  const visit = (node: LocalNode): NodeDependencies => {
    const dependencies = new Set<string>();
    let undecidable = false;

    // Text interpolations are parsed into `interpolation` child nodes, so
    // attributes are the remaining template site. Any malformed template makes
    // the whole node undecidable.
    if (node.attrs !== undefined) {
      for (const value of Object.values(node.attrs)) {
        try {
          addAll(dependencies, templateDependencies(value));
        } catch {
          undecidable = true;
          break;
        }
      }
    }

    if (!undecidable) {
      if (node.type === 'interpolation') {
        try {
          addAll(dependencies, compileExpression(node.value ?? '').dependencies);
        } catch {
          undecidable = true;
        }
      } else if (node.type === 'math') {
        try {
          addAll(dependencies, compileLatex(node.value ?? '').dependencies);
        } catch {
          undecidable = true;
        }
      } else if (node.name !== undefined) {
        if (VISUAL_NODE_NAMES.has(node.name)) {
          undecidable = true;
        } else {
          // Controls display their own value, so they depend on it. Multi-slot
          // components register one independent key per slot.
          dependencies.add(localKey(node));
          const slots = document.bindingSlots?.[node.id];
          if (slots !== undefined) {
            for (const key of Object.values(slots)) dependencies.add(key);
          }
        }
      }
    }

    let descendantUndecidable = false;
    for (const child of node.children ?? []) {
      const childDependencies = visit(child);
      if (childDependencies === null) descendantUndecidable = true;
      else addAll(dependencies, childDependencies);
    }

    const entry = undecidable || descendantUndecidable ? null : [...dependencies];
    index.set(node.id, entry);
    return entry;
  };

  for (const node of document.nodes) visit(node);
  dependencyIndexCache.set(document, index);
  return index;
}

/**
 * Persists the dependency index on the document so compiled documents carry
 * the analysis as data. Documents built by hand keep working: the renderer
 * falls back to running the same analysis on first use.
 */
export function attachNodeDependencies(document: LocalDocument): void {
  if (document.dependencies !== undefined) return;
  const index = collectNodeDependencies(document);
  const record: Record<string, NodeDependencies> = Object.create(null);
  for (const [id, dependencies] of index) {
    record[id] = dependencies === null ? null : Object.freeze([...dependencies]);
  }
  document.dependencies = Object.freeze(record);
}