import type { Diagnostic, LocalCompileResult, LocalDocument, LocalNode, SourceRange } from './types';

/**
 * Wire protocol for incremental compile results.
 *
 * The first successful compile always exchanges the complete source and
 * result while advertising this protocol. Only after the other side has
 * acknowledged it may a request carry a UTF-16 source edit and a response
 * carry a result patch. Legacy peers keep receiving the classic full shapes.
 */
export const LOCAL_RESULT_PATCH_PROTOCOL = 'patch-v1';
export type LocalResultPatchProtocol = typeof LOCAL_RESULT_PATCH_PROTOCOL;

/** A UTF-16 source replacement: keep `[0, from)`, insert, keep `[to, end)`. */
export interface LocalSourceEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** Replacement of one group of document metadata entries. */
export interface LocalRecordPatch {
  readonly set?: Record<string, unknown>;
  readonly remove?: readonly string[];
}

/** Per-node result diff keyed by the compiler-provided stable node id. */
export interface LocalNodePatch {
  readonly id: string;
  /**
   * Complete replacement subtree. Used for nodes that do not exist in the
   * baseline and therefore cannot share any object with it.
   */
  readonly node?: LocalNode;
  /**
   * Node fields (including `range`) except `children`. Omitted for nodes that
   * only shifted or whose children changed.
   */
  readonly data?: Omit<LocalNode, 'children'>;
  /**
   * New ordered child ids. `null` removes a `children` property that the
   * baseline node had; omitted means the baseline child list is unchanged.
   */
  readonly children?: readonly string[] | null;
  /** Uniform UTF-16 range shift relative to the baseline node. */
  readonly shift?: number;
  /**
   * The complete baseline subtree is unchanged apart from a uniform range
   * shift, so no descendant records are needed.
   */
  readonly subtree?: boolean;
}

export type LocalDocumentRecordKey =
  | 'initialState'
  | 'bindings'
  | 'bindingSlots'
  | 'computations'
  | 'dependencies'
  | 'tableShapes';

export interface LocalDocumentPatch {
  readonly source?: LocalSourceEdit;
  readonly removed?: readonly string[];
  readonly values?: Record<string, unknown>;
  /** Root node ids in document order, when the root list changed. */
  readonly roots?: readonly string[];
  readonly nodes?: readonly LocalNodePatch[];
  readonly records?: Partial<Record<LocalDocumentRecordKey, LocalRecordPatch>>;
}

export interface LocalResultPatch {
  readonly kind: 'result-patch';
  readonly protocol: LocalResultPatchProtocol;
  readonly document: LocalDocumentPatch;
  readonly diagnostics?: Diagnostic[];
}

const RECORD_KEYS: readonly LocalDocumentRecordKey[] = [
  'initialState',
  'bindings',
  'bindingSlots',
  'computations',
  'dependencies',
  'tableShapes',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRange(value: unknown): value is SourceRange {
  return isRecord(value)
    && typeof value.start === 'number' && Number.isFinite(value.start)
    && typeof value.end === 'number' && Number.isFinite(value.end);
}

function invalidPatch(): never {
  throw new TypeError('Invalid local compile result patch');
}

/** Structural equality for the plain, acyclic values produced by the compiler. */
export function localDataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  const leftArray = Array.isArray(left);
  if (leftArray !== Array.isArray(right)) return false;
  if (leftArray) {
    const a = left as unknown[];
    const b = right as unknown[];
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!localDataEqual(a[index], b[index])) return false;
    }
    return true;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !localDataEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Independent deep copy of compiler output. Unlike a structured clone it
 * preserves `undefined` properties and never carries frozen markers into the
 * copy, so a consumer mutating a delivered result cannot reach the scheduler's
 * internal baseline.
 */
export function cloneLocalCompileResult<T>(value: T): T {
  const seen = new Map<object, unknown>();
  const visit = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    const object = input as object;
    const cached = seen.get(object);
    if (cached !== undefined) return cached;
    const output: Record<string, unknown> | unknown[] = Array.isArray(input) ? [] : {};
    seen.set(object, output);
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      Object.defineProperty(output, key, {
        value: visit(child),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  };
  return visit(value) as T;
}

/** Longest-common-prefix/suffix UTF-16 edit from `before` to `after`. */
export function diffSourceEdit(before: string, after: string): LocalSourceEdit | null {
  if (typeof before !== 'string' || typeof after !== 'string') return null;
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let from = 0;
  while (from < limit && before.charCodeAt(from) === after.charCodeAt(from)) from += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > from
    && afterEnd > from
    && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return { from, to: beforeEnd, insert: after.slice(from, afterEnd) };
}

function readSourceEdit(value: unknown): LocalSourceEdit | null {
  if (!isRecord(value)) return null;
  const { from, to, insert } = value;
  if (
    typeof from !== 'number' || !Number.isSafeInteger(from)
    || typeof to !== 'number' || !Number.isSafeInteger(to)
    || typeof insert !== 'string'
    || from < 0 || to < from
  ) {
    return null;
  }
  return { from, to, insert };
}

/** Apply a UTF-16 edit, returning null when the edit does not fit the source. */
export function applySourceEdit(source: string, edit: LocalSourceEdit): string | null {
  const parsed = readSourceEdit(edit);
  if (parsed === null || typeof source !== 'string') return null;
  if (parsed.to > source.length) return null;
  return source.slice(0, parsed.from) + parsed.insert + source.slice(parsed.to);
}

function nodeFields(node: LocalNode): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'children') fields[key] = value;
  }
  return fields;
}

function sameFields(left: LocalNode, right: LocalNode): boolean {
  const leftKeys = Object.keys(left).filter((key) => key !== 'children');
  const rightKeys = Object.keys(right).filter((key) => key !== 'children');
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) return false;
    if (!localDataEqual((left as unknown as Record<string, unknown>)[key], (right as unknown as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

function childIds(node: LocalNode): string[] | undefined {
  return node.children === undefined ? undefined : node.children.map((child) => child.id);
}

function sameChildIds(left: LocalNode, right: LocalNode): boolean {
  const a = childIds(left);
  const b = childIds(right);
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function subtreeUnchanged(next: LocalNode, base: LocalNode): boolean {
  if (!sameFields(next, base) || !sameChildIds(next, base)) return false;
  if (!next.children || !base.children) return true;
  for (let index = 0; index < next.children.length; index += 1) {
    if (!subtreeUnchanged(next.children[index], base.children[index])) return false;
  }
  return true;
}

/** Uniform range shift for a whole subtree, or null when anything else differs. */
function subtreeShift(next: LocalNode, base: LocalNode): number | null {
  const nextKeys = Object.keys(next).filter((key) => key !== 'children' && key !== 'range');
  const baseKeys = Object.keys(base).filter((key) => key !== 'children' && key !== 'range');
  if (nextKeys.length !== baseKeys.length) return null;
  for (const key of nextKeys) {
    if (!Object.hasOwn(base, key)) return null;
    if (!localDataEqual((next as unknown as Record<string, unknown>)[key], (base as unknown as Record<string, unknown>)[key])) {
      return null;
    }
  }
  if (!isRange(next.range) || !isRange(base.range)) return null;
  const delta = next.range.start - base.range.start;
  if (next.range.end !== base.range.end + delta) return null;
  const a = childIds(next);
  const b = childIds(base);
  if (a === undefined || b === undefined) {
    if (a !== b) return null;
  } else {
    if (a.length !== b.length) return null;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return null;
      if (subtreeShift(next.children![index], base.children![index]) !== delta) return null;
    }
  }
  return delta;
}

/** Uniform shift of the range only, when every other field is identical. */
function rangeShift(next: LocalNode, base: LocalNode): number | null {
  const nextKeys = Object.keys(next).filter((key) => key !== 'children' && key !== 'range');
  const baseKeys = Object.keys(base).filter((key) => key !== 'children' && key !== 'range');
  if (nextKeys.length !== baseKeys.length) return null;
  for (const key of nextKeys) {
    if (!Object.hasOwn(base, key)) return null;
    if (!localDataEqual((next as unknown as Record<string, unknown>)[key], (base as unknown as Record<string, unknown>)[key])) {
      return null;
    }
  }
  if (!isRange(next.range) || !isRange(base.range)) return null;
  const delta = next.range.start - base.range.start;
  return next.range.end === base.range.end + delta ? delta : null;
}

function indexNodes(nodes: readonly LocalNode[]): Map<string, LocalNode> {
  const index = new Map<string, LocalNode>();
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    index.set(node.id, node);
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
    }
  }
  return index;
}

function collectNodePatches(
  node: LocalNode,
  base: LocalNode | undefined,
  baseIndex: Map<string, LocalNode>,
  out: LocalNodePatch[],
): void {
  if (base !== undefined && subtreeUnchanged(node, base)) return;
  if (base === undefined) {
    // A new node cannot share any object with the baseline; send its subtree.
    out.push({ id: node.id, node });
    return;
  }
  const delta = subtreeShift(node, base);
  if (delta !== null) {
    if (delta !== 0) out.push({ id: node.id, shift: delta, subtree: true });
    return;
  }
  const record: {
    id: string;
    data?: Omit<LocalNode, 'children'>;
    children?: readonly string[] | null;
    shift?: number;
  } = { id: node.id };
  if (!sameFields(node, base)) {
    const shift = rangeShift(node, base);
    if (shift !== null && shift !== 0) record.shift = shift;
    else record.data = nodeFields(node) as unknown as Omit<LocalNode, 'children'>;
  }
  if (!sameChildIds(node, base)) {
    record.children = node.children === undefined ? null : node.children.map((child) => child.id);
  }
  const insertionPoint = out.length;
  if (node.children) {
    for (const child of node.children) collectNodePatches(child, baseIndex.get(child.id), baseIndex, out);
  }
  if (Object.keys(record).length > 1) {
    out.splice(insertionPoint, 0, record);
  } else if (out.length > insertionPoint) {
    // The node itself did not change, but a descendant did. Re-resolve its
    // children so the applied tree cannot keep the stale baseline child.
    out.splice(insertionPoint, 0, { id: node.id });
  }
}

function diffRecord(base: unknown, next: Record<string, unknown>): LocalRecordPatch | null {
  if (!isRecord(base)) return { set: next };
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (!Object.hasOwn(base, key) || !localDataEqual(base[key], value)) set[key] = value;
  }
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(next, key)) remove.push(key);
  }
  if (Object.keys(set).length === 0 && remove.length === 0) return null;
  return {
    ...(Object.keys(set).length === 0 ? {} : { set }),
    ...(remove.length === 0 ? {} : { remove }),
  };
}

/**
 * Encode `next` relative to `base`. Returns null when a patch is impossible
 * (for example a failed result), in which case the caller must send the full
 * result. Only changed roots/nodes and changed metadata entries are present;
 * unchanged objects are addressed by their stable ids.
 */
export function encodeLocalResultPatch(base: LocalCompileResult, next: LocalCompileResult): LocalResultPatch | null {
  try {
    if (!base.ok || !next.ok) return null;
    const baseDocument = base.document;
    const nextDocument = next.document;
    if (!isRecord(baseDocument) || !isRecord(nextDocument)) return null;
    const document: {
      source?: LocalSourceEdit;
      removed?: string[];
      values?: Record<string, unknown>;
      roots?: readonly string[];
      nodes?: readonly LocalNodePatch[];
      records?: Partial<Record<LocalDocumentRecordKey, LocalRecordPatch>>;
    } = {};
    if (typeof baseDocument.source === 'string' && typeof nextDocument.source === 'string') {
      const edit = diffSourceEdit(baseDocument.source, nextDocument.source);
      if (edit !== null) document.source = edit;
    } else if (baseDocument.source !== nextDocument.source) {
      return null;
    }

    const removed: string[] = [];
    const values: Record<string, unknown> = {};
    const records: Partial<Record<LocalDocumentRecordKey, LocalRecordPatch>> = {};
    const recordKeys = new Set<string>(RECORD_KEYS);
    const keys = new Set([...Object.keys(baseDocument), ...Object.keys(nextDocument)]);
    for (const key of keys) {
      if (key === 'source' || key === 'nodes' || recordKeys.has(key)) continue;
      const hasNext = Object.hasOwn(nextDocument, key) && nextDocument[key] !== undefined;
      const hasBase = Object.hasOwn(baseDocument, key) && baseDocument[key] !== undefined;
      if (!hasNext) {
        if (hasBase) removed.push(key);
        continue;
      }
      if (!hasBase || !localDataEqual(baseDocument[key], nextDocument[key])) {
        values[key] = nextDocument[key];
      }
    }
    for (const key of RECORD_KEYS) {
      const hasNext = Object.hasOwn(nextDocument, key) && nextDocument[key] !== undefined;
      const hasBase = Object.hasOwn(baseDocument, key) && baseDocument[key] !== undefined;
      const baseValue = hasBase ? baseDocument[key] : undefined;
      const nextValue = hasNext ? nextDocument[key] : undefined;
      if (!hasNext) {
        if (hasBase) removed.push(key);
        continue;
      }
      if (!isRecord(nextValue)) {
        if (!hasBase || !localDataEqual(baseValue, nextValue)) values[key] = nextValue;
        continue;
      }
      if (!hasBase) {
        records[key] = { set: nextValue };
        continue;
      }
      if (!isRecord(baseValue)) {
        values[key] = nextValue;
        continue;
      }
      const record = diffRecord(baseValue, nextValue);
      if (record !== null) records[key] = record;
    }

    const baseNodes = Array.isArray(baseDocument.nodes) ? baseDocument.nodes : [];
    const nextNodes = Array.isArray(nextDocument.nodes) ? nextDocument.nodes : [];
    const baseRoots = baseNodes.map((node) => node.id);
    const nextRoots = nextNodes.map((node) => node.id);
    let rootsChanged = baseRoots.length !== nextRoots.length;
    if (!rootsChanged) {
      for (let index = 0; index < baseRoots.length; index += 1) {
        if (baseRoots[index] !== nextRoots[index]) {
          rootsChanged = true;
          break;
        }
      }
    }
    const nodePatches: LocalNodePatch[] = [];
    const baseIndex = indexNodes(baseNodes);
    for (const node of nextNodes) collectNodePatches(node, baseIndex.get(node.id), baseIndex, nodePatches);
    if (rootsChanged) document.roots = nextRoots;
    if (nodePatches.length > 0) document.nodes = nodePatches;
    if (removed.length > 0) document.removed = removed;
    if (Object.keys(values).length > 0) document.values = values;
    if (Object.keys(records).length > 0) document.records = records;

    return {
      kind: 'result-patch',
      protocol: LOCAL_RESULT_PATCH_PROTOCOL,
      document,
      ...(localDataEqual(base.diagnostics, next.diagnostics) ? {} : { diagnostics: next.diagnostics }),
    };
  } catch {
    return null;
  }
}

function shiftSubtree(node: LocalNode, delta: number): LocalNode {
  const fields = nodeFields(node);
  if (!isRange(fields.range)) invalidPatch();
  fields.range = { start: (fields.range as SourceRange).start + delta, end: (fields.range as SourceRange).end + delta };
  if (node.children) fields.children = node.children.map((child) => shiftSubtree(child, delta));
  return fields as unknown as LocalNode;
}

function isNodeLike(value: unknown): value is LocalNode {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.type === 'string'
    && isRange(value.range);
}

function applyRecordPatch(base: unknown, patch: unknown): Record<string, unknown> {
  if (!isRecord(patch)) invalidPatch();
  if (patch.set !== undefined && !isRecord(patch.set)) invalidPatch();
  if (patch.remove !== undefined && !Array.isArray(patch.remove)) invalidPatch();
  const output: Record<string, unknown> = {};
  if (isRecord(base)) {
    for (const [key, value] of Object.entries(base)) {
      Object.defineProperty(output, key, { value, enumerable: true, configurable: true, writable: true });
    }
  } else if (base !== undefined) {
    invalidPatch();
  }
  if (patch.set) {
    for (const [key, value] of Object.entries(patch.set)) {
      Object.defineProperty(output, key, {
        value: cloneLocalCompileResult(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  if (patch.remove) {
    for (const key of patch.remove as unknown[]) {
      if (typeof key !== 'string') invalidPatch();
      delete output[key];
    }
  }
  return output;
}

/**
 * Apply a result patch to a baseline without mutating it. Unchanged nodes are
 * reused by reference; changed, added and shifted nodes become new objects.
 * Malformed or stale patches return null so the caller can request a full
 * result instead of trusting partial data.
 */
export function applyLocalResultPatch(base: LocalCompileResult, patch: LocalResultPatch): LocalCompileResult | null {
  try {
    if (!base.ok || !isRecord(patch)) return null;
    if (patch.kind !== 'result-patch' || patch.protocol !== LOCAL_RESULT_PATCH_PROTOCOL) return null;
    const documentPatch = patch.document;
    if (!isRecord(documentPatch)) return null;
    const baseDocument = base.document;
    if (!isRecord(baseDocument)) return null;

    const document: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(baseDocument)) {
      Object.defineProperty(document, key, { value, enumerable: true, configurable: true, writable: true });
    }

    if (documentPatch.removed !== undefined) {
      if (!Array.isArray(documentPatch.removed)) return null;
      for (const key of documentPatch.removed) {
        if (typeof key !== 'string' || key === 'nodes' || key === 'source') return null;
        delete document[key];
      }
    }
    if (documentPatch.values !== undefined) {
      if (!isRecord(documentPatch.values)) return null;
      for (const [key, value] of Object.entries(documentPatch.values)) {
        if (key === 'nodes' || key === 'source') return null;
        Object.defineProperty(document, key, {
          value: cloneLocalCompileResult(value),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    if (documentPatch.records !== undefined) {
      if (!isRecord(documentPatch.records)) return null;
      for (const key of Object.keys(documentPatch.records)) {
        if (!(RECORD_KEYS as readonly string[]).includes(key)) return null;
        const recordPatch = documentPatch.records[key as LocalDocumentRecordKey];
        if (recordPatch === undefined) continue;
        document[key] = applyRecordPatch(baseDocument[key], recordPatch);
      }
    }

    let source = typeof baseDocument.source === 'string' ? baseDocument.source : null;
    if (source === null) return null;
    if (documentPatch.source !== undefined) {
      const edit = readSourceEdit(documentPatch.source);
      if (edit === null) return null;
      const edited = applySourceEdit(source, edit);
      if (edited === null) return null;
      source = edited;
    }
    document.source = source;

    const baseNodes = Array.isArray(baseDocument.nodes) ? baseDocument.nodes as LocalNode[] : [];
    const baseIndex = indexNodes(baseNodes);
    const patchById = new Map<string, LocalNodePatch>();
    if (documentPatch.nodes !== undefined) {
      if (!Array.isArray(documentPatch.nodes)) return null;
      for (const entry of documentPatch.nodes) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || patchById.has(entry.id)) return null;
        patchById.set(entry.id, entry as unknown as LocalNodePatch);
      }
    }

    let roots: string[];
    if (documentPatch.roots !== undefined) {
      if (!Array.isArray(documentPatch.roots)) return null;
      roots = [];
      for (const id of documentPatch.roots) {
        if (typeof id !== 'string') return null;
        roots.push(id);
      }
    } else {
      roots = baseNodes.map((node) => node.id);
    }

    const cache = new Map<string, LocalNode>();
    const applying = new Set<string>();
    const resolve = (id: string): LocalNode => {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      if (applying.has(id)) invalidPatch();
      const record = patchById.get(id);
      const baseNode = baseIndex.get(id);
      if (record === undefined) {
        if (baseNode === undefined) invalidPatch();
        cache.set(id, baseNode);
        return baseNode;
      }
      if (!isRecord(record)) invalidPatch();
      if (record.node !== undefined) {
        if (record.data !== undefined || record.children !== undefined || record.shift !== undefined || record.subtree) {
          invalidPatch();
        }
        if (!isNodeLike(record.node) || record.node.id !== id) invalidPatch();
        const replacement = cloneLocalCompileResult(record.node);
        cache.set(id, replacement);
        return replacement;
      }
      if (baseNode === undefined && record.data === undefined) invalidPatch();
      if (record.subtree !== undefined && record.subtree !== true) invalidPatch();
      if (record.shift !== undefined && (!Number.isSafeInteger(record.shift))) invalidPatch();
      if (record.data !== undefined && record.shift !== undefined) invalidPatch();
      if (record.children !== undefined && record.children !== null) {
        if (!Array.isArray(record.children) || record.children.some((child) => typeof child !== 'string')) {
          invalidPatch();
        }
      }
      applying.add(id);
      let output: LocalNode;
      if (record.subtree === true) {
        if (baseNode === undefined || record.shift === undefined || record.data !== undefined || record.children !== undefined) {
          invalidPatch();
        }
        output = shiftSubtree(baseNode, record.shift);
      } else {
        let fields: Record<string, unknown>;
        if (record.data !== undefined) {
          if (!isRecord(record.data)) invalidPatch();
          fields = cloneLocalCompileResult(record.data) as unknown as Record<string, unknown>;
          delete fields.children;
          if (fields.id !== id) invalidPatch();
        } else {
          if (baseNode === undefined) invalidPatch();
          fields = nodeFields(baseNode);
          if (record.shift !== undefined) {
            if (!isRange(fields.range)) invalidPatch();
            fields.range = {
              start: (fields.range as SourceRange).start + record.shift,
              end: (fields.range as SourceRange).end + record.shift,
            };
          }
        }
        let nextChildIds: string[] | null | undefined;
        if (record.children !== undefined) {
          nextChildIds = record.children === null ? null : [...record.children];
        } else {
          const baseChildren = baseNode?.children;
          nextChildIds = baseChildren === undefined ? undefined : baseChildren.map((child) => child.id);
        }
        if (nextChildIds === null) delete fields.children;
        else if (nextChildIds !== undefined) fields.children = nextChildIds.map(resolve);
        output = fields as unknown as LocalNode;
      }
      applying.delete(id);
      cache.set(id, output);
      return output;
    };

    const nodes = roots.map(resolve);
    document.nodes = documentPatch.roots === undefined && documentPatch.nodes === undefined
      ? baseDocument.nodes
      : nodes;
    const diagnostics = patch.diagnostics === undefined
      ? base.diagnostics
      : (Array.isArray(patch.diagnostics) ? cloneLocalCompileResult(patch.diagnostics) : invalidPatch());
    return { ok: true, document: document as unknown as LocalDocument, diagnostics };
  } catch {
    return null;
  }
}
