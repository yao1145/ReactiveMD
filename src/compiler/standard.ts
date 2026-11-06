/**
 * Standard single-pass compiler entry.
 *
 * Same result contract as the minimal factory, but wired to the full
 * experience: the default component preset, GFM syntax, native HTML support,
 * Lezer block planning, the KaTeX display precheck and plot formula semantics
 * are supplied explicitly. It is the single-pass counterpart of the legacy
 * `compileLocal` without sessions, workers, React or theme loading.
 */
import type { LocalCompileOptions } from '../local/contracts/types';
import type { LocalOptionCheck } from '../local/configuration/options-core';
import { compileLocalCore } from '../local/compilation/compiler-core';
import { inspectLocalMathDisplay } from '../local/evaluation/math-display';
import { compilePlotFormula, implicitGridSize, plotFormulaKind } from '../local/evaluation/math';
import { sanitizeLocalHtmlDocument } from '../local/html/html';
import { STANDARD_PARSER_CAPABILITIES } from '../local/parsing/parser-standard';
import { readCompilerOptions } from '../local/configuration/options-core';
import { defaultPreset } from '../presets/default';
import { STANDARD_CHECKS, toCompileResult } from './result';
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

function requireOptions(options?: LocalCompileOptions): Extract<LocalOptionCheck, { ok: true }> {
  const check = readCompilerOptions(options, defaultPreset.components, STANDARD_PARSER_CAPABILITIES);
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
  // Stable service objects: the precheck is pure, and the HTML sanitizer and
  // plot semantics are value-free functions.
  const services = {
    display: inspectLocalMathDisplay,
    htmlDocument: sanitizeLocalHtmlDocument,
    plotMath: { kind: plotFormulaKind, gridSize: implicitGridSize, compile: compilePlotFormula },
  };
  return {
    compile(source: string): CompileResult {
      return toCompileResult(compileLocalCore(source, snapshot, optionCheck, services), STANDARD_CHECKS);
    },
  };
}
