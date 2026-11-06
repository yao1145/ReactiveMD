/** DOM- and React-independent types shared by editor text commands. */
export type EditorLocale = 'en' | 'zh';
export interface EditorSelection { start: number; end: number }
export interface EditorEdit { value: string; selection: EditorSelection }
