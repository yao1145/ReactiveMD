import {
  defineLocalPreset as defineLocalPresetCore,
  localPresetDigest as localPresetDigestCore,
  readLocalPresetPackage as readLocalPresetCore,
} from './preset-core';
import { defineLocalTheme } from './theme';
import type { LocalThemeInput } from './theme';
import type { LocalPresetPackage } from './types';

/**
 * Full preset reader. Semantic validation lives in `preset-core.ts`, which the
 * compiler entry uses without loading theme CSS validation. This module adds
 * the full SDK's theme validation and freezes the complete package.
 */

const validatedPresets = new WeakSet<object>();

function themeError(index: number, error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`Invalid local preset (themes[${index}]): ${detail}`);
}

/** Validate, clone and freeze one preset package, including its themes. */
export function readLocalPresetPackage(value: unknown): LocalPresetPackage {
  if (typeof value === 'object' && value !== null && validatedPresets.has(value)) {
    return value as unknown as LocalPresetPackage;
  }
  const core = readLocalPresetCore(value);
  if (core.themes === undefined) {
    validatedPresets.add(core);
    return core;
  }
  const themes = core.themes.map((theme, index) => {
    try {
      return defineLocalTheme(theme as LocalThemeInput);
    } catch (error) {
      themeError(index, error);
    }
  });
  const preset: LocalPresetPackage = Object.freeze({
    ...core,
    themes: Object.freeze(themes),
  });
  validatedPresets.add(preset);
  return preset;
}

/** Public factory mirroring `defineLocalComponent`. */
export function defineLocalPreset(input: LocalPresetPackage): LocalPresetPackage {
  return readLocalPresetPackage(input);
}

export type LocalPresetSelection =
  | { readonly include: readonly string[]; readonly exclude?: never }
  | { readonly exclude: readonly string[]; readonly include?: never };

/** Select components in declaration order, preserving the preset's assembly dependencies. */
export function deriveLocalPreset(input: LocalPresetPackage, selection: LocalPresetSelection): LocalPresetPackage {
  const preset = readLocalPresetPackage(input);
  const { include, exclude } = selection;
  const names = include ?? exclude;
  if ((include !== undefined && exclude !== undefined) || !Array.isArray(names)) {
    throw new TypeError('Provide exactly one include or exclude array.');
  }
  const known = new Set(preset.components.map(component => component.name));
  const selected = new Set<string>();
  for (const name of names) {
    if (!known.has(name) || selected.has(name)) throw new TypeError(`Invalid or repeated component name: ${name}.`);
    selected.add(name);
  }
  const components = preset.components.filter(component => selected.has(component.name) === (include !== undefined));
  const ids = new Set(components.map(component => component.id));
  return defineLocalPreset({ ...preset, components,
    ...(preset.authoring ? { authoring: preset.authoring.filter(entry => ids.has(entry.componentId)) } : {}) });
}

/** Semantic digest; themes and authoring are excluded. */
export function localPresetDigest(preset: LocalPresetPackage): string {
  return localPresetDigestCore(preset);
}

export { defineLocalPresetCore };
