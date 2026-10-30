import { insertTemplate } from '../editor/editor-commands';
import type { EditorEdit, EditorLocale, EditorSelection } from '../editor/command-types';
import { RESERVED_NAMES } from '../local/expression';
import { analyzeLocalSource, renameLocalBinding } from '../local/authoring';
import { readLocalCompileOptions } from '../local/options';
import type { LocalCompileOptions } from '../local/types';
import { readLocalConfig } from '../sdk/config';
import type { LocalConfig } from '../sdk/types';
import {
  createLocalComponentCatalogForOptions,
  type LocalComponentCatalogEntry,
} from './catalog';
import { renderNativeSnippet, type NativeComponentDefinition } from '../editor/native-components';

/**
 * Insert one catalog component with the same configuration the editor uses.
 *
 * Binding tokens are resolved first, then existing literal declarations are
 * retargeted to fresh names so repeated insertion never silently reuses a
 * binding. `insertTemplate` expands selection/caret tokens and applies block
 * padding. The resulting edit is a single source change, so the editor's normal
 * undo/redo history covers it.
 */

const IDENTIFIERS = /[A-Za-z_][A-Za-z0-9_]*/g;

function freshSnippetBindings(
  template: string,
  options: LocalCompileOptions | undefined,
  source: string,
): string {
  const used = new Set(source.match(IDENTIFIERS) ?? []);
  const declarations = analyzeLocalSource(template, options, { diagnostics: false }).bindings
    .filter((binding) => binding.declarations.length > 0)
    .map((binding) => binding.name);
  const declared = new Set(declarations);
  let result = template;
  for (const original of declarations) {
    let name = original;
    let suffix = 2;
    while (used.has(name) || RESERVED_NAMES.has(name) || (name !== original && declared.has(name))) {
      name = `${original}${suffix}`;
      suffix += 1;
    }
    used.add(name);
    if (name !== original) result = renameLocalBinding(result, original, name, options).source;
  }
  return result;
}

function nativeDefinition(entry: {
  id: string;
  title: string;
  description: string;
  insertText: string;
}): NativeComponentDefinition {
  return {
    id: entry.id,
    label: entry.title,
    description: entry.description,
    group: 'input',
    keywords: [],
    template: entry.insertText,
  };
}

/** Insert one already-resolved catalog entry. */
export function insertCatalogEntryFromOptions(
  entry: LocalComponentCatalogEntry,
  options: LocalCompileOptions | undefined,
  source: string,
  selection: EditorSelection,
): EditorEdit {
  const snippet = renderNativeSnippet(nativeDefinition(entry), source);
  const rewritten = freshSnippetBindings(snippet, options, source);
  return insertTemplate(source, selection, rewritten, { block: !entry.inline });
}

/**
 * Insert one component id from the compile-option catalog.
 *
 * The public catalog validates external templates before offering them, so a
 * snippet taken from it inserts a document that compiles. Conformance uses
 * `insertCatalogEntryFromOptions` with an unchecked catalog instead.
 */
export function insertLocalComponentFromOptions(
  options: LocalCompileOptions | undefined,
  componentId: string,
  source: string,
  selection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  if (typeof source !== 'string') throw new TypeError('insertLocalComponent requires source text.');
  if (typeof componentId !== 'string' || componentId.length === 0) {
    throw new TypeError('insertLocalComponent requires a component id.');
  }
  const check = readLocalCompileOptions(options);
  if (!check.ok) throw new Error(`Invalid compile options: ${check.message}`);
  const catalog = createLocalComponentCatalogForOptions(options, locale);
  const entry = catalog.find((item) => item.id === componentId || item.name === componentId);
  if (!entry) throw new Error(`Unknown local component "${componentId}".`);
  return insertCatalogEntryFromOptions(entry, options, source, selection);
}

/** Compatibility wrapper for hosts that already hold a validated config. */
export function insertLocalComponent(
  config: LocalConfig,
  componentId: string,
  source: string,
  selection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  const validated = readLocalConfig(config);
  return insertLocalComponentFromOptions(
    { config: validated },
    componentId,
    source,
    selection,
    locale,
  );
}
