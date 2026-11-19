/**
 * Public types for the standalone single-pass compiler entry points.
 *
 * Factories validate options once; invalid options throw
 * `CompilerConfigurationError`. Author-source problems and structural
 * recoveries are reported through the result instead. The result keeps the
 * task-one `ok` / `document` aliases so existing consumers can migrate without
 * changing their read path, and adds the strict/recovery contract from the
 * roadmap.
 */
import type { Diagnostic, LocalCompileResult, LocalDocument, LocalRecovery } from '../local/types';

/** Structural, recursively read-only projection of plain compiler data. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * The compiled program. The first round reuses the existing document model as
 * a deep-read-only snapshot; internal node layout is not a long-term format.
 */
export type Program = DeepReadonly<LocalDocument>;

/** One optional check that ran, with its protocol version. */
export interface OptionalCheck {
  readonly id: string;
  readonly version: string;
}

/** Optional-check coverage for one successful compilation. */
export interface CheckCoverage {
  readonly optional: readonly OptionalCheck[];
}

/**
 * A successful pass is `valid` when nothing was repaired and `recovered` when
 * at least one structural recovery produced a still-executable program.
 */
export interface CompileSuccess {
  readonly ok: true;
  readonly status: 'valid' | 'recovered';
  /** Plain document alias kept for task-one consumers; never frozen. */
  readonly document: LocalDocument;
  /** Independent, deeply frozen snapshot of `document`. */
  readonly program: Program;
  readonly diagnostics: Diagnostic[];
  readonly recoveries: readonly LocalRecovery[];
  readonly checks: CheckCoverage;
}

/** A failed pass has no program; recoveries completed before the failure stay visible. */
export interface CompileFailure {
  readonly ok: false;
  readonly status: 'failed';
  readonly diagnostics: Diagnostic[];
  readonly recoveries: readonly LocalRecovery[];
}

export type CompileResult = CompileSuccess | CompileFailure;

/** One reusable, already-validated compiler instance. */
export interface Compiler {
  /** Compile one source revision. Never throws for author-source errors. */
  compile(source: string): CompileResult;
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

// Re-exported so the compatibility aliases remain discoverable from the
// compiler entry without importing the local root.
export type { LocalCompileResult, LocalRecovery };
