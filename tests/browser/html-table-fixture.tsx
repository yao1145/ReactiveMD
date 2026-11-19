import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import type { Diagnostic } from '../../src/local/types';
import '../../src/styles.css';

const columns = Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`);
const wideMarkdown = `<table label="Wide" searchable="false" sortable="false">\n| ${columns.join(' | ')} |\n| ${columns.map(() => '---:').join(' | ')} |\n| ${columns.map(() => '12345').join(' | ')} |\n</table>`;
const wideHtml = `<table><caption>Wide</caption><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr><tr>${columns.map(() => '<td>12345</td>').join('')}</tr></table>`;
const source = `<table label="Prices" searchable="false" sortable="false" page-size="50">
| Name | Value |
| --- | ---: |
| A | 1 |
| B | 2 |
</table>

<table>
<caption>Prices</caption>
<tr><th scope="col">Name</th><th scope="col">Value</th></tr>
<tr><td>A</td><td>1</td></tr>
<tr><td>B</td><td>2</td></tr>
</table>

<table>
<caption>Merged cells</caption>
<thead><tr><th rowspan="2" scope="col">Item</th><th colspan="2">Prices</th></tr>
<tr><th>Base</th><th>Discount</th></tr></thead>
<tbody><tr><th scope="row">A</th><td>10</td><td>8</td></tr>
<tr><td colspan="3">**Rich text** and \\(x^2\\)</td></tr></tbody>
</table>

<table><caption>Live content</caption><tr><td>
<counter bind="count" label="Count" initial="2">

Current: {{ count }}
</td></tr></table>

${wideMarkdown}

${wideHtml}`;

declare global { interface Window { tableDiagnostics: Diagnostic[] } }
window.tableDiagnostics = [];
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 800, margin: 'auto' }}>
  <div id="interactive"><LocalReactiveDocument source={source} onDiagnostics={items => { window.tableDiagnostics = items; }} /></div>
  <div id="static"><LocalReactiveDocument source={source} mode="static" /></div>
</main>);
