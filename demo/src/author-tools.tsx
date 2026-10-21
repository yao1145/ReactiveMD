import { useRef } from 'react';

export interface AuthorToolsProps {
  dark: boolean;
  simple: boolean;
  streaming: boolean;
  progress: number;
  onTheme(): void;
  onSimple(): void;
  onStream(): void;
  onFormat(): void;
  onExport(): void;
  onImport(source: string): void;
  onManifest(): void;
}
export function AuthorTools(props: AuthorToolsProps) {
  const file = useRef<HTMLInputElement>(null);
  return <div className="author-tools" aria-label="文档工具">
    <div className="author-tool-group">
      <button type="button" onClick={props.onStream} aria-pressed={props.streaming}>
        {props.streaming ? `停止流式播放（${props.progress}%）` : '流式播放'}
      </button>
      <button type="button" onClick={props.onSimple} aria-pressed={props.simple}>{props.simple ? '显示源码' : '简洁视图'}</button>
      <button type="button" onClick={props.onTheme} aria-pressed={props.dark}>{props.dark ? '浅色主题' : '深色主题'}</button>
    </div>
    <div className="author-tool-group">
      <button type="button" onClick={props.onFormat} disabled={props.streaming}>格式化</button>
      <button type="button" onClick={() => file.current?.click()} disabled={props.streaming}>导入文档</button>
      <button type="button" onClick={props.onExport}>导出文档</button>
      <button type="button" onClick={props.onManifest}>组件清单</button>
      <input ref={file} type="file" accept=".md,.markdown,.rmd,text/markdown,text/plain" hidden onChange={async event => {
        const control = event.currentTarget;
        const selected = control.files?.[0];
        if (selected) props.onImport(await selected.text());
        control.value = '';
      }} />
    </div>
  </div>;
}
