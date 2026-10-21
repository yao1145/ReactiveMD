import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { getComponentManifest, DocumentSession, readSavedDocument, formatDocument } from 'reactive-md';
import { AuthorTools } from './author-tools';
import { demoCapabilities } from './demo-capabilities';
import type {
  CompiledDocument,
  CompileResult,
  Diagnostic,
  Runtime,
  SourceRange,
} from 'reactive-md';
import { RuntimeDocumentView } from 'reactive-md/react';
import { EXAMPLES, DEFAULT_EXAMPLE_ID } from './examples';

type PreviewState =
  | { kind: 'compiling'; source: string }
  | { kind: 'error'; source: string; diagnostics: Diagnostic[]; duration: number }
  | {
      kind: 'ready';
      source: string;
      document: CompiledDocument;
      runtime: Runtime;
      diagnostics: Diagnostic[];
      duration: number;
      runtimeKey: number;
    };

const DEFAULT_EXAMPLE = EXAMPLES.find((item) => item.id === DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0];

function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
function initialExampleId() {
  const saved = savedItem('reactive-md:selection');
  return EXAMPLES.some(example => example.id === saved) ? saved! : DEFAULT_EXAMPLE.id;
}
function savedItem(key: string) {
  try { return browserStorage()?.getItem(key); } catch { return undefined; }
}
function savedSource(id: string) {
  const storage = browserStorage();
  return (storage && readSavedDocument(storage, `playground:${id}`)?.source)
    || EXAMPLES.find(example => example.id === id)?.source || DEFAULT_EXAMPLE.source;
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FALLBACK_SNAPSHOT: ReturnType<Runtime['snapshot']> = {
  revision: 0,
  state: {},
  computed: {},
  resources: {},
};

function unexpectedDiagnostic(error: unknown): Diagnostic {
  return {
    code: 'demo.unexpected',
    message: `运行时出现未预期错误：${error instanceof Error ? error.message : String(error)}`,
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

function statusText(preview: PreviewState, stale: boolean): string {
  if (stale || preview.kind === 'compiling') return '正在编译…';
  if (preview.kind === 'error') return '编译失败';
  return `已编译 · ${preview.duration} ms`;
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
            <span
              className={`diag-severity diag-${diagnostic.severity === 'warning' ? 'warning' : 'error'}`}
            >
              {diagnostic.severity === 'warning' ? '警告' : '错误'}
            </span>
            <span className="diag-message">{diagnostic.message}</span>
            <span className="diag-position">
              第 {diagnostic.line} 行 · 第 {diagnostic.column} 列
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RuntimeObserver({ runtime }: { runtime: Runtime }) {
  const subscribe = useCallback(
    (listener: () => void) => {
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = runtime.subscribe(['*'], listener);
      } catch {
        return () => {};
      }
      return () => {
        try {
          unsubscribe?.();
        } catch {
          // The old runtime may have been disposed before unmount.
        }
      };
    },
    [runtime],
  );
  const getSnapshot = useCallback(() => {
    try {
      return runtime.snapshot();
    } catch {
      return FALLBACK_SNAPSHOT;
    }
  }, [runtime]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <details className="observer">
      <summary>
        <span>运行时观察区</span>
        <span className="observer-revision">revision {snapshot.revision}</span>
      </summary>
      <div className="observer-grid">
        <section className="observer-block">
          <h3>state</h3>
          <pre>{JSON.stringify(snapshot.state, null, 2)}</pre>
        </section>
        <section className="observer-block">
          <h3>computed</h3>
          <pre>{JSON.stringify(snapshot.computed, null, 2)}</pre>
        </section>
      </div>
      <p className="observer-note">
        这里实时显示当前状态、计算值与版本号；交互只更新文档状态，不会重新编译源码。
      </p>
    </details>
  );
}

export default function App() {
  const [selectedExample, setSelectedExample] = useState(initialExampleId);
  const [source, setSource] = useState(() => savedSource(selectedExample));
  const [dark, setDark] = useState(() => savedItem('reactive-md:theme') === 'dark');
  const [simple, setSimple] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamProgress, setStreamProgress] = useState(0);
  const [runToken, setRunToken] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'compiling', source: DEFAULT_EXAMPLE.source });
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<Diagnostic[]>([]);
  const [activeLine, setActiveLine] = useState(1);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const runtimeKeyRef = useRef(0);
  const immediateRunRef = useRef(true);
  const restoreRef = useRef(true);
  const sessionRef = useRef<DocumentSession | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const manifestRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { browserStorage()?.setItem('reactive-md:theme', dark ? 'dark' : 'light'); } catch { /* optional storage */ }
  }, [dark]);

  // Normal author edits reset state; streaming commits preserve compatible state.
  useEffect(() => {
    streamAbortRef.current?.abort();
    setStreaming(false);
    let cancelled = false;
    const delay = immediateRunRef.current ? 0 : 320;
    immediateRunRef.current = false;

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const started = performance.now();
      let result: ReturnType<DocumentSession['update']>;
      try {
        const id = `playground:${selectedExample}`;
        if (sessionRef.current?.options.id !== id) {
          sessionRef.current?.dispose();
          sessionRef.current = new DocumentSession({ id, storage: browserStorage(), runtime: { capabilities: demoCapabilities } });
        }
        result = sessionRef.current.update(source, { preserveState: restoreRef.current });
        restoreRef.current = false;
      } catch (error) {
        result = { ok: false, pending: false, current: null, diagnostics: [unexpectedDiagnostic(error)] };
      }
      if (cancelled) return;
      const duration = Math.max(0, Math.round(performance.now() - started));

      if (!result.ok) {
        sessionRef.current?.dispose();
        sessionRef.current = null;
        runtimeRef.current = null;
        setPreview({ kind: 'error', source, diagnostics: result.diagnostics, duration });
        return;
      }

      const runtime = result.runtime;
      if (cancelled) {
        runtime.dispose();
        return;
      }

      runtimeRef.current = runtime;
      runtimeKeyRef.current += 1;
      setPreview({
        kind: 'ready',
        source,
        document: result.document,
        runtime,
        diagnostics: result.diagnostics,
        duration,
        runtimeKey: runtimeKeyRef.current,
      });
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, runToken, selectedExample]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      sessionRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    setRuntimeDiagnostics([]);
  }, [source, runToken]);

  const stale = preview.source !== source;

  useEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    const line = element.value.slice(0, element.selectionStart).split('\n').length;
    setActiveLine(line);
  }, [source]);

  const lines = useMemo(() => source.split('\n'), [source]);

  const report = useCallback((diagnostics: Diagnostic[]) => {
    if (diagnostics.length === 0) return;
    setRuntimeDiagnostics((previous) => {
      const next = dedupeDiagnostics([...previous, ...diagnostics]);
      return next.slice(-8);
    });
  }, []);

  const focusDiagnostic = useCallback((range: SourceRange) => {
    setSimple(false);
    // Wait for React to reveal the editor, then focus before setting its selection.
    // A controlled textarea can otherwise restore the old caret during that commit.
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

  const immediateRerun = useCallback(() => {
    restoreRef.current = false;
    immediateRunRef.current = true;
    setRunToken((token) => token + 1);
  }, []);

  const resetDocumentState = immediateRerun;

  const loadExample = useCallback((exampleId: string) => {
    const example = EXAMPLES.find((item) => item.id === exampleId);
    if (!example) return;
    immediateRunRef.current = true;
    restoreRef.current = true;
    setSelectedExample(example.id);
    setSource(savedSource(example.id));
    try { browserStorage()?.setItem('reactive-md:selection', example.id); } catch { /* optional */ }
    if (editorRef.current) editorRef.current.scrollTop = 0;
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
  }, []);

  const restoreExample = useCallback(() => {
    const example = EXAMPLES.find((item) => item.id === selectedExample);
    if (!example) return;
    setSource(example.source);
    immediateRerun();
  }, [immediateRerun, selectedExample]);

  const currentDiagnostics = useMemo(() => {
    if (stale) return [];
    const compileDiagnostics =
      preview.kind === 'ready' || preview.kind === 'error' ? preview.diagnostics : [];
    return dedupeDiagnostics([...compileDiagnostics, ...runtimeDiagnostics]);
  }, [preview, runtimeDiagnostics, stale]);

  const diagnosticLines = useMemo(
    () => new Set(currentDiagnostics.map((item) => item.line)),
    [currentDiagnostics],
  );

  const onEditorScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  };

  const updateActiveLine = (element: HTMLTextAreaElement) => {
    const line = element.value.slice(0, element.selectionStart).split('\n').length;
    setActiveLine(line);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${source.slice(0, start)}  ${source.slice(end)}`;
    setSource(next);
    window.requestAnimationFrame(() => {
      element.setSelectionRange(start + 2, start + 2);
    });
  };

  const readyAndCurrent = preview.kind === 'ready' && !stale;
  const status = statusText(preview, stale);

  return (
    <div className={`app-shell${simple ? ' is-simple' : ''}`}>
      <header className="masthead">
        <p className="eyebrow">交互文档实验室</p>
        <h1>Reactive MD</h1>
        <p className="masthead-intro">
          在 Markdown 里声明状态和组件，写下关系和公式。调整输入，正文中的数值、提示与内容立即更新。
        </p>
      </header>

      <main className="workbench">
        <div className="workbench-bar">
          <div className="bar-group">
            <label className="bar-label" htmlFor="example-select">
              示例
            </label>
            <select
              id="example-select"
              className="bar-select"
              value={selectedExample}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => loadExample(event.target.value)}
            >
              {EXAMPLES.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.title}
                </option>
              ))}
            </select>
          </div>
          <div className="bar-group bar-actions">
            <button type="button" className="button button-secondary" onClick={restoreExample}>
              恢复示例
            </button>
            <button type="button" className="button button-secondary" onClick={immediateRerun}>
              重新运行
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={resetDocumentState}
              disabled={preview.kind !== 'ready' || stale}
              title="用当前已编译文档的初始值新建运行时"
            >
              重置文档状态
            </button>
          </div>
          <span
            className={`status-chip ${stale || preview.kind === 'compiling' ? 'is-pending' : ''} ${
              preview.kind === 'error' && !stale ? 'is-error' : ''
            }`}
            role="status"
          >
            {status}
          </span>
        </div>

        <AuthorTools dark={dark} simple={simple} streaming={streaming} progress={streamProgress}
          onTheme={() => setDark(value => !value)} onSimple={() => setSimple(value => !value)}
          onStream={async () => {
            if (streaming) { streamAbortRef.current?.abort(); setStreaming(false); return; }
            const session = sessionRef.current;
            if (!session || preview.kind !== 'ready') return;
            const controller = new AbortController();
            streamAbortRef.current = controller;
            session.beginStream();
            setStreaming(true);
            setStreamProgress(0);
            for (let offset = 0; offset < source.length; offset += 70) {
              if (controller.signal.aborted) break;
              const final = offset + 70 >= source.length;
              const result = session.append(source.slice(offset, offset + 70), final);
              if (result.ok) {
                runtimeRef.current = result.runtime;
                setPreview({ kind: 'ready', source, document: result.document, runtime: result.runtime,
                  diagnostics: result.diagnostics, duration: 0, runtimeKey: runtimeKeyRef.current });
              } else if (final) report(result.diagnostics);
              setStreamProgress(Math.min(100, Math.round((offset + 70) / source.length * 100)));
              await new Promise(resolve => window.setTimeout(resolve, 70));
            }
            if (streamAbortRef.current === controller) setStreaming(false);
          }}
          onFormat={() => { try { setSource(formatDocument(source)); } catch (error) { report([unexpectedDiagnostic(error)]); } }}
          onImport={text => { restoreRef.current = false; setSource(text); }}
          onExport={() => download(`${selectedExample}.reactive.md`, source, 'text/markdown;charset=utf-8')}
          onManifest={() => { if (!manifestRef.current?.open) manifestRef.current?.showModal(); }} />
        {streaming ? <p className="stream-note" role="status">正在逐段接收文档：{streamProgress}%。已提交的输入状态会保留，未闭合的组件等待后续片段。</p> : null}
        <div className="workspace">
          <section className="pane pane-editor" aria-label="源码编辑器">
            <div className="pane-head">
              <div>
                <h2>源码</h2>
                <p className="pane-subtitle">Markdown 正文与 reactive-md 配置块</p>
              </div>
              <span className="syntax-tag">Reactive MD v0.2</span>
            </div>

            <label className="sr-only" htmlFor="source-editor">
              Reactive MD 源码
            </label>
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
                disabled={streaming}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setSource(event.target.value)}
                onKeyDown={onEditorKeyDown}
                onSelect={(event) => updateActiveLine(event.currentTarget)}
                onKeyUp={(event) => updateActiveLine(event.currentTarget)}
                onClick={(event) => updateActiveLine(event.currentTarget)}
              />
            </div>

            <p className="editor-note" id="editor-note">
              停止输入后自动编译。重新运行、重置状态或修改源码后再编译，都会从初始状态开始。
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
                <p className="pane-subtitle">可以真实操作的 Markdown 文档</p>
              </div>
              <span className={`live-dot ${readyAndCurrent ? 'is-live' : ''}`} aria-hidden="true" />
            </div>

            <div
              className={`preview-stage ${preview.kind === 'ready' && stale ? 'is-stale' : ''}`}
              aria-busy={stale || preview.kind === 'compiling'}
            >
              {readyAndCurrent && preview.kind === 'ready' ? (
                <RuntimeDocumentView
                  key={preview.runtimeKey}
                  runtime={preview.runtime}
                  document={preview.document}
                  report={report}
                  focusDiagnostic={focusDiagnostic}
                />
              ) : null}

              {preview.kind === 'ready' && stale ? (
                <>
                  <div
                    className="preview-inert"
                    ref={(element) => {
                      element?.setAttribute('inert', '');
                    }}
                  >
                    <RuntimeDocumentView
                      key={preview.runtimeKey}
                      runtime={preview.runtime}
                      document={preview.document}
                      report={report}
                      focusDiagnostic={focusDiagnostic}
                    />
                  </div>
                  <div className="preview-veil" role="status">
                    <strong>源码已修改，正在编译</strong>
                    <span>旧预览已停用；新文档编译完成后从初始状态开始。</span>
                  </div>
                </>
              ) : null}

              {preview.kind === 'error' && !stale ? (
                <div className="preview-error" role="alert">
                  <h3>预览已停用</h3>
                  <p>
                    请修正左侧标记的错误，编译成功后预览会自动恢复。
                  </p>
                  <DiagnosticList
                    diagnostics={preview.diagnostics}
                    focusDiagnostic={focusDiagnostic}
                  />
                </div>
              ) : null}

              {preview.kind === 'compiling' || (stale && preview.kind !== 'ready') ? (
                <div className="preview-loading" role="status">
                  <span className="loading-bar" aria-hidden="true" />
                  <p>正在编译文档…</p>
                </div>
              ) : null}
            </div>

            {readyAndCurrent && preview.kind === 'ready' ? (
              <RuntimeObserver runtime={preview.runtime} />
            ) : null}
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <p>
          表达式以 <code>=</code> 开头，支持 <code>+ - * / %</code>、比较、<code>! &amp;&amp; ||</code>、
          条件表达式，以及 <code>min</code>、<code>max</code>、<code>round</code>、<code>len</code>、
          <code>contains</code>。
        </p>
        <p>文档状态按示例分别保存在当前浏览器，可在刷新后继续。</p>
      </footer>
      <dialog ref={manifestRef} className="manifest-dialog" aria-labelledby="manifest-title">
        <h2 id="manifest-title">组件清单</h2>
        <p>这份 schema 可用于编辑器补全、文档生成和模型输出约束。</p>
        <pre>{JSON.stringify(getComponentManifest(), null, 2)}</pre>
        <button type="button" onClick={() => download('reactive-md-components.json', JSON.stringify(getComponentManifest(), null, 2), 'application/json')}>导出清单</button>{' '}
        <button type="button" onClick={() => manifestRef.current?.close()}>关闭</button>
      </dialog>
    </div>
  );
}
