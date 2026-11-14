import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { LocalDocumentView } from '../src/local/rendering/LocalDocumentView';
import { LOCAL_THEME_PROTOCOL, type LocalThemeDefinition } from '../src/local/theme/theme';
import type { LocalDocument } from '../src/local/contracts/types';

function compileDocument(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  return result.document;
}

interface RenderOptions {
  themes?: readonly LocalThemeDefinition[];
  externalValues?: Readonly<Record<string, number>>;
  mode?: 'interactive' | 'static';
}

function render(source: string, options: RenderOptions = {}): string {
  const document = compileDocument(source);
  const runtime = createLocalRuntime(document, options.externalValues ? { externalValues: options.externalValues } : undefined);
  try {
    return renderToStaticMarkup(
      <LocalDocumentView
        document={document}
        runtime={runtime}
        themes={options.themes}
        mode={options.mode}
      />,
    );
  } finally {
    runtime.dispose();
  }
}

function manifest(name: string): LocalThemeDefinition {
  return { name, protocol: LOCAL_THEME_PROTOCOL, colorSchemes: ['light', 'dark'] };
}

describe('default theme UIArc slider', () => {
  it('renders the adapted slider with its accessibility state and legacy readout', () => {
    const html = render('<slider bind="n" label="Level" initial="8" min="0" max="10" step="2">');
    expect(html).toContain('data-rmd-slider="arc"');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuenow="8"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="10"');
    expect(html).toContain('aria-valuetext="8"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('class="md-slider-value" aria-hidden="true">8');
    expect(html).toContain('data-local-print-value="">8');
    // A native proxy stays in the document contract; it never receives focus.
    expect(html).toContain('data-rmd-native-proxy=""');
    expect(html).toContain('tabindex="-1"');
  });

  it('keeps the raw stored value visible while the thumb is clamped', () => {
    const html = render(
      '<external name="cap" type="number">\n<slider bind="n" label="N" initial="8" min="0" max="{{ cap }}">',
      { externalValues: { cap: 4 } },
    );
    expect(html).toContain('class="md-slider-value" aria-hidden="true">8');
    expect(html).toContain('aria-valuenow="4"');
    expect(html).toContain('data-local-print-value="">8');
    expect(html).toContain('Must be at most 4');
  });

  it('marks the control invalid and disabled in both the wrapper and the thumbs', () => {
    const invalid = render(
      '<external name="cap" type="number">\n<slider bind="n" label="N" initial="8" min="0" max="{{ cap }}">',
      { externalValues: { cap: 4 } },
    );
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('data-invalid="true"');

    const disabled = render('<slider bind="n" label="N" initial="2" disabled="true">');
    expect(disabled).toContain('data-disabled="true"');
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).toContain('tabindex="-1"');
  });

  it('exposes localized range thumb names and the crossing bounds', () => {
    const html = render(
      '<range-slider label="Span" bind-start="lo" bind-end="hi" initial-start="20" initial-end="60" min="0" max="100" step="5">',
    );
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Span Start"');
    expect(html).toContain('aria-label="Span End"');
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain('aria-valuenow="60"');
    // The start thumb cannot pass the end thumb, and the end cannot fall below it.
    expect(html).toContain('aria-valuemin="0" aria-valuemax="60"');
    expect(html).toContain('aria-valuemin="20" aria-valuemax="100"');
    expect(html).toContain('class="md-slider-value" aria-hidden="true">20 – 60');
    expect(html).toContain('Start: 20 · End: 60');
  });

  it('leaves static mode on the existing static value markup', () => {
    const html = render('<slider bind="n" label="Level" initial="3">', { mode: 'static' });
    expect(html).toContain('data-local-static-value="">3');
    expect(html).not.toContain('data-rmd-slider="arc"');
    expect(html).not.toContain('role="slider"');

    const range = render(
      '<range-slider label="Span" bind-start="lo" bind-end="hi" initial-start="20" initial-end="60">',
      { mode: 'static' },
    );
    expect(range).toContain('data-local-static-value="">Start: 20 · End: 60');
    expect(range).not.toContain('data-rmd-slider="arc"');
  });
});

describe('all themes share slider implementations', () => {
  it('renders the adapted single slider with the selected theme', () => {
    const html = render('<theme name="paper" />\n\n<slider bind="n" label="Level" initial="4">', {
      themes: [manifest('paper')],
    });
    expect(html).toContain('data-rmd-theme="paper"');
    expect(html).toContain('data-rmd-slider="arc"');
    expect(html).toContain('data-rmd-native-proxy=""');
    expect(html).toContain('role="slider"');
    expect(html).toContain('class="md-control md-slider local-slider"');
    expect(html).toContain('type="range"');
  });

  it('renders both adapted range thumbs with the selected theme', () => {
    const html = render(
      '<theme name="paper" />\n\n<range-slider label="Span" bind-start="lo" bind-end="hi" initial-start="20" initial-end="60">',
      { themes: [manifest('paper')] },
    );
    expect(html).toContain('data-rmd-theme="paper"');
    expect(html).toContain('data-rmd-slider="arc"');
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    expect(html.match(/class="local-range-input /g)).toHaveLength(2);
  });
});
