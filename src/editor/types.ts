import type { CSSProperties, ReactNode } from 'react';
import type { Diagnostic, LocalCompileOptions, LocalDocument } from '../local/types';

import type { EditorLocale, EditorSelection } from './command-types';
export type { EditorLocale, EditorSelection, EditorEdit } from './command-types';
export type EditorTheme = 'light' | 'dark' | 'auto';
export type EditorViewMode = 'edit' | 'split' | 'preview';

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
  /** Compile options used by the host preview; authoring analyses follow them. */
  compileOptions?: LocalCompileOptions;
  /** Optional compiled document for the binding inspector's value types. */
  document?: LocalDocument | null;
  toolbar?: boolean;
  authoring?: boolean;
  onExport?(): void;
}
