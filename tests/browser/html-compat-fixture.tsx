import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/local/LocalDocumentView';
import type { LocalCompileOptions, Diagnostic } from '../../src/local/types';
import '../../src/styles.css';

declare global {
  interface Window {
    setHtmlCase(source: string, options?: LocalCompileOptions, copies?: number): void;
    htmlFallbackDiagnostics: Diagnostic[];
  }
}

const initialSource = `<details open><summary>Read <strong>more</strong></summary>

## Nested heading

<p>Water H<sub>2</sub>O and x<sup>2</sup>.</p>

<counter bind="count" label="Count" initial="2">

Current: {{ count }}

<details><summary>Nested disclosure</summary>

Nested **Markdown**.

</details>
</details>

<pre><code>&lt;script&gt;window.bad = true&lt;/script&gt; {{ count }}</code></pre>`;

function Fixture() {
  const [value, setValue] = useState({ source: initialSource, options: {} as LocalCompileOptions, copies: 1 });
  window.setHtmlCase = (source, options = {}, copies = 1) => setValue({ source, options, copies });
  return Array.from({ length: value.copies }, (_, index) => <LocalReactiveDocument key={index} source={value.source} compileOptions={value.options}
    onDiagnostics={diagnostics => { window.htmlFallbackDiagnostics = diagnostics; }}
    urlPolicy={(url, kind) => kind === 'link' || url === 'https://images.example.test/approved.png'}
    imageResolver={() => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}
  />);
}

createRoot(document.getElementById('root')!).render(<Fixture />);
