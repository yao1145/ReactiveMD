import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './styles.css';
import './author.css';

const source = [
  '# Independent in-memory instances',
  '',
  '[Jump to local parameters](#local-parameters)',
  '',
  '## Local parameters',
  '',
  '<panel title="Local parameters">',
  '<input bind="name" label="Name" initial="Reader">',
  '<slider bind="count" label="Count" initial="2" min="1" max="10">',
  '</panel>',
  '',
  'Hello, **{{ name }}**. The current count is **{{ count }}**.',
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
    <h1>Embed interactive local documents in your app</h1>
    <p>Both document instances share the same source but manage their own in-memory state. Remounting starts from initial values, and refreshing the page does not keep interaction results.</p>
    <div className="advanced-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 24 }} key={key}>
      <EmbeddedInstance title="Instance A" />
      <EmbeddedInstance title="Instance B" />
    </div>
    <p><button className="button button-secondary" onClick={() => setKey(value => value + 1)}>Remount</button>{' '}<a href="/">Back to Playground</a></p>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><EmbeddedDemo /></StrictMode>);
