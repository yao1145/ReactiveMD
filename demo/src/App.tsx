import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import type { Diagnostic, LocalRuntime, SourceRange } from 'reactive-md';
import { LocalDocumentView, LocalReactiveDocument } from 'reactive-md/react';
import { AuthorTools } from './author-tools';
import type { EditorEdit, EditorSelection } from './editor-commands';
import { EditorToolbar } from './editor-toolbar';
import {
  DEFAULT_EXAMPLE_ID,
  EXAMPLES,
  exampleSource,
  localizedExample,
  localizedExamples,
  resolveExampleId,
} from './examples';
import {
  COPY,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  LanguageProvider,
  useCopy,
  useLanguage,
  type Language,
} from './i18n';
import { useLocalCompilation, type LocalCompiledDocument } from './use-local-compilation';
import { PreviewStateSession } from './preview-state';
import { useEditorHeight } from './use-editor-height';
import { useGutterMetrics } from './use-gutter-metrics';
import { useSourceHistory } from './use-source-history';
import guideEnSource from '../../docs/local-guide-en.md?raw';
import guideZhSource from '../../docs/local-guide-ch.md?raw';

type LocalRuntimeInstance = LocalRuntime;

const DEFAULT_EXAMPLE = EXAMPLES.find((item) => item.id === DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0];
const SOURCE_PREFIX = 'reactive-md:local:source:';
const SELECTION_KEY = 'reactive-md:selection';
const SOURCE_WRITE_DELAY = 400;
const GUIDE_REPOSITORY = 'https://github.com/yao1145/ReactiveMD/blob/main';

// The guides live in docs/ and link to neighbouring files. Send those links
// to the repository (both English and Chinese docs) so they still work when a
// guide is rendered in the demo.
function rewriteGuideLinks(source: string): string {
  return source
    .replace(/\]\(\.\.\/examples\/local\/([^)]+)\)/g, `](${GUIDE_REPOSITORY}/examples/local/$1)`)
    .replace(/\]\(([a-z0-9-]+-(?:en|ch)\.md(?:#[^)]+)?)\)/g, `](${GUIDE_REPOSITORY}/docs/$1)`);
}

const GUIDE_SOURCES: Record<Language, string> = {
  en: rewriteGuideLinks(guideEnSource),
  zh: rewriteGuideLinks(guideZhSource),
};

function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function savedItem(key: string) {
  try { return browserStorage()?.getItem(key); } catch { return undefined; }
}

function initialLanguage(): Language {
  return savedItem(LANGUAGE_STORAGE_KEY) === 'zh' ? 'zh' : DEFAULT_LANGUAGE;
}

function initialExampleId() {
  const requested = new URLSearchParams(window.location.search).get('example');
  return resolveExampleId(requested) ?? resolveExampleId(savedItem(SELECTION_KEY)) ?? DEFAULT_EXAMPLE.id;
}

// Language-specific drafts live beside the original English draft key so
// existing saved English sources keep loading.
function draftKey(language: Language, id: string) {
  return `${SOURCE_PREFIX}${language}:${id}`;
}

function legacyDraftKey(id: string) {
  return `${SOURCE_PREFIX}${id}`;
}

function readDraft(language: Language, id: string) {
  const current = savedItem(draftKey(language, id));
  if (current !== null && current !== undefined) return current;
  return language === 'en' ? savedItem(legacyDraftKey(id)) : undefined;
}

function savedSource(id: string, language: Language) {
  const draft = readDraft(language, id);
  if (draft !== null && draft !== undefined) return draft;
  const example = EXAMPLES.find((item) => item.id === id) ?? DEFAULT_EXAMPLE;
  return exampleSource(example, language);
}

function writeDraft(storage: Storage, language: Language, id: string, text: string) {
  storage.setItem(draftKey(language, id), text);
  // Mirror English drafts to the pre-localization key for older builds and
  // for users who already have a saved source.
  if (language === 'en') storage.setItem(legacyDraftKey(id), text);
  storage.setItem(SELECTION_KEY, id);
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function unexpectedDiagnostic(
  error: unknown,
  formatMessage: (detail: string) => string,
): Diagnostic {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: 'demo.unexpected',
    message: formatMessage(detail),
    severity: 'error',
    range: { start: 0, end: 0 },
    line: 1,
    column: 1,
  };
}

function dedupeDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const item of items) {
    const key = `${item.code}|${item.range?.start ?? -1}|${item.range?.end ?? -1}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

interface DiagnosticListProps {
  diagnostics: Diagnostic[];
  focusDiagnostic: (range: SourceRange) => void;
  emptyText?: string;
}

function DiagnosticList({ diagnostics, focusDiagnostic, emptyText }: DiagnosticListProps) {
  const copy = useCopy().editor;
  if (diagnostics.length === 0) {
    return emptyText ? <p className="diagnostic-empty">{emptyText}</p> : null;
  }
  return (
    <ul className="diagnostic-list">
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code}-${diagnostic.range?.start ?? 0}-${index}`}>
          <button
            type="button"
            className="diagnostic-item"
            onClick={() => focusDiagnostic(diagnostic.range)}
            title={copy.locate}
          >
            <span className={`diag-severity diag-${diagnostic.severity === 'warning' ? 'warning' : 'error'}`}>
              {diagnostic.severity === 'warning' ? copy.warning : copy.error}
            </span>
            <span className="diag-message">{diagnostic.message}</span>
            <span className="diag-position">{copy.position(diagnostic.line, diagnostic.column)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface LocalPreviewProps {
  document: LocalCompiledDocument;
  session: PreviewStateSession;
  onDiagnostics: (diagnostics: Diagnostic[]) => void;
}

const LocalPreview = memo(function LocalPreview({ document, session, onDiagnostics }: LocalPreviewProps) {
  const language = useLanguage();
  const copy = useCopy();
  const [instance, setInstance] = useState<{
    document: LocalCompiledDocument;
    runtime: LocalRuntimeInstance;
  } | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;

  useEffect(() => {
    let runtime: LocalRuntimeInstance;
    let release: () => void;
    try {
      ({ runtime, release } = session.open(document));
    } catch (error) {
      setInitError(error instanceof Error ? error.message : String(error));
      reportRef.current([unexpectedDiagnostic(error, copy.status.unexpectedError)]);
      return;
    }
    setInstance({ document, runtime });
    setInitError(null);
    return release;
  }, [document, session, copy.status.unexpectedError]);

  if (initError) {
    return <div className="preview-error" role="alert">
      <h3>{copy.preview.startErrorTitle}</h3>
      <p>{initError}</p>
    </div>;
  }
  if (!instance || instance.document !== document) {
    return <div className="preview-loading" role="status"><p>{copy.preview.preparing}</p></div>;
  }
  return (
    <LocalDocumentView
      document={document}
      runtime={instance.runtime}
      onDiagnostics={onDiagnostics}
      locale={language}
    />
  );
});

interface GuideViewProps {
  dark: boolean;
  onTheme(): void;
  onBack(): void;
}

function GuideView({ dark, onTheme, onBack }: GuideViewProps) {
  const language = useLanguage();
  const copy = useCopy();
  return (
    <main className="guide-view">
      <div className="guide-toolbar">
        <div>
          <p className="eyebrow">{copy.guide.eyebrow}</p>
          <h2>{copy.guide.title}</h2>
          <p>{copy.guide.intro}</p>
        </div>
        <div className="guide-actions">
          <button type="button" className="button button-secondary" onClick={onTheme}>
            {dark ? copy.guide.lightTheme : copy.guide.darkTheme}
          </button>
          <button type="button" className="button button-secondary" onClick={onBack}>
            {copy.guide.back}
          </button>
        </div>
      </div>
      <div className="guide-paper">
        <LocalReactiveDocument source={GUIDE_SOURCES[language]} locale={language} />
      </div>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<'playground' | 'guide'>('playground');
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [selectedExample, setSelectedExample] = useState(initialExampleId);
  const [source, setSource] = useState(() => savedSource(initialExampleId(), language));
  const [dark, setDark] = useState(() => savedItem('reactive-md:theme') === 'dark');
  const [simple, setSimple] = useState(() => EXAMPLES.find((item) => item.id === selectedExample)?.section !== 'debug');
  const [featureMenuOpen, setFeatureMenuOpen] = useState(false);
  const [instanceKey, setInstanceKey] = useState(0);
  const [retainPreviewState, setRetainPreviewState] = useState(true);
  const [previewSession, setPreviewSession] = useState(() => new PreviewStateSession());
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<Diagnostic[]>([]);
  const [activeLine, setActiveLine] = useState(1);

  const copy = COPY[language];
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const featureMenuRef = useRef<HTMLButtonElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const pendingSourceWrite = useRef<{
    exampleId: string;
    source: string;
    language: Language;
  } | null>(null);
  const sourceWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelection = useRef<EditorSelection | null>(null);
  const sourceVisible = view === 'playground' && !simple;
  useEditorHeight(frameRef, sourceVisible, [language, view, simple, selectedExample]);
  const {
    canUndo,
    canRedo,
    record: recordHistory,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
  } = useSourceHistory(source);

  const compilation = useLocalCompilation(source);

  const currentExample = localizedExample(
    EXAMPLES.find((item) => item.id === selectedExample) ?? DEFAULT_EXAMPLE,
    language,
  );
  const compiled = compilation.result;
  const exampleOptions = useMemo(() => localizedExamples(language), [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { browserStorage()?.setItem('reactive-md:theme', dark ? 'dark' : 'light'); } catch { /* optional storage */ }
  }, [dark]);

  useEffect(() => {
    document.documentElement.lang = copy.htmlLang;
    document.title = copy.documentTitle;
    try { browserStorage()?.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* optional storage */ }
  }, [copy, language]);

  // Large sources are written after typing settles rather than on every key.
  const flushSourceWrite = useCallback(() => {
    if (sourceWriteTimer.current !== null) {
      clearTimeout(sourceWriteTimer.current);
      sourceWriteTimer.current = null;
    }
    const pending = pendingSourceWrite.current;
    pendingSourceWrite.current = null;
    if (!pending) return;
    try {
      const storage = browserStorage();
      if (storage) writeDraft(storage, pending.language, pending.exampleId, pending.source);
    } catch { /* optional storage */ }
  }, []);

  useEffect(() => {
    pendingSourceWrite.current = { exampleId: selectedExample, source, language };
    if (sourceWriteTimer.current !== null) clearTimeout(sourceWriteTimer.current);
    sourceWriteTimer.current = setTimeout(() => {
      sourceWriteTimer.current = null;
      flushSourceWrite();
    }, SOURCE_WRITE_DELAY);
  }, [language, selectedExample, source, flushSourceWrite]);

  useEffect(() => {
    const flush = () => flushSourceWrite();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flushSourceWrite();
    };
  }, [flushSourceWrite]);

  const report = useCallback((diagnostics: Diagnostic[]) => {
    if (diagnostics.length === 0) return;
    setRuntimeDiagnostics((previous) => dedupeDiagnostics([...previous, ...diagnostics]).slice(-8));
  }, []);

  const replaceSource = useCallback((next: string) => {
    setSource(next);
    setRuntimeDiagnostics([]);
  }, []);

  const beginPreviewSession = useCallback(() => {
    setPreviewSession(new PreviewStateSession(retainPreviewState));
    setInstanceKey((key) => key + 1);
  }, [retainPreviewState]);

  useEffect(() => {
    const selection = pendingSelection.current;
    if (!selection) return;
    pendingSelection.current = null;
    const editor = editorRef.current;
    if (!editor) return;
    const length = editor.value.length;
    const start = Math.max(0, Math.min(selection.start, length));
    const end = Math.max(start, Math.min(selection.end, length));
    editor.focus();
    editor.setSelectionRange(start, end);
    setActiveLine(editor.value.slice(0, start).split('\n').length);
  }, [source]);

  const applyEdit = useCallback((edit: EditorEdit) => {
    recordHistory(edit.value, edit.selection, 'separate');
    pendingSelection.current = edit.selection;
    replaceSource(edit.value);
  }, [recordHistory, replaceSource]);

  const undoEdit = useCallback(() => {
    const entry = undoHistory();
    if (!entry) return;
    pendingSelection.current = entry.selection;
    replaceSource(entry.value);
  }, [replaceSource, undoHistory]);

  const redoEdit = useCallback(() => {
    const entry = redoHistory();
    if (!entry) return;
    pendingSelection.current = entry.selection;
    replaceSource(entry.value);
  }, [replaceSource, redoHistory]);

  const importSource = useCallback((next: string) => {
    resetHistory(next);
    replaceSource(next);
    beginPreviewSession();
  }, [resetHistory, replaceSource, beginPreviewSession]);

  const exportSource = useCallback(() => {
    download(`${selectedExample}.reactive.md`, source, 'text/markdown;charset=utf-8');
  }, [selectedExample, source]);

  const onSourceChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const element = event.currentTarget;
    recordHistory(
      element.value,
      { start: element.selectionStart, end: element.selectionEnd },
      'merge',
    );
    replaceSource(element.value);
  }, [recordHistory, replaceSource]);

  const focusDiagnostic = useCallback((range: SourceRange) => {
    setSimple(false);
    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const length = editor.value.length;
      const start = Math.max(0, Math.min(range.start, length));
      const end = Math.max(start, Math.min(range.end, length));
      editor.focus();
      editor.setSelectionRange(start, end);
      const line = editor.value.slice(0, start).split('\n').length;
      const gutter = gutterRef.current;
      const lineElement = gutter?.children[line - 1] as HTMLElement | undefined;
      if (gutter && lineElement) {
        const offset = lineElement.getBoundingClientRect().top
          - gutter.getBoundingClientRect().top
          + gutter.scrollTop;
        editor.scrollTop = Math.max(0, offset - editor.clientHeight / 3);
      } else {
        const styles = window.getComputedStyle(editor);
        const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
        editor.scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 3);
      }
      if (gutter) gutter.scrollTop = editor.scrollTop;
      setActiveLine(line);
    });
  }, []);

  const loadExample = useCallback((exampleId: string) => {
    const example = EXAMPLES.find((item) => item.id === exampleId);
    if (!example) return;
    setFeatureMenuOpen(false);
    if (example.section === 'debug') setSimple(false);
    flushSourceWrite();
    const next = savedSource(example.id, language);
    setSelectedExample(example.id);
    setSource(next);
    resetHistory(next);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
    try { browserStorage()?.setItem(SELECTION_KEY, example.id); } catch { /* optional storage */ }
    if (editorRef.current) editorRef.current.scrollTop = 0;
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
  }, [flushSourceWrite, beginPreviewSession, resetHistory, language]);

  const restoreExample = useCallback(() => {
    resetHistory(currentExample.source);
    setSource(currentExample.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [currentExample.source, beginPreviewSession, resetHistory]);

  const resetInstance = useCallback(() => {
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [beginPreviewSession]);

  // Keep the example selected, but save the current draft under the old
  // language and load that example's draft (or default source) in the new one.
  const switchLanguage = useCallback(() => {
    const nextLanguage: Language = language === 'en' ? 'zh' : 'en';
    pendingSourceWrite.current = { exampleId: selectedExample, source, language };
    flushSourceWrite();
    const next = savedSource(selectedExample, nextLanguage);
    setLanguage(nextLanguage);
    setSource(next);
    resetHistory(next);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
    pendingSelection.current = null;
    if (editorRef.current) editorRef.current.scrollTop = 0;
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
  }, [
    language,
    selectedExample,
    source,
    flushSourceWrite,
    resetHistory,
    beginPreviewSession,
  ]);

  const currentDiagnostics = useMemo(
    () => compiled ? dedupeDiagnostics([...compiled.diagnostics, ...runtimeDiagnostics]) : [],
    [compiled, runtimeDiagnostics],
  );

  const diagnosticLines = useMemo(
    () => new Set(currentDiagnostics.map((item) => item.line)),
    [currentDiagnostics],
  );

  const lines = useMemo(() => source.split('\n'), [source]);
  const gutterMetrics = useGutterMetrics(lines, mirrorRef, editorRef);

  const updateActiveLine = (element: HTMLTextAreaElement) => {
    const line = element.value.slice(0, element.selectionStart).split('\n').length;
    setActiveLine(line);
  };

  const onEditorScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && !event.altKey && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoEdit();
      else undoEdit();
      return;
    }
    if (modifier && !event.altKey && key === 'y') {
      event.preventDefault();
      redoEdit();
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${source.slice(0, start)}  ${source.slice(end)}`;
    const selection = { start: start + 2, end: start + 2 };
    recordHistory(next, selection, 'separate');
    pendingSelection.current = selection;
    replaceSource(next);
  };

  const ready = compiled?.ok === true;
  const compiling = compilation.pending;
  const previewFailed = compiled !== null && !compiled.ok;
  const previewDocument = compilation.previewDocument && previewSession.canPreview(compilation.previewDocument, source)
    ? compilation.previewDocument
    : null;
  const statusLabel = compiling
    ? (compilation.mode === 'fallback' ? copy.status.compilingMainThread : copy.status.compiling)
    : compiled
      ? (compiled.ok
        ? copy.status.compiled(
          currentDiagnostics.length,
          compilation.duration,
          compilation.mode === 'fallback',
        )
        : copy.status.compileFailed)
      : copy.status.waiting;

  return (
    <LanguageProvider language={language}>
      <div className={`app-shell${simple ? ' is-simple' : ''}`}>
        <header className="masthead">
          <div className="masthead-lead">
            <p className="eyebrow">{copy.masthead.eyebrow}</p>
            <h1>Reactive MD</h1>
            <p className="masthead-intro">
              {copy.showcase.intro}
            </p>
          </div>
          <nav className="view-switch" aria-label={copy.masthead.viewSwitcher}>
            <button
              type="button"
              aria-pressed={view === 'playground'}
              onClick={() => setView('playground')}
            >
              {copy.masthead.playground}
            </button>
            <button
              type="button"
              aria-pressed={view === 'guide'}
              onClick={() => setView('guide')}
            >
              {copy.masthead.guide}
            </button>
            <button
              type="button"
              className="language-toggle"
              data-testid="language-toggle"
              aria-label={copy.languageToggle.ariaLabel}
              title={copy.languageToggle.ariaLabel}
              lang={copy.languageToggle.labelLang}
              style={{ minWidth: 40 }}
              onClick={switchLanguage}
            >
              {copy.languageToggle.label}
            </button>
          </nav>
        </header>

        {view === 'guide' ? (
          <GuideView
            dark={dark}
            onTheme={() => setDark((value) => !value)}
            onBack={() => setView('playground')}
          />
        ) : (
        <main className="workbench">
          <nav className="showcase-nav" aria-label={copy.showcase.navigation}>
            <button
              type="button"
              className="showcase-menu-toggle"
              ref={featureMenuRef}
              aria-expanded={featureMenuOpen}
              aria-controls="showcase-links"
              onClick={() => setFeatureMenuOpen((value) => !value)}
            >
              <strong>{currentExample.title}</strong>
              <span>{copy.showcase.navigation} <span aria-hidden="true">⌄</span></span>
            </button>
            <div id="showcase-links" className={`showcase-links${featureMenuOpen ? ' is-open' : ''}`}>
            {exampleOptions.filter((example) => example.section === 'quickstart' || example.section === 'feature').map((example) => (
              <button
                type="button"
                key={example.id}
                data-example-id={example.id}
                aria-pressed={selectedExample === example.id}
                title={example.hint}
                onClick={() => {
                  if (selectedExample !== example.id) loadExample(example.id);
                  setFeatureMenuOpen(false);
                  if (featureMenuOpen) featureMenuRef.current?.focus();
                }}
              >
                {example.title}
              </button>
            ))}
            </div>
          </nav>
          <div className="workbench-bar">
            <div className="bar-group">
              <label className="bar-label" htmlFor="example-select">{copy.showcase.reference}</label>
              <select
                id="example-select"
                className="bar-select"
                value={currentExample.section === 'reference' || currentExample.section === 'debug' ? selectedExample : ''}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => loadExample(event.target.value)}
              >
                <option value="" disabled>{copy.showcase.more}</option>
                {exampleOptions.filter((example) => example.section === 'reference' || example.section === 'debug').map((example) => (
                  <option key={example.id} value={example.id}>{example.title}</option>
                ))}
              </select>
            </div>
            <div className="bar-group bar-actions">
              <label className="bar-label edit-only" title={copy.workbench.keepTrialStateTitle}>
                <input
                  type="checkbox"
                  checked={retainPreviewState}
                  aria-describedby="preview-state-note"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    previewSession.setRetention(event.target.checked);
                    setRetainPreviewState(event.target.checked);
                  }}
                />{' '}
                {copy.workbench.keepTrialState}
              </label>
              <button type="button" className="button button-secondary" onClick={restoreExample}>
                {copy.workbench.restoreExample}
              </button>
              <button type="button" className="button button-secondary" onClick={resetInstance}>
                {copy.workbench.runAgain}
              </button>
            </div>
            <span className="example-hint" title={currentExample.hint}>{currentExample.hint}</span>
            <span
              className={`status-chip ${compiling ? 'is-pending' : previewFailed ? 'is-error' : ''}`}
              role="status"
              title={compilation.failure ?? undefined}
            >
              {statusLabel}
            </span>
          </div>

          <AuthorTools
            dark={dark}
            simple={simple}
            onTheme={() => setDark((value) => !value)}
            onSimple={() => setSimple((value) => !value)}
            onImport={importSource}
            onExport={exportSource}
          />

          <div className="workspace">
            <section id="source-pane" className="pane pane-editor" aria-label={copy.editor.region}>
              <div className="pane-head">
                <div>
                  <h2>{copy.editor.heading}</h2>
                  <p className="pane-subtitle">{copy.editor.subtitle}</p>
                </div>
                <span className="syntax-tag">local-draft-2</span>
              </div>

              <div className="editor-frame" ref={frameRef}>
                <EditorToolbar
                  editorRef={editorRef}
                  onEdit={applyEdit}
                  onUndo={undoEdit}
                  onRedo={redoEdit}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onExport={exportSource}
                />

                <label className="sr-only" htmlFor="source-editor">{copy.editor.sourceLabel}</label>
                <div className="editor-shell">
                  <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
                    {lines.map((_, index) => {
                      const lineNumber = index + 1;
                      return (
                        <span
                          key={lineNumber}
                          className={`gutter-line ${activeLine === lineNumber ? 'is-active' : ''} ${
                            diagnosticLines.has(lineNumber) ? 'is-diagnostic' : ''
                          }`}
                          style={gutterMetrics.heights[index]
                            ? { height: `${gutterMetrics.heights[index]}px` }
                            : undefined}
                        >
                          {lineNumber}
                        </span>
                      );
                    })}
                  </div>
                  <textarea
                    id="source-editor"
                    ref={editorRef}
                    className="editor-input"
                    value={source}
                    wrap="soft"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-describedby="editor-note"
                    onScroll={onEditorScroll}
                    onChange={onSourceChange}
                    onKeyDown={onEditorKeyDown}
                    onSelect={(event) => updateActiveLine(event.currentTarget)}
                    onKeyUp={(event) => updateActiveLine(event.currentTarget)}
                    onClick={(event) => updateActiveLine(event.currentTarget)}
                  />
                  <div
                    className="editor-mirror"
                    ref={mirrorRef}
                    aria-hidden="true"
                    style={gutterMetrics.width ? { width: gutterMetrics.width } : undefined}
                  >
                    {lines.map((line, index) => (
                      // CRLF sources leave a trailing \r that the textarea treats as the break.
                      <div key={index}>{line.replace(/\r$/, '') || '\u200b'}</div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="editor-note" id="editor-note">
                {copy.editor.note}
              </p>
              <p className="editor-note" id="preview-state-note">
                {copy.editor.stateNote}
              </p>

              <section className="diagnostics-panel" aria-label={copy.editor.diagnosticsRegion}>
                <div className="diagnostics-head">
                  <h3>{copy.editor.diagnosticsHeading}</h3>
                  <span>
                    {compiling
                      ? copy.editor.diagnosticsCompiling
                      : currentDiagnostics.length
                        ? copy.editor.diagnosticsCount(currentDiagnostics.length)
                        : copy.editor.diagnosticsNone}
                  </span>
                </div>
                <DiagnosticList
                  diagnostics={currentDiagnostics}
                  focusDiagnostic={focusDiagnostic}
                  emptyText={compiling
                    ? copy.editor.diagnosticsEmptyCompiling
                    : copy.editor.diagnosticsEmpty}
                />
              </section>
            </section>

            <section className="pane pane-preview" aria-label={copy.preview.region}>
              <div className="pane-head">
                <div>
                  <h2>{copy.preview.heading}</h2>
                  <p className="pane-subtitle">{copy.preview.subtitle}</p>
                </div>
                <span className={`live-dot ${ready ? 'is-live' : ''}`} aria-hidden="true" />
              </div>

              <div className="preview-stage" aria-busy={compiling}>
                {previewFailed && compiled ? (
                  <div className="preview-error" role="alert">
                    <h3>{copy.preview.disabledTitle}</h3>
                    <p>{copy.preview.disabledBody}</p>
                    <DiagnosticList
                      diagnostics={compiled.diagnostics}
                      focusDiagnostic={focusDiagnostic}
                    />
                  </div>
                ) : previewDocument ? (
                  <LocalPreview
                    key={instanceKey}
                    document={previewDocument}
                    session={previewSession}
                    onDiagnostics={report}
                  />
                ) : (
                  <div className="preview-loading" role="status"><p>{copy.preview.preparing}</p></div>
                )}
                {compiling && previewDocument && !previewFailed ? (
                  <div className="preview-veil" role="status">
                    <strong>{copy.preview.veilTitle}</strong>
                    <span>{copy.preview.veilBody}</span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </main>
        )}

        <footer className="app-footer">
          {view === 'playground' && simple ? <p>{copy.showcase.footer}</p> : <p>
            {copy.footer.bindBefore}<code>bind</code>{copy.footer.bindBetween}
            <code>{copy.footer.expression}</code>{copy.footer.afterExpression}
          </p>}
          {view === 'guide' ? (
            <p>
              {copy.footer.guideBefore}<code>{copy.guide.documentFile}</code>{copy.footer.guideAfter}
            </p>
          ) : !simple ? (
            <p>{copy.footer.trial}</p>
          ) : null}
        </footer>
      </div>
    </LanguageProvider>
  );
}
