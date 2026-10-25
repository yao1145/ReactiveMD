import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent as ReactCompositionEvent,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from 'react';
import type {
  EditorSelection,
  ReactiveMarkdownEditorHandle,
  ReactiveMarkdownEditorProps,
} from './types';
import { EDITOR_CHROME_COPY } from './editor-i18n';
import { EditorLocaleProvider } from './locale';
import { EditorToolbar } from './editor-toolbar';
import {
  AuthorHighlight,
  AuthoringPanel,
  useAuthorAnalysis,
} from './source-authoring';
import { useGutterMetrics } from './use-gutter-metrics';
import { useSourceHistory } from './use-source-history';

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

function cssSize(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value;
}

interface NormalizedSelection {
  start: number;
  end: number;
}

function normalizeSelection(value: string, selection: EditorSelection): NormalizedSelection {
  const start = clampIndex(selection.start, value.length);
  const end = clampIndex(selection.end, value.length);
  return start <= end ? { start, end } : { start: end, end: start };
}

function assignTextareaRef(
  target: RefObject<HTMLTextAreaElement | null> | undefined,
  node: HTMLTextAreaElement | null,
): void {
  if (target) target.current = node;
}

/**
 * Controlled Markdown source editor with the demo's toolbar and authoring
 * tools. The textarea is the only editing surface; every transformation is
 * reported through `onChange`, and undo history stays inside this instance.
 */
export const ReactiveMarkdownEditor = forwardRef<
  ReactiveMarkdownEditorHandle,
  ReactiveMarkdownEditorProps
>(function ReactiveMarkdownEditor(
  {
    value,
    onChange,
    locale = 'en',
    theme = 'auto',
    id,
    className,
    style,
    height = 560,
    minHeight = 280,
    placeholder,
    ariaLabel,
    readOnly = false,
    disabled = false,
    documentKey,
    diagnostics,
    document: compiledDocument = null,
    toolbar = true,
    authoring = true,
    onExport,
    textareaRef,
  },
  ref,
) {
  const generatedId = useId();
  const editorId = id ?? `reactive-md-editor-${generatedId.replace(/:/g, '')}`;
  const copy = EDITOR_CHROME_COPY[locale];

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<EditorSelection>({ start: 0, end: 0 });
  const pendingSelection = useRef<EditorSelection | null>(null);
  const lastEmitted = useRef(value);
  const previousDocumentKey = useRef(documentKey);
  const composingRef = useRef(false);
  const currentValueRef = useRef(value);
  currentValueRef.current = value;
  const locked = readOnly || disabled;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const [composing, setComposing] = useState(false);
  const [activeLine, setActiveLine] = useState(1);

  const {
    canUndo,
    canRedo,
    record: recordHistory,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
  } = useSourceHistory(value);

  const resetEditorPosition = useCallback(() => {
    selectionRef.current = { start: 0, end: 0 };
    const editor = editorRef.current;
    if (editor) {
      editor.setSelectionRange(0, 0);
      editor.scrollTop = 0;
      editor.scrollLeft = 0;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
    setActiveLine(1);
  }, []);

  // A host replacement of `value` starts a fresh history. Values that echo an
  // edit this instance reported keep the existing history intact.
  useLayoutEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    pendingSelection.current = null;
    resetHistory(value);
    resetEditorPosition();
  }, [value, resetHistory, resetEditorPosition]);

  // Switching documents resets history even when the text happens to match.
  useLayoutEffect(() => {
    if (previousDocumentKey.current === documentKey) return;
    previousDocumentKey.current = documentKey;
    lastEmitted.current = value;
    pendingSelection.current = null;
    resetHistory(value);
    resetEditorPosition();
  }, [documentKey, value, resetHistory, resetEditorPosition]);

  const analysis = useAuthorAnalysis(value, authoring);

  const lines = useMemo(() => value.split('\n'), [value]);
  const gutterMetrics = useGutterMetrics(lines, mirrorRef, editorRef);

  const diagnosticLines = useMemo(() => {
    const result = new Set<number>();
    for (const item of diagnostics ?? []) {
      if (Number.isInteger(item.line) && item.line > 0) result.add(item.line);
    }
    return result;
  }, [diagnostics]);

  const readPosition = useCallback((element: HTMLTextAreaElement) => {
    const length = element.value.length;
    const start = clampIndex(element.selectionStart, length);
    const end = clampIndex(element.selectionEnd, length);
    selectionRef.current = { start, end };
    setActiveLine(element.value.slice(0, start).split('\n').length);
  }, []);

  const emit = useCallback((next: string, selection?: EditorSelection) => {
    const changed = next !== currentValueRef.current;
    currentValueRef.current = next;
    lastEmitted.current = next;
    if (selection && changed) pendingSelection.current = selection;
    onChange(next);
  }, [onChange]);

  const applyEdit = useCallback((edit: { value: string; selection: EditorSelection }) => {
    if (lockedRef.current) return;
    recordHistory(edit.value, edit.selection, 'separate');
    emit(edit.value, edit.selection);
  }, [emit, recordHistory]);

  const undo = useCallback(() => {
    if (lockedRef.current) return;
    const entry = undoHistory();
    if (!entry) return;
    emit(entry.value, entry.selection);
  }, [emit, undoHistory]);

  const redo = useCallback(() => {
    if (lockedRef.current) return;
    const entry = redoHistory();
    if (!entry) return;
    emit(entry.value, entry.selection);
  }, [emit, redoHistory]);

  // Restore the caret the edit asked for once the controlled value arrives.
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection) return;
    // A pending caret belongs to an edit this instance reported. If the host
    // replaced the value instead, drop it and leave the host caret alone.
    if (value !== lastEmitted.current) {
      pendingSelection.current = null;
      return;
    }
    pendingSelection.current = null;
    const editor = editorRef.current;
    if (!editor) return;
    const range = normalizeSelection(editor.value, selection);
    // Updating a controlled textarea temporarily moves its caret to the end.
    // Restore the intended range before focusing, without scrolling the editor
    // or its ancestors to that temporary caret.
    editor.setSelectionRange(range.start, range.end);
    editor.focus({ preventScroll: true });
    selectionRef.current = range;
    setActiveLine(editor.value.slice(0, range.start).split('\n').length);
  }, [value]);

  const focusEditor = useCallback((selection?: EditorSelection) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    if (selection) {
      const range = normalizeSelection(editor.value, selection);
      editor.setSelectionRange(range.start, range.end);
      selectionRef.current = range;
      setActiveLine(editor.value.slice(0, range.start).split('\n').length);
    }
  }, []);

  const locateRange = useCallback((range: EditorSelection) => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalized = normalizeSelection(editor.value, range);
    focusEditor(normalized);
    const line = editor.value.slice(0, normalized.start).split('\n').length;
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
  }, [focusEditor]);

  useImperativeHandle(
    ref,
    () => ({
      focus(selection?: EditorSelection) {
        focusEditor(selection);
      },
      selectRange(range: EditorSelection) {
        focusEditor(range);
      },
      getSelection() {
        const editor = editorRef.current;
        if (!editor) return selectionRef.current;
        const length = editor.value.length;
        return {
          start: clampIndex(editor.selectionStart, length),
          end: clampIndex(editor.selectionEnd, length),
        };
      },
      getTextarea() {
        return editorRef.current;
      },
      undo,
      redo,
    }),
    [focusEditor, undo, redo],
  );

  const setTextareaNode = useCallback((node: HTMLTextAreaElement | null) => {
    editorRef.current = node;
    assignTextareaRef(textareaRef, node);
  }, [textareaRef]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (lockedRef.current) return;
    const element = event.currentTarget;
    const selection = {
      start: clampIndex(element.selectionStart, element.value.length),
      end: clampIndex(element.selectionEnd, element.value.length),
    };
    recordHistory(element.value, selection, 'merge');
    emit(element.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing) return;
    if (lockedRef.current) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && !event.altKey && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && !event.altKey && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = clampIndex(element.selectionStart, element.value.length);
    const end = clampIndex(element.selectionEnd, element.value.length);
    const next = `${element.value.slice(0, start)}  ${element.value.slice(end)}`;
    const selection = { start: start + 2, end: start + 2 };
    recordHistory(next, selection, 'separate');
    emit(next, selection);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
    setComposing(true);
  };

  const handleCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    setComposing(false);
    readPosition(event.currentTarget);
  };

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const showToolbar = toolbar;
  const rootClassName = `reactive-md-editor${className ? ` ${className}` : ''}`;

  return (
    <EditorLocaleProvider locale={locale}>
      <div
        className={rootClassName}
        data-editor-theme={theme}
        lang={locale === 'zh' ? 'zh-CN' : 'en'}
        style={style}
        role="group"
        aria-label={copy.region}
        aria-disabled={locked || undefined}
        inert={disabled || undefined}
      >
        <div
          className="editor-frame"
          style={{ height: cssSize(height), minHeight: cssSize(minHeight) }}
        >
          {showToolbar ? (
            <EditorToolbar
              editorRef={editorRef}
              onEdit={applyEdit}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onExport={onExport}
              showExport={typeof onExport === 'function'}
              disabled={locked}
            />
          ) : null}

          <label className="reactive-md-editor-sr-only" htmlFor={editorId}>{copy.sourceLabel}</label>
          <div className={`editor-shell${composing ? ' is-composing' : ''}`}>
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
            <div className="editor-input-wrap">
              <AuthorHighlight
                source={value}
                tokens={analysis.tokens}
                width={gutterMetrics.width}
                editorRef={editorRef}
              />
              <textarea
                id={editorId}
                ref={setTextareaNode}
                className="editor-input"
                value={value}
                wrap="soft"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={placeholder}
                aria-label={ariaLabel}
                readOnly={readOnly}
                disabled={disabled}
                onScroll={handleScroll}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onSelect={(event) => readPosition(event.currentTarget)}
                onKeyUp={(event) => readPosition(event.currentTarget)}
                onClick={(event) => readPosition(event.currentTarget)}
              />
            </div>
            <div
              className="editor-mirror"
              ref={mirrorRef}
              aria-hidden="true"
              style={gutterMetrics.width ? { width: gutterMetrics.width } : undefined}
            >
              {lines.map((line, index) => (
                // CRLF sources leave a trailing \r that the textarea treats as the break.
                <div key={index}>{line.replace(/\r$/, '') || '​'}</div>
              ))}
            </div>
          </div>
        </div>

        {authoring ? (
          <AuthoringPanel
            source={value}
            analysis={analysis}
            bindingDocument={compiledDocument}
            editorRef={editorRef}
            onEdit={applyEdit}
            onLocate={locateRange}
            disabled={locked}
          />
        ) : null}
      </div>
    </EditorLocaleProvider>
  );
});
