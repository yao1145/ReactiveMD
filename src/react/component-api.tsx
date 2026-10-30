import {
  type ComponentType,
  type ReactNode,
} from 'react';
import type {
  Diagnostic,
  LocalNode,
  LocalRuntime,
  LocalSnapshot,
  LocalValue,
  SourceRange,
} from '../local/types';
import type {
  LocalRenderMode,
  LocalSourceTarget,
} from '../local/render-types';
import type { LocalUrlPolicy } from '../local/LocalDocumentView';
import type { LocalLocale, Localize } from '../local/i18n';
import type { LocalBindingFamily } from '../local/schema';
import { localComponentDigest } from '../sdk/manifest';
import { resolveLocalComponentProp } from '../sdk/props';
import type {
  LocalComponentDefinition,
  LocalComponentRequirement,
} from '../sdk/types';
import type { LocalExtensionRequirements } from '../sdk/types';

/* ------------------------------------------------------------------ values */

/** A public component value. Arrays are the immutable collection form. */
export type LocalComponentValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[];

/** @deprecated phase-one alias; scalar-only views can keep using it. */
export type LocalComponentPropValue = string | number | boolean | null;

export interface LocalComponentSetResult {
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
}

export interface LocalComponentBindingHandle {
  get(): LocalComponentValue;
  set(next: LocalComponentValue): LocalComponentSetResult;
}

/* --------------------------------------------------------------- content */

/**
 * Normalized content projection handed to builtin and external components.
 *
 * This is deliberately not `LocalNode`: it carries only identity, the
 * component name, resolved props, explicitly requested raw attributes, plain
 * text/format and projected children. The adapter keeps the internal node
 * behind an opaque symbol that no component implementation can read.
 */
export interface LocalComponentContent {
  readonly id: string;
  /** `'component'` or the Markdown/content kind (text, table, list, math, ...). */
  readonly kind: string;
  /** Component tag name for `kind: 'component'`, otherwise an empty string. */
  readonly name: string;
  readonly form?: 'leaf' | 'inline' | 'container';
  readonly props: Readonly<Record<string, LocalComponentValue>>;
  /** Raw authored attributes, available only when a view explicitly asks. */
  readonly attrs: Readonly<Record<string, string>>;
  /** Current binding value of this node (null when it owns no binding). */
  readonly value: LocalComponentValue;
  /** Plain text for Markdown text/leaf nodes and math source. */
  readonly text: string;
  /** Markdown/content format marker (`math`, `inlineMath`, code language, ...). */
  readonly format?: string;
  readonly visible: boolean;
  readonly children: readonly LocalComponentContent[];
  readonly range: Readonly<SourceRange>;
}

/** Adapter-only mapping from a public projection to the kernel node. */
const CONTENT_NODE = Symbol('reactive-md.content-node');

export function readContentNode(content: LocalComponentContent): LocalNode {
  return (content as unknown as { [CONTENT_NODE]: LocalNode })[CONTENT_NODE];
}

function attachNode(content: LocalComponentContent, node: LocalNode): LocalComponentContent {
  Object.defineProperty(content, CONTENT_NODE, {
    value: node,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(content);
}

/* --------------------------------------------------------------- tables */

export type LocalComponentTableCellKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'null'
  | 'array'
  | 'empty'
  | 'error';

export interface LocalComponentTableCell {
  readonly text: string;
  readonly value: LocalValue | undefined;
  readonly kind: LocalComponentTableCellKind;
  readonly numeric: number | null;
  readonly error: string | null;
  readonly render: () => ReactNode;
}

export interface LocalComponentTableProjection {
  readonly header: readonly LocalComponentTableCell[];
  readonly headerText: readonly string[];
  readonly rows: readonly {
    readonly index: number;
    readonly cells: readonly LocalComponentTableCell[];
  }[];
}

/* ---------------------------------------------------------- child helpers */

export interface LocalComponentOption {
  readonly value: string;
  readonly content: LocalComponentContent;
  readonly label: string;
  render(): ReactNode;
}

export interface LocalComponentField {
  readonly describedBy?: string;
  readonly invalid: boolean;
}

export interface LocalComponentHint {
  readonly id: string;
  readonly failed: boolean;
  readonly error: boolean;
  readonly message: string;
}

/* --------------------------------------------------------------- services */

export interface LocalComponentRuntime {
  /** Opaque identity shared by components using the same document runtime. */
  readonly identity: object;
  get(item: LocalComponentContent, slot?: string): LocalComponentValue;
  set(
    item: LocalComponentContent,
    next: LocalComponentValue,
    slot?: string,
  ): Diagnostic[];
  setMany(
    item: LocalComponentContent,
    values: Readonly<Record<string, LocalComponentValue>>,
  ): Diagnostic[];
  reset(item: LocalComponentContent): void;
  resetToken(item: LocalComponentContent): number;
  evaluate(expression: string): LocalComponentValue;
  snapshot(): LocalSnapshot;
  validate(): Diagnostic[];
  text(template: string): string;
}

export interface LocalComponentChildrenApi {
  render(): ReactNode;
  inline(): ReactNode;
  text(): string;
  items(): readonly LocalComponentContent[];
  /** Render a projected child list as blocks. */
  renderItems(items: readonly LocalComponentContent[], visible?: boolean): ReactNode;
  /** Render a projected child list as inline content. */
  renderInlineItems(items: readonly LocalComponentContent[], visible?: boolean): ReactNode;
  /** Plain text of a projected child list (interpolations evaluated). */
  textOf(items: readonly LocalComponentContent[]): string;
  options(): readonly LocalComponentOption[];
  table(): LocalComponentTableProjection | null;
  math(): readonly LocalComponentContent[];
}

export interface LocalComponentNavigationApi {
  targetId(to: string): string | undefined;
  anchorId(): string | undefined;
  /** Host URL policy check for an internal jump target. */
  allowed(to: string): boolean;
  /** Focus and scroll to an anchor; returns why it failed otherwise. */
  jump(to: string): 'ok' | 'missing' | 'hidden';
}

export interface LocalComponentUrlApi {
  resolve(raw: string | undefined, kind: 'image' | 'link'): string | null;
  image(raw: string | undefined): string | null;
}

export interface LocalComponentLocaleApi {
  readonly locale: LocalLocale;
  t(en: string, zh: string): string;
  formatNumber(value: number): string;
}

/** Context passed to every SDK component. It contains no AST. */
export interface LocalComponentContext {
  readonly props: Readonly<Record<string, LocalComponentValue>>;
  readonly content: LocalComponentContent;
  readonly bindings: {
    readonly value: LocalComponentBindingHandle;
    readonly slots: Readonly<Record<string, LocalComponentBindingHandle>>;
    readonly isReadOnly: boolean;
    get(name?: string): LocalComponentValue;
    set(name: string, next: LocalComponentValue): LocalComponentSetResult;
    setMany(values: Readonly<Record<string, LocalComponentValue>>): LocalComponentSetResult;
  };
  readonly children: LocalComponentChildrenApi;
  readonly runtime: LocalComponentRuntime;
  readonly instance: LocalComponentInstance;
  readonly mode: LocalRenderMode;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly disabledInvalid: boolean;
  readonly resetToken: number;
  readonly validation: {
    fieldFor(item: LocalComponentContent): LocalComponentField;
    hintFor(item: LocalComponentContent): LocalComponentHint | null;
  };
  readonly source: {
    attributes(item?: LocalComponentContent): Record<string, string>;
  };
  readonly navigation: LocalComponentNavigationApi;
  readonly url: LocalComponentUrlApi;
  readonly locale: LocalComponentLocaleApi;
  report(diagnostics: Diagnostic[]): void;
}

export interface LocalComponentInstance {
  readonly id: string;
  readonly componentId: string;
  readonly range: Readonly<SourceRange>;
}

export type LocalComponentRender = ComponentType<LocalComponentContext>;

export interface LocalReactComponentImplementation {
  render: LocalComponentRender;
  renderStatic?: LocalComponentRender;
}

export interface LocalReactComponent extends LocalReactComponentImplementation {
  readonly definition: LocalComponentDefinition;
  readonly digest: string;
}

export interface LocalReactPreset {
  readonly id: string;
  readonly version: string;
  readonly components: readonly LocalReactComponent[];
}

/* ------------------------------------------------------- adapter host API */

/**
 * Host surface used by the adapter to construct public contexts. It exposes
 * internal nodes only to `component-api`, never to component implementations.
 */
export interface LocalComponentAdapterEnvironment {
  readonly runtime: LocalRuntime;
  readonly mode: LocalRenderMode;
  readonly locale: LocalLocale;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly disabledInvalid: boolean;
  readonly resetToken: number;
  readonly definitionFor: (name: string) => LocalComponentDefinition | undefined;
  readonly validationFieldFor: (node: LocalNode) => LocalComponentField;
  readonly validationHintFor: (node: LocalNode) => LocalComponentHint | null;
  readonly sourceAttributes: (
    node: LocalNode,
    componentName?: string,
  ) => Record<string, string>;
  readonly renderChildren: (
    nodes: LocalNode[] | undefined,
    visible: boolean,
    block?: boolean,
  ) => ReactNode;
  readonly renderInline: (nodes: LocalNode[] | undefined, visible: boolean) => ReactNode;
  readonly renderToText: (nodes: LocalNode[] | undefined) => string;
  readonly report: (diagnostics: Diagnostic[]) => void;
  /** Optional source position for adapter-owned diagnostics. */
  readonly positionOf?: (offset: number) => { line: number; column: number };
  readonly targetId: (to: string) => string | undefined;
  readonly anchorId: (node: LocalNode) => string | undefined;
  readonly jumpAllowed: (to: string) => boolean;
  readonly jumpTo: (target: string) => 'ok' | 'missing' | 'hidden';
  readonly urlPolicy?: LocalUrlPolicy;
  readonly imageResolver?: (url: string) => string | null;
}

/* -------------------------------------------------------- prop resolution */

const FULL_INTERPOLATION = /^\s*\{\{([\s\S]*)\}\}\s*$/;
const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function hasInterpolation(raw: string): boolean {
  for (let index = 0; index < raw.length - 1; index += 1) {
    if (raw[index] === '\\') {
      index += 1;
      continue;
    }
    if (raw[index] === '{' && raw[index + 1] === '{') return true;
  }
  return false;
}

function scalarText(value: LocalValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

export function formatComponentNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Object.is(value, -0)) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-4)) {
    return value
      .toExponential(3)
      .replace(/(\.\d*?)0+e/, '$1e')
      .replace(/\.e/, 'e');
  }
  return Number(value.toFixed(6)).toString();
}

/** Public values are immutable; kernel arrays are copied on the way out. */
export function publicComponentValue(
  value: LocalValue | undefined,
): LocalComponentValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.slice()) as LocalComponentValue;
  }
  return value === undefined ? null : value;
}

/** Copy a public array before handing it to the kernel. */
function kernelValue(value: LocalComponentValue): LocalValue {
  return (Array.isArray(value) ? value.slice() : value) as LocalValue;
}

type LenientPropRead =
  | { ok: true; value: LocalComponentValue }
  | { ok: false; error: unknown };

/**
 * Render-time prop read. Compile-time validation is kernel-owned; this helper
 * only re-derives the already validated value and keeps a failed dynamic prop
 * representable (null) instead of failing the whole component subtree, which
 * preserves the legacy visible field-error behavior. The failure is reported
 * separately by `resolveComponentProps`.
 */
function readPropValue(
  definition: LocalComponentDefinition,
  name: string,
  raw: string | undefined,
  runtime: LocalRuntime,
): LenientPropRead {
  try {
    return { ok: true, value: resolveLocalComponentProp(definition, name, raw, runtime) };
  } catch (error) {
    return { ok: false, error };
  }
}

export interface PropFailureSink {
  readonly environment: LocalComponentAdapterEnvironment;
  /** Minimal adapter-side identity; not an AST handle. */
  readonly node: {
    readonly id: string;
    readonly name?: string;
    readonly range: SourceRange;
  };
}

/** Last reported failure signature per runtime/node/prop for interactive renders. */
const propFailureState = new WeakMap<object, Map<string, string>>();
/** Static-mode failures are deduplicated only within one render pass. */
const staticPropFailureState = new WeakMap<object, Map<string, string>>();

/**
 * Start one document render pass. Static rendering clears its per-pass prop
 * diagnostic memory so a later independent render still reports, while
 * nested contexts in the same pass do not duplicate the same failure.
 */
export function beginLocalComponentRender(runtime: LocalRuntime): void {
  staticPropFailureState.delete(runtimeIdentity(runtime));
}

interface PendingPropReport {
  diagnostics: Diagnostic[];
  scheduled: boolean;
  report: (diagnostics: Diagnostic[]) => void;
}

const pendingPropReports = new WeakMap<object, PendingPropReport>();
const MAX_PROP_FAILURE_ENTRIES = 4096;
const MAX_PENDING_PROP_DIAGNOSTICS = 512;

function runtimeIdentity(runtime: LocalRuntime): object {
  let identity = runtimeIdentities.get(runtime);
  if (!identity) {
    identity = Object.freeze({});
    runtimeIdentities.set(runtime, identity);
  }
  return identity;
}

function propFailureDiagnostic(
  sink: PropFailureSink,
  name: string,
  error: unknown,
): Diagnostic {
  const { environment, node } = sink;
  const position = environment.positionOf?.(node.range.start) ?? { line: 1, column: 1 };
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: 'local.component.prop',
    message: `Component <${node.name ?? node.id}> prop "${name}" is invalid: ${detail}`,
    severity: 'error',
    range: { start: node.range.start, end: node.range.end },
    line: position.line,
    column: position.column,
  };
}

/**
 * Deliver prop diagnostics without calling the host during an interactive
 * React render. Server rendering (no DOM) reports synchronously so strict SSR
 * and static export can fail on the same pass; browsers batch into one
 * microtask to avoid setState-during-render warnings and report floods.
 */
function deliverPropDiagnostics(
  environment: LocalComponentAdapterEnvironment,
  identity: object,
  diagnostics: Diagnostic[],
): void {
  if (diagnostics.length === 0) return;
  if (typeof window === 'undefined') {
    environment.report(diagnostics);
    return;
  }
  let pending = pendingPropReports.get(identity);
  if (!pending) {
    pending = { diagnostics: [], scheduled: false, report: environment.report };
    pendingPropReports.set(identity, pending);
  }
  const entry: PendingPropReport = pending;
  entry.report = environment.report;
  for (const diagnostic of diagnostics) {
    if (entry.diagnostics.length >= MAX_PENDING_PROP_DIAGNOSTICS) break;
    entry.diagnostics.push(diagnostic);
  }
  if (entry.scheduled) return;
  entry.scheduled = true;
  const flush = () => {
    entry.scheduled = false;
    const items = entry.diagnostics.splice(0);
    if (items.length > 0) entry.report(items);
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(flush);
  else setTimeout(flush, 0);
}

export function resolveComponentProps(
  definition: LocalComponentDefinition | undefined,
  attrs: Readonly<Record<string, string>> | undefined,
  runtime: LocalRuntime,
  failure?: PropFailureSink,
): Record<string, LocalComponentValue> {
  if (!definition) return {};
  const attributes = attrs ?? {};
  const output: Record<string, LocalComponentValue> = {};
  // Browser static-first renders keep diagnostics stable across parent state
  // updates. Only independent server passes reset static diagnostic memory.
  const staticMode = failure?.environment.mode === 'static' && typeof window === 'undefined';
  const trackFailures = failure !== undefined;
  const identity = failure ? runtimeIdentity(runtime) : null;
  let state: Map<string, string> | null = null;
  if (failure && identity && trackFailures) {
    const store = staticMode ? staticPropFailureState : propFailureState;
    state = store.get(identity) ?? null;
    if (!state) {
      state = new Map();
      store.set(identity, state);
    } else if (state.size > MAX_PROP_FAILURE_ENTRIES) {
      state.clear();
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const name of Object.keys(definition.props)) {
    const raw = Object.hasOwn(attributes, name) && typeof attributes[name] === 'string'
      ? attributes[name]
      : undefined;
    const read = readPropValue(definition, name, raw, runtime);
    if (read.ok) {
      output[name] = read.value;
      if (failure && state) state.delete(`${failure.node.id}\u0000${name}`);
      continue;
    }
    output[name] = null;
    if (!failure) continue;
    if (state) {
      const base = `${failure.node.id}\u0000${name}`;
      const signature = `${raw ?? ''}\u0000${
        read.error instanceof Error ? read.error.message : String(read.error)
      }`;
      if (state.get(base) === signature) continue;
      state.set(base, signature);
    }
    diagnostics.push(propFailureDiagnostic(failure, name, read.error));
  }
  if (failure && identity) deliverPropDiagnostics(failure.environment, identity, diagnostics);
  return output;
}


/* --------------------------------------------------------------- adapter */

function readBindingSlots(
  definition: LocalComponentDefinition | undefined,
): Readonly<Record<string, { bind?: string; initial?: string }>> {
  const bindings = (definition as unknown as {
    bindings?: Readonly<Record<string, { bind?: string; initial?: string }>>;
  })?.bindings;
  return bindings ?? {};
}

function projectionFor(
  node: LocalNode,
  environment: LocalComponentAdapterEnvironment,
  visible: boolean,
  cache: Map<LocalNode, LocalComponentContent>,
): LocalComponentContent {
  const cached = cache.get(node);
  if (cached) return cached;
  const isComponent = node.type === 'component' || node.type === 'hostComponent';
  const definition = isComponent ? environment.definitionFor(node.name ?? '') : undefined;
  const props = isComponent
    ? Object.freeze(resolveComponentProps(definition, node.attrs, environment.runtime, {
        environment,
        node,
      }))
    : Object.freeze({});
  const children = (node.children ?? []).map((child) =>
    projectionFor(child, environment, visible, cache),
  );
  let value: LocalComponentValue = null;
  if (isComponent) {
    try {
      value = publicComponentValue(environment.runtime.get(node));
    } catch {
      value = null;
    }
  } else if (node.type === 'interpolation') {
    try {
      value = publicComponentValue(environment.runtime.evaluate(node.value ?? ''));
    } catch {
      value = null;
    }
  }
  const content: LocalComponentContent = {
    id: node.id,
    kind: isComponent ? 'component' : node.type,
    name: isComponent ? (node.name ?? '') : '',
    ...(isComponent && definition ? { form: definition.form } : {}),
    props,
    attrs: Object.freeze({ ...(node.attrs ?? {}) }),
    value,
    text: typeof node.value === 'string' ? node.value : '',
    ...(node.lang !== undefined
      ? { format: node.lang }
      : node.type === 'math' || node.type === 'inlineMath'
        ? { format: node.type }
        : {}),
    visible,
    children: Object.freeze(children),
    range: Object.freeze({ start: node.range.start, end: node.range.end }),
  };
  const attached = attachNode(content, node);
  cache.set(node, attached);
  return attached;
}

const runtimeIdentities = new WeakMap<LocalRuntime, object>();

function contentRuntime(
  runtime: LocalRuntime,
  mode: LocalRenderMode,
  report: (diagnostics: Diagnostic[]) => void,
): LocalComponentRuntime {
  const readOnly = mode === 'static';
  let identity = runtimeIdentities.get(runtime);
  if (!identity) { identity = Object.freeze({}); runtimeIdentities.set(runtime, identity); }
  const nodeOf = readContentNode;
  const writeResult = (diagnostics: Diagnostic[]): Diagnostic[] => {
    if (diagnostics.length > 0) report(diagnostics);
    return diagnostics;
  };
  const failure = (
    item: LocalComponentContent,
    error: unknown,
  ): Diagnostic[] => {
    const range = { start: item.range.start, end: item.range.end };
    return [{
      code: 'local.extension.write',
      message: `Component <${item.name || item.id}> write failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      severity: 'error',
      range,
      line: 1,
      column: 1,
    }];
  };
  return Object.freeze({
    identity,
    get(item: LocalComponentContent, slot?: string): LocalComponentValue {
      return publicComponentValue(runtime.get(nodeOf(item), slot === 'value' ? undefined : slot));
    },
    set(item: LocalComponentContent, next: LocalComponentValue, slot?: string): Diagnostic[] {
      if (readOnly) return failure(item, new Error('Runtime is read-only in static mode.'));
      try {
        return writeResult(runtime.set(nodeOf(item), kernelValue(next), slot === 'value' ? undefined : slot));
      } catch (error) {
        return failure(item, error);
      }
    },
    setMany(
      item: LocalComponentContent,
      values: Readonly<Record<string, LocalComponentValue>>,
    ): Diagnostic[] {
      if (readOnly) return failure(item, new Error('Runtime is read-only in static mode.'));
      try {
        const copied: Record<string, LocalValue> = {};
        for (const [name, value] of Object.entries(values)) copied[name] = kernelValue(value);
        return writeResult(runtime.setMany(nodeOf(item), copied));
      } catch (error) {
        return failure(item, error);
      }
    },
    reset(item: LocalComponentContent): void {
      if (readOnly) return;
      try {
        runtime.reset(nodeOf(item));
      } catch {
        /* A disposed runtime has no state to restore. */
      }
    },
    resetToken(item: LocalComponentContent): number {
      try {
        return runtime.resetToken(nodeOf(item));
      } catch {
        return 0;
      }
    },
    evaluate(expression: string): LocalComponentValue {
      return publicComponentValue(runtime.evaluate(expression));
    },
    snapshot(): LocalSnapshot {
      try {
        const snapshot = runtime.snapshot();
        const state: Record<string, LocalValue> = {};
        for (const [name, value] of Object.entries(snapshot.state)) {
          state[name] = publicComponentValue(value) as LocalValue;
        }
        return { revision: snapshot.revision, state: Object.freeze(state) };
      } catch {
        return { revision: 0, state: {} };
      }
    },
    validate(): Diagnostic[] {
      try {
        return runtime.validate();
      } catch {
        return [];
      }
    },
    text(template: string): string {
      try {
        return runtime.text(template);
      } catch {
        return '';
      }
    },
  });
}

function bindingHandle(
  runtime: LocalComponentRuntime,
  node: LocalComponentContent,
  slot: string,
  readOnly: boolean,
): LocalComponentBindingHandle {
  return Object.freeze({
    get: (): LocalComponentValue => {
      try {
        return runtime.get(node, slot);
      } catch {
        return null;
      }
    },
    set: (next: LocalComponentValue): LocalComponentSetResult => {
      if (readOnly) return { ok: false, diagnostics: [] };
      const diagnostics = runtime.set(node, next, slot);
      return { ok: diagnostics.length === 0, diagnostics };
    },
  });
}

function readOptions(
  content: LocalComponentContent,
  environment: LocalComponentAdapterEnvironment,
): LocalComponentOption[] {
  const options: LocalComponentOption[] = [];
  const children = content.children;
  const definition = environment.definitionFor(content.name);
  const rule = definition?.rules?.find(rule => rule.kind === 'options-body');
  const childName = rule?.kind === 'options-body' ? rule.child : definition?.structure?.child ?? 'option';
  const valueAttribute = rule?.kind === 'options-body' ? rule.valueAttribute : definition?.structure?.valueAttribute ?? 'value';
  let optionIndex = 0;
  for (const child of children) {
    if (child.kind !== 'component' || child.name !== childName) continue;
    const node = readContentNode(child);
    const value = child.attrs[valueAttribute] ?? `option-${optionIndex + 1}`;
    optionIndex += 1;
    const label = environment.renderToText(node.children) || child.attrs[valueAttribute] || '';
    options.push(Object.freeze({
      value,
      content: child,
      label,
      render: () => environment.renderInline(node.children, content.visible),
    }));
  }
  return options;
}

function tableCellNode(
  node: LocalNode,
  environment: LocalComponentAdapterEnvironment,
): LocalComponentTableCell {
  const children = node.children ?? [];
  const significant = children.filter(
    (child) => !(child.type === 'text' && !(child.value ?? '').trim()),
  );
  let value: LocalValue | undefined;
  let kind: LocalComponentTableCellKind = 'empty';
  let text = '';
  let numeric: number | null = null;
  let error: string | null = null;
  if (significant.length === 1 && significant[0].type === 'interpolation') {
    try {
      value = environment.runtime.evaluate(significant[0].value ?? '');
      const scalar = scalarText(value);
      if (value === null) {
        kind = 'null';
        text = '';
      } else if (typeof value === 'string') {
        kind = 'string';
        text = value;
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          kind = 'error';
          text = environment.locale === 'zh' ? '无法计算' : 'Cannot compute';
          error = environment.locale === 'zh' ? '结果不是有限数字' : 'Result is not a finite number';
        } else {
          kind = 'number';
          text = formatComponentNumber(value);
          numeric = value;
        }
      } else if (typeof value === 'boolean') {
        kind = 'boolean';
        text = value ? 'true' : 'false';
      } else {
        kind = 'array';
        text = scalar ?? '';
        error = environment.locale === 'zh'
          ? '数组需要先用 len 等函数转换'
          : 'Arrays must first be converted with a function such as len';
      }
    } catch (cause) {
      kind = 'error';
      text = environment.locale === 'zh' ? '无法计算' : 'Cannot compute';
      error = cause instanceof Error ? cause.message : String(cause);
    }
  } else {
    let collected = '';
    let collectedError: string | null = null;
    const walk = (nodes: LocalNode[] | undefined): void => {
      for (const child of nodes ?? []) {
        if (child.type === 'text' || child.type === 'inlineCode' || child.type === 'code') {
          collected += child.value ?? '';
          continue;
        }
        if (child.type === 'interpolation') {
          try {
            const evaluated = environment.runtime.evaluate(child.value ?? '');
            const scalar = scalarText(evaluated);
            if (scalar === null) {
              collectedError ??= environment.locale === 'zh'
                ? '数组需要先用 len 等函数转换'
                : 'Arrays must first be converted with a function such as len';
            } else {
              collected += scalar;
            }
          } catch (cause) {
            collectedError ??= cause instanceof Error ? cause.message : String(cause);
            collected += environment.locale === 'zh' ? '无法计算' : 'Cannot compute';
          }
          continue;
        }
        if (child.type === 'inlineMath' || child.type === 'math') {
          collected += child.value ?? '';
          continue;
        }
        if (child.type === 'image') {
          collected += child.alt ?? '';
          continue;
        }
        if (child.children && child.children.length > 0) {
          walk(child.children);
          continue;
        }
        if (child.value) collected += child.value;
      }
    };
    walk(children);
    const plainText = significant.length > 0 && significant.every((child) => child.type === 'text');
    const trimmed = collected.trim();
    if (plainText && NUMBER_TEXT.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        kind = 'number';
        text = collected;
        numeric = parsed;
        value = parsed;
      }
    }
    if (kind === 'empty') {
      if (collectedError) {
        kind = 'error';
        text = environment.locale === 'zh' ? '无法计算' : 'Cannot compute';
        error = collectedError;
      } else {
        kind = trimmed === '' ? 'empty' : 'string';
        text = collected;
        value = collected;
      }
    }
  }
  const cell: LocalComponentTableCell = Object.freeze({
    text,
    value,
    kind,
    numeric,
    error,
    render: () => environment.renderInline(children, true),
  });
  return cell;
}

function buildTableProjection(
  content: LocalComponentContent,
  environment: LocalComponentAdapterEnvironment,
): LocalComponentTableProjection | null {
  const table = content.children.find((child) => child.kind === 'table');
  if (!table) return null;
  const tableNode = readContentNode(table);
  const rows = (tableNode.children ?? []).filter((child) => child.type === 'tableRow');
  if (rows.length === 0) return null;
  const header = (rows[0].children ?? []).map((cell) => tableCellNode(cell, environment));
  return Object.freeze({
    header: Object.freeze(header),
    headerText: Object.freeze(header.map((cell) =>
      cell.error
        ? (environment.locale === 'zh' ? '无法计算' : 'Cannot compute')
        : cell.text,
    )),
    rows: Object.freeze(rows.slice(1).map((row, index) => Object.freeze({
      index,
      cells: Object.freeze((row.children ?? []).map((cell) => tableCellNode(cell, environment))),
    }))),
  });
}

/**
 * Build the public context for one component node. Called by the renderer;
 * external implementations receive exactly this object.
 */
export function createLocalComponentContext(
  node: LocalNode,
  environment: LocalComponentAdapterEnvironment,
): LocalComponentContext {
  const definition = environment.definitionFor(node.name ?? '');
  const cache = new Map<LocalNode, LocalComponentContent>();
  const content = projectionFor(node, environment, environment.visible, cache);
  const runtime = contentRuntime(environment.runtime, environment.mode, environment.report);
  const readOnly = environment.mode === 'static';
  const slots = readBindingSlots(definition);
  const handles: Record<string, LocalComponentBindingHandle> = {};
  for (const slot of Object.keys(slots)) {
    handles[slot] = bindingHandle(runtime, content, slot, readOnly);
  }
  const valueHandle = handles.value ?? Object.freeze({
    get: (): LocalComponentValue => null,
    set: (): LocalComponentSetResult => ({ ok: false, diagnostics: [] }),
  });
  const children: LocalComponentChildrenApi = Object.freeze({
    render: () => environment.renderChildren(node.children, environment.visible),
    inline: () => environment.renderInline(node.children, environment.visible),
    text: () => environment.renderToText(node.children),
    items: () => content.children,
    renderItems: (items: readonly LocalComponentContent[], visible?: boolean) =>
      environment.renderChildren(
        items.map((item) => readContentNode(item)),
        visible ?? environment.visible,
      ),
    renderInlineItems: (items: readonly LocalComponentContent[], visible?: boolean) =>
      environment.renderInline(
        items.map((item) => readContentNode(item)),
        visible ?? environment.visible,
      ),
    textOf: (items: readonly LocalComponentContent[]) =>
      environment.renderToText(items.map((item) => readContentNode(item))),
    options: () => readOptions(content, environment),
    table: () => buildTableProjection(content, environment),
    math: () => content.children.filter(
      (child) => child.kind === 'math' || child.kind === 'inlineMath',
    ),
  });
  const bindings = Object.freeze({
    value: valueHandle,
    slots: Object.freeze(handles),
    isReadOnly: readOnly,
    get(name = 'value'): LocalComponentValue {
      const handle = handles[name];
      return handle ? handle.get() : null;
    },
    set(name: string, next: LocalComponentValue): LocalComponentSetResult {
      const handle = handles[name];
      if (!handle) {
        return {
          ok: false,
          diagnostics: [{
            code: 'local.extension.binding',
            message: `Component <${content.name || content.id}> has no binding slot "${name}".`,
            severity: 'error',
            range: content.range,
            line: 1,
            column: 1,
          }],
        };
      }
      return handle.set(next);
    },
    setMany(values: Readonly<Record<string, LocalComponentValue>>): LocalComponentSetResult {
      if (readOnly) return { ok: false, diagnostics: [] };
      const diagnostics = runtime.setMany(content, values);
      return { ok: diagnostics.length === 0, diagnostics };
    },
  });
  const validation = Object.freeze({
    fieldFor: (item: LocalComponentContent): LocalComponentField =>
      environment.validationFieldFor(readContentNode(item)),
    hintFor: (item: LocalComponentContent): LocalComponentHint | null =>
      environment.validationHintFor(readContentNode(item)),
  });
  const navigation: LocalComponentNavigationApi = Object.freeze({
    targetId: (to: string) => environment.targetId(to),
    anchorId: () => environment.anchorId(node),
    allowed: (to: string) => environment.jumpAllowed(to),
    jump: (to: string) => {
      const target = environment.targetId(to);
      if (target === undefined) return 'missing';
      return environment.jumpTo(target);
    },
  });
  const url: LocalComponentUrlApi = Object.freeze({
    resolve(raw: string | undefined, kind: 'image' | 'link'): string | null {
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const normalized = trimmed.replace(/[\u0000- ]+/g, '');
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
      if (scheme) {
        const name = scheme[1].toLowerCase();
        const allowed = kind === 'image'
          ? name === 'http' || name === 'https'
          : name === 'http' || name === 'https' || name === 'mailto' || name === 'tel';
        if (!allowed) return null;
      }
      if (!environment.urlPolicy) return kind === 'image' ? null : trimmed;
      try {
        return environment.urlPolicy(trimmed, kind) ? trimmed : null;
      } catch {
        return null;
      }
    },
    image(raw: string | undefined): string | null {
      const accepted = url.resolve(raw, 'image');
      if (!accepted) return null;
      if (!environment.imageResolver) return accepted;
      try {
        const mapped = environment.imageResolver(accepted);
        return typeof mapped === 'string' && mapped.trim() !== '' ? mapped : null;
      } catch {
        return null;
      }
    },
  });
  const locale: LocalComponentLocaleApi = Object.freeze({
    locale: environment.locale,
    t: (en: string, zh: string) => (environment.locale === 'zh' ? zh : en),
    formatNumber: formatComponentNumber,
  });
  return Object.freeze({
    props: content.props,
    content,
    bindings,
    children,
    runtime,
    instance: Object.freeze({
      id: node.id,
      componentId: definition?.id ?? node.name ?? '',
      range: Object.freeze({ start: node.range.start, end: node.range.end }),
    }),
    mode: environment.mode,
    visible: environment.visible,
    disabled: environment.disabled,
    disabledInvalid: environment.disabledInvalid,
    resetToken: environment.resetToken,
    validation,
    source: Object.freeze({
      attributes: (item?: LocalComponentContent) =>
        environment.sourceAttributes(item ? readContentNode(item) : node, node.name),
    }),
    navigation,
    url,
    locale,
    report: environment.report,
  });
}

/* ------------------------------------------------- component definitions */

const CAPABILITY_KEYS = ['interactive', 'static', 'ssr', 'offline'] as const;
type LocalComponentCapabilities = Partial<
  Record<(typeof CAPABILITY_KEYS)[number], boolean>
>;

function readCapabilities(
  definition: Partial<LocalComponentDefinition>,
): LocalComponentCapabilities | undefined {
  const raw = (definition as { capabilities?: unknown }).capabilities;
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Component capabilities must be an object.');
  }
  const capabilities: LocalComponentCapabilities = {};
  for (const key of CAPABILITY_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new TypeError(`Component capability "${key}" must be a boolean.`);
    }
    capabilities[key] = value;
  }
  return capabilities;
}

function assertSupportedCapabilities(
  definition: Partial<LocalComponentDefinition>,
  capabilities: LocalComponentCapabilities | undefined,
  implementation: LocalReactComponentImplementation,
): void {
  if (!capabilities) return;
  if (typeof implementation.render !== 'function') {
    throw new TypeError('defineReactComponent requires a render function.');
  }
  if (
    implementation.renderStatic !== undefined
    && typeof implementation.renderStatic !== 'function'
  ) {
    throw new TypeError('defineReactComponent renderStatic must be a function.');
  }
  if (capabilities.static === false && capabilities.ssr === true) {
    throw new TypeError(
      `Component "${definition.id ?? ''}" declares SSR without static rendering.`,
    );
  }
  if (capabilities.static === false && capabilities.offline === true) {
    throw new TypeError(
      `Component "${definition.id ?? ''}" declares offline output without a static implementation.`,
    );
  }
  if (capabilities.interactive === false && capabilities.offline === true && capabilities.static !== true) {
    throw new TypeError(
      `Component "${definition.id ?? ''}" declares offline output without any renderable implementation.`,
    );
  }
}

function requireDefinition(definition: unknown): LocalComponentDefinition {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('defineReactComponent requires a component definition object.');
  }
  return definition as LocalComponentDefinition;
}

/**
 * Bind a React implementation to a validated manifest. The digest is captured
 * here and rechecked when the config is assembled.
 */
export function defineReactComponent(
  definition: LocalComponentDefinition,
  implementation: LocalReactComponentImplementation,
): LocalReactComponent {
  const manifest = requireDefinition(definition);
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('defineReactComponent requires an implementation object.');
  }
  const capabilities = readCapabilities(manifest);
  assertSupportedCapabilities(manifest, capabilities, implementation);
  let digest: string;
  try {
    digest = localComponentDigest(manifest);
  } catch (error) {
    throw new TypeError(
      `Cannot bind a React implementation to component "${manifest.id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return Object.freeze({
    definition: manifest,
    digest,
    render: implementation.render,
    ...(implementation.renderStatic === undefined
      ? {}
      : { renderStatic: implementation.renderStatic }),
  });
}

export interface LocalExtensionRequirementsLike extends LocalExtensionRequirements {}

export type { LocalComponentDefinition, LocalComponentRequirement, LocalSourceTarget };
