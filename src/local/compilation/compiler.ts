/** Full local compile entry and tracked adapter for editing sessions. */
import type { LocalCompileOptions, LocalCompileResult, SourceRange } from '../types';
import { compileLocalCore } from './compiler-core';
import { compileTraceStatus } from './compile-status';
import { plainCompiledData } from '../transport/compiled-data';
import { inspectLocalMathDisplay } from '../evaluation/math/display';
import { compilePlotFormula, implicitGridSize, plotFormulaKind } from '../evaluation/math/latex';
import { sanitizeLocalHtmlFragment } from '../html/html';
import { localCompileOptionsKey, readLocalCompileOptions, type LocalOptionCheck } from '../../assemblies/default-options';
import { parseLocal } from '../parsing/parser';
import type { LocalCompilerCoreServices, LocalTrackedSemanticService, SemanticCacheStats } from './compiler-services';
import type { InlinePlanLookup } from '../parsing/fast-markdown';
import type { SourceContext } from '../source/source-context';
import { createLocalTraceId, emitLocalDiagnostic, emitLocalTrace } from '../observability-core';

/** Compile to plain data that can cross a React Server Component boundary. */
export function compileLocal(source: string, options?: LocalCompileOptions): LocalCompileResult {
  const observer = options?.observer;
  const traceId = observer?.onTrace ? createLocalTraceId() : undefined;
  const started = traceId ? (globalThis.performance?.now() ?? Date.now()) : 0;
  let parsedAt: number | undefined;
  let publishedAt: number | undefined;
  const mark = traceId ? (stage: string) => {
    if (stage === 'parseMs') parsedAt = globalThis.performance?.now() ?? Date.now();
    if (stage === 'publicationMs') publishedAt = globalThis.performance?.now() ?? Date.now();
  } : undefined;
  if (traceId) emitLocalTrace(observer, { type: 'compile-start', traceId, timestamp: Date.now() });
  const result = plainCompiledData(compileLocalInternal(source, options, undefined, undefined, mark));
  if (observer?.onDiagnostic) {
    for (const diagnostic of result.diagnostics) emitLocalDiagnostic(observer, diagnostic);
    for (const diagnostic of result.transientDiagnostics ?? []) emitLocalDiagnostic(observer, diagnostic);
  }
  if (traceId) {
    const durationMs = Math.max(0, Math.round((globalThis.performance?.now() ?? Date.now()) - started));
    emitLocalTrace(observer, { type: 'compile-end', traceId, timestamp: Date.now(), status: compileTraceStatus(result), durationMs,
      ...(parsedAt === undefined ? {} : { parseMs: Math.max(0, Math.round(parsedAt - started)) }),
      ...(parsedAt === undefined || publishedAt === undefined ? {} : { semanticMs: Math.max(0, Math.round(publishedAt - parsedAt)) }) });
  }
  return result;
}

/** Compiler-owned capture for editor sessions. Callers must copy before publishing. */
export interface LocalCompilerServices {
  parser?: {parse(source:string,options?:LocalCompileOptions,context?:SourceContext,rowPlans?:InlinePlanLookup,literalRanges?:readonly SourceRange[]):ReturnType<typeof parseLocal>};
  semantic?: LocalTrackedSemanticService;
  /**
   * Per-row inline plans from the previous revision. Checked before the
   * session LRU so large sequential row blocks cannot thrash it.
   */
  rowPlans?: InlinePlanLookup;
}
export function compileLocalTracked(
  source: string,
  options?: LocalCompileOptions,
  services?:LocalCompilerServices,
  literalRanges?: readonly SourceRange[],
): {
  result: LocalCompileResult; parsed?: ReturnType<typeof parseLocal>;
  semantic?:SemanticCacheStats; timings:Record<string,number>;
} {
  let parsed: ReturnType<typeof parseLocal> | undefined;
  const now=()=>globalThis.performance?.now?.()??Date.now();
  const started=now(),timings:Record<string,number>={};let previous=started;
  const mark=(name:string)=>{const time=now();timings[name]=time-previous;previous=time;};
  services?.semantic?.begin(localCompileOptionsKey(options));
  const result = compileLocalInternal(source, options, tree => { parsed = tree; },services,mark,literalRanges);
  timings.totalMs=now()-started;
  return { result, parsed, ...(services?.semantic?{semantic:services.semantic.stats}:{}),timings };
}

export function compileLocalDocument(source: string, options?: LocalCompileOptions): LocalCompileResult {
  return compileLocal(source, options);
}

/** Publish option errors in the local compile result format. */
function invalidOptionsResult(optionCheck: Exclude<LocalOptionCheck, { ok: true }>): LocalCompileResult {
  return {
    ok: false,
    diagnostics: [{
      code: 'local.options.invalid',
      message: optionCheck.message,
      severity: 'error',
      phase: 'host',
      recoverable: false,
      range: { start: 0, end: 0 },
      line: 1,
      column: 1,
      messageKey: optionCheck.key,
      ...(optionCheck.detail === undefined ? {} : { params: { detail: optionCheck.detail } }),
    }],
  };
}

/** Install the full compiler capabilities and reuse display checks when a session supplies a cache. */
function coreServices(services?: LocalCompilerServices): LocalCompilerCoreServices {
  return {
    ...(services?.parser ? { parser: services.parser } : {}),
    ...(services?.semantic ? { semantic: services.semantic } : {}),
    ...(services?.rowPlans ? { rowPlans: services.rowPlans } : {}),
    display: services?.semantic
      ? (source, block) => services.semantic!.display(source, block)
      : inspectLocalMathDisplay,
    htmlFragment: sanitizeLocalHtmlFragment,
    plotMath: { kind: plotFormulaKind, gridSize: implicitGridSize, compile: compilePlotFormula },
  };
}

function compileLocalInternal(
  source: string,
  options?: LocalCompileOptions,
  capture?: (tree: ReturnType<typeof parseLocal>) => void,
  services?:LocalCompilerServices,
  mark?:(name:string)=>void,
  literalRanges?: readonly SourceRange[],
): LocalCompileResult {
  const optionCheck = readLocalCompileOptions(options);
  if (!optionCheck.ok) return invalidOptionsResult(optionCheck);
  return compileLocalCore(source, options, optionCheck, coreServices(services), capture, mark, literalRanges);
}
