import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseLocalMathDisplay, type MathNode } from '../src/local/math-display';
import { LatexView } from '../src/local/math-view';
import { compileLocal } from '../src/local/compiler';

function parse(source: string): MathNode {
  const result = parseLocalMathDisplay(source);
  expect(result.issues, source).toEqual([]);
  expect(result.node).not.toBeNull();
  return result.node!;
}

function nodes(node: MathNode, tag: string): MathNode[] {
  return [ ...(node.tag === tag ? [node] : []), ...(node.children ?? []).flatMap(child => nodes(child, tag)) ];
}

describe('expanded display LaTeX', () => {
  it.each(['aligned', 'align', 'align*', 'pmatrix', 'bmatrix', 'vmatrix'])(
    'renders %s as a two-row, two-column table', name => {
      const tree = parse(String.raw`\begin{${name}}a&b\\c&d\end{${name}}`);
      expect(nodes(tree, 'mtr')).toHaveLength(2);
      expect(nodes(tree, 'mtd')).toHaveLength(4);
      const fences = nodes(tree, 'mo').filter(node => node.attrs?.fence === 'true').map(node => node.text);
      expect(fences).toEqual(name === 'pmatrix' ? ['(', ')'] : name === 'bmatrix' ? ['[', ']'] : name === 'vmatrix' ? ['|', '|'] : []);
      expect(nodes(tree, 'mtd').map(node => node.attrs?.columnalign)).toEqual(
        name.startsWith('align') ? ['right', 'left', 'right', 'left'] : ['center', 'center', 'center', 'center']);
    });

  it('keeps nested environments inside their own cells', () => {
    const tree = parse(String.raw`\begin{aligned}A&=\begin{pmatrix}1&2\\3&4\end{pmatrix}\\B&=0\end{aligned}`);
    expect(nodes(tree, 'mtable')).toHaveLength(2);
    expect(nodes(tree, 'mtr')).toHaveLength(4);
  });

  it.each([
    String.raw`\implies\triangle\circ\vdots\rightleftharpoons\ddots\mapsto\iff\not=\downarrow\oplus\mid\ll\longrightarrow\varnothing\dagger\therefore\because\cong\Longleftrightarrow`,
    String.raw`\sec x+\sinh x+\cot x+\lg x+\cosh x+\csc x`,
    String.raw`\left\lfloor x\right\rfloor+\left\lceil y\right\rceil+\Bigg(\frac ab\Bigg)+\bigl[x\bigr]`,
    String.raw`\mathbb{R}\mathcal{F}\mathfrak{g}\mathscr{L}\textbf{bold text}`,
    String.raw`\binom{n}{k}\underbrace{a+b}_{n}\overrightarrow{AB}\xrightarrow[below]{above}\stackrel{!}{=}\underset{x}{\lim}\underline{x}\boxed{x}\pmod{n}\tag{1}`,
    String.raw`A\xrightleftharpoons[k_2]{k_1}B`,
  ])('renders requested commands without literal command fallback: %s', source => { parse(source); });

  it('uses MathML structures for fractions, annotations, negation and boxes', () => {
    expect(parse(String.raw`\binom{n}{k}`)).toMatchObject({tag: 'mrow', children: [
      {tag: 'mo', text: '('}, {tag: 'mfrac', attrs: {linethickness: '0'}}, {tag: 'mo', text: ')'},
    ]});
    expect(parse(String.raw`\xrightarrow[b]{a}`)).toMatchObject({tag: 'munderover', children: [
      {tag: 'mo', text: '→'}, {tag: 'mrow'}, {tag: 'mrow'},
    ]});
    expect(parse(String.raw`\underbrace{x+y}_{n}`)).toMatchObject({tag: 'munder', children: [{tag: 'munder'}, {tag: 'mrow'}]});
    expect(parse(String.raw`\not\in`)).toMatchObject({tag: 'mo', text: '∉'});
    expect(parse(String.raw`\boxed{x}`)).toMatchObject({tag: 'mrow', style: {border: '1px solid currentColor'}});
  });

  it('renders boxes and bold text through React in SSR as well as MathML', () => {
    const html = renderToStaticMarkup(createElement(LatexView, {source: String.raw`\boxed{x}\textbf{bold}`}));
    expect(html).toContain('border:1px solid currentColor');
    expect(html).toContain('font-weight:bold');
  });

  it('parses math inside alphabet groups and reports unsupported nested commands', () => {
    const tree = parse(String.raw`\mathbb{R}^{n}\mathcal{F_{x}}`);
    expect(nodes(tree, 'msup')).toHaveLength(1);
    expect(nodes(tree, 'msub')).toHaveLength(1);
    expect(JSON.stringify(tree)).toContain('ℝ');
    expect(parseLocalMathDisplay(String.raw`\mathbb{\href{x}{y}}`).issues[0].reason).toBe('unsupported-command');
  });

  it('reports unclosed and mismatched environments', () => {
    for (const source of [String.raw`\begin{aligned}x&=1`, String.raw`\begin{bmatrix}1\end{pmatrix}`]) {
      expect(parseLocalMathDisplay(source).issues).toContainEqual(expect.objectContaining({reason: 'syntax'}));
    }
  });

  it('compiles expanded formulas without display warnings', () => {
    const result = compileLocal(String.raw`$$\begin{aligned}\mathbb{R}&\implies\boxed{x}\\a&=\binom{n}{k}\end{aligned}$$`);
    expect(result.diagnostics.filter(issue => issue.code === 'local.math.display')).toEqual([]);
  });
});

describe('mhchem display', () => {
  it.each([
    'H2O', '2 H2 + O2 -> 2 H2O', 'SO4^2-', 'NH4+',
    '^{14}_{6}C', 'Ca(OH)2', 'CuSO4 * 5 H2O', 'H2O(l)',
    'A <=> B', 'A ->[heat] B', 'A <=>[above][below] B',
    'H-C#C-H', 'Na+ + Cl- -> NaCl',
  ])('renders chemical notation: %s', formula => { parse(`\\ce{${formula}}`); });

  it('renders subscripts, superscripts and reaction arrows', () => {
    const tree = parse(String.raw`\ce{2 H2 + O2 -> 2 H2O + SO4^2-}`);
    expect(nodes(tree, 'msub').length + nodes(tree, 'msubsup').length).toBeGreaterThanOrEqual(4);
    expect(nodes(tree, 'msup').length + nodes(tree, 'msubsup').length).toBeGreaterThanOrEqual(1);
    expect(nodes(tree, 'mo').map(node => node.text)).toContain('⟶');
  });

  it('renders isotope numbers as left subscripts and superscripts', () => {
    const tree = parse(String.raw`\ce{^{14}_{6}C}`);
    const [isotope] = nodes(tree, 'mmultiscripts');
    expect(isotope.children?.[1]).toEqual({tag: 'mprescripts'});
    expect(JSON.stringify(isotope.children?.[2])).toContain('"6"');
    expect(JSON.stringify(isotope.children?.[3])).toContain('"14"');
  });

  it('escapes text and keeps unsafe commands inert', () => {
    const source = String.raw`\ce{\text{<img src=x onerror=alert(1)>}}`;
    const html = renderToStaticMarkup(createElement(LatexView, {source}));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(parseLocalMathDisplay(String.raw`\ce{\href{https://example.com}{x}}`).issues.length).toBeGreaterThan(0);
  });

  it('bounds nested and malformed chemical input', () => {
    for (const source of [String.raw`\ce{H2O`, `\\ce{${'\\ce{'.repeat(150)}H${'}'.repeat(150)}}`]) {
      expect(parseLocalMathDisplay(source).issues.length).toBeGreaterThan(0);
    }
  });
});
