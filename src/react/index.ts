export { LocalDocumentView, LocalReactiveDocument } from '../local/rendering/LocalDocumentView';
export type {
  LocalDocumentViewProps,
  LocalReactiveDocumentProps,
  LocalUrlPolicy,
  LocalImageResolver,
} from '../local/rendering/LocalDocumentView';
export type {
  LocalRenderMode,
  LocalRenderContext,
  LocalHostData,
  LocalHostRenderer,
  LocalHostComponentContext,
  LocalHostPropValue,
  LocalSourceTarget,
} from '../local/rendering/render-types';
export type { LocalLocale } from '../local/contracts/locale';
export type { LocalColorScheme, LocalThemeDefinition } from '../local/theme/theme';
export { defineReactComponentPackage, createReactHost } from './package';
export type { LocalReactComponentPackageInput, LocalReactComponentPackage, LocalReactPackage, LocalReactHostInput, LocalReactHost, LocalPackageNotice } from './package';

export {
  LocalReactExtensionMissingError,
  createReactConfig,
  defineReactComponent,
  localReactExtensionRenderer,
  reportLocalComponentError,
  safeLocalComponentEvent,
  validateLocalReactExtensions,
} from './sdk';
export type {
  CreateLocalReactConfigOptions,
  LocalComponentBindingHandle,
  LocalComponentContext,
  LocalComponentInstance,
  LocalComponentPropValue,
  LocalComponentRender,
  LocalComponentSetResult,
  LocalReactComponent,
  LocalReactComponentImplementation,
  LocalReactConfig,
  LocalReactExtensionRenderer,
  LocalReactPreset,
  LocalReactRenderEnvironment,
} from './sdk';
export type {
  LocalComponentChildrenApi,
  LocalComponentContent,
  LocalComponentField,
  LocalComponentHint,
  LocalComponentLocaleApi,
  LocalComponentNavigationApi,
  LocalComponentOption,
  LocalComponentRuntime,
  LocalComponentServices,
  LocalComponentSetResult as LocalComponentWriteResult,
  LocalComponentTableCell,
  LocalComponentTableCellKind,
  LocalComponentTableProjection,
  LocalComponentUrlApi,
  LocalComponentValue,
  LocalRandomService,
} from './component-api';
export type {
  LocalComponentDefinition,
  LocalComponentProp,
  LocalConfig,
  LocalExtensionRequirements,
} from '../sdk/types';
export type {
  LocalComponentStateDocument,
  LocalComponentStateRecord,
  LocalComponentStateSaveResult,
} from '../runtime-services/component-state';
export type { LocalRuntimeServices } from '../runtime-services/runtime';

/* Public adapter primitives shared by builtin and external components. */
export {
  DEFAULT_LOCAL_DATA_TABLE_ROWS,
  LatexError,
  LatexView,
  MAX_LOCAL_ARRAY_LENGTH,
  MAX_LOCAL_DATA_TABLE_COLUMNS,
  MAX_LOCAL_DATA_TABLE_ROWS,
  MAX_LOCAL_PLOT_CURVES,
  MAX_LOCAL_PLOT_POINTS,
  MAX_LOCAL_PLOT_STEPS,
  MAX_LOCAL_STRING_LENGTH,
  MAX_LOCAL_VALUE_CHARACTERS,
  MAX_IMPLICIT_GRID,
  MIN_IMPLICIT_GRID,
  TableSurface,
  compileExpression,
  compileLatex,
  compilePlotFormula,
  countLocalCodePoints,
  createDiagramLayoutFallback,
  diagramEdgePath,
  diagramLayoutKey,
  formatLocalDiagnostic,
  implicitGridSize,
  isLocalColor,
  isLocalEmail,
  layoutDiagram,
  plotFormulaKind,
  sampleImplicit,
  sampleParametric,
  samplePlot,
} from './component-primitives';
export type {
  CompiledPlotFormula,
  DiagramLayoutInput,
  DiagramLayoutResult,
  LatexEvaluationBudget,
  LocalExpression,
  LocalValue,
  PlotFormulaKind,
  PlotPoint,
  PlotSample,
} from './component-primitives';

/* Generic adapter helpers for component implementations. */
export {
  FieldError,
  LocalError,
  PrintValue,
  StaticValue,
  ToneProblem,
  accentStyle,
  boolAttr,
  clamp,
  currentValue,
  dateConstraint,
  displayValue,
  formatNumber,
  formatSeconds,
  inlinePlainText,
  itemBool,
  itemText,
  localColor,
  numberAttr,
  numberConstraint,
  numericRange,
  optionLabel,
  rawAttr,
  readBooleanAttr,
  scalarText,
  slotNumber,
  snapToStep,
  staticText,
  textAttr,
  toneAttr,
  useComponentView,
  useDisabled,
  useResetToken,
  useSourceAttributes,
  useValidationField,
  useValidationHint,
  useWriter,
} from './component-utils';
export type {
  ConstraintRead,
  LocalComponentView,
} from './component-utils';
