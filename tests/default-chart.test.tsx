import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { LocalDocumentView } from '../src/local/rendering/LocalDocumentView';
import { source as acceptanceSource } from '../examples/default-charts/document';

const pie = (header: string, rows: string) => `<chart kind="pie" title="占比" key="组别" bind="picked" initial="B" x="组别" y="值">\n${header}\n${rows}\n</chart>`;
const header = '| 组别 | 值 |\n| --- | ---: |';

function render(source: string, mode: 'interactive' | 'static' = 'interactive') {
  const compiled = compileLocal(source);
  if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join('; '));
  const runtime = createLocalRuntime(compiled.document);
  try {
    return renderToStaticMarkup(<LocalDocumentView document={compiled.document} runtime={runtime} mode={mode} locale="zh" />);
  } finally { runtime.dispose(); }
}

describe('default chart document contracts', () => {
  it('compiles the real acceptance document with expression cells and shared selection bindings', () => {
    const html = render(acceptanceSource);
    expect(html).toContain('rmd-chart');
    expect(html).toContain('data-chart-selectable');
    expect(html).not.toMatch(/(?:NaN|Infinity)/);
  });

  it('accepts pie tables and preserves keyed selection in the default view', () => {
    const html = render(pie(header, '| A | 10 |\n| B | 20 |'));
    expect(html).toContain('rmd-chart');
    expect(html).toContain('data-chart-selectable');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toMatch(/(?:NaN|Infinity)/);
  });

  it('renders pie data in static mode without the interactive view or focus targets', () => {
    const html = render(pie(header, '| A | 10 |\n| B | 20 |'), 'static');
    expect(html).toContain('local-static-chart');
    expect(html).toContain('A');
    expect(html).toContain('B');
    expect(html).not.toContain('rmd-chart');
    expect(html).not.toContain('tabindex');
    expect(html).not.toMatch(/(?:NaN|Infinity)/);
  });

  it('applies numeric validation to pie and excludes negative shares with a visible explanation', () => {
    const negative = render(pie(header, '| A | -10 |\n| B | 20 |'));
    expect(negative).toContain('已忽略 1 个负值');
    expect(compileLocal(pie(header, '| A | text |\n| B | 20 |')).ok).toBe(false);
  });

  it('retains source order when numeric x coordinates reverse direction', () => {
    const html = render('<chart kind="line" x="x" y="y">\n| x | y |\n| ---: | ---: |\n| 3 | 30 |\n| 1 | 10 |\n| 2 | 20 |\n</chart>');
    const d = /<path[^>]*class="local-visual-line"[^>]*\sd="([^"]+)"/.exec(html)?.[1];
    expect(d).toBeTruthy();
    const coordinates = d!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
    expect(coordinates[0]).toBeGreaterThan(coordinates[2]);
    expect(coordinates[2]).toBeLessThan(coordinates[4]);
  });
});
