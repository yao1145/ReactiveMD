import type { LocalConfig, LocalExtensionRequirements, LocalComponentDefinition } from '../sdk/types';
import type { LocalValue, LocalValueKind, SourceRange, LocalHostBindingSchema } from '../contracts/runtime-types';
export type { LocalLocale, LocalValue, LocalValueKind, SourceRange, LocalHostBindingSchema } from '../contracts/runtime-types';
import type { LocalRuntimeServices } from '../runtime-services/runtime';
import type { LocalComponentStateStorage } from '../runtime-services/component-state';
import type { ComponentNetwork, JsonPayload, NetworkConfig } from '../runtime-services/network';

/** A source-level syntax declaration; offsets use original UTF-16 units. */
export interface LocalVersionDeclaration { version: string; range: SourceRange }
/** A scalar, JSON/structured-clone-safe diagnostic template parameter. */
export type LocalDiagnosticParam = string | number | boolean | null;
export type LocalDiagnosticParams = Readonly<Record<string, LocalDiagnosticParam>>;
/** A display issue relative to the formula body, independent of the renderer. */
export interface LocalMathDisplayIssue {
  start: number;
  end: number;
  reason: 'unsupported-command' | 'unsupported-environment' | 'budget' | 'syntax';
  message: string;
  code: string;
  messageKey: string;
  params?: LocalDiagnosticParams;
}
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
  /** Processing stage for host-side filtering and reporting. */
  phase?: 'source' | 'parse' | 'semantic' | 'runtime' | 'worker' | 'resource' | 'export' | 'host';
  /** Whether the affected operation can continue after this diagnostic. */
  recoverable?: boolean;
  /** Bounded, structured values safe to expose to host observers. */
  details?: Readonly<Record<string, string | number | boolean>>;
}
/** Markdown nodes retain their original source ranges; component attributes remain raw decoded strings. */
export interface LocalNode {
  type: string;
  id: string;
  range: SourceRange;
  fallback?: LocalFallbackInfo;
  children?: LocalNode[];
  name?: string;
  attrs?: Record<string, string>;
  /** Component attributes preserve interpolation delimiters as literal text. */
  literalAttributes?: true;
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
  /** Host component shape recorded by the parser from the host schema. */
  hostForm?: 'leaf' | 'inline' | 'container';
  lang?: string;
  align?: ('left' | 'center' | 'right' | null)[];
  /**
   * Normalized footnote identifier shared by `footnoteReference` and
   * `footnoteDefinition` nodes (whitespace collapsed, lowercased).
   */
  identifier?: string;
  /** Original footnote label as written, preserved for display. */
  label?: string;
  /**
   * True for a node created by HTML recovery rather than written in source.
   * Synthetic nodes own no original tag offsets.
   */
  synthetic?: boolean;
  /**
   * Source boundary that justified a synthetic node. Only meaningful together
   * with `synthetic`; it never replaces `range`.
   */
  syntheticBoundary?: SourceRange;
}
/**
 * One structural repair the tolerant parser applied in loose mode. Ranges are
 * original-source UTF-16 half-open intervals: `causeRange` marks the problem
 * and `affectedRange` marks what was actually recovered. Strict compilation
 * never produces records; older results simply omit the field.
 */
export interface LocalRecovery {
  code: string;
  causeRange: SourceRange;
  affectedRange: SourceRange;
  action: 'html-repair' | 'literal-fallback';
  boundary: 'token' | 'fragment' | 'container-end' | 'heading' | 'eof';
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
  /** Kernel value semantics, including ordered generic collections. */
  family?: import('../sdk/types').LocalBindingFamily;
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
/**
 * One host-provided read-only value declared by a top-level `<external>` tag.
 * The record is plain data: the declaration owns no writable binding and is
 * never persisted in a state file.
 */
export interface LocalExternal {
  name: string;
  /** `array` is a string array; `number-array` a finite-number array. */
  type: LocalValueKind;
  /** Canonical id of the declaration node, retained for diagnostics. */
  nodeId: string;
  /** Source range of the declaration tag. */
  range: SourceRange;
}
/** One dynamic constraint expression attached to a control attribute. */
export interface LocalDynamicConstraint {
  /** Expression source between `{{` and `}}`, trimmed. */
  source: string;
  /** Absolute offset of the expression in the document source. */
  offset: number;
  /** Optional schema of the numeric prop supplying this binding bound. */
  numeric?: { min?: number; max?: number; integer?: boolean };
}
/** Dynamic constraints declared by one control, keyed by attribute name. */
export interface LocalDynamicConstraints {
  min?: LocalDynamicConstraint;
  max?: LocalDynamicConstraint;
  required?: LocalDynamicConstraint;
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
/** One serialized runtime value rule lowered from a component manifest. */
export type LocalCompiledValueRule =
  | { kind: 'date'; min?: string; max?: string; required?: string }
  | { kind: 'length'; min?: string; max?: string; email?: string; emailType?: string }
  | { kind: 'required'; required: string }
  | { kind: 'email'; type: string; value: string };

/** One serialized slot order relation, e.g. range start <= end. */
export interface LocalKernelSlotRelation {
  nodeId: string;
  lower: string;
  upper: string;
}

/**
 * Serializable kernel metadata lowered at compile time. Runtime consumers
 * never read manifests; this record carries only bounded plain data.
 */
export interface LocalDocumentKernel {
  valueRules: Readonly<Record<string, readonly LocalCompiledValueRule[]>>;
  slotRelations: readonly LocalKernelSlotRelation[];
  retentionExclusions: readonly string[];
  bindingAttributes?: Readonly<Record<string, { bind: string; initial: string }>>;
  dependencyRules?: Readonly<
    Record<string, {
      selfBinding?: { mode: 'always' | 'attribute'; attribute?: string };
      inlineMathReads?: boolean;
    }>
  >;
}

/**
 * Source generation phase supplied by a streaming host. Omitted keeps the
 * historical final-compilation semantics; `strict` remains an independent
 * structural-recovery switch.
 */
export type LocalSourcePhase = 'streaming' | 'final';
/**
 * Compilation status. `partial` is only produced for an explicit streaming
 * snapshot; final callers that do not opt into phases keep the historical
 * result shape without a `status` field.
 */
export type LocalCompileStatus = 'partial' | 'valid' | 'recovered' | 'failed';

/** Compiler-produced documents contain only plain records, arrays and primitives. */
export interface LocalDocument {
  syntax: 'local';
  source: string;
  /** Whether rendering needs runtime services. Historical documents omit this field. */
  requiresRuntime?: boolean;
  /** Distinct renderable component names in first-use order. Older documents may omit this field. */
  usedComponents?: readonly string[];
  /** Registry fingerprint carried through compilation, Worker cloning and patches. */
  componentConfigKey?: string;
  /** Effective syntax revision; absent on older hand-built runtime documents. */
  syntaxVersion?: 'local-draft-3';
  /**
   * Policy on legacy whole-document HTML results. Mixed-source compilers
   * record author content in `capabilities`.
   */
  html?: LocalHtmlPolicy;
  /** Serializable author content and its compile-time permission ceiling. */
  capabilities?: LocalDocumentCapabilities;
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
   * Host-provided read-only declarations, keyed by name. They participate in
   * expressions and computations but never appear in `bindings`, public
   * parameters or exported state files.
   */
  externals?: Record<string, LocalExternal>;
  /**
   * Node id -> dynamic constraint expressions. Controls such as `number`,
   * `slider`, `date`, `input` and `textarea` use these to evaluate `min`,
   * `max` or `required` against the current state instead of the compile-time
   * value.
   */
  dynamicConstraints?: Record<string, LocalDynamicConstraints>;
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
  /**
   * External SDK components actually used by this document. Present only when
   * an instance configuration contributed at least one used component; the
   * list describes requirements and never carries executable code.
   */
  extensions?: LocalExtensionRequirements;
  /**
   * Component contracts actually used by this document, including default
   * preset manifests. Plain, serializable data; runtime semantics resolve from
   * it with default-preset fallback for older hand-built documents.
   */
  componentDefinitions?: readonly LocalComponentDefinition[];
  /**
   * Serializable component-semantics metadata lowered at compile time. Present
   * only when at least one component contributes a runtime rule, slot relation
   * or retention exclusion. Internal shape; consumers use the runtime API.
   */
  kernel?: LocalDocumentKernel;
}
/** Host-owned budgets for a single compilation. */
export interface LocalCompileLimits {
  /** Positive safe integer; defaults to 10,000 cumulative LocalNode creations. */
  readonly maxSyntaxNodes?: number;
  /**
   * Positive safe integer; defaults to 20,000,000 deterministic parser work
   * units (source scanning plus general Markdown parse submission). Raising it
   * only affects pathological inputs; normal documents stay far below it.
   */
  readonly maxParseWork?: number;
  /**
   * Positive safe integer; defaults to 1,000 nested Markdown container levels
   * (blockquotes and open list levels). Fenced and indented code is ignored.
   */
  readonly maxMarkdownDepth?: number;
  /**
   * Positive safe integer; defaults to 100,000 UTF-16 code units of raw body
   * source per `raw-body` component, counted before common-indent removal and
   * excluding the opener and close tags. Accepts at most 1,000,000.
   */
  readonly maxRawBodyChars?: number;
}
/**
 * Host-owned capability flags for the mixed Markdown and ReactiveMD pipeline.
 */
export interface LocalHtmlOptions {
  /** Allow document styles and component declarations. Defaults to true. */
  readonly enableCss?: boolean;
  /** Allow author JavaScript in interactive mounts. Defaults to false. */
  readonly enableJavaScript?: boolean;
  /** Allow additional native HTML fragments. Defaults to false. */
  readonly enableExtendedHtml?: boolean;
}

/** Resolved document capability flags. */
export interface LocalHtmlPolicy {
  readonly enableCss: boolean;
  readonly enableJavaScript: boolean;
  readonly enableExtendedHtml: boolean;
}

export interface LocalAuthorBlock {
  readonly text: string;
  readonly range: SourceRange;
}

export interface LocalDocumentCapabilities {
  readonly policy: LocalHtmlPolicy;
  readonly styles: readonly LocalAuthorBlock[];
  readonly scripts: readonly LocalAuthorBlock[];
  readonly componentStyles: Readonly<Record<string, string>>;
  readonly actionTargets: Readonly<Record<string, string>>;
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
export type LocalHostComponentForm = 'leaf' | 'inline' | 'container';
/**
 * Optional public binding of a host component. The component accepts `bind`,
 * `initial` and `disabled` attributes implicitly and shares the built-in
 * binding families, so it can pair with `number`, `input` and `toggle`.
 */
export interface LocalHostComponentSchema {
  readonly name: string;
  readonly form: LocalHostComponentForm;
  readonly props: Readonly<Record<string, LocalHostPropSchema>>;
  readonly binding?: LocalHostBindingSchema;
  /**
   * Container body semantics. `markdown` (the default) keeps the existing
   * parsed body; `raw` delivers one lazy `rawBody` child without Markdown,
   * interpolation, entity or tag parsing. Only containers accept it.
   */
  readonly body?: 'markdown' | 'raw';
}

export interface LocalEmbeddingOptions {
  readonly expressions?: 'evaluate' | 'literal';
  readonly onUnsupported?: 'error' | 'fallback';
  readonly allowImages?: boolean;
  readonly allowInteractive?: boolean;
  /** Allow inert `<external slot="name" />` placeholders for host rendering. */
  readonly allowExternalSlots?: boolean;
}

export interface LocalFallbackInfo {
  readonly code: string;
  readonly range: SourceRange;
  readonly reasonKey?: string;
}

export interface LocalCompileOptions extends LocalHtmlOptions {
  readonly embedding?: LocalEmbeddingOptions;
  /** Optional host observer for direct compiler calls. */
  readonly observer?: import('./observability').LocalObserver;
  readonly limits?: LocalCompileLimits;
  /**
   * Render ordinary Markdown soft line breaks as `<br>`.
   *
   * Defaults to `false`, which keeps the historical behavior where a soft
   * break is ordinary collapsible whitespace. When `true`, each source soft
   * break becomes a `break` node; explicit hard breaks, code, formulas and
   * native HTML are left untouched. The source text is never rewritten, so
   * every node keeps its original offsets.
   */
  readonly markdownBreaks?: boolean;
  /** Host-defined leaf components recognized alongside the built-in schema. */
  readonly hostComponents?: readonly LocalHostComponentSchema[];
  /**
   * Instance-level SDK configuration. Cannot be combined with
   * `hostComponents`; external manifests are lowered to the same internal
   * registry shape, while their typed defaults and constraints stay enforced.
   */
  readonly config?: LocalConfig;
  /**
   * Strict structural checking. Defaults to `true`, which keeps the historical
   * behavior. `false` lets the parser recover isolated structural damage and
   * report successful repairs through `recoveries` and bounded warning
   * diagnostics. Unrecoverable semantic, configuration, version and budget
   * errors remain errors. Only booleans are accepted.
   */
  readonly strict?: boolean;
  /**
   * Marks the snapshot as still being generated. Omitted or `final` keeps the
   * historical final-compilation semantics, including `strict` recovery.
   * `streaming` selects provisional rendering and diagnostics; it is not part
   * of the compile identity and must not be used as a structural-recovery
   * switch. Only accepted values are `streaming` and `final`.
   */
  readonly sourcePhase?: LocalSourcePhase;
}
/**
 * Public compiler output is plain data, including nested attributes and
 * dependencies. `status` and `transientDiagnostics` are present only for
 * callers that explicitly supplied a source phase; legacy callers keep the
 * historical shape.
 */
export type LocalCompileResult =
  | {
      ok: true;
      document: LocalDocument;
      diagnostics: Diagnostic[];
      recoveries?: LocalRecovery[];
      status?: Exclude<LocalCompileStatus, 'failed'>;
      /** Fixable issues from a streaming snapshot; never merged into `diagnostics`. */
      transientDiagnostics?: Diagnostic[];
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
      recoveries?: LocalRecovery[];
      status?: 'failed';
      /** Fixable issues observed before a deterministic failure. */
      transientDiagnostics?: Diagnostic[];
    };
/**
 * Frozen state of the current revision. It contains controls, successful
 * computed values and currently available external values. Use
 * `getParameters()` when only writable public parameters are wanted.
 */
export interface LocalSnapshot { revision: number; state: Readonly<Record<string, LocalValue>> }
/** Host-provided initial external values; invalid entries are treated as unavailable. */
export interface LocalRuntimeOptions {
  /** Named channels granted to this document runtime. */
  readonly network?: NetworkConfig;
  /**
   * Initial read-only host values for `<external>` declarations. Declared names
   * without a valid value stay unavailable until a later `setExternalValues`.
   */
  readonly externalValues?: Readonly<Record<string, LocalValue>>;
  /** Stable host identity for component-scoped state. Defaults to the source digest. */
  readonly documentId?: string;
  /** Document-level seed for component randomness. */
  readonly randomSeed?: number;
  /** Component-state sidecar to restore before the first render. */
  readonly componentState?: unknown;
  /**
   * Persistence port for component state. Applied only when the runtime owns
   * its services; omitted keeps state in memory.
   */
  readonly componentStateStorage?: LocalComponentStateStorage;
  /**
   * Coalesce component-state writes. Memory updates immediately; a positive
   * delay writes the stored sidecar at most once per window. Call
   * `runtime.services.state.flush()` when the page is hidden. Defaults to 0
   * (write after every save or clear).
   */
  readonly componentStateWriteDelayMs?: number;
  /**
   * Current semantic configuration key. It is written into component-state
   * snapshots and a restored sidecar must match it or one of
   * `legacyConfigKeys`. Omitted keeps the sidecar identity unverified.
   */
  readonly configKey?: string;
  /** Legacy configuration identities accepted when restoring a sidecar. */
  readonly legacyConfigKeys?: readonly string[];
  /** Inject scheduler/clock/state services; the runtime owns them only when omitted. */
  readonly services?: LocalRuntimeServices;
}
export interface LocalRuntime {
  document: LocalDocument;
  readonly network?: ComponentNetwork;
  /**
   * Runtime-scoped services (clock, scheduler, component state). Hand-built
   * runtimes in tests may omit them; contexts fall back to detached services.
   */
  readonly services?: LocalRuntimeServices;
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
  /** Snapshot of all public parameters; `@...` and external values are excluded. */
  getParameters(): Readonly<Record<string, LocalValue>>;
  /** Project selected public parameters from one revision for a submission. */
  readSubmissionFields?(fields: readonly string[]): LocalSubmissionFieldsResult;
  /** Register a mounted field's validity check until the returned cleanup runs. */
  registerSubmissionField?(node: LocalNode, check: LocalSubmissionFieldCheck): () => void;
  /** Validate and atomically write one public parameter. */
  setParameter(name: string, value: LocalValue): Diagnostic[];
  /** Validate and atomically write one or more public parameters. */
  setParameters(values: Readonly<Record<string, LocalValue>>): Diagnostic[];
  /** Read a declared external value; `undefined` when unavailable or undeclared. */
  getExternal(name: string): LocalValue | undefined;
  /** Frozen record of the currently available external values. */
  getExternalValues(): Readonly<Record<string, LocalValue>>;
  /**
   * Atomically write declared external values. Unknown names, wrong types and
   * budget failures return diagnostics without changing state or revision.
   */
  setExternalValues(values: Readonly<Record<string, LocalValue>>): Diagnostic[];
  evaluate(expression: string): LocalValue;
  /** Current advisory constraint failures; never changes or rejects field state. */
  validate(): Diagnostic[];
  text(template: string): string;
  reset(node: LocalNode): void;
  resetToken(node: LocalNode): number;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
export type LocalSubmissionFieldProblem = 'invalid' | 'required';
export type LocalSubmissionFieldCheck = (value: LocalValue) => LocalSubmissionFieldProblem | undefined;
export type LocalSubmissionFieldsResult =
  | { ok: true; payload: JsonPayload }
  | { ok: false; field: string; reason: 'unavailable' | LocalSubmissionFieldProblem };

export const localKey = (node: LocalNode): string => node.attrs?.bind ?? `@${node.id}`;


/** The local syntax revision accepted and rendered by this build. */
export const LOCAL_SYNTAX_VERSION = 'local-draft-3' as const;
