import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  boundedLocalMathLiteral,
  inspectLocalMathDisplay,
  renderLocalMathDisplay,
  MAX_LOCAL_MATH_DISPLAY_DEPTH,
  MAX_LOCAL_MATH_DISPLAY_FALLBACK,
  MAX_LOCAL_MATH_DISPLAY_SOURCE,
  MAX_LOCAL_MATH_DISPLAY_TOKENS,
  MATH_DISPLAY_DIAGNOSTIC_CODE,
  MATH_DISPLAY_MESSAGE_KEYS,
} from '../src/local/math-display';
import { LatexView } from '../src/local/math-view';
import {
  isLocalDiagnosticCode,
  localDiagnosticTemplate,
  renderLocalDiagnostic,
} from '../src/local/diagnostics';

describe('math display inspection', () => {
  it('accepts display math that KaTeX supports but cannot compute', () => {
    for (const source of [
      String.raw`y = \int_0^x t^2\,dt`,
      String.raw`\Gamma=\oint_{\partial S}\mathbf{v}\times d\mathbf{l}=\iint_S\omega\,dA`,
      String.raw`\sum_{i=1}^{n} i`,
      String.raw`\frac{a}{b} + \sqrt[3]{x}`,
      String.raw`\begin{cases} 1, & x < 0 \\ 0, & \text{otherwise} \end{cases}`,
      String.raw`\begin{matrix} 1 & 2 \\ 3 & 4 \end{matrix}`,
      String.raw`\overset{!}{=}\quad\displaystyle\sum\limits_{n=1}^N n`,
      String.raw`\left( x + 1 \right)\quad\cdot 2`,
    ]) {
      expect(inspectLocalMathDisplay(source), source).toEqual([]);
    }
  });

  it('typesets with KaTeX HTML, hidden MathML and a source annotation', () => {
    const result = renderLocalMathDisplay(String.raw`\frac{a}{b}`, true);
    expect(result.issues).toEqual([]);
    expect(result.html).toContain('katex-html');
    expect(result.html).toContain('katex-mathml');
    expect(result.html).toContain('display="block"');
    expect(result.html).toContain('<mfrac>');
    expect(result.html).toContain('encoding="application/x-tex"');
    expect(result.html).toContain('application/x-tex');
  });

  it('selects inline or display mode for the renderer', () => {
    const inline = renderLocalMathDisplay('x', false);
    const block = renderLocalMathDisplay('x', true);
    expect(inline.html).not.toContain('katex-display');
    expect(block.html).toContain('katex-display');
  });

  it('reports unsupported commands with a source range into the formula body', () => {
    const source = String.raw`a\href{https://example.com}{x}`;
    const [issue, ...rest] = inspectLocalMathDisplay(source);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      reason: 'unsupported-command',
      start: 1,
      end: 6,
      code: MATH_DISPLAY_DIAGNOSTIC_CODE,
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['unsupported-command'],
      params: { name: 'href' },
    });
    expect(source.slice(issue.start, issue.end)).toBe(String.raw`\href`);
    expect(issue.message).toContain(String.raw`\href`);
    expect(renderLocalMathDisplay(source, true).html).toBeNull();
  });

  it('rejects author macro definitions and global state', () => {
    const cases: Array<[string, string]> = [
      [String.raw`\def\x{1}\x`, 'def'],
      [String.raw`\newcommand{\x}{1}`, 'newcommand'],
      [String.raw`\renewcommand{\x}{1}`, 'renewcommand'],
      [String.raw`\futurelet\x\y`, 'futurelet'],
      [String.raw`\let\x\y`, 'let'],
    ];
    for (const [source, name] of cases) {
      const issues = inspectLocalMathDisplay(source);
      expect(issues[0], source).toMatchObject({
        reason: 'unsupported-command',
        messageKey: MATH_DISPLAY_MESSAGE_KEYS['unsupported-command'],
        params: { name },
      });
      expect(renderLocalMathDisplay(source, true).html, source).toBeNull();
    }
    const global = inspectLocalMathDisplay(String.raw`\global\def\x{1}`);
    expect(global.map(issue => issue.params?.name)).toContain('global');
  });

  it('reports forbidden commands inside text groups too', () => {
    const [issue] = inspectLocalMathDisplay(String.raw`\text{\href{x}{y}}`);
    expect(issue).toMatchObject({ reason: 'unsupported-command', params: { name: 'href' } });
    expect(inspectLocalMathDisplay(String.raw`\text{\textbf{bold}}`)).toEqual([]);
  });

  it('reports unknown commands at the command itself', () => {
    const source = String.raw`x+\notARealMathCommand{y}`;
    const [issue] = inspectLocalMathDisplay(source);
    expect(issue).toMatchObject({
      reason: 'unsupported-command',
      params: { name: 'notARealMathCommand' },
    });
    expect(source.slice(issue.start, issue.end)).toBe(String.raw`\notARealMathCommand`);
    expect(renderLocalMathDisplay(source, true).html).toBeNull();
  });

  it('accepts KaTeX environments and reports unknown environments', () => {
    expect(inspectLocalMathDisplay(String.raw`\begin{matrix}1&2\\3&4\end{matrix}`)).toEqual([]);

    const source = String.raw`\begin{nosuchenv}x\end{nosuchenv}`;
    const [issue] = inspectLocalMathDisplay(source);
    expect(issue).toMatchObject({
      reason: 'unsupported-environment',
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['unsupported-environment'],
      params: { name: 'nosuchenv' },
    });
    expect(source.slice(issue.start, issue.end)).toBe(String.raw`\begin{nosuchenv}`);
  });

  it('reports malformed environments and stray end commands as syntax issues', () => {
    const unclosed = inspectLocalMathDisplay(String.raw`\begin{cases 1 & x`);
    expect(unclosed[0]).toMatchObject({
      reason: 'syntax',
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['environment-unclosed'],
      params: { name: 'cases 1 & x' },
    });
    expect(unclosed[0].start).toBe(0);

    const missing = inspectLocalMathDisplay(String.raw`\begin x`);
    expect(missing[0]).toMatchObject({
      reason: 'syntax',
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['environment-missing-name'],
    });

    const stray = inspectLocalMathDisplay(String.raw`x \end{y}`);
    expect(stray).toHaveLength(1);
    expect(stray[0]).toMatchObject({
      reason: 'syntax',
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['stray-end'],
    });
    expect(String.raw`x \end{y}`.slice(stray[0].start, stray[0].end)).toBe(String.raw`\end{y}`);

    const mismatch = inspectLocalMathDisplay(String.raw`\begin{bmatrix}1\end{pmatrix}`);
    expect(mismatch[0]?.reason).toBe('syntax');
  });

  it('reports budget fallbacks for source length, token count and nesting depth', () => {
    const tooLong = inspectLocalMathDisplay('x'.repeat(MAX_LOCAL_MATH_DISPLAY_SOURCE + 1));
    expect(tooLong).toHaveLength(1);
    expect(tooLong[0]).toMatchObject({
      reason: 'budget',
      params: { limit: MAX_LOCAL_MATH_DISPLAY_SOURCE, kind: 'source' },
    });
    expect(tooLong[0].start).toBe(0);

    const tooManyTokens = inspectLocalMathDisplay('1 '.repeat(MAX_LOCAL_MATH_DISPLAY_TOKENS + 1));
    expect(tooManyTokens).toHaveLength(1);
    expect(tooManyTokens[0]).toMatchObject({
      reason: 'budget',
      params: { limit: MAX_LOCAL_MATH_DISPLAY_TOKENS, kind: 'tokens' },
    });

    const braces = '\\sqrt{'.repeat(MAX_LOCAL_MATH_DISPLAY_DEPTH + 50);
    const tooDeep = inspectLocalMathDisplay(`${braces}x${'}'.repeat(MAX_LOCAL_MATH_DISPLAY_DEPTH + 50)}`);
    expect(tooDeep).toHaveLength(1);
    expect(tooDeep[0]).toMatchObject({
      reason: 'budget',
      params: { limit: MAX_LOCAL_MATH_DISPLAY_DEPTH, kind: 'depth' },
    });

    const prefix = String.raw`\sqrt`.repeat(MAX_LOCAL_MATH_DISPLAY_DEPTH + 20);
    const tooManyPrefixCommands = inspectLocalMathDisplay(`${prefix}x`);
    expect(tooManyPrefixCommands).toHaveLength(1);
    expect(tooManyPrefixCommands[0]).toMatchObject({
      reason: 'budget',
      params: { limit: MAX_LOCAL_MATH_DISPLAY_DEPTH, kind: 'depth' },
    });
  });

  it('does not count escaped braces or comments toward the nesting budget', () => {
    const comment = `% ${'{'.repeat(MAX_LOCAL_MATH_DISPLAY_DEPTH + 10)}\nx`;
    expect(inspectLocalMathDisplay(comment)).toEqual([]);
    const escaped = `${String.raw`\{`.repeat(MAX_LOCAL_MATH_DISPLAY_DEPTH + 10)}x`;
    expect(inspectLocalMathDisplay(escaped)).toEqual([]);
  });

  it('bounds nested environments and left/right groups before typesetting', () => {
    const depth = MAX_LOCAL_MATH_DISPLAY_DEPTH + 1;
    for (const source of [
      `${String.raw`\begin{matrix}`.repeat(depth)}x${String.raw`\end{matrix}`.repeat(depth)}`,
      `${String.raw`\left(`.repeat(depth)}x${String.raw`\right)`.repeat(depth)}`,
    ]) {
      const result = renderLocalMathDisplay(source, true);
      expect(result.html).toBeNull();
      expect(result.issues[0]).toMatchObject({reason: 'budget', params: {kind: 'depth'}});
    }
  });

  it('bounds literal fallback text', () => {
    const long = 'x'.repeat(MAX_LOCAL_MATH_DISPLAY_FALLBACK + 1);
    expect(boundedLocalMathLiteral(long)).toBe(`${'x'.repeat(MAX_LOCAL_MATH_DISPLAY_FALLBACK)}…`);
    expect(boundedLocalMathLiteral('x')).toBe('x');
  });

  it('uses the actual display mode for tags', () => {
    expect(inspectLocalMathDisplay(String.raw`x\tag{A}`)).toEqual([]);
    const inline = inspectLocalMathDisplay(String.raw`x\tag{A}`, false);
    expect(inline).toHaveLength(1);
    expect(inline[0].reason).toBe('syntax');
  });

  it('never throws when rendering fails', () => {
    for (const source of [
      String.raw`\begin{cases}`,
      String.raw`\begin{nosuchenv}`,
      String.raw`\notARealMathCommand`,
      String.raw`\href{x}{y}`,
      'x'.repeat(MAX_LOCAL_MATH_DISPLAY_SOURCE + 1),
      `${String.raw`\sqrt`.repeat(MAX_LOCAL_MATH_DISPLAY_DEPTH + 20)}x`,
    ]) {
      expect(() => renderLocalMathDisplay(source, true), source).not.toThrow();
      const result = renderLocalMathDisplay(source, true);
      expect(result.html, source).toBeNull();
      expect(result.issues.length, source).toBeGreaterThan(0);
    }
  });

  it('renders KaTeX HTML in the React view and keeps fallback text inert', () => {
    const rendered = renderToStaticMarkup(
      createElement(LatexView, { source: String.raw`\frac{a}{b}`, display: true }),
    );
    expect(rendered).toContain('local-math-block');
    expect(rendered).toContain('katex-html');
    expect(rendered).toContain('katex-mathml');
    expect(rendered).not.toContain('local-math-fallback');

    const unsafe = String.raw`a\href{https://example.com}{<script>alert(1)</script>}`;
    const fallback = renderToStaticMarkup(
      createElement(LatexView, { source: unsafe, display: true }),
    );
    expect(fallback).toContain('local-math-fallback');
    expect(fallback).toContain(String.raw`\href`);
    expect(fallback).not.toContain('href=');
    expect(fallback).not.toContain('<script>');
  });
});

describe('math display diagnostics contract', () => {
  it('registers the code and every message key in English and Chinese', () => {
    expect(isLocalDiagnosticCode(MATH_DISPLAY_DIAGNOSTIC_CODE)).toBe(true);
    for (const key of Object.values(MATH_DISPLAY_MESSAGE_KEYS)) {
      const en = localDiagnosticTemplate(key, 'en');
      const zh = localDiagnosticTemplate(key, 'zh');
      expect(en, key).toBeTypeOf('string');
      expect(zh, key).toBeTypeOf('string');
      expect(en!.length).toBeGreaterThan(0);
      expect(zh).toMatch(/[㐀-鿿]/);
    }
  });

  it('keeps the backslash visible when rendering the command name', () => {
    const [issue] = inspectLocalMathDisplay(String.raw`\href{x}{y}`);
    expect(renderLocalDiagnostic(issue.messageKey, 'en', issue.params)).toContain(String.raw`\href`);
    expect(renderLocalDiagnostic(issue.messageKey, 'zh', issue.params)).toContain('href');
  });
});
