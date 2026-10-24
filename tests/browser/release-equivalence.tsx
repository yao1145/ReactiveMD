import { createRoot } from 'react-dom/client';
import {
  compileLocal,
  createLocalRuntime,
  createLocalStateFile,
  exportLocalState,
  type LocalStateFile,
} from '../../src/local';
import { LocalDocumentView } from '../../src/local/LocalDocumentView';
import { resolveLocalStateBaseline } from '../../src/shareable';
import '../../src/styles.css';
import source from './release-document.reactive.md?raw';
import baselineParameters from './release-baseline.json';

interface StandaloneHandle {
  getState(): LocalStateFile;
  unmount(): void;
}

interface StandaloneModule {
  mount(element: HTMLElement, options: { source: string; state?: LocalStateFile | string }): StandaloneHandle;
}

interface ReleaseHarness {
  ready: boolean;
  standalone: StandaloneHandle;
  exportReact(): LocalStateFile;
  importState(state: LocalStateFile): LocalStateFile;
}

declare global {
  interface Window {
    ReactiveMD: StandaloneModule;
    releaseHarness: ReleaseHarness;
  }
}

const compiled = compileLocal(source);
if (!compiled.ok) {
  throw new Error(compiled.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
}
const generator = { name: 'release-equivalence', version: '1' };
const state = createLocalStateFile(compiled.document, baselineParameters, generator);
const baseline = resolveLocalStateBaseline(compiled.document, state);
if (!baseline.ok) {
  throw new Error(baseline.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n'));
}

const viewDocument = baseline.baseline.document;
const runtime = createLocalRuntime(viewDocument);
const standalone = window.ReactiveMD.mount(document.getElementById('standalone')!, { source, state });
// The standalone IIFE owns a separate React copy. Give the host root its own
// useId namespace so labels cannot resolve controls in the other React root.
createRoot(document.getElementById('react')!, { identifierPrefix: 'release-reference-' }).render(
  <LocalDocumentView document={viewDocument} runtime={runtime} />,
);

let importedCount = 0;
window.releaseHarness = {
  ready: true,
  standalone,
  exportReact: () => exportLocalState(runtime, generator),
  importState: (imported: LocalStateFile) => {
    const host = document.createElement('div');
    host.id = `imported-${++importedCount}`;
    host.className = 'imported-document';
    document.getElementById('imported')!.append(host);
    return window.ReactiveMD.mount(host, { source, state: imported }).getState();
  },
};
