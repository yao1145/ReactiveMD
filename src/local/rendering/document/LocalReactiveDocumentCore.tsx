import {
  LocalDocumentViewCore,
  type BaseConfigProps,
  type LocalReactiveDocumentProps,
} from './LocalDocumentViewCore';
import type {
  Diagnostic,
  LocalCompileOptions,
  LocalCompileResult,
  LocalDocument,
  LocalRuntime,
  LocalSnapshot,
  LocalValue,
} from '../../types';
import { assertExtensionProps } from './view-render-context';
import { readLocalConfig } from '../../../sdk/config';
import { localCompileOptionsKey, localRuntimeOptionsKey, readLocalCompileOptions } from '../../configuration/options';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createLocalRuntime, notifyLocalRuntime, updateLocalRuntime } from '../../runtime/runtime';
import {
  cloneParameterValues,
  composeDiagnostics,
  diagnosticsSignature,
  parameterRecordsEqual,
  themesSignature,
} from './view-revision';
import { createLocalCompileSession, type LocalCompileSession } from '../../compilation/session/incremental';
import { resolveLocalTheme } from '../../../themes/document-theme';
import { localize } from '../../../react/localization';
import { formatLocalDiagnostic } from '../../configuration/diagnostics';

const DEFAULT_NETWORK_SCOPE = Symbol('implicit document identity');

type LocalReactiveDocumentCoreProps = LocalReactiveDocumentProps & BaseConfigProps & {
  readonly useBaseCompileConfig?: boolean;
};

/**
 * Optional private compile path supplied by the incremental compiler. It
 * returns a read-only result whose unchanged nodes keep their identity; the
 * public `compile` protocol is unaffected.
 */
interface SharedCompileSession {
  compileShared?(source: string, options?: LocalCompileOptions): LocalCompileResult;
}

export function LocalReactiveDocumentCore({
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
  useBaseCompileConfig,
  externalValues,
  network,
  documentId,
  randomSeed,
  componentState,
  componentStateStorage,
  componentStateWriteDelayMs,
  onComponentStateChange,
  initialParameters,
  onParametersChange,
  onSourceNavigate,
  compileOptions,
  capabilityGrants,
  allowedFrameOrigins,
  getBaseConfig,
}: LocalReactiveDocumentCoreProps) {
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
  // An entry that installs its own default components compiles against that
  // assembly unless the host supplies an explicit `reactConfig`. This default
  // is implicit, so `themes`, `hostData` and `hostRenderer` stay legal. A
  // compile-side registry the host supplies still wins, exactly as it did when
  // the entry installed no preset.
  const implicitConfig = reactConfig === undefined && useBaseCompileConfig ? getBaseConfig() : undefined;
  const injectDefaultConfig = implicitConfig !== undefined
    && compileOptions?.config === undefined
    && compileOptions?.hostComponents === undefined;
  // Flags, limits and Markdown options still apply; only the component registry
  // is selected by the config.
  const effectiveCompileOptions: LocalCompileOptions | undefined = reactConfig !== undefined
    ? { ...(compileOptions ?? {}), config: reactConfig.config }
    : injectDefaultConfig
      ? { ...(compileOptions ?? {}), config: implicitConfig.config }
      : compileOptions;
  // An explicit SDK config owns themes; otherwise the host theme manifest
  // wins and the implicit default only fills an omitted prop.
  const effectiveThemes = reactConfig?.themes ?? themes ?? implicitConfig?.themes;
  const optionsKey = localCompileOptionsKey(effectiveCompileOptions);
  const runtimeKey = `${localRuntimeOptionsKey(effectiveCompileOptions)}|${documentId ?? ''}|${randomSeed ?? ''}`;
  // The latest external values seed a newly created runtime; later changes go
  // through the view's update effect without recompiling or resetting state.
  const externalRef = useRef(externalValues);
  externalRef.current = externalValues;
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;
  const randomSeedRef = useRef(randomSeed);
  randomSeedRef.current = randomSeed;
  const componentStateRef = useRef(componentState);
  componentStateRef.current = componentState;
  const componentStateStorageRef = useRef(componentStateStorage);
  componentStateStorageRef.current = componentStateStorage;
  const componentStateWriteDelayMsRef = useRef(componentStateWriteDelayMs);
  componentStateWriteDelayMsRef.current = componentStateWriteDelayMs;
  const onComponentStateChangeRef = useRef(onComponentStateChange);
  onComponentStateChangeRef.current = onComponentStateChange;
  const initialParametersRef = useRef(initialParameters);
  initialParametersRef.current = initialParameters;
  const onParametersChangeRef = useRef(onParametersChange);
  onParametersChangeRef.current = onParametersChange;
  /** Diagnostics from applying initial parameters to the current runtime. */
  const initialDiagnosticsRef = useRef<Diagnostic[]>([]);
  /** Compile configuration identity used to verify and stamp component state. */
  const runtimeConfig = effectiveCompileOptions?.config;
  const runtimeConfigKey = runtimeConfig?.key;
  const runtimeLegacyConfigKeys = runtimeConfig?.legacyKeys.map((entry) => entry.key) ?? [];
  const initializeRuntime = (document: LocalDocument): LocalRuntime => {
    const created = createLocalRuntime(document, {
      externalValues: externalRef.current,
      documentId: documentIdRef.current,
      randomSeed: randomSeedRef.current,
      componentState: componentStateRef.current,
      ...(componentStateStorageRef.current === undefined
        ? {}
        : { componentStateStorage: componentStateStorageRef.current }),
      ...(componentStateWriteDelayMsRef.current === undefined
        ? {}
        : { componentStateWriteDelayMs: componentStateWriteDelayMsRef.current }),
      ...((runtimeConfigKey ?? document.componentConfigKey) === undefined
        ? {}
        : { configKey: runtimeConfigKey ?? document.componentConfigKey }),
      ...(runtimeLegacyConfigKeys.length === 0
        ? {}
        : { legacyConfigKeys: runtimeLegacyConfigKeys }),
    });
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
    if (runtime && runtimeOptionsKey.current !== runtimeKey) {
      // Changes to the document identity or structural options release the runtime.
      // Flush before the replacement reads storage again.
      try { runtime.services?.state.flush(); } catch { /* Disposal is best-effort. */ }
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
        try { runtime.services?.state.flush(); } catch { /* Disposal is best-effort. */ }
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
    runtimeOptionsKey.current = runtimeKey;
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
  const stateDiagnostics = useRef<Diagnostic[]>([]);
  const flush = useCallback(() => {
    emit(composeDiagnostics(
      result.diagnostics,
      themeDiagnostics,
      initialDiagnosticsRef.current,
      viewDiagnostics.current,
      stateDiagnostics.current,
    ));
  }, [result, themeDiagnostics, emit]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const services = runtime?.services;
    const next = services === undefined ? [] : services.state.diagnostics();
    const previous = stateDiagnostics.current;
    const same = next.length === previous.length
      && next.every((item, index) => item === previous[index]);
    if (same) return;
    stateDiagnostics.current = [...next];
    flushRef.current();
  });

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

  useEffect(() => {
    const services = runtime?.services;
    if (!services || onComponentStateChange === undefined) return;
    return services.state.subscribe(() => {
      onComponentStateChangeRef.current?.(services.state.snapshot());
    });
  }, [runtime, onComponentStateChange]);

  useEffect(() => {
    const state = runtime?.services?.state;
    if (state === undefined) return;
    const flush = (): void => state.flush();
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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

  const options = readLocalCompileOptions(effectiveCompileOptions);
  const grants = options.ok ? {
    enableCss: options.html.enableCss && (capabilityGrants?.enableCss ?? true) === true,
    enableJavaScript: options.html.enableJavaScript && (capabilityGrants?.enableJavaScript ?? true) === true,
    enableExtendedHtml: options.html.enableExtendedHtml && (capabilityGrants?.enableExtendedHtml ?? true) === true,
  } : undefined;
  return (
    <LocalDocumentViewCore
      // Re-mount only when host options change; source edits update the
      // document and runtime in place so unchanged blocks keep their state.
      key={runtimeKey}
      document={result.document}
      runtime={runtime}
      capabilityGrants={grants}
      allowedFrameOrigins={allowedFrameOrigins}
      network={network}
      networkScope={documentId ?? DEFAULT_NETWORK_SCOPE}
      onDiagnostics={handleViewDiagnostics}
      urlPolicy={urlPolicy}
      locale={locale}
      // The explicit config carries its own themes; the implicit default only
      // fills an omitted manifest and must not mask an empty host array.
      themes={reactConfig === undefined ? effectiveThemes : undefined}
      colorScheme={colorScheme}
      mode={mode}
      staticFirst={staticFirst}
      imageResolver={imageResolver}
      hostData={hostData}
      hostRenderer={hostRenderer}
      reactConfig={reactConfig}
      getBaseConfig={getBaseConfig}
      externalValues={externalValues}
      onSourceNavigate={onSourceNavigate}
    />
  );
}
