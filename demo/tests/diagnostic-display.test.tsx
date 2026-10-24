import { describe, expect, it } from 'vitest';
import {
  compileLocal,
  countLocalCodePoints,
  formatLocalDiagnostic,
  type Diagnostic,
} from 'reactive-md';

/**
 * The playground renders compiler/runtime diagnostics through
 * `formatLocalDiagnostic` while leaving the structured fields untouched. These
 * checks use the built public package, the same import path as the demo.
 */
describe('playground diagnostic display contract', () => {
  it('switches display language without changing code, severity or range', () => {
    const result = compileLocal('{{ absent }}');
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics[0] as Diagnostic;
    const english = formatLocalDiagnostic(diagnostic, 'en');
    const chinese = formatLocalDiagnostic(diagnostic, 'zh');

    expect(english).toContain('undeclared parameter');
    expect(chinese).toContain('未声明');
    expect(chinese).not.toBe(english);

    // The demo keys diagnostics and their source positions by these fields; a
    // language switch must not invalidate the worker cache or navigation.
    expect(formatLocalDiagnostic(diagnostic, 'en')).toBe(english);
    expect(diagnostic.code).toBe('local.binding.unknown');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.range.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic.line).toBe(1);
  });

  it('falls back to the original host message for unknown codes', () => {
    const host: Diagnostic = {
      code: 'host.custom',
      message: 'Host-owned message',
      severity: 'warning',
      range: { start: 4, end: 8 },
      line: 2,
      column: 3,
    };
    expect(formatLocalDiagnostic(host, 'zh')).toBe('Host-owned message');
  });

  it('counts emoji as one code point for the shared length rule', () => {
    expect(countLocalCodePoints('😀')).toBe(1);
    expect(countLocalCodePoints('👩‍💻')).toBe(3);
    expect(countLocalCodePoints('\ud800')).toBe(1);
  });
});
