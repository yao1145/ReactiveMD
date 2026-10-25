/**
 * Authoring aids layered on the plain source textarea.
 *
 * The textarea stays the single editable surface: the highlight layer is a
 * pointer-transparent copy of the source with token colours, and every action
 * hands an `EditorEdit` back to the editor so history, selection restoration
 * and controlled updates keep working unchanged.
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  analyzeLocalSource,
  completeLocalSource,
  formatLocalSource,
  renameLocalBinding,
} from 'reactive-md';
import type { Diagnostic, LocalDocument, SourceRange } from 'reactive-md';
import type { EditorEdit, EditorLocale, EditorSelection } from './types';
import { useEditorLocale } from './locale';

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

export interface AuthorToken {
  kind: string;
  range: SourceRange;
}

export interface AuthorBinding {
  name: string;
  declarations: SourceRange[];
  references: SourceRange[];
}

export interface AuthorCompletion {
  label: string;
  insertText: string;
  range: SourceRange;
  kind: 'tag' | 'attribute' | 'binding' | 'value';
  detail?: string;
}

export interface AuthorAnalysis {
  tokens: AuthorToken[];
  bindings: AuthorBinding[];
  diagnostics: Diagnostic[];
}

const EMPTY_ANALYSIS: AuthorAnalysis = { tokens: [], bindings: [], diagnostics: [] };

const TOKEN_CLASSES: Record<string, string> = {
  tag: 'tag',
  attribute: 'attribute',
  string: 'string',
  expression: 'expression',
  binding: 'binding',
  markdown: 'markdown',
  math: 'math',
  code: 'code',
  comment: 'comment',
};

function tokenClass(kind: string): string {
  const normalized = kind.toLowerCase();
  const direct = TOKEN_CLASSES[normalized];
  if (direct) return direct;
  if (normalized.includes('tag')) return 'tag';
  if (normalized.includes('attr')) return 'attribute';
  if (normalized.includes('string') || normalized.includes('quote')) return 'string';
  if (normalized.includes('expr') || normalized.includes('interp')) return 'expression';
  if (normalized.includes('bind')) return 'binding';
  if (normalized.includes('math') || normalized.includes('latex')) return 'math';
  if (normalized.includes('code') || normalized.includes('fence')) return 'code';
  if (normalized.includes('comment')) return 'comment';
  if (
    normalized.includes('markdown')
    || normalized.includes('heading')
    || normalized.includes('emphasis')
    || normalized.includes('link')
  ) {
    return 'markdown';
  }
  return 'plain';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// The core guarantees ordered, non-overlapping tokens. Rendering additionally
// clamps and splits defensive copies so a stale or malformed range can never
// drop source text from the highlight layer.
function normalizeTokens(source: string, tokens: AuthorToken[]): AuthorToken[] {
  const result: AuthorToken[] = [];
  let cursor = 0;
  const ordered = [...tokens].sort((a, b) => a.range.start - b.range.start);
  for (const token of ordered) {
    const start = clamp(Math.max(token.range.start, cursor), 0, source.length);
    const end = clamp(token.range.end, start, source.length);
    cursor = end;
    if (end > start) result.push({ kind: token.kind, range: { start, end } });
  }
  return result;
}

/**
 * Analyses the exact source; caret movement never retriggers this work.
 * `enabled` lets the editor skip the analysis when authoring tools are off.
 */
export function useAuthorAnalysis(source: string, enabled = true): AuthorAnalysis {
  return useMemo(() => {
    if (!enabled) return EMPTY_ANALYSIS;
    try {
      const result = analyzeLocalSource(source);
      return {
        tokens: normalizeTokens(source, result.tokens),
        bindings: result.bindings,
        diagnostics: result.diagnostics,
      };
    } catch {
      return EMPTY_ANALYSIS;
    }
  }, [source, enabled]);
}

/* ------------------------------------------------------------------ */
/* Highlight layer                                                     */
/* ------------------------------------------------------------------ */

function renderHighlight(source: string, tokens: AuthorToken[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token, index) => {
    if (token.range.start > cursor) parts.push(source.slice(cursor, token.range.start));
    parts.push(
      <span
        key={`${index}-${token.range.start}`}
        className={`author-token author-token-${tokenClass(token.kind)}`}
        data-token-kind={token.kind}
      >
        {source.slice(token.range.start, token.range.end)}
      </span>,
    );
    cursor = token.range.end;
  });
  if (cursor < source.length) parts.push(source.slice(cursor));
  return parts;
}

export interface AuthorHighlightProps {
  source: string;
  tokens: AuthorToken[];
  /** Content width of the textarea, i.e. its client width without scrollbars. */
  width: number;
  editorRef: RefObject<HTMLTextAreaElement | null>;
}

export const AuthorHighlight = memo(function AuthorHighlight({
  source,
  tokens,
  width,
  editorRef,
}: AuthorHighlightProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // The textarea scrolls natively, so the overlay has to follow it. Moving the
  // highlight with a compositor transform (instead of its own scrollTop) keeps
  // the two in the same frame: scrolling never repaints the highlighted text,
  // and a short animation-frame follow catches scroll events that a browser
  // coalesces or delays during momentum scrolling.
  //
  // This is a passive effect on purpose. The highlight renders before its
  // sibling textarea, so on the first commit the editor ref is not attached
  // yet; a layout effect would bail out and leave the overlay frozen until the
  // next source change re-ran it. Passive effects flush after the whole commit,
  // when the ref is always available.
  useEffect(() => {
    const editor = editorRef.current;
    const content = contentRef.current;
    if (!editor || !content) return;

    let frame = 0;
    let idleTimer = 0;
    let lastTop = Number.NaN;
    let lastLeft = Number.NaN;

    const apply = () => {
      const top = editor.scrollTop;
      const left = editor.scrollLeft;
      if (top === lastTop && left === lastLeft) return;
      lastTop = top;
      lastLeft = left;
      content.style.transform = `translate3d(${-left}px, ${-top}px, 0)`;
    };

    const follow = () => {
      frame = 0;
      apply();
      if (idleTimer !== 0) frame = window.requestAnimationFrame(follow);
    };

    const wake = () => {
      apply();
      if (idleTimer !== 0) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        idleTimer = 0;
        if (frame !== 0) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
      }, 1000);
      if (frame === 0) frame = window.requestAnimationFrame(follow);
    };

    apply();
    const events = ['scroll', 'wheel', 'touchstart', 'touchmove'] as const;
    for (const type of events) editor.addEventListener(type, wake, { passive: true });
    return () => {
      for (const type of events) editor.removeEventListener(type, wake);
      if (idleTimer !== 0) window.clearTimeout(idleTimer);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [editorRef]);

  return (
    <div
      className="author-highlight"
      aria-hidden="true"
      style={width > 0 ? { width: `${width}px` } : undefined}
    >
      <div className="author-highlight-content" ref={contentRef}>
        {renderHighlight(source, tokens)}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Bilingual copy                                                      */
/* ------------------------------------------------------------------ */

interface AuthoringCopy {
  region: string;
  title: string;
  format: string;
  formatTitle: string;
  suggestions: string;
  suggestionsTitle: string;
  completionLabel: string;
  completionEmpty: string;
  completionCount: (count: number) => string;
  kinds: Record<AuthorCompletion['kind'], string>;
  bindingsLabel: string;
  noBindings: string;
  caretLabel: string;
  noBindingAtCaret: string;
  declarationCount: (count: number) => string;
  referenceCount: (count: number) => string;
  declaration: string;
  reference: string;
  locateTitle: string;
  renameLabel: string;
  renamePlaceholder: string;
  renameAction: string;
  renameTitle: string;
  renameHint: string;
  renameEmpty: string;
  renameSame: string;
  renameDone: (from: string, to: string) => string;
  renameFailed: (detail: string) => string;
  formatApplied: string;
  formatUnchanged: string;
  formatFailed: (detail: string) => string;
  typeLabel: string;
  unknownType: string;
  typeNames: Record<string, string>;
  position: (line: number, column: number) => string;
}

const ENGLISH: AuthoringCopy = {
  region: 'Source authoring tools',
  title: 'Authoring',
  format: 'Format',
  formatTitle: 'Normalise spacing inside recognised Reactive MD tags',
  suggestions: 'Suggest',
  suggestionsTitle: 'Show tag, attribute and binding suggestions (Ctrl+Space)',
  completionLabel: 'Source suggestions',
  completionEmpty: 'No suggestions at this position.',
  completionCount: (count) => `${count} suggestion${count === 1 ? '' : 's'}`,
  kinds: { tag: 'Tag', attribute: 'Attribute', binding: 'Binding', value: 'Value' },
  bindingsLabel: 'Bindings',
  noBindings: 'No bindings in this source.',
  caretLabel: 'At caret',
  noBindingAtCaret: 'Caret is not on a binding.',
  declarationCount: (count) => `${count} declaration${count === 1 ? '' : 's'}`,
  referenceCount: (count) => `${count} reference${count === 1 ? '' : 's'}`,
  declaration: 'Declaration',
  reference: 'Reference',
  locateTitle: 'Locate in editor',
  renameLabel: 'Rename selected binding',
  renamePlaceholder: 'New name',
  renameAction: 'Rename',
  renameTitle: 'Rename this binding everywhere it is declared or read',
  renameHint:
    'Updates declarations, expressions and plot parameters. Literal text and display formulas keep their source.',
  renameEmpty: 'Enter a new name.',
  renameSame: 'The new name is the current name.',
  renameDone: (from, to) => `Renamed ${from} to ${to}.`,
  renameFailed: (detail) => `Rename failed: ${detail}`,
  formatApplied: 'Formatted as one undo step.',
  formatUnchanged: 'The source is already formatted.',
  formatFailed: (detail) => `Formatting failed: ${detail}`,
  typeLabel: 'Type',
  unknownType: 'Unknown',
  typeNames: {
    string: 'Text',
    number: 'Number',
    boolean: 'Boolean',
    array: 'List',
    'number-array': 'Number list',
    null: 'Null',
  },
  position: (line, column) => `Line ${line}:${column}`,
};

const CHINESE: AuthoringCopy = {
  region: '源码作者工具',
  title: '作者工具',
  format: '格式化',
  formatTitle: '整理已识别 Reactive MD 标签内的空白',
  suggestions: '补全',
  suggestionsTitle: '显示标签、属性与绑定建议（Ctrl+Space）',
  completionLabel: '源码补全建议',
  completionEmpty: '当前位置没有补全建议。',
  completionCount: (count) => `${count} 条建议`,
  kinds: { tag: '标签', attribute: '属性', binding: '绑定', value: '值' },
  bindingsLabel: '绑定',
  noBindings: '源码中没有绑定。',
  caretLabel: '光标位置',
  noBindingAtCaret: '光标不在绑定上。',
  declarationCount: (count) => `${count} 处声明`,
  referenceCount: (count) => `${count} 处引用`,
  declaration: '声明',
  reference: '引用',
  locateTitle: '在编辑器中定位',
  renameLabel: '重命名选中绑定',
  renamePlaceholder: '新名称',
  renameAction: '重命名',
  renameTitle: '重命名所有声明与引用位置',
  renameHint: '修改绑定声明、表达式引用与绘图参数，保留普通文字和展示公式。',
  renameEmpty: '请输入新名称。',
  renameSame: '新名称与当前名称相同。',
  renameDone: (from, to) => `已将 ${from} 重命名为 ${to}。`,
  renameFailed: (detail) => `重命名失败：${detail}`,
  formatApplied: '已格式化，可一步撤销。',
  formatUnchanged: '源码无需格式化。',
  formatFailed: (detail) => `格式化失败：${detail}`,
  typeLabel: '类型',
  unknownType: '未知',
  typeNames: {
    string: '文本',
    number: '数字',
    boolean: '布尔值',
    array: '列表',
    'number-array': '数字列表',
    null: '空值',
  },
  position: (line, column) => `第 ${line} 行 ${column} 列`,
};

const AUTHORING_COPY: Record<EditorLocale, AuthoringCopy> = { en: ENGLISH, zh: CHINESE };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function contains(range: SourceRange, offset: number): boolean {
  return offset >= range.start && offset <= range.end;
}

function rangeSize(range: SourceRange): number {
  return range.end - range.start;
}

interface CaretBinding {
  binding: AuthorBinding;
  role: 'declaration' | 'reference';
}

function bindingAtOffset(bindings: AuthorBinding[], offset: number): CaretBinding | null {
  let best: CaretBinding | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  const consider = (binding: AuthorBinding, range: SourceRange, role: CaretBinding['role']) => {
    if (!contains(range, offset)) return;
    const size = rangeSize(range);
    if (size >= bestSize) return;
    best = { binding, role };
    bestSize = size;
  };
  for (const binding of bindings) {
    for (const range of binding.declarations) consider(binding, range, 'declaration');
    for (const range of binding.references) consider(binding, range, 'reference');
  }
  return best;
}

function readSelection(editorRef: RefObject<HTMLTextAreaElement | null>): EditorSelection {
  const editor = editorRef.current;
  if (!editor) return { start: 0, end: 0 };
  const length = editor.value.length;
  const start = clamp(editor.selectionStart, 0, length);
  const end = clamp(editor.selectionEnd, start, length);
  return { start, end };
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(a: string, b: string, prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix;
  let index = 0;
  while (index < limit && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1;
  return index;
}

/** Maps a caret through a conservative source rewrite (formatting). */
function mapOffsetAcrossSources(before: string, after: string, offset: number): number {
  const clamped = clamp(offset, 0, before.length);
  const prefix = commonPrefixLength(before, after);
  if (clamped <= prefix) return clamped;
  const suffix = commonSuffixLength(before, after, prefix);
  const oldSuffixStart = before.length - suffix;
  if (clamped >= oldSuffixStart) return after.length - suffix + (clamped - oldSuffixStart);
  const oldMiddleLength = oldSuffixStart - prefix;
  const newMiddleLength = after.length - suffix - prefix;
  if (oldMiddleLength <= 0) return after.length - suffix;
  const ratio = (clamped - prefix) / oldMiddleLength;
  return Math.round(prefix + ratio * newMiddleLength);
}

/** Maps a caret through the exact token replacements returned by rename. */
function mapOffsetThroughEdits(
  offset: number,
  edits: readonly { range: SourceRange; text: string }[],
): number {
  let delta = 0;
  for (const edit of [...edits].sort((a, b) => a.range.start - b.range.start)) {
    if (offset < edit.range.start) break;
    if (offset > edit.range.end) {
      delta += edit.text.length - rangeSize(edit.range);
      continue;
    }
    return edit.range.start + delta + Math.min(offset - edit.range.start, edit.text.length);
  }
  return offset + delta;
}

function keepEditorFocus(event: { preventDefault(): void }): void {
  event.preventDefault();
}

function isComposingEvent(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  const clamped = clamp(offset, 0, source.length);
  const lineStart = source.lastIndexOf('\n', clamped - 1) + 1;
  return {
    line: source.slice(0, clamped).split('\n').length,
    column: clamped - lineStart + 1,
  };
}

/* ------------------------------------------------------------------ */
/* Authoring panel                                                     */
/* ------------------------------------------------------------------ */

export interface AuthoringPanelProps {
  source: string;
  analysis: AuthorAnalysis;
  /** Latest successful document, used for binding value types. */
  bindingDocument: LocalDocument | null;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  onEdit(edit: EditorEdit): void;
  onLocate(range: SourceRange): void;
  /** Read-only and disabled editors block every authoring action. */
  disabled?: boolean;
}

export function AuthoringPanel({
  source,
  analysis,
  bindingDocument,
  editorRef,
  onEdit,
  onLocate,
  disabled = false,
}: AuthoringPanelProps) {
  const locale = useEditorLocale();
  const copy = AUTHORING_COPY[locale];
  const renameInputId = useId();
  const completionListId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const completionListRef = useRef<HTMLDivElement>(null);

  const [offset, setOffset] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionItems, setCompletionItems] = useState<AuthorCompletion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  // Keyboard handling reads these through refs so a fast key sequence never
  // sees a stale index or a list that has already been replaced.
  const completionOpenRef = useRef(completionOpen);
  const completionItemsRef = useRef(completionItems);
  const completionIndexRef = useRef(completionIndex);
  completionOpenRef.current = completionOpen;
  completionItemsRef.current = completionItems;
  completionIndexRef.current = completionIndex;

  // Caret tracking is local so moving the caret never asks the host to
  // re-render the whole editor.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const update = () => setOffset(editor.selectionStart);
    update();
    const events = ['select', 'keyup', 'click', 'input', 'focus'] as const;
    for (const type of events) editor.addEventListener(type, update);
    return () => {
      for (const type of events) editor.removeEventListener(type, update);
    };
  }, [editorRef]);

  useEffect(() => {
    setCompletionOpen(false);
  }, [source]);

  useEffect(() => {
    setStatus(null);
    setRenameError(null);
  }, [locale]);

  const caret = useMemo(
    () => bindingAtOffset(analysis.bindings, offset),
    [analysis.bindings, offset],
  );

  useEffect(() => {
    if (caret) setSelectedName(caret.binding.name);
  }, [caret]);

  const activeBinding = useMemo(() => {
    const named = selectedName
      ? analysis.bindings.find((binding) => binding.name === selectedName)
      : undefined;
    return named ?? analysis.bindings[0] ?? null;
  }, [analysis.bindings, selectedName]);

  useEffect(() => {
    setRenameValue('');
    setRenameError(null);
  }, [activeBinding?.name]);

  const activeType = activeBinding && bindingDocument
    ? bindingDocument.bindings[activeBinding.name]?.type ?? bindingDocument.computations?.[activeBinding.name]?.type
    : undefined;
  const caretType = caret && bindingDocument
    ? bindingDocument.bindings[caret.binding.name]?.type ?? bindingDocument.computations?.[caret.binding.name]?.type
    : undefined;
  const caretTypeName = caretType ? (copy.typeNames[caretType] ?? caretType) : copy.unknownType;
  const typeName = activeType ? (copy.typeNames[activeType] ?? activeType) : copy.unknownType;

  const openCompletions = useCallback(() => {
    if (disabled) return;
    const editor = editorRef.current;
    const at = clamp(editor?.selectionStart ?? 0, 0, source.length);
    let items: AuthorCompletion[] = [];
    try {
      items = completeLocalSource(source, at) ?? [];
    } catch {
      items = [];
    }
    setCompletionItems(items);
    setCompletionIndex(0);
    setCompletionOpen(true);
    setStatus(null);
  }, [disabled, editorRef, source]);

  const applyCompletion = useCallback((item: AuthorCompletion) => {
    if (disabled) return;
    const start = clamp(item.range.start, 0, source.length);
    const end = clamp(item.range.end, start, source.length);
    const value = source.slice(0, start) + item.insertText + source.slice(end);
    const caretOffset = start + item.insertText.length;
    setCompletionOpen(false);
    onEdit({ value, selection: { start: caretOffset, end: caretOffset } });
  }, [disabled, onEdit, source]);

  // Completion keys are handled before the editor's editing shortcuts. They
  // are consumed only while the list is open, so Tab, IME composition and
  // normal editing keys keep their default behaviour.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isComposingEvent(event)) return;
      if (disabled) {
        if (completionOpenRef.current) setCompletionOpen(false);
        return;
      }
      const key = event.key;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && !event.altKey && (key === ' ' || key === 'Spacebar')) {
        event.preventDefault();
        event.stopPropagation();
        openCompletions();
        return;
      }
      if (!completionOpenRef.current) return;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const length = completionItemsRef.current.length;
        setCompletionIndex((current) => {
          if (length === 0) return 0;
          const delta = key === 'ArrowDown' ? 1 : -1;
          return (current + delta + length) % length;
        });
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const item = completionItemsRef.current[completionIndexRef.current];
        if (item) applyCompletion(item);
        else setCompletionOpen(false);
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setCompletionOpen(false);
      }
    };
    editor.addEventListener('keydown', handleKeyDown, true);
    return () => editor.removeEventListener('keydown', handleKeyDown, true);
  }, [applyCompletion, disabled, editorRef, openCompletions]);

  useEffect(() => {
    if (!completionOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setCompletionOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isComposingEvent(event)) setCompletionOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [completionOpen]);

  useEffect(() => {
    if (!completionOpen) return;
    completionListRef.current
      ?.querySelector<HTMLElement>(`[data-completion-index="${completionIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [completionIndex, completionOpen]);

  const handleFormat = () => {
    if (disabled) return;
    let formatted: string;
    try {
      formatted = formatLocalSource(source);
    } catch (error) {
      setStatus(copy.formatFailed(error instanceof Error ? error.message : String(error)));
      return;
    }
    if (formatted === source) {
      setStatus(copy.formatUnchanged);
      return;
    }
    const selection = readSelection(editorRef);
    onEdit({
      value: formatted,
      selection: {
        start: mapOffsetAcrossSources(source, formatted, selection.start),
        end: mapOffsetAcrossSources(source, formatted, selection.end),
      },
    });
    setStatus(copy.formatApplied);
  };

  const handleRename = () => {
    if (disabled || !activeBinding) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      setRenameError(copy.renameEmpty);
      return;
    }
    if (nextName === activeBinding.name) {
      setRenameError(copy.renameSame);
      return;
    }
    try {
      const result = renameLocalBinding(source, activeBinding.name, nextName);
      const selection = readSelection(editorRef);
      onEdit({
        value: result.source,
        selection: {
          start: mapOffsetThroughEdits(selection.start, result.edits),
          end: mapOffsetThroughEdits(selection.end, result.edits),
        },
      });
      setSelectedName(nextName);
      setRenameValue('');
      setRenameError(null);
      setStatus(copy.renameDone(activeBinding.name, nextName));
    } catch (error) {
      setRenameError(copy.renameFailed(error instanceof Error ? error.message : String(error)));
    }
  };

  const activeCompletion = completionItems[completionIndex];
  const locations = activeBinding
    ? [
      ...activeBinding.declarations.map((range, index) => ({
        range,
        role: 'declaration' as const,
        index,
      })),
      ...activeBinding.references.map((range, index) => ({
        range,
        role: 'reference' as const,
        index,
      })),
    ]
    : [];

  return (
    <section className="source-authoring" aria-label={copy.region} ref={panelRef}>
      <div className="authoring-bar">
        <span className="authoring-title">{copy.title}</span>
        <div className="authoring-actions">
          <button
            type="button"
            className="authoring-button"
            data-authoring-action="format"
            title={copy.formatTitle}
            disabled={disabled}
            onMouseDown={keepEditorFocus}
            onClick={handleFormat}
          >
            {copy.format}
          </button>
          <button
            type="button"
            className="authoring-button"
            data-authoring-action="suggest"
            title={copy.suggestionsTitle}
            aria-expanded={completionOpen}
            aria-controls={completionListId}
            disabled={disabled}
            onMouseDown={keepEditorFocus}
            onClick={openCompletions}
          >
            {copy.suggestions}
          </button>
        </div>
      </div>

      {completionOpen ? (
        <div className="authoring-completion" aria-label={copy.completionLabel}>
          <div className="authoring-completion-head">
            <span>{copy.completionLabel}</span>
            <span className="authoring-completion-count">
              {copy.completionCount(completionItems.length)}
            </span>
          </div>
          <div
            id={completionListId}
            className="authoring-completion-list"
            role="listbox"
            aria-label={copy.completionLabel}
            ref={completionListRef}
          >
            {completionItems.length === 0 ? (
              <p className="authoring-empty">{copy.completionEmpty}</p>
            ) : completionItems.map((item, index) => (
              <button
                key={`${item.kind}-${item.range.start}-${item.range.end}-${index}`}
                type="button"
                role="option"
                data-completion-index={index}
                aria-selected={index === completionIndex}
                className={`authoring-completion-item${index === completionIndex ? ' is-active' : ''}`}
                onMouseDown={keepEditorFocus}
                onMouseEnter={() => setCompletionIndex(index)}
                onClick={() => applyCompletion(item)}
              >
                <span className={`authoring-kind is-${item.kind}`}>{copy.kinds[item.kind] ?? item.kind}</span>
                <span className="authoring-completion-label">{item.label}</span>
                {item.detail ? (
                  <span className="authoring-completion-detail">{item.detail}</span>
                ) : null}
              </button>
            ))}
          </div>
          <p className="reactive-md-editor-sr-only" aria-live="polite">
            {activeCompletion ? `${copy.kinds[activeCompletion.kind] ?? activeCompletion.kind} ${activeCompletion.label}` : ''}
          </p>
        </div>
      ) : null}

      <div className="authoring-body">
        <p className="authoring-caret" data-binding-caret={caret?.binding.name ?? ''}>
          <span className="authoring-label">{copy.caretLabel}</span>
          {caret ? (
            <span className="authoring-caret-value">
              <strong>{caret.binding.name}</strong>
              <span className="authoring-type">{copy.typeLabel}: {caretTypeName}</span>
              <span>{copy.declarationCount(caret.binding.declarations.length)}</span>
              <span>{copy.referenceCount(caret.binding.references.length)}</span>
            </span>
          ) : (
            <span className="authoring-muted">{copy.noBindingAtCaret}</span>
          )}
        </p>

        <div className="authoring-row">
          <span className="authoring-label">{copy.bindingsLabel}</span>
          <div className="authoring-binding-list">
            {analysis.bindings.length === 0 ? (
              <span className="authoring-muted">{copy.noBindings}</span>
            ) : analysis.bindings.map((binding) => (
              <button
                key={binding.name}
                type="button"
                data-binding-name={binding.name}
                className="authoring-binding-chip"
                aria-pressed={binding.name === activeBinding?.name}
                title={`${copy.declarationCount(binding.declarations.length)} · ${copy.referenceCount(binding.references.length)}`}
                onClick={() => {
                  setSelectedName(binding.name);
                  setStatus(null);
                }}
              >
                <span>{binding.name}</span>
                <span className="authoring-binding-count">
                  {binding.declarations.length}/{binding.references.length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {activeBinding ? (
          <div className="authoring-row">
            <span className="authoring-label">
              {activeBinding.name} · {copy.typeLabel}: {typeName}
            </span>
            <div className="authoring-locations">
              {locations.map(({ range, role, index }) => {
                const position = lineAndColumn(source, range.start);
                return (
                  <button
                    key={`${role}-${range.start}-${range.end}`}
                    type="button"
                    className={`authoring-location is-${role}`}
                    data-binding-location={role}
                    data-start={range.start}
                    data-end={range.end}
                    title={copy.locateTitle}
                    onClick={() => {
                      setSelectedName(activeBinding.name);
                      onLocate(range);
                    }}
                  >
                    <span>{role === 'declaration' ? copy.declaration : copy.reference} {index + 1}</span>
                    <span className="authoring-location-position">
                      {copy.position(position.line, position.column)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="authoring-rename">
          <label className="authoring-label" htmlFor={renameInputId}>{copy.renameLabel}</label>
          <div className="authoring-rename-row">
            <input
              id={renameInputId}
              type="text"
              className="authoring-rename-input"
              data-authoring-action="rename-input"
              value={renameValue}
              placeholder={copy.renamePlaceholder}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled || !activeBinding}
              onChange={(event) => {
                setRenameValue(event.target.value);
                setRenameError(null);
              }}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter' && isComposingEvent(event.nativeEvent)) {
                  event.preventDefault();
                }
              }}
            />
            <button
              type="button"
              className="authoring-button authoring-primary"
              data-authoring-action="rename"
              disabled={disabled || !activeBinding}
              onMouseDown={keepEditorFocus}
              onClick={handleRename}
              title={copy.renameTitle}
            >
              {copy.renameAction}
            </button>
          </div>
          {renameError ? (
            <p className="authoring-error" role="alert">{renameError}</p>
          ) : null}
          <p className="authoring-hint">{copy.renameHint}</p>
        </div>

        {status ? (
          <p className="authoring-status" data-authoring-status="true" role="status">{status}</p>
        ) : null}
      </div>
    </section>
  );
}
