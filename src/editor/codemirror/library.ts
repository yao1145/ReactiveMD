/**
 * Compatibility entry for the former CodeMirror-only bundle.
 *
 * The component comes from the external `reactive-md/editor` module, so a host
 * that imports both entry points still mounts a single copy of CodeMirror.
 * Styles are provided by `reactive-md/editor/styles.css`; the main build maps
 * the former `editor/codemirror/styles.css` export onto them.
 */

export { ReactiveMarkdownEditor as ReactiveMarkdownCodeEditor } from 'reactive-md/editor';
export type {
  ReactiveMarkdownEditorProps as ReactiveMarkdownCodeEditorProps,
  ReactiveMarkdownEditorHandle as ReactiveMarkdownCodeEditorHandle,
  EditorAuthorAnalysis,
  EditorTransaction,
  SourceChange,
} from 'reactive-md/editor';
