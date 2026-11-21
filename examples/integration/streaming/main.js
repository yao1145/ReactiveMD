import { LocalCompileScheduler } from 'reactive-md';

const sourceOutput = document.getElementById('source');
const statusOutput = document.getElementById('status');
const transientOutput = document.getElementById('transient');
const diagnosticsOutput = document.getElementById('diagnostics');
const previewOutput = document.getElementById('preview');
const staleOutput = document.getElementById('stale');
const startButton = document.getElementById('start');
const cancelButton = document.getElementById('cancel');

const CHUNK_DELAY_MS = 700;
const COMPILE_OPTIONS = { strict: true };
// The fixed chunks grow the document locally. Several intermediate snapshots
// contain an unclosed panel or slider, so the streaming result must expose a
// readable prefix and provisional diagnostics.
const CHUNKS = [
  '# Streaming snapshots\n\n',
  'This page appends fixed text chunks on a timer. ',
  'The host submits each complete snapshot with `sourcePhase: "streaming"`.\n\n',
  '<panel title="Still generating">\n',
  '<slider bind="people" label="People" initial="2" min="1" max="20">\n',
  'Estimated cost: **{{ people * 100 }} USD**.\n\n',
  '</panel>\n\n',
  'The last snapshot is compiled with `sourcePhase: "final"`.\n',
];

let activeRun = 0;
let runNumber = 0;
let timer = null;
let chunkIndex = 0;
let text = '';
let finished = false;
let staleCount = 0;
const snapshotOwners = new Map();

function formatDiagnostics(list) {
  return list && list.length
    ? list.map((diagnostic) => `${diagnostic.line}:${diagnostic.column} ${diagnostic.code}: ${diagnostic.message}`).join('\n')
    : 'None.';
}

function documentTitle(document) {
  const heading = document.nodes.find((node) => node.type === 'heading');
  return heading
    ? (heading.children ?? []).map((child) => child.value ?? '').join('') || 'Untitled'
    : 'Untitled';
}

function summarize(result) {
  if (!result.ok) return 'No document: the snapshot reported a deterministic failure.';
  const document = result.document;
  const bindings = Object.keys(document.bindings);
  return [
    `Status: ${result.status ?? 'legacy'}`,
    `Title: ${documentTitle(document)}`,
    `Nodes: ${document.nodes.length}`,
    `Bindings: ${bindings.length ? bindings.join(', ') : 'none'}`,
  ].join('\n');
}

function modeLabel(mode) {
  return mode === 'worker' ? 'a Worker' : 'the main-thread fallback';
}

function updateStale() {
  staleOutput.textContent = `${staleCount} stale result${staleCount === 1 ? '' : 's'} discarded.`;
}

function showOutcome(outcome) {
  // A generation only accepts results for the run that submitted this exact
  // snapshot. Cancel and restart invalidate earlier runs, so a late result is
  // counted and ignored instead of repainting the page.
  if (snapshotOwners.get(outcome.source) !== activeRun) {
    staleCount += 1;
    updateStale();
    return;
  }

  const { result, sourcePhase, duration, mode } = outcome;
  const phase = sourcePhase ?? 'final';
  const status = result.status ?? (result.ok ? 'valid' : 'failed');

  if (phase === 'streaming') {
    statusOutput.textContent = [
      `Streaming snapshot: ${status}`,
      `${outcome.source.length} chars in ${duration} ms on ${modeLabel(mode)}`,
    ].join(' · ');
    transientOutput.textContent = formatDiagnostics(result.transientDiagnostics);
    diagnosticsOutput.textContent = result.ok
      ? 'Final diagnostics arrive with the final snapshot.'
      : formatDiagnostics(result.diagnostics);
    previewOutput.textContent = summarize(result);
    return;
  }

  finished = true;
  statusOutput.textContent = [
    `Final snapshot: ${status}`,
    `${outcome.source.length} chars in ${duration} ms on ${modeLabel(mode)}`,
  ].join(' · ');
  transientOutput.textContent = 'None.';
  diagnosticsOutput.textContent = formatDiagnostics(result.diagnostics);
  previewOutput.textContent = summarize(result);
}

const scheduler = new LocalCompileScheduler({
  createWorker: () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
  onResult: showOutcome,
  onModeChange: (mode, detail) => {
    if (mode === 'fallback' && detail) console.info('Compile mode fallback:', detail);
  },
});

function submit(snapshot, sourcePhase) {
  snapshotOwners.set(snapshot, activeRun);
  scheduler.schedule(snapshot, COMPILE_OPTIONS, undefined, sourcePhase);
}

function stopTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function pump(run) {
  if (run !== activeRun) return;
  if (chunkIndex >= CHUNKS.length) {
    submit(text, 'final');
    return;
  }
  text += CHUNKS[chunkIndex];
  chunkIndex += 1;
  sourceOutput.textContent = text;
  submit(text, 'streaming');
  timer = setTimeout(() => {
    timer = null;
    pump(run);
  }, CHUNK_DELAY_MS);
}

function startGeneration() {
  stopTimer();
  activeRun += 1;
  runNumber += 1;
  chunkIndex = 0;
  text = '';
  finished = false;
  sourceOutput.textContent = '';
  transientOutput.textContent = 'None.';
  diagnosticsOutput.textContent = 'None.';
  previewOutput.textContent = 'Waiting for the first snapshot.';
  statusOutput.textContent = `Generation ${runNumber}: submitting snapshots...`;
  pump(activeRun);
}

function cancelGeneration() {
  if (finished) {
    statusOutput.textContent = 'Generation already finished. Use Start / restart to run it again.';
    return;
  }
  stopTimer();
  // Invalidate the current run without scheduling a replacement. If a compile
  // is still in flight, its result will be dropped by showOutcome.
  activeRun += 1;
  statusOutput.textContent = 'Generation cancelled. Late results are discarded.';
}

startButton.addEventListener('click', startGeneration);
cancelButton.addEventListener('click', cancelGeneration);
window.addEventListener('beforeunload', () => scheduler.dispose());

updateStale();
startGeneration();