/**
 * Public types for the standalone single-pass compiler entry points.
 *
 * The compiler result stays `LocalCompileResult` in M1: the Program/strict
 * union from the roadmap is a later task. Factories throw
 * `CompilerConfigurationError` for invalid options; author-source problems
 * are reported through the result diagnostics, exactly as before.
 */
import type { LocalCompileResult } from '../local/types';

/** One reusable, already-validated compiler instance. */
export interface Compiler {
  /** Compile one source revision. Never throws for author-source errors. */
  compile(source: string): LocalCompileResult;
}

export interface CompilerConfigurationErrorOptions {
  /** Stable option-diagnostic key, e.g. `local.options.invalid.limits`. */
  readonly code?: string;
  readonly detail?: string;
}

/** Invalid factory options; author-source errors stay in the result. */
export class CompilerConfigurationError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(message: string, options: CompilerConfigurationErrorOptions = {}) {
    super(message);
    this.name = 'CompilerConfigurationError';
    this.code = options.code ?? 'compiler.configuration';
    if (options.detail !== undefined) this.detail = options.detail;
  }
}
