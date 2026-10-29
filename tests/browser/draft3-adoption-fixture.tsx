import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/local/LocalDocumentView';
import '../../src/styles.css';

const externalValues = { rate: 4 };
const base = '<number bind="amount" label="Amount" initial="2">\n\nAmount: {{ amount }}';
const enriched = '<external name="rate" type="number">\n' + base + '\n\nRate: {{ rate }}';

function App() {
  const [source, setSource] = useState(base);
  const [calls, setCalls] = useState(0);
  return <main>
    <button type="button" onClick={() => setSource(enriched)}>Add external</button>
    <button type="button" onClick={() => setSource(base)}>Remove external</button>
    <p id="calls">{calls}</p>
    <LocalReactiveDocument source={source} externalValues={externalValues} initialParameters={{ amount: 3 }} onParametersChange={() => setCalls(value => value + 1)} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
