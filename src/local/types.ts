export interface SourceRange { start: number; end: number }
/** A source-level syntax declaration; offsets use original UTF-16 units. */
export interface LocalVersionDeclaration { version: string; range: SourceRange }
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
  /** Rendered width of an HTML `<img>`, in CSS pixels. */
  width?: number;
  /** Rendered height of an HTML `<img>`, in CSS pixels. */
  height?: number;
  lang?: string;
  align?: ('left' | 'center' | 'right' | null)[];
  /**
   * Normalized footnote identifier shared by `footnoteReference` and
   * `footnoteDefinition` nodes (whitespace collapsed, lowercased).
   */
  identifier?: string;
  /** Original footnote label as written, preserved for display. */
  label?: string;
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
  /** Effective syntax revision; absent on older hand-built runtime documents. */
  syntaxVersion?: 'local-draft-2';
  /**
   * Present only when at least one HTML capability flag was enabled. Its
   * presence routes rendering to the isolated native-HTML branch; the
   * original source is preserved and `nodes` carries one `htmlDocument` node
   * whose `value` is the sanitized, complete iframe document.
   */
  html?: LocalHtmlPolicy;
  versionDeclaration?: LocalVersionDeclaration;
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
/**
 * Host-owned capability flags for the temporary whole-document HTML mode.
 *
 * All flags default to `false`. When every flag is false the existing
 * Markdown/ReactiveMD pipeline runs unchanged. When any flag is true the whole
 * source is interpreted as native HTML and rendered inside a sandboxed iframe;
 * Markdown, interpolation, bindings, formulas and ReactiveMD components are not
 * interpreted in that mode.
 */
export interface LocalHtmlOptions {
  /** Allow authored CSS; external resources remain subject to the native CSP. */
  readonly enableCss?: boolean;
  /** Allow authored scripts and inline event handlers. */
  readonly enableJavaScript?: boolean;
  /** Allow HTML beyond the safe P0 subset (tables, forms, SVG/MathML, ...). */
  readonly enableExtendedHtml?: boolean;
}

/** Effective, non-optional policy recorded on a compiled HTML-branch document. */
export interface LocalHtmlPolicy {
  readonly enableCss: boolean;
  readonly enableJavaScript: boolean;
  readonly enableExtendedHtml: boolean;
}

export type LocalHostPropKind = 'string' | 'number' | 'boolean' | 'enum';
export interface LocalHostPropSchema {
  readonly kind: LocalHostPropKind;
  readonly required?: boolean;
  /** Reject `{{ ... }}` in this property. */
  readonly static?: boolean;
  /** Allowed literals for kind 'enum'; required and non-empty for enums. */
  readonly enum?: readonly string[];
  /** RegExp source applied to literal string values; restricted to a linear-time-safe subset. */
  readonly pattern?: string;
}
export interface LocalHostComponentSchema {
  readonly name: string;
  readonly form: 'leaf';
  readonly props: Readonly<Record<string, LocalHostPropSchema>>;
}

export interface LocalCompileOptions extends LocalHtmlOptions {
  readonly limits?: LocalCompileLimits;
  /** Host-defined leaf components recognized alongside the built-in schema. */
  readonly hostComponents?: readonly LocalHostComponentSchema[];
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
