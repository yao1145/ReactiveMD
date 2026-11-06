import { describe, expect, it } from 'vitest';
import { CompilerConfigurationError, createCompiler } from '../src/compiler/index';
import { createStandardCompiler } from '../src/compiler/standard';
import { MINIMAL_CHECKS, toCompileResult } from '../src/compiler/result';
import { compileLocal } from '../src/local/compilation/compiler';
import { localCompileOptionsKey, readLocalCompileOptions } from '../src/local/configuration/options';
import { LOCAL_RECOVERY_STRATEGY_VERSION } from '../src/local/configuration/options-core';
import { formatLocalDiagnostic } from '../src/local/configuration/diagnostics';
import type { LocalCompileOptions, LocalCompileResult, LocalRecovery } from '../src/local/contracts/types';

function effectiveStrict(options?: LocalCompileOptions): boolean {
  const check = readLocalCompileOptions(options);
  if (!check.ok) throw new Error(check.message);
  return check.strict;
}

const NO_RECOVERY: LocalRecovery = {
  code: 'local.recovery.test',
  causeRange: { start: 0, end: 1 },
  affectedRange: { start: 0, end: 1 },
  action: 'literal-fallback',
  boundary: 'eof',
};

describe('strict option', () => {
  it('defaults to true when omitted or undefined', () => {
    expect(effectiveStrict()).toBe(true);
    expect(effectiveStrict({})).toBe(true);
    expect(effectiveStrict({ strict: undefined })).toBe(true);
    expect(effectiveStrict({ strict: true })).toBe(true);
    expect(effectiveStrict({ strict: false })).toBe(false);
  });

  it('rejects every non-boolean value in the legacy entry', () => {
    for (const value of ['yes', 0, 1, null, {}, []]) {
      const result = compileLocal('hello', { strict: value } as unknown as LocalCompileOptions);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([expect.objectContaining({
        code: 'local.options.invalid',
        messageKey: 'local.options.invalid.strict',
        message: 'Compile option strict must be a boolean.',
      })]);
      expect('recoveries' in result).toBe(false);
    }
  });

  it('throws CompilerConfigurationError from both factories', () => {
    for (const factory of [createCompiler, createStandardCompiler]) {
      expect(() => factory({ strict: 'yes' } as unknown as LocalCompileOptions)).toThrow(CompilerConfigurationError);
      try {
        factory({ strict: 'yes' } as unknown as LocalCompileOptions);
      } catch (error) {
        expect(error).toBeInstanceOf(CompilerConfigurationError);
        expect((error as CompilerConfigurationError).code).toBe('local.options.invalid.strict');
      }
    }
  });

  it('localizes the strict configuration diagnostic', () => {
    const result = compileLocal('hello', { strict: 'false' } as unknown as LocalCompileOptions);
    expect(formatLocalDiagnostic(result.diagnostics[0], 'zh')).toBe('编译选项 strict 必须为布尔值。');
  });

  it('keeps the historical result for an explicit strict true', () => {
    expect(compileLocal('hello', { strict: true })).toEqual(compileLocal('hello'));
    expect('recoveries' in compileLocal('hello')).toBe(false);
  });
});

describe('strict option key', () => {
  it('treats omission, undefined and true as one identity', () => {
    const omitted = localCompileOptionsKey({});
    expect(localCompileOptionsKey()).toBe(omitted);
    expect(localCompileOptionsKey({ strict: undefined })).toBe(omitted);
    expect(localCompileOptionsKey({ strict: true })).toBe(omitted);
  });

  it('separates false and invalid values from every valid mode', () => {
    const strict = localCompileOptionsKey({});
    const loose = localCompileOptionsKey({ strict: false });
    const invalid = localCompileOptionsKey({ strict: 'yes' } as unknown as LocalCompileOptions);
    expect(loose).not.toBe(strict);
    expect(invalid).not.toBe(strict);
    expect(invalid).not.toBe(loose);
  });

  it('carries the recovery strategy version only in the loose identity', () => {
    const loose = localCompileOptionsKey({ strict: false });
    expect(loose).toContain(`recovery=${LOCAL_RECOVERY_STRATEGY_VERSION}`);
    expect(localCompileOptionsKey({ strict: true })).not.toContain('recovery=');
  });

  it('pins the current recovery strategy version and leaves strict identity unchanged', () => {
    expect(LOCAL_RECOVERY_STRATEGY_VERSION).toBe('2');
    expect(localCompileOptionsKey({ strict: false })).toContain('recovery=2');
    expect(localCompileOptionsKey({ strict: true })).toBe(localCompileOptionsKey());
  });
});

describe('factory result contract', () => {
  it('publishes valid status with task-one aliases and a frozen program copy', () => {
    const result = createCompiler().compile('# Title');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('valid');
    if (!result.ok) return;
    expect(result.document.syntax).toBe('local');
    expect(result.diagnostics).toEqual([]);
    expect(result.recoveries).toEqual([]);
    expect(result.checks).toEqual({ optional: [] });
    expect(result.program).not.toBe(result.document);
    expect(result.program.nodes).not.toBe(result.document.nodes);
    expect(Object.isFrozen(result.program)).toBe(true);
    expect(Object.isFrozen(result.program.nodes)).toBe(true);
    expect(Object.isFrozen(result.program.nodes[0])).toBe(true);
    expect(Object.isFrozen(result.document)).toBe(false);
    expect(Object.isFrozen(result.document.nodes)).toBe(false);
    expect(() => {
      (result.program.nodes as unknown[]).length = 0;
    }).toThrow(TypeError);
    // The legacy alias stays a usable, mutable document.
    result.document.nodes.length = 0;
    expect(result.program.nodes.length).toBeGreaterThan(0);
  });

  it('reports the standard optional check without enabling others', () => {
    const result = createStandardCompiler().compile('# Title');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checks).toEqual({ optional: [{ id: 'math-display', version: '1' }] });
  });

  it('returns failed without a program for source errors', () => {
    const result = createCompiler().compile('<computed name="value" value="{{ missing }}">');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect('program' in result).toBe(false);
    expect('document' in result).toBe(false);
    expect(result.recoveries).toEqual([]);
  });

  it('marks a pass recovered only when recoveries were actually produced', () => {
    const base = compileLocal('# Title') as Extract<LocalCompileResult, { ok: true }>;
    const recovered = toCompileResult({ ...base, recoveries: [NO_RECOVERY] }, MINIMAL_CHECKS);
    expect(recovered.ok).toBe(true);
    expect(recovered.status).toBe('recovered');
    expect(recovered.recoveries).toEqual([NO_RECOVERY]);

    const failed = toCompileResult({ ok: false, diagnostics: [], recoveries: [NO_RECOVERY] }, MINIMAL_CHECKS);
    expect(failed.ok).toBe(false);
    expect(failed.status).toBe('failed');
    expect(failed.recoveries).toEqual([NO_RECOVERY]);
    expect('program' in failed).toBe(false);
  });
});
