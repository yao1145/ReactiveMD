import type { CompiledDocument, Diagnostic, DocumentNode, SourceRange } from './types';

export interface DocumentMeta {
  nodeById: Map<string, DocumentNode>;
  /** Range of each computed expression's YAML value. */
  computedRanges: Map<string, SourceRange>;
  /** Range of each dynamic component property: `${componentId}:${prop}`. */
  propRanges: Map<string, SourceRange>;
  /** Range of each action's YAML value. */
  actionRanges: Map<string, SourceRange>;
  /** Range used for errors that cannot be tied to a more precise node. */
  rootRange: SourceRange;
}

const metaStore = new WeakMap<CompiledDocument, DocumentMeta>();

export function setDocumentMeta(document: CompiledDocument, meta: DocumentMeta): void {
  metaStore.set(document, meta);
}

export function getDocumentMeta(document: CompiledDocument): DocumentMeta | undefined {
  return metaStore.get(document);
}

export function indexNodes(nodes: DocumentNode[], map = new Map<string, DocumentNode>()): Map<string, DocumentNode> {
  for (const node of nodes) {
    map.set(node.id, node);
    if (node.children) indexNodes(node.children, map);
  }
  return map;
}

/** Convert a UTF-16 offset into a 1-based line/column pair. */
export function positionAt(source: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

export function makeDiagnostic(
  source: string,
  code: string,
  message: string,
  range: SourceRange,
  severity: 'error' | 'warning' = 'error',
): Diagnostic {
  const start = Math.max(0, Math.min(range.start, source.length));
  const end = Math.max(start, Math.min(range.end, source.length));
  const { line, column } = positionAt(source, start);
  return { code, message, severity, range: { start, end }, line, column };
}

export function rangeOrRoot(meta: DocumentMeta | undefined, range: SourceRange | undefined): SourceRange {
  return range ?? meta?.rootRange ?? { start: 0, end: 0 };
}
