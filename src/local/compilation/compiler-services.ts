import type {
  Diagnostic,
  LocalCompileOptions,
  LocalComputation,
  LocalDynamicConstraints,
  LocalExternal,
  LocalHtmlPolicy,
  LocalMathDisplayIssue,
  LocalNode,
  LocalValueKind,
} from '../types';
import { localCodeUnitPrefix, type SourceContext } from '../source/source-context';
import type { InlinePlanLookup } from '../parsing/fast-markdown';
import type { ParsedLocal } from '../parsing/parser-core';
import type { LocalExpression } from '../evaluation/expression';
import type { CompiledPlotFormula, LatexExpression, PlotFormulaKind } from '../evaluation/math';
import type { Entry, StructureState } from './compiler-structure';
import type { LocalComponentDefinition } from '../../sdk/types';
import type { TableShape } from './compiler-tables';
import {
  diagnosticEnglish,
  localDiagnosticDetails,
  type LocalDiagnosticDetails,
} from '../configuration/diagnostics';
import { MAX_LOCAL_DIAGNOSTIC_LENGTH, MAX_LOCAL_DIAGNOSTICS } from '../configuration/limits';

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

/** Optional whole-document HTML sanitizer for the native HTML branch. */
export type LocalHtmlDocumentSanitizer = (
  source: string,
  policy: LocalHtmlPolicy,
  maxSyntaxNodes: number,
) => { markup: string; diagnostics: Diagnostic[] };

/** Optional plot-formula compiler; omitted assemblies reject plot formulas. */
export interface LocalCompilerPlotMath {
  kind(source: string): PlotFormulaKind | null;
  gridSize(samples: number): number;
  compile(source: string): CompiledPlotFormula;
}

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
  /** Whole-document HTML branch; absent in the minimal assembly. */
  htmlDocument?: LocalHtmlDocumentSanitizer;
  /** Plot formula semantics; absent in the minimal assembly. */
  plotMath?: LocalCompilerPlotMath;
}

export interface CompileState extends StructureState {
  semantic?: LocalCompilerSemanticService;
  /** Optional KaTeX display precheck; absent in the minimal core entry. */
  display?: LocalMathDisplayInspector;
  /** Optional native HTML document branch; absent in the minimal core entry. */
  htmlDocument?: LocalHtmlDocumentSanitizer;
  /** Optional plot formula semantics; absent in the minimal core entry. */
  plotMath?: LocalCompilerPlotMath;
  source: string;
  lineStarts: number[];
  nodes: LocalNode[];
  diagnostics: Diagnostic[];
  definitionsByName: ReadonlyMap<string, LocalComponentDefinition>;
  entries: Entry[];
  tableShapes: Map<string, TableShape | null>;
  bindingSlots: Record<string, Record<string, string>>;
  bindingKinds: Record<string, LocalValueKind>;
  computationKinds: Record<string, LocalValueKind>;
  computations: Record<string, LocalComputation>;
  externals: Record<string, LocalExternal>;
  externalKinds: Record<string, LocalValueKind>;
  dynamicConstraints: Record<string, LocalDynamicConstraints>;
  expressionKinds: Map<string, LocalValueKind | null>;
}

/** Host schemas are validated before parsing; an unmatched node only warns. */
export function reportWarning(
  state: CompileState,
  code: string,
  message: string | LocalDiagnosticDetails,
  start: number,
  end = start + 1,
  details?: LocalDiagnosticDetails,
): void {
  const resolved = typeof message === 'string' ? details : message;
  const text = typeof message === 'string' ? message : diagnosticEnglish(message);
  if (state.diagnostics.length >= MAX_LOCAL_DIAGNOSTICS) return;
  const safeStart = Math.max(0, Math.min(state.source.length, start));
  const safeEnd = Math.max(safeStart, Math.min(state.source.length, Math.max(safeStart, end)));
  let low = 0;
  let high = state.lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (state.lineStarts[middle] <= safeStart) low = middle;
    else high = middle - 1;
  }
  const bounded = localDiagnosticDetails(resolved?.key ?? code, resolved?.params);
  state.diagnostics.push({
    code,
    message: text.length > MAX_LOCAL_DIAGNOSTIC_LENGTH
      ? `${localCodeUnitPrefix(text, MAX_LOCAL_DIAGNOSTIC_LENGTH - 1)}…`
      : text,
    severity: 'warning',
    range: { start: safeStart, end: safeEnd },
    line: low + 1,
    column: safeStart - state.lineStarts[low] + 1,
    messageKey: bounded.key,
    ...(bounded.params ? { params: bounded.params } : {}),
  });
}
