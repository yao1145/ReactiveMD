export { analyzeLocalSource, completeLocalSource, renameLocalBinding, formatLocalSource } from './authoring';
export type { AuthorToken, AuthorBinding, AuthorAnalysis, AuthorCompletion, AuthorCompletionKind, AuthorRename } from './authoring';
export { compileLocal } from './compiler';
export { createLocalCompileSession, LocalCompileSession } from './incremental';
export type { LocalIncrementalStats } from './incremental';
export { localCompileOptionsKey } from './options';
export {
  formatLocalDiagnostic,
  LOCAL_DIAGNOSTIC_CODES,
  isLocalDiagnosticCode,
  localDiagnosticTemplate,
  localDiagnosticTemplateKeys,
} from './diagnostics';
export type { LocalDiagnosticDetails } from './diagnostics';
export { countLocalCodePoints } from './text-length';
export { createLocalRuntime } from './runtime';
export { compileExpression, LocalExpressionError } from './expression';
export { compileLatex, samplePlot } from './math';
export { LOCAL_SYNTAX_VERSION } from './version';
export { inspectLocalSourceVersion, checkLocalUpgrade, migrateLocalSource } from './source-migration';
export type { LocalSourceVersion, LocalUpgradeOptions, LocalUpgradeReport, LocalMigrationResult } from './source-migration';
export type { LocalVersionDeclaration } from './types';
export type { LocalLocale } from './locale';
export { LOCAL_THEME_PROTOCOL, DEFAULT_LOCAL_THEME, resolveLocalTheme, isLocalThemeName } from './theme';
export type { LocalColorScheme, LocalThemeDefinition, LocalThemeResolution } from './theme';
export type { Diagnostic, LocalDiagnosticParam, LocalDiagnosticParams, SourceRange, LocalValue, LocalValueKind, LocalNode, LocalBinding, LocalComputation, LocalValidation, LocalDocument, LocalHtmlOptions, LocalHtmlPolicy, LocalCompileLimits, LocalCompileOptions, LocalCompileResult, LocalRuntime, LocalSnapshot, LocalHostPropKind, LocalHostPropSchema, LocalHostComponentSchema } from './types';
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
} from './state';
export type {
  LocalStateGenerator,
  LocalStateFile,
  LocalStateParseResult,
  LocalStateResolution,
} from './state';
export { planLocalStateRetention, applyLocalStateRetention } from './retention';
export type {
  LocalStateRetentionReason,
  LocalStateRetentionDrop,
  LocalStateRetentionInput,
  LocalRetainedState,
  LocalStateRetentionResult,
} from './retention';
export {
  LOCAL_COMPILE_DELAY_MS,
  LocalCompileScheduler,
  compileFailureDiagnostic,
  startLocalCompileWorker,
} from './worker';
export type {
  LocalCompileRequest,
  LocalCompileResponse,
  LocalCompileWorker,
  LocalCompileMode,
  LocalCompileOutcome,
  LocalCompileSchedulerOptions,
  LocalCompileWorkerScope,
} from './worker';
