import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  inspectLocalMathDisplay,
  parseLocalMathDisplay,
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
  it('accepts display math that is supported but not computable', () => {
    for (const source of [
      'y = \\int_0^x t^2\\,dt',
      '\\sum_{i=1}^{n} i',
      '\\frac{a}{b} + \\sqrt[3]{x}',
      '\\begin{cases} 1, & x < 0 \\\\ 0, & \\text{otherwise} \\end{cases}',
      '\\left( x + 1 \\right)\\quad\\cdot 2',
    ]) {
      expect(inspectLocalMathDisplay(source), source).toEqual([]);
    }
  });

  it('reports unsupported commands with a source range into the formula body', () => {
    const source = 'a\\href{https://example.com}{x}';
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
    expect(source.slice(issue.start, issue.end)).toBe('\\href');
    expect(issue.message).toContain('\\href');
  });

  it('does not flag commands inside raw text groups', () => {
    expect(inspectLocalMathDisplay('\\text{\\href{x}{y}}')).toEqual([]);
    expect(inspectLocalMathDisplay('\\operatorname{\\unknown}')).toEqual([]);
  });

  it('reports unsupported environments and keeps the literal fallback', () => {
    const source = '\\begin{matrix} a \\end{matrix}';
    const issues = inspectLocalMathDisplay(source);
    const environment = issues.find(issue => issue.reason === 'unsupported-environment')!;
    expect(environment.params).toMatchObject({ name: 'matrix' });
    expect(source.slice(environment.start, environment.end)).toBe('\\begin{matrix}');
    expect(environment.messageKey).toBe(MATH_DISPLAY_MESSAGE_KEYS['unsupported-environment']);

    const html = renderToStaticMarkup(createElement(LatexView, { source, display: true }));
    expect(html).toContain('\\begin{matrix}');
    expect(html).not.toContain('<mtable');
  });

  it('reports malformed environments and stray end commands as syntax issues', () => {
    const unclosed = inspectLocalMathDisplay('\\begin{cases 1 & x');
    expect(unclosed[0]).toMatchObject({
      reason: 'syntax',
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['environment-unclosed'],
      params: { name: 'cases 1 & x' },
    });
    expect(unclosed[0].start).toBe(0);

    const missing = inspectLocalMathDisplay('\\begin x');
    expect(missing[0]).toMatchObject({
      reason: 'syntax',
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['environment-missing-name'],
    });

    const stray = inspectLocalMathDisplay('x \\end{y}');
    expect(stray).toHaveLength(1);
    expect(stray[0]).toMatchObject({
      reason: 'syntax',
      messageKey: MATH_DISPLAY_MESSAGE_KEYS['stray-end'],
    });
    expect('x \\end{y}'.slice(stray[0].start, stray[0].end)).toBe('\\end{y}');
  });

  it('reports budget fallbacks for source length, token count and nesting depth', () => {
    const tooLong = inspectLocalMathDisplay('x'.repeat(50_001));
    expect(tooLong).toHaveLength(1);
    expect(tooLong[0]).toMatchObject({ reason: 'budget', params: { limit: 50_000, kind: 'source' } });
    expect(tooLong[0].start).toBe(0);

    const tooManyTokens = inspectLocalMathDisplay('1 '.repeat(20_001));
    expect(tooManyTokens).toHaveLength(1);
    expect(tooManyTokens[0]).toMatchObject({ reason: 'budget', params: { limit: 20_000, kind: 'tokens' } });

    const tooDeep = inspectLocalMathDisplay(`${'\\sqrt{'.repeat(200)}x${'}'.repeat(200)}`);
    expect(tooDeep).toHaveLength(1);
    expect(tooDeep[0]).toMatchObject({ reason: 'budget', params: { limit: 120, kind: 'depth' } });
  });

  it('returns a literal-fallback parse for budget exhaustion but a tree for supported input', () => {
    expect(parseLocalMathDisplay('\\frac{a}{b}').node).toMatchObject({ tag: 'mfrac' });
    expect(parseLocalMathDisplay('x'.repeat(50_001)).node).toBeNull();
    expect(parseLocalMathDisplay('\\begin{matrix} a \\end{matrix}').node).not.toBeNull();
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
    const [issue] = inspectLocalMathDisplay('\\href{x}{y}');
    expect(renderLocalDiagnostic(issue.messageKey, 'en', issue.params)).toContain('\\href');
    expect(renderLocalDiagnostic(issue.messageKey, 'zh', issue.params)).toContain('href');
  });
});
