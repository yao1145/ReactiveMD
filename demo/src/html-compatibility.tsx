import { useId, type ChangeEvent } from 'react';
import { useCopy } from './i18n';
import { isHtmlOptionsActive, type DemoHtmlOptions } from './html-options';

type HtmlOptionKey = keyof DemoHtmlOptions;

const OPTION_KEYS: readonly HtmlOptionKey[] = [
  'enableCss',
  'enableJavaScript',
  'enableExtendedHtml',
];

export interface HtmlCompatibilityControlsProps {
  options: DemoHtmlOptions;
  onChange(next: DemoHtmlOptions): void;
}

/**
 * Playground-only switches for the temporary whole-document HTML route. They
 * are plain checkboxes and are intentionally not persisted: a reload, a
 * different example, or an import starts from the safe ReactiveMD defaults.
 */
export function HtmlCompatibilityControls({ options, onChange }: HtmlCompatibilityControlsProps) {
  const copy = useCopy().htmlCompatibility;
  const headingId = useId();
  const policyId = useId();
  const active = isHtmlOptionsActive(options);

  const labels: Record<HtmlOptionKey, { label: string; hint: string }> = {
    enableCss: { label: copy.css, hint: copy.cssHint },
    enableJavaScript: { label: copy.javascript, hint: copy.javascriptHint },
    enableExtendedHtml: { label: copy.extendedHtml, hint: copy.extendedHtmlHint },
  };

  const toggle = (key: HtmlOptionKey) => (event: ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    onChange({
      enableCss: key === 'enableCss' ? checked : options.enableCss,
      enableJavaScript: key === 'enableJavaScript' ? checked : options.enableJavaScript,
      enableExtendedHtml: key === 'enableExtendedHtml' ? checked : options.enableExtendedHtml,
    });
  };

  return (
    <section className="html-compat" aria-labelledby={headingId}>
      <div className="html-compat-copy">
        <h2 id={headingId}>{copy.heading}</h2>
        <p className="html-compat-policy" id={policyId}>{copy.policy}</p>
      </div>
      <div className="html-compat-controls">
        <span
          className={`html-mode${active ? ' is-html' : ''}`}
          role="status"
          aria-live="polite"
          data-html-mode={active ? 'native' : 'reactive'}
          data-testid="html-mode"
        >
          {active ? copy.modeHtml : copy.modeReactive}
        </span>
        <fieldset className="html-compat-options" aria-describedby={policyId}>
          <legend>{copy.legend}</legend>
          <div className="html-compat-option-list">
            {OPTION_KEYS.map((key) => (
              <label className="html-compat-option" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  data-html-option={key}
                  onChange={toggle(key)}
                />
                <span className="html-compat-option-copy">
                  <span className="html-compat-option-label">{labels[key].label}</span>
                  <span className="html-compat-option-hint">{labels[key].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
