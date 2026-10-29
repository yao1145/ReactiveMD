import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';
import { formatLocalDiagnostic, LOCAL_SYNTAX_VERSION, type Diagnostic, type LocalRuntime, type SourceRange } from 'reactive-md';
import { LocalDocumentView } from 'reactive-md/react';
import type { LocalSourceTarget } from 'reactive-md/react';
import {
  ReactiveMarkdownEditor,
  type ReactiveMarkdownEditorHandle,
  type EditorViewMode,
} from 'reactive-md/editor';
import { AuthorTools } from './author-tools';
import {
  DocumentLibrary,
  LIBRARY_MODE_STORAGE_KEY,
  documentFileStem,
  uniqueDocumentName,
  type LibraryDocument,
  type LibraryMode,
} from './document-library';
import { DocumentLibraryBar, LibraryModeSwitch, LIBRARY_COPY } from './document-library-bar';
import { ExportDialog } from './export-dialog';
import { ImageAssetsPanel } from './image-assets-panel';
import { createImageAsset, documentImageUrls, imagePolicy, ImageAssetError, MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL_BYTES, validateImageManifest, type ImageAsset } from './image-assets';
import { IMAGE_COPY } from './image-copy';
import { useDocumentImages } from './use-document-images';
import { HtmlCompatibilityControls } from './html-compatibility';
import {
  freshHtmlOptions,
  toCompileOptions,
  type DemoHtmlOptions,
} from './html-options';
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
import { GuideDocument } from './guide-examples';
import guideEnSource from '../../docs/guides/local-guide-en.md?raw';
import guideZhSource from '../../docs/guides/local-guide-ch.md?raw';

type LocalRuntimeInstance = LocalRuntime;

const DEFAULT_EXAMPLE = EXAMPLES.find((item) => item.id === DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0];
const SOURCE_PREFIX = 'reactive-md:local:source:';
const SELECTION_KEY = 'reactive-md:selection';
const SOURCE_WRITE_DELAY = 400;
const GUIDE_REPOSITORY = 'https://github.com/yao1145/ReactiveMD/blob/main';

// Resolve guide links from their repository directory when rendered in the demo.
function rewriteGuideLinks(source: string): string {
  return source.replace(/\]\(([^\s)]+)\)/g, (match, target: string) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#')) return match;
    return `](${new URL(target, `${GUIDE_REPOSITORY}/docs/guides/`).href})`;
  });
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

// Remember which destination was open so a reload returns to the same work.
function writeLibraryMode(mode: LibraryMode) {
  try { browserStorage()?.setItem(LIBRARY_MODE_STORAGE_KEY, mode); } catch { /* optional storage */ }
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
  const language = useLanguage();
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
            <span className="diag-message">{formatLocalDiagnostic(diagnostic, language)}</span>
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
  images: readonly ImageAsset[];
  onSourceNavigate(target: LocalSourceTarget): void;
}

const LocalPreview = memo(function LocalPreview({ document, session, onDiagnostics, images, onSourceNavigate }: LocalPreviewProps) {
  const language = useLanguage();
  const copy = useCopy();
  const imageProps = useMemo(() => imagePolicy(Object.fromEntries(images.map(a => [a.url, a.dataUrl]))), [images]);
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
      {...imageProps}
      document={document}
      runtime={instance.runtime}
      onDiagnostics={onDiagnostics}
      locale={language}
      onSourceNavigate={onSourceNavigate}
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
        <GuideDocument source={GUIDE_SOURCES[language]} language={language} />
      </div>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<'playground' | 'guide'>('playground');
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [library] = useState(() => new DocumentLibrary({ storage: browserStorage }));
  const libraryState = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const [initial] = useState(() => {
    const snapshot = library.getSnapshot();
    const requestedExample = new URLSearchParams(window.location.search).get('example');
    const reopenDocuments = !requestedExample
      && savedItem(LIBRARY_MODE_STORAGE_KEY) === 'documents'
      && snapshot.documents.length > 0;
    const exampleId = initialExampleId();
    const document = snapshot.documents.find((item) => item.id === snapshot.selectedId)
      ?? snapshot.documents[0];
    return {
      mode: (reopenDocuments ? 'documents' : 'example') as LibraryMode,
      exampleId,
      source: reopenDocuments && document ? document.source : savedSource(exampleId, language),
    };
  });
  const [libraryMode, setLibraryMode] = useState<LibraryMode>(initial.mode);
  const [selectedExample, setSelectedExample] = useState(initial.exampleId);
  const [source, setSource] = useState(initial.source);
  const [dark, setDark] = useState(() => savedItem('reactive-md:theme') === 'dark');
  const [editorView, setEditorView] = useState<EditorViewMode>(() =>
    initial.mode === 'documents' || EXAMPLES.find((item) => item.id === selectedExample)?.section === 'debug' ? 'split' : 'preview');
  const simple = editorView === 'preview';
  const [instanceKey, setInstanceKey] = useState(0);
  const [retainPreviewState, setRetainPreviewState] = useState(true);
  const [previewSession, setPreviewSession] = useState(() => new PreviewStateSession());
  const [exportOpen, setExportOpen] = useState(false);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const [libraryActionsTarget, setLibraryActionsTarget] = useState<HTMLDivElement | null>(null);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<Diagnostic[]>([]);
  // Capabilities are session-only: they start disabled on every load and are
  // reset whenever the document switches, never inferred from source or state.
  const [htmlOptions, setHtmlOptions] = useState<DemoHtmlOptions>(freshHtmlOptions);

  const copy = COPY[language];
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      const menu = optionsRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, []);
  const libraryCopy = LIBRARY_COPY[language];
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorHandle = useRef<ReactiveMarkdownEditorHandle>(null);
  /** Source range clicked in the preview while the editor pane was hidden. */
  const pendingSourceRange = useRef<SourceRange | null>(null);
  const revealSource = useCallback((target: LocalSourceTarget) => {
    if (editorView === 'preview') {
      pendingSourceRange.current = target.range;
      setEditorView('split');
      return;
    }
    editorHandle.current?.selectRange(target.range);
  }, [editorView]);
  useEffect(() => {
    if (editorView === 'preview') return;
    const range = pendingSourceRange.current;
    if (!range) return;
    pendingSourceRange.current = null;
    editorHandle.current?.selectRange(range);
  }, [editorView]);
  const imageKey = `${language}:${selectedExample}`;
  const documentImages = useDocumentImages(imageKey);
  const imageContext = useRef({ key: imageKey, assets: documentImages.assets, ready: documentImages.ready });
  imageContext.current = { key: imageKey, assets: documentImages.assets, ready: documentImages.ready };
  const imageBusyRef = useRef(false);
  const imageTask = useRef(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  useEffect(() => { setImageError(null); }, [imageKey]);

  const addImages = useCallback(async (files: File[], target?: string) => {
    if (imageBusyRef.current || !imageContext.current.ready) return;
    const context = imageContext.current;
    const task = ++imageTask.current;
    const messages = IMAGE_COPY[language];
    imageBusyRef.current = true;
    setImageBusy(true);
    setImageError(null);
    try {
      if (files.length > 64) throw new ImageAssetError('count');
      const selected = target ? files.slice(0, 1) : files;
      let total = context.assets.filter(a => a.url !== target).reduce((sum, a) => sum + a.size, 0);
      for (const file of selected) {
        if (file.size > MAX_IMAGE_BYTES) throw new ImageAssetError('size');
        total += file.size;
        if (total > MAX_IMAGE_TOTAL_BYTES) throw new ImageAssetError('total');
      }
      const added: ImageAsset[] = [];
      for (const file of selected) {
        // Validate before decoding, hashing or retaining any file data.
        const asset = await createImageAsset(file, target ?? 'pending');
        let decoded: ImageBitmap;
        try { decoded = await createImageBitmap(file); }
        catch { throw new Error('decode'); }
        decoded.close();
        if (!target) {
          const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
          const suffix = [...hash.subarray(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('');
          const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60).replace(/[^a-zA-Z0-9_-]/g, '-') || 'image';
          asset.url = `assets/${name}-${suffix}.${asset.mime === 'image/jpeg' ? 'jpg' : asset.mime.slice(6)}`;
        }
        added.push(asset);
      }
      if (imageContext.current.key !== context.key || imageTask.current !== task) return;
      const merged = new Map(imageContext.current.assets.map(a => [a.url, a]));
      for (const asset of added) merged.set(asset.url, asset);
      const assets = validateImageManifest([...merged.values()]);
      documentImages.replace(assets);
      if (!target) {
        const markdown = added.map(a => `![${a.name.replace(/[\[\]\\\r\n]/g, '')}](${a.url})`).join('\n\n');
        setEditorView(view => view === 'preview' ? 'split' : view);
        window.requestAnimationFrame(() => {
          if (imageContext.current.key === context.key && imageTask.current === task) editorHandle.current?.insertText(`\n\n${markdown}\n\n`);
        });
      }
    } catch (error) {
      if (imageContext.current.key !== context.key || imageTask.current !== task) return;
      const code = error instanceof ImageAssetError ? error.code : error instanceof Error && error.message === 'decode' ? 'decode' : 'read';
      setImageError(messages.errors[code]);
    } finally {
      imageBusyRef.current = false;
      setImageBusy(false);
    }
  }, [documentImages.replace, language]);

  const removeImage = useCallback((url: string) => {
    if (imageBusyRef.current) return;
    documentImages.replace(imageContext.current.assets.filter(a => a.url !== url));
    setImageError(null);
  }, [documentImages.replace]);

  const pendingSourceWrite = useRef<{
    exampleId: string;
    source: string;
    language: Language;
  } | null>(null);
  const sourceWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compileOptions = useMemo(() => toCompileOptions(htmlOptions), [htmlOptions]);
  const compilation = useLocalCompilation(source, compileOptions);
  const currentExample = localizedExample(
    EXAMPLES.find((item) => item.id === selectedExample) ?? DEFAULT_EXAMPLE,
    language,
  );
  const compiled = compilation.result;
  const exampleOptions = useMemo(() => localizedExamples(language), [language]);
  const currentDocument = useMemo(() => {
    const id = libraryState.selectedId;
    if (!id) return null;
    return libraryState.documents.find((item) => item.id === id) ?? null;
  }, [libraryState.documents, libraryState.selectedId]);
  const activeDocument = libraryMode === 'documents' ? currentDocument : null;
  const documentKey = activeDocument ? `document:${activeDocument.id}` : `example:${selectedExample}`;
  const exportBaseName = activeDocument ? documentFileStem(activeDocument.name) : selectedExample;

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
    if (libraryMode !== 'example') return;
    pendingSourceWrite.current = { exampleId: selectedExample, source, language };
    if (sourceWriteTimer.current !== null) clearTimeout(sourceWriteTimer.current);
    sourceWriteTimer.current = setTimeout(() => {
      sourceWriteTimer.current = null;
      flushSourceWrite();
    }, SOURCE_WRITE_DELAY);
  }, [libraryMode, language, selectedExample, source, flushSourceWrite]);

  useEffect(() => {
    // Leaving the page must keep both the example draft and the personal
    // library up to date, whichever destination is open.
    const flush = () => {
      flushSourceWrite();
      library.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flushSourceWrite, library]);

  const report = useCallback((diagnostics: Diagnostic[]) => {
    if (diagnostics.length === 0) return;
    setRuntimeDiagnostics((previous) => dedupeDiagnostics([...previous, ...diagnostics]).slice(-8));
  }, []);

  const replaceSource = useCallback((next: string) => {
    setSource(next);
    setRuntimeDiagnostics([]);
    if (libraryMode === 'documents') {
      const id = library.getSnapshot().selectedId;
      if (id) library.updateSource(id, next);
    }
  }, [library, libraryMode]);

  const beginPreviewSession = useCallback(() => {
    setPreviewSession(new PreviewStateSession(retainPreviewState));
    setInstanceKey((key) => key + 1);
  }, [retainPreviewState]);

  const resetHtmlOptions = useCallback(() => setHtmlOptions(freshHtmlOptions()), []);

  // A capability change is a whole-document route change. Clear trial state so
  // values captured under the previous renderer can never be reused, and let
  // the compilation hook drop the old preview before the new one is ready.
  const changeHtmlOptions = useCallback((next: DemoHtmlOptions) => {
    setHtmlOptions(next);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [beginPreviewSession]);

  // Imports always become a new personal document. The current example or
  // document is left untouched.
  const importSource = useCallback((next: string) => {
    imageTask.current += 1;
    flushSourceWrite();
    const documents = library.getSnapshot().documents;
    const name = uniqueDocumentName(documents.map((item) => item.name), libraryCopy.importedName);
    const document = library.createDocument({ name, source: next });
    if (!document) return;
    setEditorView('split');
    setLibraryMode('documents');
    writeLibraryMode('documents');
    resetHtmlOptions();
    setSource(document.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [
    flushSourceWrite,
    library,
    libraryCopy.importedName,
    resetHtmlOptions,
    beginPreviewSession,
  ]);

  const exportSource = useCallback(() => {
    download(`${exportBaseName}.reactive.md`, source, 'text/markdown;charset=utf-8');
  }, [exportBaseName, source]);

  const openExportDialog = useCallback(() => setExportOpen(true), []);
  const closeExportDialog = useCallback(() => setExportOpen(false), []);

  const focusDiagnostic = useCallback((range: SourceRange) => {
    setEditorView((current) => current === 'preview' ? 'split' : current);
    window.requestAnimationFrame(() => {
      const editor = editorHandle.current?.getTextarea() ?? editorRef.current;
      if (!editor) return;
      const handle = editorHandle.current;
      if (handle) handle.focus({ start: range.start, end: range.end });
      else {
        const length = editor.value.length;
        editor.focus();
        editor.setSelectionRange(
          Math.max(0, Math.min(range.start, length)),
          Math.max(0, Math.min(range.end, length)),
        );
      }
      const length = editor.value.length;
      const start = Math.max(0, Math.min(editor.selectionStart, length));
      const line = editor.value.slice(0, start).split('\n').length;
      const gutter = editor.closest('.editor-frame')?.querySelector<HTMLElement>('.editor-gutter');
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
    });
  }, []);

  const loadExample = useCallback((exampleId: string) => {
    const example = EXAMPLES.find((item) => item.id === exampleId);
    if (!example) return;
    imageTask.current += 1;
    if (example.section === 'debug') setEditorView('split');
    flushSourceWrite();
    const next = savedSource(example.id, language);
    resetHtmlOptions();
    setSelectedExample(example.id);
    setSource(next);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
    try { browserStorage()?.setItem(SELECTION_KEY, example.id); } catch { /* optional storage */ }
    writeLibraryMode('example');
  }, [flushSourceWrite, resetHtmlOptions, beginPreviewSession, language]);

  const restoreExample = useCallback(() => {
    imageTask.current += 1;
    resetHtmlOptions();
    setSource(currentExample.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [resetHtmlOptions, currentExample.source, beginPreviewSession]);

  const resetInstance = useCallback(() => {
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [beginPreviewSession]);

  const showExamples = useCallback(() => {
    if (libraryMode === 'example') return;
    library.flush();
    const next = savedSource(selectedExample, language);
    setLibraryMode('example');
    writeLibraryMode('example');
    resetHtmlOptions();
    setSource(next);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
    try { browserStorage()?.setItem(SELECTION_KEY, selectedExample); } catch { /* optional storage */ }
  }, [
    libraryMode,
    library,
    selectedExample,
    language,
    resetHtmlOptions,
    beginPreviewSession,
  ]);

  const showDocuments = useCallback(() => {
    if (libraryMode === 'documents') return;
    flushSourceWrite();
    const snapshot = library.getSnapshot();
    let document: LibraryDocument | null = snapshot.documents.find((item) => item.id === snapshot.selectedId)
      ?? snapshot.documents[0]
      ?? null;
    if (!document) {
      document = library.createDocument({ name: libraryCopy.defaultName, source: '' });
    }
    if (!document) return;
    const selected = library.select(document.id) ?? document;
    setEditorView('split');
    setLibraryMode('documents');
    writeLibraryMode('documents');
    resetHtmlOptions();
    setSource(selected.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [
    libraryMode,
    flushSourceWrite,
    library,
    libraryCopy.defaultName,
    resetHtmlOptions,
    beginPreviewSession,
  ]);

  const openDocument = useCallback((id: string) => {
    const document = library.select(id);
    if (!document) return;
    resetHtmlOptions();
    setSource(document.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [library, resetHtmlOptions, beginPreviewSession]);

  const createDocument = useCallback((name: string) => {
    const document = library.createDocument({ name, source: '' });
    if (!document) return;
    setEditorView('split');
    setLibraryMode('documents');
    writeLibraryMode('documents');
    resetHtmlOptions();
    setSource(document.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [library, resetHtmlOptions, beginPreviewSession]);

  const renameDocument = useCallback((id: string, name: string) => {
    library.rename(id, name);
  }, [library]);

  const duplicateDocument = useCallback((id: string, name: string) => {
    const document = library.duplicate(id, name);
    if (!document) return;
    resetHtmlOptions();
    setSource(document.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [library, resetHtmlOptions, beginPreviewSession]);

  // Copy the example exactly as it currently appears in the editor, including
  // any unpublished edits in the draft.
  const copyExampleToDocuments = useCallback(() => {
    flushSourceWrite();
    const documents = library.getSnapshot().documents;
    const name = uniqueDocumentName(
      documents.map((item) => item.name),
      `${currentExample.title}${libraryCopy.copySuffix}`,
    );
    const document = library.createDocument({ name, source });
    if (!document) return;
    setEditorView('split');
    setLibraryMode('documents');
    writeLibraryMode('documents');
    resetHtmlOptions();
    setSource(document.source);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [
    flushSourceWrite,
    library,
    currentExample.title,
    libraryCopy.copySuffix,
    source,
    resetHtmlOptions,
    beginPreviewSession,
  ]);

  const changeLibraryMode = useCallback((next: LibraryMode) => {
    if (next === 'documents') showDocuments();
    else showExamples();
  }, [showDocuments, showExamples]);

  // Keep the example selected, but save the current draft under the old
  // language and load that example's draft (or default source) in the new one.
  // Personal documents keep one source for both UI languages.
  const switchLanguage = useCallback(() => {
    imageTask.current += 1;
    const nextLanguage: Language = language === 'en' ? 'zh' : 'en';
    if (libraryMode === 'documents') {
      setLanguage(nextLanguage);
      return;
    }
    pendingSourceWrite.current = { exampleId: selectedExample, source, language };
    flushSourceWrite();
    const next = savedSource(selectedExample, nextLanguage);
    resetHtmlOptions();
    setLanguage(nextLanguage);
    setSource(next);
    setRuntimeDiagnostics([]);
    beginPreviewSession();
  }, [
    language,
    libraryMode,
    selectedExample,
    source,
    flushSourceWrite,
    resetHtmlOptions,
    beginPreviewSession,
  ]);

  const currentDiagnostics = useMemo(
    () => compiled ? dedupeDiagnostics([...compiled.diagnostics, ...runtimeDiagnostics]) : [],
    [compiled, runtimeDiagnostics],
  );

  const compiling = compilation.pending;
  const previewFailed = compiled !== null && !compiled.ok;
  const previewDocument = compilation.previewDocument && previewSession.canPreview(compilation.previewDocument, source)
    ? compilation.previewDocument
    : null;
  const exportDocument = compiled && compiled.ok ? compiled.document : null;
  const exportCurrentState = exportDocument ? previewSession.currentState(exportDocument) : null;
  const exportCompileError = compiled && !compiled.ok
    ? (compiled.diagnostics[0]?.message ?? null)
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
      <div className={`app-shell${simple ? ' is-simple' : editorView === 'edit' ? ' is-edit' : ''}`}>
        <header className="masthead">
          <div className="masthead-lead">
            <h1>Reactive MD</h1>
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
          <div className="workbench-bar library-workbench">
            <LibraryModeSwitch mode={libraryMode} onChange={changeLibraryMode} />
            {libraryMode === 'example' ? (
              <>
                <label className="bar-label" htmlFor="example-select">{copy.showcase.navigation}</label>
                <select
                  id="example-select"
                  className="bar-select example-select"
                  value={selectedExample}
                  title={currentExample.hint}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    if (event.target.value !== selectedExample) loadExample(event.target.value);
                  }}
                >
                  {exampleOptions.map((example) => (
                    <option key={example.id} value={example.id}>{example.title}</option>
                  ))}
                </select>
              </>
            ) : (
              <DocumentLibraryBar
                actionsTarget={libraryActionsTarget}
                documents={libraryState.documents}
                selectedId={libraryState.selectedId}
                saveStatus={libraryState.saveStatus}
                problem={libraryState.problem}
                onSelect={openDocument}
                onCreate={createDocument}
                onRename={renameDocument}
                onDuplicate={duplicateDocument}
                onRetry={() => library.retry()}
              />
            )}
            <div className="workbench-quick-actions">
              <ImageAssetsPanel compact assets={documentImages.assets} references={[]}
                busy={imageBusy || !documentImages.ready} error={imageError} storageError={documentImages.storageError}
                onFiles={addImages} onRemove={removeImage} />
              <button type="button" className="button button-quiet" aria-pressed={dark} onClick={() => setDark(value => !value)}>
                {dark ? copy.authorTools.lightTheme : copy.authorTools.darkTheme}
              </button>
            </div>
            <details ref={optionsRef} className="workbench-options" key={documentKey}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector('summary')?.focus();
                }
              }}>
              <summary>{libraryCopy.moreOptions}</summary>
              <div className="workbench-options-body" onClick={event => {
                if (event.target instanceof Element && event.target.closest('button')) {
                  if (optionsRef.current) optionsRef.current.open = false;
                  optionsRef.current?.querySelector('summary')?.focus();
                }
              }}>
                <div className="options-group">
                  <h3 className="options-heading">{copy.authorTools.ariaLabel}</h3>
                  <AuthorTools simple={simple}
                    onSimple={() => setEditorView(current => current === 'preview' ? 'split' : 'preview')}
                    onImport={importSource} onExport={openExportDialog} />
                </div>
                <div className="options-group">
                  <h3 className="options-heading">
                    {libraryMode === 'documents' ? libraryCopy.documents : copy.workbench.example}
                  </h3>
                  <div className="options-actions-row">
                    <div className="library-more-actions" ref={setLibraryActionsTarget} />
                    <div className="options-actions">
                      {libraryMode === 'example' ? (
                        <button type="button" className="button button-secondary" onClick={copyExampleToDocuments}>
                          {libraryCopy.copyExample}
                        </button>
                      ) : null}
                      {libraryMode === 'example' ? (
                        <button type="button" className="button button-secondary" onClick={restoreExample}>
                          {copy.workbench.restoreExample}
                        </button>
                      ) : null}
                      <button type="button" className="button button-secondary" onClick={resetInstance}>
                        {copy.workbench.runAgain}
                      </button>
                    </div>
                  </div>
                  <label className="options-check edit-only" title={copy.workbench.keepTrialStateTitle}>
                    <input
                      type="checkbox"
                      checked={retainPreviewState}
                      aria-describedby="preview-state-note"
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        previewSession.setRetention(event.target.checked);
                        setRetainPreviewState(event.target.checked);
                      }}
                    />
                    <span>{copy.workbench.keepTrialState}</span>
                  </label>
                </div>
                <HtmlCompatibilityControls options={htmlOptions} onChange={changeHtmlOptions} />
                {(documentImages.assets.length > 0 || (compiled?.ok && documentImageUrls(compiled.document).length > 0)) &&
                  <ImageAssetsPanel assets={documentImages.assets}
                    references={compiled?.ok ? documentImageUrls(compiled.document) : []}
                    busy={imageBusy || !documentImages.ready} error={null} storageError={false}
                    onFiles={addImages} onRemove={removeImage} allowInsert={false} />}
              </div>
            </details>
            <span
              className={`status-chip ${compiling ? 'is-pending' : previewFailed ? 'is-error' : ''}`}
              role="status"
              title={compilation.failure ?? undefined}
            >
              {statusLabel}
            </span>
          </div>

          <div className="workspace has-editor">
            <section id="source-pane" className="pane pane-editor" aria-label={copy.editor.region}
              onPasteCapture={event => {
                if (!(event.target instanceof HTMLTextAreaElement)) return;
                const files = Array.from(event.clipboardData.files);
                if (!files.length) return;
                event.preventDefault();
                void addImages(files);
              }}>
              <div className="pane-head">
                <div>
                  <h2>{copy.editor.heading}</h2>
                  <p className="pane-subtitle">{copy.editor.subtitle}</p>
                </div>
                <span className="syntax-tag">{LOCAL_SYNTAX_VERSION}</span>
              </div>

              <ReactiveMarkdownEditor
                compileOptions={compileOptions}
                ref={editorHandle}
                id="source-editor"
                textareaRef={editorRef}
                value={source}
                onChange={replaceSource}
                locale={language}
                theme={dark ? 'dark' : 'light'}
                height="max(720px, 90dvh)"
                ariaLabel={copy.editor.sourceLabel}
                documentKey={documentKey}
                diagnostics={currentDiagnostics}
                document={compiled && compiled.ok ? compiled.document : null}
                onExport={openExportDialog}
                viewMode={editorView}
                onViewModeChange={setEditorView}
                preview={<section className="pane-preview" aria-label={copy.preview.region}>
                  <div className="preview-stage" aria-busy={compiling}>
                    {previewFailed && compiled ? (
                      <div className="preview-error" role="alert">
                        <h3>{copy.preview.disabledTitle}</h3>
                        <p>{copy.preview.disabledBody}</p>
                        <DiagnosticList diagnostics={compiled.diagnostics} focusDiagnostic={focusDiagnostic} />
                      </div>
                    ) : previewDocument ? (
                      <LocalPreview key={instanceKey} document={previewDocument} session={previewSession} onDiagnostics={report} images={documentImages.assets} onSourceNavigate={revealSource} />
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
                </section>}
                authoring
                toolbar
              />

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

        <ExportDialog
          imageAssets={documentImages.assets}
          imageBusy={imageBusy || !documentImages.ready}
          imageError={imageError}
          imageStorageError={documentImages.storageError}
          onImageFiles={addImages}
          onRemoveImage={removeImage}
          open={exportOpen}
          source={source}
          baseName={exportBaseName}
          document={exportDocument}
          currentState={exportCurrentState}
          pending={compiling}
          compileError={exportCompileError}
          compileOptions={compileOptions}
          dark={dark}
          onClose={closeExportDialog}
          onDownloadMarkdown={exportSource}
        />
      </div>
    </LanguageProvider>
  );
}
