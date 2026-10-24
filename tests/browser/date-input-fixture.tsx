import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import '../../src/styles.css';
import forms from '../../examples/local/showcase/zh/forms.reactive.md?raw';

const source = `${forms}

<panel title="Date states">
<date bind="emptyDate" label="Empty date" min="2026-01-01" max="2026-12-31">
<date label="Disabled date" initial="2026-11-01" disabled="true">
Selected date: {{ emptyDate }}
</panel>`;

createRoot(document.getElementById('root')!).render(<LocalReactiveDocument source={source} locale="zh" />);
