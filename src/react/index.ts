export { LocalDocumentView, LocalReactiveDocument } from '../local/LocalDocumentView';
export type {
  LocalDocumentViewProps,
  LocalReactiveDocumentProps,
  LocalUrlPolicy,
  LocalImageResolver,
} from '../local/LocalDocumentView';
export type {
  LocalRenderMode,
  LocalRenderContext,
  LocalHostData,
  LocalHostRenderer,
  LocalHostComponentContext,
  LocalHostPropValue,
  LocalSourceTarget,
} from '../local/render-types';
export type { LocalLocale } from '../local/locale';
export type { LocalColorScheme, LocalThemeDefinition } from '../local/theme';

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
  LocalComponentSetResult as LocalComponentWriteResult,
  LocalComponentTableCell,
  LocalComponentTableCellKind,
  LocalComponentTableProjection,
  LocalComponentUrlApi,
  LocalComponentValue,
} from './component-api';
export type {
  LocalComponentDefinition,
  LocalComponentProp,
  LocalConfig,
  LocalExtensionRequirements,
} from '../sdk/types';

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
  TableSurface,
  compileExpression,
  compileLatex,
  countLocalCodePoints,
  createDiagramLayoutFallback,
  diagramEdgePath,
  diagramLayoutKey,
  formatLocalDiagnostic,
  isLocalColor,
  isLocalEmail,
  layoutDiagram,
  samplePlot,
} from './component-primitives';
export type {
  DiagramLayoutInput,
  DiagramLayoutResult,
  LatexEvaluationBudget,
  LocalExpression,
  LocalValue,
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
