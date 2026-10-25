import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { Diagnostic, LocalDocument, SourceRange } from '../local/types';

export type EditorLocale = 'en' | 'zh';
export type EditorTheme = 'light' | 'dark' | 'auto';
export type EditorViewMode = 'edit' | 'split' | 'preview';
export interface EditorSelection { start: number; end: number }
export interface EditorEdit { value: string; selection: EditorSelection }

export interface ReactiveMarkdownEditorProps {
  value: string;
  onChange(value: string): void;
  locale?: EditorLocale;
  theme?: EditorTheme;
  /** Preview content rendered inside the editor frame. Enables view switching. */
  preview?: ReactNode;
  /** Controlled view mode; omit to let the editor manage its own mode. */
  viewMode?: EditorViewMode;
  defaultViewMode?: EditorViewMode;
  onViewModeChange?(mode: EditorViewMode): void;
  id?: string;
  className?: string;
  style?: CSSProperties;
  height?: number | string;
  minHeight?: number | string;
  placeholder?: string;
  ariaLabel?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Reset history, selection and scroll when switching source documents. */
  documentKey?: string | number;
  diagnostics?: readonly Diagnostic[];
  /** Optional compiled document for the binding inspector's value types. */
  document?: LocalDocument | null;
  toolbar?: boolean;
  authoring?: boolean;
  onExport?(): void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

export interface ReactiveMarkdownEditorHandle {
  focus(selection?: EditorSelection): void;
  selectRange(range: SourceRange): void;
  getSelection(): EditorSelection;
  getTextarea(): HTMLTextAreaElement | null;
  undo(): void;
  redo(): void;
}
