import type {ReactiveMarkdownEditorProps,EditorSelection,EditorViewMode} from '../types';
import type {AuthorAnalysis,Diagnostic,SourceRange} from '../../local';
import type {SourceChange} from './source-coordinates';

export interface EditorTransaction {
  previousSource:string;
  revision:number;
  baseRevision:number;
  source:string;
  changes:readonly SourceChange[];
  selection:EditorSelection;
  composing:boolean;
}
export interface EditorAuthorAnalysis {
  source:string;
  optionsKey:string;
  analysis:AuthorAnalysis;
}
export interface ReactiveMarkdownCodeEditorProps extends ReactiveMarkdownEditorProps {
  /** Undefined uses a private Worker. Null means the host's analysis is pending. */
  analysis?:EditorAuthorAnalysis|null;
  onTransaction?(transaction:EditorTransaction):void;
  /** Optional compile worker factory for CSP-sensitive hosts. */
  createAnalysisWorker?:()=>Worker;
}
export interface ReactiveMarkdownCodeEditorHandle {
  focus(selection?:EditorSelection):void;
  selectRange(range:SourceRange):void;
  getSelection():EditorSelection;
  getSource():string;
  getEditorElement():HTMLElement|null;
  getVisibleRanges():readonly SourceRange[];
  insertText(text:string):void;
  undo():void;
  redo():void;
}
export type {EditorSelection,EditorViewMode,Diagnostic};
