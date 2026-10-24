import {
  Component,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  Diagnostic,
  LocalDocument,
  LocalNode,
  LocalRuntime,
  LocalSnapshot,
  LocalValue,
} from './types';
import type { LocalRenderContext, LocalRenderMode } from './render-types';
import { compileLocal } from './compiler';
import { createLocalRuntime } from './runtime';
import { MAX_LOCAL_STRING_LENGTH, isLocalEmail } from './limits';
import { LatexView } from './math-view';
import { LocalVisual } from './visuals';
import { createHeadingAnchors } from './heading-anchors';
import { isLocalColor } from './colors';
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
}

/* --------------------------------------------------------------- contexts */

interface LocalViewContext extends LocalRenderContext {
  report: (diagnostics: Diagnostic[]) => void;
  urlPolicy?: LocalUrlPolicy;
  imageResolver?: LocalImageResolver;
  anchors: ReturnType<typeof createHeadingAnchors>;
  /** The document root; jump navigation stays scoped to this instance. */
  rootRef: RefObject<HTMLElement | null>;
  t: Localize;
}

const LocalViewContext = createContext<LocalViewContext | null>(null);

function useLocal(): LocalViewContext {
  const value = useContext(LocalViewContext);
  if (!value) throw new Error('LocalViewContext is not initialized');
  return value;
}

/* ------------------------------------------------------------- attributes */

const FULL_EXPRESSION = /^\s*\{\{([\s\S]*)\}\}\s*$/;
const EMPTY_SNAPSHOT: LocalSnapshot = { revision: 0, state: {} };

type ReadAttr =
  | { present: false }
  | { present: true; ok: true; value: LocalValue }
  | { present: true; ok: false };

function rawAttr(node: LocalNode, name: string): string | undefined {
  return node.attrs?.[name];
}

function readAttr(runtime: LocalRuntime, node: LocalNode, name: string): ReadAttr {
  const raw = rawAttr(node, name);
  if (raw === undefined) return { present: false };
  const full = FULL_EXPRESSION.exec(raw);
  if (!full) return { present: true, ok: true, value: raw };
  try {
    return { present: true, ok: true, value: runtime.evaluate(full[1]) };
  } catch {
    return { present: true, ok: false };
  }
}

function scalarText(value: LocalValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function textAttr(
  runtime: LocalRuntime,
  node: LocalNode,
  name: string,
  fallback = '',
  t: Localize = defaultLocalize,
): string {
  const raw = rawAttr(node, name);
  if (raw === undefined) return fallback;
  const full = FULL_EXPRESSION.exec(raw);
  try {
    if (full) return scalarText(runtime.evaluate(full[1])) ?? t('Cannot compute', '无法计算');
    return runtime.text(raw);
  } catch {
    return t('Cannot compute', '无法计算');
  }
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

function boolAttr(runtime: LocalRuntime, node: LocalNode, name: string, fallback = false): boolean {
  const read = readBooleanAttr(runtime, node, name, fallback);
  return read.ok ? read.value : fallback;
}

function runtimeRevision(runtime: LocalRuntime): number {
  try {
    return runtime.snapshot().revision;
  } catch {
    return 0;
  }
}

function numberAttr(runtime: LocalRuntime, node: LocalNode, name: string, fallback: number): number {
  const raw = rawAttr(node, name);
  if (raw === undefined) return fallback;
  const full = FULL_EXPRESSION.exec(raw);
  try {
    const value = full ? runtime.evaluate(full[1]) : Number(raw);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function currentValue(runtime: LocalRuntime, node: LocalNode): LocalValue {
  try {
    return runtime.get(node);
  } catch {
    return null;
  }
}

function displayValue(value: LocalValue): string {
  return scalarText(value) ?? '';
}

/* ----------------------------------------------------------- static values */

const EMPTY_STATIC_VALUE = '—';

/** Empty or whitespace-only stored values read as an em dash in static mode. */
function staticText(value: string): string {
  return value.trim() === '' ? EMPTY_STATIC_VALUE : value;
}

interface StaticValueProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
  multiline?: boolean;
}

/** Read-only label/value summary shared by static controls. */
function StaticValue({ label, value, hint, className = '', multiline = false }: StaticValueProps) {
  return (
    <div className={`md-control local-static-control ${className}`.trim()}>
      <span className="md-label">{label}</span>
      <span
        className={`local-static-value${multiline ? ' local-static-multiline' : ''}`}
        data-local-static-value=""
      >
        {value}
      </span>
      {hint ? <span className="md-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Screen-reader hidden value used by interactive markup so Ctrl+P prints the
 * current runtime state without JavaScript. Print styles hide the form
 * controls and reveal this node.
 */
function PrintValue({ value, block = false }: { value: ReactNode; block?: boolean }) {
  if (block) {
    return (
      <div
        className="local-print-value local-print-block"
        aria-hidden="true"
        data-local-print-value=""
      >
        {value}
      </div>
    );
  }
  return (
    <span className="local-print-value" aria-hidden="true" data-local-print-value="">
      {value}
    </span>
  );
}

/* ------------------------------------------------------------------ color */

/**
 * The compiler already rejects anything outside the bounded color whitelist.
 * Re-check here so a hand-built or mutated `LocalDocument` can never smuggle
 * an arbitrary CSS value into the rendered style.
 */
function localColor(node: LocalNode): string | undefined {
  const raw = rawAttr(node, 'color');
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value !== '' && isLocalColor(value) ? value : undefined;
}

/** Accent tokens consumed by local.css; absent colors fall back to the theme. */
function accentStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    '--local-accent': color,
    '--local-accent-soft': `color-mix(in srgb, ${color} 14%, var(--surface))`,
    '--local-accent-strong': color,
  } as CSSProperties;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapToStep(value: number, min: number, max: number, step: number): number {
  const size = Number.isFinite(step) && step > 0 ? step : 1;
  const maximumSteps = Math.max(0, Math.floor((max - min) / size + 1e-9));
  const steps = Math.max(0, Math.min(maximumSteps, Math.round((value - min) / size)));
  const snapped = min + steps * size;
  return Number(snapped.toPrecision(15));
}

function slotNumber(runtime: LocalRuntime, node: LocalNode, slot: string, fallback: number): number {
  try {
    const value = runtime.get(node, slot);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function numericRange(
  runtime: LocalRuntime,
  node: LocalNode,
  minName: string,
  maxName: string,
  minFallback: number,
  maxFallback: number,
  stepFallback = 1,
): { min: number; max: number; step: number } {
  let min = numberAttr(runtime, node, minName, minFallback);
  let max = numberAttr(runtime, node, maxName, maxFallback);
  if (min > max) [min, max] = [max, min];
  const rawStep = numberAttr(runtime, node, 'step', stepFallback);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
  return { min, max, step };
}


/* ------------------------------------------------------------ state hooks */

function useWriter(node: LocalNode) {
  const { runtime, report } = useLocal();
  const t = useLocalize();
  const [error, setError] = useState<string | null>(null);
  const write = useCallback(
    (value: LocalValue, slot?: string): boolean => {
      try {
        const diagnostics = runtime.set(node, value, slot);
        if (diagnostics.length) {
          setError(diagnostics.map((item) => item.message).join('; '));
          report(diagnostics);
          return false;
        }
        setError(null);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('Cannot write', '无法写入'));
        return false;
      }
    },
    [node, report, runtime, t],
  );
  /** Multi-slot writes validate every value before committing one revision. */
  const writeMany = useCallback(
    (values: Record<string, LocalValue>): boolean => {
      try {
        const diagnostics = runtime.setMany(node, values);
        if (diagnostics.length) {
          setError(diagnostics.map((item) => item.message).join('; '));
          report(diagnostics);
          return false;
        }
        setError(null);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('Cannot write', '无法写入'));
        return false;
      }
    },
    [node, report, runtime, t],
  );
  return { write, writeMany, error, setError };
}

function useDisabled(node: LocalNode): { disabled: boolean; invalid: boolean } {
  const { runtime } = useLocal();
  const read = readBooleanAttr(runtime, node, 'disabled', false);
  // An unevaluable disabled expression must fail closed: never leave the
  // control editable just because the predicate could not be computed.
  return read.ok ? { disabled: read.value, invalid: false } : { disabled: true, invalid: true };
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

const VISUAL_COMPONENTS = new Set(['table', 'chart', 'plot', 'timeline', 'diagram']);

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
  urlPolicy?: LocalUrlPolicy;
  imageResolver?: LocalImageResolver;
  anchors: ReturnType<typeof createHeadingAnchors>;
  t: Localize;
  mode: LocalRenderMode;
}

function renderNodes(
  env: RenderEnv,
  nodes: LocalNode[] | undefined,
  visible: boolean,
  block = true,
): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) => renderNode(env, node, index, visible, block));
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

function renderNode(
  env: RenderEnv,
  node: LocalNode,
  index: number,
  visible: boolean,
  block = true,
): ReactNode {
  const key = node.id || `${node.type}-${index}`;

  if (node.type === 'component') {
    return (
      <LocalErrorBoundary key={key} revision={runtimeRevision(env.runtime)}>
        {renderComponent(node, visible, env.t)}
      </LocalErrorBoundary>
    );
  }

  switch (node.type) {
    case 'root':
      return <div key={key}>{renderNodes(env,node.children, visible)}</div>;

    case 'heading':
      return createElement(
        headingTag(node.depth),
        { key, id: env.anchors.ids.get(node) },
        renderNodes(env,node.children, visible, false),
      );

    case 'paragraph':
      return <p key={key}>{renderNodes(env,node.children, visible, false)}</p>;

    case 'text':
      return <span key={key}>{node.value ?? ''}</span>;

    case 'emphasis':
      return <em key={key}>{renderNodes(env,node.children, visible, false)}</em>;

    case 'strong':
      return <strong key={key}>{renderNodes(env,node.children, visible, false)}</strong>;

    case 'delete':
      return <del key={key}>{renderNodes(env,node.children, visible, false)}</del>;

    case 'inlineCode':
      return (
        <code className="md-inline-code" key={key}>
          {node.value ?? ''}
        </code>
      );

    case 'code': {
      const language = node.lang ? `language-${node.lang}` : undefined;
      return (
        <pre className="md-code" key={key}>
          <code className={language}>{node.value ?? ''}</code>
        </pre>
      );
    }

    case 'blockquote':
      return <blockquote key={key}>{renderNodes(env,node.children, visible)}</blockquote>;

    case 'break':
      return <br key={key} />;

    case 'thematicBreak':
      return <hr key={key} />;

    case 'list':
      return node.ordered ? (
        <ol key={key} start={node.start ?? 1} className="md-list">
          {renderNodes(env,node.children, visible)}
        </ol>
      ) : (
        <ul key={key} className="md-list">
          {renderNodes(env,node.children, visible)}
        </ul>
      );

    case 'listItem': {
      const task = typeof node.checked === 'boolean';
      return (
        <li key={key} className={task ? 'md-list-item md-task-item' : 'md-list-item'}>
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
      return (
        <a
          key={key}
          href={href}
          title={node.title ?? undefined}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
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
          <span className="md-image-rejected" key={key}>
            [{rejected}{alt}]
          </span>
        );
      }
      return (
        <img
          key={key}
          className="md-image"
          src={src}
          alt={node.alt ?? ''}
          title={node.title ?? undefined}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      );
    }

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
          <span className="local-interpolation" key={key}>
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

    // The parser turns unsupported footnotes into `fallback` nodes. These
    // branches only see a raw Markdown footnote AST (older trees or a partial
    // parse) and keep it visible instead of silently dropping it.
    case 'footnoteReference':
      return renderFallback(env, node, key, false);

    case 'footnoteDefinition':
      return renderFallback(env, node, key, block);

    case 'comment':
    case 'definition':
      return null;

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

function renderComponent(node: LocalNode, visible: boolean, t: Localize): ReactNode {
  const name = node.name ?? '';
  if (VISUAL_COMPONENTS.has(name)) {
    return <VisualView node={node} visible={visible} />;
  }
  const View = COMPONENTS[name];
  if (!View) {
    return (
      <span className="component-error">
        {t('Unknown component "', '未知组件“')}
        {name || t('(missing name)', '（缺少名称）')}
        {t('"', '”')}
      </span>
    );
  }
  return <View node={node} visible={visible} />;
}

function VisualView({ node, visible }: LocalComponentProps) {
  const { runtime, render, mode } = useLocal();
  return (
    <LocalVisual
      node={node}
      runtime={runtime}
      render={render}
      visible={visible}
      mode={mode}
    />
  );
}

/* ----------------------------------------------------------------- inputs */

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <span className="field-error" role="alert">
      {message}
    </span>
  );
}

function textProblem(
  value: string,
  options: {
    required: boolean;
    minLength?: number;
    maxLength?: number;
    email?: boolean;
  },
  t: Localize = defaultLocalize,
): string | null {
  if (options.required && value.length === 0) return t('This field is required', '请填写此字段');
  // Check the shared hard limit before the linear email shape check, so a huge
  // draft never reaches format validation.
  if (value.length > MAX_LOCAL_STRING_LENGTH) {
    return t(
      `At most ${MAX_LOCAL_STRING_LENGTH} characters`,
      `最多允许 ${MAX_LOCAL_STRING_LENGTH} 个字符`,
    );
  }
  if (options.email && value !== '' && !isLocalEmail(value)) {
    return t('Enter a valid email address', '请输入有效的邮箱地址');
  }
  const length = value.length;
  if (options.minLength !== undefined && options.minLength > 0 && value !== '' && length < options.minLength) {
    return t(`At least ${options.minLength} characters`, `至少需要 ${options.minLength} 个字符`);
  }
  if (options.maxLength !== undefined && options.maxLength >= 0 && length > options.maxLength) {
    return t(`At most ${options.maxLength} characters`, `最多允许 ${options.maxLength} 个字符`);
  }
  return null;
}

function InputView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', node.name ?? t('Input', '输入'), t);
  const placeholder = textAttr(runtime, node, 'placeholder', '', t);
  const typeRaw = rawAttr(node, 'type') ?? 'text';
  const email = typeRaw === 'email';
  const required = boolAttr(runtime, node, 'required', false);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const minLengthRaw = rawAttr(node, 'min-length');
  const maxLengthRaw = rawAttr(node, 'max-length');
  const minLength = minLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'min-length', 0)))
    : undefined;
  const maxLength = maxLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'max-length', 0)))
    : undefined;
  const display = displayValue(currentValue(runtime, node));

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(runtime, node, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  if (mode === 'static') {
    return (
      <StaticValue
        className={`local-input${email ? ' local-input-email' : ''}`}
        label={label}
        value={staticText(display)}
      />
    );
  }

  const problemFor = (value: string) =>
    textProblem(value, { required, minLength, maxLength, email }, t);

  return (
    <div className={`md-control local-input${email ? ' local-input-email' : ''}`}>
      <label className="md-label" htmlFor={`${domId}-input`}>
        {label}
      </label>
      <input
        id={`${domId}-input`}
        className="md-text-input"
        type={email ? 'email' : 'text'}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        aria-invalid={draftError || error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          const problem = problemFor(draft);
          setDraftError(problem);
          if (!problem && draft !== display) write(draft);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = event.target.value;
          setDraft(value);
          setError(null);
          if (touched) setDraftError(problemFor(value));
          if (!composing.current && problemFor(value) === null) write(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setDraft(value);
          if (touched) setDraftError(problemFor(value));
          if (problemFor(value) === null) write(value);
        }}
      />
      <PrintValue value={staticText(display)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : (draftError ?? error)} />
    </div>
  );
}

function TextareaView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Text', '文本'), t);
  const placeholder = textAttr(runtime, node, 'placeholder', '', t);
  const rows = Math.min(40, Math.max(1, Math.floor(numberAttr(runtime, node, 'rows', 4))));
  const required = boolAttr(runtime, node, 'required', false);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const minLengthRaw = rawAttr(node, 'min-length');
  const maxLengthRaw = rawAttr(node, 'max-length');
  const minLength = minLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'min-length', 0)))
    : undefined;
  const maxLength = maxLengthRaw !== undefined
    ? Math.max(0, Math.floor(numberAttr(runtime, node, 'max-length', 0)))
    : undefined;
  const display = displayValue(currentValue(runtime, node));

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(runtime, node, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-textarea"
        label={label}
        value={staticText(display)}
        multiline
      />
    );
  }

  const problemFor = (value: string) =>
    textProblem(value, { required, minLength, maxLength }, t);

  return (
    <div className="md-control local-textarea">
      <label className="md-label" htmlFor={`${domId}-textarea`}>
        {label}
      </label>
      <textarea
        id={`${domId}-textarea`}
        className="md-text-input"
        rows={rows}
        value={draft}
        placeholder={placeholder || undefined}
        disabled={disabled}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        aria-invalid={draftError || error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          const problem = problemFor(draft);
          setDraftError(problem);
          if (!problem && draft !== display) write(draft);
        }}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          const value = event.target.value;
          setDraft(value);
          setError(null);
          if (touched) setDraftError(problemFor(value));
          if (!composing.current && problemFor(value) === null) write(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setDraft(value);
          if (touched) setDraftError(problemFor(value));
          if (problemFor(value) === null) write(value);
        }}
      />
      <PrintValue value={staticText(display)} block />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : (draftError ?? error)} />
    </div>
  );
}

type NumberDraft =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: number };
function parseNumberDraft(text: string): NumberDraft {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.') {
    return { kind: 'empty' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { kind: 'invalid' };
  return { kind: 'valid', value };
}

function numberProblem(
  value: number,
  min: number | undefined,
  max: number | undefined,
  step: number,
  t: Localize = defaultLocalize,
): string | null {
  const tolerance = 1e-9 * Math.max(1, Math.abs(value));
  if (min !== undefined && value < min - tolerance) {
    return t(`Must be at least ${min}`, `不能小于 ${min}`);
  }
  if (max !== undefined && value > max + tolerance) {
    return t(`Must be at most ${max}`, `不能大于 ${max}`);
  }
  if (!Number.isFinite(step) || step <= 0) {
    return t('Step must be greater than 0', '步长必须大于 0');
  }
  const base = min ?? 0;
  const quotient = (value - base) / step;
  const nearest = Math.round(quotient);
  if (Math.abs(quotient - nearest) > 1e-9 * Math.max(1, Math.abs(quotient))) {
    return t(`Must be a multiple of ${step}`, `需要按步长 ${step} 取值`);
  }
  return null;
}

function NumberView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Number', '数字'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const minPresent = rawAttr(node, 'min') !== undefined;
  const maxPresent = rawAttr(node, 'max') !== undefined;
  const min = minPresent ? numberAttr(runtime, node, 'min', 0) : undefined;
  const max = maxPresent ? numberAttr(runtime, node, 'max', 0) : undefined;
  const step = numberAttr(runtime, node, 'step', 1);
  const stored = currentValue(runtime, node);
  const display = typeof stored === 'number' && Number.isFinite(stored) ? String(stored) : '';

  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const composing = useRef(false);
  const lastDisplay = useRef(display);
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (lastDisplay.current !== display) {
      lastDisplay.current = display;
      if (!focused && !composing.current) setDraft(display);
    }
  }, [display, focused]);

  useResetToken(runtime, node, () => {
    composing.current = false;
    setDraft(displayRef.current);
    setTouched(false);
    setDraftError(null);
    setError(null);
  });

  const hint = (
    <>
      {min !== undefined ? t(`Min ${min}`, `最小 ${min}`) : ''}
      {min !== undefined && max !== undefined ? ' · ' : ''}
      {max !== undefined ? t(`Max ${max}`, `最大 ${max}`) : ''}
      {step !== undefined ? t(` · Step ${step}`, ` · 步长 ${step}`) : ''}
    </>
  );

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-number"
        label={label}
        value={staticText(display)}
        hint={hint}
      />
    );
  }

  const commitText = (text: string, reportProblem: boolean): boolean => {
    const parsed = parseNumberDraft(text);
    if (parsed.kind !== 'valid') {
      if (reportProblem) setDraftError(t('Enter a valid number', '请输入有效数字'));
      return false;
    }
    const problem = numberProblem(parsed.value, min, max, step, t);
    if (problem) {
      if (reportProblem) setDraftError(problem);
      return false;
    }
    setDraftError(null);
    return write(parsed.value);
  };

  return (
    <div className="md-control local-number">
      <label className="md-label" htmlFor={`${domId}-number`}>
        {label}
      </label>
      <input
        id={`${domId}-number`}
        className="md-text-input"
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-invalid={draftError || error ? true : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setTouched(true);
          commitText(draft, true);
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const text = event.target.value;
          setDraft(text);
          setError(null);
          if (!composing.current) commitText(text, touched);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          commitText(event.currentTarget.value, touched);
        }}
      />
      <PrintValue value={staticText(display)} />
      {min !== undefined || max !== undefined || step !== undefined ? (
        <span className="md-hint">{hint}</span>
      ) : null}
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : (draftError ?? error)} />
    </div>
  );
}

function SliderView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Slider', '滑块'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const min = numberAttr(runtime, node, 'min', 0);
  const max = numberAttr(runtime, node, 'max', 100);
  const step = numberAttr(runtime, node, 'step', 1);
  const stored = currentValue(runtime, node);
  const rawValue = typeof stored === 'number' && Number.isFinite(stored) ? stored : min;
  const value = Math.min(max, Math.max(min, rawValue));

  if (mode === 'static') {
    return (
      <StaticValue
        className="md-slider local-slider"
        label={label}
        value={String(value)}
      />
    );
  }

  return (
    <div className="md-control md-slider local-slider" style={accentStyle(localColor(node))}>
      <label className="md-label" htmlFor={`${domId}-slider`}>
        <span>{label}</span>
        <span className="md-slider-value" aria-hidden="true">
          {value}
        </span>
      </label>
      <input
        id={`${domId}-slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => write(Number(event.target.value))}
      />
      <PrintValue value={String(value)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

function ToggleView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Toggle', '开关'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const checked = currentValue(runtime, node) === true;
  const stateLabel = checked ? t('On', '开') : t('Off', '关');

  if (mode === 'static') {
    return <StaticValue className="md-toggle local-toggle" label={label} value={stateLabel} />;
  }

  return (
    <div className="md-control md-toggle local-toggle" style={accentStyle(localColor(node))}>
      <label className="md-toggle-label" htmlFor={`${domId}-toggle`}>
        <input
          id={`${domId}-toggle`}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <PrintValue value={stateLabel} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

function CheckboxView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Checkbox', '勾选'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const checked = currentValue(runtime, node) === true;
  const stateLabel = checked ? t('Checked', '已勾选') : t('Unchecked', '未勾选');

  if (mode === 'static') {
    return <StaticValue className="local-checkbox" label={label} value={stateLabel} />;
  }

  return (
    <div className="md-control local-checkbox" style={accentStyle(localColor(node))}>
      <label className="md-toggle-label" htmlFor={`${domId}-checkbox`}>
        <input
          id={`${domId}-checkbox`}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <PrintValue value={stateLabel} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

function DateView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Date', '日期'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const required = boolAttr(runtime, node, 'required', false);
  const min = textAttr(runtime, node, 'min', '', t);
  const max = textAttr(runtime, node, 'max', '', t);
  const stored = currentValue(runtime, node);
  const value = typeof stored === 'string' ? stored : '';
  const [touched, setTouched] = useState(false);
  const problem = touched && required && value === '' ? t('Select a date', '请选择日期') : null;

  if (mode === 'static') {
    return <StaticValue className="local-date" label={label} value={staticText(value)} />;
  }

  return (
    <div className="md-control local-date">
      <label className="md-label" htmlFor={`${domId}-date`}>
        {label}
      </label>
      <input
        id={`${domId}-date`}
        className="md-text-input"
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        required={required}
        disabled={disabled}
        aria-invalid={problem || error ? true : undefined}
        onBlur={() => setTouched(true)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setTouched(true);
          write(event.target.value);
        }}
      />
      <PrintValue value={staticText(value)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : (problem ?? error)} />
    </div>
  );
}

/* --------------------------------------------------------------- choices */

interface ChoiceOption {
  value: string;
  node: LocalNode;
}

function readOptions(node: LocalNode): ChoiceOption[] {
  return (node.children ?? [])
    .filter((child) => child.type === 'component' && child.name === 'option')
    .map((child, index) => ({
      value: rawAttr(child, 'value') ?? `option-${index + 1}`,
      node: child,
    }));
}

function inlinePlainText(
  runtime: LocalRuntime,
  nodes: LocalNode[] | undefined,
  t: Localize = defaultLocalize,
): string {
  if (!nodes) return '';
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') {
      text += node.value ?? '';
    } else if (node.type === 'fallback') {
      text += node.value ?? '';
    } else if (node.type === 'interpolation') {
      try {
        text += scalarText(runtime.evaluate(node.value ?? '')) ?? '';
      } catch {
        text += t('Cannot compute', '无法计算');
      }
    } else if (node.type === 'break') {
      text += ' ';
    } else {
      text += inlinePlainText(runtime, node.children, t);
    }
  }
  return text;
}

function optionLabel(runtime: LocalRuntime, node: LocalNode, t: Localize = defaultLocalize): string {
  return inlinePlainText(runtime, node.children, t) || rawAttr(node, 'value') || '';
}

function OptionView() {
  return null;
}

function SelectView({ node }: LocalComponentProps) {
  const domId = useId();
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Select', '选择'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const stored = currentValue(runtime, node);
  const current = typeof stored === 'string' ? stored : '';
  const active = options.some((option) => option.value === current)
    ? current
    : options[0]?.value ?? '';
  const activeOption = options.find((option) => option.value === active);
  const activeLabel = activeOption ? optionLabel(runtime, activeOption.node, t) || active : '';

  if (options.length === 0) return <LocalError message={t('Missing options', '缺少选项')} />;

  if (mode === 'static') {
    return (
      <StaticValue
        className="md-select local-select"
        label={label}
        value={staticText(activeLabel)}
      />
    );
  }

  return (
    <div className="md-control md-select local-select" style={accentStyle(localColor(node))}>
      <label className="md-label" htmlFor={`${domId}-select`}>
        {label}
      </label>
      <select
        id={`${domId}-select`}
        className="md-select-input"
        value={active}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => write(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.node.id} value={option.value}>
            {optionLabel(runtime, option.node, t) || option.value}
          </option>
        ))}
      </select>
      <PrintValue value={staticText(activeLabel)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

function ChoicesView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Options', '选项'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const stored = currentValue(runtime, node);
  const current = typeof stored === 'string' ? stored : '';
  const selectedIndex = options.findIndex((option) => option.value === current);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const selectedLabel = selectedOption ? optionLabel(runtime, selectedOption.node, t) : '';
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  if (options.length === 0) return <LocalError message={t('Missing options', '缺少选项')} />;

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-choices"
        label={label}
        value={staticText(selectedLabel)}
      />
    );
  }

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    write(option.value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div className="md-control local-choices" style={accentStyle(localColor(node))}>
      <span className="md-label" id={`${domId}-choices-label`}>
        {label}
      </span>
      <div
        className="local-choice-list"
        role="radiogroup"
        aria-labelledby={`${domId}-choices-label`}
        aria-disabled={disabled || undefined}
      >
        {options.map((option, index) => {
          const selected = option.value === current;
          return (
            <button
              key={option.node.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              disabled={disabled}
              className={`local-choice${selected ? ' is-selected' : ''}`}
              onClick={() => write(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {renderInlineNodes(local, option.node.children, visible)}
            </button>
          );
        })}
      </div>
      <PrintValue value={staticText(selectedLabel)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

function RadioGroupView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Options', '选项'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const stored = currentValue(runtime, node);
  const current = typeof stored === 'string' ? stored : '';
  const name = domId;
  const selectedOption = options.find((option) => option.value === current);
  const selectedLabel = selectedOption ? optionLabel(runtime, selectedOption.node, t) : '';

  if (options.length === 0) return <LocalError message={t('Missing options', '缺少选项')} />;

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-radio-group"
        label={label}
        value={staticText(selectedLabel)}
      />
    );
  }

  return (
    <fieldset className="md-control local-radio-group" style={accentStyle(localColor(node))} disabled={disabled}>
      <legend className="md-label">{label}</legend>
      {options.map((option) => (
        <label className="local-radio-option" key={option.node.id}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={current === option.value}
            onChange={() => write(option.value)}
          />
          <span>{renderInlineNodes(local, option.node.children, visible)}</span>
        </label>
      ))}
      <PrintValue value={staticText(selectedLabel)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </fieldset>
  );
}

/* -------------------------------------------------------------- checklist */

interface ChecklistItem {
  id: string;
  node: LocalNode;
}

function readChecklistItems(node: LocalNode): ChecklistItem[] {
  const list = (node.children ?? []).find((child) => child.type === 'list');
  return (list?.children ?? [])
    .filter((child) => child.type === 'listItem')
    .map((child, index) => ({ id: `item-${index + 1}`, node: child }));
}

function ChecklistView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Checklist', '清单'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const items = readChecklistItems(node);
  const stored = currentValue(runtime, node);
  const selected = Array.isArray(stored)
    ? stored.filter((value): value is string => typeof value === 'string')
    : [];

  if (items.length === 0) {
    return <LocalError message={t('Checklist requires a task list', '清单需要任务列表')} />;
  }

  const stateFor = (checked: boolean) => (checked ? t('Checked', '已勾选') : t('Unchecked', '未勾选'));

  if (mode === 'static') {
    return (
      <div
        className="local-checklist local-static-checklist"
        style={accentStyle(localColor(node))}
        role="group"
        aria-label={label}
      >
        <span className="md-label">{label}</span>
        <ul className="local-static-list">
          {items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <li key={item.id} className="local-static-list-item">
                <span className="local-static-state">{stateFor(checked)}</span>
                <span className={`local-static-item${checked ? ' is-checked' : ''}`}>
                  {renderInlineNodes(local, item.node.children, visible)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const toggle = (id: string, checked: boolean) => {
    const chosen = new Set(selected);
    if (checked) chosen.add(id);
    else chosen.delete(id);
    write(items.filter((item) => chosen.has(item.id)).map((item) => item.id));
  };

  return (
    <fieldset
      className="local-checklist"
      style={accentStyle(localColor(node))}
      disabled={disabled}
    >
      <legend className="md-label">{label}</legend>
      {items.map((item) => {
        const checked = selected.includes(item.id);
        return (
          <div className="local-checklist-item" key={item.id}>
            <input
              id={`${domId}-${item.id}`}
              type="checkbox"
              checked={checked}
              onChange={(event) => toggle(item.id, event.target.checked)}
            />
            <label
              className={`local-checklist-text${checked ? ' is-checked' : ''}`}
              htmlFor={`${domId}-${item.id}`}
            >
              {renderInlineNodes(local, item.node.children, visible)}
            </label>
          </div>
        );
      })}
      <PrintValue
        block
        value={
          <ul className="local-static-list">
            {items.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <li key={item.id} className="local-static-list-item">
                  <span className="local-static-state">{stateFor(checked)}</span>
                  <span className={`local-static-item${checked ? ' is-checked' : ''}`}>
                    {inlinePlainText(runtime, item.node.children, t)}
                  </span>
                </li>
              );
            })}
          </ul>
        }
      />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </fieldset>
  );
}

/* ------------------------------------------------------- counter & timer */

function formatSeconds(seconds: number, t: Localize = defaultLocalize): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  if (minutes === 0) return t(`${rest} seconds`, `${rest} 秒`);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function CounterView({ node }: LocalComponentProps) {
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Counter', '计数'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const min = numberAttr(runtime, node, 'min', 0);
  const maxPresent = rawAttr(node, 'max') !== undefined;
  const max = maxPresent ? numberAttr(runtime, node, 'max', 0) : undefined;
  const step = numberAttr(runtime, node, 'step', 1);
  const stored = currentValue(runtime, node);
  const value = typeof stored === 'number' && Number.isFinite(stored) ? stored : min;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const tolerance = 1e-9 * Math.max(1, Math.abs(value));
  const canDecrease = value - safeStep >= min - tolerance;
  const canIncrease = max === undefined || value + safeStep <= max + tolerance;

  if (mode === 'static') {
    return <StaticValue className="local-counter" label={label} value={String(value)} />;
  }

  const change = (direction: 1 | -1) => {
    const next = Number((value + direction * safeStep).toFixed(12));
    write(next);
  };

  const reset = () => {
    try {
      runtime.reset(node);
    } catch {
      /* A disposed runtime has no state to restore. */
    }
  };

  return (
    <div className="local-counter" role="group" aria-label={label}>
      <span className="md-label">{label}</span>
      <div className="local-counter-row">
        <button
          type="button"
          className="md-button md-button-secondary local-counter-button"
          aria-label={`${label} ${t('decrease', '减少')}`}
          disabled={disabled || !canDecrease}
          onClick={() => change(-1)}
        >
          −
        </button>
        <span className="local-counter-value" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="md-button md-button-secondary local-counter-button"
          aria-label={`${label} ${t('increase', '增加')}`}
          disabled={disabled || !canIncrease}
          onClick={() => change(1)}
        >
          +
        </button>
        <button
          type="button"
          className="md-button md-button-quiet local-counter-reset"
          disabled={disabled}
          onClick={reset}
        >
          {t('Reset', '恢复初值')}
        </button>
      </div>
      <PrintValue value={String(value)} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

function TimerView({ node, visible }: LocalComponentProps) {
  const { runtime, mode } = useLocal();
  const t = useLocalize();
  const label = textAttr(runtime, node, 'label', t('Timer', '计时器'), t);
  const durationRaw = numberAttr(runtime, node, 'duration', 60);
  const duration = Math.floor(durationRaw);
  const stored = currentValue(runtime, node);
  const remaining = typeof stored === 'number' && Number.isFinite(stored)
    ? Math.max(0, Math.ceil(stored))
    : duration;

  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const deadline = useRef(0);
  const valueRef = useRef(remaining);
  valueRef.current = remaining;
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    (seconds: number) => {
      try {
        const diagnostics = runtime.set(node, seconds);
        if (diagnostics.length) {
          setError(diagnostics.map((item) => item.message).join('; '));
        }
      } catch {
        /* A disposed runtime cannot accept more ticks. */
      }
    },
    [node, runtime],
  );

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
      if (next !== valueRef.current) {
        valueRef.current = next;
        commit(next);
      }
      if (next <= 0) {
        setRunning(false);
        setCompleted(true);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [running, commit]);

  useEffect(() => {
    if (visible || !running) return;
    const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
    valueRef.current = next;
    commit(next);
    setRunning(false);
  }, [visible, running, commit]);

  useResetToken(runtime, node, () => {
    setRunning(false);
    setCompleted(false);
    setError(null);
  });

  if (!Number.isFinite(durationRaw) || duration <= 0) {
    return (
      <LocalError
        message={t(
          'Timer duration must be a positive number of seconds',
          '计时时长必须是大于 0 的秒数',
        )}
      />
    );
  }

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-timer"
        label={label}
        value={formatSeconds(remaining, t)}
      />
    );
  }

  const start = () => {
    if (running) return;
    const base = remaining > 0 ? remaining : duration;
    if (remaining <= 0) {
      valueRef.current = duration;
      commit(duration);
    }
    deadline.current = performance.now() + base * 1000;
    setCompleted(false);
    setError(null);
    setRunning(true);
  };

  const pause = () => {
    if (!running) return;
    const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
    valueRef.current = next;
    commit(next);
    setRunning(false);
  };

  const reset = () => {
    setRunning(false);
    setCompleted(false);
    setError(null);
    valueRef.current = duration;
    try {
      runtime.reset(node);
    } catch {
      /* A disposed runtime has no state to restore. */
    }
  };

  return (
    <div className="local-timer" role="group" aria-label={label}>
      <div className="local-timer-head">
        <span className="md-label">{label}</span>
        <span
          className="local-timer-value"
          role="timer"
          aria-label={t(`${remaining} seconds remaining`, `剩余 ${remaining} 秒`)}
        >
          {formatSeconds(remaining, t)}
        </span>
      </div>
      <div className="local-timer-controls">
        <button
          type="button"
          className="md-button md-button-primary"
          onClick={start}
          disabled={running}
        >
          {t('Start', '开始')}
        </button>
        <button
          type="button"
          className="md-button md-button-secondary"
          onClick={pause}
          disabled={!running}
        >
          {t('Pause', '暂停')}
        </button>
        <button type="button" className="md-button md-button-quiet" onClick={reset}>
          {t('Reset', '重置')}
        </button>
      </div>
      <span className="local-timer-status" role="status" aria-live="polite">
        {completed
          ? t('Completed', '计时完成')
          : running
            ? t('Running', '计时中')
            : t('Paused', '已暂停')}
      </span>
      <PrintValue value={formatSeconds(remaining, t)} />
      <FieldError message={error} />
    </div>
  );
}

function ProgressView({ node }: LocalComponentProps) {
  const { runtime } = useLocal();
  const t = useLocalize();
  const label = textAttr(runtime, node, 'label', t('Progress', '进度'), t);
  const max = numberAttr(runtime, node, 'max', 100);
  const read = readAttr(runtime, node, 'value');

  if (!Number.isFinite(max) || max <= 0) {
    return <LocalError message={t('Progress maximum must be positive', '进度上限必须是正数')} />;
  }
  if (!read.present || !read.ok) return <LocalError />;
  const raw = read.value;
  const numeric = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN;
  if (!Number.isFinite(numeric)) return <LocalError />;
  if (numeric < 0 || numeric > max) {
    return (
      <LocalError
        message={t(
          `Progress value must be between 0 and ${max}`,
          `进度值需要在 0 到 ${max} 之间`,
        )}
      />
    );
  }
  const percent = (numeric / max) * 100;
  const color = localColor(node);

  return (
    <div
      className="local-progress"
      style={color ? ({ '--local-progress-color': color } as CSSProperties) : undefined}
    >
      <div className="local-progress-head">
        <span className="md-label">{label}</span>
        <span className="local-progress-value">{Math.round(percent)}%</span>
      </div>
      <div
        className="local-progress-track"
        role="progressbar"
        aria-label={label || t('Progress', '进度')}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={numeric}
      >
        <div className="local-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- layout */

function PanelView({ node, visible }: LocalComponentProps) {
  const { runtime, render, mode } = useLocal();
  const t = useLocalize();
  const title = textAttr(runtime, node, 'title', '', t);
  const resettable = boolAttr(runtime, node, 'reset', true);
  const showReset = resettable && mode !== 'static';
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    try {
      runtime.reset(node);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Cannot reset', '无法恢复默认'));
    }
  };

  return (
    <section className="local-panel" aria-label={title || t('Parameter panel', '参数面板')}>
      {title || showReset ? (
        <div className="local-panel-head">
          {title ? <h3 className="local-panel-title">{title}</h3> : <span />}
          {showReset ? (
            <button
              type="button"
              className="md-button md-button-quiet local-panel-reset"
              onClick={reset}
              aria-label={title ? t(`Reset ${title}`, `${title} 恢复默认`) : t('Reset', '恢复默认')}
            >
              {t('Reset', '恢复默认')}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="local-panel-body">{render(node.children ?? [], visible)}</div>
      <FieldError message={error} />
    </section>
  );
}

function CardView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const t = useLocalize();
  const title = textAttr(runtime, node, 'title', '', t);
  return (
    <section className="md-card local-card">
      {title ? <h3 className="md-card-title">{title}</h3> : null}
      <div className="md-card-body">{render(node.children ?? [], visible)}</div>
    </section>
  );
}

function GridView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const columns = Math.min(4, Math.max(1, Math.floor(numberAttr(runtime, node, 'columns', 2))));
  const style = { '--local-grid-columns': String(columns) } as CSSProperties;
  return (
    <div className="local-grid" style={style}>
      {render(node.children ?? [], visible)}
    </div>
  );
}

function TabView({ node, visible }: LocalComponentProps) {
  const { render } = useLocal();
  return <div className="local-tabpanel-body">{render(node.children ?? [], visible)}</div>;
}

function EdgeView() {
  return null;
}

function TabsView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const { runtime, render, mode } = useLocal();
  const t = useLocalize();
  const { write, error } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '', t);
  const tabs = (node.children ?? []).filter(
    (child) => child.type === 'component' && child.name === 'tab',
  );
  const values = tabs.map((tab, index) => rawAttr(tab, 'value') ?? `tab-${index + 1}`);
  const labels = tabs.map((tab, index) => textAttr(runtime, tab, 'label', values[index], t));
  const initial = rawAttr(node, 'initial') ?? values[0] ?? '';
  const bound = rawAttr(node, 'bind') !== undefined;
  const stored = currentValue(runtime, node);
  const boundValue = typeof stored === 'string' ? stored : '';
  const [selected, setSelected] = useState(() => (values.includes(initial) ? initial : values[0] ?? ''));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useResetToken(runtime, node, () => {
    setSelected(values.includes(initial) ? initial : values[0] ?? '');
  });

  if (tabs.length === 0) {
    return <LocalError message={t('Tabs requires at least one tab', '标签页至少需要一个 tab')} />;
  }

  // Static tabs render every panel under its own label. This keeps all content
  // available to the reader/export instead of silently dropping inactive tabs;
  // no tab buttons or tablist semantics remain.
  if (mode === 'static') {
    return (
      <section className="local-tabs local-static-tabs" aria-label={label || t('Tabs', '选项卡')}>
        {label ? <div className="local-tabs-label">{label}</div> : null}
        {tabs.map((tab, index) => (
          <section className="local-static-tab" key={tab.id}>
            <h4 className="local-static-tab-label">{labels[index]}</h4>
            <div className="local-static-tab-body">{render(tab.children ?? [], visible)}</div>
          </section>
        ))}
      </section>
    );
  }

  const current = bound
    ? values.includes(boundValue) ? boundValue : values[0]
    : values.includes(selected) ? selected : values[0];
  const activeIndex = Math.max(0, values.indexOf(current));

  const choose = (index: number) => {
    const value = values[index];
    if (value === undefined) return;
    if (bound) write(value);
    else setSelected(value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <section className="local-tabs" aria-label={label || t('Tabs', '选项卡')}>
      {label ? <div className="local-tabs-label">{label}</div> : null}
      <div
        className="local-tablist"
        role="tablist"
        aria-label={label || t('Tabs', '选项卡')}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => {
          const value = values[index];
          const active = value === current;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              id={`${domId}-tab-${index}`}
              type="button"
              role="tab"
              className={`local-tab${active ? ' is-selected' : ''}`}
              aria-selected={active}
              aria-controls={`${domId}-panel-${index}`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                if (bound) write(value);
                else setSelected(value);
              }}
            >
              {labels[index]}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => {
        const value = values[index];
        const active = value === current;
        return (
          <div
            key={tab.id}
            id={`${domId}-panel-${index}`}
            className="local-tabpanel"
            role="tabpanel"
            aria-labelledby={`${domId}-tab-${index}`}
            tabIndex={0}
            hidden={!active}
          >
            <PrintValue block value={labels[index]} />
            {render(tab.children ?? [], visible && active)}
          </div>
        );
      })}
      <FieldError message={error} />
    </section>
  );
}

function AccordionView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const t = useLocalize();
  const label = textAttr(runtime, node, 'label', '', t);
  return (
    <div className="local-accordion" role="group" aria-label={label || t('Accordion', '折叠面板')}>
      {label ? <div className="local-accordion-label">{label}</div> : null}
      {render(node.children ?? [], visible)}
    </div>
  );
}

function DisclosureView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const { runtime, render, mode } = useLocal();
  const t = useLocalize();
  const label = textAttr(runtime, node, 'label', t('Details', '折叠内容'), t);
  const initialOpen = boolAttr(runtime, node, 'open', false);
  const [open, setOpen] = useState(initialOpen);

  useResetToken(runtime, node, () => {
    setOpen(initialOpen);
  });

  // Static disclosures always expose their content; the trigger button and
  // open/closed state are interaction-only.
  if (mode === 'static') {
    return (
      <section className="local-disclosure local-static-disclosure">
        <h3 className="local-disclosure-heading">{label}</h3>
        <div className="local-disclosure-panel">{render(node.children ?? [], visible)}</div>
      </section>
    );
  }

  const triggerId = `${domId}-disclosure-trigger`;
  const panelId = `${domId}-disclosure-panel`;

  return (
    <div className="local-disclosure">
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
          <span>{label}</span>
        </button>
        <PrintValue value={label} />
      </h3>
      <div
        id={panelId}
        className="local-disclosure-panel"
        role="region"
        aria-labelledby={triggerId}
        hidden={!open}
      >
        {render(node.children ?? [], visible && open)}
      </div>
    </div>
  );
}

function IfView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const t = useLocalize();
  const result = readBooleanAttr(runtime, node, 'when', false);
  const when = result.ok ? result.value : false;
  const conditionError = !result.ok;
  const container = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(when);
  const hadFocus = useRef(false);

  useEffect(() => {
    if (wasVisible.current && !when) {
      if (hadFocus.current) {
        const target = container.current?.closest('.local-document') as HTMLElement | null;
        if (target) {
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
        }
      }
      hadFocus.current = false;
    }
    wasVisible.current = when;
  }, [when]);

  return (
    <>
      {conditionError ? <LocalError /> : null}
      <div
        ref={container}
        className="local-if md-if"
        role="group"
        aria-label={t('Conditional content', '条件内容')}
        tabIndex={-1}
        hidden={!when}
        aria-hidden={!when}
        onFocus={() => {
          hadFocus.current = true;
        }}
        onBlur={(event) => {
          if (!container.current?.contains(event.relatedTarget as Node | null)) {
            hadFocus.current = false;
          }
        }}
      >
        {render(node.children ?? [], visible && when)}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- feedback */

function AlertView({ node, visible }: LocalComponentProps) {
  const { runtime, render } = useLocal();
  const t = useLocalize();
  const title = textAttr(runtime, node, 'title', '', t);
  const rawTone = rawAttr(node, 'tone') ?? 'info';
  const tone = rawTone === 'success' || rawTone === 'warning' ? rawTone : 'info';
  const role = tone === 'warning' ? 'alert' : 'status';
  return (
    <div className={`local-alert local-alert-${tone}`} role={role}>
      {title ? <div className="local-alert-title">{title}</div> : null}
      <div className="local-alert-body">{render(node.children ?? [], visible)}</div>
    </div>
  );
}

function BadgeView({ node, visible }: LocalComponentProps) {
  const local = useLocal();
  const { runtime } = local;
  const rawTone = rawAttr(node, 'tone') ?? 'neutral';
  const tone = rawTone === 'success' || rawTone === 'warning' ? rawTone : 'neutral';
  const color = localColor(node);
  return (
    <span
      className={`md-badge md-badge-${tone} local-badge`}
      style={color ? { color } : undefined}
    >
      {renderInlineNodes(local, node.children, visible)}
    </span>
  );
}

function TooltipView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const text = textAttr(runtime, node, 'text', t('Tooltip', '提示'), t);
  const [open, setOpen] = useState(false);
  const bubbleId = `${domId}-tooltip`;

  if (mode === 'static') {
    return (
      <span className="local-tooltip local-static-tooltip">
        <span className="local-tooltip-trigger">
          {renderInlineNodes(local, node.children, visible)}
        </span>
        <span className="local-tooltip-bubble is-visible" role="note">
          {text}
        </span>
      </span>
    );
  }

  return (
    <span
      className="local-tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className="local-tooltip-trigger"
        tabIndex={0}
        aria-describedby={bubbleId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {renderInlineNodes(local, node.children, visible)}
      </span>
      <span
        id={bubbleId}
        role="tooltip"
        className={`local-tooltip-bubble${open ? ' is-visible' : ''}`}
      >
        {text}
      </span>
      <PrintValue value={text} />
    </span>
  );
}

/* ------------------------------------------------------ inline additions */

function JumpView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { anchors, rootRef, runtime, urlPolicy, mode } = local;
  const t = useLocalize();
  const feedbackId = `${domId}-jump-feedback`;
  const [message, setMessage] = useState<string | null>(null);
  const to = rawAttr(node, 'to') ?? '';
  const target = anchors.targetId(to);
  const appearance = rawAttr(node, 'appearance') === 'button' ? 'button' : 'link';
  const color = localColor(node);
  const href = target ? `#${target}` : '#';
  let allowed = target !== undefined;
  if (allowed && urlPolicy) {
    try {
      // Internal fragments still pass through the host's link allowlist.
      allowed = urlPolicy(`#${to}`, 'link') === true;
    } catch {
      allowed = false;
    }
  }

  useResetToken(runtime, node, () => setMessage(null));

  // Static jumps keep native fragment navigation where the host policy allows
  // it; blocked or missing targets degrade to plain inline text with no
  // handler, no fake href and no button appearance.
  if (mode === 'static') {
    if (allowed && target) {
      return (
        <a
          href={`#${target}`}
          className="local-jump local-jump-link local-jump-static"
          style={accentStyle(color)}
        >
          {renderInlineNodes(local, node.children, visible)}
        </a>
      );
    }
    return (
      <span className="local-jump local-jump-static-blocked" style={accentStyle(color)}>
        {renderInlineNodes(local, node.children, visible)}
      </span>
    );
  }

  const onJump = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!allowed || !target) {
      event.preventDefault();
      setMessage(
        target
          ? t('Jump is blocked by the host', '跳转已被主机策略阻止')
          : t('Jump target not found', '找不到跳转目标'),
      );
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    // Modified clicks keep native link behavior (new tab, download, etc.).
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    let element: HTMLElement | null = null;
    try {
      // Attribute lookup stays inside this document instance; never the page.
      element = root.querySelector<HTMLElement>(`[id="${target}"]`);
    } catch {
      element = null;
    }
    if (!element) {
      event.preventDefault();
      setMessage(t('Jump target not found', '找不到跳转目标'));
      return;
    }
    if (element.closest('[hidden]')) {
      event.preventDefault();
      setMessage(t('Jump target is hidden', '跳转目标当前隐藏'));
      return;
    }
    event.preventDefault();
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
    setMessage(null);
  };

  return (
    <>
      <a
        href={allowed ? href : '#'}
        className={`local-jump local-jump-${appearance}`}
        style={accentStyle(color)}
        data-local-target-missing={target ? undefined : 'true'}
        data-local-jump-blocked={target && !allowed ? 'true' : undefined}
        aria-describedby={message ? feedbackId : undefined}
        onClick={onJump}
      >
        {renderInlineNodes(local, node.children, visible)}
      </a>
      {message ? (
        <span
          id={feedbackId}
          className="local-jump-feedback"
          role="status"
          aria-live="polite"
        >
          {message}
        </span>
      ) : null}
    </>
  );
}

function AnchorView({ node }: LocalComponentProps) {
  const { anchors } = useLocal();
  const id = anchors.anchorIds.get(node);
  if (!id) return null;
  return <span className="local-anchor" id={id} data-local-anchor="" />;
}

function TextView({ node, visible }: LocalComponentProps) {
  const local = useLocal();
  const color = localColor(node);
  return (
    <span className="local-text" style={color ? { color } : undefined}>
      {renderInlineNodes(local, node.children, visible)}
    </span>
  );
}

function SectionView({ node, visible }: LocalComponentProps) {
  const { render } = useLocal();
  const color = localColor(node);
  return (
    <div className="local-section" style={color ? { color } : undefined}>
      {render(node.children ?? [], visible)}
    </div>
  );
}

/* --------------------------------------------------------------- controls */

function MultiSelectView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Multi select', '多选'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const stored = currentValue(runtime, node);
  const selected = Array.isArray(stored)
    ? stored.filter((value): value is string => typeof value === 'string')
    : [];
  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => optionLabel(runtime, option.node, t) || option.value);
  const maxRaw = numberAttr(runtime, node, 'max-selected', options.length);
  const max = Number.isFinite(maxRaw) ? Math.max(0, Math.floor(maxRaw)) : options.length;
  const [query, setQuery] = useState('');
  useResetToken(runtime, node, () => {
    setQuery('');
    setError(null);
  });

  if (options.length === 0) {
    return <LocalError message={t('Missing options', '缺少选项')} />;
  }

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-multi-select"
        label={label}
        value={staticText(selectedLabels.join(', '))}
      />
    );
  }

  const chosen = new Set(selected);
  const atMax = selected.length >= max;
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? options.filter((option) => {
        const haystack = `${inlinePlainText(runtime, option.node.children, t)} ${option.value}`;
        return haystack.toLocaleLowerCase().includes(needle);
      })
    : options;

  const toggle = (value: string, checked: boolean) => {
    const next = new Set(chosen);
    if (checked) {
      if (!next.has(value) && next.size >= max) return;
      next.add(value);
    } else {
      // Every selected value stays removable, including at the maximum.
      next.delete(value);
    }
    write(options.filter((option) => next.has(option.value)).map((option) => option.value));
  };

  const clear = () => {
    setQuery('');
    if (selected.length > 0) write([]);
  };

  return (
    <fieldset
      className="local-multi-select"
      style={accentStyle(localColor(node))}
      disabled={disabled}
    >
      <legend className="md-label">{label}</legend>
      <div className="local-multi-toolbar">
        <input
          id={`${domId}-multi-search`}
          type="search"
          className="md-text-input local-multi-search"
          value={query}
          placeholder={t('Search options', '搜索选项')}
          aria-label={t(`Search ${label}`, `搜索${label}`)}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="md-button md-button-quiet local-multi-clear"
          onClick={clear}
        >
          {t('Clear', '清除')}
        </button>
      </div>
      <div className="local-multi-list" role="group" aria-label={label}>
        {matches.length === 0 ? (
          <span className="local-multi-empty">{t('No matching options', '没有匹配选项')}</span>
        ) : (
          matches.map((option) => {
            const checked = chosen.has(option.value);
            return (
              <label
                key={option.node.id}
                className={`local-multi-option${checked ? ' is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && atMax}
                  onChange={(event) => toggle(option.value, event.target.checked)}
                />
                <span>{renderInlineNodes(local, option.node.children, visible)}</span>
              </label>
            );
          })
        )}
      </div>
      <span className="local-multi-count" role="status" aria-live="polite">
        {t(`${selected.length} of ${max} selected`, `已选 ${selected.length}/${max}`)}
      </span>
      <PrintValue value={staticText(selectedLabels.join(', '))} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </fieldset>
  );
}

function RangeSliderView({ node }: LocalComponentProps) {
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Range', '范围'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const { min, max, step } = numericRange(runtime, node, 'min', 'max', 0, 100, 1);
  const steps = Math.floor((max - min) / step + 1e-9);
  const defaultStart = min;
  const defaultEnd = clamp(min + Math.max(0, steps) * step, min, max);
  let start = snapToStep(slotNumber(runtime, node, 'start', defaultStart), min, max, step);
  let end = snapToStep(slotNumber(runtime, node, 'end', defaultEnd), min, max, step);
  if (start > end) start = end;
  const [crossing, setCrossing] = useState<string | null>(null);
  useResetToken(runtime, node, () => {
    setCrossing(null);
    setError(null);
  });

  const startName = t('Start', '起点');
  const endName = t('End', '终点');
  const rangeSummary = `${startName}: ${start} · ${endName}: ${end}`;

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-range-slider"
        label={label}
        value={rangeSummary}
      />
    );
  }

  const commit = (slot: 'start' | 'end', raw: number) => {
    const value = snapToStep(clamp(raw, min, max), min, max, step);
    if (slot === 'start' && value > end) {
      setCrossing(t('Start cannot exceed end', '起点不能超过终点'));
      return;
    }
    if (slot === 'end' && value < start) {
      setCrossing(t('End cannot be less than start', '终点不能小于起点'));
      return;
    }
    setCrossing(null);
    write(value, slot);
  };

  return (
    <div
      className="md-control local-range-slider"
      style={accentStyle(localColor(node))}
      role="group"
      aria-label={label}
    >
      <span className="md-label">{label}</span>
      <div className="local-range-row">
        <span className="local-range-name">{t('Start', '起点')}</span>
        <input
          type="range"
          className="local-range-input"
          min={min}
          max={end}
          step={step}
          value={start}
          disabled={disabled}
          aria-label={`${label} ${t('Start', '起点')}`}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            commit('start', Number(event.target.value))
          }
        />
        <span className="local-range-value" aria-hidden="true">
          {start}
        </span>
      </div>
      <div className="local-range-row">
        <span className="local-range-name">{t('End', '终点')}</span>
        <input
          type="range"
          className="local-range-input"
          min={start}
          max={max}
          step={step}
          value={end}
          disabled={disabled}
          aria-label={`${label} ${t('End', '终点')}`}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            commit('end', Number(event.target.value))
          }
        />
        <span className="local-range-value" aria-hidden="true">
          {end}
        </span>
      </div>
      <PrintValue value={rangeSummary} />
      <FieldError
        message={disabledInvalid ? t('Cannot compute', '无法计算') : (crossing ?? error)}
      />
    </div>
  );
}

interface NumberDraftFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onCommit: (value: number) => void;
  reset: number;
}

function NumberDraftField({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
  reset,
}: NumberDraftFieldProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    setDraft(String(value));
    setFocused(false);
  }, [reset]);

  useEffect(() => {
    if (last.current !== value) {
      last.current = value;
      if (!focused) setDraft(String(value));
    }
  }, [value, focused]);

  const parse = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return snapToStep(clamp(parsed, min, max), min, max, step);
  };

  return (
    <div className="local-number-field">
      <label className="md-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="md-text-input"
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const parsed = parse(draft);
          setDraft(String(parsed ?? value));
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parse(text);
          if (parsed !== null) onCommit(parsed);
        }}
      />
    </div>
  );
}

function CoordinateView({ node }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const { write, writeMany, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', t('Coordinate', '坐标'), t);
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const xRange = numericRange(runtime, node, 'x-min', 'x-max', -5, 5, 1);
  const yRange = numericRange(runtime, node, 'y-min', 'y-max', -5, 5, 1);
  const defaultX = snapToStep(0, xRange.min, xRange.max, xRange.step);
  const defaultY = snapToStep(0, yRange.min, yRange.max, yRange.step);
  const x = snapToStep(
    slotNumber(runtime, node, 'x', defaultX),
    xRange.min,
    xRange.max,
    xRange.step,
  );
  const y = snapToStep(
    slotNumber(runtime, node, 'y', defaultY),
    yRange.min,
    yRange.max,
    yRange.step,
  );
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  useResetToken(runtime, node, () => setError(null));

  const coordinateSummary = `X: ${x} · Y: ${y}`;

  if (mode === 'static') {
    return (
      <StaticValue
        className="local-coordinate"
        label={label}
        value={coordinateSummary}
      />
    );
  }

  const xPercent =
    xRange.max > xRange.min ? ((x - xRange.min) / (xRange.max - xRange.min)) * 100 : 0;
  const yPercent =
    yRange.max > yRange.min ? ((y - yRange.min) / (yRange.max - yRange.min)) * 100 : 0;

  const pointValue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    return {
      x: snapToStep(
        xRange.min + ratioX * (xRange.max - xRange.min),
        xRange.min,
        xRange.max,
        xRange.step,
      ),
      y: snapToStep(
        yRange.min + (1 - ratioY) * (yRange.max - yRange.min),
        yRange.min,
        yRange.max,
        yRange.step,
      ),
    };
  };

  const moveTo = (nextX: number, nextY: number) => {
    if (nextX === x && nextY === y) return;
    writeMany({ x: nextX, y: nextY });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let nextX = x;
    let nextY = y;
    switch (event.key) {
      case 'ArrowLeft':
        nextX = snapToStep(x - xRange.step, xRange.min, xRange.max, xRange.step);
        break;
      case 'ArrowRight':
        nextX = snapToStep(x + xRange.step, xRange.min, xRange.max, xRange.step);
        break;
      case 'ArrowDown':
        nextY = snapToStep(y - yRange.step, yRange.min, yRange.max, yRange.step);
        break;
      case 'ArrowUp':
        nextY = snapToStep(y + yRange.step, yRange.min, yRange.max, yRange.step);
        break;
      case 'Home':
        nextX = xRange.min;
        nextY = yRange.min;
        break;
      case 'End':
        nextX = snapToStep(xRange.max, xRange.min, xRange.max, xRange.step);
        nextY = snapToStep(yRange.max, yRange.min, yRange.max, yRange.step);
        break;
      default:
        return;
    }
    event.preventDefault();
    moveTo(nextX, nextY);
  };

  return (
    <div
      className="local-coordinate"
      style={accentStyle(localColor(node))}
      role="group"
      aria-label={label}
    >
      <span className="md-label">{label}</span>
      <div
        ref={padRef}
        className="local-coordinate-pad"
        role="group"
        aria-label={t(`${label} drag area`, `${label} 拖拽区`)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (disabled) return;
          event.preventDefault();
          dragging.current = true;
          padRef.current?.focus({ preventScroll: true });
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* Pointer capture is not available in every environment. */
          }
          const point = pointValue(event);
          if (point) moveTo(point.x, point.y);
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (!dragging.current || disabled) return;
          const point = pointValue(event);
          if (point) moveTo(point.x, point.y);
        }}
        onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
          dragging.current = false;
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* The pointer may already be released. */
          }
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <span className="local-coordinate-horizontal" aria-hidden="true" />
        <span className="local-coordinate-vertical" aria-hidden="true" />
        <span
          className="local-coordinate-dot"
          aria-hidden="true"
          style={{ left: `${xPercent}%`, top: `${100 - yPercent}%` }}
        />
      </div>
      <span className="md-hint local-hint">
        {t(
          'Arrow keys adjust the point; Home and End jump to the lower or upper bounds.',
          '方向键调整坐标；Home 和 End 跳到最小或最大边界。',
        )}
      </span>
      <div className="local-coordinate-fields">
        <NumberDraftField
          id={`${domId}-coordinate-x`}
          reset={runtime.resetToken(node)}
          label={`${label} X`}
          value={x}
          min={xRange.min}
          max={xRange.max}
          step={xRange.step}
          disabled={disabled}
          onCommit={(value) => write(value, 'x')}
        />
        <NumberDraftField
          id={`${domId}-coordinate-y`}
          reset={runtime.resetToken(node)}
          label={`${label} Y`}
          value={y}
          min={yRange.min}
          max={yRange.max}
          step={yRange.step}
          disabled={disabled}
          onCommit={(value) => write(value, 'y')}
        />
      </div>
      <PrintValue value={coordinateSummary} />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : error} />
    </div>
  );
}

/* ------------------------------------------------------------------- quiz */

type QuizResult = 'correct' | 'incorrect' | 'incomplete';

function QuizView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const local = useLocal();
  const { runtime, mode } = local;
  const t = useLocalize();
  const label = textAttr(runtime, node, 'label', t('Quiz', '测验'), t);
  const type = rawAttr(node, 'type') === 'number' ? 'number' : 'choice';
  const answer = (rawAttr(node, 'answer') ?? '').trim();
  const toleranceRaw = numberAttr(runtime, node, 'tolerance', 0);
  const tolerance =
    Number.isFinite(toleranceRaw) && toleranceRaw >= 0 ? toleranceRaw : 0;
  const { disabled, invalid: disabledInvalid } = useDisabled(node);
  const options = readOptions(node);
  const explanation = textAttr(runtime, node, 'explanation', '', t);
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<QuizResult | null>(null);

  useResetToken(runtime, node, () => {
    setDraft('');
    setResult(null);
  });

  const numericAnswer = type === 'number' ? Number(answer) : Number.NaN;
  if (type === 'number' && !Number.isFinite(numericAnswer)) {
    return <LocalError message={t('Quiz answer must be a number', '测验答案必须是数字')} />;
  }
  if (type === 'choice' && options.length === 0) {
    return <LocalError message={t('Missing options', '缺少选项')} />;
  }

  const optionLabels = options.map((option) => optionLabel(runtime, option.node, t) || option.value);

  // Static quizzes expose the prompt and options as readable text. Answers,
  // checking actions and explanations only exist after interaction, so none of
  // the action controls are rendered.
  if (mode === 'static') {
    return (
      <div className="local-quiz local-static-quiz" role="group" aria-label={label}>
        <span className="md-label">{label}</span>
        {type === 'choice' ? (
          <ul className="local-static-list local-static-quiz-options">
            {options.map((option) => (
              <li key={option.node.id} className="local-static-list-item">
                {renderInlineNodes(local, option.node.children, visible)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="local-static-value">{t('Numeric answer', '数字作答')}</span>
        )}
      </div>
    );
  }

  const check = () => {
    if (type === 'choice') {
      if (draft === '') {
        setResult('incomplete');
        return;
      }
      setResult(draft === answer ? 'correct' : 'incorrect');
      return;
    }
    const trimmed = draft.trim();
    const entered = trimmed === '' ? Number.NaN : Number(trimmed);
    if (!Number.isFinite(entered)) {
      setResult('incomplete');
      return;
    }
    setResult(Math.abs(entered - numericAnswer) <= tolerance ? 'correct' : 'incorrect');
  };

  const tryAgain = () => {
    setDraft('');
    setResult(null);
  };

  const feedback =
    result === null
      ? null
      : result === 'correct'
        ? `${t('Correct', '回答正确')}`
        : result === 'incorrect'
          ? `${t('Not quite', '回答不正确')}`
          : type === 'number'
            ? t('Enter a number first', '请先输入数字')
            : t('Choose an answer first', '请先选择答案');
  const feedbackClass =
    result === 'correct' ? ' is-correct' : result === 'incorrect' ? ' is-incorrect' : '';

  return (
    <div className="local-quiz" role="group" aria-label={label}>
      {type === 'choice' ? (
        <fieldset className="local-quiz-options" disabled={disabled}>
          <legend className="md-label">{label}</legend>
          {options.map((option) => (
            <label className="local-radio-option" key={option.node.id}>
              <input
                type="radio"
                name={`${domId}-quiz`}
                value={option.value}
                checked={draft === option.value}
                onChange={() => {
                  setDraft(option.value);
                  setResult(null);
                }}
              />
              <span>{renderInlineNodes(local, option.node.children, visible)}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="local-quiz-number">
          <label className="md-label" htmlFor={`${domId}-quiz`}>
            {label}
          </label>
          <input
            id={`${domId}-quiz`}
            className="md-text-input local-quiz-input"
            type="text"
            inputMode="decimal"
            value={draft}
            disabled={disabled}
            aria-label={label}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setDraft(event.target.value);
              setResult(null);
            }}
          />
        </div>
      )}
      <div className="local-quiz-actions">
        <button
          type="button"
          className="md-button md-button-primary local-quiz-check"
          disabled={disabled}
          onClick={check}
        >
          {t('Check answer', '检查答案')}
        </button>
        <button
          type="button"
          className="md-button md-button-secondary local-quiz-again"
          disabled={disabled}
          onClick={tryAgain}
        >
          {t('Try again', '再试一次')}
        </button>
      </div>
      <span
        className={`local-quiz-feedback${feedbackClass}`}
        role="status"
        aria-live="polite"
      >
        {feedback ? `${result === 'correct' ? '✓ ' : result === 'incorrect' ? '✗ ' : ''}${feedback}` : ''}
      </span>
      {result !== null && explanation ? (
        <div className="local-quiz-explanation">{explanation}</div>
      ) : null}
      <PrintValue
        block
        value={
          type === 'choice'
            ? `${feedback ? `${feedback} · ` : ''}${optionLabels.join(' · ')}`
            : feedback || t('No answer yet', '尚未作答')
        }
      />
      <FieldError message={disabledInvalid ? t('Cannot compute', '无法计算') : null} />
    </div>
  );
}

/* ------------------------------------------------------------------ steps */

function StepsView({ node, visible }: LocalComponentProps) {
  const domId = useId();
  const { runtime, render, mode } = useLocal();
  const t = useLocalize();
  const { write, error, setError } = useWriter(node);
  const label = textAttr(runtime, node, 'label', '', t);
  const steps = (node.children ?? []).filter(
    (child) => child.type === 'component' && child.name === 'step',
  );
  const values = steps.map((step, index) => rawAttr(step, 'value') ?? `step-${index + 1}`);
  const labels = steps.map((step, index) =>
    textAttr(runtime, step, 'label', values[index], t),
  );
  const initial = rawAttr(node, 'initial') ?? '';
  const first = values.includes(initial) ? initial : values[0] ?? '';
  const stored = currentValue(runtime, node);
  const boundValue = typeof stored === 'string' ? stored : '';
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const focusAfterNavigation = useRef(false);

  useResetToken(runtime, node, () => {
    setError(null);
    focusAfterNavigation.current = false;
  });

  const current = values.includes(boundValue) ? boundValue : first;
  const activeIndex = Math.max(0, values.indexOf(current));

  useEffect(() => {
    if (!focusAfterNavigation.current) return;
    focusAfterNavigation.current = false;
    panelRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, current]);

  if (steps.length === 0) {
    return <LocalError message={t('Steps requires at least one step', '步骤至少需要一个 step')} />;
  }

  // Static steps show the current step and its position; navigation controls
  // are interaction-only and have no read-only equivalent.
  if (mode === 'static') {
    const active = steps[activeIndex];
    return (
      <section className="local-steps local-static-steps" aria-label={label || t('Steps', '步骤')}>
        {label ? <div className="local-steps-label">{label}</div> : null}
        <div className="local-steps-nav local-static-steps-nav">
          <span className="local-steps-status" role="status" aria-live="polite">
            {t(`Step ${activeIndex + 1} of ${steps.length}`, `第 ${activeIndex + 1} 步，共 ${steps.length} 步`)}
          </span>
        </div>
        <div className="local-steps-panel" role="group" aria-label={labels[activeIndex]}>
          {render(active.children ?? [], visible)}
        </div>
      </section>
    );
  }

  const go = (index: number) => {
    const value = values[index];
    if (value === undefined) return;
    focusAfterNavigation.current = true;
    write(value);
  };

  return (
    <section className="local-steps" aria-label={label || t('Steps', '步骤')}>
      {label ? <div className="local-steps-label">{label}</div> : null}
      <div className="local-steps-nav">
        <button
          type="button"
          className="md-button md-button-secondary local-steps-prev"
          disabled={activeIndex <= 0}
          onClick={() => go(activeIndex - 1)}
        >
          {t('Previous', '上一步')}
        </button>
        <span className="local-steps-status" role="status" aria-live="polite">
          {t(`Step ${activeIndex + 1} of ${steps.length}`, `第 ${activeIndex + 1} 步，共 ${steps.length} 步`)}
        </span>
        <button
          type="button"
          className="md-button md-button-secondary local-steps-next"
          disabled={activeIndex >= steps.length - 1}
          onClick={() => go(activeIndex + 1)}
        >
          {t('Next', '下一步')}
        </button>
      </div>
      {steps.map((step, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={step.id}
            id={`${domId}-step-${index}`}
            ref={(element) => {
              panelRefs.current[index] = element;
            }}
            className="local-steps-panel"
            role="group"
            aria-label={labels[index]}
            tabIndex={-1}
            hidden={!active}
          >
            {render(step.children ?? [], visible && active)}
          </div>
        );
      })}
      <FieldError message={error} />
    </section>
  );
}

function StepView() {
  return null;
}

const COMPONENTS: Record<string, (props: LocalComponentProps) => ReactNode> = {
  panel: PanelView,
  card: CardView,
  grid: GridView,
  tabs: TabsView,
  tab: TabView,
  accordion: AccordionView,
  disclosure: DisclosureView,
  if: IfView,
  alert: AlertView,
  badge: BadgeView,
  tooltip: TooltipView,
  input: InputView,
  textarea: TextareaView,
  number: NumberView,
  slider: SliderView,
  toggle: ToggleView,
  checkbox: CheckboxView,
  date: DateView,
  select: SelectView,
  choices: ChoicesView,
  'radio-group': RadioGroupView,
  option: OptionView,
  node: TabView,
  edge: EdgeView,
  counter: CounterView,
  timer: TimerView,
  checklist: ChecklistView,
  progress: ProgressView,
  jump: JumpView,
  anchor: AnchorView,
  text: TextView,
  section: SectionView,
  'multi-select': MultiSelectView,
  'range-slider': RangeSliderView,
  coordinate: CoordinateView,
  quiz: QuizView,
  steps: StepsView,
  step: StepView,
};

/* ---------------------------------------------------------------- document */

export function LocalDocumentView({
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
  const anchors = useMemo(
    () => createHeadingAnchors(document, `local-heading-${instanceId}`),
    [document, instanceId],
  );
  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  const rootRef = useRef<HTMLElement>(null);
  const report = useCallback((diagnostics: Diagnostic[]) => {
    reportRef.current?.(diagnostics);
  }, []);

  // Theme resolution only depends on manifest content, so a host array with
  // identical entries never restarts the reporting effect.
  const themesKey = themesSignature(themes);
  const theme = useMemo(() => {
    try {
      return resolveLocalTheme(document.theme, themes, document.themeRange, document.source);
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

  const env: RenderEnv = { runtime, urlPolicy, imageResolver, anchors, t, mode: renderedMode };
  const render = (nodes?: LocalNode[], visible = true): ReactNode => (
    <LocalViewContext.Provider
      value={{ runtime, render, visible, mode: renderedMode, report, urlPolicy, imageResolver, anchors, rootRef, t }}
    >
      {renderNodes(env, nodes ?? [], visible)}
    </LocalViewContext.Provider>
  );

  return (
    <LocalLocaleProvider locale={locale}>
      <article
        ref={rootRef}
        className={`md-document local-document${renderedMode === 'static' ? ' local-static' : ''}`}
        data-rmd-theme={theme.name}
        data-color-scheme={resolvedScheme}
        data-render-mode={renderedMode}
        style={{ colorScheme: resolvedScheme }}
        aria-label={
          renderedMode === 'static'
            ? t('Static document', '静态文档')
            : t('Interactive document', '交互文档')
        }
      >
        {render(document.nodes, true)}
      </article>
    </LocalLocaleProvider>
  );
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
}: LocalReactiveDocumentProps) {
  const result = useMemo(() => compileLocal(source), [source]);
  const runtime = useMemo(() => {
    if (!result.ok) return null;
    try {
      return createLocalRuntime(result.document);
    } catch {
      return null;
    }
  }, [result]);

  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  const currentRuntime = useRef(runtime);
  currentRuntime.current = runtime;
  const mounted = useRef(0);

  // Theme/color-mode props never feed the runtime memo above, so changing them
  // re-renders the document without recreating state.
  const themesKey = themesSignature(themes);
  const themeDiagnostics = useMemo(() => {
    if (!result.ok) return [] as Diagnostic[];
    try {
      return resolveLocalTheme(
        result.document.theme,
        themes,
        result.document.themeRange,
        result.document.source,
      ).diagnostics;
    } catch {
      return [] as Diagnostic[];
    }
  }, [result, themesKey]);

  // Host callbacks see compile and theme diagnostics together; runtime write
  // diagnostics from the view are appended rather than replacing them.
  const lastReport = useRef<string | null>(null);
  const emit = useCallback((diagnostics: Diagnostic[]) => {
    const signature = diagnosticsSignature(diagnostics);
    if (signature === lastReport.current) return;
    lastReport.current = signature;
    reportRef.current?.(diagnostics);
  }, []);

  useEffect(() => {
    emit(composeDiagnostics(result.diagnostics, themeDiagnostics));
  }, [result, themeDiagnostics, emit]);

  const handleViewDiagnostics = useCallback(
    (diagnostics: Diagnostic[]) => {
      emit(composeDiagnostics(result.diagnostics, themeDiagnostics, diagnostics));
    },
    [result, themeDiagnostics, emit],
  );

  useEffect(() => {
    mounted.current += 1;
    return () => {
      mounted.current -= 1;
    };
  }, []);

  useEffect(() => {
    const owned = runtime;
    return () => {
      // StrictMode runs setup, cleanup, then setup synchronously. Deferring
      // disposal one microtask lets that remount re-claim the same runtime
      // (mounted > 0 and still current). A runtime replaced by a new source is
      // no longer current and is disposed even while the document stays mounted.
      queueMicrotask(() => {
        if (currentRuntime.current === owned && mounted.current > 0) return;
        try {
          owned?.dispose();
        } catch {
          /* Disposal is best-effort during unmount. */
        }
      });
    };
  }, [runtime]);

  if (!result.ok || !runtime) {
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
                {diagnostic.message}
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
      key={source}
      document={result.document}
      runtime={runtime}
      onDiagnostics={handleViewDiagnostics}
      urlPolicy={urlPolicy}
      locale={locale}
      themes={themes}
      colorScheme={colorScheme}
      mode={mode}
      staticFirst={staticFirst}
      imageResolver={imageResolver}
    />
  );
}

