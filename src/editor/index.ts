/**
 * Public entry for the Reactive MD source editor.
 *
 * This module carries no CSS import, so consumers that only need the component
 * can tree-shake or server-render it. Import `reactive-md/editor/styles.css`
 * for the stylesheet, or use `./library` for the CSS-included bundle.
 */

export { ReactiveMarkdownEditor } from './ReactiveMarkdownEditor';
export type {EditorSurface} from './surface';
export type {
  EditorEdit,
  EditorLocale,
  EditorSelection,
  EditorTheme,
  EditorViewMode,
  ReactiveMarkdownEditorHandle,
  ReactiveMarkdownEditorProps,
} from './types';
