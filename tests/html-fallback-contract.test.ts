import { describe, expect, it } from 'vitest';
import { compileLocal, formatLocalDiagnostic, isLocalDiagnosticCode } from '../src/local';
import { sanitizeLocalHtmlDocument } from '../src/local/html';

describe('native HTML fallback diagnostic contract', () => {
  it.each([
    '<article>**literal** {{ missing }}</article>',
    '<meta name="description" content="{{ missing }}">',
    '<div unsupported="value">{{ missing }}</div>',
    '<div>Unclosed {{ missing }}',
    '<div title="unclosed',
    '<table><tr><td colspan="bad">{{ missing }}</td></tr></table>',
    '<script>window.bad = true</script>',
    '</div>',
  ])('identifies safely inert HTML without reporting an unknown component: %s', source => {
    const result = compileLocal(source);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every(d => d.code === 'local.html.fallback' && d.severity === 'warning')).toBe(true);
    expect(isLocalDiagnosticCode('local.html.fallback')).toBe(true);
    for (const diagnostic of result.diagnostics) {
      expect(formatLocalDiagnostic(diagnostic, 'en')).toBeTruthy();
      expect(formatLocalDiagnostic(diagnostic, 'zh')).toMatch(/[㐀-鿿]/);
      expect(diagnostic.range.start).toBeGreaterThanOrEqual(0);
      expect(diagnostic.range.end).toBeLessThanOrEqual(source.length);
    }
  });

  it('distinguishes component typos and fatal failures in the same document', () => {
    const mixed = compileLocal('<article>Raw</article>\n\n<slidr />');
    expect(mixed.ok).toBe(true);
    expect(mixed.diagnostics.map(d => d.code)).toEqual(['local.html.fallback', 'local.component.unknown']);
    expect(formatLocalDiagnostic(mixed.diagnostics[1], 'en')).toContain('slider');
    const fatal = compileLocal('<article>Raw</article>\n\n{{ missing }}');
    expect(fatal.ok).toBe(false);
    expect(fatal.diagnostics).toContainEqual(expect.objectContaining({severity: 'error'}));
  });

  it('marks native sanitizer fallbacks but keeps fatal errors and removals distinct', () => {
    const policy = {enableCss: true, enableJavaScript: false, enableExtendedHtml: false};
    for (const source of ['<article>Raw</article>', '<p unsupported="x">Raw</p>', '<p align="bad">Raw</p>', '<html unsupported="x"><body>Raw</body></html>']) {
      const result = sanitizeLocalHtmlDocument(source, policy, 100);
      expect(result.diagnostics.every(d => d.code === 'local.html.fallback' && d.severity === 'warning')).toBe(true);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
    expect(sanitizeLocalHtmlDocument('<script>removed()</script>', policy, 100).diagnostics[0].code).toBe('local.html.capability');
    const failed = compileLocal('<p>Over budget</p>', {...policy, limits: {maxSyntaxNodes: 1}});
    expect(failed.ok).toBe(false);
    expect(failed.diagnostics).toContainEqual(expect.objectContaining({code: 'local.budget', severity: 'error'}));
  });

  it('does not relabel an outer capability diagnostic when nested srcdoc falls back', () => {
    const source = '<p onclick="bad()">Active text</p><iframe srcdoc="&lt;p align=&quot;bad&quot;&gt;Literal&lt;/p&gt;"></iframe>';
    const result = sanitizeLocalHtmlDocument(source, {enableCss: false, enableJavaScript: false, enableExtendedHtml: true}, 100);
    expect(result.diagnostics[0].code).toBe('local.html.capability');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code: 'local.html.fallback', severity: 'warning'}));
  });
});
