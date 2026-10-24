import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/local/LocalDocumentView';
import '../../src/styles.css';
import recipe from '../../examples/local/recipes/invoice.reactive.md?raw';

const source = `${recipe}

<computed name="inverse" value="{{ 100 / quantity }}">
<computed name="inverseLabel" value="{{ formatNumber(inverse) }}">

Reciprocal: {{ inverseLabel }}.

Calendar hours: {{ dateDiff('2026-03-09', '2026-03-08', 'hours') }}.
`;

createRoot(document.getElementById('root')!).render(<LocalReactiveDocument source={source} />);
