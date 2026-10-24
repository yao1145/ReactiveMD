import { describe, expect, it } from 'vitest';
import {
  LOCAL_DIAGNOSTIC_CODES,
  compileLocal,
  createLocalRuntime,
  formatLocalDiagnostic,
  isLocalDiagnosticCode,
  localDiagnosticTemplate,
  localDiagnosticTemplateKeys,
} from '../src/local';
import existingCodes from './fixtures/diagnostic-codes-0.4.json';
import type { Diagnostic } from '../src/local';

function compileDiagnostics(source: string): Diagnostic[] {
  return compileLocal(source).diagnostics;
}

describe('central diagnostic registry', () => {
  it('registers every message key with distinct English and Chinese templates', () => {
    expect(new Set(localDiagnosticTemplateKeys).size).toBe(localDiagnosticTemplateKeys.length);
    for (const key of localDiagnosticTemplateKeys) {
      const en = localDiagnosticTemplate(key, 'en');
      const zh = localDiagnosticTemplate(key, 'zh');
      expect(en, key).toBeTypeOf('string');
      expect(zh, key).toBeTypeOf('string');
      expect(en!.length, key).toBeGreaterThan(0);
      expect(zh!.length, key).toBeGreaterThan(0);
      expect(zh, key).toMatch(/[㐀-鿿]/);
    }
  });

  it('exposes a unique code list that contains the 0.4 compatibility surface', () => {
    expect(new Set(LOCAL_DIAGNOSTIC_CODES).size).toBe(LOCAL_DIAGNOSTIC_CODES.length);
    expect(LOCAL_DIAGNOSTIC_CODES).toEqual(expect.arrayContaining(existingCodes));
    for (const code of existingCodes) expect(isLocalDiagnosticCode(code), code).toBe(true);
    expect(LOCAL_DIAGNOSTIC_CODES).toContain('local.expression.expression-syntax');
    expect(isLocalDiagnosticCode('host.unknown')).toBe(false);
  });

  it('localizes parser, compiler, expression, LaTeX, runtime and theme diagnostics', () => {
    const diagnostics: Diagnostic[] = [
      ...compileDiagnostics('<slidr />'),
      ...compileDiagnostics('<panel title="Hello">'),
      ...compileDiagnostics('<input bind="n" label="Name" initial="abc" max-length="1">'),
      ...compileDiagnostics('{{ count + }}'),
      ...compileDiagnostics('<plot label="Curve">\n$$ y = \\int x $$\n</plot>'),
    ];
    const runtimeResult = compileLocal('<textarea bind="text" label="Text" max-length="1">');
    expect(runtimeResult.ok).toBe(true);
    if (runtimeResult.ok) {
      const runtime = createLocalRuntime(runtimeResult.document);
      try {
        const control = runtimeResult.document.nodes.find(node => node.name === 'textarea')!;
        diagnostics.push(...runtime.set(control, '😀a'));
      } finally {
        runtime.dispose();
      }
    }

    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      const before = structuredClone(diagnostic);
      const en = formatLocalDiagnostic(diagnostic, 'en');
      const zh = formatLocalDiagnostic(diagnostic, 'zh');
      expect(en.length).toBeGreaterThan(0);
      expect(zh).toMatch(/[㐀-鿿]/);
      expect(zh.length).toBeLessThanOrEqual(2_000);
      expect(diagnostic).toEqual(before);
      expect(LOCAL_DIAGNOSTIC_CODES).toContain(diagnostic.code);
    }
  });

  it('preserves parameters as readable context across languages', () => {
    const unknown = compileDiagnostics('<slidr />')[0];
    expect(formatLocalDiagnostic(unknown, 'en')).toContain('slider');
    expect(formatLocalDiagnostic(unknown, 'zh')).toContain('slider');

    const expression = compileDiagnostics('{{ count + }}')[0];
    expect(expression.code).toBe('local.expression.expression-syntax');
    expect(formatLocalDiagnostic(expression, 'en')).toContain('Expression error');
    expect(formatLocalDiagnostic(expression, 'zh')).toContain('表达式错误');
  });

  it('keeps unknown host diagnostics verbatim', () => {
    const host: Diagnostic = {
      code: 'host.custom',
      message: 'Host says no.',
      severity: 'warning',
      range: { start: 1, end: 2 },
      line: 1,
      column: 2,
    };
    expect(formatLocalDiagnostic(host, 'en')).toBe(host.message);
    expect(formatLocalDiagnostic(host, 'zh')).toBe(host.message);
  });

  it('keeps the default English message backwards compatible', () => {
    const diagnostic = compileDiagnostics('{{ missing }}')[0];
    expect(formatLocalDiagnostic(diagnostic)).toBe(diagnostic.message);
    expect(formatLocalDiagnostic(diagnostic, 'zh')).toContain('missing');
  });
});
