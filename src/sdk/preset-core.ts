import { localHash } from './hash';
import { defineLocalComponent, isLocalComponentId, localComponentDigest } from './manifest';
import type { LocalThemePackage } from './theme';
import {
  LOCAL_PRESET_PROTOCOL,
  isLocalVersion,
} from './version';
import type {
  LocalComponentAuthoring,
  LocalComponentDefinition,
  LocalComponentText,
  LocalPresetAuthoring,
  LocalPresetPackage,
  LocalPresetReference,
} from './types';

/**
 * Preset packages are plain, frozen data. They are the semantic input of an
 * assembly; React implementations, resources and build metadata stay in the
 * host layer and are paired by manifest identity.
 */

const MAX_PRESET_ID_LENGTH = 160;
const MAX_PRESET_COMPONENTS = 256;
const MAX_PRESET_DEPENDENCIES = 32;
const MAX_PRESET_AUTHORING = 256;
const MAX_PRESET_TEXT_LENGTH = 4096;
const PRESET_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PRESET_KEYS = new Set([
  'protocol', 'id', 'version', 'components', 'authoring', 'themes', 'dependencies', 'metadata',
]);
const AUTHORING_KEYS = new Set(['title', 'description', 'category', 'insertText']);
const METADATA_KEYS = new Set(['title', 'description']);
const DEPENDENCY_KEYS = new Set(['id', 'version']);

const validatedPresets = new WeakSet<object>();

function presetError(path: string, message: string): never {
  throw new Error(`Invalid local preset (${path}): ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) presetError(path, `field "${key}" is not allowed.`);
    if (!allowed.has(key)) presetError(path, `unknown field "${key}".`);
  }
}

function readText(value: unknown, path: string): LocalComponentText {
  if (!isRecord(value)) presetError(path, 'must be a locale-keyed string map.');
  const out: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    if (DANGEROUS_KEYS.has(key)) presetError(path, `locale "${key}" is not allowed.`);
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(key)) {
      presetError(path, `locale "${key}" must look like "en" or "zh-CN".`);
    }
    const text = value[key];
    if (typeof text !== 'string' || text.length > MAX_PRESET_TEXT_LENGTH) {
      presetError(path, `locale "${key}" must be a bounded string.`);
    }
    out[key] = text;
  }
  return Object.freeze(out);
}

function readAuthoring(value: unknown): LocalComponentAuthoring {
  if (!isRecord(value)) presetError('authoring', 'must be an object.');
  checkKeys(value, AUTHORING_KEYS, 'authoring');
  const out: {
    title?: LocalComponentText;
    description?: LocalComponentText;
    category?: string;
    insertText?: string;
  } = {};
  if (value.title !== undefined) out.title = readText(value.title, 'authoring.title');
  if (value.description !== undefined) out.description = readText(value.description, 'authoring.description');
  if (value.category !== undefined) {
    if (typeof value.category !== 'string' || value.category.length > 64) {
      presetError('authoring.category', 'must be a bounded string.');
    }
    out.category = value.category;
  }
  if (value.insertText !== undefined) {
    if (typeof value.insertText !== 'string' || value.insertText.length > MAX_PRESET_TEXT_LENGTH) {
      presetError('authoring.insertText', 'must be a bounded string.');
    }
    out.insertText = value.insertText;
  }
  return Object.freeze(out);
}

function readAuthoringList(value: unknown, components: readonly LocalComponentDefinition[]): readonly LocalPresetAuthoring[] {
  if (!Array.isArray(value)) presetError('authoring', 'must be an array.');
  if (value.length > MAX_PRESET_AUTHORING) presetError('authoring', `accepts at most ${MAX_PRESET_AUTHORING} entries.`);
  const known = new Set(components.map((component) => component.id));
  const seen = new Set<string>();
  const entries: LocalPresetAuthoring[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) presetError(`authoring[${index}]`, 'must be an object.');
    checkKeys(entry, new Set(['componentId', 'authoring']), `authoring[${index}]`);
    const componentId = entry.componentId;
    if (typeof componentId !== 'string' || !isLocalComponentId(componentId)) {
      presetError(`authoring[${index}].componentId`, 'must be a lowercase namespaced id.');
    }
    if (!known.has(componentId)) {
      presetError(`authoring[${index}].componentId`, `"${componentId}" is not declared by this preset.`);
    }
    if (seen.has(componentId)) {
      presetError('authoring', `component "${componentId}" is declared more than once.`);
    }
    seen.add(componentId);
    entries.push(Object.freeze({ componentId, authoring: readAuthoring(entry.authoring) }));
  }
  return Object.freeze(entries.sort((a, b) => (a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0)));
}

function readDependencies(value: unknown): readonly LocalPresetReference[] {
  if (!Array.isArray(value)) presetError('dependencies', 'must be an array.');
  if (value.length > MAX_PRESET_DEPENDENCIES) {
    presetError('dependencies', `accepts at most ${MAX_PRESET_DEPENDENCIES} entries.`);
  }
  const seen = new Set<string>();
  const dependencies: LocalPresetReference[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) presetError(`dependencies[${index}]`, 'must be an object.');
    checkKeys(entry, DEPENDENCY_KEYS, `dependencies[${index}]`);
    const id = entry.id;
    if (typeof id !== 'string' || !isLocalComponentId(id)) {
      presetError(`dependencies[${index}].id`, 'must be a lowercase namespaced id.');
    }
    if (seen.has(id)) presetError('dependencies', `"${id}" is declared more than once.`);
    seen.add(id);
    const version = entry.version;
    if (typeof version !== 'string' || !isLocalVersion(version)) {
      presetError(`dependencies[${index}].version`, 'must be an exact semantic version.');
    }
    dependencies.push(Object.freeze({ id, version }));
  }
  return Object.freeze(dependencies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

/**
 * Semantic readers treat preset themes as opaque bounded data. The full SDK
 * reader revalidates them through `defineLocalTheme`; the compiler projection
 * must not pull theme CSS validation into its import graph.
 */
function readThemeList(value: unknown): readonly LocalThemePackage[] {
  if (!Array.isArray(value)) presetError('themes', 'must be an array.');
  const themes: LocalThemePackage[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) presetError(`themes[${index}]`, 'must be an object.');
    const id = entry.id;
    const name = entry.name;
    const version = entry.version;
    if (typeof id !== 'string' || id.length === 0) presetError(`themes[${index}].id`, 'must be a non-empty string.');
    if (typeof name !== 'string' || name.length === 0) presetError(`themes[${index}].name`, 'must be a non-empty string.');
    if (typeof version !== 'string' || !isLocalVersion(version)) {
      presetError(`themes[${index}].version`, 'must be a semantic version.');
    }
    if (ids.has(id)) presetError('themes', `theme id "${id}" is declared more than once.`);
    if (names.has(name)) presetError('themes', `theme name "${name}" is declared more than once.`);
    ids.add(id);
    names.add(name);
    themes.push(Object.freeze({ ...entry }) as unknown as LocalThemePackage);
  }
  return Object.freeze(themes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

function readMetadata(value: unknown): LocalPresetPackage['metadata'] {
  if (!isRecord(value)) presetError('metadata', 'must be an object.');
  checkKeys(value, METADATA_KEYS, 'metadata');
  return Object.freeze({
    ...(value.title === undefined ? {} : { title: readText(value.title, 'metadata.title') }),
    ...(value.description === undefined ? {} : { description: readText(value.description, 'metadata.description') }),
  });
}

/** Validate, clone and freeze one preset package. */
export function readLocalPresetPackage(value: unknown): LocalPresetPackage {
  if (isRecord(value) && validatedPresets.has(value)) return value as unknown as LocalPresetPackage;
  if (!isRecord(value)) presetError('preset', 'must be an object.');
  checkKeys(value, PRESET_KEYS, 'preset');
  if (value.protocol !== LOCAL_PRESET_PROTOCOL) {
    presetError('protocol', `must be "${LOCAL_PRESET_PROTOCOL}".`);
  }
  const id = value.id;
  if (typeof id !== 'string' || id.length > MAX_PRESET_ID_LENGTH || !PRESET_ID.test(id)) {
    presetError('id', 'must be a lowercase namespaced id.');
  }
  const version = value.version;
  if (typeof version !== 'string' || !isLocalVersion(version)) {
    presetError('version', 'must be a semantic version such as "1.0.0".');
  }
  if (!Array.isArray(value.components)) presetError('components', 'must be an array.');
  if (value.components.length > MAX_PRESET_COMPONENTS) {
    presetError('components', `accepts at most ${MAX_PRESET_COMPONENTS} components.`);
  }
  const components: LocalComponentDefinition[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (let index = 0; index < value.components.length; index += 1) {
    let component: LocalComponentDefinition;
    try {
      component = defineLocalComponent(value.components[index] as LocalComponentDefinition);
    } catch (error) {
      presetError(`components[${index}]`, error instanceof Error ? error.message : String(error));
    }
    if (ids.has(component.id)) presetError('components', `component id "${component.id}" is declared more than once.`);
    if (names.has(component.name)) presetError('components', `component name "${component.name}" is declared more than once.`);
    ids.add(component.id);
    names.add(component.name);
    components.push(component);
  }
  const authoring = value.authoring === undefined ? undefined : readAuthoringList(value.authoring, components);
  const themes = value.themes === undefined ? undefined : readThemeList(value.themes);
  const dependencies = value.dependencies === undefined ? undefined : readDependencies(value.dependencies);
  const metadata = value.metadata === undefined ? undefined : readMetadata(value.metadata);
  const sourceComponents = value.components as readonly LocalComponentDefinition[];
  const componentsOut = Object.isFrozen(sourceComponents)
    && sourceComponents.length === components.length
    && sourceComponents.every((entry, index) => entry === components[index])
    ? sourceComponents
    : Object.freeze(components);
  const preset: LocalPresetPackage = Object.freeze({
    protocol: LOCAL_PRESET_PROTOCOL,
    id,
    version,
    components: componentsOut,
    ...(authoring ? { authoring } : {}),
    ...(themes ? { themes } : {}),
    ...(dependencies ? { dependencies } : {}),
    ...(metadata ? { metadata } : {}),
  });
  validatedPresets.add(preset);
  return preset;
}

/** Public factory mirroring `defineLocalComponent`. */
export function defineLocalPreset(input: LocalPresetPackage): LocalPresetPackage {
  return readLocalPresetPackage(input);
}

/**
 * Semantic preset digest: sorted component id/version/digest plus exact
 * dependency references. Authoring, metadata, themes and declaration order are
 * intentionally excluded.
 */
export function localPresetDigest(preset: LocalPresetPackage): string {
  const validated = readLocalPresetPackage(preset);
  const canonical = JSON.stringify({
    protocol: LOCAL_PRESET_PROTOCOL,
    id: validated.id,
    version: validated.version,
    components: [...validated.components]
      .map((component) => ({
        id: component.id,
        version: component.version,
        digest: localComponentDigest(component),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    dependencies: [...(validated.dependencies ?? [])]
      .map((dependency) => ({ id: dependency.id, version: dependency.version }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });
  return localHash(canonical);
}
