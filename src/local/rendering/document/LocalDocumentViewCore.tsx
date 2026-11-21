import type {
  Diagnostic,
  LocalCompileOptions,
  LocalDocument,
  LocalHtmlOptions,
  LocalNode,
  LocalRuntime,
  LocalSnapshot,
  LocalValue,
} from '../../types';
import {
  createNetworkSession,
  unavailableNetwork,
  type NetworkConfig,
  type NetworkSession,
} from '../../../runtime-services/network';
import {
  defaultLocalize,
  localize,
  LocalLocaleProvider,
  type Localize,
  type LocalLocale,
} from '../../../react/localization';
import {
  DEFAULT_LOCAL_THEME,
  resolveLocalTheme,
  type LocalColorScheme,
  type LocalThemeDefinition,
} from '../../../themes/document-theme';
import type { LocalHostData, LocalHostRenderer, LocalRenderMode, LocalSourceTarget } from '../render-types';
import {
  localReactExtensionRenderer,
  validateLocalReactExtensions,
  type LocalReactConfig,
} from '../../../react/sdk-core';
import type {
  LocalComponentStateDocument,
  LocalComponentStateStorage,
} from '../../../runtime-services/component-state';
import { textProblem as componentTextProblem } from '../../../react/field-validation';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { localHtmlSandbox, sanitizeLocalHtmlDocument } from '../../html/html';
import { intersectCapabilityPolicy } from '../../configuration/capability-policy';
import { DEFAULT_MAX_LOCAL_SYNTAX_NODES } from '../../configuration/limits';
import { assertExtensionProps } from './view-render-context';
import { beginLocalComponentRender } from '../../../react/component-api';
import { getLocalComponentRegistry } from '../../../sdk/registry';
import {
  diagnosticsSignature,
  themesSignature,
  useDependencyIndex,
  useProjectedMemo,
} from './view-revision';
import {
  projectAnchors,
  projectFootnotes,
  sameAnchorProjection,
  sameFootnoteProjection,
  validationDiagnosticKey,
  validationProjectionKey,
} from './view-revision';
import { createHeadingAnchors } from '../../parsing/heading-anchors';
import { collectLocalFootnotes } from '../../parsing/footnotes';
import { bindLocalNetworkExternals } from '../../runtime/runtime';
import type { LocalComponentDefinition } from '../../../sdk/types';
import { validateLocalDocumentConfig } from '../../../sdk/config';
import { validateLocalComponentContracts } from '../../../export/requirements';
import { useResolvedColorScheme } from './use-color-scheme';
import { useStableValidation } from './validation-state';
import { LocalViewContext, type RenderEnv } from './view-render-context';
import { EndnotesView, renderNodes } from './render-nodes';
import { useAuthorScript } from './use-author-script';
import { scopeAuthorStyles } from '../../css/author-css';
import { OverflowTextTooltip } from '../../../react/overflow-text-tooltip';

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
  /** Mount-local grants, bounded by the permissions recorded at compilation. */
  capabilityGrants?: LocalHtmlOptions;
  /** Exact HTTPS origins available to an extended iframe in this mount. */
  allowedFrameOrigins?: readonly string[];
  /** Optional view-scoped channels. Keep the reference stable while authorization is unchanged. */
  network?: NetworkConfig;
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
  /** Further restrict the grants given by compileOptions for this mount. */
  capabilityGrants?: LocalHtmlOptions;
  allowedFrameOrigins?: readonly string[];
  /** Channels granted to the current document and user. */
  network?: NetworkConfig;
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
  /** Stable host identity for component-scoped state. Defaults to the source digest. */
  documentId?: string;
  /** Document-level seed for component randomness. */
  randomSeed?: number;
  /** Component-state sidecar restored before the first render. */
  componentState?: unknown;
  /**
   * Persistence port applied when this document creates a runtime. Changing it
   * later does not migrate an existing runtime; pass a new `componentState`
   * sidecar or remount instead.
   */
  componentStateStorage?: LocalComponentStateStorage;
  /**
   * Coalesce component-state writes. Memory updates immediately; a positive
   * delay writes the stored sidecar at most once per window and flushes it when
   * the page is hidden or the runtime is disposed. Defaults to 0 (write after
   * every save or clear).
   */
  componentStateWriteDelayMs?: number;
  /** Called when a component explicitly saves or clears its state. */
  onComponentStateChange?: (state: LocalComponentStateDocument) => void;
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

/* --------------------------------------------------------------- contexts */
export type BaseConfigProps = { readonly getBaseConfig: () => LocalReactConfig };

type LocalDocumentViewCoreProps = LocalDocumentViewProps & BaseConfigProps & {
  readonly networkScope?: string | symbol;
};

const EMPTY_SNAPSHOT: LocalSnapshot = { revision: 0, state: {} };

/** Compatibility helper; controls and the renderer share the React-layer validation. */
export function textProblem(value: string, options: Parameters<typeof componentTextProblem>[1], t: Localize = defaultLocalize): string | null {
  return componentTextProblem(value, options, t);
}

/* ---------------------------------------------------------------- document */
export function LocalHtmlSourceFallback({source, mode}: {source: string; mode: LocalRenderMode}) {
  return <article className={`md-document local-document${mode === 'static' ? ' local-static' : ''}`}
    data-source-mode="html" data-render-mode={mode} data-html-fallback="document">
    <pre className="local-fallback local-fallback-block" style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{source}</pre>
  </article>;
}

function LocalDocumentViewHtml({ document, capabilityGrants, mode = 'interactive', staticFirst = false, locale = 'en', onDiagnostics }: LocalDocumentViewProps) {
  const [settled, setSettled] = useState(!staticFirst);
  useEffect(() => { if (staticFirst) setSettled(true); }, [staticFirst]);
  const renderedMode = mode === 'interactive' && staticFirst && !settled ? 'static' : mode;
  const effective = intersectCapabilityPolicy(document.html, capabilityGrants);
  const enableCss = effective.enableCss;
  const enableJavaScript = renderedMode === 'interactive' && effective.enableJavaScript;
  const enableExtendedHtml = effective.enableExtendedHtml;
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
export function LocalDocumentViewCore(props: LocalDocumentViewCoreProps) {
  assertExtensionProps(props.reactConfig, props);
  // One render pass: static prop diagnostics are deduplicated inside it and
  // reset for the next independent render/SSR pass.
  beginLocalComponentRender(props.runtime);
  return props.document.html && props.document.nodes.length === 1
    && ['htmlDocument', 'fallback'].includes(props.document.nodes[0].type)
    ? <LocalDocumentViewHtml {...props} />
    : <LocalDocumentViewLocal {...props} />;
}

function LocalDocumentViewLocal({
  document,
  runtime,
  capabilityGrants,
  allowedFrameOrigins,
  network,
  networkScope,
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
  getBaseConfig,
}: LocalDocumentViewCoreProps) {
  const [staticFirstSettled, setStaticFirstSettled] = useState(!staticFirst);
  useEffect(() => {
    if (staticFirst) setStaticFirstSettled(true);
  }, [staticFirst]);
  const renderedMode: LocalRenderMode = mode === 'interactive' && staticFirst && !staticFirstSettled
    ? 'static'
    : mode;
  const granted = intersectCapabilityPolicy(document.capabilities?.policy, capabilityGrants);
  const authorCss = granted.enableCss;
  const authorJavaScript = renderedMode === 'interactive' && granted.enableJavaScript;
  const extendedHtml = granted.enableExtendedHtml;
  const policy = useMemo(() => ({
    enableCss: authorCss, enableJavaScript: authorJavaScript, enableExtendedHtml: extendedHtml,
  }), [authorCss, authorJavaScript, extendedHtml]);
  const networkIdentity = networkScope ?? runtime;
  const [activeNetwork, setActiveNetwork] = useState<{
    config: NetworkConfig;
    identity: typeof networkIdentity;
    session: NetworkSession;
  }>();
  useLayoutEffect(() => {
    if (renderedMode !== 'interactive' || network === undefined) {
      setActiveNetwork(undefined);
      return;
    }
    // Each effect setup owns a session, including effect replay and remounts.
    const session = createNetworkSession(network);
    setActiveNetwork({ config: network, identity: networkIdentity, session });
    return () => session.dispose();
  }, [network, networkIdentity, renderedMode]);
  const viewSession = renderedMode === 'interactive'
    && activeNetwork?.config === network && activeNetwork?.identity === networkIdentity
    ? activeNetwork.session
    : undefined;
  const viewNetwork = network === undefined ? undefined : viewSession?.network ?? unavailableNetwork;
  const instanceId = useId();
  const sourceStyles = authorCss ? document.capabilities?.styles : undefined;
  const sourceRules = useMemo(() => sourceStyles?.map(block => scopeAuthorStyles(block.text)).join('\n'), [sourceStyles]);
  const componentStyles = authorCss ? document.capabilities?.componentStyles : undefined;
  const t = useMemo<Localize>(
    () => (en: string, zh: string) => localize(locale, en, zh),
    [locale],
  );
  // Installed contracts also own navigation semantics. An implicit default
  // assembly keeps precedence over the entry-wide base config so one document
  // never renders with another preset's implementations.
  const effectiveReactConfig = useMemo(
    () => reactConfig ?? getBaseConfig(),
    [reactConfig, getBaseConfig],
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
  const dependencyIndex = useDependencyIndex(document, registry);
  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;
  const rootRef = useRef<HTMLElement>(null);
  const report = useCallback((diagnostics: Diagnostic[]) => {
    reportRef.current?.(diagnostics);
  }, []);
  const dispatchAuthorAction = useAuthorScript(document, runtime, authorJavaScript, report);
  useLayoutEffect(() => {
    if (viewSession) return bindLocalNetworkExternals(runtime, viewSession, report);
  }, [runtime, viewSession, report]);

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
    const diagnostics = validateLocalReactExtensions(effectiveReactConfig, document.extensions);
    diagnostics.push(...validateLocalDocumentConfig(document, effectiveReactConfig.config));
    return { valid: diagnostics.length === 0, diagnostics };
  }, [effectiveReactConfig, extensionKey, document.componentConfigKey]);
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
    () => localReactExtensionRenderer(extensionContractsValid ? effectiveReactConfig : getBaseConfig()),
    [effectiveReactConfig, extensionContractsValid, getBaseConfig],
  );
  const extensionRenderer = useMemo(
    () => (reactConfig !== undefined && extensionContractsValid
      ? localReactExtensionRenderer(effectiveReactConfig)
      : undefined),
    [reactConfig, effectiveReactConfig, extensionContractsValid],
  );
  // An explicit config owns themes; otherwise the host manifest wins and the
  // implicit default only fills an omitted prop.
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
    if (origin.closest('input, textarea, select, button, a, summary, [contenteditable="true"], [role="button"], [role="listbox"], [role="option"], [role="menu"], [role="dialog"]')) return;
    const target = origin.closest<HTMLElement>('[data-rmd-source-start]');
    if (!target || !rootRef.current?.contains(target)) return;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    // A text selection inside the document means this click finished a drag, so
    // it must not navigate. A selection elsewhere (a host editor keeps its own)
    // is not a preview drag and must not suppress navigation: controls that set
    // `user-select: none` never collapse it on mousedown.
    if (selection && selection.toString().trim() && selection.anchorNode && rootRef.current?.contains(selection.anchorNode)) return;
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
      network: viewNetwork,
      capabilityPolicy: policy,
      allowedFrameOrigins,
      componentStyles,
      dispatchAuthorAction,
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
    [runtime, viewNetwork, policy, allowedFrameOrigins, componentStyles, dispatchAuthorAction, rootRef, urlPolicy, imageResolver, hostData, hostRenderer, extensionContractsValid, extensionRenderer, componentRenderer, definitions, anchors, t, locale, renderedMode, dependencyIndex, footnotes, sourceNavigation, validation, report],
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
        lang={locale === 'zh' ? 'zh-CN' : 'en'}
        data-rmd-theme={theme.name}
        data-rmd-document=""
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
        {sourceRules && <style data-rmd-author-css="" dangerouslySetInnerHTML={{ __html: sourceRules }} />}
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
          <OverflowTextTooltip rootRef={rootRef} enabled={renderedMode !== 'static'} />
        </LocalViewContext.Provider>
      </article>
    </LocalLocaleProvider>
  );
}
