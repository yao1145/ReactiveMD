import { useRef } from 'react';

export interface AuthorToolsProps {
  dark: boolean;
  simple: boolean;
  onTheme(): void;
  onSimple(): void;
  onExport(): void;
  onImport(source: string): void;
}

export function AuthorTools(props: AuthorToolsProps) {
  const file = useRef<HTMLInputElement>(null);
  return <div className="author-tools" aria-label="文档工具">
    <div className="author-tool-group">
      <button type="button" onClick={props.onTheme} aria-pressed={props.dark}>
        {props.dark ? '浅色主题' : '深色主题'}
      </button>
      <button type="button" onClick={props.onSimple} aria-pressed={props.simple}>
        {props.simple ? '显示源码' : '简洁视图'}
      </button>
    </div>
    <div className="author-tool-group">
      <button type="button" onClick={() => file.current?.click()}>导入文档</button>
      <button type="button" onClick={props.onExport}>导出文档</button>
      <input ref={file} type="file" accept=".md,.markdown,.reactive.md,text/markdown,text/plain" hidden onChange={async event => {
        const control = event.currentTarget;
        const selected = control.files?.[0];
        if (selected) props.onImport(await selected.text());
        control.value = '';
      }} />
    </div>
  </div>;
}
