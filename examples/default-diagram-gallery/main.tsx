import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { compileLocal, createLocalRuntime } from 'reactive-md';
import { LocalDocumentView, type LocalColorScheme, type LocalRenderMode } from 'reactive-md/react';
import { imageAssets, source } from './document';
import 'reactive-md/styles.css';
import './page.css';

const compiled = compileLocal(source);
if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join('; '));
const documentModel = compiled.document;
const runtime = createLocalRuntime(documentModel);
const allowedImages = new Set(imageAssets.map(url => new URL(url, import.meta.url).href));
const allowUrl = (url: string, kind: 'image' | 'link') => {
  return kind === 'link' || allowedImages.has(new URL(url, import.meta.url).href);
};

function App() {
  const [scheme, setScheme] = useState<LocalColorScheme>('light');
  const [mode, setMode] = useState<LocalRenderMode>('interactive');
  return <main className="interaction-demo" data-rmd-theme="default" data-color-scheme={scheme}>
    <div className="demo-shell"><header className="demo-head"><div><p className="eyebrow">REACTIVEMD / INTERACTION STUDIES</p><h1>看见联系，浏览细节。</h1><p className="intro">Diagram 的节点说明与 Gallery 的横向浏览，在同一份真实文档中体验。</p></div>
      <div className="demo-actions"><button onClick={() => setScheme(scheme === 'light' ? 'dark' : 'light')}>{scheme === 'light' ? '深色模式' : '浅色模式'}</button><button onClick={() => setMode(mode === 'interactive' ? 'static' : 'interactive')}>{mode === 'interactive' ? '静态预览' : '返回交互'}</button></div>
    </header><section id="document" className="document-frame"><LocalDocumentView document={documentModel} runtime={runtime} colorScheme={scheme} mode={mode} locale="zh" urlPolicy={allowUrl} /></section>
    <footer>悬浮或聚焦节点查看说明 · 点击选择阶段 · Gallery 支持触控、滚轮、按钮与键盘</footer></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
