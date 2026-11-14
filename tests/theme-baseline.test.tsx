import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocalReactiveDocument } from '../src/react/index';
import { LOCAL_THEME_PROTOCOL } from '../src/local/theme/theme';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { LocalDocumentView } from '../src/local/rendering/LocalDocumentView';

const emptyTheme = { name: 'empty-theme', protocol: LOCAL_THEME_PROTOCOL, colorSchemes: ['light', 'dark'] as const };
const content = `<slider label="Amount" initial="3" min="0" max="10">
<range-slider label="Interval" min="0" max="10">

<chart title="Shared chart">
| Category | Value |
| --- | ---: |
| A | 2 |
| B | 4 |
</chart>`;

describe('shared theme baseline', () => {
  it.each(['interactive', 'static'] as const)('preserves the complete %s view when only the registered theme changes', mode => {
    const source = `${content}
<date label="Day" initial="2026-01-01">
<select label="Choice">
<option value="a">A</option>
<option value="b">B</option>
</select>
<choices label="Size">
<option value="s">Small</option>
<option value="l">Large</option>
</choices>
<diagram label="Steps">
<node id="a" label="Start">Start</node>
<node id="b" label="End">End</node>
<edge from="a" to="b">
</diagram>`;
    const result = compileLocal(source);
    if (!result.ok) throw new Error(result.diagnostics.map(item => item.message).join('; '));
    const runtime = createLocalRuntime(result.document);
    try {
      const base = renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} mode={mode} />);
      const themed = renderToStaticMarkup(<LocalDocumentView document={{ ...result.document, theme: emptyTheme.name }} runtime={runtime} mode={mode} themes={[emptyTheme]} />);
      expect(themed.replace('data-rmd-theme="empty-theme"', 'data-rmd-theme="default"')).toBe(base);
    } finally {
      runtime.dispose();
    }
  });

  it('uses the same interactive implementations for a registered theme with no CSS', () => {
    const baseline = renderToStaticMarkup(<LocalReactiveDocument source={content} />);
    const themed = renderToStaticMarkup(<LocalReactiveDocument source={`<theme name="empty-theme">\n\n${content}`} themes={[emptyTheme]} />);
    expect(baseline).toContain('class="rmd-chart-svg"');
    expect(themed).toContain('class="rmd-chart-svg"');
    expect((themed.match(/role="slider"/g) ?? []).length).toBe(3);
  });

  it('keeps the selected theme for static summaries and charts', () => {
    const html = renderToStaticMarkup(<LocalReactiveDocument source={`<theme name="empty-theme">\n\n${content}`} themes={[emptyTheme]} mode="static" />);
    expect(html).toContain('data-rmd-theme="empty-theme"');
    expect(html).toContain('Shared chart');
    expect(html).not.toContain('role="slider"');
    expect(html).toContain('<svg');
  });
});
