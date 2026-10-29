import type { LocalNode } from './types';

/**
 * Conservative row-level node reuse for flat Markdown lists and tables.
 *
 * The incremental compiler still parses the block that contains the edit, so
 * the parser remains the only semantic authority. This module only replaces a
 * freshly parsed row subtree with the previous revision's subtree when:
 *
 * - the block is exactly one `list` or `table` whose children are all flat,
 *   single-line `listItem` / `tableRow` nodes, and
 * - the previous and next row have byte-identical source text, and
 * - the whole subtree (type, non-id fields and row-relative ranges) is equal.
 *
 * When the row's absolute start did not move the previous object is returned
 * as-is. Otherwise it is cloned with every range shifted; shifted nodes can
 * never be the same object because their ranges differ. IDs are always kept,
 * so unchanged rows keep a stable identity across revisions.
 */

export type RowKind = 'item' | 'row';

export interface RowBlock {
  /** Block text in the document, exactly as stored by the incremental snapshot. */
  text: string;
  /** Compiled-coordinate origin: `node.range.start - origin` is the text offset. */
  origin: number;
  /** Top-level block nodes in compiled coordinates. */
  nodes: readonly LocalNode[];
}

export interface RowReuseOutcome {
  /** Top-level nodes with substitutable rows replaced. */
  nodes: LocalNode[];
  /** Number of row subtrees taken from the previous revision. */
  reused: number;
  kind: RowKind;
  /** IDs owned by the previous revision's dependency map. */
  reusedIds: Set<string>;
}

interface FlatRow {
  text: string;
  node: LocalNode;
}

interface FlatBlock {
  kind: RowKind;
  parent: LocalNode;
  rows: FlatRow[];
}

function flatRows(block: RowBlock): FlatBlock | undefined {
  if (block.nodes.length !== 1) return;
  const parent = block.nodes[0];
  let kind: RowKind;
  let childType: string;
  if (parent.type === 'list') {
    kind = 'item';
    childType = 'listItem';
  } else if (parent.type === 'table') {
    kind = 'row';
    childType = 'tableRow';
  } else {
    return;
  }
  const children = parent.children ?? [];
  if (!children.length) return;
  const rows: FlatRow[] = [];
  for (const node of children) {
    if (node.type !== childType) return;
    const start = node.range.start - block.origin;
    const end = node.range.end - block.origin;
    if (!Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end > block.text.length || end <= start) return;
    const text = block.text.slice(start, end);
    // Flat rows must never span a continuation line. Nested lists, fences and
    // multi-line table cells therefore fall back to a normal compile.
    if (text.includes('\n') || text.includes('\r')) return;
    rows.push({text, node});
  }
  return {kind, parent, rows};
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * Compare a previous and a fresh row subtree. `aBase`/`bBase` are the two row
 * starts; every range is compared relative to them, so an unchanged row at a
 * new offset still matches. IDs are intentionally ignored.
 */
function sameSubtree(a: LocalNode, b: LocalNode, aBase: number, bBase: number): boolean {
  if (a.type !== b.type) return false;
  if (a.range.start - aBase !== b.range.start - bBase) return false;
  if (a.range.end - aBase !== b.range.end - bBase) return false;
  const keys = Object.keys(a);
  const otherKeys = Object.keys(b);
  if (keys.length !== otherKeys.length) return false;
  for (const key of keys) {
    if (key === 'id' || key === 'range' || key === 'children') continue;
    if (!Object.hasOwn(b, key)) return false;
    if (!deepEqual((a as unknown as Record<string, unknown>)[key], (b as unknown as Record<string, unknown>)[key])) return false;
  }
  const aChildren = a.children ?? [];
  const bChildren = b.children ?? [];
  if (aChildren.length !== bChildren.length) return false;
  for (let index = 0; index < aChildren.length; index++) {
    if (!sameSubtree(aChildren[index], bChildren[index], aBase, bBase)) return false;
  }
  return true;
}

/** Clone a subtree with shifted ranges, preserving every id. */
function shiftNode(node: LocalNode, delta: number): LocalNode {
  const copy: LocalNode = {
    ...node,
    range: {start: node.range.start + delta, end: node.range.end + delta},
  };
  if (node.attrs) copy.attrs = {...node.attrs};
  if (node.align) copy.align = [...node.align];
  if (node.children) copy.children = node.children.map((child) => shiftNode(child, delta));
  return copy;
}

function collectIds(node: LocalNode, out: Set<string>): void {
  out.add(node.id);
  if (node.children) for (const child of node.children) collectIds(child, out);
}

/**
 * Align rows with a common prefix/suffix by exact source text, then substitute
 * only rows whose freshly parsed subtree is structurally identical. Duplicate
 * rows are safe because both matches have identical text; a misalignment can
 * only reduce reuse, never change the result.
 *
 * Returns `undefined` when nothing can be reused, so callers can keep the
 * fresh parse untouched.
 */
export function reuseFlatRows(previous: RowBlock | undefined, next: RowBlock): RowReuseOutcome | undefined {
  if (!previous) return;
  const before = flatRows(previous);
  const after = flatRows(next);
  if (!before || !after || before.kind !== after.kind) return;

  const oldRows = before.rows;
  const newRows = after.rows;
  const shared = Math.min(oldRows.length, newRows.length);
  let prefix = 0;
  while (prefix < shared && oldRows[prefix].text === newRows[prefix].text) prefix += 1;
  let suffix = 0;
  while (suffix < shared - prefix
    && oldRows[oldRows.length - 1 - suffix].text === newRows[newRows.length - 1 - suffix].text) suffix += 1;
  if (prefix === 0 && suffix === 0) return;

  const reusedIds = new Set<string>();
  let reused = 0;
  const children = newRows.map((row, index) => {
    let oldIndex: number | undefined;
    if (index < prefix) oldIndex = index;
    else if (index >= newRows.length - suffix) oldIndex = oldRows.length - (newRows.length - index);
    if (oldIndex === undefined) return row.node;
    const oldRow = oldRows[oldIndex];
    if (!sameSubtree(oldRow.node, row.node, oldRow.node.range.start, row.node.range.start)) return row.node;
    const delta = row.node.range.start - oldRow.node.range.start;
    // Position unchanged: share the exact object. Position shifted: clone the
    // subtree with accurate UTF-16 ranges (identity cannot be shared).
    const replacement = delta === 0 ? oldRow.node : shiftNode(oldRow.node, delta);
    reused += 1;
    collectIds(replacement, reusedIds);
    return replacement;
  });
  if (!reused) return;

  // Keep the container's previous id as well. This is what lets the
  // publication pass match the block against the previous revision by id and
  // retain unchanged child objects instead of cloning the whole block.
  const parent: LocalNode = {...after.parent, id: before.parent.id, children};
  reusedIds.add(before.parent.id);
  return {nodes: [parent], reused, kind: after.kind, reusedIds};
}
