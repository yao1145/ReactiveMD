import type { DependencyIndex, NodeDependencies } from './dependencies';
import type { LocalDocument, LocalNode, LocalValue } from './types';

/**
 * Pure projections used to keep a rendered document's memo boundaries stable
 * while the source is recompiled. Structural sharing from the incremental
 * compiler means an unchanged node keeps its object identity, so identity
 * comparison is enough for every projection whose result is derived solely
 * from those nodes.
 */

export interface AnchorProjection {
  /** Nodes that can contribute a heading slug, `<anchor>` or explicit DOM id. */
  readonly nodes: readonly LocalNode[];
  /** Initial values and constants feed interpolations inside heading text. */
  readonly metadata: string;
}

export interface FootnoteProjection {
  readonly nodes: readonly LocalNode[];
}

/**
 * Stable handle over the current dependency index. The index itself changes
 * whenever a node id is recompiled, but the handle keeps its identity so a
 * memoized block is never invalidated merely because an unrelated block was
 * added or removed. Reads always observe the latest index for this render.
 */
export interface DependencyLookup {
  get(nodeId: string): NodeDependencies | undefined;
}

function localValueKey(value: LocalValue | undefined): string {
  if (Array.isArray(value)) return `a[${value.map((entry) => JSON.stringify(entry)).join(',')}]`;
  return `${typeof value}:${JSON.stringify(value)}`;
}

/** Signature of document metadata that can change an anchor's rendered id. */
export function anchorMetadataKey(document: LocalDocument): string {
  let initial = '';
  const initialState = document.initialState ?? {};
  for (const key of Object.keys(initialState).sort()) {
    initial += `${key}=${localValueKey(initialState[key])}\u0001`;
  }
  let computations = '';
  const metadata = document.computations ?? {};
  for (const key of Object.keys(metadata).sort()) {
    const computation = metadata[key];
    if (!computation) continue;
    computations += `${key}\u0000${computation.kind}\u0000${computation.source}\u0000${localValueKey(computation.value)}\u0002`;
  }
  return `${initial}\u0003${computations}`;
}

export function projectAnchors(document: LocalDocument): AnchorProjection {
  const nodes: LocalNode[] = [];
  const visit = (list: LocalNode[] | undefined): void => {
    for (const node of list ?? []) {
      const explicitHtmlId = node.type !== 'component' && typeof node.attrs?.id === 'string';
      const explicitAnchor = node.type === 'component'
        && node.name === 'anchor'
        && typeof node.attrs?.id === 'string';
      if (node.type === 'heading' || explicitHtmlId || explicitAnchor) nodes.push(node);
      visit(node.children);
    }
  };
  visit(document.nodes);
  return { nodes, metadata: anchorMetadataKey(document) };
}

export function sameAnchorProjection(previous: AnchorProjection, next: AnchorProjection): boolean {
  if (previous.metadata !== next.metadata) return false;
  if (previous.nodes.length !== next.nodes.length) return false;
  for (let index = 0; index < previous.nodes.length; index += 1) {
    if (previous.nodes[index] !== next.nodes[index]) return false;
  }
  return true;
}

export function projectFootnotes(document: LocalDocument): FootnoteProjection {
  const nodes: LocalNode[] = [];
  const visit = (list: LocalNode[] | undefined): void => {
    for (const node of list ?? []) {
      if (node.type === 'footnoteDefinition' || node.type === 'footnoteReference') nodes.push(node);
      visit(node.children);
    }
  };
  visit(document.nodes);
  return { nodes };
}

export function sameFootnoteProjection(previous: FootnoteProjection, next: FootnoteProjection): boolean {
  if (previous.nodes.length !== next.nodes.length) return false;
  for (let index = 0; index < previous.nodes.length; index += 1) {
    if (previous.nodes[index] !== next.nodes[index]) return false;
  }
  return true;
}

/** Content equality for a persisted or recomputed dependency index. */
export function dependencyIndexEqual(previous: DependencyIndex, next: DependencyIndex): boolean {
  if (previous === next) return true;
  if (previous.size !== next.size) return false;
  for (const [id, values] of next) {
    const other = previous.get(id);
    if (other === undefined) return false;
    if (other === values) continue;
    if (other === null || values === null) return false;
    if (other.length !== values.length) return false;
    for (let index = 0; index < values.length; index += 1) {
      if (other[index] !== values[index]) return false;
    }
  }
  return true;
}

/**
 * Validation rendering reads the rule set and the node ids each field binds
 * to. Both are compared by content so a prose-only edit keeps the same
 * context value (and does not invalidate every memoized block).
 */
export function validationProjectionKey(document: LocalDocument): string {
  const rules = Array.isArray(document.validations) ? document.validations : [];
  let key = '';
  for (const rule of rules) {
    key += `${rule.nodeId}\u0000${rule.expression}\u0000${rule.message}\u0000`
      + `${(rule.fields ?? []).join(',')}\u0001`;
  }
  key += '\u0002';
  for (const name of Object.keys(document.bindings).sort()) {
    const binding = document.bindings[name];
    key += `${name}\u0000${binding.type}\u0000${(binding.nodeIds ?? []).join(',')}\u0000`
      + `${(binding.options ?? []).join(',')}\u0003`;
  }
  return key;
}

/**
 * Semantic signature of validation results. Each diagnostic is identified by
 * its rule index (matched through the freshly compiled rule ranges, so source
 * offsets may move), then by code and message. This keeps prose shifts stable
 * while still distinguishing "the same message now belongs to another rule".
 */
export function validationDiagnosticKey(
  document: LocalDocument,
  diagnostics: readonly { code: string; message: string; range: { start: number; end: number } }[],
): string {
  const ruleByRange = new Map<string, number>();
  const rules = Array.isArray(document.validations) ? document.validations : [];
  for (let index = 0; index < rules.length; index += 1) {
    const range = rules[index].range;
    ruleByRange.set(`${range.start}:${range.end}`, index);
  }
  return diagnostics
    .map((item) => {
      const rule = ruleByRange.get(`${item.range.start}:${item.range.end}`);
      return `${rule ?? item.range.start}:${item.code}\u0000${item.message}`;
    })
    .join('\u0001');
}

/**
 * The scalar inputs of one memoized block. Everything else a block needs
 * travels through `env` (kept stable by the projections above) and through
 * the runtime subscription.
 */
export interface BlockComparisonInputs {
  readonly node: LocalNode;
  readonly visible: boolean;
  readonly resetToken: number;
  readonly env: unknown;
  readonly depValues: readonly LocalValue[] | null;
}

/**
 * A block subtree re-renders only when the bindings it (or a descendant) reads
 * changed. `null` depValues means the dependencies could not be decided, so
 * the block keeps the pre-memoization behavior of re-rendering on every
 * revision.
 */
export function blockInputsEqual(previous: BlockComparisonInputs, next: BlockComparisonInputs): boolean {
  if (
    previous.node !== next.node ||
    previous.visible !== next.visible ||
    previous.resetToken !== next.resetToken ||
    previous.env !== next.env
  ) {
    return false;
  }
  if (previous.depValues === null || next.depValues === null) return false;
  if (previous.depValues.length !== next.depValues.length) return false;
  for (let index = 0; index < previous.depValues.length; index += 1) {
    if (!Object.is(previous.depValues[index], next.depValues[index])) return false;
  }
  return true;
}
