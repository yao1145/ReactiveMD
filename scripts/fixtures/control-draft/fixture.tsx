import { createRoot } from 'react-dom/client';
import { compileLocal } from '../../../src/local/compilation/compiler';
import { createLocalRuntime } from '../../../src/local/runtime/runtime';
import { LocalDocumentView } from '../../../src/local/rendering/LocalDocumentView';
import '../../../src/styles.css';

declare global {
  interface Window {
    runtime: ReturnType<typeof createLocalRuntime>;
  }
}

const source = `<input bind="name" label="Name" initial="Ada">
<textarea bind="notes" label="Notes" initial="Initial notes">
<number bind="count" label="Count" initial="2" min="0" max="10" step="1">
<panel title="Draft" reset="true">
<input bind="code" label="Code" initial="ok" max-length="3">
</panel>

Name: {{ name }}. Notes: {{ notes }}. Count: {{ count }}. Code: {{ code }}.`;

const compiled = compileLocal(source);
if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join('; '));
const runtime = createLocalRuntime(compiled.document);
window.runtime = runtime;

createRoot(document.getElementById('root')!).render(
  <LocalDocumentView document={compiled.document} runtime={runtime} />,
);
