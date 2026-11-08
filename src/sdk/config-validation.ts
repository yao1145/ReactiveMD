import { LOCAL_HTML_NAMES } from '../local/html/html-names';
import { LOCAL_KERNEL_DECLARATIONS } from '../local/configuration/schema-core';
import {
  MAX_LOCAL_SDK_COMPONENTS,
  readLocalComponentManifest,
} from './manifest';
import {
  LOCAL_SDK_VERSION,
  localVersionSatisfies,
} from './version';
import type {
  LocalComponentDefinition,
  LocalPresetReference,
} from './types';

/**
 * Theme-free SDK configuration validation shared by the full SDK entry and the
 * single-compilation reader.
 *
 * This module deliberately imports neither `theme.ts` nor the default preset.
 * Callers pass their assembled built-in component set, so the same rules serve
 * an assembly that installs `defaultPreset.components` and one that installs no
 * preset at all.
 */

/** Aggregate serialized-size budget for one configuration, excluding themes. */
export const MAX_LOCAL_SDK_CONFIG_BYTES = 16 * 1024 * 1024;

export const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
export const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'protocol', 'key', 'assembly', 'presets', 'components', 'replacements',
  'registry', 'themes', 'legacyKeys',
]);

export function fail(path: string, message: string): never {
  throw new Error(`Invalid local SDK config (${path}): ${message}`);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function checkKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) fail(path, `field "${key}" is not allowed.`);
    if (!allowed.has(key)) fail(path, `unknown field "${key}".`);
  }
}

/**
 * Read the selected preset references against one supported preset identity.
 * Omitting `presets` selects that identity; `"default"` normalizes to it.
 */
export function readPresetReferences(
  value: unknown,
  preset: LocalPresetReference,
): readonly LocalPresetReference[] {
  if (value === undefined) return Object.freeze([preset]);
  if (!Array.isArray(value)) fail('presets', 'must be an array.');
  if (value.length === 0) fail('presets', 'must select at least the default preset.');
  const seen = new Set<string>();
  const presets: LocalPresetReference[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    let id: string | undefined;
    let version: string | undefined;
    if (typeof entry === 'string') {
      id = entry;
    } else if (isPlainRecord(entry)) {
      if (entry.id === undefined || typeof entry.id !== 'string') fail(`presets[${index}].id`, 'must be a string.');
      id = entry.id;
      if (entry.version !== undefined) {
        if (typeof entry.version !== 'string') fail(`presets[${index}].version`, 'must be a string.');
        version = entry.version;
      }
    } else {
      fail(`presets[${index}]`, 'must be a preset id or preset reference.');
    }
    const normalized = id === 'default' ? preset.id : id;
    if (normalized !== preset.id) {
      fail(`presets[${index}]`, `unsupported preset "${id}"; phase one accepts only "${preset.id}".`);
    }
    if (version !== undefined && version !== preset.version) {
      fail(`presets[${index}].version`, `must be "${preset.version}".`);
    }
    if (seen.has(preset.id)) fail('presets', `"${preset.id}" is selected more than once.`);
    seen.add(preset.id);
    presets.push(preset);
  }
  return Object.freeze(presets);
}

function builtinIds(defaults: readonly LocalComponentDefinition[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const component of defaults) {
    ids.add(component.name);
    ids.add(component.id);
  }
  return ids;
}

function validateDependencies(
  components: readonly LocalComponentDefinition[],
  defaults: readonly LocalComponentDefinition[],
): void {
  const byId = new Map(components.map((component) => [component.id, component]));
  const builtins = builtinIds(defaults);
  for (const component of components) {
    const kernelRange = component.requires?.kernel;
    if (kernelRange !== undefined && !localVersionSatisfies(LOCAL_SDK_VERSION, kernelRange)) {
      fail('requires', `component "${component.id}" requires kernel ${kernelRange}, but ${LOCAL_SDK_VERSION} is installed.`);
    }
    for (const dependency of component.dependencies ?? []) {
      const external = byId.get(dependency.id);
      const installed = external?.version ?? (builtins.has(dependency.id) ? LOCAL_SDK_VERSION : null);
      if (installed === null) {
        fail('dependencies', `component "${component.id}" requires missing component "${dependency.id}".`);
      }
      if (dependency.version !== undefined && !localVersionSatisfies(installed, dependency.version)) {
        fail(
          'dependencies',
          `component "${component.id}" requires "${dependency.id}" ${dependency.version}, but version ${installed} is installed.`,
        );
      }
    }
  }
  // Depth-first cycle detection over external manifests only.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: readonly string[]): void => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      fail('dependencies', `dependency cycle: ${[...path, id].join(' -> ')}.`);
    }
    state.set(id, 'visiting');
    const component = byId.get(id);
    for (const dependency of component?.dependencies ?? []) {
      if (byId.has(dependency.id)) visit(dependency.id, [...path, id]);
    }
    state.set(id, 'done');
  };
  for (const id of byId.keys()) visit(id, []);
}

/**
 * Read external component manifests. Built-in names, kernel grammar names,
 * HTML tag names and the theme declaration are reserved, and external ids may
 * not collide with each other or with the built-in registry.
 */
export function readComponents(
  value: unknown,
  defaults: readonly LocalComponentDefinition[],
): readonly LocalComponentDefinition[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) fail('components', 'must be an array.');
  if (value.length > MAX_LOCAL_SDK_COMPONENTS) {
    fail('components', `accepts at most ${MAX_LOCAL_SDK_COMPONENTS} external components.`);
  }
  const reserved = new Set<string>([
    ...defaults.map((component) => component.name),
    ...LOCAL_KERNEL_DECLARATIONS.map((schema) => schema.name),
    ...LOCAL_HTML_NAMES,
  ].map((name) => name.toLowerCase()));
  reserved.add('theme');
  const ids = new Set(defaults.map((component) => component.id));
  const names = new Set<string>();
  const components: LocalComponentDefinition[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const component = readLocalComponentManifest(value[index]);
    if (reserved.has(component.name.toLowerCase())) {
      fail(`components[${index}]`, `name "${component.name}" conflicts with a built-in component, HTML tag or theme declaration.`);
    }
    if (ids.has(component.id)) fail('components', `component id "${component.id}" is declared more than once.`);
    if (names.has(component.name)) fail('components', `component name "${component.name}" is declared more than once.`);
    ids.add(component.id);
    names.add(component.name);
    components.push(component);
  }
  validateDependencies(components, defaults);
  return Object.freeze(components);
}
