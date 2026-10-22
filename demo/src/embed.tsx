import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './styles.css';
import './author.css';

const source = [
  '# 独立的内存实例',
  '',
  '[跳到本地参数](#本地参数)',
  '',
  '## 本地参数',
  '',
  '<panel title="本地参数">',
  '<input bind="name" label="称呼" initial="读者">',
  '<slider bind="count" label="数量" initial="2" min="1" max="10">',
  '</panel>',
  '',
  '你好，**{{ name }}**。当前数量 **{{ count }}**。',
].join('\n');

function EmbeddedInstance({ title }: { title: string }) {
  return <section aria-label={title} className="md-card">
    <h2>{title}</h2>
    <LocalReactiveDocument source={source} />
  </section>;
}

function EmbeddedDemo() {
  const [key, setKey] = useState(0);
  return <main className="app-shell">
    <h1>本地交互文档可以嵌入你的应用</h1>
    <p>两个文档实例使用同一份源码，但各自管理内存状态。重新挂载会从初值开始，刷新页面也不会保留交互结果。</p>
    <div className="advanced-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 24 }} key={key}>
      <EmbeddedInstance title="实例 A" />
      <EmbeddedInstance title="实例 B" />
    </div>
    <p><button className="button button-secondary" onClick={() => setKey(value => value + 1)}>重新挂载</button>{' '}<a href="/">返回 Playground</a></p>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><EmbeddedDemo /></StrictMode>);
