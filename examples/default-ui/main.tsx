import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { compileLocal, createLocalRuntime, type LocalRuntime } from 'reactive-md';
import { LocalDocumentView, LocalReactiveDocument, type LocalColorScheme, type LocalRenderMode } from 'reactive-md/react';
import source from './example.rmd?raw';
import 'reactive-md/styles.css';
import './page.css';

const compiled = compileLocal(source);
if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join('; '));
const document = compiled.document;
const runtime = createLocalRuntime(document);
declare global { interface Window { defaultUiAcceptance: { runtime: LocalRuntime; setScheme(value: LocalColorScheme): void; setMode(value: LocalRenderMode): void } } }
window.defaultUiAcceptance = { runtime, setScheme() {}, setMode() {} };

function App() {
  const [scheme, setScheme] = useState<LocalColorScheme>('light');
  const [mode, setMode] = useState<LocalRenderMode>('interactive');
  const [, setRevision] = useState(0);
  const [nativeTarget, setNativeTarget] = useState<HTMLElement | null>(null);
  useEffect(() => runtime.subscribe(() => setRevision(revision => revision + 1)), []);
  useEffect(() => setNativeTarget(window.document.querySelector('#document article')), []);
  window.defaultUiAcceptance.setScheme = setScheme;
  window.defaultUiAcceptance.setMode = setMode;
  return <main className="acceptance-page" data-demo-scheme={scheme}>
    <header className="page-header"><div><p className="eyebrow">REACTIVEMD / DEFAULT THEME</p><h1>每一次调整，都有回应。</h1><p className="page-intro">正式默认主题与真实文档运行时。拖动、选择、校验，再恢复默认。</p></div>
      <div className="host-actions"><button type="button" onClick={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}>{scheme === 'dark' ? '切换浅色' : '切换深色'}</button><button type="button" onClick={() => setMode(mode === 'static' ? 'interactive' : 'static')}>{mode === 'static' ? '返回交互' : '静态预览'}</button></div>
    </header>
    <div className="acceptance-layout"><section id="document" className="document-shell"><LocalDocumentView document={document} runtime={runtime} colorScheme={scheme} mode={mode} locale="zh" /></section>
      <aside className="acceptance-aside"><section className="aside-card"><span className="aside-index">01 / 观察状态</span><h2>运行时参数</h2><p>这里读取同一个 RMD runtime，也可以从外部同步更新控件。</p><pre id="live-state">{JSON.stringify(runtime.getParameters(), null, 2)}</pre><button type="button" onClick={() => runtime.setParameters({ progress: 65, lo: 30, hi: 70, mode: 'explore', course: 'lab', day: '2026-11-18', confirmed: true })}>加载一组实验参数</button></section>
        <section className="aside-card"><span className="aside-index">02 / 检查隔离</span><h2>另一个文档</h2><p>此文档固定为浅色，切换主文档时保持独立。</p><div id="isolated-document"><LocalReactiveDocument source={'<slider label="独立进度" initial="25">\n\n<toggle label="独立开关" initial="true">'} colorScheme="light" locale="zh" /></div></section>
        <section className="aside-card"><span className="aside-index">03 / 保留兼容</span><h2>其他主题的原生控件</h2><div id="other-theme"><LocalReactiveDocument source={'<theme name="classic">\n<slider label="原生进度" initial="35">\n<select label="原生选择">\n<option value="a">选项 A</option>\n<option value="b">选项 B</option>\n</select>'} themes={[{ name:'classic', protocol:'reactive-md-theme-1', colorSchemes:['light','dark'] }]} colorScheme="light" locale="zh" /></div></section>
      </aside>
    </div>
    {nativeTarget && mode === 'interactive' ? createPortal(<section className="native-control-preview"><h2>长按钮与内部间距</h2><button className="md-button-primary long-label-button" type="button" title="这是一个需要显示前半部分并用省略号截断的很长按钮标签 LongUnbrokenButtonLabelForOverflowReview">这是一个需要显示前半部分并用省略号截断的很长按钮标签 LongUnbrokenButtonLabelForOverflowReview</button></section>, nativeTarget) : null}
    <footer className="page-footer">验收提示：省略文字可悬停或聚焦查看全文；滑块支持方向键；折叠面板可独立展开；静态预览保留当前数值。</footer>
  </main>;
}
createRoot(window.document.getElementById('root')!).render(<App />);
