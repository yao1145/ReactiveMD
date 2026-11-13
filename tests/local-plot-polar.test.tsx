import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { compileLatex, compilePlotFormula, localLatexReferences, plotFormulaKind } from '../src/local/evaluation/math';
import { samplePolar } from '../src/local/evaluation/math-sample';
import { LocalDocumentView } from '../src/local/rendering/LocalDocumentView';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { analyzeLocalSource, renameLocalBinding } from '../src/local/source/authoring';

const circle = 'r = a';
const radius = '<slider bind="a" label="Radius" initial="2" min="1" max="5">';

describe('polar plot authoring', () => {
  it.each([
    'r = a',
    String.raw`r = a(1 + \cos\theta)`,
    String.raw`r = a\cos(3\theta)`,
    String.raw`r = a(1 + \cos θ)`,
    String.raw`r = a\cos(3θ)`,
  ])('parses and samples %s', source => {
    expect(plotFormulaKind(source)).toBe('polar');
    const formula = compilePlotFormula(source);
    expect(formula.kind).toBe('polar');
    expect(formula.dependencies).toEqual(['a']);
    const result = samplePolar(formula.expression, { a: 2 }, 0, 2 * Math.PI, 1000);
    expect(result.points).toHaveLength(1000);
    expect(result.points[0].x).toBe(source.includes('1 +') ? 4 : 2);
    expect(result.points[0].y).toBe(0);
    expect(result.points.at(-1)?.x).toBeCloseTo(result.points[0].x);
    expect(result.points.at(-1)?.y).toBeCloseTo(0);
    expect(result.points.at(-1)?.theta).toBe(2 * Math.PI);
    expect(compileLocal(`${radius}\n<plot min="0" max="7">$$${source}$$</plot>`).ok).toBe(true);
  });

  it.each([String.raw`\theta`, 'θ'])('keeps %s local and preserves binding references and rename ranges', angle => {
    const formula = String.raw` r = a + a\cos${angle} `;
    const references = localLatexReferences(formula);
    expect(references.map(ref => ref.name)).toEqual(['a', 'a']);
    expect(references.map(ref => formula.slice(ref.range.start, ref.range.end))).toEqual(['a', 'a']);
    const source = `${radius}\n<input bind="theta" label="Unrelated">\n<plot>$$${formula}$$</plot>`;
    expect(compileLocal(source).ok).toBe(true);
    const analysis = analyzeLocalSource(source);
    const binding = analysis.bindings.find(item => item.name === 'a')!;
    expect(binding.references.map(range => source.slice(range.start, range.end))).toEqual(['a', 'a']);
    expect(analysis.bindings.find(item => item.name === 'theta')!.references).toEqual([]);
    const renamed = renameLocalBinding(source, 'a', 'radius').source;
    expect(renamed).toContain(String.raw`r = \mathrm{radius} + \mathrm{radius}\cos${angle}`);
    expect(compileLocal(renamed).ok).toBe(true);
    expect(renameLocalBinding(source, 'theta', 'phase').source).toContain(formula);
  });

  it('treats Unicode and LaTeX theta identically, including mixed spelling and implicit multiplication', () => {
    const latex = compilePlotFormula(String.raw`r=2\theta+\cos\theta`);
    for (const source of [String.raw`r=2θ+\cos θ`, String.raw`r=2θ+\cos\theta`]) {
      const unicode = compilePlotFormula(source);
      expect(unicode.dependencies).toEqual(latex.dependencies);
      expect(samplePolar(unicode.expression, {}, 0, 2 * Math.PI, 101))
        .toEqual(samplePolar(latex.expression, {}, 0, 2 * Math.PI, 101));
    }
  });

  it('preserves the source span of a Unicode theta used as a document parameter', () => {
    expect(compileLatex('θx').evaluate(2, { theta: 3 })).toBe(6);
    const source = 'y=θx';
    const references = localLatexReferences(source);
    expect(references).toEqual([{ name: 'theta', range: { start: 2, end: 3 } }]);
    const document = '<number bind="theta" label="Theta" initial="3">\n<plot>$$y=θx$$</plot>';
    const renamed = renameLocalBinding(document, 'theta', 'angle').source;
    expect(renamed).toContain(String.raw`y=\mathrm{angle}x`);
    expect(compileLocal(renamed).ok).toBe(true);
  });

  it.each(['r=x', 'r=y', 'r=r+1', 'r=', String.raw`r=\theta=1`, 'r=b', 'r=t'])('rejects invalid polar formulas: %s', formula => {
    expect(compileLocal(`<plot>$$${formula}$$</plot>`).ok).toBe(false);
  });

  it('preserves the original parametric syntax and reverts the added spellings', () => {
    expect(compileLocal(String.raw`<plot>$$\begin{cases} x=t \\ y=t^2 \end{cases}$$</plot>`).ok).toBe(true);
    expect(compileLocal(String.raw`<plot>$$\begin{cases} x(t)&=t \\ y(t)&=t^2 \end{cases}$$</plot>`).ok).toBe(false);
    expect(compileLocal(String.raw`<plot>$$\begin{aligned} x=t \\ y=t^2 \end{aligned}$$</plot>`).ok).toBe(false);
  });

  it('preserves r as a document parameter in existing Cartesian equations', () => {
    const formula = compilePlotFormula('(r) = x');
    expect(plotFormulaKind('(r) = x')).toBe('implicit');
    expect(formula.kind).toBe('implicit');
    expect(formula.dependencies).toEqual(['r']);
    expect(compilePlotFormula('y = r x').dependencies).toEqual(['r']);
  });

  it('samples radians, negative radii and a document parameter t without shadowing it', () => {
    const formula = compilePlotFormula(String.raw`r=-t`);
    expect(formula.dependencies).toEqual(['t']);
    const env = { t: 2, theta: 'unrelated' };
    const sample = samplePolar(formula.expression, env, 0, 2 * Math.PI, 5);
    expect(sample.points[0].x).toBe(-2);
    expect(sample.points[1].y).toBeCloseTo(-2);
    expect(sample.points[2].x).toBeCloseTo(2);
    expect(sample.points.at(-1)?.theta).toBe(2 * Math.PI);
    expect(env).toEqual({ t: 2, theta: 'unrelated' });
    expect(compileLocal('<number bind="t" label="t" initial="2">\n<plot>$$r=t$$</plot>').ok).toBe(true);
  });

  it('breaks undefined radii and enforces sampling and evaluation budgets', () => {
    const radius = compilePlotFormula(String.raw`r=\frac{1}{\theta}`).expression;
    const sample = samplePolar(radius, {}, 0, 1, 5);
    expect(sample.points[0].y).toBeNull();
    expect(Number.isNaN(sample.points[0].x)).toBe(true);
    expect(sample.points[1].y).not.toBeNull();
    expect(() => samplePolar(radius, {}, 1, 0, 5)).toThrow();
    expect(() => samplePolar(radius, {}, 0, 1, 2001)).toThrow();
    const budget = { steps: 0, limit: 2 };
    expect(() => samplePolar(radius, {}, 0, 1, 5, budget)).toThrow();
    expect(budget.steps).toBeGreaterThan(0);
  });
});

describe('plot points attribute', () => {
  it.each([
    ['points="1000"', 1000],
    ['points="2"', 2],
    ['points="2000"', 2000],
    ['samples="50"', 50],
    ['', 200],
    ['samples="50" points="1000"', 1000],
  ])('uses %s in compilation and rendering', (attributes, expected) => {
    const result = compileLocal(`${radius}\n<plot min="0" max="7" ${attributes}>$$${circle}$$</plot>`);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error('Compilation failed');
    const runtime = createLocalRuntime(result.document);
    try {
      const render = () => renderToStaticMarkup(<LocalDocumentView document={result.document} runtime={runtime} />);
      const html = render();
      expect(html).toContain(`${expected} samples`);
      const paths = [...html.matchAll(/class="local-visual-plot-line" d="([^"]+)"/g)];
      expect(paths).toHaveLength(1);
      expect(paths[0][1].match(/[ML] /g)).toHaveLength(expected);
      expect(runtime.setParameter('a', 3)).toEqual([]);
      expect(render()).toContain(`${expected} samples`);
      expect(render()).not.toContain('Cannot compute');
    } finally {
      runtime.dispose();
    }
  });

  it.each(['1', '2001', '2.5', 'NaN', '{{ 1000 }}'])('rejects invalid or dynamic points=%s', points => {
    expect(compileLocal(`<plot points="${points}">$$y=x$$</plot>`).ok).toBe(false);
  });

  it('counts points toward the document budget with the same precedence as rendering', () => {
    const curves = '$$y=x$$\n\n'.repeat(11);
    const over = compileLocal(`<plot samples="2" points="2000">${curves}</plot>`);
    expect(over.diagnostics.some(diagnostic => diagnostic.code === 'local.budget.plot.points')).toBe(true);
    expect(compileLocal(`<plot samples="2000" points="2">${curves}</plot>`).ok).toBe(true);
    const hidden = compileLocal(`<if when="{{ false }}"><plot points="2000">${curves}</plot></if>`);
    expect(hidden.diagnostics.some(diagnostic => diagnostic.code === 'local.budget.plot.points')).toBe(true);
  });

  it('applies the implicit grid budget when points overrides samples', () => {
    const implicit = '$$x^2+y^2=1$$\n\n'.repeat(3);
    expect(compileLocal(`<plot samples="2" points="1000">${implicit}</plot>`).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'local.budget.plot.points' }));
    expect(compileLocal(`<plot samples="1000" points="2">${implicit}</plot>`).ok).toBe(true);
  });
});
