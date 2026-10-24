export { analyzeLocalSource, completeLocalSource, renameLocalBinding, formatLocalSource } from './authoring';
export type { AuthorToken, AuthorBinding, AuthorAnalysis, AuthorCompletion, AuthorCompletionKind, AuthorRename } from './authoring';
export { compileLocal } from './compiler';
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
export type { LocalLocale } from './locale';
export { LOCAL_THEME_PROTOCOL, DEFAULT_LOCAL_THEME, resolveLocalTheme, isLocalThemeName } from './theme';
export type { LocalColorScheme, LocalThemeDefinition, LocalThemeResolution } from './theme';
export type { Diagnostic, LocalDiagnosticParam, LocalDiagnosticParams, SourceRange, LocalValue, LocalValueKind, LocalNode, LocalBinding, LocalComputation, LocalValidation, LocalDocument, LocalCompileLimits, LocalCompileOptions, LocalCompileResult, LocalRuntime, LocalSnapshot } from './types';
