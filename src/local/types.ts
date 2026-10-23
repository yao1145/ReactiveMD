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
  /** Upper bound for array selections such as `multi-select`. */
  maxItems?: number;
  owner?: string;
}
export interface LocalDocument {
  syntax: 'local';
  source: string;
  nodes: LocalNode[];
  initialState: Record<string, LocalValue>;
  bindings: Record<string, LocalBinding>;
  /**
   * Selected theme name. Themes are document metadata, not components: the
   * compiler always supplies the built-in `default` when no declaration is
   * present, and the renderer resolves the name against host-supplied CSS.
   */
  theme?: string;
  /** Original source range of the leading `<theme ...>` declaration. */
  themeRange?: SourceRange;
  /**
   * Canonical node id -> slot -> binding key for multi-slot components such as
   * `range-slider` (`start`/`end`) and `coordinate` (`x`/`y`). Renderers use
   * runtime `get`/`set`/`setMany` with slot names instead of reading this map.
   */
  bindingSlots?: Record<string, Record<string, string>>;
}
/** Host-owned budgets for a single compilation. */
export interface LocalCompileLimits {
  /** Positive safe integer; defaults to 10,000 cumulative LocalNode creations. */
  readonly maxSyntaxNodes?: number;
}
export interface LocalCompileOptions {
  readonly limits?: LocalCompileLimits;
}
export type LocalCompileResult = { ok: true; document: LocalDocument; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };
export interface LocalSnapshot { revision: number; state: Readonly<Record<string, LocalValue>> }
export interface LocalRuntime {
  document: LocalDocument;
  snapshot(): LocalSnapshot;
  /** Read a control value; `slot` is required for multi-slot components. */
  get(node: LocalNode, slot?: string): LocalValue;
  /** Write one control value; `slot` selects `start`/`end` or `x`/`y`. */
  set(node: LocalNode, value: LocalValue, slot?: string): Diagnostic[];
  /** Atomically write multiple slots of one multi-slot component. */
  setMany(node: LocalNode, values: Readonly<Record<string, LocalValue>>): Diagnostic[];
  evaluate(expression: string): LocalValue;
  text(template: string): string;
  reset(node: LocalNode): void;
  resetToken(node: LocalNode): number;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
export const localKey = (node: LocalNode): string => node.attrs?.bind ?? `@${node.id}`;
