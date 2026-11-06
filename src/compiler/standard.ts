/**
 * Standard single-pass compiler entry.
 *
 * Same result contract as the minimal factory, but wired to the full
 * experience: the default component preset is supplied explicitly and the
 * KaTeX display precheck stays on. It is the single-pass counterpart of the
 * legacy `compileLocal` without sessions, workers, React or theme loading.
 */
import type { LocalCompileOptions, LocalCompileResult } from '../local/types';
import type { LocalOptionCheck } from '../local/options-core';
import { compileLocalCore } from '../local/compiler-core';
import { plainCompiledData } from '../local/compiled-data';
import { inspectLocalMathDisplay } from '../local/math-display';
import { readCompilerOptions } from '../local/options-core';
import { defaultPreset } from '../presets/default';
import { CompilerConfigurationError, type Compiler } from './types';

export { CompilerConfigurationError } from './types';
export type { Compiler, CompilerConfigurationErrorOptions } from './types';
export type { LocalCompileOptions, LocalCompileResult } from '../local/types';

function requireOptions(options?: LocalCompileOptions): Extract<LocalOptionCheck, { ok: true }> {
  const check = readCompilerOptions(options, defaultPreset.components);
  if (check.ok) return check;
  throw new CompilerConfigurationError(check.message, {
    code: check.key,
    ...(check.detail === undefined ? {} : { detail: check.detail }),
  });
}

function snapshotOptions(options?: LocalCompileOptions): LocalCompileOptions | undefined {
  return options === undefined ? undefined : Object.freeze({ ...options });
}

export function createStandardCompiler(options?: LocalCompileOptions): Compiler {
  const optionCheck = requireOptions(options);
  const snapshot = snapshotOptions(options);
  // A stable inspector object: the precheck is pure and has no session state.
  const services = { display: inspectLocalMathDisplay };
  return {
    compile(source: string): LocalCompileResult {
      return plainCompiledData(compileLocalCore(source, snapshot, optionCheck, services));
    },
  };
}
