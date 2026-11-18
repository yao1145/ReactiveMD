import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { compileLocal } from '../src/local/compilation/compiler';
import { defaultPreset } from '../src/presets/default';
import { minimalPreset } from '../src/presets/minimal';
import { minimalReactPresetPackage } from '../src/components/minimal-preset';
import forms from '../src/components/plugins/forms';
import navigation from '../src/components/plugins/navigation';
import data from '../src/components/plugins/data';
import chart from '../src/components/plugins/chart';
import plot from '../src/components/plugins/plot';
import diagram from '../src/components/plugins/diagram';
import gallery from '../src/components/plugins/gallery';
import { createReactHost } from '../src/react/minimal';
import { LocalReactiveDocument } from '../src/react/minimal';
import { createLocalConfig } from '../src/sdk/config';

describe('minimal and optional official presets', () => {
  it('registers exactly the agreed core tags and preserves source for an unmounted tag', () => {
    const host = createReactHost();
    const expected = ['input', 'textarea', 'number', 'slider', 'toggle', 'date', 'select', 'option',
      'text', 'if', 'alert', 'badge', 'panel', 'card', 'grid', 'section', 'jump', 'anchor'].sort();
    expect(host.config.registry.map((component) => component.name).sort()).toEqual(expected);
    expect(host.reactConfig.implementations.map((implementation) => implementation.definition.name).sort()).toEqual(expected);
    expect(minimalPreset.components.map((component) => component.name).sort()).toEqual(expected);

    const result = compileLocal('<counter label="Extra">', host.compileOptions);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics.map(({ code }) => code)).toContain('local.component.unknown');
    expect(JSON.stringify(result.document.nodes)).toContain('counter');
  });

  it('resolves inline jumps to explicit anchors in the minimal preset', () => {
    const source = 'Go to <jump to="budget">the budget</jump>.\n\n<anchor id="budget">\n\n## Budget details';
    const result = compileLocal(source, createReactHost().compileOptions);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('composes the complete official set without duplicate manifests or views', () => {
    const host = createReactHost({
      presets: [minimalReactPresetPackage, forms, navigation, data, chart, plot, diagram, gallery],
    });
    const names = defaultPreset.components.map((component) => component.name).sort();
    expect(host.config.registry.map((component) => component.name).sort()).toEqual(names);
    expect(host.reactConfig.implementations.map((implementation) => implementation.definition.name).sort()).toEqual(names);
  });

  it('renders without an explicit reactConfig and keeps a legal themes={[]}', () => {
    // The minimal entry owns its own default assembly. It must not require the
    // host to build a reactConfig, and the legacy theme prop stays legal.
    const html = renderToStaticMarkup(createElement(LocalReactiveDocument, {
      source: '<number bind="count" label="Count" initial="2">\n\nValue: {{ count }}',
      themes: [],
    }));
    expect(html).toContain('data-rmd-theme="default"');
    expect(html).toContain('Value:');
    expect(html).not.toContain('local-extension-error');
  });

  it('keeps the minimal preset’s unknown-tag behavior without a reactConfig', () => {
    // The entry compiles against the minimal preset by default, so `<counter>`
    // is literal source plus one unknown-component diagnostic rather than a
    // document-wide failure.
    const html = renderToStaticMarkup(createElement(LocalReactiveDocument, {
      source: '<counter label="Extra">\n\nAfter',
    }));
    expect(html).toContain('counter');
    expect(html).not.toContain('local-inactive');
  });

  it('still honors an explicit host config instead of forcing the entry preset', () => {
    // A host that passes its own config keeps it. The entry default only fills
    // an omitted config, and the mismatch against the installed renderer stays
    // the existing config diagnostic rather than a new throw.
    const config = createLocalConfig({ components: [] });
    const html = renderToStaticMarkup(createElement(LocalReactiveDocument, {
      source: '# Title',
      compileOptions: { config },
    }));
    expect(html).toContain('<h1');
    expect(html).toContain('data-local-extension-error');
  });});
