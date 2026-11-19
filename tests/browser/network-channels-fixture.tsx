import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createReactHost, LocalReactiveDocument, defineReactComponentPackage } from '../../src/react/minimal';
import networkPlugin from '../../src/components/plugins/network';
import { httpSubmit, sseStream } from '../../src/runtime-services/browser/http-sse';
import type { NetworkConfig } from '../../src/runtime-services/network';
import '../../src/styles.css';

const results = defineReactComponentPackage({
  id: 'example/network-smoke-results',
  name: 'smoke-results',
  version: '1.0.0',
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  props: { label: { kind: 'string' } },
  render({ services, props, visible }) {
    const [data, setData] = useState('waiting');
    const network = services.network;
    useEffect(() => {
      if (!visible || !network?.supports('results', 'subscribe')) {
        setData('offline');
        return;
      }
      setData('waiting');
      return network.subscribe('results', event => {
        if (event.type === 'data') setData(String(event.value));
      });
    }, [network, visible]);
    return <output aria-label={String(props.label)}>{data}</output>;
  },
});

const receipt = defineReactComponentPackage({
  id: 'example/network-smoke-receipt',
  name: 'smoke-receipt',
  version: '1.0.0',
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  render({ services, runtime }) {
    const [id, setId] = useState('');
    const network = services.network;
    return <>
      <button type="button" disabled={!network?.supports('answers', 'submit')} onClick={async () => {
        const fields = runtime.readSubmissionFields?.(['choice', 'comment']);
        if (!network || !fields?.ok) return;
        const result = await network.submit('answers', fields.payload);
        if (result.ok && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
          const data = result.data as { registrationId?: unknown };
          if (Object.keys(data).length === 1 && typeof data.registrationId === 'string') setId(data.registrationId);
        }
      }}>Send and show receipt</button>
      <output aria-label="Registration receipt">{id}</output>
    </>;
  },
});

const host = createReactHost({ presets: ['default', networkPlugin], packages: [results, receipt] });
const network = { channels: {
  answers: { submit: httpSubmit({
    endpoint: '/__answers',
    validate: data => Object.keys(data).length === 2 && typeof data.choice === 'string' && typeof data.comment === 'string',
    interpret: response => {
      if (!response.ok || !response.text) return undefined;
      const { registrationId } = JSON.parse(response.text) as { registrationId?: unknown };
      if (typeof registrationId === 'string' && /^R-\d+$/.test(registrationId)) {
        return { ok: true, data: { registrationId } };
      }
    },
  }) },
  results: { subscribe: sseStream({ endpoint: '/__results', validate: value => typeof value === 'number' }) },
} };
const mappedNetwork: NetworkConfig = { channels: {
  ...network.channels,
  results: {
    ...network.channels.results,
    mapExternalValues: value => typeof value === 'number' ? { votesYes: value, votesNo: 2 } : undefined,
  },
} };
const initialExternals = { votesYes: 0, votesNo: 0 };

const fields = [
  '<external name="votesYes" type="number">',
  '<external name="votesNo" type="number">',
  '<computed name="votesTotal" value="{{ votesYes + votesNo }}">',
  '<input bind="choice" label="Choice" required="true" min-length="3">',
  '<textarea bind="comment" label="Comment">',
  '<input bind="extra" label="Extra">',
  '<submit-button channel="answers" fields="choice comment" label="Send">',
  '<smoke-receipt>',
  '',
  'Mapped votes: {{ votesTotal }}',
  '',
  '<if when="{{ votesTotal > 0 }}">',
  'Live voting data',
  '</if>',
].join('\n');

function App() {
  const [authorized, setAuthorized] = useState(false);
  const [mapped, setMapped] = useState(false);
  const [one, setOne] = useState(true);
  const [two, setTwo] = useState(true);
  const [copy, setCopy] = useState('');
  const [identity, setIdentity] = useState('A');
  const source = [
    fields,
    one && '<smoke-results label="First count">',
    two && '<smoke-results label="Second count">',
    copy,
  ].filter(Boolean).join('\n\n');
  return <>
    <button onClick={() => setAuthorized(!authorized)}>Toggle authorization</button>
    <button onClick={() => setMapped(!mapped)}>Toggle mapping</button>
    <button onClick={() => setOne(!one)}>Toggle first</button>
    <button onClick={() => setTwo(!two)}>Toggle second</button>
    <button onClick={() => setCopy('Extra prose')}>Edit source</button>
    <button onClick={() => setIdentity('B')}>Switch document</button>
    <LocalReactiveDocument
      source={source}
      documentId={identity}
      network={authorized ? (mapped ? mappedNetwork : network) : undefined}
      externalValues={initialExternals}
      reactConfig={host.reactConfig}
      staticFirst
    />
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
