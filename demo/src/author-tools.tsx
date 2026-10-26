import { useRef, type ReactNode } from 'react';
import { useCopy, useLanguage } from './i18n';

export interface AuthorToolsProps {
  dark: boolean;
  simple: boolean;
  onTheme(): void;
  onSimple(): void;
  onExport(): void;
  onImport(source: string): void;
  children?: ReactNode;
}

export function AuthorTools(props: AuthorToolsProps) {
  const copy = useCopy().authorTools;
  const language = useLanguage();
  const file = useRef<HTMLInputElement>(null);
  return <div className="author-tools" aria-label={copy.ariaLabel}>
    <div className="author-tool-group">
      <button type="button" className={props.simple ? 'source-toggle is-primary' : 'source-toggle'} onClick={props.onSimple} aria-expanded={!props.simple} aria-controls="source-pane">
        {props.simple ? copy.showSource : copy.simpleView}
      </button>
      <button type="button" onClick={props.onExport} aria-label={copy.exportDocument}>
        <span className="tool-full-label">{copy.exportDocument}</span>
        <span className="tool-short-label" aria-hidden="true">{language === 'zh' ? '导出' : 'Export'}</span>
      </button>
      <button type="button" onClick={props.onTheme} aria-pressed={props.dark}>
        <span className="tool-full-label">{props.dark ? copy.lightTheme : copy.darkTheme}</span>
        <span className="tool-short-label" aria-hidden="true">{props.dark ? '☀' : '◐'}</span>
        <span className="sr-only tool-mobile-label">{props.dark ? copy.lightTheme : copy.darkTheme}</span>
      </button>
    </div>
    <details className="author-tools-menu">
      <summary aria-label={copy.ariaLabel}>
        <span className="tool-full-label">{copy.ariaLabel}</span>
        <span className="tool-short-label" aria-hidden="true">•••</span>
        <span className="author-tools-menu-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="author-tools-menu-panel">
        <button type="button" onClick={() => file.current?.click()}>{copy.importDocument}</button>
        {props.children}
        <input ref={file} type="file" accept=".md,.markdown,.reactive.md,.html,.htm,text/markdown,text/plain,text/html" hidden onChange={async event => {
          const control = event.currentTarget;
          const selected = control.files?.[0];
          if (selected) props.onImport(await selected.text());
          control.value = '';
        }} />
      </div>
    </details>
  </div>;
}
