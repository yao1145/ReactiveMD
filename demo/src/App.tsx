import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import type { Diagnostic, SourceRange } from 'reactive-md';
import { LocalDocumentView } from 'reactive-md/react';
import { AuthorTools } from './author-tools';
import { EXAMPLES, DEFAULT_EXAMPLE_ID } from './examples';

type CompiledLocal = Extract<ReturnType<typeof compileLocal>, { ok: true }>;
type LocalRuntimeInstance = ReturnType<typeof createLocalRuntime>;

const DEFAULT_EXAMPLE = EXAMPLES.find((item) => item.id === DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0];
const SOURCE_PREFIX = 'reactive-md:local:source:';

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

function statusText(ok: boolean, count: number, duration: number): string {
  if (!ok) return '编译失败';
  return count ? `已编译 · ${count} 条诊断` : `已编译 · ${duration} ms`;
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
  document: CompiledLocal['document'];
  onDiagnostics: (diagnostics: Diagnostic[]) => void;
}

function LocalPreview({ document, onDiagnostics }: LocalPreviewProps) {
  const [instance, setInstance] = useState<{
    document: CompiledLocal['document'];
    runtime: LocalRuntimeInstance;
  } | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const reportRef = useRef(onDiagnostics);
  reportRef.current = onDiagnostics;

  useEffect(() => {
    let runtime: LocalRuntimeInstance;
    try {
      runtime = createLocalRuntime(document);
    } catch (error) {
      setInitError(error instanceof Error ? error.message : String(error));
      reportRef.current([unexpectedDiagnostic(error)]);
      return;
    }
    setInstance({ document, runtime });
    setInitError(null);
    return () => runtime.dispose();
  }, [document]);

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
}

export default function App() {
  const [selectedExample, setSelectedExample] = useState(initialExampleId);
  const [source, setSource] = useState(() => savedSource(initialExampleId()));
  const [dark, setDark] = useState(() => savedItem('reactive-md:theme') === 'dark');
  const [simple, setSimple] = useState(false);
  const [instanceKey, setInstanceKey] = useState(0);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<Diagnostic[]>([]);
  const [activeLine, setActiveLine] = useState(1);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const compilation = useMemo(() => {
    const started = performance.now();
    let result: ReturnType<typeof compileLocal>;
    try {
      result = compileLocal(source);
    } catch (error) {
      result = { ok: false, diagnostics: [unexpectedDiagnostic(error)] };
    }
    return { result, duration: Math.max(0, Math.round(performance.now() - started)) };
  }, [source]);

  const currentExample = EXAMPLES.find((item) => item.id === selectedExample) ?? DEFAULT_EXAMPLE;
  const compiled = compilation.result;

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { browserStorage()?.setItem('reactive-md:theme', dark ? 'dark' : 'light'); } catch { /* optional storage */ }
  }, [dark]);

  useEffect(() => {
    try {
      const storage = browserStorage();
      storage?.setItem(`${SOURCE_PREFIX}${selectedExample}`, source);
      storage?.setItem('reactive-md:selection', selectedExample);
    } catch { /* optional storage */ }
  }, [selectedExample, source]);

  const report = useCallback((diagnostics: Diagnostic[]) => {
    if (diagnostics.length === 0) return;
    setRuntimeDiagnostics((previous) => dedupeDiagnostics([...previous, ...diagnostics]).slice(-8));
  }, []);

  const replaceSource = useCallback((next: string) => {
    setSource(next);
    setRuntimeDiagnostics([]);
  }, []);

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
    setSelectedExample(example.id);
    setSource(savedSource(example.id));
    setRuntimeDiagnostics([]);
    setInstanceKey((key) => key + 1);
    if (editorRef.current) editorRef.current.scrollTop = 0;
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
  }, []);

  const restoreExample = useCallback(() => {
    setSource(currentExample.source);
    setRuntimeDiagnostics([]);
    setInstanceKey((key) => key + 1);
  }, [currentExample.source]);

  const resetInstance = useCallback(() => {
    setRuntimeDiagnostics([]);
    setInstanceKey((key) => key + 1);
  }, []);

  const currentDiagnostics = useMemo(
    () => dedupeDiagnostics([...compiled.diagnostics, ...runtimeDiagnostics]),
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

  const ready = compiled.ok;

  return (
    <div className={`app-shell${simple ? ' is-simple' : ''}`}>
      <header className="masthead">
        <p className="eyebrow">本地交互文档实验室</p>
        <h1>Reactive MD</h1>
        <p className="masthead-intro">
          在 Markdown 中放置输入控件，用 <code>bind</code> 命名参数，再用 <code>{'{{ 表达式 }}'}</code>{' '}
          读取它们。调整输入，正文、表格、图表和曲线立即更新。
        </p>
      </header>

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
            <button type="button" className="button button-secondary" onClick={restoreExample}>
              恢复示例
            </button>
            <button type="button" className="button button-secondary" onClick={resetInstance}>
              重新运行
            </button>
          </div>
          <span className="example-hint" title={currentExample.hint}>{currentExample.hint}</span>
          <span
            className={`status-chip ${ready ? '' : 'is-error'}`}
            role="status"
          >
            {statusText(ready, currentDiagnostics.length, compilation.duration)}
          </span>
        </div>

        <AuthorTools
          dark={dark}
          simple={simple}
          onTheme={() => setDark((value) => !value)}
          onSimple={() => setSimple((value) => !value)}
          onImport={replaceSource}
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
              编辑后立即按本地语法重新编译；预览中的交互状态只保存在当前实例。
            </p>

            <section className="diagnostics-panel" aria-label="编译与运行诊断">
              <div className="diagnostics-head">
                <h3>诊断</h3>
                <span>{currentDiagnostics.length ? `${currentDiagnostics.length} 条` : '无'}</span>
              </div>
              <DiagnosticList
                diagnostics={currentDiagnostics}
                focusDiagnostic={focusDiagnostic}
                emptyText="当前源码没有编译或运行诊断。"
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

            <div className="preview-stage">
              {compiled.ok ? (
                <LocalPreview
                  key={instanceKey}
                  document={compiled.document}
                  onDiagnostics={report}
                />
              ) : (
                <div className="preview-error" role="alert">
                  <h3>预览已停用</h3>
                  <p>请修正左侧标记的错误，编译成功后预览会自动恢复。</p>
                  <DiagnosticList
                    diagnostics={compiled.diagnostics}
                    focusDiagnostic={focusDiagnostic}
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <p>
          参数用 <code>bind</code> 命名，正文用 <code>{'{{ }}'}</code> 读取；图表使用 Markdown 表格，
          函数曲线使用 LaTeX，不需要配置块、事件或服务调用。
        </p>
        <p>浏览器只保存各示例正在编辑的源码；交互状态不持久化，刷新或重新运行会回到初值。</p>
      </footer>
    </div>
  );
}
