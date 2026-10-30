import {
  getNativeComponentCatalog,
  renderNativeSnippet,
  type NativeComponentDefinition,
} from '../editor/native-components';
import { insertTemplate } from '../editor/editor-commands';
import type { EditorEdit, EditorLocale, EditorSelection } from '../editor/command-types';
import { RESERVED_NAMES } from '../local/expression';
import { readLocalCompileOptions } from '../local/options';
import { analyzeLocalSource, renameLocalBinding } from '../local/authoring';
import {
  LOCAL_COMPONENT_NAMES,
  getLocalComponent,
  type LocalComponentForm,
  type LocalPropKind,
  type LocalPropSchema,
} from '../local/schema';
import type {
  LocalCompileOptions,
  LocalHostComponentSchema,
  LocalHostPropSchema,
  LocalValue,
} from '../local/types';
import { readLocalConfig } from '../sdk/config';
import type {
  LocalComponentDefinition,
  LocalComponentProp,
  LocalComponentRequires,
  LocalComponentText,
  LocalConfig,
} from '../sdk/types';

/**
 * Authoring data derived from an instance-level SDK configuration.
 *
 * The catalog is built from the existing native catalog plus the external
 * component manifests in a `LocalConfig`. Manifests without an insert template
 * receive a minimal synthesized one when the declaration makes that legal;
 * otherwise catalog creation fails with a descriptive error instead of
 * inserting a document that cannot compile.
 *
 * Completion and hover data are read through `readLocalCompileOptions`, the
 * same validator the compiler uses. Config components are therefore visible to
 * authoring only after the option layer has lowered them to host schemas; this
 * module never duplicates compiler schema logic.
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
  readonly insertText: string;
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
  readonly insertText: string;
  readonly props: Readonly<Record<string, LocalAttributeAuthoring>>;
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


function catalogError(message: string): Error {
  return new Error(`Invalid local component catalog: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localized(value: unknown, locale: EditorLocale, fallback: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (isRecord(value)) {
    const preferred = value[locale];
    if (typeof preferred === 'string' && preferred.trim() !== '') return preferred;
    const other = value[locale === 'zh' ? 'en' : 'zh'];
    if (typeof other === 'string' && other.trim() !== '') return other;
  }
  return fallback;
}

function localizedOptional(value: unknown, locale: EditorLocale): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (isRecord(value)) {
    const preferred = value[locale];
    if (typeof preferred === 'string' && preferred.trim() !== '') return preferred;
    const other = value[locale === 'zh' ? 'en' : 'zh'];
    if (typeof other === 'string' && other.trim() !== '') return other;
  }
  return undefined;
}

function scalarDefault(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null) return null;
  return undefined;
}

interface ManifestProp {
  readonly kind: LocalPropKind;
  readonly required: boolean;
  readonly static: boolean;
  readonly dynamic: boolean;
  readonly values?: readonly string[];
  readonly defaultValue?: string | number | boolean | null;
  readonly pattern?: string;
  readonly min?: number;
  readonly max?: number;
  readonly integer: boolean;
  /** Built-in schemas can require a bounded color literal. */
  readonly color: boolean;
  /**
   * Optional locale-keyed per-prop help text, preserved from the validated
   * manifest when core provides it.
   */
  readonly description?: LocalComponentText;
}

/**
 * Convert one already-validated manifest prop to the catalog projection.
 * Core owns type/default/range validation; this only normalizes for authoring.
 */
function manifestPropFromDefinition(prop: LocalComponentProp): ManifestProp {
  return {
    kind: prop.kind,
    required: prop.required === true,
    static: prop.static === true,
    dynamic: prop.dynamic === true,
    values: prop.enum ? Object.freeze([...prop.enum]) : undefined,
    defaultValue: scalarDefault(prop.default),
    pattern: prop.pattern,
    min: prop.min,
    max: prop.max,
    integer: prop.integer === true,
    color: false,
    ...(prop.description !== undefined ? { description: prop.description } : {}),
  };
}

function manifestPropFromSchema(schema: LocalPropSchema): ManifestProp {
  return {
    kind: schema.kind,
    required: schema.required === true,
    static: schema.static === true,
    dynamic: schema.dynamic === true,
    values: schema.values ? Object.freeze([...schema.values]) : undefined,
    defaultValue: scalarDefault(schema.default),
    pattern: undefined,
    min: schema.min,
    max: schema.max,
    integer: schema.integer === true,
    color: schema.color === true,
  };
}

function entryProp(name: string, prop: ManifestProp, locale: EditorLocale = 'en'): LocalComponentCatalogProp {
  const description = localizedOptional(prop.description, locale);
  return Object.freeze({
    name,
    kind: prop.kind,
    required: prop.required,
    static: prop.static,
    dynamic: prop.dynamic,
    ...(prop.values ? { values: prop.values } : {}),
    ...(prop.defaultValue !== undefined ? { defaultValue: prop.defaultValue } : {}),
    ...(description !== undefined ? { description } : {}),
  });
}

function freezeEntry(input: {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  insertText: string;
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
    insertText: input.insertText,
    props: Object.freeze({ ...input.props }),
    ...(input.styles !== undefined ? { styles: Object.freeze([...input.styles]) } : {}),
    ...(input.requires !== undefined ? { requires: Object.freeze({ ...input.requires }) } : {}),
  });
}

function commonProps(
  schemaProps: Readonly<Record<string, LocalPropSchema>>,
  locale: EditorLocale,
): Record<string, LocalComponentCatalogProp> {
  const props: Record<string, LocalComponentCatalogProp> = {};
  for (const [name, schema] of Object.entries(schemaProps)) {
    props[name] = entryProp(name, manifestPropFromSchema(schema), locale);
  }
  return props;
}

function builtinEntries(locale: EditorLocale): LocalComponentCatalogEntry[] {
  return getNativeComponentCatalog(locale).components.map((component) => {
    const schema = getLocalComponent(component.id);
    if (!schema) throw catalogError(`native component "${component.id}" has no built-in schema.`);
    return freezeEntry({
      id: component.id,
      name: component.id,
      title: component.label,
      description: component.description,
      category: component.group,
      insertText: component.template,
      props: commonProps(schema.props, locale),
    });
  });
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAttribute(value: string | number | boolean | null): string {
  return value === null ? '' : escapeAttribute(String(value));
}

function bindingName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  const base = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  return RESERVED_NAMES.has(base) ? `${base}_value` : base;
}

function requiredSample(prop: ManifestProp, lead: string): string {
  if (prop.defaultValue !== undefined && prop.defaultValue !== null) {
    return formatAttribute(prop.defaultValue);
  }
  switch (prop.kind) {
    case 'boolean':
      return 'false';
    case 'enum':
      if (prop.values?.length) return formatAttribute(prop.values[0]);
      throw catalogError(`${lead} is a required enum without values; provide an authoring.insertText.`);
    case 'number': {
      const low = prop.min === undefined ? undefined : (prop.integer ? Math.ceil(prop.min) : prop.min);
      const high = prop.max === undefined ? undefined : (prop.integer ? Math.floor(prop.max) : prop.max);
      if (low !== undefined && high !== undefined && low > high) {
        throw catalogError(`${lead} has no integer inside its declared range; provide an authoring.insertText.`);
      }
      let value = low !== undefined && low > 0 ? low : high !== undefined && high < 0 ? high : 0;
      if (low !== undefined && value < low) value = low;
      if (high !== undefined && value > high) value = high;
      if (!Number.isFinite(value)) {
        throw catalogError(`${lead} is a required number without a legal finite value; provide an authoring.insertText.`);
      }
      return String(value);
    }
    case 'string':
      if (prop.color) return '#000000';
      if (prop.pattern) {
        throw catalogError(`${lead} is a required pattern-constrained string; provide an authoring.insertText.`);
      }
      return '';
    default:
      throw catalogError(`${lead} has an unsupported property kind; provide an authoring.insertText.`);
  }
}

function manifestRequiresChildren(definition: LocalComponentDefinition): boolean {
  const children: unknown = (definition as unknown as { children?: unknown }).children;
  if (Array.isArray(children)) {
    return children.some((entry) => isRecord(entry)
      && (entry.required === true || (typeof entry.min === 'number' && entry.min > 0)));
  }
  if (isRecord(children)) {
    return children.required === true || (typeof children.min === 'number' && children.min > 0);
  }
  return false;
}

function synthesizeInsertText(
  definition: LocalComponentDefinition,
  name: string,
  props: Readonly<Record<string, ManifestProp>>,
): string {
  const form = definition.form;
  if (form !== 'leaf' && form !== 'inline' && form !== 'container') {
    throw catalogError(`component "${name}" has an unsupported form.`);
  }
  if (manifestRequiresChildren(definition)) {
    throw catalogError(`component "${name}" requires children; provide an authoring.insertText.`);
  }
  const binding = definition.bindings?.value;
  const bindAttribute = typeof binding?.bind === 'string' ? binding.bind : 'bind';
  const initialAttribute = typeof binding?.initial === 'string' ? binding.initial : 'initial';
  const attributes: string[] = [];
  if (binding) {
    // A literal, document-independent name keeps the synthesized template
    // directly compilable; insertion tools may rename it to avoid collisions.
    attributes.push(`${bindAttribute}="${bindingName(name)}"`);
  }
  for (const [propName, prop] of Object.entries(props)) {
    if (!prop.required) continue;
    if (binding && (propName === bindAttribute || propName === initialAttribute)) continue;
    attributes.push(`${propName}="${requiredSample(prop, `component "${name}" property "${propName}"`)}"`);
  }
  const head = `<${name}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}`;
  if (form === 'leaf') return `${head}>`;
  if (form === 'inline') return `${head}></${name}>`;
  return `${head}>\n\n</${name}>`;
}

interface ManifestInfo {
  readonly definition: LocalComponentDefinition;
  readonly name: string;
  readonly id: string;
  readonly form: LocalComponentForm;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly insertText: string;
  readonly props: Readonly<Record<string, ManifestProp>>;
  readonly styles?: readonly string[];
  readonly requires?: LocalComponentRequires;
}

function readManifest(definition: LocalComponentDefinition, locale: EditorLocale): ManifestInfo {
  const props: Record<string, ManifestProp> = {};
  for (const [propName, prop] of Object.entries(definition.props)) {
    props[propName] = manifestPropFromDefinition(prop);
  }
  const authoring = (definition.authoring ?? {}) as unknown as Record<string, unknown>;
  const title = localized(authoring.title, locale, definition.name);
  const description = localized(authoring.description, locale, title);
  const category = typeof authoring.category === 'string' && authoring.category.trim() !== ''
    ? authoring.category
    : 'extension';
  const manual = typeof authoring.insertText === 'string' && authoring.insertText.trim() !== ''
    ? authoring.insertText
    : undefined;
  const insertText = manual ?? synthesizeInsertText(definition, definition.name, props);
  return {
    definition,
    name: definition.name,
    id: definition.id,
    form: definition.form,
    title,
    description,
    category,
    insertText,
    props: Object.freeze(props),
    ...(definition.styles !== undefined ? { styles: definition.styles } : {}),
    ...(definition.requires !== undefined ? { requires: definition.requires } : {}),
  };
}

function manifestEntries(
  config: LocalConfig | undefined,
  locale: EditorLocale,
): { entries: LocalComponentCatalogEntry[]; infos: ManifestInfo[] } {
  const entries: LocalComponentCatalogEntry[] = [];
  const infos: ManifestInfo[] = [];
  const components = config?.components ?? [];
  for (const definition of components) {
    const info = readManifest(definition, locale);
    infos.push(info);
    const props: Record<string, LocalComponentCatalogProp> = {};
    for (const [propName, prop] of Object.entries(info.props)) {
      props[propName] = entryProp(propName, prop, locale);
    }
    entries.push(freezeEntry({
      id: info.id,
      name: info.name,
      title: info.title,
      description: info.description,
      category: info.category,
      insertText: info.insertText,
      props,
      requires: info.requires,
      styles: info.styles,
    }));
  }
  return { entries, infos };
}

function catalogFromValidated(
  config: LocalConfig,
  locale: EditorLocale,
): readonly LocalComponentCatalogEntry[] {
  const builtins = builtinEntries(locale);
  const { entries } = manifestEntries(config, locale);
  const names = new Set(builtins.map((entry) => entry.name));
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw catalogError(`component "${entry.name}" conflicts with a built-in component.`);
    }
    names.add(entry.name);
  }
  return Object.freeze([...builtins, ...entries]);
}

/**
 * Frozen insertion catalog for a configuration: every native catalog entry
 * first, then external component manifests in declaration order. The input is
 * revalidated with the core `readLocalConfig`, so future manifest fields
 * (`requires`, `styles`, prop descriptions, ...) are handled by the core
 * validator rather than a private parallel reader.
 */
export function createLocalComponentCatalog(
  config: LocalConfig,
  locale: EditorLocale = 'en',
): readonly LocalComponentCatalogEntry[] {
  return catalogFromValidated(readLocalConfig(config), locale);
}

const IDENTIFIERS = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Allocate fresh declarations and active references together using the public
 * authoring rename path. Code, comments and expression string literals remain
 * intact; nested controls use the same rule as the outer component.
 */
function freshSnippetBindings(
  template: string,
  config: LocalConfig,
  source: string,
): string {
  const used = new Set(source.match(IDENTIFIERS) ?? []);
  const declarations = analyzeLocalSource(template, { config }, { diagnostics: false }).bindings
    .filter(binding => binding.declarations.length > 0).map(binding => binding.name);
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
    if (name !== original) result = renameLocalBinding(result, original, name, { config }).source;
  }
  return result;
}

/**
 * Insert one catalog component into `source`.
 *
 * The catalog template is resolved in three passes: `renderNativeSnippet`
 * allocates bindings for `{{bind:...}}` tokens, literal binding attributes are
 * retargeted to fresh names (so repeated insertion never silently reuses an
 * existing binding), then `insertTemplate` expands selection/caret/select
 * tokens and applies block padding. The result is directly compilable with the
 * same configuration.
 */
export function insertLocalComponent(
  config: LocalConfig,
  componentId: string,
  source: string,
  selection: EditorSelection,
  locale: EditorLocale = 'en',
): EditorEdit {
  if (typeof source !== 'string') throw new TypeError('insertLocalComponent requires source text.');
  if (typeof componentId !== 'string' || componentId.length === 0) {
    throw new TypeError('insertLocalComponent requires a component id.');
  }
  const validated = readLocalConfig(config);
  const catalog = catalogFromValidated(validated, locale);
  const entry = catalog.find((item) => item.id === componentId || item.name === componentId);
  if (!entry) throw new Error(`Unknown local component "${componentId}".`);
  const definition = validated.components.find(
    (item) => item.id === entry.id || item.name === entry.name,
  );
  const native: NativeComponentDefinition = {
    id: entry.id,
    label: entry.title,
    description: entry.description,
    group: 'input',
    keywords: [],
    template: entry.insertText,
  };
  const snippet = renderNativeSnippet(native, source);
  const rewritten = freshSnippetBindings(
    snippet,
    validated,
    source,
  );
  const form = definition?.form ?? getLocalComponent(entry.name)?.form ?? 'leaf';
  return insertTemplate(source, selection, rewritten, { block: form !== 'inline' });
}

function hostAttribute(
  name: string,
  prop: LocalHostPropSchema,
  locale: EditorLocale,
  manifest?: ManifestProp,
): LocalAttributeAuthoring {
  const description = localizedOptional(manifest?.description, locale);
  return Object.freeze({
    name,
    kind: prop.kind,
    required: prop.required === true || manifest?.required === true,
    static: prop.static === true,
    dynamic: prop.static !== true,
    ...(prop.enum ?? manifest?.values ? { values: Object.freeze([...(prop.enum ?? manifest?.values ?? [])]) } : {}),
    ...(manifest?.defaultValue !== undefined ? { defaultValue: manifest.defaultValue } : {}),
    ...(prop.pattern ?? manifest?.pattern ? { pattern: prop.pattern ?? manifest?.pattern } : {}),
    ...(description !== undefined ? { description } : {}),
  });
}

function hostAttributes(
  host: LocalHostComponentSchema,
  locale: EditorLocale,
  manifest?: Readonly<Record<string, ManifestProp>>,
): Record<string, LocalAttributeAuthoring> {
  const attributes: Record<string, LocalAttributeAuthoring> = {};
  for (const [name, prop] of Object.entries(host.props)) {
    attributes[name] = hostAttribute(name, prop, locale, manifest?.[name]);
  }
  if (host.binding) {
    attributes.bind = Object.freeze({
      name: 'bind',
      kind: 'string',
      required: false,
      static: true,
      dynamic: false,
    } as LocalAttributeAuthoring);
    attributes.initial = Object.freeze({
      name: 'initial',
      kind: host.binding.kind,
      required: false,
      static: true,
      dynamic: false,
    } as LocalAttributeAuthoring);
    attributes.disabled = Object.freeze({
      name: 'disabled',
      kind: 'boolean',
      required: false,
      static: false,
      dynamic: true,
    } as LocalAttributeAuthoring);
  }
  return attributes;
}

function builtinAttributes(schema: ReturnType<typeof getLocalComponent>): Record<string, LocalAttributeAuthoring> {
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
  insertText: string;
  props: Readonly<Record<string, LocalAttributeAuthoring>>;
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
    insertText: info.insertText,
    props: Object.freeze({ ...info.props }),
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
 * sees exactly the components the compiler accepted. Titles, descriptions and
 * insert templates for external components come from the same manifests.
 */
export function createLocalAuthoringLookup(
  options?: LocalCompileOptions,
  locale: EditorLocale = 'en',
): LocalAuthoringLookup {
  const check = readLocalCompileOptions(options);
  if (!check.ok) return makeLookup([]);

  const config = check.config;
  const { infos } = manifestEntries(config, locale);
  const infoByName = new Map(infos.map((info) => [info.name, info] as const));
  const native = new Map(
    getNativeComponentCatalog(locale).components.map((entry) => [entry.id, entry] as const),
  );

  const tags: LocalTagAuthoring[] = [];
  for (const name of LOCAL_COMPONENT_NAMES) {
    const schema = getLocalComponent(name);
    if (!schema) continue;
    const nativeEntry = native.get(name);
    tags.push(freezeTag({
      name,
      form: schema.form,
      title: nativeEntry?.label ?? name,
      description: nativeEntry?.description ?? '',
      category: nativeEntry?.group ?? 'component',
      insertText: nativeEntry?.template ?? '',
      props: builtinAttributes(schema),
    }));
  }

  for (const host of check.hostComponents) {
    const schema = getLocalComponent(host.name);
    if (schema) continue; // host names never shadow built-ins after validation
    const info = infoByName.get(host.name);
    tags.push(freezeTag({
      name: host.name,
      form: host.form,
      title: info?.title ?? host.name,
      description: info?.description ?? '',
      category: info?.category ?? 'extension',
      insertText: info?.insertText ?? '',
      props: hostAttributes(host, locale, info?.props),
      requires: info?.requires,
      styles: info?.styles,
    }));
  }

  return makeLookup(tags);
}
