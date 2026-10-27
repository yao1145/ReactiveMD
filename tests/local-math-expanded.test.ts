import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  inspectLocalMathDisplay,
  renderLocalMathDisplay,
} from '../src/local/math-display';
import { LatexView } from '../src/local/math-view';
import { compileLocal } from '../src/local/compiler';

function render(source: string, display = true): string {
  const result = renderLocalMathDisplay(source, display);
  expect(result.issues, source).toEqual([]);
  expect(result.html, source).not.toBeNull();
  return result.html!;
}

describe('expanded display LaTeX', () => {
  it('typesets the circulation formula with integrals and bold vectors', () => {
    const source = String.raw`\Gamma=\oint_{\partial S}\mathbf{v}\times d\mathbf{l}=\iint_S\omega\,dA`;
    const html = render(source);
    expect(html).toContain('katex-html');
    expect(html).toContain('katex-mathml');
    expect(html).toContain('∮');
    expect(html).toContain('∬');
    expect(html).toContain(source);
  });

  it('uses MathML structures for fractions, roots and text', () => {
    expect(render(String.raw`\frac{a}{b}`)).toContain('<mfrac>');
    expect(render(String.raw`\sqrt[3]{x}`)).toContain('<mroot>');
    expect(render(String.raw`\text{otherwise}`)).toContain('otherwise');
  });

  it('keeps double-struck, script and fraktur font variants in MathML', () => {
    const html = render(String.raw`\mathbb{R}\mathcal{F}\mathfrak{g}`);
    expect(html).toContain('mathvariant="double-struck"');
    expect(html).toContain('mathvariant="script"');
    expect(html).toContain('mathvariant="fraktur"');
  });

  it.each([
    String.raw`\begin{matrix}1&2\\3&4\end{matrix}`,
    String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`,
    String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`,
    String.raw`\begin{cases}1,&x<0\\0,&\text{otherwise}\end{cases}`,
    String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`,
    String.raw`\begin{align}a&=b\\c&=d\end{align}`,
  ])('renders %s as a KaTeX table', source => {
    expect(render(source)).toContain('<mtable');
  });

  it('keeps nested environments inside their own cells', () => {
    const html = render(String.raw`\begin{aligned}A&=\begin{pmatrix}1&2\\3&4\end{pmatrix}\\B&=0\end{aligned}`);
    expect(html.match(/<mtable/g)?.length).toBe(2);
  });

  it('accepts newer KaTeX commands without false warnings', () => {
    for (const source of [
      String.raw`\overset{!}{=}\quad\underset{x}{y}`,
      String.raw`\displaystyle\sum\limits_{n=1}^N n`,
      String.raw`\operatorname{E}[X]`,
      String.raw`\left(\frac{a}{b}\right)`,
      String.raw`\begin{matrix}1&2\\3&4\end{matrix}`,
    ]) {
      expect(inspectLocalMathDisplay(source), source).toEqual([]);
    }
  });

  it('renders displayed equation numbers', () => {
    const html = render(String.raw`x\tag{1}`);
    expect(html).toContain('katex-display');
    expect(html).toContain('katex-tag');
    expect(html).toContain('<mtable');
    expect(inspectLocalMathDisplay(String.raw`x\tag{1}`, false)[0]?.reason).toBe('syntax');
  });

  it('compiles expanded formulas without display warnings', () => {
    const result = compileLocal(
      String.raw`$$\begin{aligned}\mathbb{R}&\implies\boxed{x}\\a&=\binom{n}{k}\end{aligned}$$`,
    );
    expect(result.diagnostics.filter(diagnostic => diagnostic.code === 'local.math.display')).toEqual([]);
  });

  it('renders through React and SSR, including tables and tags', () => {
    const html = renderToStaticMarkup(
      createElement(LatexView, {
        source: String.raw`\begin{cases}x&1\\y&2\end{cases}`,
        display: true,
      }),
    );
    expect(html).toContain('katex-display');
    expect(html).toContain('<mtable');
    expect(html).not.toContain('local-math-fallback');
  });
});

describe('mhchem display', () => {
  it.each([
    'H2O', '2 H2 + O2 -> 2 H2O', 'SO4^2-', 'NH4+',
    '^{14}_{6}C', 'Ca(OH)2', 'CuSO4 * 5 H2O', 'H2O(l)',
    'A <=> B', 'A ->[heat] B', 'A <=>[above][below] B',
    'H-C#C-H', 'Na+ + Cl- -> NaCl',
  ])('typesets chemical notation: %s', formula => {
    expect(render(`\\ce{${formula}}`)).toContain('katex-html');
  });

  it('renders subscripts, superscripts and reaction arrows', () => {
    const html = render(String.raw`\ce{2 H2 + O2 -> 2 H2O + SO4^2-}`);
    expect(html).toContain('<msub>');
    expect(html).toContain('→');
  });

  it('renders isotope numbers as scripts', () => {
    const html = render(String.raw`\ce{^{14}_{6}C}`);
    expect(html).toContain('14');
    expect(html).toContain('6');
    expect(html).toContain('C');
  });

  it('escapes chemical text and never injects HTML', () => {
    const source = String.raw`\ce{\text{<img src=x onerror=alert(1)>}}`;
    const html = render(source);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });

  it('reports unsafe commands inside chemistry as unsupported', () => {
    const [issue] = inspectLocalMathDisplay(String.raw`\ce{\href{https://example.com}{x}}`);
    expect(issue).toMatchObject({ reason: 'unsupported-command', params: { name: 'href' } });
    expect(renderLocalMathDisplay(String.raw`\ce{\href{https://example.com}{x}}`, true).html).toBeNull();
  });

  it('bounds nested and malformed chemical input without throwing', () => {
    for (const source of [
      String.raw`\ce{H2O`,
      `\\ce{${'\\ce{'.repeat(150)}H${'}'.repeat(150)}}`,
    ]) {
      expect(() => renderLocalMathDisplay(source, true), source).not.toThrow();
      const result = renderLocalMathDisplay(source, true);
      expect(result.html, source).toBeNull();
      expect(result.issues.length, source).toBeGreaterThan(0);
    }
  });
});

describe('math display safety', () => {
  it.each([
    [String.raw`\href{https://example.com}{x}`, 'href'],
    [String.raw`\url{https://example.com}`, 'url'],
    [String.raw`\includegraphics{file.png}`, 'includegraphics'],
    [String.raw`\htmlClass{klass}{x}`, 'htmlClass'],
    [String.raw`\def\x{1}\x`, 'def'],
    [String.raw`\global\def\x{1}`, 'global'],
    [String.raw`\input{file.tex}`, 'input'],
  ])('falls back for %s', (source, name) => {
    const result = renderLocalMathDisplay(source, true);
    expect(result.html).toBeNull();
    expect(result.issues[0]).toMatchObject({ reason: 'unsupported-command', params: { name } });
  });

  it('keeps source ranges on the offending command after leading text', () => {
    const source = String.raw`f(x)=\notARealMathCommand{x}`;
    const [issue] = inspectLocalMathDisplay(source);
    expect(issue.reason).toBe('unsupported-command');
    expect(source.slice(issue.start, issue.end)).toBe(String.raw`\notARealMathCommand`);
  });

  it('falls back instead of recursing through brace-less commands', () => {
    const source = `${String.raw`\sqrt`.repeat(200)}x`;
    expect(() => renderLocalMathDisplay(source, true)).not.toThrow();
    const result = renderLocalMathDisplay(source, true);
    expect(result.html).toBeNull();
    expect(result.issues[0]).toMatchObject({ reason: 'budget', params: { kind: 'depth' } });
  });

  it('bounds literal output in the rendered view', () => {
    const html = renderToStaticMarkup(createElement(LatexView, { source: 'x'.repeat(50_001) }));
    expect(html).toContain('local-math-fallback');
    expect(html.length).toBeLessThan(50_000);
  });
});
