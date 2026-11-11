import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument, type LocalColorScheme } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './demo.css';
import baseSource from './document.reactive.md?raw';
import { softThemeDefinition } from './soft-theme-definition';

type ThemeMode = 'default' | 'soft';

/**
 * `soft` is registration-only. It has no stylesheet of its own: the core
 * baseline in `reactive-md/styles.css` supplies the original appearance, so
 * the host only registers the definition. The built-in `default` needs no
 * registration.
 */

const SWATCHES = [
  { token: '--paper', label: 'Paper' },
  { token: '--surface', label: 'Surface' },
  { token: '--ink', label: 'Ink' },
  { token: '--line-strong', label: 'Line' },
  { token: '--accent', label: 'Accent' },
  { token: '--accent-soft', label: 'Accent soft' },
  { token: '--success', label: 'Success' },
  { token: '--warning', label: 'Warning' },
  { token: '--danger', label: 'Danger' },
];

const MOTION_SPEC = [
  { label: 'Dialog', value: 'scale .96' },
  { label: 'Popover', value: 'scale .98' },
  { label: 'Panel', value: '220ms' },
  { label: 'Toggle', value: '180ms' },
  { label: 'Counter pop', value: '160ms' },
  { label: 'Range thumb', value: '1.08 / 1.15' },
];

const COVERAGE = [
  'Light and dark semantic tokens',
  'Fields, textareas and selects',
  'Primary, secondary and quiet buttons',
  'Switch, checkbox, radio and range',
  'Tabs, steps and disclosures',
  'Badges, alerts and progress',
  'Dialog and popover motion',
];

function SchemeToggle({
  value,
  onChange,
}: {
  value: 'light' | 'dark';
  onChange: (value: 'light' | 'dark') => void;
}) {
  return (
    <div className="pu-scheme" role="group" aria-label="Color scheme">
      {(['light', 'dark'] as const).map((scheme) => (
        <button
          key={scheme}
          type="button"
          data-scheme={scheme}
          aria-pressed={value === scheme}
          onClick={() => onChange(scheme)}
        >
          {scheme === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}) {
  return (
    <div className="pu-scheme" role="group" aria-label="Theme">
      {(['default', 'soft'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          data-theme-mode={mode}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {mode === 'default' ? 'Default' : 'Soft'}
        </button>
      ))}
    </div>
  );
}

function OverlaysPanel({
  scheme,
  themeMode,
}: {
  scheme: 'light' | 'dark';
  themeMode: ThemeMode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <section className="pu-overlay-card" aria-labelledby="pu-overlay-title">
      <div className="pu-overlay-head">
        <div>
          <span className="pu-kicker">Overlays</span>
          <h2 id="pu-overlay-title">Dialog and popover</h2>
        </div>
        <span className="pu-note">scale .96 / .98</span>
      </div>

      <div
        className="md-document pu-overlay-body reactive-md-theme"
        data-rmd-theme={themeMode}
        data-color-scheme={scheme}
      >
        <p className="pu-overlay-copy">
          Native dialog and popover elements sit inside a themed document wrapper, so the
          current theme's surfaces, focus treatment and motion contract apply outside the
          rendered markdown document.
        </p>

        <div className="pu-overlay-actions">
          <button
            type="button"
            className="md-button-primary"
            onClick={() => dialogRef.current?.showModal()}
          >
            Open dialog
          </button>
          <button
            type="button"
            className="md-button-secondary"
            popoverTarget="pu-overlay-popover"
            popoverTargetAction="toggle"
          >
            Show popover
          </button>
        </div>

        <dialog ref={dialogRef} className="md-dialog pu-dialog" aria-labelledby="pu-dialog-title">
          <span className="pu-dialog-kicker">Overlay / dialog</span>
          <h3 id="pu-dialog-title">Publish this document?</h3>
          <p>
            The dialog enters from 96% scale over 220ms with the shared easing curve. Focus
            is trapped by the native modal behaviour and the primary action keeps the
            theme's accent fill.
          </p>
          <div className="pu-dialog-actions">
            <button
              type="button"
              className="md-button-secondary"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="md-button-primary"
              onClick={() => dialogRef.current?.close()}
            >
              Publish
            </button>
          </div>
        </dialog>

        <div id="pu-overlay-popover" popover="auto" className="md-popover pu-popover">
          <h3>Popover</h3>
          <p>
            Popovers enter from 98% scale. They keep the theme surface, card radius and
            elevation used by the rest of the document.
          </p>
          <div className="pu-popover-meta">
            <span className="pu-chip">220ms</span>
            <span className="pu-chip pu-chip-accent">ease-standard</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function App() {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [themeMode, setThemeMode] = useState<ThemeMode>('default');
  const [diagnostics, setDiagnostics] = useState(0);

  const onDiagnostics = useCallback((items: readonly { severity: string }[]) => {
    setDiagnostics(items.length);
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);

  const colorScheme: LocalColorScheme = scheme;
  const source = themeMode === 'soft' ? '<theme name="soft">\n\n' + baseSource : baseSource;

  return (
    <div
      className="pu-app reactive-md-theme"
      data-rmd-theme={themeMode}
      data-color-scheme={scheme}
    >
      <header className="pu-topbar">
        <div className="pu-brand">
          <span className="pu-mark" aria-hidden="true">PU</span>
          <div className="pu-brand-text">
            <span className="pu-wordmark">
              PRODUCT UI <span>/ PU-01</span>
            </span>
            <span className="pu-tagline">
              The built-in default theme: a product-UI design system with the motion-prompt{' '}
              <code>ui</code> pack. Switch to Soft for the original document look.
            </span>
          </div>
        </div>

        <div className="pu-top-meta" aria-hidden="true">
          <span className="pu-chip">v1.0.0</span>
          <span className="pu-chip pu-chip-live">
            <span className="pu-live-dot" />
            Live
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeToggle value={themeMode} onChange={setThemeMode} />
          <SchemeToggle value={scheme} onChange={setScheme} />
        </div>
      </header>

      <main className="pu-shell">
        <aside className="pu-rail" aria-label="Design system index">
          <div className="pu-rail-head">
            <span className="pu-kicker">Design index</span>
            <span className="pu-rail-no">PU-01</span>
          </div>

          <section className="pu-rail-block">
            <h2 className="pu-rail-title">Palette</h2>
            <ul className="pu-swatches">
              {SWATCHES.map((item) => (
                <li key={item.token}>
                  <span
                    className="pu-swatch"
                    style={{ background: `var(${item.token})` }}
                    aria-hidden="true"
                  />
                  <span className="pu-swatch-label">{item.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="pu-rail-block">
            <h2 className="pu-rail-title">Motion</h2>
            <ul className="pu-motion-list">
              {MOTION_SPEC.map((item) => (
                <li key={item.label}>
                  <span className="pu-motion-label">{item.label}</span>
                  <span className="pu-motion-value">{item.value}</span>
                </li>
              ))}
            </ul>
            <p className="pu-rail-note">
              cubic-bezier(0.22, 0.61, 0.36, 1) · reduced motion removes transforms
            </p>
          </section>

          <section className="pu-rail-block">
            <h2 className="pu-rail-title">Coverage</h2>
            <ul className="pu-coverage">
              {COVERAGE.map((item) => (
                <li key={item}>
                  <span className="pu-check" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <footer className="pu-rail-foot">
            <span>Light + dark</span>
            <span>Built-in default · external soft</span>
          </footer>
        </aside>

        <section className="pu-stage">
          <div className="pu-stage-head">
            <div>
              <span className="pu-kicker">Live gallery</span>
              <h1>Component surface</h1>
              <p>
                Warm paper, white panels, near-black ink and one vivid blue accent. Rounded
                rectangles at 8 / 10 / 12 / 14px with soft elevation. This is the built-in
                default; choose Soft to compare the original document look.
              </p>
            </div>
            <div className="pu-stage-meta" aria-hidden="true">
              <span className="pu-chip">8px fields</span>
              <span className="pu-chip">10px buttons</span>
              <span className="pu-chip">12 / 14px cards</span>
            </div>
          </div>

          <div className="pu-chassis">
            <div className="pu-chassis-bar">
              <span className="pu-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="pu-chassis-title">document.reactive.md</span>
              <span className="pu-chassis-scheme">{themeMode} · {scheme}</span>
            </div>
            <div className="pu-document">
              <LocalReactiveDocument
                source={source}
                themes={[softThemeDefinition]}
                colorScheme={colorScheme}
                locale="en"
                onDiagnostics={onDiagnostics}
              />
            </div>
          </div>

          <OverlaysPanel scheme={scheme} themeMode={themeMode} />

          <div className="pu-stage-foot">
            <span>Theme · {themeMode}</span>
            <span>Protocol · reactive-md-theme-1</span>
            <span>Scheme · {scheme}</span>
            <span>Diagnostics · {String(diagnostics).padStart(2, '0')}</span>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
