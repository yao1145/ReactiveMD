export { analyzeLocalSource, completeLocalSource, renameLocalBinding, formatLocalSource } from './source/authoring';
export type { AuthorToken, AuthorBinding, AuthorAnalysis, AuthorCompletion, AuthorCompletionKind, AuthorRename } from './source/authoring';
export { compileLocal } from './compilation/compiler';
export { createLocalCompileSession, LocalCompileSession } from './compilation/session/incremental';
export type { LocalIncrementalStats } from './compilation/session/incremental';
export { localCompileOptionsKey } from './configuration/options';
export {
  formatLocalDiagnostic,
  LOCAL_DIAGNOSTIC_CODES,
  isLocalDiagnosticCode,
  localDiagnosticTemplate,
  localDiagnosticTemplateKeys,
} from './configuration/diagnostics';
export type { LocalDiagnosticDetails } from './configuration/diagnostics';
export { countLocalCodePoints } from './source/source-context';
export { createLocalRuntime,updateLocalRuntime,notifyLocalRuntime } from './runtime/runtime';
export type {LocalRuntimeUpdateOptions,LocalRuntimeDocumentUpdate} from './runtime/runtime';
export { compileExpression, LocalExpressionError } from './evaluation/expression/compile';
export { compileLatex, compilePlotFormula, implicitGridSize, plotFormulaKind } from './evaluation/math/latex';
export { sampleImplicit, sampleParametric, samplePlot, samplePolar } from './evaluation/math/sample';
export type { CompiledPlotFormula, PlotFormulaKind, PlotPoint, PlotSample } from './evaluation/math/latex';
export { LOCAL_SYNTAX_VERSION } from './types';
export { inspectLocalSourceVersion, checkLocalUpgrade, migrateLocalSource } from './source/source-migration';
export type { LocalSourceVersion, LocalUpgradeOptions, LocalUpgradeReport, LocalMigrationResult } from './source/source-migration';
export type { LocalVersionDeclaration } from './types';
export type { LocalSubmissionFieldCheck, LocalSubmissionFieldProblem, LocalSubmissionFieldsResult } from './types';
export type { LocalLocale } from './types';
export { LOCAL_THEME_PROTOCOL, DEFAULT_LOCAL_THEME, resolveLocalTheme, isLocalThemeName } from '../themes/document-theme';
export type { LocalColorScheme, LocalThemeDefinition, LocalThemeResolution } from '../themes/document-theme';
export type { Diagnostic, LocalDiagnosticParam, LocalDiagnosticParams, SourceRange, LocalRecovery, LocalValue, LocalValueKind, LocalNode, LocalBinding, LocalComputation, LocalExternal, LocalDynamicConstraint, LocalDynamicConstraints, LocalValidation, LocalDocument, LocalHtmlOptions, LocalHtmlPolicy, LocalCompileLimits, LocalCompileOptions, LocalCompileResult, LocalRuntime, LocalRuntimeOptions, LocalSnapshot, LocalHostPropKind, LocalHostPropSchema, LocalHostComponentForm, LocalHostBindingSchema, LocalHostComponentSchema } from './types';
export {
  LOCAL_STATE_FORMAT,
  localSourceDigest,
  createLocalStateFile,
  parseLocalState,
  resolveLocalState,
  applyLocalState,
  exportLocalState,
  importLocalState,
  serializeLocalState,
} from './runtime/state';
export type {
  LocalStateGenerator,
  LocalStateFile,
  LocalStateParseResult,
  LocalStateResolution,
} from './runtime/state';
export { planLocalStateRetention, applyLocalStateRetention } from './runtime/retention';
export type {
  LocalStateRetentionReason,
  LocalStateRetentionDrop,
  LocalStateRetentionInput,
  LocalRetainedState,
  LocalStateRetentionResult,
} from './runtime/retention';
export {
  LOCAL_COMPILE_DELAY_MS,
  LOCAL_COMPILE_PREPARATION_DELAY_MS,
  localWorkerOptionsKey,
  LocalCompileScheduler,
  compileFailureDiagnostic,
  startLocalCompileWorker,
} from './transport/worker';
export type {
  LocalCompileRequest,
  LocalCompileEditHint,
  LocalCompileResponse,
  LocalCompileWorker,
  LocalCompileMode,
  LocalCompileOutcome,
  LocalCompileSchedulerOptions,
  LocalCompileWorkerScope,
  LocalCompilePatchRequest,LocalCompileWorkerRequest,LocalCompilePatchResponse,
  LocalCompileWorkerResponse,LocalCompileFlatResponse,LocalCompileWorkerMetrics,LocalCompileMetrics,
  LocalCompileWorkerControl,LocalCompileWorkerControlMessage,LocalCompileWorkerOptions,
} from './transport/worker';
export {LOCAL_RESULT_PATCH_PROTOCOL,diffSourceEdit,applySourceEdit,encodeLocalResultPatch,applyLocalResultPatch} from './transport/compile-patch';
export type {LocalSourceEdit,LocalResultPatch,LocalNodePatch,LocalDocumentPatch,LocalRecordPatch} from './transport/compile-patch';
