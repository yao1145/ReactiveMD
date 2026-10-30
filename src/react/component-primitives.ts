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
} from '../local/limits';
export { countLocalCodePoints } from '../local/text-length';
export { formatLocalDiagnostic } from '../local/diagnostics';
export { compileExpression, type LocalExpression } from '../local/expression';
export {
  compileLatex,
  LatexError,
  samplePlot,
  type LatexEvaluationBudget,
} from '../local/math';
export { LatexView } from '../local/math-view';
export { TableSurface } from '../local/table-surface';
export {
  createDiagramLayoutFallback,
  diagramEdgePath,
  diagramLayoutKey,
  layoutDiagram,
  type DiagramLayoutInput,
  type DiagramLayoutResult,
} from '../local/diagram-layout';
export { isLocalColor } from '../local/colors';
export type { Diagnostic, LocalValue } from '../local/types';
export type { LocalRenderMode } from '../local/render-types';
export type { LocalLocale, Localize } from '../local/i18n';
