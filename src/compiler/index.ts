/**
 * Minimal single-pass compiler entry.
 *
 * The minimal factory installs no default component preset: only the kernel
 * language declarations (theme/computed/const/external), CommonMark/RMD body,
 * semantic checks and budgets remain. GFM syntax, native HTML parsing and
 * repair, Lezer block planning, the KaTeX display precheck, plot formula
 * semantics and the whole-document HTML branch are standard-assembly
 * capabilities; requesting one here produces an explicit capability
 * diagnostic. `compiler/standard` keeps the full experience.
 *
 * The factory validates options once and snapshots them. `compile` performs
 * only the semantic pass: it creates no runtime, session, worker, timer or
 * cross-source cache.
 */
import type { LocalCompileOptions } from '../local/contracts/types';
import type { LocalOptionCheck } from '../local/configuration/options-core';
import { compileLocalCore } from '../local/compilation/compiler-core';
import { readCompilerOptions } from '../local/configuration/options-core';
import { MINIMAL_CHECKS, toCompileResult } from './result';
import { CompilerConfigurationError, type CompileResult, type Compiler } from './types';

export { CompilerConfigurationError } from './types';
export type {
  CheckCoverage,
  CompileFailure,
  CompileResult,
  CompileSuccess,
  Compiler,
  CompilerConfigurationErrorOptions,
  OptionalCheck,
  Program,
} from './types';
export type { DeepReadonly } from './types';
export type { LocalCompileOptions, LocalCompileResult, LocalRecovery } from '../local/contracts/types';

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
 * (limits, HTML flags, components, config, strict) live in the validated check.
 */
function snapshotOptions(options?: LocalCompileOptions): LocalCompileOptions | undefined {
  return options === undefined ? undefined : Object.freeze({ ...options });
}

export function createCompiler(options?: LocalCompileOptions): Compiler {
  const optionCheck = requireOptions(options);
  const snapshot = snapshotOptions(options);
  return {
    compile(source: string): CompileResult {
      return toCompileResult(compileLocalCore(source, snapshot, optionCheck), MINIMAL_CHECKS);
    },
  };
}
