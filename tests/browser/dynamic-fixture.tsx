import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/local/LocalDocumentView';
import type { LocalHostComponentSchema, LocalValue } from '../../src/local';
import type { LocalSourceTarget } from '../../src/local/render-types';
import '../../src/styles.css';

const SOURCE = [
  '<external name="exchangeRate" type="number">',
  '<external name="inventory" type="number">',
  '<panel title="Plan">',
  '<host-rating bind="rating" label="Course rating" initial="4">',
  '<number bind="rating" label="Numeric rating" min="0" max="5" step="1">',
  '<number bind="quantity" label="Quantity" initial="2" min="1" max="{{ inventory }}">',
  '<number bind="priceUsd" label="Unit price (USD)" initial="10" min="1">',
  '</panel>',
  '<computed name="priceCny" value="{{ quantity * priceUsd * exchangeRate }}">',
  '<number bind="guests" label="Guests" initial="6" min="1" max="{{ quantity * 4 }}">',
  '',
  'Rating: {{ rating }}',
  '',
  'Total: {{ priceCny }} CNY',
].join('\n');

const HOST_COMPONENTS: LocalHostComponentSchema[] = [
  {
    name: 'host-rating',
    form: 'leaf',
    props: { label: { kind: 'string' } },
    binding: { kind: 'number', min: 0, max: 5, step: 1 },
  },
];

function App() {
  const [externalValues, setExternalValues] = useState<Record<string, LocalValue>>({
    exchangeRate: 7.2,
    inventory: 6,
  });
  const [parameters, setParameters] = useState<Record<string, LocalValue>>({});
  const [calls, setCalls] = useState(0);
  const [target, setTarget] = useState<LocalSourceTarget | null>(null);

  return (
    <main>
      <div className="fixture-actions">
        <button type="button" onClick={() => setExternalValues((values) => ({ ...values, exchangeRate: 7.3 }))}>
          Rate 7.3
        </button>
        <button type="button" onClick={() => setExternalValues((values) => ({ ...values, inventory: 1 }))}>
          Inventory 1
        </button>
      </div>
      <p id="parameter-calls">{calls}</p>
      <p id="parameters">{JSON.stringify(parameters)}</p>
      <p id="target">{target ? `${target.nodeType}:${target.range.start}-${target.range.end}` : ''}</p>
      <LocalReactiveDocument
        source={SOURCE}
        compileOptions={{ hostComponents: HOST_COMPONENTS }}
        externalValues={externalValues}
        onParametersChange={(next) => {
          setParameters(next);
          setCalls((value) => value + 1);
        }}
        onSourceNavigate={setTarget}
        hostRenderer={(_node, _data, ctx) => (
          <div className="host-rating">
            <span>{String(ctx.props.label ?? 'Rating')}</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`${star} stars`}
                aria-pressed={ctx.value === star}
                disabled={ctx.disabled}
                onClick={() => ctx.setValue(star)}
              >
                {typeof ctx.value === 'number' && star <= ctx.value ? '★' : '☆'}
              </button>
            ))}
          </div>
        )}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
