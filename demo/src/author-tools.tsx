import { useRef } from 'react';
import { useCopy } from './i18n';

export interface AuthorToolsProps {
  dark: boolean;
  simple: boolean;
  onTheme(): void;
  onSimple(): void;
  onExport(): void;
  onImport(source: string): void;
}

export function AuthorTools(props: AuthorToolsProps) {
  const copy = useCopy().authorTools;
  const file = useRef<HTMLInputElement>(null);
  return <div className="author-tools" aria-label={copy.ariaLabel}>
    <div className="author-tool-group">
      <button type="button" onClick={props.onTheme} aria-pressed={props.dark}>
        {props.dark ? copy.lightTheme : copy.darkTheme}
      </button>
      <button type="button" onClick={props.onSimple} aria-pressed={props.simple}>
        {props.simple ? copy.showSource : copy.simpleView}
      </button>
    </div>
    <div className="author-tool-group">
      <button type="button" onClick={() => file.current?.click()}>{copy.importDocument}</button>
      <button type="button" onClick={props.onExport}>{copy.exportDocument}</button>
      <input ref={file} type="file" accept=".md,.markdown,.reactive.md,text/markdown,text/plain" hidden onChange={async event => {
        const control = event.currentTarget;
        const selected = control.files?.[0];
        if (selected) props.onImport(await selected.text());
        control.value = '';
      }} />
    </div>
  </div>;
}
