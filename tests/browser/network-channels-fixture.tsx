import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createReactHost, LocalReactiveDocument, defineReactComponentPackage } from '../../src/react/minimal';
import networkPlugin from '../../src/components/plugins/network';
import { httpSubmit, sseStream } from '../../src/runtime-services/browser/http-sse';
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

const host = createReactHost({ presets: ['default', networkPlugin], packages: [results] });
const network = { channels: {
  answers: { submit: httpSubmit({
    endpoint: '/__answers',
    validate: data => Object.keys(data).length === 2 && typeof data.choice === 'string' && typeof data.comment === 'string',
  }) },
  results: { subscribe: sseStream({ endpoint: '/__results', validate: value => typeof value === 'number' }) },
} };

const fields = [
  '<input bind="choice" label="Choice" required="true" min-length="3">',
  '<textarea bind="comment" label="Comment">',
  '<input bind="extra" label="Extra">',
  '<submit-button channel="answers" fields="choice comment" label="Send">',
].join('\n');

function App() {
  const [authorized, setAuthorized] = useState(false);
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
    <button onClick={() => setOne(!one)}>Toggle first</button>
    <button onClick={() => setTwo(!two)}>Toggle second</button>
    <button onClick={() => setCopy('Extra prose')}>Edit source</button>
    <button onClick={() => setIdentity('B')}>Switch document</button>
    <LocalReactiveDocument
      source={source}
      documentId={identity}
      network={authorized ? network : undefined}
      reactConfig={host.reactConfig}
      staticFirst
    />
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
