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

/** Semantic digest; themes and authoring are excluded. */
export function localPresetDigest(preset: LocalPresetPackage): string {
  return localPresetDigestCore(preset);
}

export { defineLocalPresetCore };
