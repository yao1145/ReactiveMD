import { describe, expect, it } from 'vitest';
import { createStandardCompiler } from '../src/compiler/standard';
import { compileLocal } from '../src/local/compilation/compiler';
import {
  LOCAL_DIAGNOSTIC_CODES,
  formatLocalDiagnostic,
  isLocalDiagnosticCode,
  localDiagnosticTemplate,
} from '../src/local/configuration/diagnostics';
import { parseLocal } from '../src/local/parsing/parser';
import type { Diagnostic, LocalCompileOptions } from '../src/local/contracts/types';

const RECOVERY_WARNING_CODES = [
  'local.recovery.unclosed',
  'local.recovery.mismatch',
  'local.recovery.stray-close',
  'local.html.repair',
  'local.html.literal',
] as const;

type RecoveryWarningCode = (typeof RECOVERY_WARNING_CODES)[number];

interface TreeNode {
  type: string;
  depth?: number;
  name?: string;
  value?: string;
  children?: readonly TreeNode[];
}

const flatten = (nodes: readonly TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

const recoveryKey = (code: string, range: { start: number; end: number }): string => `${code}@${range.start}-${range.end}`;

function recoveryWarnings(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'warning' && RECOVERY_WARNING_CODES.includes(diagnostic.code as RecoveryWarningCode),
  );
}

function expectWarningMatchesRecovery(warning: Diagnostic, code: string, range: { start: number; end: number }): void {
  expect(warning).toMatchObject({ code, severity: 'warning', range });
  expect(warning.messageKey).toBeTypeOf('string');
  expect(warning.messageKey!.length).toBeGreaterThan(0);
  const zh = formatLocalDiagnostic(warning, 'zh');
  expect(zh).toMatch(/[㐀-鿿]/);
  expect(zh).not.toBe(warning.message);
}

describe('recovery warning registry', () => {
  it('registers all five recovery codes with bilingual templates', () => {
    for (const code of RECOVERY_WARNING_CODES) {
      expect(LOCAL_DIAGNOSTIC_CODES).toContain(code);
      expect(isLocalDiagnosticCode(code)).toBe(true);
      const en = localDiagnosticTemplate(code, 'en');
      const zh = localDiagnosticTemplate(code, 'zh');
      expect(en, code).toBeTypeOf('string');
      expect(en!.length, code).toBeGreaterThan(0);
      expect(zh ?? '', code).toMatch(/[㐀-鿿]/);
      expect(zh ?? '', code).not.toBe(en);
    }
  });
});

describe('loose recovery warnings', () => {
  it('emits one localized warning at the recovery cause with raw UTF-16 positions', () => {
    const source = '😀 前\r\n<card>\r\n隐藏 {{ ghost }}\r\n\r\n## 后续\r\n\r\n后文';
    const parsed = parseLocal(source, { strict: false });

    expect(parsed.recoveries).toHaveLength(1);
    const [recovery] = parsed.recoveries!;
    expect(recovery.code).toBe('local.recovery.unclosed');
    const warnings = recoveryWarnings(parsed.diagnostics);
    expect(warnings).toHaveLength(1);
    expectWarningMatchesRecovery(warnings[0], recovery.code, recovery.causeRange);
    expect(warnings[0].line).toBe(2);
    expect(warnings[0].column).toBe(1);
    expect(source.slice(warnings[0].range.start, warnings[0].range.end)).toBe('<card>');
  });

  it('keeps strict errors and undamaged loose sources free of recovery warnings', () => {
    const damaged = '<card>\n正文';
    const strict = parseLocal(damaged);
    expect(strict.recoveries).toBeUndefined();
    expect(recoveryWarnings(strict.diagnostics)).toEqual([]);
    expect(strict.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.tag.unclosed',
      severity: 'error',
    }));

    const valid = parseLocal('<card>\n\n## 内部\n\n正文\n\n</card>\n\n后文', { strict: false });
    expect(valid.recoveries).toBeUndefined();
    expect(valid.diagnostics).toEqual([]);
    expect(recoveryWarnings(valid.diagnostics)).toEqual([]);

    const compiled = createStandardCompiler({ strict: false }).compile('# Title');
    expect(compiled.ok).toBe(true);
    expect(compiled.status).toBe('valid');
    expect(recoveryWarnings(compiled.diagnostics)).toEqual([]);
  });

  it('marks a successful factory pass recovered while program content outside the region renders', () => {
    const source = '<card>\n隐藏 {{ ghost }}\n\n## 后续\n\n后文 **粗体**\n';
    const result = createStandardCompiler({ strict: false }).compile(source);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('recovered');
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(result.recoveries).toHaveLength(1);
    expect(result.recoveries[0].code).toBe('local.recovery.unclosed');
    const warnings = recoveryWarnings(result.diagnostics);
    expect(warnings).toHaveLength(1);
    expectWarningMatchesRecovery(warnings[0], result.recoveries[0].code, result.recoveries[0].causeRange);
    if (!result.ok) return;

    const documentNodes = flatten(result.document.nodes);
    expect(documentNodes.some((node) => node.type === 'fallback')).toBe(true);
    expect(documentNodes.some((node) => node.type === 'interpolation')).toBe(false);
    expect(documentNodes.find((node) => node.type === 'heading')?.depth).toBe(2);
    expect(documentNodes.some((node) => node.type === 'strong')).toBe(true);
    expect(result.document.bindings.ghost).toBeUndefined();
    expect(result.document.initialState.ghost).toBeUndefined();

    const programNodes = flatten(result.program.nodes);
    expect(programNodes.some((node) => node.type === 'heading' && node.depth === 2)).toBe(true);
    expect(programNodes.some((node) => node.type === 'strong')).toBe(true);
    expect(programNodes.some((node) => node.type === 'fallback')).toBe(true);
  });

  it('keeps expressions and declarations inside a literal fallback inert', () => {
    const source = '<card>\n<computed name="inside" value="1">\n{{ ghost }}\n<input bind="ghost" label="Ghost">\n\n## 后续\n\n<counter bind="count" label="计数">';
    const result = createStandardCompiler({ strict: false }).compile(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = flatten(result.document.nodes);
    const fallback = nodes.find((node) => node.type === 'fallback');
    expect(fallback?.value).toContain('<computed name="inside"');
    expect(fallback?.value).toContain('{{ ghost }}');
    expect(nodes.some((node) => node.type === 'interpolation')).toBe(false);
    expect(nodes.some((node) => node.type === 'component' && node.name === 'input')).toBe(false);
    expect(result.document.bindings.ghost).toBeUndefined();
    expect(result.document.computations?.inside).toBeUndefined();
    expect(result.document.bindings.count).toBeTruthy();
  });
});

describe('recovery warnings do not mask failures', () => {
  it('keeps semantic errors as errors and the pass failed alongside a recovery', () => {
    const source = '<card>\n隐藏 {{ ghost }}\n\n## 后续\n\n{{ missing }}';
    const result = createStandardCompiler({ strict: false }).compile(source);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.recoveries.length).toBeGreaterThan(0);
    expect(recoveryWarnings(result.diagnostics).length).toBeGreaterThan(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.binding.unknown',
      severity: 'error',
    }));
    expect('program' in result).toBe(false);
  });

  it('keeps version errors as errors and the pass failed alongside a recovery', () => {
    const source = '<!-- reactive-md: local-draft-99 -->\n\n<card>\n隐藏\n\n## 后续';
    const result = createStandardCompiler({ strict: false }).compile(source);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.recoveries.length).toBeGreaterThan(0);
    expect(recoveryWarnings(result.diagnostics).length).toBeGreaterThan(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.version.unsupported',
      severity: 'error',
    }));
  });

  it('keeps budget errors as errors and the pass failed alongside a recovery', () => {
    const source = '<card>\n隐藏 {{ ghost }}\n\n## 后续\n\n后文 **粗体**';
    const result = createStandardCompiler({ strict: false, limits: { maxSyntaxNodes: 1 } }).compile(source);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.recoveries.length).toBeGreaterThan(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.budget',
      severity: 'error',
    }));
  });

  it('keeps option/config errors before parsing and reports no recovery', () => {
    const options = {
      config: {},
      hostComponents: [],
    } as unknown as LocalCompileOptions;
    const result = compileLocal('<card>\n隐藏\n\n## 后续', options);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.options.invalid',
      severity: 'error',
    }));
    expect(result.recoveries ?? []).toEqual([]);
    expect(recoveryWarnings(result.diagnostics)).toEqual([]);
  });
});

describe('recovery warning limits', () => {
  it('retains a later semantic error when recovery warnings fill the budget', () => {
    const result = compileLocal('</x>\n'.repeat(150) + '\n{{ missing }}', { strict: false });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeLessThanOrEqual(100);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.binding.unknown',
      severity: 'error',
    }));
  });

  it('never duplicates a warning and preserves errors when the diagnostic budget fills', () => {
    const source = '<!-- reactive-md: local-draft-99 -->\n\n' + '</x>\n'.repeat(150);
    const parsed = parseLocal(source, { strict: false });

    expect(parsed.recoveries).toHaveLength(150);
    expect(parsed.diagnostics.length).toBeLessThanOrEqual(100);
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'local.version.unsupported',
      severity: 'error',
    }));

    const warnings = recoveryWarnings(parsed.diagnostics);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.length).toBeLessThanOrEqual(99);
    const recoveryKeys = new Set(parsed.recoveries!.map((recovery) => recoveryKey(recovery.code, recovery.causeRange)));
    const warningKeys = warnings.map((warning) => recoveryKey(warning.code, warning.range));
    expect(new Set(warningKeys).size).toBe(warningKeys.length);
    for (const key of warningKeys) expect(recoveryKeys.has(key)).toBe(true);
  });
});
