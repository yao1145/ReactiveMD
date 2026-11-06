/**
 * Compatibility facade for the historical compile entry points.
 *
 * The semantic pass lives in `compiler-core.ts`; this module keeps the
 * documented `compileLocal` / `compileLocalTracked` / `compileLocalDocument`
 * signatures and their exact default behavior, including option validation,
 * the concrete semantic cache and the KaTeX display precheck.
 */
import type { LocalCompileOptions, LocalCompileResult } from '../contracts/types';
import { compileLocalCore } from './compiler-core';
import { plainCompiledData } from '../transport/compiled-data';
import { LocalSemanticCache, type SemanticCacheStats } from '../session/compiler-cache';
import { inspectLocalMathDisplay } from '../evaluation/math-display';
import { localCompileOptionsKey, readLocalCompileOptions, type LocalOptionCheck } from '../configuration/options';
import { parseLocal } from '../parsing/parser';
import type { LocalCompilerCoreServices } from './compiler-services';
import type { InlinePlanLookup } from '../markdown/fast-markdown';
import type { SourceContext } from '../source/source-context';

/** Compile to plain data that can cross a React Server Component boundary. */
export function compileLocal(source: string, options?: LocalCompileOptions): LocalCompileResult {
  return plainCompiledData(compileLocalInternal(source, options));
}

/** Compiler-owned capture for editor sessions. Callers must copy before publishing. */
export interface LocalCompilerServices {
  parser?: {parse(source:string,options?:LocalCompileOptions,context?:SourceContext,rowPlans?:InlinePlanLookup):ReturnType<typeof parseLocal>};
  semantic?: LocalSemanticCache;
  /**
   * Per-row inline plans from the previous revision. Checked before the
   * session LRU so large sequential row blocks cannot thrash it.
   */
  rowPlans?: InlinePlanLookup;
}
export function compileLocalTracked(source: string, options?: LocalCompileOptions, services?:LocalCompilerServices): {
  result: LocalCompileResult; parsed?: ReturnType<typeof parseLocal>;
  semantic?:SemanticCacheStats; timings:Record<string,number>;
} {
  let parsed: ReturnType<typeof parseLocal> | undefined;
  const now=()=>globalThis.performance?.now?.()??Date.now();
  const started=now(),timings:Record<string,number>={};let previous=started;
  const mark=(name:string)=>{const time=now();timings[name]=time-previous;previous=time;};
  services?.semantic?.begin(localCompileOptionsKey(options));
  const result = compileLocalInternal(source, options, tree => { parsed = tree; },services,mark);
  timings.totalMs=now()-started;
  return { result, parsed, ...(services?.semantic?{semantic:services.semantic.stats}:{}),timings };
}

export function compileLocalDocument(source: string, options?: LocalCompileOptions): LocalCompileResult {
  return compileLocal(source, options);
}

/* ------------------------------------------------------------------ */
/* Compatibility adapters                                              */
/* ------------------------------------------------------------------ */

/** Same legacy error shape as the pre-split compiler. */
function invalidOptionsResult(optionCheck: Exclude<LocalOptionCheck, { ok: true }>): LocalCompileResult {
  return {
    ok: false,
    diagnostics: [{
      code: 'local.options.invalid',
      message: optionCheck.message,
      severity: 'error',
      range: { start: 0, end: 0 },
      line: 1,
      column: 1,
      messageKey: optionCheck.key,
      ...(optionCheck.detail === undefined ? {} : { params: { detail: optionCheck.detail } }),
    }],
  };
}

/**
 * Map the historical service bag onto the structural core services. The
 * display precheck stayed unconditional here: a session cache answers from its
 * store, and a plain compile inspects every formula directly.
 */
function coreServices(services?: LocalCompilerServices): LocalCompilerCoreServices {
  return {
    ...(services?.parser ? { parser: services.parser } : {}),
    ...(services?.semantic ? { semantic: services.semantic } : {}),
    ...(services?.rowPlans ? { rowPlans: services.rowPlans } : {}),
    display: services?.semantic
      ? (source, block) => services.semantic!.display(source, block)
      : inspectLocalMathDisplay,
  };
}

function compileLocalInternal(
  source: string,
  options?: LocalCompileOptions,
  capture?: (tree: ReturnType<typeof parseLocal>) => void,
  services?:LocalCompilerServices,
  mark?:(name:string)=>void,
): LocalCompileResult {
  const optionCheck = readLocalCompileOptions(options);
  if (!optionCheck.ok) return invalidOptionsResult(optionCheck);
  return compileLocalCore(source, options, optionCheck, coreServices(services), capture, mark);
}
