import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument, type LocalColorScheme } from 'reactive-md/react';
import 'reactive-md/styles.css';
import '../src/tokens.css';
import '../src/components.css';
import './demo.css';
import source from './document.reactive.md?raw';
import { sciFiTheme } from '../src/theme';

const SWATCHES = [
  { token: '--surface', label: 'SURFACE' },
  { token: '--surface-subtle', label: 'SUBTLE' },
  { token: '--line-strong', label: 'LINE' },
  { token: '--accent', label: 'ACCENT' },
  { token: '--accent-text', label: 'SIGNAL' },
  { token: '--success', label: 'SUCCESS' },
  { token: '--warning', label: 'WARNING' },
  { token: '--danger', label: 'DANGER' },
];

const TYPE_ROWS = [
  { className: 'sf-type-display', sample: 'Aa', label: 'DISPLAY / 30' },
  { className: 'sf-type-title', sample: 'Aa', label: 'TITLE / 20' },
  { className: 'sf-type-body', sample: 'Aa', label: 'BODY / 15' },
  { className: 'sf-type-data', sample: '0x41', label: 'DATA / MONO' },
];

const STATES = [
  { className: 'is-default', label: 'DEFAULT', note: '1px line' },
  { className: 'is-hover', label: 'HOVER', note: 'accent stroke' },
  { className: 'is-focus', label: 'FOCUS', note: '2px outline' },
  { className: 'is-selected', label: 'SELECTED', note: 'left signal' },
  { className: 'is-disabled', label: 'DISABLED', note: 'hatch / 38%' },
];

function SchemeToggle({ value, onChange }: { value: 'light' | 'dark'; onChange: (value: 'light' | 'dark') => void }) {
  return (
    <div className="sf-scheme" role="group" aria-label="Color scheme">
      {(['light', 'dark'] as const).map((scheme) => (
        <button
          key={scheme}
          type="button"
          data-scheme={scheme}
          aria-pressed={value === scheme}
          onClick={() => onChange(scheme)}
        >
          {scheme.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [scheme, setScheme] = useState<'light' | 'dark'>('dark');
  const [diagnostics, setDiagnostics] = useState(0);

  const onDiagnostics = useCallback((items: readonly { severity: string }[]) => {
    setDiagnostics(items.length);
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);

  const colorScheme: LocalColorScheme = scheme;

  return (
    <div className="sf-app" data-rmd-theme="sci-fi" data-color-scheme={scheme}>
      <header className="sf-topbar">
        <div className="sf-brand">
          <span className="sf-brand-mark" aria-hidden="true">SF</span>
          <span className="sf-brand-text">
            <span className="sf-brand-name">Reactive / MD</span>
            <span className="sf-brand-sub">Theme system · SF-01</span>
          </span>
        </div>

        <div className="sf-status-strip" aria-hidden="true">
          <span className="sf-status"><span>Mode</span><strong>{scheme}</strong></span>
          <span className="sf-status"><span>Grid</span><strong>12 / 4px</strong></span>
          <span className="sf-status"><span>Radius</span><strong>0–4px</strong></span>
          <span className="sf-status"><span>Contrast</span><strong>AA</strong></span>
          <span className="sf-status"><span>Diagnostics</span><strong>{String(diagnostics).padStart(2, '0')}</strong></span>
        </div>

        <SchemeToggle value={scheme} onChange={setScheme} />
      </header>

      <main className="sf-shell">
        <aside className="sf-rail" aria-label="Design system index">
          <div className="sf-rail-head">
            <span className="sf-kicker">Spec sheet</span>
            <span className="sf-rail-index">01–06</span>
          </div>

          <section className="sf-rail-block">
            <h2 className="sf-rail-title"><span>01</span> Palette</h2>
            <ul className="sf-swatches">
              {SWATCHES.map((item) => (
                <li key={item.token}>
                  <span className="sf-swatch" style={{ background: `var(${item.token})` }} aria-hidden="true" />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="sf-rail-block">
            <h2 className="sf-rail-title"><span>02</span> Type</h2>
            <ul className="sf-type-list">
              {TYPE_ROWS.map((row) => (
                <li key={row.label}>
                  <span className={row.className}>{row.sample}</span>
                  <span>{row.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="sf-rail-block">
            <h2 className="sf-rail-title"><span>03</span> Grid</h2>
            <div className="sf-grid-meter" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
            </div>
            <p className="sf-rail-note">12 columns · 4px unit · 16px gutter · 1px rules</p>
          </section>

          <section className="sf-rail-block">
            <h2 className="sf-rail-title"><span>04</span> States</h2>
            <ul className="sf-state-list">
              {STATES.map((state) => (
                <li key={state.label}>
                  <span className={`sf-state-chip ${state.className}`} aria-hidden="true" />
                  <span className="sf-state-name">{state.label}</span>
                  <span className="sf-state-note">{state.note}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="sf-rail-block">
            <h2 className="sf-rail-title"><span>05</span> Rules</h2>
            <p className="sf-rail-note">Rectangles only. 1px structural borders. 2px signal rules. No blurred elevation.</p>
          </section>

          <footer className="sf-rail-foot">
            <span>SF-01</span>
            <span>v1.0.0</span>
          </footer>
        </aside>

        <section className="sf-stage">
          <div className="sf-chassis">
            <div className="sf-chassis-head">
              <span>Doc / live instance</span>
              <span className="sf-live"><span aria-hidden="true" />Live</span>
            </div>
            <LocalReactiveDocument
              source={source}
              themes={[sciFiTheme]}
              colorScheme={colorScheme}
              locale="en"
              onDiagnostics={onDiagnostics}
            />
          </div>
          <div className="sf-stage-foot">
            <span>Theme · sci-fi</span>
            <span>Tokens · 3 layers</span>
            <span>Scheme · {scheme}</span>
            <span>Source · document.reactive.md</span>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
