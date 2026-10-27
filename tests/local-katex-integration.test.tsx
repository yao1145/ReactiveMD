import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { LocalReactiveDocument } from '../src/local/LocalDocumentView';
import { compileLatex } from '../src/local/math';

describe('KaTeX document integration', () => {
  it('typesets the circulation formula with visible HTML and accessible source MathML', () => {
    const formula = String.raw`\Gamma=\oint_{\partial S}\mathbf{v}\times d\mathbf{l}=\iint_S\omega\,dA`;
    const source = `$$${formula}$$`;
    expect(compileLocal(source).diagnostics).toEqual([]);
    const html = renderToStaticMarkup(createElement(LocalReactiveDocument, {source}));
    expect(html).toContain('katex-html');
    expect(html).toContain('katex-mathml');
    expect(html).toContain('encoding="application/x-tex"');
    expect(html).toContain(formula);
  });

  it('accepts KaTeX environments and style commands during compilation', () => {
    const source = String.raw`$$\begin{matrix}1&2\\3&4\end{matrix}\quad\displaystyle\sum\limits_{n=1}^N n$$`;
    expect(compileLocal(source).diagnostics).toEqual([]);
    expect(renderToStaticMarkup(createElement(LocalReactiveDocument, {source}))).toContain('katex-html');
  });

  it('uses the actual display mode when diagnosing tags and rendering fallback', () => {
    const formula = String.raw`x\tag{A}`;
    const inline = `$${formula}$`;
    const display = `$$${formula}$$`;
    expect(compileLocal(inline).diagnostics).toContainEqual(expect.objectContaining({code: 'local.math.display'}));
    expect(compileLocal(display).diagnostics).toEqual([]);
    expect(renderToStaticMarkup(createElement(LocalReactiveDocument, {source: inline}))).toContain('local-math-fallback');
    expect(renderToStaticMarkup(createElement(LocalReactiveDocument, {source: display}))).toContain('katex-display');
  });

  it('keeps formula warnings at the original command after emoji and whitespace', () => {
    const source = String.raw`😀 Formula \(  x+\notARealMathCommand{y}\)`;
    const [issue] = compileLocal(source).diagnostics;
    expect(issue.code).toBe('local.math.display');
    expect(source.slice(issue.range.start, issue.range.end)).toBe(String.raw`\notARealMathCommand`);
  });

  it('keeps plotting evaluation independent of typesetting', () => {
    const plot = compileLocal(String.raw`<slider bind="a" label="A" initial="2" min="1" max="4">

<plot min="-1" max="1">$$y=a\sin x+\frac{x^2}{10}$$</plot>`);
    expect(plot.ok).toBe(true);
    expect(plot.diagnostics).toEqual([]);
    const equation = compileLatex(String.raw`y=a\sin x+\frac{x^2}{10}`);
    expect(equation.evaluate(1, {a: 2})).toBeCloseTo(2 * Math.sin(1) + 0.1);
    expect(equation.evaluate(1, {a: 3})).toBeCloseTo(3 * Math.sin(1) + 0.1);
  });
});
