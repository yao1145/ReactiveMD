/**
 * Minimal single-pass compiler entry.
 *
 * The minimal factory installs no default component preset: only the kernel
 * language declarations (theme/computed/const/external), Markdown/RMD body,
 * semantic checks and budgets remain. The KaTeX display precheck is omitted;
 * `compiler/standard` keeps the full experience.
 *
 * The factory validates options once and snapshots them. `compile` performs
 * only the semantic pass: it creates no runtime, session, worker, timer or
 * cross-source cache.
 */
import type { LocalCompileOptions, LocalCompileResult } from '../local/types';
import type { LocalOptionCheck } from '../local/options-core';
import { compileLocalCore } from '../local/compiler-core';
import { plainCompiledData } from '../local/compiled-data';
import { readCompilerOptions } from '../local/options-core';
import { CompilerConfigurationError, type Compiler } from './types';

export { CompilerConfigurationError } from './types';
export type { Compiler, CompilerConfigurationErrorOptions } from './types';
export type { LocalCompileOptions, LocalCompileResult } from '../local/types';

/** Validate once; invalid options never reach a compile call. */
function requireOptions(options?: LocalCompileOptions): Extract<LocalOptionCheck, { ok: true }> {
  const check = readCompilerOptions(options);
  if (check.ok) return check;
  throw new CompilerConfigurationError(check.message, {
    code: check.key,
    ...(check.detail === undefined ? {} : { detail: check.detail }),
  });
}

/**
 * Freeze the caller's option shape so later mutation of the original object
 * cannot change the presence checks the pass still performs. Semantic values
 * (limits, HTML flags, components, config) live in the validated check.
 */
function snapshotOptions(options?: LocalCompileOptions): LocalCompileOptions | undefined {
  return options === undefined ? undefined : Object.freeze({ ...options });
}

export function createCompiler(options?: LocalCompileOptions): Compiler {
  const optionCheck = requireOptions(options);
  const snapshot = snapshotOptions(options);
  return {
    compile(source: string): LocalCompileResult {
      return plainCompiledData(compileLocalCore(source, snapshot, optionCheck));
    },
  };
}
