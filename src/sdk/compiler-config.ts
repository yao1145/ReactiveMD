import { LOCAL_HTML_NAMES } from '../local/html-names';
import { LOCAL_KERNEL_DECLARATIONS } from '../local/schema-core';
import { localHash } from './hash';
import {
  MAX_LOCAL_SDK_COMPONENTS,
  localComponentDigest,
  localJsonByteLength,
  readLocalComponentManifest,
} from './manifest';
import {
  LOCAL_CONFIG_PROTOCOL,
  LOCAL_SDK_VERSION,
  localVersionSatisfies,
} from './version';
import type {
  LocalComponentDefinition,
  LocalConfig,
  LocalPresetReference,
} from './types';

/**
 * Semantic SDK-configuration reader for single compilation.
 *
 * This module validates the configuration data that affects compilation:
 * presets, component manifests and their dependency graph. It intentionally
 * imports neither `config.ts` nor any theme implementation, so a compiler that
 * installs no default preset can still accept a host configuration.
 *
 * Host theme assets stay opaque and are excluded from the semantic snapshot.
 * The host validates those assets before loading them.
 */

/**
 * Phase-one default preset identity, kept as protocol data rather than by
 * importing the preset implementation. Update it here if the default preset
 * identity changes; the standard compiler and this reader must agree for the
 * semantic key to stay compatible with `localComponentConfigKey`.
 */
export const DEFAULT_COMPILER_PRESET: LocalPresetReference = Object.freeze({
  id: 'reactive-md/default',
  version: LOCAL_SDK_VERSION,
});
/** Typed payload budget; mirrors `MAX_LOCAL_SDK_CONFIG_BYTES` in `config.ts`. */
const MAX_COMPILER_CONFIG_BYTES = 16 * 1024 * 1024;


const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CONFIG_KEYS = new Set(['protocol', 'key', 'presets', 'components', 'registry', 'themes']);

function fail(path: string, message: string): never {
  throw new Error(`Invalid local SDK config (${path}): ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) fail(path, `field "${key}" is not allowed.`);
    if (!allowed.has(key)) fail(path, `unknown field "${key}".`);
  }
}

function defaultPresets(): readonly LocalPresetReference[] {
  return Object.freeze([DEFAULT_COMPILER_PRESET]);
}

function readPresets(value: unknown): readonly LocalPresetReference[] {
  if (value === undefined) return defaultPresets();
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
    const normalized = id === 'default' ? DEFAULT_COMPILER_PRESET.id : id;
    if (normalized !== DEFAULT_COMPILER_PRESET.id) {
      fail(`presets[${index}]`, `unsupported preset "${id}"; phase one accepts only "${DEFAULT_COMPILER_PRESET.id}".`);
    }
    if (version !== undefined && version !== DEFAULT_COMPILER_PRESET.version) {
      fail(`presets[${index}].version`, `must be "${DEFAULT_COMPILER_PRESET.version}".`);
    }
    if (seen.has(DEFAULT_COMPILER_PRESET.id)) fail('presets', `"${DEFAULT_COMPILER_PRESET.id}" is selected more than once.`);
    seen.add(DEFAULT_COMPILER_PRESET.id);
    presets.push(DEFAULT_COMPILER_PRESET);
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

function readComponents(
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

/** Canonical preset references, sorted exactly as `config.ts` sorts them. */
function canonicalPresets(presets: readonly LocalPresetReference[]): unknown {
  return [...presets]
    .map((preset) => ({ id: preset.id, version: preset.version }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Semantic configuration key shared with `localComponentConfigKey`.
 *
 * Themes and authoring copy are excluded so restyling never changes the
 * compiled identity. The algorithm must stay byte-compatible with
 * `config.ts:configKey`.
 */
export function compilerConfigKey(
  presets: readonly LocalPresetReference[],
  components: readonly LocalComponentDefinition[],
): string {
  const canonical = JSON.stringify({
    protocol: LOCAL_CONFIG_PROTOCOL,
    presets: canonicalPresets(presets),
    components: [...components]
      .map((component) => ({ id: component.id, version: component.version, digest: localComponentDigest(component) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });
  return localHash(canonical);
}

/**
 * Validate configuration data for compilation. The caller-supplied `key` and
 * `registry` are ignored; both are rebuilt from the validated semantics.
 * `defaults` is the assembled built-in registry used for reserved names,
 * dependency identifiers and the returned registry order.
 */
export function readCompilerConfig(
  value: unknown,
  defaults: readonly LocalComponentDefinition[] = [],
): LocalConfig {
  if (!isPlainRecord(value)) fail('config', 'must be an object.');
  checkKeys(value, CONFIG_KEYS, 'config');
  if (value.protocol !== LOCAL_CONFIG_PROTOCOL) {
    fail('config.protocol', `must be "${LOCAL_CONFIG_PROTOCOL}".`);
  }
  const requestedPresets = readPresets(value.presets);
  const presets = defaults.length > 0 ? requestedPresets : Object.freeze([]);
  const components = readComponents(value.components, defaults);
  const themes = Object.freeze([]);
  const serialized = { protocol: LOCAL_CONFIG_PROTOCOL, presets, components };
  if (localJsonByteLength(serialized) > MAX_COMPILER_CONFIG_BYTES) {
    fail('config', `serialized size exceeds the ${MAX_COMPILER_CONFIG_BYTES}-byte budget.`);
  }
  return Object.freeze({
    protocol: LOCAL_CONFIG_PROTOCOL,
    key: compilerConfigKey(presets, components),
    presets,
    components,
    registry: Object.freeze([...defaults, ...components]),
    themes,
  });
}
