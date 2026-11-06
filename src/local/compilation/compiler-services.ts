/**
 * Structural execution services for the single compiler pass.
 *
 * These interfaces describe what the compiler *uses*, never a concrete
 * implementation. Sessions, workers and tests can supply their own parser or
 * semantic store without the core importing a cache class, a session module or
 * a theme registry. Omitting every service keeps the same semantic flow; it
 * only drops cross-revision reuse and the optional KaTeX display precheck.
 */
import type { LocalExpression } from '../evaluation/expression';
import type { LatexExpression } from '../evaluation/math';
import type { InlinePlanLookup } from '../markdown/fast-markdown';
import type { ParsedLocal } from '../parsing/parser-core';
import type { SourceContext } from '../source/source-context';
import type { LocalCompileOptions, LocalMathDisplayIssue, LocalValueKind } from '../contracts/types';

/** Parser entry used by tracked compiles; the session owns the cache. */
export interface LocalCompilerParserService {
  parse(
    source: string,
    options?: LocalCompileOptions,
    context?: SourceContext,
    rowPlans?: InlinePlanLookup,
  ): ParsedLocal;
}

/**
 * Successful semantic products from previous revisions. Every method must be
 * a pure lookup or store keyed by source text or validated attributes; errors
 * are still reported against the current source, never replayed.
 */
export interface LocalCompilerSemanticService {
  expression(source: string): LocalExpression;
  infer(expression: LocalExpression, environment: Record<string, LocalValueKind>): LocalValueKind;
  attributes<T>(key: string): { value: T; origin: number } | undefined;
  rememberAttributes(key: string, origin: number, value: unknown): void;
  binding<T>(key: string): T | undefined;
  rememberBinding(key: string, value: unknown): void;
  latex(source: string): LatexExpression;
}

/** Optional KaTeX display precheck; compat and standard keep the full check. */
export type LocalMathDisplayInspector = (
  source: string,
  block: boolean,
) => readonly LocalMathDisplayIssue[];

/** Optional execution goods for one compile; all fields are independent. */
export interface LocalCompilerCoreServices {
  parser?: LocalCompilerParserService;
  semantic?: LocalCompilerSemanticService;
  /**
   * Per-row inline plans from the previous revision. Checked before the
   * session LRU so large sequential row blocks cannot thrash it.
   */
  rowPlans?: InlinePlanLookup;
  display?: LocalMathDisplayInspector;
}
