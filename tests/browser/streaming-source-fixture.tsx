import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument, type LocalReactiveDocumentProps } from 'reactive-md/react/minimal';
import type { LocalTraceEvent } from 'reactive-md/observability';
import 'reactive-md/styles.css';

/**
 * Browser acceptance fixture for `LocalReactiveDocument` streaming sources.
 * It models a host that receives out-of-order snapshots: each generation owns
 * a token, and a late snapshot from an older generation must be discarded
 * without touching the rendered document.
 */
type Phase = 'streaming' | 'final';
type DiagnosticList = Parameters<NonNullable<LocalReactiveDocumentProps['onTransientDiagnostics']>>[0];
type ParameterValues = Parameters<NonNullable<LocalReactiveDocumentProps['onParametersChange']>>[0];

// The tail is mid-component and mid-interpolation until the final snapshot.
const PARTIAL = [
  '<panel title="Plan">',
  '<number bind="amount" label="Amount" initial="2">',
  '',
  'Amount: {{ amount }}',
].join('\n');
const COMPLETE = `${PARTIAL}\n</panel>`;
const EXTENDED_PARTIAL = `${COMPLETE}\n\n<card title="Still writing">\n\nTail {{ 1 +`;
const EXTENDED_COMPLETE = `${COMPLETE}\n\n<card title="Finished">\n\nTail {{ 1 + 2 }}.\n\n</card>`;
const REPLACEMENT = '<number bind="amount" label="Revised amount" initial="1">\n\nRevised: {{ amount }}';

interface FixtureState {
  source: string;
  phase: Phase;
  documentId: string;
  visible: boolean;
}

interface Probe {
  renders: number;
  phase: Phase;
  documentId: string;
  visible: boolean;
  transientCalls: number;
  transientCodes: string[][];
  diagnosticsCalls: number;
  diagnosticsCodes: string[][];
  parameterCalls: number;
  lastParameters: Record<string, unknown>;
  stale: number;
  traces: LocalTraceEvent[];
}

declare global {
  interface Window {
    streamingHarness: {
      begin(): void;
      finish(): void;
      extend(): void;
      finishExtended(): void;
      queueStale(): void;
      replace(): void;
      unmount(): void;
    };
    streamingProbe: Probe;
  }
}

const probe: Probe = {
  renders: 0,
  phase: 'streaming',
  documentId: 'first',
  visible: true,
  transientCalls: 0,
  transientCodes: [],
  diagnosticsCalls: 0,
  diagnosticsCodes: [],
  parameterCalls: 0,
  lastParameters: {},
  stale: 0,
  traces: [],
};
window.streamingProbe = probe;
const observer = { onTrace: (event: LocalTraceEvent) => probe.traces.push(event) };

function marker(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element !== null) element.textContent = text;
}

function codesText(codes: readonly string[] | undefined): string {
  return codes && codes.length ? codes.join(', ') : 'none';
}

function App() {
  const [state, setState] = useState<FixtureState>({
    source: PARTIAL,
    phase: 'streaming',
    documentId: 'first',
    visible: true,
  });
  const generation = useRef(0);
  const renders = useRef(0);
  const stale = useRef(0);
  renders.current += 1;
  probe.renders = renders.current;
  probe.phase = state.phase;
  probe.documentId = state.documentId;
  probe.visible = state.visible;

  const apply = (next: Partial<FixtureState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  };
  const recordTransient = (diagnostics: DiagnosticList): void => {
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    probe.transientCalls += 1;
    probe.transientCodes.push(codes);
    marker('transient-calls', String(probe.transientCalls));
    marker('transient-last', codesText(codes));
  };
  const recordDiagnostics = (diagnostics: DiagnosticList): void => {
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    probe.diagnosticsCalls += 1;
    probe.diagnosticsCodes.push(codes);
    marker('diagnostics-calls', String(probe.diagnosticsCalls));
    marker('diagnostics-last', codesText(codes));
  };
  const recordParameters = (values: ParameterValues): void => {
    probe.parameterCalls += 1;
    probe.lastParameters = { ...values };
    marker('parameters', JSON.stringify(probe.lastParameters));
  };

  window.streamingHarness = {
    begin(): void {
      generation.current += 1;
      apply({ source: PARTIAL, phase: 'streaming', documentId: 'first', visible: true });
    },
    finish(): void {
      generation.current += 1;
      apply({ source: COMPLETE, phase: 'final', documentId: 'first', visible: true });
    },
    extend(): void {
      generation.current += 1;
      apply({ source: EXTENDED_PARTIAL, phase: 'streaming', documentId: 'first' });
    },
    finishExtended(): void {
      generation.current += 1;
      apply({ source: EXTENDED_COMPLETE, phase: 'final', documentId: 'first' });
    },
    queueStale(): void {
      // A snapshot from the current generation arrives only after the final
      // snapshot of that generation; the host must discard it.
      const token = generation.current;
      window.setTimeout(() => {
        if (token !== generation.current) {
          stale.current += 1;
          probe.stale = stale.current;
          marker('stale', String(stale.current));
          return;
        }
        apply({ source: PARTIAL, phase: 'streaming', documentId: 'first' });
      }, 60);
    },
    replace(): void {
      generation.current += 1;
      apply({ source: REPLACEMENT, phase: 'final', documentId: 'second' });
    },
    unmount(): void {
      generation.current += 1;
      apply({ visible: false });
    },
  };

  return (
    <main>
      <header id="probe">
        <p>phase: <span id="phase">{state.phase}</span></p>
        <p>document: <span id="doc">{state.documentId}</span></p>
        <p>renders: <span id="renders">{renders.current}</span></p>
        <p>transient calls: <span id="transient-calls">{probe.transientCalls}</span></p>
        <p>transient last: <span id="transient-last">{codesText(probe.transientCodes.at(-1))}</span></p>
        <p>diagnostics calls: <span id="diagnostics-calls">{probe.diagnosticsCalls}</span></p>
        <p>diagnostics last: <span id="diagnostics-last">{codesText(probe.diagnosticsCodes.at(-1))}</span></p>
        <p>parameters: <span id="parameters">{probe.parameterCalls ? JSON.stringify(probe.lastParameters) : 'none'}</span></p>
        <p>stale discarded: <span id="stale">{probe.stale}</span></p>
      </header>
      <section id="document">
        {state.visible ? (
          <LocalReactiveDocument
            source={state.source}
            sourcePhase={state.phase}
            documentId={state.documentId}
            stableComponentKeys
            trace={{ observer, traceId: `stream-${state.documentId}`, documentId: state.documentId, sourceRevision: generation.current }}
            onTransientDiagnostics={recordTransient}
            onDiagnostics={recordDiagnostics}
            onParametersChange={recordParameters}
          />
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
