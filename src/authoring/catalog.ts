import type { EditorLocale } from '../editor/command-types';
import type { LocalCompileOptions, LocalNode, LocalValue } from '../local/types';
import { localCompileOptionsKey, readLocalCompileOptions, type LocalOptionCheck } from '../local/options';
import { parseLocal } from '../local/parser';
import type { LocalComponentForm, LocalPropKind, LocalPropSchema } from '../local/schema';
import {
  DEFAULT_AUTHORING_GROUPS,
  DEFAULT_AUTHORING_ORDER,
  defaultAuthoringGroupLabel,
  defaultAuthoringKeywords,
  defaultComponentAuthoring,
  pickDefaultAuthoringText,
} from '../presets/default-authoring';
import { readLocalConfig } from '../sdk/config';
import { componentSchemaFromDefinition } from '../sdk/registry';
import type {
  LocalComponentDefinition,
  LocalComponentRequires,
  LocalComponentText,
  LocalConfig,
} from '../sdk/types';
import {
  assertSuppliedTemplateCompiles,
  assertTemplateCompiles,
  parentInsertionWrapper,
  synthesizeInsertText,
  templateProps,
} from './templates';

/**
 * Manifest-derived authoring catalog for the editor.
 *
 * Defaults and external components are projected from the same validated
 * registry. Default titles, descriptions, localized templates and search terms
 * come from the preset authoring data; external data comes from each manifest's
 * `authoring` block and prop descriptions. Nothing in this module imports
 * React, CSS or a browser API, so a worker or server can build the same menu.
 */

export interface LocalComponentCatalogProp {
  readonly name: string;
  readonly kind: LocalPropKind;
  readonly required: boolean;
  readonly static: boolean;
  readonly dynamic: boolean;
  readonly values?: readonly string[];
  readonly defaultValue?: string | number | boolean | null;
  /** Localized authoring description, when the manifest declares one. */
  readonly description?: string;
}

/** One frozen insertion-catalog entry. */
export interface LocalComponentCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  /** Localized label for `category`; falls back to the category id. */
  readonly categoryLabel: string;
  readonly insertText: string;
  readonly form: LocalComponentForm;
  /** True for inline and container forms, which accept a closing tag. */
  readonly paired: boolean;
  /** Inline components are inserted without block padding. */
  readonly inline: boolean;
  /** Structural parents that must enclose this component, when declared. */
  readonly parents?: readonly string[];
  /** Exclusive child components accepted by a container, when declared. */
  readonly allowedChildren?: readonly string[];
  /** Search terms from both languages (default preset entries). */
  readonly keywords?: readonly string[];
  readonly props: Readonly<Record<string, LocalComponentCatalogProp>>;
  /** Manifest style-resource identities preserved for export preflight. */
  readonly styles?: readonly string[];
  /** Kernel requirements preserved for configuration checks. */
  readonly requires?: LocalComponentRequires;
}

export interface LocalTagAuthoring {
  readonly name: string;
  readonly form: LocalComponentForm;
  /** True for inline and container forms, which accept a closing tag. */
  readonly paired: boolean;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly categoryLabel: string;
  readonly insertText: string;
  readonly props: Readonly<Record<string, LocalAttributeAuthoring>>;
  readonly parents?: readonly string[];
  readonly allowedChildren?: readonly string[];
  readonly keywords?: readonly string[];
  /** Manifest style-resource identities preserved for export preflight. */
  readonly styles?: readonly string[];
  /** Kernel requirements preserved for configuration checks. */
  readonly requires?: LocalComponentRequires;
}

export interface LocalAttributeAuthoring {
  readonly name: string;
  readonly kind: LocalPropKind;
  readonly required: boolean;
  readonly static: boolean;
  readonly dynamic: boolean;
  readonly values?: readonly string[];
  readonly defaultValue?: LocalValue;
  readonly pattern?: string;
  /** Localized authoring description, when the manifest declares one. */
  readonly description?: string;
}

export interface LocalAuthoringLookup {
  readonly tags: readonly LocalTagAuthoring[];
  /** Look up a tag by its exact lowercase kebab-case name. */
  tag(name: string): LocalTagAuthoring | undefined;
  attribute(tag: string, attribute: string): LocalAttributeAuthoring | undefined;
}

export interface LocalComponentCatalogGroup {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly LocalComponentCatalogEntry[];
}

export interface LocalComponentCatalogFilter {
  /** Case-insensitive search over name, title, description, category and keywords. */
  readonly query?: string;
  /** Ancestor component names from outermost to innermost. */
  readonly ancestors?: readonly string[];
}

function catalogError(message: string): Error {
  return new Error(`Invalid local component catalog: ${message}`);
}

function localized(value: LocalComponentText | undefined, locale: EditorLocale, fallback: string): string {
  return pickDefaultAuthoringText(value, locale, fallback);
}

function localizedOptional(value: LocalComponentText | undefined, locale: EditorLocale): string | undefined {
  const text = localized(value, locale, '');
  return text === '' ? undefined : text;
}

function scalarDefault(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null) return null;
  return undefined;
}

function propFromSchema(name: string, schema: LocalPropSchema): LocalComponentCatalogProp {
  return Object.freeze({
    name,
    kind: schema.kind,
    required: schema.required === true,
    static: schema.static === true,
    dynamic: schema.dynamic === true,
    ...(schema.values ? { values: Object.freeze([...schema.values]) } : {}),
    ...(scalarDefault(schema.default) !== undefined ? { defaultValue: scalarDefault(schema.default) } : {}),
  });
}

function schemaProps(
  schema: Readonly<Record<string, LocalPropSchema>>,
  locale: EditorLocale,
): Record<string, LocalComponentCatalogProp> {
  const props: Record<string, LocalComponentCatalogProp> = {};
  for (const [name, prop] of Object.entries(schema)) {
    props[name] = propFromSchema(name, prop);
  }
  return props;
}

/** Overlay declared per-prop descriptions onto the schema projection. */
function definitionProps(
  definition: LocalComponentDefinition,
  props: Record<string, LocalComponentCatalogProp>,
  locale: EditorLocale,
): Record<string, LocalComponentCatalogProp> {
  for (const [name, prop] of Object.entries(definition.props)) {
    const description = localizedOptional(prop.description, locale);
    if (description === undefined) continue;
    const existing = props[name];
    props[name] = Object.freeze({
      ...(existing ?? {
        name,
        kind: prop.kind,
        required: prop.required === true,
        static: prop.static === true,
        dynamic: prop.dynamic === true,
      }),
      description,
    });
  }
  return props;
}

function freezeEntry(input: {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  insertText: string;
  form: LocalComponentForm;
  /** Overrides the form-derived inline insertion hint for default entries. */
  inline?: boolean;
  parents?: readonly string[];
  allowedChildren?: readonly string[];
  keywords?: readonly string[];
  props: Readonly<Record<string, LocalComponentCatalogProp>>;
  styles?: readonly string[];
  requires?: LocalComponentRequires;
}): LocalComponentCatalogEntry {
  return Object.freeze({
    id: input.id,
    name: input.name,
    title: input.title,
    description: input.description,
    category: input.category,
    categoryLabel: input.categoryLabel,
    insertText: input.insertText,
    form: input.form,
    paired: input.form !== 'leaf',
    inline: input.inline ?? (input.form === 'inline'),
    ...(input.parents !== undefined ? { parents: Object.freeze([...input.parents]) } : {}),
    ...(input.allowedChildren !== undefined ? { allowedChildren: Object.freeze([...input.allowedChildren]) } : {}),
    ...(input.keywords !== undefined ? { keywords: Object.freeze([...input.keywords]) } : {}),
    props: Object.freeze({ ...input.props }),
    ...(input.styles !== undefined ? { styles: Object.freeze([...input.styles]) } : {}),
    ...(input.requires !== undefined ? { requires: Object.freeze({ ...input.requires }) } : {}),
  });
}

function structuralFields(schema: ReturnType<typeof componentSchemaFromDefinition>): {
  parents?: readonly string[];
  allowedChildren?: readonly string[];
} {
  const structure = schema.structure;
  return {
    ...(structure?.parents?.length ? { parents: structure.parents } : {}),
    ...(structure?.children?.length ? { allowedChildren: structure.children } : {}),
  };
}

/** Localized preset template, or the manifest's declared `authoring.insertText`. */
function declaredInsertText(definition: LocalComponentDefinition, locale: EditorLocale): string | undefined {
  const data = defaultComponentAuthoring(definition.name);
  if (data) {
    const text = localized(data.insertText, locale, data.insertText.en ?? '');
    return text === '' ? undefined : text;
  }
  const declared = definition.authoring?.insertText;
  return declared !== undefined && declared.trim() !== '' ? declared : undefined;
}

/** Resolve the insertion template used for validation, without catalog checks. */
function resolvedInsertText(definition: LocalComponentDefinition, locale: EditorLocale): string {
  const supplied = declaredInsertText(definition, locale);
  if (supplied !== undefined) return supplied;
  return synthesizeInsertText(definition, templateProps(definition));
}

/**
 * Legal structural parent wrapper for a parent-only entry. The parent's own
 * template supplies the required attributes, and the child is placed just
 * before the closing tag so structure rules see it in context.
 */
function parentContext(
  definition: LocalComponentDefinition,
  byName: ReadonlyMap<string, LocalComponentDefinition>,
  locale: EditorLocale,
): { before: string; after: string } | undefined {
  const parents = componentSchemaFromDefinition(definition).structure?.parents;
  if (parents === undefined || parents.length === 0) return undefined;
  for (const name of parents) {
    const parent = byName.get(name);
    if (parent === undefined || parent.form !== 'container') continue;
    let template: string;
    try {
      template = resolvedInsertText(parent, locale);
    } catch {
      continue;
    }
    const context = parentInsertionWrapper(name, template);
    if (context !== undefined) return context;
  }
  return undefined;
}

/**
 * Same parent-context rule for hosts that only hold frozen catalog entries
 * (conformance reporting). Uses the entry's already-localized template.
 */
export function localCatalogParentContext(
  entry: LocalComponentCatalogEntry,
  entries: readonly LocalComponentCatalogEntry[],
): { before: string; after: string } | undefined {
  if (entry.parents === undefined || entry.parents.length === 0) return undefined;
  for (const name of entry.parents) {
    const parent = entries.find((candidate) => candidate.name === name);
    if (parent === undefined || parent.form !== 'container') continue;
    const context = parentInsertionWrapper(name, parent.insertText);
    if (context !== undefined) return context;
  }
  return undefined;
}

function entryFromDefinition(
  definition: LocalComponentDefinition,
  locale: EditorLocale,
  options: LocalCompileOptions | undefined,
  byName: ReadonlyMap<string, LocalComponentDefinition>,
  validateTemplates: boolean,
): LocalComponentCatalogEntry {
  const schema = componentSchemaFromDefinition(definition);
  const data = defaultComponentAuthoring(definition.name);
  const authoring = definition.authoring;

  const title = data
    ? localized(data.title, locale, definition.name)
    : localized(authoring?.title, locale, definition.name);
  const description = data
    ? localized(data.description, locale, title)
    : localized(authoring?.description, locale, title);
  const declaredCategory = authoring?.category;
  const category = data?.category
    ?? (declaredCategory !== undefined && declaredCategory.trim() !== ''
      ? declaredCategory
      : 'extension');
  const categoryLabel = defaultAuthoringGroupLabel(category, locale);

  const supplied = declaredInsertText(definition, locale);
  const structure = structuralFields(schema);
  let insertText: string;
  if (supplied !== undefined) {
    insertText = supplied;
    if (validateTemplates) {
      const context = parentContext(definition, byName, locale);
      try {
        assertSuppliedTemplateCompiles(insertText, options, `component "${definition.name}"`, context);
      } catch (error) {
        throw catalogError(error instanceof Error ? error.message : String(error));
      }
    }
  } else {
    try {
      insertText = synthesizeInsertText(definition, templateProps(definition));
    } catch (error) {
      throw catalogError(error instanceof Error ? error.message : String(error));
    }
    if (validateTemplates) {
      try {
        assertTemplateCompiles(
          insertText,
          options,
          `component "${definition.name}"`,
          parentContext(definition, byName, locale),
        );
      } catch (error) {
        throw catalogError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const props = definitionProps(definition, schemaProps(schema.props, locale), locale);
  const keywords = defaultAuthoringKeywords(definition.name);

  return freezeEntry({
    // Default preset catalog ids stay the bare tag name for compatibility;
    // external components keep their manifest id.
    id: data ? definition.name : definition.id,
    name: definition.name,
    title,
    description,
    category,
    categoryLabel,
    insertText,
    form: definition.form,
    inline: data ? data.inline === true : definition.form === 'inline',
    ...structure,
    ...(keywords !== undefined ? { keywords } : {}),
    props,
    ...(definition.styles !== undefined ? { styles: definition.styles } : {}),
    ...(definition.requires !== undefined ? { requires: definition.requires } : {}),
  });
}

function catalogFromDefinitions(
  definitions: readonly LocalComponentDefinition[],
  externalNames: ReadonlySet<string>,
  locale: EditorLocale,
  options: LocalCompileOptions | undefined,
  validateTemplates: boolean,
): LocalComponentCatalogEntry[] {
  const byName = new Map(definitions.map((definition) => [definition.name, definition] as const));
  const entries: LocalComponentCatalogEntry[] = [];
  const seen = new Set<string>();

  // Default preset order is fixed by the authoring data, not by registry
  // concatenation. Extended entries intentionally come first for compatibility.
  for (const name of DEFAULT_AUTHORING_ORDER) {
    const definition = byName.get(name);
    if (!definition || definition.authoring === undefined) continue;
    // Preset templates are SDK data; external manifest templates are validated.
    entries.push(entryFromDefinition(definition, locale, options, byName, false));
    seen.add(name);
  }
  for (const definition of definitions) {
    if (seen.has(definition.name)) continue;
    if (definition.authoring === undefined && !externalNames.has(definition.name)) continue;
    entries.push(entryFromDefinition(
      definition,
      locale,
      options,
      byName,
      validateTemplates && externalNames.has(definition.name),
    ));
    seen.add(definition.name);
  }
  return entries;
}

type LocalOptionSuccess = Extract<LocalOptionCheck, { ok: true }>;

/** Catalog-visible metadata for one definition; authoring copy is included. */
function catalogMetadataKey(definition: LocalComponentDefinition, locale: EditorLocale): string {
  const data = defaultComponentAuthoring(definition.name);
  const authoring = definition.authoring;
  const descriptions: Record<string, LocalComponentText | undefined> = {};
  for (const [name, prop] of Object.entries(definition.props)) {
    descriptions[name] = prop.description;
  }
  return JSON.stringify({
    name: definition.name,
    id: definition.id,
    form: definition.form,
    title: data
      ? localized(data.title, locale, definition.name)
      : localized(authoring?.title, locale, definition.name),
    description: data
      ? localized(data.description, locale, '')
      : localized(authoring?.description, locale, ''),
    category: data?.category ?? authoring?.category ?? '',
    categoryLabel: defaultAuthoringGroupLabel(data?.category ?? authoring?.category ?? 'extension', locale),
    insertText: declaredInsertText(definition, locale) ?? null,
    inline: data ? data.inline === true : definition.form === 'inline',
    keywords: defaultAuthoringKeywords(definition.name) ?? null,
    manifest: authoring ?? null,
    preset: data ?? null,
    propDescriptions: descriptions,
    structure: componentSchemaFromDefinition(definition).structure ?? null,
    styles: definition.styles ?? null,
    requires: definition.requires ?? null,
  });
}

/**
 * Stable signature of everything the authored catalog reads, including
 * authoring copy that the compile-semantics key deliberately excludes.
 *
 * Editors memoize the catalog on this key: a metadata-only configuration change
 * rebuilds the menu, while an equivalent options object is reused.
 */
export function localComponentCatalogKey(
  options?: LocalCompileOptions,
  locale: EditorLocale = 'en',
): string {
  const check = readLocalCompileOptions(options);
  if (!check.ok) return `invalid|${locale}`;
  const definitions = check.registry.map((definition) => catalogMetadataKey(definition, locale));
  return `${localCompileOptionsKey(options)}|${locale}|${definitions.join('\u0000')}`;
}

function catalogForCheck(
  check: LocalOptionSuccess,
  locale: EditorLocale,
  options: LocalCompileOptions | undefined,
  validateTemplates: boolean,
): readonly LocalComponentCatalogEntry[] {
  return Object.freeze(catalogFromDefinitions(
    check.registry,
    check.externalComponentNames,
    locale,
    options,
    validateTemplates,
  ));
}

/**
 * Frozen insertion catalog for a configuration. Invalid configurations throw;
 * this keeps `createLocalConfig`/registration errors visible to hosts that build
 * the catalog eagerly.
 */
export function createLocalComponentCatalog(
  config: LocalConfig,
  locale: EditorLocale = 'en',
): readonly LocalComponentCatalogEntry[] {
  const validated = readLocalConfig(config);
  const check = readLocalCompileOptions({ config: validated });
  if (!check.ok) throw catalogError(check.message);
  return catalogForCheck(check, locale, { config: validated }, true);
}

/**
 * Catalog without compiling external insertion templates.
 *
 * Conformance reporting needs every declared entry so it can report each bad
 * template individually instead of aborting on the first error. This is not
 * re-exported from the public authoring entry.
 */
export function createLocalComponentCatalogUnchecked(
  config: LocalConfig,
  locale: EditorLocale = 'en',
): readonly LocalComponentCatalogEntry[] {
  const validated = readLocalConfig(config);
  const check = readLocalCompileOptions({ config: validated });
  if (!check.ok) throw catalogError(check.message);
  return catalogForCheck(check, locale, { config: validated }, false);
}

/**
 * Catalog for the same `LocalCompileOptions` the editor and compiler use.
 * Invalid options produce an empty catalog so a malformed host option cannot
 * break the editor shell; the compiler still reports the error normally.
 */
export function createLocalComponentCatalogForOptions(
  options?: LocalCompileOptions,
  locale: EditorLocale = 'en',
): readonly LocalComponentCatalogEntry[] {
  const check = readLocalCompileOptions(options);
  if (!check.ok) return Object.freeze([]);
  return catalogForCheck(check, locale, options, true);
}

/**
 * Group catalog entries for a menu. Known default categories keep their
 * authoring order; additional host categories appear in first-seen order.
 */
export function localComponentCatalogGroups(
  entries: readonly LocalComponentCatalogEntry[],
): readonly LocalComponentCatalogGroup[] {
  const knownOrder = new Map<string, number>(DEFAULT_AUTHORING_GROUPS.map((group, index) => [group.id, index]));
  const groups = new Map<string, { id: string; label: string; entries: LocalComponentCatalogEntry[] }>();
  for (const entry of entries) {
    const existing = groups.get(entry.category);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(entry.category, {
        id: entry.category,
        label: entry.categoryLabel,
        entries: [entry],
      });
    }
  }
  return Object.freeze(
    [...groups.values()]
      .map((group, index) => ({
        ...group,
        index,
        rank: knownOrder.get(group.id) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((group) => Object.freeze({
        id: group.id,
        label: group.label,
        entries: Object.freeze([...group.entries]),
      })),
  );
}

/**
 * Structural filter for a menu opened at a caret.
 *
 * - Components that declare `parents` only appear while one of those ancestors
 *   encloses the caret.
 * - When the innermost catalog parent declares exclusive children, only those
 *   children remain available.
 * - The optional query is matched against literal text fields; descriptions
 *   are never interpreted as HTML.
 */
export function filterLocalComponentCatalog(
  entries: readonly LocalComponentCatalogEntry[],
  filter: LocalComponentCatalogFilter = {},
): readonly LocalComponentCatalogEntry[] {
  const ancestors = filter.ancestors ?? [];
  const innermost = ancestors[ancestors.length - 1];
  const parent = innermost === undefined ? undefined : entries.find((entry) => entry.name === innermost);
  const allowed = parent?.allowedChildren;
  const term = (filter.query ?? '').trim().toLowerCase();
  const result = entries.filter((entry) => {
    if (entry.parents !== undefined && entry.parents.length > 0
      && !entry.parents.some((name) => ancestors.includes(name))) return false;
    if (allowed !== undefined && allowed.length > 0 && !allowed.includes(entry.name)) return false;
    if (term === '') return true;
    return [
      entry.name,
      entry.title,
      entry.description,
      entry.categoryLabel,
      ...(entry.keywords ?? []),
    ].some((value) => value.toLowerCase().includes(term));
  });
  return Object.freeze(result);
}

/** Plain-text help: component description followed by declared property help. */
export function localComponentHelp(entry: LocalComponentCatalogEntry): string {
  const lines: string[] = [];
  if (entry.description !== '') lines.push(entry.description);
  for (const prop of Object.values(entry.props)) {
    if (prop.description !== undefined) lines.push(`${prop.name}: ${prop.description}`);
  }
  return lines.join('\n');
}

/**
 * Ancestor components at `offset`, outermost to innermost. Uses the same
 * validated compile options as analysis and completion. Returns no ancestors
 * in HTML mode or when options are invalid.
 */
export function localCatalogAncestors(
  source: string,
  offset: number,
  options?: LocalCompileOptions,
): readonly string[] {
  if (typeof source !== 'string' || !Number.isFinite(offset)) return Object.freeze([]);
  const check = readLocalCompileOptions(options);
  if (!check.ok || check.htmlActive) return Object.freeze([]);
  const limit = Math.max(0, Math.min(source.length, Math.floor(offset)));
  let found: readonly string[] = Object.freeze([]);
  let parsed: ReturnType<typeof parseLocal>;
  try {
    parsed = parseLocal(source, options);
  } catch {
    return found;
  }
  const visit = (nodes: readonly LocalNode[], ancestors: readonly string[]): void => {
    for (const node of nodes) {
      if ((node.type === 'component' || node.type === 'hostComponent')
        && node.name !== undefined
        && node.range.start <= limit && limit < node.range.end) {
        const next = Object.freeze([...ancestors, node.name]);
        found = next;
        if (node.children) visit(node.children, next);
      } else if (node.type !== 'fallback' && node.children) {
        visit(node.children, ancestors);
      }
    }
  };
  visit(parsed.nodes, Object.freeze([]));
  return found;
}

function builtinAttributes(schema: ReturnType<typeof componentSchemaFromDefinition> | undefined): Record<string, LocalAttributeAuthoring> {
  const attributes: Record<string, LocalAttributeAuthoring> = {};
  if (!schema) return attributes;
  for (const [name, prop] of Object.entries(schema.props)) {
    attributes[name] = Object.freeze({
      name,
      kind: prop.kind,
      required: prop.required === true,
      static: prop.static === true,
      dynamic: prop.dynamic === true,
      ...(prop.values ? { values: Object.freeze([...prop.values]) } : {}),
      ...(prop.default !== undefined ? { defaultValue: prop.default } : {}),
    });
  }
  return attributes;
}

function freezeTag(info: {
  name: string;
  form: LocalComponentForm;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  insertText: string;
  props: Readonly<Record<string, LocalAttributeAuthoring>>;
  parents?: readonly string[];
  allowedChildren?: readonly string[];
  keywords?: readonly string[];
  styles?: readonly string[];
  requires?: LocalComponentRequires;
}): LocalTagAuthoring {
  return Object.freeze({
    name: info.name,
    form: info.form,
    paired: info.form !== 'leaf',
    title: info.title,
    description: info.description,
    category: info.category,
    categoryLabel: info.categoryLabel,
    insertText: info.insertText,
    props: Object.freeze({ ...info.props }),
    ...(info.parents !== undefined ? { parents: Object.freeze([...info.parents]) } : {}),
    ...(info.allowedChildren !== undefined ? { allowedChildren: Object.freeze([...info.allowedChildren]) } : {}),
    ...(info.keywords !== undefined ? { keywords: Object.freeze([...info.keywords]) } : {}),
    ...(info.styles !== undefined ? { styles: Object.freeze([...info.styles]) } : {}),
    ...(info.requires !== undefined ? { requires: Object.freeze({ ...info.requires }) } : {}),
  });
}

function makeLookup(tags: readonly LocalTagAuthoring[]): LocalAuthoringLookup {
  const byName = new Map(tags.map((tag) => [tag.name, tag] as const));
  const frozen = Object.freeze([...tags]);
  return Object.freeze({
    tags: frozen,
    tag(name: string): LocalTagAuthoring | undefined {
      return byName.get(name);
    },
    attribute(tag: string, attribute: string): LocalAttributeAuthoring | undefined {
      return byName.get(tag)?.props[attribute];
    },
  });
}

/**
 * Tag, attribute and description lookup for an authoring host.
 *
 * Component shapes come from `readLocalCompileOptions`, so a `config` option
 * sees exactly the components the compiler accepted. Default localized
 * templates and keywords come from preset authoring data; external titles,
 * descriptions, templates and property help come from the same manifests.
 */
export function createLocalAuthoringLookup(
  options?: LocalCompileOptions,
  locale: EditorLocale = 'en',
): LocalAuthoringLookup {
  const check = readLocalCompileOptions(options);
  if (!check.ok) return makeLookup([]);

  let catalog: readonly LocalComponentCatalogEntry[] = [];
  try {
    // The lookup exposes tag names and schema props. An invalid supplied
    // template must not hide every tag; conformance reports it separately.
    catalog = catalogForCheck(check, locale, options, false);
  } catch {
    catalog = Object.freeze([]);
  }
  const entryByName = new Map(catalog.map((entry) => [entry.name, entry] as const));

  const tags: LocalTagAuthoring[] = [];
  for (const [name, schema] of check.schemaByName) {
    const entry = entryByName.get(name);
    const props = builtinAttributes(schema);
    for (const [attribute, prop] of Object.entries(entry?.props ?? {})) {
      props[attribute] = Object.freeze({ ...props[attribute], ...prop });
    }
    tags.push(freezeTag({
      name,
      form: schema.form,
      title: entry?.title ?? name,
      description: entry?.description ?? '',
      category: entry?.category ?? 'component',
      categoryLabel: entry?.categoryLabel ?? 'component',
      insertText: entry?.insertText ?? '',
      props,
      ...(entry?.parents !== undefined ? { parents: entry.parents } : {}),
      ...(entry?.allowedChildren !== undefined ? { allowedChildren: entry.allowedChildren } : {}),
      ...(entry?.keywords !== undefined ? { keywords: entry.keywords } : {}),
      ...(entry?.styles !== undefined ? { styles: entry.styles } : {}),
      ...(entry?.requires !== undefined ? { requires: entry.requires } : {}),
    }));
  }

  return makeLookup(tags);
}
