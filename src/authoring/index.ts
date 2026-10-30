/**
 * Public, DOM-free authoring entry for Reactive MD.
 *
 * This module is the stable surface for non-React hosts (for example a
 * CodeMirror 6 extension). It re-exports the pure authoring services, the
 * component schema, the native-component catalog with template rendering, and
 * the pure Markdown toolbar commands. Nothing here imports React, a stylesheet
 * or a UI component, so the entry can run in a worker or a server process.
 *
 * Compile options mirror the preview pipeline: pass the same
 * `LocalCompileOptions` used for rendering so analysis diagnostics, host
 * components, limits and HTML mode stay consistent.
 */

export {
  analyzeLocalSource,
  completeLocalSource,
  formatLocalSource,
  renameLocalBinding,
} from '../local/authoring';
export type {
  AuthorAnalysis,
  AuthorBinding,
  AuthorCompletion,
  AuthorCompletionKind,
  AuthorRename,
  AuthorToken,
} from '../local/authoring';

export {
  createLocalAuthoringLookup,
  createLocalComponentCatalog,
  insertLocalComponent,
} from './extensions';
export { validateLocalComponentInsertTemplates } from './conformance';
export type {
  LocalAttributeAuthoring,
  LocalAuthoringLookup,
  LocalComponentCatalogEntry,
  LocalComponentCatalogProp,
  LocalTagAuthoring,
} from './extensions';
export type { LocalInsertTemplateIssue } from './conformance';

export {
  LOCAL_COMPONENT_NAMES,
  LOCAL_COMPONENTS,
  closestName,
  getLocalComponent,
  getPropDefault,
  localComponentNames,
  suggestAttribute,
  suggestComponent,
} from '../local/schema';
export type {
  LocalBindingFamily,
  LocalBindingSchema,
  LocalBindingSlotSchema,
  LocalChildRule,
  LocalComponentForm,
  LocalComponentSchema,
  LocalInitialRule,
  LocalPropKind,
  LocalPropSchema,
} from '../local/schema';

export type {
  Diagnostic,
  LocalCompileLimits,
  LocalCompileOptions,
  LocalHostComponentSchema,
  LocalHostPropKind,
  LocalHostPropSchema,
  LocalHtmlOptions,
  LocalHtmlPolicy,
  LocalValue,
  SourceRange,
} from '../local/types';

export {
  EXTENDED_NATIVE_COMPONENT_COPY_ZH,
  EXTENDED_NATIVE_COMPONENTS,
} from '../editor/extended-native-components';
export {
  NATIVE_COMPONENT_GROUPS,
  NATIVE_COMPONENT_GROUPS_ZH,
  NATIVE_COMPONENTS,
  NATIVE_COMPONENTS_ZH,
  getNativeComponentCatalog,
  renderNativeSnippet,
} from '../editor/native-components';
export type {
  NativeComponentCatalog,
  NativeComponentDefinition,
  NativeComponentGroup,
  NativeComponentGroupId,
} from '../editor/native-components';

export {
  formatBold,
  formatHeading,
  formatInlineCode,
  formatItalic,
  formatOrderedList,
  formatQuote,
  formatStrike,
  formatTaskList,
  formatBulletList,
  indentSelection,
  insertCodeBlock,
  insertDivider,
  insertImage,
  insertLink,
  insertTable,
  insertTemplate,
  insertText,
  outdentSelection,
  readFormatState,
} from '../editor/editor-commands';
export type {
  EditorEdit,
  EditorFormatState,
  EditorListType,
  EditorSelection,
  InsertTemplateOptions,
} from '../editor/editor-commands';
export type { EditorLocale } from '../editor/command-types';
