import {
  Component,
  createContext,
  createElement,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  Diagnostic,
  LocalCompileOptions,
  LocalCompileResult,
  LocalDocument,
  LocalNode,
  LocalRuntime,
  LocalSnapshot,
  LocalValue,
} from './types';
import type {
  LocalHostComponentContext,
  LocalHostData,
  LocalHostPropValue,
  LocalHostRenderer,
  LocalRenderContext,
  LocalRenderMode,
  LocalSourceTarget,
} from './render-types';
import {
  LocalReactExtensionMissingError,
  createReactConfig,
  localReactExtensionRenderer,
  type LocalReactConfig,
  type LocalReactRenderEnvironment,
} from '../react/sdk';
import { createLocalConfig, readLocalConfig } from '../sdk/config';
import { getLocalComponentRegistry } from '../sdk/registry';
import type { LocalComponentDefinition } from '../sdk/types';
import {
  collectNodeDependencies,
  collectSubtreeResetTokens,
  EMPTY_DEPENDENCY_INDEX,
  type DependencyIndex,
  type NodeDependencies,
} from './dependencies';
import { createLocalCompileSession, type LocalCompileSession } from './incremental';
import { createLocalRuntime, notifyLocalRuntime, updateLocalRuntime } from './runtime';
import {
  blockInputsEqual,
  projectAnchors,
  projectFootnotes,
  sameAnchorProjection,
  sameFootnoteProjection,
  validationDiagnosticKey,
  validationProjectionKey,
  type DependencyLookup,
} from './view-revision';
import { DEFAULT_MAX_LOCAL_SYNTAX_NODES } from './limits';
import { LOCAL_COMPONENT_NAMES } from './schema';
import { localCompileOptionsKey, readLocalCompileOptions } from './options';
import {
  beginLocalComponentRender,
} from '../react/component-api';
import {
  validateLocalComponentContracts,
  validateLocalExtensionRequirements,
} from '../export/requirements';
import { localHtmlSandbox, sanitizeLocalHtmlDocument } from './html';
import { localHtmlAlign, localHtmlLinkRel } from './html-names';
import { TableSurface } from './table-surface';
import { HTML_TABLE_NAMES } from './html-table';
import { formatLocalDiagnostic } from './diagnostics';
import { LatexView } from './math-view';
import { VisualFrame, tableNumericColumns } from './visuals';
import { createHeadingAnchors } from './heading-anchors';
import { textProblem as componentTextProblem } from '../components/controls';
import { CodeBlockView } from './code-block';
import { ZoomableImage } from './image-view';
import {
  collectLocalFootnotes,
  footnoteLabelText,
  type LocalFootnoteEntry,
  type LocalFootnoteIndex,
} from './footnotes';
import {
  DEFAULT_LOCAL_THEME,
  resolveLocalTheme,
  type LocalColorScheme,
  type LocalThemeDefinition,
} from './theme';
import {
  LocalLocaleProvider,
  defaultLocalize,
  localize,
  useLocalize,
  useLocalLocale,
  type LocalLocale,
  type Localize,
} from './i18n';

/* ------------------------------------------------------------------ props */

/**
 * Host-owned URL allowlist. It runs only after the renderer has validated the
 * protocol, and a thrown error denies the URL.
 */
export type LocalUrlPolicy = (url: string, kind: 'image' | 'link') => boolean;

/**
 * Trusted host mapping applied to an image URL that already passed the
 * protocol check and the host URL policy. It commonly turns a fetchable image
 * into a self-contained `data:` URL for export. Returning anything other than
 * a non-empty string rejects the image; links never reach this callback.
 */
export type LocalImageResolver = (url: string) => string | null;

export interface LocalDocumentViewProps {
  document: LocalDocument;
  runtime: LocalRuntime;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  urlPolicy?: LocalUrlPolicy;
  /** UI language for built-in labels and validation messages; defaults to English. */
  locale?: LocalLocale;
  /**
   * Trusted theme manifests. Their CSS is imported by the host separately; the
   * renderer only resolves names to a root attribute and never loads CSS.
   */
  themes?: readonly LocalThemeDefinition[];
  /** Document mode; `auto` follows the nearest host attribute or the OS. */
  colorScheme?: LocalColorScheme;
  /**
   * `interactive` (default) renders form controls; `static` renders read-only
   * values suitable for export while still evaluating the runtime.
   */
  mode?: LocalRenderMode;
  /**
   * Render static controls for the first pass, then switch to `mode` after
   * mount. The first client render matches static server markup during
   * hydration, and JavaScript-disabled readers keep the static document.
   */
  staticFirst?: boolean;
  /** Trusted image URL mapping; only called after the image URL passed validation. */
  imageResolver?: LocalImageResolver;
  /** JSON-safe host data keyed by `${kind}:${ref}`; never enters the worker. */
  hostData?: LocalHostData;
  /** Client-only renderer for hostComponent nodes; never enters the worker. */
  hostRenderer?: LocalHostRenderer;
  /**
   * SDK component implementations. It replaces `hostData`, `hostRenderer` and
   * `themes`; supplying any of them together is rejected, and themes are
   * derived from the config.
   */
  reactConfig?: LocalReactConfig;
  /**
   * Read-only host values for `<external>` declarations. Changing them updates
   * the given runtime without recompiling the source or resetting parameters.
   */
  externalValues?: Readonly<Record<string, LocalValue>>;
  /**
   * Report a preview location to the host, for example to select the matching
   * source range in an editor. Omit to keep the plain rendered output.
   */
  onSourceNavigate?: (target: LocalSourceTarget) => void;
}

export interface LocalReactiveDocumentProps {
  source: string;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  urlPolicy?: LocalUrlPolicy;
  /** UI language for built-in labels and validation messages; defaults to English. */
  locale?: LocalLocale;
  /** Trusted theme manifests; their CSS stays host-owned. */
  themes?: readonly LocalThemeDefinition[];
  /** Document mode; `auto` follows the nearest host attribute or the OS. */
  colorScheme?: LocalColorScheme;
  /** Rendering mode forwarded to `LocalDocumentView`; defaults to `interactive`. */
  mode?: LocalRenderMode;
  /** Static-first hydration behavior forwarded to `LocalDocumentView`. */
  staticFirst?: boolean;
  /** Trusted image URL mapping forwarded to `LocalDocumentView`. */
  imageResolver?: LocalImageResolver;
  /** JSON-safe host data keyed by `${kind}:${ref}`; never enters the worker. */
  hostData?: LocalHostData;
  /** Client-only renderer for hostComponent nodes; never enters the worker. */
  hostRenderer?: LocalHostRenderer;
  /**
   * SDK component implementations forwarded to `LocalDocumentView`. It cannot
   * be combined with `hostData`, `hostRenderer` or `themes`.
   */
  reactConfig?: LocalReactConfig;
  /** Read-only host values for `<external>` declarations. */
  externalValues?: Readonly<Record<string, LocalValue>>;
  /**
   * Public parameter values applied once after each new runtime is created,
   * before the reader can interact. Invalid sets are rejected atomically and
   * reported through `onDiagnostics`.
   */
  initialParameters?: Readonly<Record<string, LocalValue>>;
  /**
   * Called once per commit when the public writable parameter set actually
   * changes. Initialization does not call it.
   */
  onParametersChange?: (
    parameters: Readonly<Record<string, LocalValue>>,
    snapshot: LocalSnapshot,
  ) => void;
  /** Report preview locations so a host editor can select the source range. */
  onSourceNavigate?: (target: LocalSourceTarget) => void;
  /**
   * Host-owned compile options. HTML capability flags select the temporary
   * whole-document native branch; Markdown capability options such as
   * `markdownBreaks` change the parsed tree. The component recompiles when a
   * flag, the soft-break option or the node budget changes, but not when an
   * equal object is recreated.
   */
  compileOptions?: LocalCompileOptions;
}

/**
 * A config plus legacy host props have two different renderer registries and
 * two different theme sources. Combining them is rejected instead of silently
 * preferring one, which would make the document depend on prop order.
 */
function assertExtensionProps(
  reactConfig: LocalReactConfig | undefined,
  legacy: { hostData?: unknown; hostRenderer?: unknown; themes?: unknown },
): void {
  if (reactConfig === undefined) return;
  if (legacy.hostRenderer !== undefined) {
    throw new Error('reactConfig cannot be combined with hostRenderer.');
  }
  if (legacy.hostData !== undefined) {
    throw new Error('reactConfig cannot be combined with hostData.');
  }
  if (legacy.themes !== undefined) {
    throw new Error('reactConfig cannot be combined with themes; themes are derived from the config.');
  }
}

/* --------------------------------------------------------------- contexts */

/**
 * One shared React config for documents that do not pass `reactConfig`. It is
 * built lazily from the public preset so importing the document view never
 * executes component manifests before they are needed.
 */
let builtinReactConfig: LocalReactConfig | null = null;
function getBuiltinReactConfig(): LocalReactConfig {
  builtinReactConfig ??= createReactConfig(createLocalConfig(), { components: [] });
  return builtinReactConfig;
}

interface LocalViewContext extends LocalRenderContext {
  definitions: ReadonlyMap<string, LocalComponentDefinition>;
  locale: LocalLocale;
  report: (diagnostics: Diagnostic[]) => void;
  urlPolicy?: LocalUrlPolicy;
  imageResolver?: LocalImageResolver;
  anchors: ReturnType<typeof createHeadingAnchors>;
  /** The document root; jump navigation stays scoped to this instance. */
  rootRef: RefObject<HTMLElement | null>;
  t: Localize;
  /** Cross-field hints and field associations for this document instance. */
  validation: LocalValidationState;
  /** Views pass this object straight to renderInlineNodes, so it must match RenderEnv. */
  dependencies: DependencyLookup;
  /** Whole-document footnote index, shared with the render environment. */
  footnotes: LocalFootnoteIndex;
  /** Present when the host asked for preview-to-source navigation. */
  sourceNavigation?: (target: LocalSourceTarget) => void;
}

const LocalViewContext = createContext<LocalViewContext | null>(null);

function useLocal(): LocalViewContext {
  const value = useContext(LocalViewContext);
  if (!value) throw new Error('LocalViewContext is not initialized');
  return value;
}

/* ------------------------------------------------------------- validations */

const LOCAL_VALIDATION_FAILED_CODE = 'local.validation.failed';
const LOCAL_VALIDATION_EXPRESSION_CODE = 'local.validation.expression';
const VALIDATION_MESSAGE_BUDGET = 2_000;

interface LocalValidationHint {
  /** Per-document-instance id, kept stable for every rule state. */
  id: string;
  failed: boolean;
  error: boolean;
  message: string;
}

interface LocalValidationField {
  describedBy?: string;
  invalid: boolean;
}

interface LocalValidationState {
  /** The hint for a rendered `<validation>` tag, matched by tag range. */
  hintFor(node: LocalNode): LocalValidationHint | null;
  /** Current failing hints attached to a bound control/slot group. */
  fieldFor(node: LocalNode): LocalValidationField;
}

const NO_VALIDATION_FIELD: LocalValidationField = { invalid: false };

const NO_VALIDATIONS: LocalValidationState = {
  hintFor: () => null,
  fieldFor: () => NO_VALIDATION_FIELD,
};

function validationRangeKey(range: { start: number; end: number }): string {
  return `${range.start}:${range.end}`;
}

function boundedValidationText(message: string): string {
  return message.length > VALIDATION_MESSAGE_BUDGET
    ? `${message.slice(0, VALIDATION_MESSAGE_BUDGET - 1)}…`
    : message;
}

/**
 * Rules are advisory and identified by the range of their `<validation>` tag.
 * A failed rule contributes one hint id to every bound control of its fields;
 * hidden rules keep their association even though their hint is not announced.
 */
function createValidationState(
  document: LocalDocument,
  runtime: LocalRuntime,
  instanceId: string,
  t: Localize,
): LocalValidationState {
  const rules = Array.isArray(document.validations) ? document.validations : [];
  if (rules.length === 0) return NO_VALIDATIONS;

  let diagnostics: Diagnostic[] | null = null;
  try {
    // Hand-built runtimes may predate the advisory API; treat the absent or
    // throwing call as an evaluation failure instead of silently passing.
    if (typeof runtime.validate === 'function') diagnostics = runtime.validate();
  } catch {
    diagnostics = null;
  }

  const byRange = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics ?? []) {
    if (
      diagnostic.code !== LOCAL_VALIDATION_FAILED_CODE
      && diagnostic.code !== LOCAL_VALIDATION_EXPRESSION_CODE
    ) {
      continue;
    }
    byRange.set(validationRangeKey(diagnostic.range), diagnostic);
  }

  const hintsByNode = new Map<string, LocalValidationHint>();
  const hintsByRange = new Map<string, LocalValidationHint>();
  const fields = new Map<string, string[]>();
  const errorMessage = t('This rule cannot be evaluated', '无法计算此规则');
  const fallbackMessage = t('Validation failed.', '校验未通过。');

  for (const [index, rule] of rules.entries()) {
    const key = validationRangeKey(rule.range);
    const diagnostic = byRange.get(key);
    const error = diagnostics === null || diagnostic?.code === LOCAL_VALIDATION_EXPRESSION_CODE;
    const failed = diagnostic?.code === LOCAL_VALIDATION_FAILED_CODE;
    const message = failed
      ? boundedValidationText(diagnostic?.message || rule.message || fallbackMessage)
      : error
        ? diagnostic?.message
          ? `${errorMessage}: ${boundedValidationText(diagnostic.message)}`
          : errorMessage
        : '';
    const hint: LocalValidationHint = {
      id: `${instanceId}-validation-${index}`,
      failed,
      error,
      message,
    };
    hintsByNode.set(rule.nodeId, hint);
    hintsByRange.set(key, hint);
    if (!failed && !error) continue;

    for (const name of rule.fields ?? []) {
      const binding = Object.hasOwn(document.bindings, name)
        ? document.bindings[name]
        : undefined;
      if (!binding) continue;
      for (const nodeId of binding.nodeIds ?? []) {
        const current = fields.get(nodeId);
        if (!current) fields.set(nodeId, [hint.id]);
        else if (!current.includes(hint.id)) current.push(hint.id);
      }
    }
  }

  return {
    hintFor(node: LocalNode): LocalValidationHint | null {
      return hintsByRange.get(validationRangeKey(node.range)) ?? hintsByNode.get(node.id) ?? null;
    },
    fieldFor(node: LocalNode): LocalValidationField {
      const ids = fields.get(node.id);
      return ids && ids.length > 0
        ? { describedBy: ids.join(' '), invalid: true }
        : NO_VALIDATION_FIELD;
    },
  };
}

/* ------------------------------------------------------------- attributes */

const FULL_EXPRESSION = /^\s*\{\{([\s\S]*)\}\}\s*$/;
const EMPTY_SNAPSHOT: LocalSnapshot = { revision: 0, state: {} };

function rawAttr(node: LocalNode, name: string): string | undefined {
  return node.attrs?.[name];
}

function scalarText(value: LocalValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function plainContentText(runtime: LocalRuntime, nodes: LocalNode[] | undefined, t: Localize): string {
  return (nodes ?? []).map(node => {
    if (node.type === 'interpolation') {
      try { return scalarText(runtime.evaluate(node.value ?? '')) ?? t('Cannot compute', '无法计算'); }
      catch { return t('Cannot compute', '无法计算'); }
    }
    if (node.type === 'image') return node.alt ?? '';
    if (node.type === 'break') return ' ';
    return node.children?.length ? plainContentText(runtime, node.children, t) : node.value ?? '';
  }).join('');
}

function readBooleanAttr(
  runtime: LocalRuntime,
  node: LocalNode,
  name: string,
  fallback: boolean,
): { ok: true; value: boolean } | { ok: false } {
  const raw = rawAttr(node, name);
  if (raw === undefined) return { ok: true, value: fallback };
  const full = FULL_EXPRESSION.exec(raw);
  if (!full) return { ok: true, value: raw === 'true' };
  try {
    const value = runtime.evaluate(full[1]);
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function runtimeRevision(runtime: LocalRuntime): number {
  try {
    return runtime.snapshot().revision;
  } catch {
    return 0;
  }
}

/* ---------------------------------------------------------------- theming */

const DARK_QUERY = '(prefers-color-scheme: dark)';

type ResolvedColorScheme = 'light' | 'dark';

/**
 * Stable content signature for the host manifest. Hosts frequently construct
 * a fresh array on every render; resolving by content keeps the theme memo
 * (and its diagnostics effect) from firing again for an identical manifest.
 */
function themesSignature(themes?: readonly LocalThemeDefinition[]): string {
  if (!Array.isArray(themes) || themes.length === 0) return '';
  try {
    return themes
      .map((theme) => {
        if (!theme || typeof theme !== 'object') return '';
        const schemes = Array.isArray(theme.colorSchemes)
          ? theme.colorSchemes.join('\u0001')
          : '';
        return `${theme.name}\u0000${theme.protocol}\u0000${schemes}`;
      })
      .join('\u0002');
  } catch {
    return '';
  }
}

function diagnosticsSignature(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((item) => `${item.code}\u0000${item.range.start}\u0000${item.range.end}\u0000${item.message}`)
    .join('\u0001');
}

/** Merge diagnostic groups without reporting the same warning twice. */
function composeDiagnostics(...groups: Diagnostic[][]): Diagnostic[] {
  const seen = new Set<string>();
  const merged: Diagnostic[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = `${item.code}\u0000${item.range.start}\u0000${item.range.end}\u0000${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function explicitColorScheme(value: string | null | undefined): ResolvedColorScheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * Nearest host preference. The renderer owns `data-color-scheme` on the root,
 * so only the legacy `data-theme` attribute is read from the root itself; a
 * host script that still toggles that attribute keeps working.
 */
function hostColorScheme(root: HTMLElement): ResolvedColorScheme | null {
  const own = explicitColorScheme(root.getAttribute('data-theme'));
  if (own) return own;
  let element: Element | null = root.parentElement;
  while (element) {
    const scheme =
      explicitColorScheme(element.getAttribute('data-color-scheme')) ??
      explicitColorScheme(element.getAttribute('data-theme'));
    if (scheme) return scheme;
    element = element.parentElement;
  }
  return null;
}

function systemColorScheme(): ResolvedColorScheme | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return null;
  }
}

/**
 * Resolve the effective mode for one document instance. Server rendering and
 * the hydration pass always start light so markup matches; the client effect
 * then follows the nearest host attribute and the OS, observing both.
 */
function useResolvedColorScheme(
  rootRef: RefObject<HTMLElement | null>,
  requested: LocalColorScheme,
): ResolvedColorScheme {
  const explicit = explicitColorScheme(requested);
  const [resolved, setResolved] = useState<ResolvedColorScheme>('light');

  useEffect(() => {
    if (explicit) {
      setResolved(explicit);
      return;
    }
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') {
      setResolved('light');
      return;
    }
    const update = () => setResolved(hostColorScheme(root) ?? systemColorScheme() ?? 'light');
    update();

    let observers: MutationObserver[] = [];
    if (typeof MutationObserver === 'function') {
      try {
        const watch = (target: Element, filter: string[]) => {
          const observer = new MutationObserver(update);
          observer.observe(target, { attributes: true, attributeFilter: filter });
          observers.push(observer);
        };
        // A host script may still toggle the legacy attribute on the document
        // element itself; the renderer-owned data-color-scheme is not observed
        // there so its own writes never re-enter the resolver.
        watch(root, ['data-theme']);
        let element: Element | null = root.parentElement;
        while (element) {
          watch(element, ['data-color-scheme', 'data-theme']);
          element = element.parentElement;
        }
      } catch {
        for (const observer of observers) observer.disconnect();
        observers = [];
      }
    }

    const onMediaChange = () => update();
    let query: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      try {
        query = window.matchMedia(DARK_QUERY);
        if (typeof query.addEventListener === 'function') {
          query.addEventListener('change', onMediaChange);
        } else if (typeof query.addListener === 'function') {
          query.addListener(onMediaChange);
        }
      } catch {
        query = null;
      }
    }

    return () => {
      for (const observer of observers) observer.disconnect();
      if (!query) return;
      if (typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', onMediaChange);
      } else if (typeof query.removeListener === 'function') {
        query.removeListener(onMediaChange);
      }
    };
  }, [explicit, rootRef]);

  // Explicit props apply during server rendering too; `auto` starts light.
  return explicit ?? resolved;
}

/* ------------------------------------------------------------ state hooks */

interface ProjectionCache<P, T> {
  document: LocalDocument;
  projection: P;
  value: T;
}

/**
 * Memoize a value derived from a document while comparing only its relevant
 * projection. An edit that leaves the projection untouched keeps both the
 * previous value and its identity, so `env` (and every memoized block keyed on
 * it) stays stable across recompiles.
 */
function useProjectedMemo<P, T>(
  document: LocalDocument,
  project: (document: LocalDocument) => P,
  equal: (previous: P, next: P) => boolean,
  compute: () => T,
): T {
  const cache = useRef<ProjectionCache<P, T> | null>(null);
  let entry = cache.current;
  if (!entry || entry.document !== document) {
    const projection = project(document);
    if (entry && equal(entry.projection, projection)) {
      entry = { document, projection, value: entry.value };
    } else {
      entry = { document, projection, value: compute() };
    }
    cache.current = entry;
  }
  return entry.value;
}

interface DependencyIndexCache {
  document: LocalDocument | null;
  index: DependencyIndex;
  lookup: DependencyLookup;
}

/**
 * A stable handle over the document's dependency index. The index is removed
 * from `env` identity on purpose: recompiling one block changes node ids in
 * the index without changing what any other block reads.
 */
function useDependencyIndex(document: LocalDocument): DependencyLookup {
  const cache = useRef<DependencyIndexCache | null>(null);
  let entry = cache.current;
  if (!entry) {
    entry = {
      document: null,
      index: EMPTY_DEPENDENCY_INDEX,
      lookup: { get: (nodeId) => cache.current?.index.get(nodeId) },
    };
    cache.current = entry;
  }
  if (entry.document !== document) {
    let index: DependencyIndex;
    try {
      index = collectNodeDependencies(document);
    } catch {
      index = EMPTY_DEPENDENCY_INDEX;
    }
    entry.index = index;
    entry.document = document;
  }
  return entry.lookup;
}

interface ValidationCache {
  runtime: LocalRuntime;
  t: Localize;
  key: string;
  value: LocalValidationState;
}

/**
 * Validation rendering only depends on the rule/binding projection and the
 * current diagnostic signature, not on prose elsewhere in the document.
 */
function useStableValidation(
  document: LocalDocument,
  runtime: LocalRuntime,
  instanceId: string,
  t: Localize,
  key: string,
): LocalValidationState {
  const cache = useRef<ValidationCache | null>(null);
  let entry = cache.current;
  if (!entry || entry.runtime !== runtime || entry.t !== t || entry.key !== key) {
    entry = { runtime, t, key, value: createValidationState(document, runtime, instanceId, t) };
    cache.current = entry;
  }
  return entry.value;
}

function useResetToken(runtime: LocalRuntime, node: LocalNode, onReset: () => void) {
  let token = 0;
  try {
    token = runtime.resetToken(node);
  } catch {
    token = 0;
  }
  const previous = useRef(token);
  const handler = useRef(onReset);
  handler.current = onReset;
  useEffect(() => {
    if (previous.current !== token) {
      previous.current = token;
      handler.current();
    }
  }, [token]);
}

/* ---------------------------------------------------------------- display */

function LocalError({ message }: { message?: string }) {
  const t = useLocalize();
  return (
    <span className="local-error" role="alert">
      {message ?? t('Cannot compute', '无法计算')}
    </span>
  );
}

interface LocalBoundaryProps {
  children: ReactNode;
  revision: number;
}

/**
 * Each component instance is isolated. A failure is retried whenever the
 * runtime revision changes, so fixing a parameter recovers the local content
 * without remounting unrelated subtrees.
 */
class LocalErrorBoundary extends Component<LocalBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<LocalBoundaryProps>) {
    if (this.state.failed && previous.revision !== this.props.revision) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) return <LocalError />;
    return this.props.children;
  }
}

/* --------------------------------------------------------------- markdown */

interface LocalComponentProps {
  node: LocalNode;
  visible: boolean;
}

export const VISUAL_COMPONENTS = new Set(['table', 'chart', 'plot', 'timeline', 'diagram']);

function safeUrl(
  raw: string | undefined,
  kind: 'image' | 'link',
  policy?: LocalUrlPolicy,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\u0000- ]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    const allowed =
      kind === 'image'
        ? name === 'http' || name === 'https'
        : name === 'http' || name === 'https' || name === 'mailto' || name === 'tel';
    // Protocol validation always runs first, even when a host policy exists.
    if (!allowed) return null;
  }
  if (!policy) {
    // Images never start a network request by default, including relative and
    // protocol-relative sources. Links keep the historical safe behavior.
    return kind === 'image' ? null : trimmed;
  }
  try {
    return policy(trimmed, kind) ? trimmed : null;
  } catch {
    return null;
  }
}

function headingTag(depth: number | undefined): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const level = Math.min(6, Math.max(1, depth ?? 1));
  return `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

interface RenderEnv {
  runtime: LocalRuntime;
  rootRef: RefObject<HTMLElement | null>;
  urlPolicy?: LocalUrlPolicy;
  imageResolver?: LocalImageResolver;
  /** Client-only host payload and renderer; both stay out of the worker. */
  hostData?: LocalHostData;
  hostRenderer?: LocalHostRenderer;
  /**
   * SDK renderer. It replaces the legacy host renderer for hostComponent
   * nodes and does not require host data, so stateless leaves can render.
   */
  extensionRenderer?: (node: LocalNode, environment: LocalReactRenderEnvironment) => ReactNode;
  /**
   * Renderer for ordinary `component` nodes. It is always built from the
   * unified manifest index (builtin preset plus installed externals), even
   * when the host did not pass a `reactConfig`.
   */
  componentRenderer?: (node: LocalNode, environment: LocalReactRenderEnvironment) => ReactNode;
  /** Validated manifests by tag name (builtins plus installed external ones). */
  definitions: ReadonlyMap<string, LocalComponentDefinition>;
  anchors: ReturnType<typeof createHeadingAnchors>;
  t: Localize;
  locale: LocalLocale;
  mode: LocalRenderMode;
  /** Binding keys per node subtree; an empty index makes every block a wildcard. */
  dependencies: DependencyLookup;
  /** Whole-document footnote numbering and reference ids for this instance. */
  footnotes: LocalFootnoteIndex;
  /** When present, rendered targets carry source metadata and clicks report. */
  sourceNavigation?: (target: LocalSourceTarget) => void;
  /** Advisory validation hints/field associations for this document instance. */
  validation: LocalValidationState;
  /** Runtime diagnostics from host renderers and rejected writes. */
  report?: (diagnostics: Diagnostic[]) => void;
}

/**
 * Source-location attributes are emitted only when navigation is enabled, so
 * ordinary SSR output and exported HTML stay unchanged.
 */
function sourceAttributes(
  enabled: boolean,
  node: LocalNode,
  componentName?: string,
): Record<string, string> {
  if (!enabled) return {};
  const { start, end } = node.range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return {};
  return {
    'data-rmd-source-start': String(start),
    'data-rmd-source-end': String(end),
    'data-rmd-source-node': node.id,
    'data-rmd-source-type': node.type,
    ...(componentName ? { 'data-rmd-source-component': componentName } : {}),
  };
}

function sourceProps(
  env: RenderEnv,
  node: LocalNode,
  componentName?: string,
): Record<string, string> {
  return sourceAttributes(env.sourceNavigation !== undefined, node, componentName);
}

/* ------------------------------------------------------- public adapter */

/** Line/column for an adapter-owned diagnostic, clamped to the source. */
function sourcePosition(env: RenderEnv, offset: number): { line: number; column: number } {
  let source = '';
  try {
    source = env.runtime.document.source ?? '';
  } catch {
    source = '';
  }
  if (typeof source !== 'string' || source.length === 0) return { line: 1, column: 1 };
  const limit = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < limit; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: limit - lineStart + 1 };
}

/** Focus and scroll to one rendered anchor inside this document instance. */
function jumpWithinDocument(
  root: HTMLElement | null,
  target: string,
): 'ok' | 'missing' | 'hidden' {
  if (!root) return 'missing';
  let element: HTMLElement | null = null;
  try {
    // Attribute lookup stays inside this document instance; never the page.
    element = root.querySelector<HTMLElement>(`[id="${target}"]`);
  } catch {
    element = null;
  }
  if (!element) return 'missing';
  if (element.closest('[hidden]')) return 'hidden';
  if (!element.hasAttribute('tabindex')) element.tabIndex = -1;
  try {
    element.focus({ preventScroll: true });
  } catch {
    /* Focus support is best-effort. */
  }
  let behavior: ScrollBehavior = 'smooth';
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto';
  } catch {
    behavior = 'auto';
  }
  try {
    element.scrollIntoView({ behavior, block: 'start' });
  } catch {
    /* Older engines may not support smooth scrolling. */
  }
  return 'ok';
}

/**
 * Build the public render environment handed to one SDK component. The
 * renderer owns the internal node graph; components receive adapter services
 * only.
 */
function extensionEnvironment(
  env: RenderEnv,
  node: LocalNode,
  visible: boolean,
): LocalReactRenderEnvironment {
  const disabledRead = readBooleanAttr(env.runtime, node, 'disabled', false);
  let resetToken = 0;
  try {
    resetToken = env.runtime.resetToken(node);
  } catch {
    resetToken = 0;
  }
  return {
    runtime: env.runtime,
    mode: env.mode,
    visible,
    disabled: disabledRead.ok ? disabledRead.value : true,
    disabledInvalid: !disabledRead.ok,
    resetToken,
    locale: env.locale,
    renderChildren: (nodes, nextVisible) => renderNodes(env, nodes ?? [], nextVisible),
    renderInline: (nodes, nextVisible) =>
      renderInlineNodes(env, nodes ?? [], nextVisible),
    renderToText: (nodes) => plainContentText(env.runtime, nodes, env.t),
    report: (diagnostics) => env.report?.(diagnostics),
    positionOf: (offset) => sourcePosition(env, offset),
    definitionFor: (name) => env.definitions.get(name),
    validationField: (target) => env.validation.fieldFor(target),
    validationHint: (target) => env.validation.hintFor(target),
    sourceAttributes: (target, componentName) => sourceProps(env, target, componentName),
    targetId: (to) => env.anchors.targetId(to),
    anchorId: (target) => env.anchors.anchorIds.get(target),
    jumpAllowed: (to) => {
      if (env.anchors.targetId(to) === undefined) return false;
      if (env.urlPolicy === undefined) return true;
      try {
        return env.urlPolicy(`#${to}`, 'link') === true;
      } catch {
        return false;
      }
    },
    jumpTo: (target) => jumpWithinDocument(env.rootRef.current, target),
    urlPolicy: env.urlPolicy,
    imageResolver: env.imageResolver,
  };
}

/* ------------------------------------------------------- parameter bridge */

/** Defensive copy of host-supplied parameter values. */
function cloneParameterValues(
  values: Readonly<Record<string, LocalValue>>,
): Record<string, LocalValue> {
  const copy: Record<string, LocalValue> = {};
  for (const [key, value] of Object.entries(values)) {
    copy[key] = Array.isArray(value) ? value.slice() : value;
  }
  return copy;
}

function parameterValueEqual(a: LocalValue | undefined, b: LocalValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => entry === b[index]);
  }
  return a === b;
}

function parameterRecordsEqual(
  a: Readonly<Record<string, LocalValue>>,
  b: Readonly<Record<string, LocalValue>>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key) || !parameterValueEqual(a[key], b[key])) return false;
  }
  return true;
}

const SAFE_HTML_ATTRIBUTE = /^(?:aria|data)-[a-z0-9_.:-]+$/;
const HTML_IDREF_ATTRIBUTES = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-activedescendant']);

/**
 * Whitelist of source attributes that may reach a rendered P0 element. IDs are
 * always rewritten through this render instance's anchor namespace; source
 * `class`, `style`, URL schemes and event hooks never pass through here.
 */
function safeHtmlProps(env: RenderEnv, node: LocalNode): Record<string, string> {
  const attrs = node.attrs;
  if (!attrs) return {};
  const props: Record<string, string> = {};
  const id = env.anchors.ids.get(node) ?? env.anchors.htmlIds.get(node);
  if (id) props.id = id;
  for (const [rawName, value] of Object.entries(attrs)) {
    const name = rawName.toLowerCase();
    if (name === 'id') continue;
    if (name === 'align' && (node.type === 'div' || node.type === 'paragraph' || node.type === 'heading')) {
      const align = localHtmlAlign(value);
      if (align) props.align = align;
      continue;
    }
    if (name === 'title' || name === 'lang') {
      props[name] = value;
      continue;
    }
    if (name === 'dir') {
      const direction = value.trim().toLowerCase();
      if (direction === 'ltr' || direction === 'rtl' || direction === 'auto') props.dir = direction;
      continue;
    }
    if (SAFE_HTML_ATTRIBUTE.test(name)) {
      props[name] = HTML_IDREF_ATTRIBUTES.has(name)
        ? value.trim().split(/\s+/).filter(Boolean).map(id => env.anchors.referenceId(id)).join(' ')
        : value;
    }
  }
  return props;
}

function renderNativeTable(env: RenderEnv, node: LocalNode, visible: boolean, key: string): ReactNode {
  const rows: LocalNode[] = [];
  const collectRows = (nodes: LocalNode[]) => {
    for (const n of nodes) {
      if (n.name === 'tr') rows.push(n);
      else if (n.name !== 'td' && n.name !== 'th' && n.type !== 'htmlTable') collectRows(n.children ?? []);
    }
  };
  collectRows(node.children ?? []);
  const merged = rows.some(row => row.children?.some(cell => ['colspan', 'rowspan'].some(a => cell.attrs?.[a] !== undefined && cell.attrs[a] !== '1')));
  const bodyRows = rows.filter(row => row.children?.some(cell => cell.name === 'td'));
  const text = (n: LocalNode): string => {
    if (n.type === 'interpolation') {
      try { return scalarText(env.runtime.evaluate(n.value ?? '')) ?? ''; } catch { return ''; }
    }
    return (n.value ?? '') + (n.children ?? []).map(text).join('');
  };
  const numeric = merged ? [] : tableNumericColumns(bodyRows.map(row => row.children ?? []), env.runtime, env.t);
  const structural = (n: LocalNode, index = 0): ReactNode => {
    if (n.type === 'htmlTable') return renderNativeTable(env, n, visible, n.id);
    const name = n.name ?? '';
    if (!HTML_TABLE_NAMES.has(name) || name === 'table') return null;
    const props: Record<string, unknown> = { ...safeHtmlProps(env, n), key: n.id };
    const attrs = n.attrs ?? {};
    if (name === 'th' || name === 'td') {
      if (attrs.colspan !== undefined) props.colSpan = Number(attrs.colspan);
      if (attrs.rowspan !== undefined) props.rowSpan = Number(attrs.rowspan);
      if (attrs.scope !== undefined) props.scope = attrs.scope.trim().toLowerCase();
      if (attrs.abbr !== undefined) props.abbr = attrs.abbr;
      if (attrs.headers !== undefined) props.headers = attrs.headers.trim().split(/\s+/).map(id => env.anchors.referenceId(id)).join(' ');
      if (numeric[index]) props.className = 'is-numeric';
      const align = attrs.align && localHtmlAlign(attrs.align);
      if (align) props.style = { textAlign: align };
      return createElement(name, props, renderNodes(env, n.children, visible));
    }
    if (name === 'col' || name === 'colgroup') {
      if (attrs.span !== undefined) props.span = Number(attrs.span);
      if (name === 'col') return createElement('col', props);
    }
    return createElement(name, props, (n.children ?? []).map((child, i) => structural(child, i)));
  };
  const caption = node.children?.find(n => n.name === 'caption');
  const title = caption ? renderNodes(env, (caption.children ?? []).flatMap(n => n.type === 'paragraph' ? n.children ?? [] : [n]), visible, false) : env.t('Table', '表格');
  return <VisualFrame key={key} className="local-visual-table-block local-html-table-block" label={title}>
    <TableSurface tableProps={{ ...safeHtmlProps(env, node), ...(merged ? { 'data-merged': 'true' } : {}) }}>
      <caption {...(caption ? safeHtmlProps(env, caption) : {})} className="local-visual-sr-only">{caption ? text(caption) : env.t('Table', '表格')}</caption>
      {(node.children ?? []).filter(child => child.name !== 'caption').map(child => structural(child))}
    </TableSurface>
  </VisualFrame>;
}

interface LocalBlockProps {
  node: LocalNode;
  index: number;
  visible: boolean;
  env: RenderEnv;
  depValues: readonly LocalValue[] | null;
  resetToken: number;
}

/**
 * A block subtree re-renders only when the bindings it (or a descendant) reads
 * changed. `null` depValues means the dependencies could not be decided, so the
 * block keeps the pre-memoization behavior of re-rendering on every revision.
 */
function blockPropsEqual(previous: LocalBlockProps, next: LocalBlockProps): boolean {
  return blockInputsEqual(previous, next);
}

const LocalBlock = memo(function LocalBlock({ node, index, visible, env }: LocalBlockProps) {
  return renderNode(env, node, index, visible, true);
}, blockPropsEqual);

function renderNodes(
  env: RenderEnv,
  nodes: LocalNode[] | undefined,
  visible: boolean,
  block = true,
): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  // Inline content gets no boundary: it is recreated inside its owning block.
  if (!block) return nodes.map((node, index) => renderNode(env, node, index, visible, false));
  // Read the snapshot once per call; an unreadable snapshot makes every block
  // in this batch a wildcard, exactly like an undecidable dependency entry.
  let currentState: Readonly<Record<string, LocalValue>> | null = null;
  let resetTokens: ReadonlyMap<string, number> | null = null;
  try {
    currentState = env.runtime.snapshot().state;
    resetTokens = collectSubtreeResetTokens(env.runtime);
  } catch {
    currentState = null;
  }
  const state = currentState;
  return nodes.map((node, index) => {
    const deps: NodeDependencies | undefined = env.dependencies.get(node.id);
    const depValues = deps == null || state === null || resetTokens === null
      ? null : deps.map((key) => state[key]);
    const resetToken = resetTokens?.get(node.id) ?? 0;
    return (
      <LocalBlock
        key={node.id || `${node.type}-${index}`}
        node={node}
        index={index}
        visible={visible}
        env={env}
        depValues={depValues}
        resetToken={resetToken}
      />
    );
  });
}

/**
 * Unsupported syntax is preserved as inert source. The parser stores the exact
 * original text in `value`; falling back to the document range keeps older or
 * hand-built trees readable without ever interpreting their contents.
 */
function fallbackSource(env: RenderEnv, node: LocalNode): string {
  if (typeof node.value === 'string') return node.value;
  const { start, end } = node.range;
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start) {
    return env.runtime.document.source.slice(start, end);
  }
  return '';
}

function renderFallback(env: RenderEnv, node: LocalNode, key: string, block: boolean): ReactNode {
  return (
    <span
      key={key}
      className={block ? 'local-fallback local-fallback-block' : 'local-fallback local-fallback-inline'}
      title={env.t('Unsupported syntax shown as source', '未支持的语法，已按源码原样显示')}
      data-local-fallback=""
    >
      {fallbackSource(env, node)}
    </span>
  );
}

/** Render block-parsed children as inline content for labels and options. */
function renderInlineNodes(env: RenderEnv, nodes: LocalNode[] | undefined, visible: boolean): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) => {
    if (node.type === 'paragraph' || node.type === 'root') {
      return (
        <span key={node.id || `inline-${index}`}>
          {renderNodes(env, node.children, visible, false)}
        </span>
      );
    }
    return renderNode(env, node, index, visible, false);
  });
}

/**
 * A footnote reference renders as its number in a superscript link. Hrefs use
 * the id generated while collecting footnotes, so URL policy and heading
 * anchor resolution never rewrite an internal target. Without a definition the
 * original source form stays visible instead of becoming a dead link.
 */
function renderFootnoteReference(env: RenderEnv, node: LocalNode, key: string): ReactNode {
  const site = env.footnotes.siteFor(node);
  if (!site || !site.entry) {
    const label = site?.label || footnoteLabelText(node) || '?';
    return (
      <span
        key={key}
        className="local-footnote-missing"
        title={env.t('Undefined footnote', '未定义的脚注')}
        data-local-footnote-missing=""
      >
        {`[^${label}]`}
      </span>
    );
  }
  const entry = site.entry;
  return (
    <sup key={key} className="local-footnote-ref">
      <a
        id={site.id}
        href={`#${entry.id}`}
        className="local-footnote-ref-link"
        role="doc-noteref"
        data-local-footnote-number={entry.number}
        aria-label={env.t(`Footnote ${entry.number}`, `脚注 ${entry.number}`)}
      >
        {entry.number}
      </a>
    </sup>
  );
}

/** Resolve one host property; full interpolations keep their expression type. */
function resolveHostProp(
  runtime: LocalRuntime,
  raw: string,
): LocalHostPropValue {
  const full = FULL_EXPRESSION.exec(raw);
  if (full) {
    try {
      const value = runtime.evaluate(full[1]);
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    return runtime.text(raw);
  } catch {
    return null;
  }
}

/**
 * A host component renders entirely on the client. The placeholder is the
 * diagnostic surface: a missing renderer and a synchronous renderer failure
 * stay visible without reporting through `onDiagnostics`. Host data is only
 * required when the node declares a `kind`/`ref` key.
 */
function renderHostComponent(
  env: RenderEnv,
  node: LocalNode,
  key: string,
  visible: boolean,
): ReactNode {
  const name = node.name ?? '';
  const unavailable = (reason: 'renderer' | 'data' | 'error', sdk = false): ReactNode => (
    <span
      key={key}
      className={`local-host-component local-host-unavailable${sdk ? ' local-sdk-unavailable' : ''}`}
      data-local-host-component={name}
      data-local-host-reason={reason}
      role="note"
    >
      {env.t(`Host component <${name}> is unavailable here.`, `宿主组件 <${name}> 在此不可用。`)}
    </span>
  );

  // SDK components own their props and bindings, so the legacy requirement for
  // `kind`/`ref` host data never applies to them. Visibility travels into the
  // context and children render under that visibility.
  if (env.extensionRenderer) {
    try {
      return createElement(Fragment, { key }, env.extensionRenderer(
        node,
        extensionEnvironment(env, node, visible),
      ));
    } catch (error) {
      return unavailable(error instanceof LocalReactExtensionMissingError ? 'renderer' : 'error', true);
    }
  }

  const kind = node.attrs?.kind?.trim() ?? '';
  const ref = node.attrs?.ref?.trim() ?? '';
  const dataKey = kind !== '' && ref !== '' ? `${kind}:${ref}` : null;
  if (dataKey === null) {
    // A binding-only host component does not need host data. Without a
    // binding, a node that declares neither kind nor ref keeps the historical
    // visible data placeholder.
    let bound = false;
    try {
      bound = Object.values(env.runtime.document.bindings).some((binding) => binding.nodeIds.includes(node.id));
    } catch {
      bound = false;
    }
    // Container and inline host components are structural: they may render
    // children without host data. A bare leaf keeps the historical placeholder.
    if (!bound && node.hostForm !== 'container' && node.hostForm !== 'inline') return unavailable('data');
  }
  const renderer = env.hostRenderer;
  if (!renderer) return unavailable('renderer');
  let data: unknown;
  if (dataKey !== null) {
    // `undefined` alone means missing: null, false and 0 are valid host data.
    data = env.hostData?.[dataKey];
    if (data === undefined) return unavailable('data');
  }

  const readValue = (): LocalValue => {
    try {
      return env.runtime.get(node);
    } catch {
      return null;
    }
  };
  const props: Record<string, LocalHostPropValue> = {};
  for (const [propName, raw] of Object.entries(node.attrs ?? {})) {
    if (propName === 'bind' || propName === 'initial' || propName === 'disabled') continue;
    props[propName] = resolveHostProp(env.runtime, raw);
  }
  let resetToken = 0;
  try {
    resetToken = env.runtime.resetToken(node);
  } catch {
    resetToken = 0;
  }
  const disabledRead = readBooleanAttr(env.runtime, node, 'disabled', false);

  const ctx: LocalHostComponentContext = {
    runtime: env.runtime,
    // With no explicit nodes, a container renders its parsed children.
    render: (nodes, nextVisible = true) => renderNodes(env, nodes ?? node.children ?? [], nextVisible),
    visible,
    mode: env.mode,
    value: readValue(),
    setValue: (next: LocalValue): boolean => {
      try {
        const diagnostics = env.runtime.set(node, next);
        if (diagnostics.length) {
          env.report?.(diagnostics);
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    disabled: disabledRead.ok ? disabledRead.value : true,
    resetToken,
    props: Object.freeze(props),
    report: (diagnostics) => env.report?.(diagnostics),
  };
  try {
    // A Fragment keeps the outer list key stable around the renderer output.
    return createElement(Fragment, { key }, renderer(node, data, ctx));
  } catch {
    return unavailable('error');
  }
}

/** Collapse memo wrappers along deep single-child Markdown chains. The native
 * DOM stays nested, while React no longer needs one extra component per level. */
function renderDeepContainerChain(env:RenderEnv,node:LocalNode,visible:boolean):ReactNode|undefined {
  const plain=(node:LocalNode)=>node.type==='blockquote'||node.type==='list'
    ||(node.type==='listItem'&&typeof node.checked!=='boolean');
  if(!plain(node)||node.children?.length!==1||!plain(node.children[0]))return;
  const chain:LocalNode[]=[];
  let current=node;
  for(;;){
    chain.push(current);
    if(current.children?.length!==1||!plain(current.children[0]))break;
    current=current.children[0];
  }
  if(chain.length<32)return;
  let children=renderNodes(env,current.children,visible);
  for(let i=chain.length-1;i>=0;i--){
    const item=chain[i],props=safeHtmlProps(env,item),key=item.id;
    if(item.type==='blockquote')children=<blockquote key={key} {...props}>{children}</blockquote>;
    else if(item.type==='listItem')children=<li key={key} {...props} className="md-list-item">{children}</li>;
    else if(item.ordered)children=<ol key={key} {...props} start={item.start??1} className="md-list">{children}</ol>;
    else children=<ul key={key} {...props} className="md-list">{children}</ul>;
  }
  return children;
}

function renderNode(
  env: RenderEnv,
  node: LocalNode,
  index: number,
  visible: boolean,
  block = true,
): ReactNode {
  const key = node.id || `${node.type}-${index}`;
  const chain=renderDeepContainerChain(env,node,visible);
  if(chain!==undefined)return chain;

  if (node.type === 'component') {
    return (
      <LocalErrorBoundary key={key} revision={runtimeRevision(env.runtime)}>
        {renderComponent(env, node, visible)}
      </LocalErrorBoundary>
    );
  }

  switch (node.type) {
    case 'root':
      return <div key={key}>{renderNodes(env,node.children, visible)}</div>;

    case 'heading':
      return createElement(
        headingTag(node.depth),
        {
          key,
          // An explicit source id wins; otherwise the generated heading slug.
          id: env.anchors.ids.get(node),
          ...safeHtmlProps(env, node),
          ...sourceProps(env, node),
        },
        renderNodes(env,node.children, visible, false),
      );

    case 'paragraph':
      return <p key={key} {...safeHtmlProps(env, node)} {...sourceProps(env, node)}>{renderNodes(env,node.children, visible, false)}</p>;

    case 'text':
      return <span key={key}>{node.value ?? ''}</span>;

    case 'emphasis':
      return <em key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</em>;

    case 'strong':
      return <strong key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</strong>;

    case 'delete':
      return <del key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</del>;

    // Basic HTML formatting is rebuilt as plain React tags. No raw HTML and no
    // attributes from the source reach the DOM.
    case 'underline':
      return <u key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</u>;

    case 'mark':
      return <mark key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</mark>;

    case 'sup':
      return <sup key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</sup>;

    case 'sub':
      return <sub key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</sub>;

    case 'span':
      return <span key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</span>;

    case 'div':
      return <div key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible)}</div>;

    case 'summary':
      return <span key={key} {...safeHtmlProps(env, node)}>{renderNodes(env,node.children, visible, false)}</span>;

    case 'details':
      return <HtmlDetailsView key={key} node={node} visible={visible} />;

    case 'inlineCode':
      return (
        <code className="md-inline-code" key={key} {...safeHtmlProps(env, node)}>
          {node.value ?? ''}
        </code>
      );

    case 'code':
      return <CodeBlockView key={key} value={node.value ?? ''} language={node.lang ?? undefined} mode={env.mode} htmlProps={safeHtmlProps(env, node)} />;

    case 'blockquote':
      return <blockquote key={key} {...safeHtmlProps(env, node)} {...sourceProps(env, node)}>{renderNodes(env,node.children, visible)}</blockquote>;

    case 'break':
      return <br key={key} {...safeHtmlProps(env, node)} />;

    case 'thematicBreak':
      return <hr key={key} {...safeHtmlProps(env, node)} />;

    case 'list':
      return node.ordered ? (
        <ol key={key} start={node.start ?? 1} className="md-list" {...safeHtmlProps(env, node)}>
          {renderNodes(env,node.children, visible)}
        </ol>
      ) : (
        <ul key={key} className="md-list" {...safeHtmlProps(env, node)}>
          {renderNodes(env,node.children, visible)}
        </ul>
      );

    case 'listItem': {
      const task = typeof node.checked === 'boolean';
      return (
        <li key={key} className={task ? 'md-list-item md-task-item' : 'md-list-item'} {...safeHtmlProps(env, node)} {...sourceProps(env, node)}>
          {task ? (
            env.mode === 'static' ? (
              <span
                className="md-task-marker"
                role="img"
                aria-label={
                  node.checked
                    ? env.t('Completed', '已完成')
                    : env.t('Not completed', '未完成')
                }
              >
                {node.checked ? '✓' : '☐'}
              </span>
            ) : (
              <input
                type="checkbox"
                className="md-task-checkbox"
                checked={node.checked === true}
                readOnly
                tabIndex={-1}
                aria-label={
                  node.checked
                    ? env.t('Completed', '已完成')
                    : env.t('Not completed', '未完成')
                }
              />
            )
          ) : null}
          {renderNodes(env,node.children, visible)}
        </li>
      );
    }

    case 'link': {
      const allowedHref = safeUrl(node.url, 'link', env.urlPolicy);
      if (!allowedHref) {
        return (
          <span
            {...safeHtmlProps(env, node)}
            className="md-link-rejected"
            key={key}
            title={env.t('Unsafe link URL rejected', '已拒绝不安全的链接地址')}
          >
            {renderNodes(env,node.children, visible, false)}
          </span>
        );
      }
      const href = env.anchors.resolve(allowedHref);
      const external = /^https?:/i.test(href);
      const target = node.attrs?.target ?? (external ? '_blank' : undefined);
      const rel = localHtmlLinkRel(node.attrs?.rel ?? (external ? 'noopener noreferrer' : undefined), target);
      return (
        <a
          key={key}
          {...safeHtmlProps(env, node)}
          href={href}
          title={node.title ?? undefined}
          target={target}
          rel={rel}
        >
          {renderNodes(env,node.children, visible, false)}
        </a>
      );
    }

    case 'image': {
      const accepted = safeUrl(node.url, 'image', env.urlPolicy);
      let src = accepted;
      // The host resolver is a post-validation mapping only. A thrown error,
      // a non-string or an empty result rejects the image instead of falling
      // back to an unchecked URL.
      if (accepted && env.imageResolver) {
        try {
          const mapped = env.imageResolver(accepted);
          src = typeof mapped === 'string' && mapped.trim() !== '' ? mapped : null;
        } catch {
          src = null;
        }
      }
      if (!src) {
        const rejected = env.t('Unsafe image rejected', '已拒绝不安全的图片');
        const alt = node.alt ? env.t(`: ${node.alt}`, `：${node.alt}`) : '';
        return (
          <span className="md-image-rejected" key={key} {...safeHtmlProps(env, node)}>
            [{rejected}{alt}]
          </span>
        );
      }
      return (
        <ZoomableImage
          key={key}
          src={src}
          alt={node.alt ?? ''}
          title={node.title ?? undefined}
          mode={env.mode}
          rootRef={env.rootRef}
          imageProps={node.attrs === undefined ? undefined : { ...safeHtmlProps(env, node), width: node.width, height: node.height }}
        />
      );
    }

    case 'htmlTable':
      return renderNativeTable(env, node, visible, key);

    case 'table': {
      const rows = node.children ?? [];
      const [headRow, ...bodyRows] = rows;
      return (
        <div className="md-table-scroll" key={key}>
          <table className="md-table">
            {headRow ? (
              <thead>
                <tr>{renderTableCells(env,headRow, 'th', node.align, visible)}</tr>
              </thead>
            ) : null}
            {bodyRows.length ? (
              <tbody>
                {bodyRows.map((row, rowIndex) => (
                  <tr key={row.id || `${key}-row-${rowIndex}`}>
                    {renderTableCells(env,row, 'td', node.align, visible)}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      );
    }

    case 'tableRow':
      return <tr key={key}>{renderTableCells(env,node, 'td', undefined, visible)}</tr>;

    case 'tableCell': {
      const align = node.align?.[0] ?? undefined;
      return (
        <td key={key} style={{ textAlign: align ?? undefined }}>
          {renderNodes(env,node.children, visible, false)}
        </td>
      );
    }

    case 'interpolation': {
      try {
        const text = scalarText(env.runtime.evaluate(node.value ?? ''));
        if (text === null) throw new Error('Cannot display an array');
        return (
          <span className="local-interpolation" key={key} {...sourceProps(env, node)}>
            {text}
          </span>
        );
      } catch {
        return <LocalError key={key} />;
      }
    }

    case 'math':
    case 'inlineMath': {
      const display = node.type === 'math';
      return (
        <span
          key={key}
          className={display ? 'local-math-display' : 'local-math-inline'}
          {...sourceProps(env, node)}
        >
          <LocalErrorBoundary revision={runtimeRevision(env.runtime)}>
            <LatexView source={node.value ?? ''} display={display} />
          </LocalErrorBoundary>
        </span>
      );
    }

    case 'html':
      return (
        <span className="md-raw-html" key={key}>
          {node.value ?? ''}
        </span>
      );

    case 'fallback':
      return renderFallback(env, node, key, block);

    // Footnotes are collected at the document level: references show a
    // numbered superscript, and definitions render once in the endnotes
    // section instead of at their source position.
    case 'footnoteReference':
      return renderFootnoteReference(env, node, key);

    case 'footnoteDefinition':
      return null;

    case 'comment':
    case 'definition':
      return null;

    case 'hostComponent':
      return renderHostComponent(env, node, key, visible);

    default:
      if (node.children && node.children.length) {
        return <span key={key}>{renderNodes(env,node.children, visible, block)}</span>;
      }
      if (typeof node.value === 'string') {
        return <span key={key}>{node.value}</span>;
      }
      return null;
  }
}

function renderTableCells(
  env: RenderEnv,
  row: LocalNode,
  tag: 'th' | 'td',
  tableAlign: ('left' | 'center' | 'right' | null)[] | undefined,
  visible: boolean,
): ReactNode {
  return (row.children ?? []).map((cell, index) => {
    const textAlign = cell.align?.[0] ?? row.align?.[index] ?? tableAlign?.[index] ?? undefined;
    if (tag === 'th') {
      return (
        <th key={cell.id || `${row.id}-h-${index}`} style={{ textAlign: textAlign ?? undefined }}>
          {renderNodes(env,cell.children, visible, false)}
        </th>
      );
    }
    return (
      <td key={cell.id || `${row.id}-c-${index}`} style={{ textAlign: textAlign ?? undefined }}>
        {renderNodes(env,cell.children, visible, false)}
      </td>
    );
  });
}

function renderComponent(
  env: RenderEnv,
  node: LocalNode,
  visible: boolean,
): ReactNode {
  const name = node.name ?? '';
  // Computed/const/external declarations are document metadata, not rendered
  // controls. They are also the only component names the renderer knows by
  // name; every rendered builtin resolves through the same manifest index.
  if (name === 'computed' || name === 'const' || name === 'external') return null;
  const renderer = env.componentRenderer ?? env.extensionRenderer;
  if (renderer) {
    try {
      return createElement(Fragment, {
        key: node.id,
      }, renderer(node, extensionEnvironment(env, node, visible)));
    } catch (error) {
      if (!(error instanceof LocalReactExtensionMissingError)) throw error;
    }
  }
  return (
    <span className="component-error">
      {env.t('Unknown component "', '未知组件“')}
      {name || env.t('(missing name)', '（缺少名称）')}
      {env.t('"', '”')}
    </span>
  );
}

/**
 * P0 `<details>`/`<summary>`. It deliberately reuses the existing disclosure
 * classes and accessibility pattern, but the summary body is rich inline
 * content rather than a plain attribute. Static mode exposes every body;
 * nested details recurse naturally.
 */
function HtmlDetailsView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { render, mode } = local;
  const t = useLocalize();
  const children = node.children ?? [];
  const direct = children.find((child) => child.type === 'summary');
  const wrappedIndex = children.findIndex((child) => child.type === 'paragraph'
    && child.children?.length === 1 && child.children[0].type === 'summary');
  const summary = direct ?? (wrappedIndex >= 0 ? children[wrappedIndex].children![0] : undefined);
  const body = children.filter((child, index) => child !== summary && index !== wrappedIndex);
  const summaryContent = summary
    ? <span {...safeHtmlProps(local, summary)}>{renderInlineNodes(local, summary.children, visible)}</span>
    : t('Details', '折叠内容');
  // Boolean presence, not the literal value: `open="false"` is still open.
  const initialOpen = node.attrs !== undefined && Object.hasOwn(node.attrs, 'open');
  const [open, setOpen] = useState(initialOpen);
  useResetToken(local.runtime, node, () => setOpen(initialOpen));

  if (mode === 'static') {
    return (
      <section className="local-disclosure local-static-disclosure local-html-details" {...safeHtmlProps(local, node)}>
        <h3 className="local-disclosure-heading">{summaryContent}</h3>
        <div className="local-disclosure-panel">{render(body, visible)}</div>
      </section>
    );
  }

  const triggerId = `${domId}-html-details-trigger`;
  const panelId = `${domId}-html-details-panel`;
  return (
    <div className="local-disclosure local-html-details" {...safeHtmlProps(local, node)}>
      <h3 className="local-disclosure-heading">
        <button
          id={triggerId}
          type="button"
          className="local-disclosure-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={`local-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span>{summaryContent}</span>
        </button>
      </h3>
      <div
        id={panelId}
        className="local-disclosure-panel"
        role="region"
        aria-labelledby={triggerId}
        hidden={!open}
      >
        {render(body, visible && open)}
      </div>
    </div>
  );
}


/** Compatibility helper; controls use the public component implementation. */
export function textProblem(value: string, options: Parameters<typeof componentTextProblem>[1], t: Localize = defaultLocalize): string | null {
  return componentTextProblem(value, options, t);
}

/* Derived compatibility data for older coverage tests. Active rendering uses
 * the unified manifest index (`componentRenderer`), never this table. */
const COMPATIBILITY_SPECIALS = new Set(['computed', 'const', 'external', 'data-table']);
export const COMPONENTS: Record<string, (props: LocalComponentProps) => ReactNode> =
  Object.freeze(Object.fromEntries(
    LOCAL_COMPONENT_NAMES
      .filter((name) => !VISUAL_COMPONENTS.has(name) && !COMPATIBILITY_SPECIALS.has(name))
      .map((name) => [name, () => null]),
  ));

/* --------------------------------------------------------------- endnotes */

function footnoteBody(env: RenderEnv, entry: LocalFootnoteEntry): ReactNode {
  const children = entry.definition.children;
  if (children && children.length > 0) return renderNodes(env, children, true);
  // Older or hand-built definitions may only carry their text in `value`.
  if (typeof entry.definition.value === 'string' && entry.definition.value !== '') {
    return <p>{entry.definition.value}</p>;
  }
  return null;
}

/**
 * One document-wide endnote list. Each item keeps every backlink for its
 * references so readers can return to any occurrence, not just the first.
 */
function EndnotesView({
  entries,
  env,
  t,
  titleId,
}: {
  entries: readonly LocalFootnoteEntry[];
  env: RenderEnv;
  t: Localize;
  titleId: string;
}) {
  return (
    <section
      className="local-footnotes"
      role="doc-endnotes"
      aria-labelledby={titleId}
      data-local-footnotes=""
    >
      <h2 id={titleId} className="local-footnotes-title">
        {t('Footnotes', '脚注')}
      </h2>
      <ol className="local-footnotes-list">
        {entries.map((entry) => {
          const multiple = entry.references.length > 1;
          return (
            <li
              key={entry.id}
              id={entry.id}
              className="local-footnote"
              data-local-footnote-number={entry.number}
            >
              <div className="local-footnote-body">{footnoteBody(env, entry)}</div>
              <span className="local-footnote-backlinks">
                {entry.references.map((reference, index) => (
                  <a
                    key={reference.id}
                    href={`#${reference.id}`}
                    className="local-footnote-backlink"
                    role="doc-backlink"
                    aria-label={
                      multiple
                        ? t(
                            `Back to reference ${entry.number} (${index + 1} of ${entry.references.length})`,
                            `返回脚注 ${entry.number} 的第 ${index + 1} 处引用`,
                          )
                        : t(`Back to reference ${entry.number}`, `返回脚注 ${entry.number}`)
                    }
                  >
                    {'↩'}
                  </a>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------------------------------------------------------------- document */

function LocalHtmlSourceFallback({source, mode}: {source: string; mode: LocalRenderMode}) {
  return <article className={`md-document local-document${mode === 'static' ? ' local-static' : ''}`}
    data-source-mode="html" data-render-mode={mode} data-html-fallback="document">
    <pre className="local-fallback local-fallback-block" style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{source}</pre>
  </article>;
}

function LocalDocumentViewHtml({ document, mode = 'interactive', staticFirst = false, locale = 'en', onDiagnostics }: LocalDocumentViewProps) {
  const [settled, setSettled] = useState(!staticFirst);
  useEffect(() => { if (staticFirst) setSettled(true); }, [staticFirst]);
  const renderedMode = mode === 'interactive' && staticFirst && !settled ? 'static' : mode;
  const enableCss = document.html?.enableCss === true;
  const enableJavaScript = renderedMode === 'interactive' && document.html?.enableJavaScript === true;
  const enableExtendedHtml = document.html?.enableExtendedHtml === true;
  const policy = useMemo(() => ({ enableCss, enableJavaScript, enableExtendedHtml }), [enableCss, enableJavaScript, enableExtendedHtml]);
  const sourceFallback = document.nodes.length === 1 && document.nodes[0].type === 'fallback';
  // Compilation already validated the host budget. A second pass applies the
  // effective render policy (notably script-free static output) to the source.
  const result = useMemo(() => sourceFallback ? {markup: '', diagnostics: []} : sanitizeLocalHtmlDocument(document.source, policy,
    Math.max(DEFAULT_MAX_LOCAL_SYNTAX_NODES, document.source.length * 2 + 10)), [document.source, policy, sourceFallback]);
  const report = useRef(onDiagnostics);
  report.current = onDiagnostics;
  useEffect(() => { if (!sourceFallback) report.current?.(result.diagnostics); }, [result, sourceFallback]);
  if (sourceFallback || result.diagnostics.some(item => item.severity === 'error')) {
    return <LocalHtmlSourceFallback source={document.source} mode={renderedMode} />;
  }
  return <article className={`md-document local-document reactive-md-native-document${renderedMode === 'static' ? ' local-static' : ''}`} data-source-mode="html" data-render-mode={renderedMode}>
    <iframe
      key={`${Number(enableCss)}${Number(enableJavaScript)}${Number(enableExtendedHtml)}:${document.source}`}
      className="reactive-md-native-frame"
      title={localize(locale, 'HTML document', 'HTML 文档')}
      sandbox={localHtmlSandbox(policy)}
      referrerPolicy="no-referrer"
      srcDoc={result.markup}
      style={{ display: 'block', width: '100%', minHeight: '60vh', border: 0, background: '#fff', colorScheme: 'light' }}
    />
  </article>;
}

/** Keep the two render paths in separate components so mode changes obey hook ordering. */
export function LocalDocumentView(props: LocalDocumentViewProps) {
  assertExtensionProps(props.reactConfig, props);
  // One render pass: static prop diagnostics are deduplicated inside it and
  // reset for the next independent render/SSR pass.
  beginLocalComponentRender(props.runtime);
  return props.document.html
    ? <LocalDocumentViewHtml {...props} />
    : <LocalDocumentViewLocal {...props} />;
}

function LocalDocumentViewLocal({
  document,
  runtime,
  onDiagnostics,
  urlPolicy,
  locale = 'en',
  themes,
  colorScheme = 'auto',
  mode = 'interactive',
  staticFirst = false,
  imageResolver,
  hostData,
  hostRenderer,
  reactConfig,
  externalValues,
  onSourceNavigate,
}: LocalDocumentViewProps) {
  const [staticFirstSettled, setStaticFirstSettled] = useState(!staticFirst);
  useEffect(() => {
    if (staticFirst) setStaticFirstSettled(true);
  }, [staticFirst]);
  const renderedMode: LocalRenderMode = mode === 'interactive' && staticFirst && !staticFirstSettled
    ? 'static'
    : mode;
  const instanceId = useId();
  const t = useMemo<Localize>(
    () => (en: string, zh: string) => localize(locale, en, zh),
    [locale],
  );
  // Installed contracts also own navigation semantics.
  const effectiveReactConfig = useMemo(
    () => reactConfig ?? getBuiltinReactConfig(),
    [reactConfig],
  );
  const registry = useMemo(() => {
    try { return getLocalComponentRegistry(effectiveReactConfig.config); }
    catch { return []; }
  }, [effectiveReactConfig]);
  // Anchor ids, footnote numbering and dependency analysis are projections of
  // the document: a prose-only edit keeps their identity, so the render
  // environment (and every memoized block) stays stable.
  const anchors = useProjectedMemo(
    document,
    value => projectAnchors(value, registry),
    sameAnchorProjection,
    () => createHeadingAnchors(document, `local-heading-${instanceId}`, true, registry),
  );
  // Numbering and ids are instance-scoped: two documents on one page never
  // share footnote targets, and every reference keeps a stable id.
  const footnotes = useProjectedMemo(
    document,
    projectFootnotes,
    sameFootnoteProjection,
    () => collectLocalFootnotes(document, instanceId),
  );
  // A failing collector degrades to the wildcard index, so the view stays
  // correct (every block re-renders) instead of losing content.
  const dependencyIndex = useDependencyIndex(document);
  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  const rootRef = useRef<HTMLElement>(null);
  const report = useCallback((diagnostics: Diagnostic[]) => {
    reportRef.current?.(diagnostics);
  }, []);

  // Builtin components always render through the public manifest index. When
  // the host supplies a React config it already carries the same preset, so
  // one lookup path serves default and external components.
  const definitions = useMemo(() => {
    // Installed manifests own rendering semantics. Carried definitions are
    // validated by the contract preflight below but never override the
    // installed registry.
    const map = new Map<string, LocalComponentDefinition>();
    for (const definition of registry) map.set(definition.name, definition);
    return map;
  }, [registry]);

  // The document's extension requirements select installed implementations.
  // A mismatch is reported and keeps the placeholders visible instead of
  // executing a component whose manifest no longer matches. Requirements are
  // compared by content so an unchanged recompile keeps the renderer stable.
  const extensionKey = useMemo(() => {
    try {
      return `${effectiveReactConfig.config.key}\u0000${JSON.stringify(document.extensions ?? null)}`;
    } catch {
      return `${effectiveReactConfig.config.key}\u0000unreadable`;
    }
  }, [effectiveReactConfig, document.extensions]);
  const extensionCheck = useMemo(() => {
    const diagnostics = validateLocalExtensionRequirements(
      document.extensions,
      effectiveReactConfig.config,
    );
    return { valid: diagnostics.length === 0, diagnostics };
  }, [effectiveReactConfig, extensionKey]);
  // Carried contracts are validated against the installed manifests. The
  // installed registry still owns rendering semantics; mismatches surface as
  // diagnostics before the component tree is mounted.
  const contractCheck = useMemo(() => validateLocalComponentContracts({
    document,
    installed: registry,
    externalNames: new Set(effectiveReactConfig.config.components.map(definition => definition.name)),
  }), [document, registry, effectiveReactConfig]);
  const extensionDiagnostics = useMemo(
    () => [...extensionCheck.diagnostics, ...contractCheck],
    [extensionCheck, contractCheck],
  );
  const extensionContractsValid = extensionDiagnostics.length === 0;
  const extensionReport = useRef('');
  useEffect(() => {
    const signature = diagnosticsSignature(extensionDiagnostics);
    if (signature === extensionReport.current) return;
    const hadPrevious = extensionReport.current !== '';
    extensionReport.current = signature;
    if (extensionDiagnostics.length > 0 || hadPrevious) report(extensionDiagnostics);
  }, [extensionDiagnostics, report]);
  const componentRenderer = useMemo(
    () => localReactExtensionRenderer(extensionContractsValid ? effectiveReactConfig : getBuiltinReactConfig()),
    [effectiveReactConfig, extensionContractsValid],
  );
  const extensionRenderer = useMemo(
    () => (reactConfig !== undefined && extensionContractsValid
      ? localReactExtensionRenderer(effectiveReactConfig)
      : undefined),
    [reactConfig, effectiveReactConfig, extensionContractsValid],
  );
  const effectiveThemes = reactConfig?.themes ?? themes;

  // External values update the existing runtime only; source compilation and
  // reader parameters are untouched.
  const externalRef = useRef(externalValues);
  externalRef.current = externalValues;
  useEffect(() => {
    const values = externalRef.current;
    if (!values) return;
    try {
      const diagnostics = runtime.setExternalValues(values);
      if (diagnostics.length) report(diagnostics);
    } catch {
      // A disposed runtime has nothing left to update.
    }
  }, [runtime, document, externalValues, report]);

  // Preview-to-source navigation. Source metadata is emitted only when a host
  // callback is present; the click handler ignores interactive descendants so
  // dragging a slider, sorting a table or following a link keeps its behavior.
  const navigateRef = useRef(onSourceNavigate);
  navigateRef.current = onSourceNavigate;
  const sourceNavigation = useMemo<((target: LocalSourceTarget) => void) | undefined>(
    () => (onSourceNavigate === undefined
      ? undefined
      : (target) => {
          try {
            navigateRef.current?.(target);
          } catch {
            /* A host navigation failure must not break rendering. */
          }
        }),
    [onSourceNavigate === undefined],
  );
  const handleSourceClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!sourceNavigation) return;
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    if (origin.closest('input, textarea, select, button, a, summary, [contenteditable="true"], [role="button"]')) return;
    const target = origin.closest<HTMLElement>('[data-rmd-source-start]');
    if (!target || !rootRef.current?.contains(target)) return;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (selection && selection.toString().trim()) return;
    const start = Number(target.dataset.rmdSourceStart);
    const end = Number(target.dataset.rmdSourceEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return;
    const componentName = target.dataset.rmdSourceComponent;
    sourceNavigation({
      range: { start, end },
      nodeId: target.dataset.rmdSourceNode ?? '',
      nodeType: target.dataset.rmdSourceType ?? '',
      ...(componentName ? { componentName } : {}),
    });
  }, [rootRef, sourceNavigation]);

  // Theme resolution only depends on manifest content, so a host array with
  // identical entries never restarts the reporting effect.
  const themesKey = themesSignature(effectiveThemes);
  const theme = useMemo(() => {
    try {
      return resolveLocalTheme(document.theme, effectiveThemes, document.themeRange, document.source);
    } catch {
      // Malformed host input resolves to the built-in theme, never a crash.
      return { name: DEFAULT_LOCAL_THEME.name, diagnostics: [] as Diagnostic[] };
    }
  }, [document.theme, document.themeRange?.start, document.themeRange?.end, document.source, themesKey]);

  const resolvedScheme = useResolvedColorScheme(rootRef, colorScheme);

  // Theme warnings are the only diagnostics this component owns. They are
  // reported once per distinct resolution and cleared when it becomes valid.
  const themeReport = useRef('');
  useEffect(() => {
    const signature = diagnosticsSignature(theme.diagnostics);
    if (signature === themeReport.current) return;
    const hadPrevious = themeReport.current !== '';
    themeReport.current = signature;
    if (theme.diagnostics.length > 0 || hadPrevious) report(theme.diagnostics);
  }, [theme, report]);

  const subscribe = useCallback(
    (listener: () => void) => {
      try {
        return runtime.subscribe(listener);
      } catch {
        return () => {};
      }
    },
    [runtime],
  );
  const getSnapshot = useCallback(() => {
    try {
      return runtime.snapshot();
    } catch {
      return EMPTY_SNAPSHOT;
    }
  }, [runtime]);

  // A single subscription drives the whole document. Every control reads the
  // current snapshot through runtime.get during the resulting render.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Advisory rules are read after the subscription so the hints reflect the
  // revision that triggered this render. The runtime caches per revision.
  // Ranges are excluded from the identity key: moving a rule in the source
  // does not change which fields it targets.
  let validationKey = '';
  if (document.validations?.length) {
    try { validationKey = validationDiagnosticKey(document, runtime.validate()); }
    catch { validationKey = 'unavailable'; }
  }
  const validation = useStableValidation(
    document,
    runtime,
    instanceId,
    t,
    `${document.validations?.length ? validationProjectionKey(document) : ''}\u0000${validationKey}`,
  );

  // Stable across revisions: each field comes from a prop, a memo, or the
  // dependency index, so memoized blocks keep their previous output.
  const env = useMemo<RenderEnv>(
    () => ({
      runtime,
      rootRef,
      urlPolicy,
      imageResolver,
      hostData,
      hostRenderer: extensionContractsValid ? hostRenderer : undefined,
      extensionRenderer,
      componentRenderer,
      definitions,
      anchors,
      t,
      locale,
      mode: renderedMode,
      dependencies: dependencyIndex,
      footnotes,
      sourceNavigation,
      validation,
      report,
    }),
    [runtime, rootRef, urlPolicy, imageResolver, hostData, hostRenderer, extensionContractsValid, extensionRenderer, componentRenderer, definitions, anchors, t, locale, renderedMode, dependencyIndex, footnotes, sourceNavigation, validation, report],
  );

  // Revision-independent deps keep this closure and the provider value stable
  // so a revision never invalidates memoized blocks by context alone. `visible`
  // is constant here: visibility travels through block props, not the context.
  const render = useCallback(
    (nodes?: LocalNode[], nextVisible = true): ReactNode =>
      renderNodes(env, nodes ?? [], nextVisible),
    [env],
  );
  const contextValue = useMemo<LocalViewContext>(
    () => ({
      runtime,
      render,
      definitions,
      locale,
      visible: true,
      mode: renderedMode,
      imageResolver,
      validation,
      report,
      urlPolicy,
      anchors,
      rootRef,
      t,
      dependencies: dependencyIndex,
      footnotes,
      sourceNavigation,
    }),
    [runtime, render, definitions, locale, report, urlPolicy, imageResolver, renderedMode, anchors, rootRef, t, validation, dependencyIndex, footnotes, sourceNavigation],
  );

  return (
    <LocalLocaleProvider locale={locale}>
      <article
        ref={rootRef}
        className={`md-document local-document${renderedMode === 'static' ? ' local-static' : ''}`}
        data-rmd-theme={theme.name}
        data-color-scheme={resolvedScheme}
        data-render-mode={renderedMode}
        data-rmd-long-prose={document.nodes.length >= 200 ? '' : undefined}
        style={{ colorScheme: resolvedScheme }}
        onClick={sourceNavigation ? handleSourceClick : undefined}
        aria-label={
          renderedMode === 'static'
            ? t('Static document', '静态文档')
            : t('Interactive document', '交互文档')
        }
      >
        <LocalViewContext.Provider value={contextValue}>
          {extensionDiagnostics.length > 0 ? (
            <div
              className="local-extension-error"
              role="alert"
              data-local-extension-error=""
              data-rmd-extension-error={extensionDiagnostics.map((diagnostic) => diagnostic.message).join('; ')}
            >
              {extensionDiagnostics.map((diagnostic, index) => (
                <p key={`${diagnostic.code}-${index}`}>{diagnostic.message}</p>
              ))}
            </div>
          ) : null}
          {render(document.nodes, true)}
          {footnotes.entries.length > 0 ? (
            <EndnotesView
              entries={footnotes.entries}
              env={env}
              t={t}
              titleId={`${instanceId}-footnotes-title`}
            />
          ) : null}
        </LocalViewContext.Provider>
      </article>
    </LocalLocaleProvider>
  );
}

/**
 * Optional private compile path supplied by the incremental compiler. It
 * returns a read-only result whose unchanged nodes keep their identity; the
 * public `compile` protocol is unaffected.
 */
interface SharedCompileSession {
  compileShared?(source: string, options?: LocalCompileOptions): LocalCompileResult;
}

export function LocalReactiveDocument({
  source,
  onDiagnostics,
  urlPolicy,
  locale = 'en',
  themes,
  colorScheme = 'auto',
  mode = 'interactive',
  staticFirst = false,
  imageResolver,
  hostData,
  hostRenderer,
  reactConfig,
  externalValues,
  initialParameters,
  onParametersChange,
  onSourceNavigate,
  compileOptions,
}: LocalReactiveDocumentProps) {
  assertExtensionProps(reactConfig, { hostData, hostRenderer, themes });
  if (reactConfig !== undefined) {
    const optionConfig = compileOptions?.config;
    if (optionConfig !== undefined && optionConfig !== reactConfig.config) {
      let same = false;
      try {
        same = readLocalConfig(optionConfig).key === reactConfig.config.key;
      } catch {
        same = false;
      }
      if (!same) throw new Error('reactConfig and compileOptions.config must be the same local config.');
    }
    if (compileOptions?.hostComponents !== undefined) {
      throw new Error('reactConfig cannot be combined with compileOptions.hostComponents.');
    }
  }
  // Flags, limits and Markdown options still apply; only the component registry
  // is selected by the config.
  const effectiveCompileOptions: LocalCompileOptions | undefined = reactConfig === undefined
    ? compileOptions
    : { ...(compileOptions ?? {}), config: reactConfig.config };
  const effectiveThemes = reactConfig?.themes ?? themes;
  const optionsKey = localCompileOptionsKey(effectiveCompileOptions);
  // The latest external values seed a newly created runtime; later changes go
  // through the view's update effect without recompiling or resetting state.
  const externalRef = useRef(externalValues);
  externalRef.current = externalValues;
  const initialParametersRef = useRef(initialParameters);
  initialParametersRef.current = initialParameters;
  const onParametersChangeRef = useRef(onParametersChange);
  onParametersChangeRef.current = onParametersChange;
  /** Diagnostics from applying initial parameters to the current runtime. */
  const initialDiagnosticsRef = useRef<Diagnostic[]>([]);
  const initializeRuntime = (document: LocalDocument): LocalRuntime => {
    const created = createLocalRuntime(document, externalRef.current === undefined ? undefined : { externalValues: externalRef.current });
    const initial = initialParametersRef.current;
    initialDiagnosticsRef.current = initial && Object.keys(initial).length
      ? created.setParameters(cloneParameterValues(initial)) : [];
    return created;
  };
  const compileSession = useRef<LocalCompileSession | null>(null);
  const sessionOptionsKey = useRef<string | null>(null);
  const result = useMemo(() => {
    // Option changes start a fresh session; ordinary source edits reuse it so
    // the compiler can keep its block cache and structural sharing.
    if (!compileSession.current || sessionOptionsKey.current !== optionsKey) {
      compileSession.current?.dispose();
      compileSession.current = createLocalCompileSession();
      sessionOptionsKey.current = optionsKey;
    }
    const session = compileSession.current as LocalCompileSession & SharedCompileSession;
    // `compileShared` keeps object identity for unchanged nodes. Until it is
    // available the public compile path still produces a valid document.
    return typeof session.compileShared === 'function'
      ? session.compileShared(source, effectiveCompileOptions)
      : session.compile(source, effectiveCompileOptions);
  }, [source, optionsKey]);

  const runtimeRef = useRef<LocalRuntime | null>(null);
  const runtimeOptionsKey = useRef<string | null>(null);
  const retiredRuntimes = useRef<LocalRuntime[]>([]);
  const pendingNotify = useRef(false);

  // Keep the runtime object (and its subscriptions, tokens and expression
  // cache) across source edits and adopt the new document in place instead of
  // constructing a fresh runtime for every result.
  let runtime = runtimeRef.current;
  if (!result.ok) {
    // Keep the ref until this render commits; a discarded render must not
    // release a runtime the committed tree still uses. The commit effect
    // below disposes it.
    runtime = null;
  } else {
    const nextDocument = result.document;
    if (runtime && runtimeOptionsKey.current !== optionsKey) {
      // Host options (including HTML capabilities) may change document
      // semantics, so the previous runtime is released rather than migrated.
      retiredRuntimes.current.push(runtime);
      runtime = null;
      runtimeRef.current = null;
    }
    if (!runtime) {
      try {
        runtime = initializeRuntime(nextDocument);
      } catch {
        runtime = null;
      }
      runtimeRef.current = runtime;
    } else if (runtime.document !== nextDocument) {
      let adopted = false;
      try {
        const update = updateLocalRuntime(runtime, nextDocument, { notify: false });
        adopted = update.ok;
        // Subscribers are notified after React commits; notifying here would
        // trigger cross-component updates during this render.
        if (update.ok && update.changed) pendingNotify.current = true;
      } catch {
        adopted = false;
      }
      if (!adopted) {
        retiredRuntimes.current.push(runtime);
        let replacement: LocalRuntime | null = null;
        try {
          replacement = initializeRuntime(nextDocument);
        } catch {
          replacement = null;
        }
        runtime = replacement;
        runtimeRef.current = replacement;
      }
    }
    runtimeOptionsKey.current = optionsKey;
  }

  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  const mounted = useRef(0);

  // Theme/color-mode props never feed the compilation above, so changing them
  // re-renders the document without recreating state.
  const themesKey = themesSignature(effectiveThemes);
  const themeDiagnostics = useMemo(() => {
    if (!result.ok) return [] as Diagnostic[];
    try {
      return resolveLocalTheme(
        result.document.theme,
        effectiveThemes,
        result.document.themeRange,
        result.document.source,
      ).diagnostics;
    } catch {
      return [] as Diagnostic[];
    }
  }, [result, themesKey]);

  // Host callbacks see compile, theme, initial-parameter and runtime write
  // diagnostics together.
  const lastReport = useRef<string | null>(null);
  const emit = useCallback((diagnostics: Diagnostic[]) => {
    const signature = diagnosticsSignature(diagnostics);
    if (signature === lastReport.current) return;
    lastReport.current = signature;
    reportRef.current?.(diagnostics);
  }, []);
  const viewDiagnostics = useRef<Diagnostic[]>([]);
  const flush = useCallback(() => {
    emit(composeDiagnostics(
      result.diagnostics,
      themeDiagnostics,
      initialDiagnosticsRef.current,
      viewDiagnostics.current,
    ));
  }, [result, themeDiagnostics, emit]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    viewDiagnostics.current = [];
  }, [result]);

  useEffect(() => {
    flush();
  }, [flush]);

  const handleViewDiagnostics = useCallback(
    (diagnostics: Diagnostic[]) => {
      viewDiagnostics.current = diagnostics;
      flushRef.current();
    },
    [],
  );

  /**
   * Parameter bridge: subscribe after initialization, compare the public
   * writable set on each commit and notify once per actual change. Values that
   * did not change and rejected writes never notify. External-only updates do
   * not change the public parameter set.
   */
  useEffect(() => {
    if (!runtime) return;
    flushRef.current();
    let active = true;
    let last: Readonly<Record<string, LocalValue>>;
    try {
      last = runtime.getParameters();
    } catch {
      return;
    }
    let unsubscribe: () => void = () => {};
    try {
      unsubscribe = runtime.subscribe(() => {
        if (!active) return;
        let current: Readonly<Record<string, LocalValue>>;
        let snapshot: LocalSnapshot;
        try {
          current = runtime.getParameters();
          snapshot = runtime.snapshot();
        } catch {
          return;
        }
        if (parameterRecordsEqual(last, current)) return;
        last = current;
        try {
          onParametersChangeRef.current?.(current, snapshot);
        } catch {
          // A host callback must not break the runtime commit.
        }
      });
    } catch {
      return;
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [runtime]);

  useEffect(() => {
    mounted.current += 1;
    return () => {
      mounted.current -= 1;
      // StrictMode runs setup, cleanup, then setup synchronously. Deferring
      // disposal one microtask lets that remount re-claim the same resources;
      // a real unmount reaches zero and releases both the runtime and session.
      queueMicrotask(() => {
        if (mounted.current !== 0) return;
        const owned = runtimeRef.current;
        runtimeRef.current = null;
        try {
          owned?.dispose();
        } catch {
          /* Disposal is best-effort during unmount. */
        }
        try {
          compileSession.current?.dispose();
        } catch {
          /* Disposal is best-effort during unmount. */
        }
        compileSession.current = null;
        sessionOptionsKey.current = null;
      });
    };
  }, []);

  // Commit-time bookkeeping: release runtimes replaced by a compile error,
  // option change or a failed migration, then announce a staged document
  // update to subscribers. Running after commit avoids notifying React
  // components from inside a render.
  useEffect(() => {
    const retired = retiredRuntimes.current;
    retiredRuntimes.current = [];
    for (const owned of retired) {
      queueMicrotask(() => {
        if (runtimeRef.current === owned) return;
        try {
          owned.dispose();
        } catch {
          /* Disposal is best-effort. */
        }
      });
    }
    if (!result.ok || !runtime) {
      // A committed compile error (or an unusable document) releases the
      // runtime and compile session only after the error tree is visible.
      const owned = runtimeRef.current;
      if (owned) {
        runtimeRef.current = null;
        runtimeOptionsKey.current = null;
        queueMicrotask(() => {
          if (runtimeRef.current === owned) return;
          try {
            owned.dispose();
          } catch {
            /* Disposal is best-effort. */
          }
        });
      }
      if (compileSession.current) {
        compileSession.current.dispose();
        compileSession.current = null;
        sessionOptionsKey.current = null;
      }
    }
    if (pendingNotify.current) {
      pendingNotify.current = false;
      const current = runtimeRef.current;
      if (current) notifyLocalRuntime(current);
    }
  });

  if (!result.ok || !runtime) {
    const options = readLocalCompileOptions(effectiveCompileOptions);
    if (typeof source === 'string' && options.ok && options.htmlActive) {
      return <LocalHtmlSourceFallback source={source} mode={mode} />;
    }
    return (
      <div
        className={`md-document local-document local-inactive${mode === 'static' ? ' local-static' : ''}`}
        data-render-mode={mode}
        role="alert"
      >
        <p className="local-inactive-title">
          {result.ok
            ? localize(
                locale,
                'Interactive initialization failed; preview is disabled.',
                '交互初始化失败，预览已停用。',
              )
            : localize(
                locale,
                'The document contains syntax errors; interactive preview is disabled.',
                '文档包含语法错误，交互预览已停用。',
              )}
        </p>
        {result.diagnostics.length ? (
          <ul className="local-inactive-list">
            {result.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`}>
                {formatLocalDiagnostic(diagnostic, locale)}
                {localize(
                  locale,
                  ` (line ${diagnostic.line}, column ${diagnostic.column})`,
                  `（第 ${diagnostic.line} 行，第 ${diagnostic.column} 列）`,
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <LocalDocumentView
      // Re-mount only when host options change; source edits update the
      // document and runtime in place so unchanged blocks keep their state.
      key={optionsKey}
      document={result.document}
      runtime={runtime}
      onDiagnostics={handleViewDiagnostics}
      urlPolicy={urlPolicy}
      locale={locale}
      themes={reactConfig === undefined ? themes : undefined}
      colorScheme={colorScheme}
      mode={mode}
      staticFirst={staticFirst}
      imageResolver={imageResolver}
      hostData={hostData}
      hostRenderer={hostRenderer}
      reactConfig={reactConfig}
      externalValues={externalValues}
      onSourceNavigate={onSourceNavigate}
    />
  );
}

