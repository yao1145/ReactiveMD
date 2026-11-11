import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { compileLocal, createLocalRuntime, type LocalRuntime } from 'reactive-md';
import { LocalDocumentView, type LocalColorScheme, type LocalRenderMode } from 'reactive-md/react';
import { source } from './document';
import 'reactive-md/styles.css';
import './page.css';

const compiled = compileLocal(source);
if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join('; '));
const runtime = createLocalRuntime(compiled.document);
declare global { interface Window { rmdChartAcceptance: { runtime: LocalRuntime } } }
window.rmdChartAcceptance = { runtime };

function App() {
  const [scheme, setScheme] = useState<LocalColorScheme>('light');
  const [mode, setMode] = useState<LocalRenderMode>('interactive');
  const [, setRevision] = useState(0);
  useEffect(() => runtime.subscribe(() => setRevision(value => value + 1)), []);
  return <main className="rmd-chart-acceptance" data-rmd-theme="default" data-color-scheme={scheme}>
    <div className="acceptance-wrap">
      <header className="acceptance-header"><div><p className="eyebrow">REACTIVEMD / DEFAULT THEME</p><h1>图表，接入真实文档。</h1><p className="intro">参数联动、悬浮读数、系列高亮与数据选择，在同一份 RMD 中验收。</p></div>
        <div className="host-actions"><button onClick={() => setScheme(scheme === 'light' ? 'dark' : 'light')}>{scheme === 'light' ? '深色模式' : '浅色模式'}</button><button onClick={() => setMode(mode === 'interactive' ? 'static' : 'interactive')}>{mode === 'interactive' ? '静态预览' : '返回交互'}</button><button onClick={() => runtime.setParameters({ alternate: !runtime.getParameters().alternate })}>外部切换数据</button></div>
      </header>
      <section id="document" className="document-shell"><LocalDocumentView document={compiled.document} runtime={runtime} colorScheme={scheme} mode={mode} locale="zh" /></section>
      <div className="acceptance-hints"><span>悬浮：读取数值</span><span>图例：高亮／隐藏系列</span><span>点击数据：写回选择</span><span>恢复默认：重置状态</span></div>
      <details className="source-panel"><summary>查看 RMD 源码与当前参数</summary><pre>{JSON.stringify(runtime.getParameters(), null, 2)}</pre><pre>{source}</pre></details>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
