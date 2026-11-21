import type {
  LocalHostData,
  LocalHostRenderer,
  LocalRenderContext,
  LocalRenderMode,
  LocalSourceTarget,
} from '../render-types';
import type { LocalComponentDefinition } from '../../../sdk/types';
import { useLocalize, type Localize, type LocalLocale } from '../../../react/localization';
import type { Diagnostic, LocalHtmlPolicy, LocalNode, LocalRuntime, LocalValue } from '../../types';
import type { AuthorAction } from '../../runtime/author-script-protocol';
import { parseAuthorDeclarations } from '../../css/author-css';
import type { LocalImageResolver, LocalUrlPolicy } from './LocalDocumentViewCore';
import { createHeadingAnchors } from '../../parsing/heading-anchors';
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { LocalValidationState } from './validation-state';
import type { DependencyLookup } from './view-revision';
import type { LocalFootnoteIndex } from '../../parsing/footnotes';
import type { ComponentNetwork } from '../../../runtime-services/network';
import type { LocalReactConfig, LocalReactRenderEnvironment } from '../../../react/sdk-core';
import { splitHtmlDetailsChildren } from '../../html/html-details';
import { PrintValue } from '../../../react/component-utils';

export interface LocalViewContext extends LocalRenderContext {
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

export const LocalViewContext = createContext<LocalViewContext | null>(null);

function useLocal(): LocalViewContext {
  const value = useContext(LocalViewContext);
  if (!value) throw new Error('LocalViewContext is not initialized');
  return value;
}

function rawAttr(node: LocalNode, name: string): string | undefined {
  return node.attrs?.[name];
}

export function scalarText(value: LocalValue): string | null {
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

export function readBooleanAttr(
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
export function LocalError({ message }: { message?: string }) {
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
export class LocalErrorBoundary extends Component<LocalBoundaryProps, { failed: boolean }> {
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

export function safeUrl(
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

export interface RenderEnv {
  network?: ComponentNetwork;
  capabilityPolicy?: LocalHtmlPolicy;
  allowedFrameOrigins?: readonly string[];
  componentStyles?: Readonly<Record<string, string>>;
  dispatchAuthorAction?: (nodeId: string, action: AuthorAction) => boolean;
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

export function sourceProps(
  env: RenderEnv,
  node: LocalNode,
  componentName?: string,
): Record<string, string> {
  return sourceAttributes(env.sourceNavigation !== undefined, node, componentName);
}

/* ------------------------------------------------------- public adapter */

/** Line/column for an adapter-owned diagnostic, clamped to the source. */
export function sourcePosition(env: RenderEnv, offset: number): { line: number; column: number } {
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

/** Nearest scroll container the host wraps around this document instance. */
function documentScrollContainer(root: HTMLElement): HTMLElement | null {
  for (let element = root.parentElement; element; element = element.parentElement) {
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return element;
  }
  return null;
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
  const container = documentScrollContainer(root);
  if (container) {
    // Scrolling only the host's document viewport keeps an embedded preview
    // from dragging the surrounding page along.
    const containerStyle = getComputedStyle(container);
    const border = Number.parseFloat(containerStyle.borderTopWidth) || 0;
    const padding = Number.parseFloat(containerStyle.scrollPaddingTop) || 0;
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const top = container.scrollTop
      + element.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      - border - padding - margin;
    try {
      container.scrollTo({ top: Math.max(0, top), behavior });
    } catch {
      container.scrollTop = Math.max(0, top);
    }
    return 'ok';
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
type NodeRenderer = (env: RenderEnv, nodes: LocalNode[] | undefined, visible: boolean) => ReactNode;

export function extensionEnvironment(
  env: RenderEnv,
  node: LocalNode,
  visible: boolean,
  renderNodes: NodeRenderer,
  renderInlineNodes: NodeRenderer,
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
    authorStyle: env.componentStyles && Object.hasOwn(env.componentStyles, node.id)
      ? parseAuthorDeclarations(env.componentStyles[node.id])
      : undefined,
    dispatchAuthorAction: env.dispatchAuthorAction && (action => env.dispatchAuthorAction!(node.id, action)),
    services: env.runtime.services,
    network: env.network,
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

/**
 * P0 `<details>`/`<summary>`. One element renders as one single-disclosure
 * accordion: the summary is the trigger content (rich inline Markdown stays
 * intact), the remaining children are the panel, and an author `open`
 * attribute starts it expanded by boolean presence. Static mode exposes the
 * body and keeps the same disclosure structure; nested details recurse.
 */
export function HtmlDetailsView({ node, visible, renderInlineNodes, safeHtmlProps }: LocalComponentProps & {
  renderInlineNodes: NodeRenderer;
  safeHtmlProps: (env: RenderEnv, node: LocalNode) => Record<string, string>;
}) {
  const domId = useId();
  const local = useLocal();
  const { render, mode } = local;
  const t = useLocalize();
  // The parser stores a normalized list, but this split also repairs documents
  // parsed before normalization and keeps both paths on one rule.
  const { summary, body } = splitHtmlDetailsChildren(node.children ?? []);
  const summaryContent = summary
    ? <span {...safeHtmlProps(local, summary)}>{renderInlineNodes(local, summary.children, visible)}</span>
    : t('Details', '折叠内容');
  // Boolean presence, not the literal value: `open="false"` is still open.
  const initialOpen = node.attrs !== undefined && Object.hasOwn(node.attrs, 'open');
  const [open, setOpen] = useState(initialOpen);
  useResetToken(local.runtime, node, () => setOpen(initialOpen));
  const groupLabel = t('Accordion', '折叠面板');

  if (mode === 'static') {
    return (
      <div className="local-accordion" role="group" aria-label={groupLabel}>
        <section className="local-disclosure local-static-disclosure local-html-details" {...safeHtmlProps(local, node)}>
          <h3 className="local-disclosure-heading">{summaryContent}</h3>
          <div className="local-disclosure-panel">{render(body, visible)}</div>
        </section>
      </div>
    );
  }

  const triggerId = `${domId}-html-details-trigger`;
  const panelId = `${domId}-html-details-panel`;
  return (
    <div className="local-accordion" role="group" aria-label={groupLabel}>
      <div className="local-disclosure local-html-details" {...safeHtmlProps(local, node)}>
        <h3 className="local-disclosure-heading">
          <button
            id={triggerId}
            type="button"
            className="local-disclosure-trigger"
            data-rmd-appearance="custom"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="local-disclosure-label">{summaryContent}</span>
            <svg
              className={`local-chevron${open ? ' is-open' : ''}`}
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <PrintValue value={summaryContent} />
        </h3>
        <div
          id={panelId}
          className="local-disclosure-panel"
          role="region"
          aria-labelledby={triggerId}
          hidden={!open}
        >
          <div className="local-disclosure-body">{render(body, visible && open)}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- attributes */
export const FULL_EXPRESSION = /^\s*\{\{([\s\S]*)\}\}\s*$/;

/**
 * A config plus legacy host props have two different renderer registries and
 * two different theme sources. Combining them is rejected instead of silently
 * preferring one, which would make the document depend on prop order.
 */
export function assertExtensionProps(
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
