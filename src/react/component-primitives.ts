/**
 * Stable public adapter primitives for component implementations.
 *
 * These are canonical kernel/rendering utilities re-exported behind a public
 * entry so builtin and external components can share the same limits, text
 * length, expression, math, table surface and diagram layout behaviour. The
 * implementations are not copied: they remain the kernel modules.
 */
export {
  DEFAULT_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_PLOT_STEPS,
  MAX_LOCAL_STRING_LENGTH,
  MAX_LOCAL_VALUE_CHARACTERS,
  isLocalEmail,
} from '../local/configuration/limits';
export { countLocalCodePoints } from '../local/source/text-length';
export { formatLocalDiagnostic } from '../local/configuration/diagnostics';
export { compileExpression, type LocalExpression } from '../local/evaluation/expression';
export {
  compileLatex,
  compilePlotFormula,
  implicitGridSize,
  LatexError,
  MAX_IMPLICIT_GRID,
  MIN_IMPLICIT_GRID,
  plotFormulaKind,
  type CompiledPlotFormula,
  type LatexEvaluationBudget,
  type PlotFormulaKind,
  type PlotPoint,
  type PlotSample,
} from '../local/evaluation/math';
export { sampleImplicit, sampleParametric, samplePlot } from '../local/evaluation/math-sample';
export { LatexView } from '../local/widgets/math-view';
export { TableSurface } from '../local/widgets/table-surface';
export {
  createDiagramLayoutFallback,
  diagramEdgePath,
  diagramLayoutKey,
  layoutDiagram,
  type DiagramLayoutInput,
  type DiagramLayoutResult,
} from '../local/widgets/diagram-layout';
export { isLocalColor } from '../local/theme/colors';
export type { Diagnostic, LocalValue } from '../local/contracts/types';
export type { LocalRenderMode } from '../local/rendering/render-types';
export type { LocalLocale, Localize } from '../local/theme/i18n';
