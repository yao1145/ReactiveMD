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
import { EXAMPLES, DEFAULT_EXAMPLE_ID } from './examples';
import { useLocalCompilation, type LocalCompiledDocument } from './use-local-compilation';
import { PreviewStateSession } from './preview-state';
import { useSourceHistory } from './use-source-history';
import guideSource from '../../docs/local-guide-en.md?raw';

type LocalRuntimeInstance = LocalRuntime;

const DEFAULT_EXAMPLE = EXAMPLES.find((item) => item.id === DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0];
const SOURCE_PREFIX = 'reactive-md:local:source:';
const SOURCE_WRITE_DELAY = 400;
const GUIDE_REPOSITORY = 'https://github.com/yao1145/ReactiveMD/blob/main';

// The guide lives in docs/ and links to neighbouring files. Send those links
// to the repository so they still work when the guide is rendered in the demo.
const GUIDE_SOURCE = guideSource
  .replace(/\]\(\.\.\/examples\/local\/([^)]+)\)/g, `](${GUIDE_REPOSITORY}/examples/local/$1)`)
  .replace(/\]\(([a-z0-9-]+-en\.md(?:#[^)]+)?)\)/g, `](${GUIDE_REPOSITORY}/docs/$1)`);

function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function savedItem(key: string) {
  try { return browserStorage()?.getItem(key); } catch { return undefined; }
}

function initialExampleId() {
  const saved = savedItem('reactive-md:selection');
  return EXAMPLES.some((example) => example.id === saved) ? saved! : DEFAULT_EXAMPLE.id;
}

function savedSource(id: string) {
  const saved = savedItem(`${SOURCE_PREFIX}${id}`);
  return saved ?? EXAMPLES.find((example) => example.id === id)?.source ?? DEFAULT_EXAMPLE.source;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function unexpectedDiagnostic(error: unknown): Diagnostic {
  return {
    code: 'demo.unexpected',
    message: `Unexpected document error: ${error instanceof Error ? error.message : String(error)}`,
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

function statusText(ok: boolean, count: number, duration: number, fallback: boolean): string {
  if (!ok) return 'Compile failed';
  const base = count
    ? `Compiled · ${count} diagnostic${count === 1 ? '' : 's'}`
    : `Compiled · ${duration} ms`;
  return fallback ? `${base} · main thread` : base;
}

interface DiagnosticListProps {
  diagnostics: Diagnostic[];
  focusDiagnostic: (range: SourceRange) => void;
  emptyText?: string;
}

function DiagnosticList({ diagnostics, focusDiagnostic, emptyText }: DiagnosticListProps) {
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
            title="Locate in editor"
          >
            <span className={`diag-severity diag-${diagnostic.severity === 'warning' ? 'warning' : 'error'}`}>
              {diagnostic.severity === 'warning' ? 'Warning' : 'Error'}
            </span>
            <span className="diag-message">{diagnostic.message}</span>
            <span className="diag-position">Line {diagnostic.line} · Column {diagnostic.column}</span>
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
      reportRef.current([unexpectedDiagnostic(error)]);
      return;
    }
    setInstance({ document, runtime });
    setInitError(null);
    return release;
  }, [document, session]);

  if (initError) {
    return <div className="preview-error" role="alert">
      <h3>Could not start document</h3>
      <p>{initError}</p>
    </div>;
  }
  if (!instance || instance.document !== document) {
    return <div className="preview-loading" role="status"><p>Preparing interactive document…</p></div>;
  }
  return <LocalDocumentView document={document} runtime={instance.runtime} onDiagnostics={onDiagnostics} />;
});

interface GuideViewProps {
  dark: boolean;
  onTheme(): void;
  onBack(): void;
}

function GuideView({ dark, onTheme, onBack }: GuideViewProps) {
  return (
    <main className="guide-view">
      <div className="guide-toolbar">
        <div>
          <p className="eyebrow">Documentation</p>
          <h2>User Guide</h2>
          <p>For readers who already write Markdown: start with your first interactive document, then add conditions, charts and function curves step by step.</p>
        </div>
        <div className="guide-actions">
          <button type="button" className="button button-secondary" onClick={onTheme}>
            {dark ? 'Light theme' : 'Dark theme'}
          </button>
          <button type="button" className="button button-secondary" onClick={onBack}>
            Back to Playground
          </button>
        </div>
      </div>
      <div className="guide-paper">
        <LocalReactiveDocument source={GUIDE_SOURCE} />
      </div>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<'playground' | 'guide'>('playground');
  const [selectedExample, setSelectedExample] = useState(initialExampleId);
  const [source, setSource] = useState(() => savedSource(initialExampleId()));
  const [dark, setDark] = useState(() => savedItem('reactive-md:theme') === 'dark');
  const [simple, setSimple] = useState(false);
  const [instanceKey, setInstanceKey] = useState(0);
  const [retainPreviewState, setRetainPreviewState] = useState(true);
  const [previewSession, setPreviewSession] = useState(() => new PreviewStateSession());
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<Diagnostic[]>([]);
  const [activeLine, setActiveLine] = useState(1);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const pendingSourceWrite = useRef<{ exampleId: string; source: string } | null>(null);
  const sourceWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelection = useRef<EditorSelection | null>(null);
  const {
    canUndo,
    canRedo,
    record: recordHistory,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
  } = useSourceHistory(source);

  const compilation = useLocalCompilation(source);

  const currentExample = EXAMPLES.find((item) => item.id === selectedExample) ?? DEFAULT_EXAMPLE;
  const compiled = compilation.result;

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { browserStorage()?.setItem('reactive-md:theme', dark ? 'dark' : 'light'); } catch { /* optional storage */ }
  }, [dark]);

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
      storage?.setItem(`${SOURCE_PREFIX}${pending.exampleId}`, pending.source);
      storage?.setItem('reactive-md:selection', pending.exampleId);
    } catch { /* optional storage */ }
  }, []);

  useEffect(() => {
    pendingSourceWrite.current = { exampleId: selectedExample, source };
    if (sourceWriteTimer.current !== null) clearTimeout(sourceWriteTimer.current);
    sourceWriteTimer.current = setTimeout(() => {
      sourceWriteTimer.current = null;
      flushSourceWrite();
    }, SOURCE_WRITE_DELAY);
  }, [selectedExample, source, flushSourceWrite]);

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
      const styles = window.getComputedStyle(editor);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
      editor.scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 3);
      if (gutterRef.current) gutterRef.current.scrollTop = editor.scrollTop;
      setActiveLine(line);
    });
  }, []);

  const loadExample = useCallback((exampleId: string) => {
    const example = EXAMPLES.find((item) => item.id === exampleId);
    if (!example) return;
    flushSourceWrite();
    const next = savedSource(example.id);
    setSelectedExample(example.id);
    setSource(next);
    resetHistory(next);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
    try { browserStorage()?.setItem('reactive-md:selection', example.id); } catch { /* optional storage */ }
    if (editorRef.current) editorRef.current.scrollTop = 0;
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
  }, [flushSourceWrite, beginPreviewSession, resetHistory]);

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

  const currentDiagnostics = useMemo(
    () => compiled ? dedupeDiagnostics([...compiled.diagnostics, ...runtimeDiagnostics]) : [],
    [compiled, runtimeDiagnostics],
  );

  const diagnosticLines = useMemo(
    () => new Set(currentDiagnostics.map((item) => item.line)),
    [currentDiagnostics],
  );

  const lines = useMemo(() => source.split('\n'), [source]);

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
    ? (compilation.mode === 'fallback' ? 'Compiling… · main thread' : 'Compiling…')
    : compiled
      ? statusText(compiled.ok, currentDiagnostics.length, compilation.duration, compilation.mode === 'fallback')
      : 'Waiting to compile';

  return (
    <div className={`app-shell${simple ? ' is-simple' : ''}`}>
      <header className="masthead">
        <div className="masthead-lead">
          <p className="eyebrow">Local interactive document lab</p>
          <h1>Reactive MD</h1>
          <p className="masthead-intro">
            Place input controls in Markdown, name parameters with <code>bind</code>, then read them
            with <code>{'{{ expressions }}'}</code>. Adjust an input and prose, tables, charts and
            curves update instantly.
          </p>
        </div>
        <nav className="view-switch" aria-label="View switcher">
          <button
            type="button"
            aria-pressed={view === 'playground'}
            onClick={() => setView('playground')}
          >
            Playground
          </button>
          <button
            type="button"
            aria-pressed={view === 'guide'}
            onClick={() => setView('guide')}
          >
            User Guide
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
        <div className="workbench-bar">
          <div className="bar-group">
            <label className="bar-label" htmlFor="example-select">Example</label>
            <select
              id="example-select"
              className="bar-select"
              value={selectedExample}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => loadExample(event.target.value)}
            >
              {EXAMPLES.map((example) => (
                <option key={example.id} value={example.id}>{example.title}</option>
              ))}
            </select>
          </div>
          <div className="bar-group bar-actions">
            <label className="bar-label" title="Keep compatible named parameters while editing; values are revalidated when initial values or constraints change.">
              <input
                type="checkbox"
                checked={retainPreviewState}
                aria-describedby="preview-state-note"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  previewSession.setRetention(event.target.checked);
                  setRetainPreviewState(event.target.checked);
                }}
              />{' '}
              Keep trial state
            </label>
            <button type="button" className="button button-secondary" onClick={restoreExample}>
              Restore example
            </button>
            <button type="button" className="button button-secondary" onClick={resetInstance}>
              Run again
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
          <section className="pane pane-editor" aria-label="Source editor">
            <div className="pane-head">
              <div>
                <h2>Source</h2>
                <p className="pane-subtitle">Markdown, local tags and expressions</p>
              </div>
              <span className="syntax-tag">local-draft-1</span>
            </div>

            <div className="editor-frame">
              <EditorToolbar
                editorRef={editorRef}
                onEdit={applyEdit}
                onUndo={undoEdit}
                onRedo={redoEdit}
                canUndo={canUndo}
                canRedo={canRedo}
                onExport={exportSource}
              />

              <label className="sr-only" htmlFor="source-editor">Reactive MD source</label>
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
                  wrap="off"
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
              </div>
            </div>

            <p className="editor-note" id="editor-note">
              Edits are briefly coalesced, then compiled with the local syntax.
            </p>
            <p className="editor-note" id="preview-state-note">
              With retention on, editing prose, tags and formulas keeps compatible named parameters;
              values reset to initial when initial values change or constraints no longer hold.
              Checklists and timers reset after every compile. With retention off, the next compile
              starts from initial values; running again, switching or restoring examples, importing,
              and refreshing clear the trial state.
            </p>

            <section className="diagnostics-panel" aria-label="Compile and runtime diagnostics">
              <div className="diagnostics-head">
                <h3>Diagnostics</h3>
                <span>{compiling ? 'Compiling' : currentDiagnostics.length ? `${currentDiagnostics.length}` : 'None'}</span>
              </div>
              <DiagnosticList
                diagnostics={currentDiagnostics}
                focusDiagnostic={focusDiagnostic}
                emptyText={compiling ? 'Compiling the latest source…' : 'The current source has no compile or runtime diagnostics.'}
              />
            </section>
          </section>

          <section className="pane pane-preview" aria-label="Live preview">
            <div className="pane-head">
              <div>
                <h2>Preview</h2>
                <p className="pane-subtitle">A local document you can interact with directly</p>
              </div>
              <span className={`live-dot ${ready ? 'is-live' : ''}`} aria-hidden="true" />
            </div>

            <div className="preview-stage" aria-busy={compiling}>
              {previewFailed && compiled ? (
                <div className="preview-error" role="alert">
                  <h3>Preview disabled</h3>
                  <p>Fix the errors marked on the left; the preview returns automatically once compilation succeeds.</p>
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
                <div className="preview-loading" role="status"><p>Preparing interactive document…</p></div>
              )}
              {compiling && previewDocument && !previewFailed ? (
                <div className="preview-veil" role="status">
                  <strong>Compiling the latest source</strong>
                  <span>The preview keeps the last successful result until the new one is ready.</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>
      )}

      <footer className="app-footer">
        <p>
          Name parameters with <code>bind</code> and read them in prose with <code>{'{{ }}'}</code>;
          charts use Markdown tables and function curves use LaTeX — no config blocks, events or
          service calls required.
        </p>
        {view === 'guide' ? (
          <p>The guide content matches <code>docs/local-guide-en.md</code> in the repository.</p>
        ) : (
          <p>Trial values live only in this editing session; the browser saves each example's source, and refreshing or running again returns to initial values.</p>
        )}
      </footer>
    </div>
  );
}
