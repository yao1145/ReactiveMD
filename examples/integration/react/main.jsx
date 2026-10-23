import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const source = `# Cost estimate

<panel title="Adjust the plan">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.`;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <main style={{ padding: 24 }}>
      <LocalReactiveDocument source={source} />
    </main>
  </React.StrictMode>,
);
