import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLatex, LatexError, samplePlot } from '../src/local/math';
import { LatexView } from '../src/local/math-view';

const near = (actual: number, expected: number, tolerance = 1e-12) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

describe('computable LaTeX', () => {
  it('supports arithmetic, implicit multiplication and LaTeX precedence', () => {
    const env = { a: 3 };
    near(compileLatex('2x').evaluate(4, env), 8);
    near(compileLatex('a\\sin x').evaluate(Math.PI / 2, env), 3);
    near(compileLatex('(x+1)(x-1)').evaluate(3, env), 8);
    near(compileLatex('1/2x').evaluate(4, env), 2);
    near(compileLatex('-x^2').evaluate(3, env), -9);
    near(compileLatex('\\frac{x+1}{2}').evaluate(5, env), 3);
    near(compileLatex('2^{-3}').evaluate(0, env), 0.125);
    near(compileLatex('2\\cdot 3 + 4\\times 5').evaluate(0, env), 26);
  });

  it('supports functions, roots, logarithms and absolute values', () => {
    near(compileLatex('\\sqrt[3]{-8}').evaluate(0, {}), -2);
    near(compileLatex('\\sqrt{4}').evaluate(0, {}), 2);
    near(compileLatex('\\ln e').evaluate(0, {}), 1);
    near(compileLatex('\\log_{2}8').evaluate(0, {}), 3);
    near(compileLatex('\\log 100').evaluate(0, {}), 2);
    near(compileLatex('\\sin^2 x + \\cos^2 x').evaluate(0.7, {}), 1);
    near(compileLatex('\\arcsin(1)').evaluate(0, {}), Math.PI / 2);
    near(compileLatex('\\left| x \\right| + \\lvert x\\rvert').evaluate(-2, {}), 4);
  });

  it('maps greek names and mathrm parameters and reports dependencies', () => {
    const expression = compileLatex('y = \\alpha\\beta + \\mathrm{amplitude} x');
    expect(expression.dependencies).toEqual(['alpha', 'beta', 'amplitude']);
    near(expression.evaluate(2, { alpha: 2, beta: 3, amplitude: 5 }), 16);
  });

  it('evaluates the savings piecewise function from the demo', () => {
    const source = String.raw`y =
\begin{cases}
P + 12mx, & r = 0 \\
P\left(1+\frac{r}{1200}\right)^{12x}
+ m\frac{\left(1+\frac{r}{1200}\right)^{12x}-1}{r/1200}, & r \ne 0
\end{cases}`;
    const expression = compileLatex(source);
    expect(expression.dependencies).toEqual(['P', 'm', 'r']);
    near(expression.evaluate(1, { P: 10000, m: 500, r: 0 }), 16000);

    const monthly = 1 + 12 / 1200;
    const expected = 10000 * monthly ** 12 + 500 * (monthly ** 12 - 1) / (12 / 1200);
    near(expression.evaluate(1, { P: 10000, m: 500, r: 12 }), expected, 1e-8);
  });

  it('ignores comments and math spacing commands', () => {
    near(compileLatex('2\\,x + 1 % trailing comment').evaluate(3, {}), 7);
    near(compileLatex('\\left( x + 1 \\right)\\quad\\cdot 2').evaluate(2, {}), 6);
  });

  it('rejects unsupported structures and undefined points', () => {
    expect(() => compileLatex('y = \\int_0^x t^2\\,dt')).toThrow(LatexError);
    try {
      compileLatex('y = \\int_0^x t^2\\,dt');
    } catch (error) {
      expect(error).toBeInstanceOf(LatexError);
      expect((error as LatexError).code).toBe('latex-unsupported');
      expect((error as LatexError).offset).toBe(4);
    }
    expect(() => compileLatex('x = 2')).toThrow(/explicit/);
    expect(() => compileLatex('y = \\ln x').evaluate(0, {})).toThrow(LatexError);
    expect(() => compileLatex('y = 1/x').evaluate(0, {})).toThrow(LatexError);
    expect(() => compileLatex('y = \\sqrt{x}').evaluate(-1, {})).toThrow(LatexError);
    expect(() => compileLatex('y = a x').evaluate(1, {})).toThrow(LatexError);
    expect(() => compileLatex('y = a x').evaluate(1, { a: Number.POSITIVE_INFINITY })).toThrow(LatexError);
  });

  it('uses the first matching case branch and reports a miss', () => {
    const source = String.raw`\begin{cases} 1, & x < 0 \\ 2, & x \ge 0 \end{cases}`;
    near(compileLatex(source).evaluate(-1, {}), 1);
    near(compileLatex(source).evaluate(0, {}), 2);
    expect(() => compileLatex(String.raw`\begin{cases} 1, & x > 1 \end{cases}`).evaluate(0, {})).toThrow(LatexError);
  });
});

describe('plot sampling', () => {
  it('samples endpoints and breaks at a discontinuity between samples', () => {
    const expression = compileLatex('y = 1/x');
    const sample = samplePlot(expression, {}, -1, 1, 200);
    expect(sample.endpoint).toBe(1);
    expect(sample.points).toHaveLength(200);
    expect(sample.points.some((point) => point.y === null)).toBe(true);
    expect(sample.points.filter((point) => point.y !== null).length).toBeGreaterThan(0);
  });

  it('finds off-grid asymptotes even with sparse sampling and a constant offset', () => {
    for (const source of ['y = 1/(x - 0.09)', 'y = 1/(x - 0.09) + 1000']) {
      const sample = samplePlot(compileLatex(source), {}, -1, 1, 10);
      expect(sample.points).toHaveLength(10);
      expect(sample.points.some((point) => point.y === null)).toBe(true);
    }
  });

  it('keeps the smooth savings and sine demo curves connected', () => {
    const sine = samplePlot(compileLatex('y = \\sin x'), {}, -5, 5, 10);
    expect(sine.points.every((point) => point.y !== null)).toBe(true);

    const savingsSource = String.raw`y =
\begin{cases}
P + 12mx, & r = 0 \\
P\left(1+\frac{r}{1200}\right)^{12x}
+ m\frac{\left(1+\frac{r}{1200}\right)^{12x}-1}{r/1200}, & r \ne 0
\end{cases}`;
    const savings = samplePlot(
      compileLatex(savingsSource),
      { P: 10000, m: 500, r: 5 },
      0,
      20,
      200,
    );
    expect(savings.points.every((point) => point.y !== null)).toBe(true);
  });

  it('aborts the whole plot when the shared evaluation budget is exhausted', () => {
    const source = 'y = ' + Array.from({ length: 600 }, () => 'x').join(' + ');
    const heavy = compileLatex(source);
    let error: unknown = null;
    try {
      samplePlot(heavy, {}, 0, 1, 2000);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(LatexError);
    expect((error as LatexError).code).toBe('latex-budget');
  });

  it('keeps a continuous curve connected and reports an undefined endpoint', () => {
    const smooth = samplePlot(compileLatex('y = x^2'), {}, -2, 2, 50);
    expect(smooth.points.every((point) => point.y !== null)).toBe(true);
    expect(smooth.points[0].y).toBe(4);
    expect(smooth.points.at(-1)?.y).toBe(4);
    expect(smooth.endpoint).toBe(4);

    const undefinedEnd = samplePlot(compileLatex('y = \\ln x'), {}, -1, 0, 20);
    expect(undefinedEnd.endpoint).toBeNull();
    expect(undefinedEnd.points.some((point) => point.y === null)).toBe(true);
  });

  it('rejects invalid ranges and sample counts', () => {
    const expression = compileLatex('y = x');
    expect(() => samplePlot(expression, {}, 1, 0)).toThrow(LatexError);
    expect(() => samplePlot(expression, {}, 0, 1, 1)).toThrow(LatexError);
    expect(() => samplePlot(expression, {}, 0, 1, 2001)).toThrow(LatexError);
  });
});

describe('KaTeX view', () => {
  it('renders visual HTML and accessible MathML with a source annotation', () => {
    const html = renderToStaticMarkup(createElement(LatexView, { source: '\\frac{a}{b}', display: true }));
    expect(html).toContain('<math');
    expect(html).toContain('katex-html');
    expect(html).toContain('katex-mathml');
    expect(html).toContain('display="block"');
    expect(html).toContain('<mfrac>');
    expect(html).toContain('annotation');
    expect(html).toContain('application/x-tex');
  });

  it('renders cases and unknown commands without executing HTML', () => {
    const cases = renderToStaticMarkup(createElement(LatexView, {
      source: '\\begin{cases} 1, & x < 0 \\\\ 0, & \\text{otherwise} \\end{cases}',
    }));
    expect(cases).toContain('<mtable');
    expect(cases).toContain('otherwise');

    const unsafe = renderToStaticMarkup(createElement(LatexView, {
      source: '\\href{javascript:alert(1)}{x}<script>alert(1)</script>',
    }));
    expect(unsafe).toContain('\\href');
    expect(unsafe).not.toContain('href=');
    expect(unsafe).not.toContain('<script>');
  });
});
