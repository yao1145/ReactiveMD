/**
 * Compatibility catalog of default React-free editor components.
 *
 * The data no longer lives here: titles, descriptions, groups, keywords and
 * templates are the default preset authoring data in
 * `src/presets/default-authoring.ts`, and the same manifests are validated by
 * the default preset. This module only projects that single source into the
 * legacy `NATIVE_COMPONENTS` shape so existing editor and host code keeps
 * working.
 *
 * Templates stay close to the documented authoring syntax:
 * - `{{bind:base}}` is resolved by `renderNativeSnippet` to a fresh bind name.
 * - `{{selection}}`, `{{selection:fallback}}`, `{{caret}}` and `{{select:value}}`
 *   are left for the toolbar's `insertTemplate` handler.
 * - Leaf components never receive a closing tag; container bodies use blank
 *   lines so inserted Markdown keeps a natural block layout.
 */

import {
  DEFAULT_AUTHORING_GROUPS,
  DEFAULT_AUTHORING_ORDER,
  DEFAULT_COMPONENT_AUTHORING,
  defaultAuthoringKeywords,
  pickDefaultAuthoringText,
  type DefaultAuthoringGroupId,
} from '../presets/default-authoring';
import type { EditorLocale } from './command-types';

export type NativeComponentGroupId = DefaultAuthoringGroupId;

export interface NativeComponentGroup {
  id: NativeComponentGroupId;
  label: string;
}

export interface NativeComponentDefinition {
  id: string;
  label: string;
  description: string;
  group: NativeComponentGroupId;
  keywords: string[];
  inline?: boolean;
  template: string;
}

export const NATIVE_COMPONENT_GROUPS: readonly NativeComponentGroup[] = Object.freeze(
  DEFAULT_AUTHORING_GROUPS.map((group) => ({
    id: group.id,
    label: pickDefaultAuthoringText(group.title, 'en', group.id),
  })),
);

function nativeComponent(name: string, locale: EditorLocale): NativeComponentDefinition {
  const data = DEFAULT_COMPONENT_AUTHORING[name];
  return {
    id: name,
    label: pickDefaultAuthoringText(data.title, locale, name),
    description: pickDefaultAuthoringText(data.description, locale, name),
    group: data.category,
    keywords: [...(defaultAuthoringKeywords(name) ?? [])],
    ...(data.inline === true ? { inline: true } : {}),
    template: pickDefaultAuthoringText(data.insertText, locale, data.insertText.en ?? ''),
  };
}

export const NATIVE_COMPONENTS: readonly NativeComponentDefinition[] = DEFAULT_AUTHORING_ORDER.map(
  (name) => nativeComponent(name, 'en'),
);

export const NATIVE_COMPONENT_GROUPS_ZH: readonly NativeComponentGroup[] = Object.freeze(
  DEFAULT_AUTHORING_GROUPS.map((group) => ({
    id: group.id,
    label: pickDefaultAuthoringText(group.title, 'zh', group.id),
  })),
);

export const NATIVE_COMPONENTS_ZH: readonly NativeComponentDefinition[] = DEFAULT_AUTHORING_ORDER.map(
  (name) => nativeComponent(name, 'zh'),
);

/** The legacy extended subset, derived from the same preset data. */
export const EXTENDED_NATIVE_COMPONENTS: readonly NativeComponentDefinition[] =
  NATIVE_COMPONENTS.filter((component) => DEFAULT_COMPONENT_AUTHORING[component.id]?.extended === true);

/** Chinese copy for the legacy extended subset. */
export const EXTENDED_NATIVE_COMPONENT_COPY_ZH: Readonly<Record<string, {
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly template: string;
}>> = Object.freeze(Object.fromEntries(
  NATIVE_COMPONENTS_ZH
    .filter((component) => DEFAULT_COMPONENT_AUTHORING[component.id]?.extended === true)
    .map((component) => [component.id, Object.freeze({
      label: component.label,
      description: component.description,
      keywords: Object.freeze([...component.keywords]),
      template: component.template,
    })] as const),
));

export interface NativeComponentCatalog {
  groups: readonly NativeComponentGroup[];
  components: readonly NativeComponentDefinition[];
}

/**
 * Catalog for the active UI language. Labels, descriptions and templates are
 * localized; keywords keep both English and Chinese terms so either query
 * works in either language.
 */
export function getNativeComponentCatalog(locale: EditorLocale = 'en'): NativeComponentCatalog {
  if (locale === 'zh') {
    return { groups: NATIVE_COMPONENT_GROUPS_ZH, components: NATIVE_COMPONENTS_ZH };
  }
  return { groups: NATIVE_COMPONENT_GROUPS, components: NATIVE_COMPONENTS };
}

function collectIdentifiers(source: string): Set<string> {
  return new Set(source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
}

function normalizeBindBase(rawBase: string): string {
  const cleaned = rawBase.trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!cleaned) return 'value';
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function uniqueBindName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/**
 * Render one toolbar template for insertion into `source`.
 *
 * Only `{{bind:base}}` is resolved here. Selection, caret and selectable tokens
 * stay intact for the toolbar's `insertTemplate` step. `selectedText` is kept
 * for future use; it never replaces the tokens here.
 */
export function renderNativeSnippet(
  component: NativeComponentDefinition,
  source: string,
  selectedText?: string,
): string {
  void selectedText;
  const used = collectIdentifiers(source);
  const rendered = new Map<string, string>();

  return component.template.replace(/\{\{bind:([^{}]+)\}\}/g, (_token: string, rawBase: string) => {
    const key = rawBase.trim();
    const existing = rendered.get(key);
    if (existing) return existing;

    const name = uniqueBindName(normalizeBindBase(key), used);
    used.add(name);
    rendered.set(key, name);
    return name;
  });
}
