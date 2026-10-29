/**
 * Public entry for the Reactive MD source editor.
 *
 * The CodeMirror 6 editor is the source implementation. `ReactiveMarkdownEditor`
 * and its `ReactiveMarkdownCodeEditor` alias share one component, so existing
 * CM6 consumers can migrate without a behaviour change.
 *
 * This module carries no CSS import, so consumers that only need the component
 * can tree-shake or server-render it. Import `reactive-md/editor/styles.css`
 * for the stylesheet, or use `./library` for the CSS-included bundle.
 */

export {
  ReactiveMarkdownCodeEditor as ReactiveMarkdownEditor,
  ReactiveMarkdownCodeEditor,
} from './codemirror/ReactiveMarkdownCodeEditor';
export type {
  ReactiveMarkdownCodeEditorProps as ReactiveMarkdownEditorProps,
  ReactiveMarkdownCodeEditorHandle as ReactiveMarkdownEditorHandle,
  ReactiveMarkdownCodeEditorProps,
  ReactiveMarkdownCodeEditorHandle,
  EditorAuthorAnalysis,
  EditorTransaction,
} from './codemirror/types';
export type { SourceChange } from './codemirror/source-coordinates';
export type { EditorSurface } from './surface';
export type {
  EditorEdit,
  EditorLocale,
  EditorSelection,
  EditorTheme,
  EditorViewMode,
} from './types';
