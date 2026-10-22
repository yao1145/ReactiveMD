export interface SourceRange { start: number; end: number }
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  range: SourceRange;
  line: number;
  column: number;
}
export type LocalValue = string | number | boolean | null | string[];
export type LocalValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array';
/** Markdown nodes retain their original source ranges; component attributes remain raw decoded strings. */
export interface LocalNode {
  type: string;
  id: string;
  range: SourceRange;
  children?: LocalNode[];
  name?: string;
  attrs?: Record<string, string>;
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  url?: string;
  title?: string | null;
  alt?: string;
  lang?: string;
  align?: ('left' | 'center' | 'right' | null)[];
}
export interface LocalBinding {
  name: string;
  nodeIds: string[];
  type: LocalValueKind;
  initial: LocalValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  owner?: string;
}
export interface LocalDocument {
  syntax: 'local';
  source: string;
  nodes: LocalNode[];
  initialState: Record<string, LocalValue>;
  bindings: Record<string, LocalBinding>;
}
export type LocalCompileResult = { ok: true; document: LocalDocument; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };
export interface LocalSnapshot { revision: number; state: Readonly<Record<string, LocalValue>> }
export interface LocalRuntime {
  document: LocalDocument;
  snapshot(): LocalSnapshot;
  get(node: LocalNode): LocalValue;
  set(node: LocalNode, value: LocalValue): Diagnostic[];
  evaluate(expression: string): LocalValue;
  text(template: string): string;
  reset(node: LocalNode): void;
  resetToken(node: LocalNode): number;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
export const localKey = (node: LocalNode): string => node.attrs?.bind ?? `@${node.id}`;
