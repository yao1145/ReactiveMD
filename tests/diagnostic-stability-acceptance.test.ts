import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileLocal, createLocalRuntime, formatLocalDiagnostic, LOCAL_DIAGNOSTIC_CODES } from '../src/local';
import existingCodes from './fixtures/diagnostic-codes-0.4.json';

describe('0.4 diagnostic compatibility', () => {
  it('keeps existing codes registered and unique', () => {
    expect(LOCAL_DIAGNOSTIC_CODES).toEqual(expect.arrayContaining(existingCodes));
    expect(new Set(LOCAL_DIAGNOSTIC_CODES).size).toBe(LOCAL_DIAGNOSTIC_CODES.length);
  });

  it('requires literal codes at core reporting and error sites to be registered', () => {
    const patterns = [
      /\b(?:report|error|warning|fallback|diagnostic|LocalExpressionError|LocalBudgetError|LatexError)\(\s*['"]((?:local\.|expression-|latex-)[a-z.-]+)['"]/g,
      /\bdiagnosticFor\([^,]+,[^,]+,\s*['"](local\.[a-z.-]+)['"]/g,
      /\bcode:\s*['"]((?:local\.|expression-|latex-)[a-z.-]+)['"]/g,
    ];
    for (const file of ['parser', 'compiler', 'runtime', 'theme', 'expression', 'math']) {
      const source = readFileSync(new URL(`../src/local/${file}.ts`, import.meta.url), 'utf8');
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          expect(LOCAL_DIAGNOSTIC_CODES, `${file}: ${match[1]}`).toContain(match[1]);
        }
      }
    }
  });

  it('locates a reference after an astral character and CRLF in original UTF-16 units', () => {
    const source = '😀\r\n😀 {{ missing }}';
    const diagnostic = compileLocal(source).diagnostics.find(item => item.code === 'local.binding.unknown')!;
    expect(diagnostic).toMatchObject({ line: 2, column: 7, range: { start: source.indexOf('missing') } });
    expect(formatLocalDiagnostic(diagnostic, 'zh')).toContain('missing');
  });

  it('retains a true error after parser warnings fill the diagnostic budget', () => {
    const source = '<future />\n'.repeat(100) + '{{ missing }}';
    const result = compileLocal(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(100);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'local.binding.unknown', severity: 'error' }),
    ]));
    for (const diagnostic of result.diagnostics) {
      expect(formatLocalDiagnostic(diagnostic, 'zh')).toMatch(/[\u3400-\u9fff]/);
    }
  });

  it('localizes the structured reason of a rejected UTF-16 value budget', () => {
    const result = compileLocal('<input bind="text" label="Text">');
    if (!result.ok) throw new Error('Expected a valid control');
    const runtime = createLocalRuntime(result.document);
    try {
      const control = result.document.nodes.find(node => node.name === 'input')!;
      const [diagnostic] = runtime.set(control, '😀'.repeat(50_001));
      expect(diagnostic.code).toBe('local.runtime.value');
      const zh = formatLocalDiagnostic(diagnostic, 'zh');
      expect(zh).toContain('100000');
      expect(zh).not.toMatch(/String|exceeds|limit/);
      expect(runtime.snapshot().revision).toBe(0);
    } finally { runtime.dispose(); }
  });

  it.each([
    '<number bind="count" label="Count">\n\n{{ count + }}',
    '<plot label="Curve">\n$$ y = \\int x $$\n</plot>',
  ])('localizes nested built-in error details as well as the outer notice: %s', source => {
    const diagnostics = compileLocal(source).diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(formatLocalDiagnostic(diagnostic, 'zh')).not.toMatch(/Expected|Unexpected|Cannot|must be|not supported/i);
    }
  });

  it.each([
    '<slidr />',
    '<input bind="n" label="Name" initial="abc" max-length="1">',
    '<panel title="Hello">',
    '<number bind="count" label="Count">\r\n\r\n😀 {{ missing }}',
    '<number bind="count" label="Count">\n\n{{ count + }}',
    '<plot label="Curve">\n$$ y = \\int x $$\n</plot>',
  ])('localizes structured diagnostics without mutating source positions: %s', source => {
    const diagnostics = compileLocal(source).diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      const before = structuredClone(diagnostic);
      const en = formatLocalDiagnostic(diagnostic, 'en');
      const zh = formatLocalDiagnostic(diagnostic, 'zh');
      expect(en.length).toBeGreaterThan(0);
      expect(zh).toMatch(/[\u3400-\u9fff]/);
      expect(zh.length).toBeLessThanOrEqual(2000);
      expect(diagnostic).toEqual(before);
      expect(LOCAL_DIAGNOSTIC_CODES).toContain(diagnostic.code);
    }
  });
});
