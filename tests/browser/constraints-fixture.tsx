import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/local/LocalDocumentView';
import '../../src/styles.css';
import workshop from '../../examples/local/recipes/workshop.reactive.md?raw';

const source = `${workshop}

<computed name="rowIds" value="{{ duplicateRows ? ['physics', 'physics'] : reverseRows ? ['physics', 'chemistry'] : ['chemistry', 'physics'] }}">
<toggle bind="reverseRows" label="Reverse rows">
<toggle bind="duplicateRows" label="Duplicate rows">

<data-table label="Stable rows" rows="{{ rowIds }}" key="{{ item }}" max-rows="2">
<column label="Identity" value="{{ item }}">
<column label="Position" value="{{ index + 1 }}">
</data-table>
`;

createRoot(document.getElementById('root')!).render(<LocalReactiveDocument source={source} />);
