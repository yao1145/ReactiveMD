import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  compileLatex,
  compileLocal,
  createLocalRuntime,
  samplePlot,
} from 'reactive-md';
import type { LocalDocument, LocalNode, LocalRuntime } from 'reactive-md';
import { LocalDocumentView } from 'reactive-md/react';
import 'reactive-md/styles.css';

const SECTIONS = 100;
const PLOT_MIN = -10;
const PLOT_MAX = 10;
const PLOT_SAMPLES = 200;
const PLOT_FORMULAS = [
  String.raw`n\sin x`,
  String.raw`x^2 / 10 + k`,
  String.raw`\frac{1}{x - 0.09}`,
];
const PLOT_LIMIT = 2_000_000;
const UPDATE_BATCH = 1000;
const PLOT_BATCH = 20;
const WARMUPS = 5;
const LOCALITY_WRITES = [
  { bind: 'n', label: 'locality:100-sections', referencingSections: SECTIONS },
  { bind: 'm', label: 'locality:1-section', referencingSections: 1 },
  { bind: 'z', label: 'locality:unreferenced', referencingSections: 0 },
] as const;

interface MountedSample {
  totalMs: number;
  writeMs: number;
  reactMs: number;
  layoutMs: number;
}

interface StageBenchResult {
  config: {
    sections: number;
    sourceCharacters: number;
    textSourceCharacters: number;
    plotCurves: number;
    samplesPerCurve: number;
    plotRange: [number, number];
    updatesPerSample: number;
    plotsPerSample: number;
    iterations: number;
    localityFootprint: { bind: string; label: string; referencingSections: number }[];
  };
  compileMs: number[];
  updateMsPerWrite: number[];
  plotMsPerPlot: number[];
  render: { samples: MountedSample[]; documentCharacters: number };
  interaction: { samples: MountedSample[]; documentCharacters: number };
  locality: {
    documentCharacters: number;
    streams: { label: string; samples: MountedSample[] }[];
  };
}

declare global {
  interface Window {
    stageBench: {
      ready: boolean;
      run(iterations: number): Promise<StageBenchResult>;
    };
  }
}

function articleSource(sections: number, withPlot: boolean): string {
  const body = Array.from(
    { length: sections },
    (_, index) =>
      `## Section ${index + 1}\n\nA local document with **Markdown**, a computed value {{ n * ${index + 1} }}, and ordinary explanatory text.\n\n- Read the value\n- Adjust the parameter\n`,
  ).join('\n');
  const plot = withPlot
    ? `## Curves\n\n<plot min="${PLOT_MIN}" max="${PLOT_MAX}" label="Stage curves" x-label="x" y-label="y">\n${PLOT_FORMULAS.map((formula) => `$$ y = ${formula} $$`).join('\n')}\n</plot>\n\nA second computed value: {{ n + k }}.\n`
    : '';
  return `<slider bind="n" label="Parameter" initial="2" min="0" max="100">\n<slider bind="k" label="Offset" initial="1" min="0" max="20">\n\n# Stage benchmark\n\n${body}${plot}`;
}

function localitySource(sections: number): string {
  const sliders = [
    '<slider bind="n" label="Parameter" initial="2" min="0" max="100">',
    '<slider bind="k" label="Offset" initial="1" min="0" max="20">',
    '<slider bind="m" label="Isolated" initial="2" min="0" max="100">',
    '<slider bind="z" label="Unused" initial="2" min="0" max="100">',
  ].join('\n');
  const body = Array.from(
    { length: sections },
    (_, index) =>
      `## Section ${index + 1}\n\nA local document with **Markdown**, a computed value {{ n * ${index + 1} }}${index === sections - 1 ? ', an isolated value {{ m }}' : ''}, and ordinary explanatory text.\n\n- Read the value\n- Adjust the parameter\n`,
  ).join('\n');
  return `${sliders}\n\n# Stage benchmark\n\n${body}`;
}

function compileDocument(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

function sliderNode(doc: LocalDocument) {
  const node = doc.nodes.find((candidate) => candidate.name === 'slider');
  if (!node) throw new Error('benchmark document has no slider');
  return node;
}

function sliderByBind(doc: LocalDocument, bind: string): LocalNode {
  const node = doc.nodes.find(
    (candidate) => candidate.name === 'slider' && candidate.attrs?.bind === bind,
  );
  if (!node) throw new Error(`benchmark document has no slider bound to "${bind}"`);
  return node;
}

function measureCompile(source: string, iterations: number): number[] {
  for (let index = 0; index < WARMUPS; index += 1) compileDocument(source);
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    compileDocument(source);
    samples.push(performance.now() - started);
  }
  return samples;
}

function measureUpdate(doc: LocalDocument, iterations: number): number[] {
  const runtime: LocalRuntime = createLocalRuntime(doc);
  const unsubscribe = runtime.subscribe(() => {});
  try {
    const node = sliderNode(doc);
    let value = 3;
    let writes = 0;
    const write = () => {
      value = (value + 1) % 101;
      const diagnostics = runtime.set(node, value);
      if (diagnostics.length > 0) throw new Error(JSON.stringify(diagnostics));
      writes += 1;
    };
    for (let index = 0; index < WARMUPS * UPDATE_BATCH; index += 1) write();
    const samples: number[] = [];
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      for (let writeIndex = 0; writeIndex < UPDATE_BATCH; writeIndex += 1) write();
      samples.push((performance.now() - started) / UPDATE_BATCH);
    }
    if (runtime.snapshot().revision !== writes) {
      throw new Error('runtime did not commit every benchmark write');
    }
    return samples;
  } finally {
    unsubscribe();
    runtime.dispose();
  }
}

function measurePlot(iterations: number): number[] {
  const environment = { n: 2, k: 1 };
  const sampleOnce = () => {
    const budget = { steps: 0, limit: PLOT_LIMIT };
    for (const formula of PLOT_FORMULAS) {
      const expression = compileLatex(formula);
      const result = samplePlot(
        expression,
        environment,
        PLOT_MIN,
        PLOT_MAX,
        PLOT_SAMPLES,
        budget,
      );
      if (result.points.length < PLOT_SAMPLES) throw new Error('plot undersampled');
    }
  };
  for (let index = 0; index < WARMUPS * PLOT_BATCH; index += 1) sampleOnce();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    for (let plotIndex = 0; plotIndex < PLOT_BATCH; plotIndex += 1) sampleOnce();
    samples.push((performance.now() - started) / PLOT_BATCH);
  }
  return samples;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function makeUpdater(
  host: HTMLElement,
  runtime: LocalRuntime,
  node: LocalNode,
): () => MountedSample {
  let value = 3;
  return (): MountedSample => {
    value = (value + 1) % 101;
    const started = performance.now();
    let writeMs = 0;
    flushSync(() => {
      const writeStarted = performance.now();
      const diagnostics = runtime.set(node, value);
      writeMs = performance.now() - writeStarted;
      if (diagnostics.length > 0) throw new Error(JSON.stringify(diagnostics));
    });
    const committed = performance.now();
    void host.getBoundingClientRect();
    const ended = performance.now();
    return {
      totalMs: ended - started,
      writeMs,
      reactMs: committed - started - writeMs,
      layoutMs: ended - committed,
    };
  };
}

function fillStageHost(): { host: HTMLElement; root: ReturnType<typeof createRoot> } {
  const host = document.createElement('div');
  host.style.width = '1200px';
  document.getElementById('stage-host')!.append(host);
  return { host, root: createRoot(host) };
}

async function mountView(host: HTMLElement, doc: LocalDocument, runtime: LocalRuntime, root: ReturnType<typeof createRoot>): Promise<void> {
  flushSync(() => {
    root.render(
      <LocalDocumentView
        document={doc}
        runtime={runtime}
        colorScheme="light"
      />,
    );
  });
  await document.fonts.ready;
  await nextFrame();
  await nextFrame();
}

async function measureMounted(
  doc: LocalDocument,
  iterations: number,
): Promise<MountedSample[]> {
  const runtime = createLocalRuntime(doc);
  const node = sliderNode(doc);
  const { host, root } = fillStageHost();
  const update = makeUpdater(host, runtime, node);
  try {
    await mountView(host, doc, runtime, root);
    for (let index = 0; index < WARMUPS; index += 1) {
      update();
      await nextFrame();
    }
    const samples: MountedSample[] = [];
    for (let index = 0; index < iterations; index += 1) {
      samples.push(update());
      await nextFrame();
    }
    return samples;
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    runtime.dispose();
    await nextFrame();
  }
}

async function measureLocality(
  doc: LocalDocument,
  iterations: number,
): Promise<{ label: string; samples: MountedSample[] }[]> {
  const runtime = createLocalRuntime(doc);
  const { host, root } = fillStageHost();
  const streams = LOCALITY_WRITES.map((entry) => ({
    label: entry.label,
    update: makeUpdater(host, runtime, sliderByBind(doc, entry.bind)),
    samples: [] as MountedSample[],
  }));
  try {
    await mountView(host, doc, runtime, root);
    // Forward and reverse passes keep per-stream drift out of the comparison.
    for (const order of [streams, [...streams].reverse()]) {
      for (const stream of order) {
        for (let index = 0; index < WARMUPS; index += 1) {
          stream.update();
          await nextFrame();
        }
        for (let index = 0; index < iterations; index += 1) {
          stream.samples.push(stream.update());
          await nextFrame();
        }
      }
    }
    return streams.map(({ label, samples }) => ({ label, samples }));
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    runtime.dispose();
    await nextFrame();
  }
}

async function run(iterations: number): Promise<StageBenchResult> {
  const plotSource = articleSource(SECTIONS, true);
  const textSource = articleSource(SECTIONS, false);
  const localityCode = localitySource(SECTIONS);
  const compileMs = measureCompile(plotSource, iterations);
  const plotDocument = compileDocument(plotSource);
  const updateMsPerWrite = measureUpdate(plotDocument, iterations);
  const plotMsPerPlot = measurePlot(iterations);
  const textDocument = compileDocument(textSource);
  const renderSamples = await measureMounted(textDocument, iterations);
  const interactionSamples = await measureMounted(plotDocument, iterations);
  const localityDocument = compileDocument(localityCode);
  const localityStreams = await measureLocality(localityDocument, iterations);
  return {
    config: {
      sections: SECTIONS,
      sourceCharacters: plotSource.length,
      textSourceCharacters: textSource.length,
      plotCurves: PLOT_FORMULAS.length,
      samplesPerCurve: PLOT_SAMPLES,
      plotRange: [PLOT_MIN, PLOT_MAX],
      updatesPerSample: UPDATE_BATCH,
      plotsPerSample: PLOT_BATCH,
      iterations,
      localityFootprint: LOCALITY_WRITES.map((entry) => ({
        bind: entry.bind,
        label: entry.label,
        referencingSections: entry.referencingSections,
      })),
    },
    compileMs,
    updateMsPerWrite,
    plotMsPerPlot,
    render: { samples: renderSamples, documentCharacters: textSource.length },
    interaction: {
      samples: interactionSamples,
      documentCharacters: plotSource.length,
    },
    locality: {
      documentCharacters: localityCode.length,
      streams: localityStreams,
    },
  };
}

window.stageBench = { ready: true, run };
