import { useRef, type ReactNode } from 'react';
import { useCopy } from './i18n';

export interface AuthorToolsProps {
  simple: boolean;
  onSimple(): void;
  onExport(): void;
  onImport(source: string): void;
  children?: ReactNode;
}

export function AuthorTools(props: AuthorToolsProps) {
  const copy = useCopy().authorTools;
  const file = useRef<HTMLInputElement>(null);
  return <div className="author-tools" aria-label={copy.ariaLabel}>
    <h3 className="more-options-heading">{copy.ariaLabel}</h3>
    <div className="author-tool-group">
      <button type="button" className={props.simple ? 'source-toggle is-primary' : 'source-toggle'} onClick={props.onSimple} aria-expanded={!props.simple} aria-controls="source-pane">
        {props.simple ? copy.showSource : copy.simpleView}
      </button>
      <button type="button" onClick={props.onExport} aria-label={copy.exportDocument}>
        {copy.exportDocument}
      </button>
      <button type="button" onClick={() => file.current?.click()}>{copy.importDocument}</button>
    </div>
        {props.children}
        <input ref={file} type="file" accept=".md,.markdown,.reactive.md,.html,.htm,text/markdown,text/plain,text/html" hidden onChange={async event => {
          const control = event.currentTarget;
          const selected = control.files?.[0];
          if (selected) props.onImport(await selected.text());
          control.value = '';
        }} />
  </div>;
}
