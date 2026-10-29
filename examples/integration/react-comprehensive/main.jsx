import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const SOURCE = `<!-- reactive-md: local-draft-3 -->

<external name="exchangeRate" type="number">
<external name="inventory" type="number">

<panel title="Quote">
<host-rating bind="rating" label="Course rating" initial="4">
<number bind="quantity" label="Quantity" initial="2" min="1" max="{{ inventory }}">
<number bind="budget" label="Budget (CNY)" initial="600" min="1">
<number bind="unitUsd" label="Unit price (USD)" initial="129" min="1">
</panel>

<computed name="totalCny" value="{{ quantity * unitUsd * exchangeRate }}">
<computed name="withinBudget" value="{{ totalCny <= budget }}">

Rating: {{ rating }} / 5

Total: **{{ totalCny }} CNY**

<if when="{{ withinBudget }}">Within budget.</if>
<if when="{{ !withinBudget }}">Over budget. Lower the quantity or raise the budget.</if>
`;

const HOST_COMPONENTS = [
  {
    name: 'host-rating',
    form: 'leaf',
    props: { label: { kind: 'string' } },
    binding: { kind: 'number', min: 0, max: 5, step: 1 },
  },
];

const STORAGE_KEY = 'reactive-md-comprehensive-parameters';

function readSavedParameters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function RatingRenderer({ ctx }) {
  const value = typeof ctx.value === 'number' ? ctx.value : 0;
  return (
    <div className="host-rating">
      <span>{String(ctx.props.label ?? 'Rating')}</span>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={ctx.disabled}
          aria-pressed={value === star}
          onClick={() => ctx.setValue(star)}
        >
          {star <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [exchangeRate, setExchangeRate] = useState(7.2);
  const [inventory, setInventory] = useState(6);
  const [target, setTarget] = useState(null);
  const [instance, setInstance] = useState(0);
  const initialParameters = useMemo(readSavedParameters, [instance]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '0 auto', maxWidth: 900, padding: 24 }}>
      <h1>Reactive MD host example</h1>
      <p>
        The host supplies the exchange rate and inventory, saves reader parameters, and receives
        preview-to-source navigation targets.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" onClick={() => setExchangeRate(7.2)}>Rate 7.2</button>
        <button type="button" onClick={() => setExchangeRate(7.3)}>Rate 7.3</button>
        <label>
          Inventory <input type="number" min="1" max="20" value={inventory} onChange={(event) => setInventory(Number(event.target.value))} />
        </label>
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setInstance((value) => value + 1);
          }}
        >
          Reset saved parameters
        </button>
      </div>
      <p>
        Last source target:{' '}
        {target ? `${target.nodeType} ${target.componentName ?? ''} [${target.range.start}, ${target.range.end})` : 'click a paragraph or control label'}
      </p>
      <LocalReactiveDocument
        key={instance}
        source={SOURCE}
        compileOptions={{ hostComponents: HOST_COMPONENTS }}
        initialParameters={initialParameters}
        externalValues={{ exchangeRate, inventory }}
        onParametersChange={(parameters) => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parameters));
        }}
        onSourceNavigate={setTarget}
        hostRenderer={(_node, _data, ctx) => <RatingRenderer ctx={ctx} />}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
