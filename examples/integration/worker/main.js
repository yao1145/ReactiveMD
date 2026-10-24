import { LocalCompileScheduler } from 'reactive-md';

const editor = document.getElementById('source');
const status = document.getElementById('status');
const diagnostics = document.getElementById('diagnostics');
const preview = document.getElementById('preview');

const initialSource = `# Compile in a Worker

Edits are compiled off the main thread after a short debounce. Keep typing and the status below updates.

<slider bind="people" label="People" min="1" max="20">`;

editor.value = initialSource;

function createWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

function formatDiagnostics(list) {
  return list.length
    ? list.map((diagnostic) => `${diagnostic.line}:${diagnostic.column} ${diagnostic.code}: ${diagnostic.message}`).join('\n')
    : 'No diagnostics.';
}

function showResult(outcome) {
  const { result, duration, mode } = outcome;
  status.textContent = `Compiled in ${duration} ms (${mode})`;
  diagnostics.textContent = formatDiagnostics(result.diagnostics);
  if (!result.ok) {
    preview.textContent = 'No document';
    return;
  }
  const heading = result.document.nodes.find((node) => node.type === 'heading');
  const title = heading
    ? (heading.children ?? []).map((child) => child.value ?? '').join('') || 'Untitled'
    : 'Untitled';
  const bindings = Object.keys(result.document.bindings);
  preview.textContent = [
    `Title: ${title}`,
    `Nodes: ${result.document.nodes.length}`,
    `Bindings: ${bindings.length ? bindings.join(', ') : 'none'}`,
  ].join('\n');
}

const scheduler = new LocalCompileScheduler({
  createWorker,
  onResult: showResult,
  onPendingChange: (pending) => {
    if (pending) status.textContent = 'Compiling...';
  },
  onModeChange: (mode, detail) => {
    status.textContent = mode === 'worker'
      ? 'Compiling in a Worker...'
      : `Compiling on the main thread${detail ? ` (${detail})` : ''}`;
  },
});

editor.addEventListener('input', () => scheduler.schedule(editor.value));
window.addEventListener('beforeunload', () => scheduler.dispose());
scheduler.schedule(editor.value);
