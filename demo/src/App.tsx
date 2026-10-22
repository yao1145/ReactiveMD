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
import { EXAMPLES, DEFAULT_EXAMPLE_ID } from './examples';
import { useLocalCompilation, type LocalCompiledDocument } from './use-local-compilation';
import { PreviewStateSession } from './preview-state';
import guideSource from '../../docs/local-guide.md?raw';

type LocalRuntimeInstance = LocalRuntime;

const DEFAULT_EXAMPLE = EXAMPLES.find((item) => item.id === DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0];
const SOURCE_PREFIX = 'reactive-md:local:source:';
const SOURCE_WRITE_DELAY = 400;
const GUIDE_REPOSITORY = 'https://github.com/yao1145/ReactiveMD/blob/main';

// The guide lives in docs/ and links to neighbouring files. Send those links
// to the repository so they still work when the guide is rendered in the demo.
const GUIDE_SOURCE = guideSource
  .replace(/\]\(\.\.\/examples\/local\/([^)]+)\)/g, `](${GUIDE_REPOSITORY}/examples/local/$1)`)
  .replace(/\]\((local-interaction-syntax|local-integration)\.md\)/g, `](${GUIDE_REPOSITORY}/docs/$1.md)`);

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
    message: `文档出现未预期错误：${error instanceof Error ? error.message : String(error)}`,
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
  if (!ok) return '编译失败';
  const base = count ? `已编译 · ${count} 条诊断` : `已编译 · ${duration} ms`;
  return fallback ? `${base} · 主线程` : base;
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
            title="在编辑器中定位"
          >
            <span className={`diag-severity diag-${diagnostic.severity === 'warning' ? 'warning' : 'error'}`}>
              {diagnostic.severity === 'warning' ? '警告' : '错误'}
            </span>
            <span className="diag-message">{diagnostic.message}</span>
            <span className="diag-position">第 {diagnostic.line} 行 · 第 {diagnostic.column} 列</span>
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
      <h3>无法启动文档</h3>
      <p>{initError}</p>
    </div>;
  }
  if (!instance || instance.document !== document) {
    return <div className="preview-loading" role="status"><p>正在准备交互文档…</p></div>;
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
          <p className="eyebrow">阅读文档</p>
          <h2>使用指南</h2>
          <p>面向会写 Markdown 的读者：从第一份交互文档开始，逐步加入条件、图表与函数曲线。</p>
        </div>
        <div className="guide-actions">
          <button type="button" className="button button-secondary" onClick={onTheme}>
            {dark ? '浅色主题' : '深色主题'}
          </button>
          <button type="button" className="button button-secondary" onClick={onBack}>
            返回 Playground
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

  const importSource = useCallback((next: string) => {
    replaceSource(next);
    beginPreviewSession();
  }, [replaceSource, beginPreviewSession]);

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
    setSelectedExample(example.id);
    setSource(savedSource(example.id));
    setRuntimeDiagnostics([]);
    beginPreviewSession();
    try { browserStorage()?.setItem('reactive-md:selection', example.id); } catch { /* optional storage */ }
    if (editorRef.current) editorRef.current.scrollTop = 0;
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
  }, [flushSourceWrite, beginPreviewSession]);

  const restoreExample = useCallback(() => {
    setSource(currentExample.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [currentExample.source, beginPreviewSession]);

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
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${source.slice(0, start)}  ${source.slice(end)}`;
    replaceSource(next);
    window.requestAnimationFrame(() => {
      element.setSelectionRange(start + 2, start + 2);
    });
  };

  const ready = compiled?.ok === true;
  const compiling = compilation.pending;
  const previewFailed = compiled !== null && !compiled.ok;
  const previewDocument = compilation.previewDocument && previewSession.canPreview(compilation.previewDocument, source)
    ? compilation.previewDocument
    : null;
  const statusLabel = compiling
    ? (compilation.mode === 'fallback' ? '编译中… · 主线程' : '编译中…')
    : compiled
      ? statusText(compiled.ok, currentDiagnostics.length, compilation.duration, compilation.mode === 'fallback')
      : '等待编译';

  return (
    <div className={`app-shell${simple ? ' is-simple' : ''}`}>
      <header className="masthead">
        <div className="masthead-lead">
          <p className="eyebrow">本地交互文档实验室</p>
          <h1>Reactive MD</h1>
          <p className="masthead-intro">
            在 Markdown 中放置输入控件，用 <code>bind</code> 命名参数，再用 <code>{'{{ 表达式 }}'}</code>{' '}
            读取它们。调整输入，正文、表格、图表和曲线立即更新。
          </p>
        </div>
        <nav className="view-switch" aria-label="页面切换">
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
            使用指南
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
            <label className="bar-label" htmlFor="example-select">示例</label>
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
            <label className="bar-label" title="编辑时保留兼容的命名参数；修改初值或约束后会重新校验。">
              <input
                type="checkbox"
                checked={retainPreviewState}
                aria-describedby="preview-state-note"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  previewSession.setRetention(event.target.checked);
                  setRetainPreviewState(event.target.checked);
                }}
              />{' '}
              保留试算状态
            </label>
            <button type="button" className="button button-secondary" onClick={restoreExample}>
              恢复示例
            </button>
            <button type="button" className="button button-secondary" onClick={resetInstance}>
              重新运行
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
          onExport={() => download(`${selectedExample}.reactive.md`, source, 'text/markdown;charset=utf-8')}
        />

        <div className="workspace">
          <section className="pane pane-editor" aria-label="源码编辑器">
            <div className="pane-head">
              <div>
                <h2>源码</h2>
                <p className="pane-subtitle">Markdown、本地标签与表达式</p>
              </div>
              <span className="syntax-tag">local-draft-1</span>
            </div>

            <label className="sr-only" htmlFor="source-editor">Reactive MD 源码</label>
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
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => replaceSource(event.target.value)}
                onKeyDown={onEditorKeyDown}
                onSelect={(event) => updateActiveLine(event.currentTarget)}
                onKeyUp={(event) => updateActiveLine(event.currentTarget)}
                onClick={(event) => updateActiveLine(event.currentTarget)}
              />
            </div>

            <p className="editor-note" id="editor-note">
              编辑会短暂合并后再按本地语法编译。
            </p>
            <p className="editor-note" id="preview-state-note">
              开启保留后，编辑正文、标签和公式会沿用兼容的命名参数；修改初值或不再满足约束时恢复初值。
              清单和计时器每次编译后重置。关闭保留后，下次编译使用初值；重新运行、切换或恢复示例、导入和刷新会清空试算。
            </p>

            <section className="diagnostics-panel" aria-label="编译与运行诊断">
              <div className="diagnostics-head">
                <h3>诊断</h3>
                <span>{compiling ? '编译中' : currentDiagnostics.length ? `${currentDiagnostics.length} 条` : '无'}</span>
              </div>
              <DiagnosticList
                diagnostics={currentDiagnostics}
                focusDiagnostic={focusDiagnostic}
                emptyText={compiling ? '正在编译最新源码…' : '当前源码没有编译或运行诊断。'}
              />
            </section>
          </section>

          <section className="pane pane-preview" aria-label="实时预览">
            <div className="pane-head">
              <div>
                <h2>预览</h2>
                <p className="pane-subtitle">可以直接操作的本地文档</p>
              </div>
              <span className={`live-dot ${ready ? 'is-live' : ''}`} aria-hidden="true" />
            </div>

            <div className="preview-stage" aria-busy={compiling}>
              {previewFailed && compiled ? (
                <div className="preview-error" role="alert">
                  <h3>预览已停用</h3>
                  <p>请修正左侧标记的错误，编译成功后预览会自动恢复。</p>
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
                <div className="preview-loading" role="status"><p>正在准备交互文档…</p></div>
              )}
              {compiling && previewDocument && !previewFailed ? (
                <div className="preview-veil" role="status">
                  <strong>正在编译最新源码</strong>
                  <span>预览暂时保留上一次成功的结果，完成后会自动替换。</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>
      )}

      <footer className="app-footer">
        <p>
          参数用 <code>bind</code> 命名，正文用 <code>{'{{ }}'}</code> 读取；图表使用 Markdown 表格，
          函数曲线使用 LaTeX，不需要配置块、事件或服务调用。
        </p>
        {view === 'guide' ? (
          <p>指南内容与仓库 <code>docs/local-guide.md</code> 保持一致。</p>
        ) : (
          <p>试算只保存在本次编辑会话；浏览器保存各示例的源码，刷新或重新运行会回到初值。</p>
        )}
      </footer>
    </div>
  );
}
