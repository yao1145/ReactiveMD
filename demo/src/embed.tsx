import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactiveDocument, registerReactiveComponent, useReactiveContext, type ComponentProps } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './styles.css';
import './author.css';

function HostNote({ node }: ComponentProps) {
  const { runtime } = useReactiveContext();
  return <aside className="advanced-alert advanced-alert-info">{String(runtime.evaluate(node.props!.value))}</aside>;
}
const unregister = registerReactiveComponent({ name: 'host-note', form: 'container', label: 'none', children: 'any',
  props: { value: { type: 'string', dynamic: true, required: true } } }, HostNote);
if (import.meta.hot) import.meta.hot.dispose(unregister);
const source = [
  '```reactive-md', 'version: "0.2"', 'state:', '  count: 0', 'actions:', '  increment:',
  '    - set: count', '      value: "=count + 1"', '```', '',
  '当前数值：:value{value="=count"}。', '', '::button[加一]{on-click="increment"}', '',
  ':::host-note{value="=count == 0 ? \'等待首次交互\' : \'宿主组件已同步更新\'"}', ':::',
].join('\n');
function EmbeddedDemo() {
  const [key, setKey] = useState(0);
  return <main className="app-shell">
    <h1>同一语言，嵌入你的应用</h1>
    <p>两个文档实例分别管理状态。第一个实例保存进度，第二个实例使用内存状态。</p>
    <div className="advanced-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 24 }} key={key}>
      <section aria-label="持久化实例" className="md-card"><h2>保存进度</h2><ReactiveDocument source={source} documentId="embed:saved" storage={localStorage}/></section>
      <section aria-label="独立内存实例" className="md-card"><h2>独立实例</h2><ReactiveDocument source={source}/></section>
    </div>
    <p><button className="button button-secondary" onClick={() => setKey(value => value + 1)}>重新挂载</button>{' '}<a href="/">返回 Playground</a></p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><EmbeddedDemo/></StrictMode>);
