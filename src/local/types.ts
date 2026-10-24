export interface SourceRange { start: number; end: number }
/** A scalar, JSON/structured-clone-safe diagnostic template parameter. */
export type LocalDiagnosticParam = string | number | boolean | null;
export type LocalDiagnosticParams = Readonly<Record<string, LocalDiagnosticParam>>;
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  range: SourceRange;
  line: number;
  column: number;
  /**
   * Stable template key for a built-in message. Omitted for host-owned
   * diagnostics, whose `message` is preserved verbatim by display code.
   */
  messageKey?: string;
  /** Bounded scalar parameters for `messageKey`. */
  params?: LocalDiagnosticParams;
}
export type LocalValue = string | number | boolean | null | string[] | number[];
/** `array` retains its existing meaning: a homogeneous string array. */
export type LocalValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'number-array';
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
/**
 * One read-only document value declared by a top-level `<computed>` or
 * `<const>` tag. The record is plain, serializable metadata: the declaring
 * node is not part of the rendered tree and owns no writable binding.
 */
export interface LocalComputation {
  name: string;
  kind: 'computed' | 'const';
  /** Expression source between `{{` and `}}`, trimmed. */
  source: string;
  /** Names read by the expression, in first-use order. */
  dependencies: string[];
  type: LocalValueKind;
  /** Canonical id of the declaration node, retained for host diagnostics. */
  nodeId: string;
  /** Source range of the declaration tag. */
  range: SourceRange;
  /**
   * Statically evaluated value. Present only for `const`, whose expression
   * cannot depend on controls or computed values.
   */
  value?: LocalValue;
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
/** Advisory cross-field rule; an invalid rule keeps its fields editable. */
export interface LocalValidation {
  nodeId: string;
  expression: string;
  dependencies: string[];
  message: string;
  fields: string[];
  range: SourceRange;
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
  /**
   * Read-only values declared with top-level `<computed>` / `<const>` tags,
   * keyed by name. These are document metadata, not components: declaration
   * nodes are removed from `nodes` before publication and never own bindings.
   */
  computations?: Record<string, LocalComputation>;
  /** Cross-field constraints in source order; evaluated against each revision. */
  validations?: LocalValidation[];
  /**
   * Node id -> subtree binding dependencies, produced by the compiler. `null`
   * marks subtrees whose reads cannot be decided statically. Internal shape:
   * consumers should read it through the package runtime rather than depend on
   * the serialized form.
   */
  dependencies?: Readonly<Record<string, readonly string[] | null>>;
  /**
   * Node id -> table structure for `<table>`, `<chart>` and `<timeline>`
   * contents, produced by the compiler. Header cells are plain text and data
   * rows list the ids of their cell nodes. Frozen and serializable: it holds no
   * node references. Internal shape; readers should tolerate its absence.
   */
  tableShapes?: Readonly<
    Record<string, { readonly header: readonly string[]; readonly rowIds: readonly (readonly string[])[] }>
  >;
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
  /** Sorted public binding names; internal @... bindings are excluded. */
  parameterNames(): readonly string[];
  /** Read a public parameter by binding name. Returns undefined for unknown/internal names. */
  getParameter(name: string): LocalValue | undefined;
  /** Snapshot of all public parameters; internal @... bindings are excluded. */
  getParameters(): Readonly<Record<string, LocalValue>>;
  /** Validate and atomically write one public parameter. */
  setParameter(name: string, value: LocalValue): Diagnostic[];
  /** Validate and atomically write one or more public parameters. */
  setParameters(values: Readonly<Record<string, LocalValue>>): Diagnostic[];
  evaluate(expression: string): LocalValue;
  /** Current advisory constraint failures; never changes or rejects field state. */
  validate(): Diagnostic[];
  text(template: string): string;
  reset(node: LocalNode): void;
  resetToken(node: LocalNode): number;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
export const localKey = (node: LocalNode): string => node.attrs?.bind ?? `@${node.id}`;
